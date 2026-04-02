/**
 * Batch Scanner
 *
 * Periodically validates entities in batches.
 * Tracks last-validated timestamp to prioritize oldest-checked entities.
 * Also runs universe-level validators (environment hierarchy).
 */

import type { BaseEntity, UniverseEvent } from '@dmnpc/types/entity';
import type {
  BatchResult,
  BatchScannerOptions,
  ValidationResult,
  UnfixedIssues,
  IssueSummary,
  ValidationIssue,
  IssuesByValidator,
} from './integrity-types.js';
import { validateEntity, buildValidationContext } from './validate-entity.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { runUniverseValidators } from './universe-validator-runner.js';

/** Default batch size (entities per run) */
const DEFAULT_BATCH_SIZE = 5;

/** Default message interval between batch runs */
const DEFAULT_MESSAGE_INTERVAL = 10;

/** In-memory state (resets on server restart - acceptable) */
let messagesSinceLastRun = 0;
const lastValidated: Map<string, number> = new Map();

/** Flag to prevent concurrent batch runs */
let batchRunning = false;

/**
 * Aggregate unfixed issues across multiple validation results.
 */
function aggregateUnfixedIssues(results: ValidationResult[]): UnfixedIssues {
  const mediumConfidence: ValidationIssue[] = [];
  const fixFailed: ValidationIssue[] = [];
  const skipped: ValidationIssue[] = [];

  for (const result of results) {
    mediumConfidence.push(...result.issuesUnfixed.mediumConfidence);
    fixFailed.push(...result.issuesUnfixed.fixFailed);
    skipped.push(...result.issuesUnfixed.skipped);
  }

  return {
    mediumConfidence,
    fixFailed,
    skipped,
  };
}

/**
 * Aggregate summary statistics across multiple validation results.
 */
function aggregateSummary(results: ValidationResult[]): IssueSummary {
  let totalFound = 0;
  let totalFixed = 0;
  let mediumConfidence = 0;
  let fixFailed = 0;
  let skipped = 0;

  for (const result of results) {
    totalFound += result.summary.totalFound;
    totalFixed += result.summary.totalFixed;
    mediumConfidence += result.summary.mediumConfidence;
    fixFailed += result.summary.fixFailed;
    skipped += result.summary.skipped;
  }

  return {
    totalFound,
    totalFixed,
    mediumConfidence,
    fixFailed,
    skipped,
  };
}

/**
 * Trigger a batch validation if the message threshold is reached.
 * This is a fire-and-forget operation.
 *
 * @param universeId - The universe ID to validate
 * @param options - Optional batch scanner configuration
 */
export function triggerBatchValidation(
  universeId: string,
  options: BatchScannerOptions = {},
): void {
  const { messageInterval = DEFAULT_MESSAGE_INTERVAL } = options;

  messagesSinceLastRun++;

  if (messagesSinceLastRun < messageInterval) {
    return;
  }

  messagesSinceLastRun = 0;

  if (batchRunning) {
    logger.info('IntegrityService', 'Batch already running, skipping');
    return;
  }

  runBatch(universeId, options).catch((err) => {
    logger.error('IntegrityService', 'Batch validation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Run a batch validation.
 */
async function runBatch(
  universeId: string,
  options: BatchScannerOptions = {},
): Promise<BatchResult> {
  const { batchSize = DEFAULT_BATCH_SIZE } = options;
  const startTime = Date.now();

  batchRunning = true;

  try {
    const universeCtx = await UniverseContext.loadAtEntryPoint(universeId);

    // Collect all entities (events included — Validator.validate accepts both types)
    const allEntities: Array<BaseEntity | UniverseEvent> = [
      ...universeCtx.characters,
      ...universeCtx.places,
      ...universeCtx.events,
    ];

    if (allEntities.length === 0) {
      logger.info('IntegrityService', 'No entities to validate');
      const emptyUnfixed: UnfixedIssues = {
        mediumConfidence: [],
        fixFailed: [],
        skipped: [],
      };
      return {
        entitiesChecked: 0,
        totalIssuesFound: 0,
        totalIssuesFixed: 0,
        results: [],
        issuesUnfixed: emptyUnfixed,
        summary: {
          totalFound: 0,
          totalFixed: 0,
          mediumConfidence: 0,
          fixFailed: 0,
          skipped: 0,
        },
        issuesByValidator: {},
      };
    }

    // Sort by last-validated (oldest first, never-validated first)
    const sorted = allEntities.sort((a, b) => {
      const aTime = lastValidated.get(a.id) ?? 0;
      const bTime = lastValidated.get(b.id) ?? 0;
      return aTime - bTime;
    });

    const batch = sorted.slice(0, batchSize);

    const results = [];
    let totalIssuesFound = 0;
    let totalIssuesFixed = 0;

    for (const entity of batch) {
      const result = await validateEntity(entity.id, universeCtx);
      results.push(result);

      totalIssuesFound += result.issuesFound;
      totalIssuesFixed += result.issuesFixed;

      // Update last-validated timestamp
      lastValidated.set(entity.id, Date.now());
    }

    // Run universe-level validators using centralized runner
    const validationCtx = buildValidationContext(universeCtx);
    const universeValidatorResult = await runUniverseValidators(validationCtx, universeCtx);

    totalIssuesFound += universeValidatorResult.totalIssuesFound;
    totalIssuesFixed += universeValidatorResult.totalIssuesFixed;

    const issuesUnfixed = aggregateUnfixedIssues(results);
    const summary = aggregateSummary(results);

    const issuesByValidatorMap = new Map<string, ValidationIssue[]>();
    for (const result of results) {
      for (const [validatorId, issues] of Object.entries(result.issuesByValidator)) {
        const existing = issuesByValidatorMap.get(validatorId) || [];
        existing.push(...issues);
        issuesByValidatorMap.set(validatorId, existing);
      }
    }
    const issuesByValidator: IssuesByValidator = {};
    for (const [key, value] of issuesByValidatorMap.entries()) {
      issuesByValidator[key] = value;
    }

    const duration = Date.now() - startTime;

    const unfixedBreakdown = [
      summary.mediumConfidence > 0 ? `mediumConf=${summary.mediumConfidence}` : '',
      summary.fixFailed > 0 ? `failed=${summary.fixFailed}` : '',
      summary.skipped > 0 ? `skipped=${summary.skipped}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    logger.info(
      'IntegrityService',
      `Batch validation complete: ${batch.length}/${allEntities.length} entities, ${totalIssuesFound} issues found, ${totalIssuesFixed} fixed, ${duration}ms${unfixedBreakdown ? ` unfixed: ${unfixedBreakdown}` : ''}`,
    );

    return {
      entitiesChecked: batch.length,
      totalIssuesFound,
      totalIssuesFixed,
      results,
      issuesUnfixed,
      summary,
      issuesByValidator,
    };
  } finally {
    batchRunning = false;
  }
}

/**
 * Reset batch scanner state (for testing).
 */
export function resetBatchState(): void {
  messagesSinceLastRun = 0;
  lastValidated.clear();
  batchRunning = false;
}

/**
 * Get the current message count since last run (for testing).
 */
export function getMessagesSinceLastRun(): number {
  return messagesSinceLastRun;
}
