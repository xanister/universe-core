/**
 * Integrity Helpers
 *
 * Shared helper functions for the validation and repair system.
 */

import type { EntityType } from '@dmnpc/types/entity';
import type {
  ValidationIssue,
  UnfixedIssues,
  IssueSummary,
  ValidationResult,
  RepairResult,
  IssuesByValidator,
} from './integrity-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { deleteEntityWithCleanup } from '@dmnpc/core/entities/entity-deletion.js';

/**
 * Get the entity type from an entity ID prefix.
 */
export function getEntityType(entityId: string): EntityType {
  if (entityId.startsWith('CHAR_')) return 'character';
  if (entityId.startsWith('PLACE_')) return 'place';
  if (entityId.startsWith('EVENT_')) return 'event';
  if (entityId.startsWith('OBJ_')) return 'object';
  if (entityId.startsWith('PORTAL_')) {
    throw new Error(`Exit objects use OBJ_ prefix, not PORTAL_. ID: ${entityId}`);
  }
  throw new Error(`Unknown entity type for ID: ${entityId}`);
}

/**
 * Categorize unfixed issues by reason.
 * Issues with clarificationQuestion are NOT counted as unfixed - they are
 * routed to the clarification system and have a resolution path.
 */
export function categorizeUnfixedIssues(
  allIssues: ValidationIssue[],
  fixedIssues: ValidationIssue[],
  failedIssues: ValidationIssue[],
): UnfixedIssues {
  const fixedIssueKeys = new Set(
    fixedIssues.map((i) => `${i.entityId}:${i.field ?? ''}:${i.validatorId}`),
  );
  const failedIssueKeys = new Set(
    failedIssues.map((i) => `${i.entityId}:${i.field ?? ''}:${i.validatorId}`),
  );

  const mediumConfidence: ValidationIssue[] = [];
  const fixFailed: ValidationIssue[] = [];
  const skipped: ValidationIssue[] = [];

  for (const issue of allIssues) {
    const issueKey = `${issue.entityId}:${issue.field ?? ''}:${issue.validatorId}`;

    // Skip if this issue was fixed
    if (fixedIssueKeys.has(issueKey)) {
      continue;
    }

    // Skip if this issue has a clarification question - it's handled by the clarification system
    if (issue.clarificationQuestion) {
      continue;
    }

    // Check if fix was attempted but failed
    if (failedIssueKeys.has(issueKey)) {
      fixFailed.push(issue);
      continue;
    }

    // Check if no resolution path available - this is a validator bug
    if (!issue.suggestedFix) {
      logger.error(
        'IntegrityService',
        `Issue has no fix or clarification (validator bug): ${issue.validatorId} on ${issue.entityId}`,
      );
      continue;
    }

    // Check if medium confidence (only fixed during repair, not validation)
    if (issue.suggestedFix.confidence === 'medium') {
      mediumConfidence.push(issue);
      continue;
    }

    // Shouldn't reach here, but categorize as skipped
    skipped.push(issue);
  }

  return {
    mediumConfidence,
    fixFailed,
    skipped,
  };
}

/**
 * Create summary statistics from issues.
 */
export function createSummary(
  allIssues: ValidationIssue[],
  fixedIssues: ValidationIssue[],
  unfixed: UnfixedIssues,
): IssueSummary {
  return {
    totalFound: allIssues.length,
    totalFixed: fixedIssues.length,
    mediumConfidence: unfixed.mediumConfidence.length,
    fixFailed: unfixed.fixFailed.length,
    skipped: unfixed.skipped.length,
  };
}

/**
 * Group issues by validator ID.
 */
export function groupIssuesByValidator(issues: ValidationIssue[]): Map<string, ValidationIssue[]> {
  const grouped = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const existing = grouped.get(issue.validatorId) || [];
    existing.push(issue);
    grouped.set(issue.validatorId, existing);
  }
  return grouped;
}

/**
 * Convert Map to plain object for JSON serialization.
 */
export function mapToObject(map: Map<string, ValidationIssue[]>): IssuesByValidator {
  const obj: IssuesByValidator = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Create empty validation/repair result for error cases.
 */
export function createEmptyResult(entityId: string, entityType: EntityType): ValidationResult {
  const emptyUnfixed: UnfixedIssues = {
    mediumConfidence: [],
    fixFailed: [],
    skipped: [],
  };
  return {
    entityId,
    entityType,
    issuesFound: 0,
    issuesFixed: 0,
    issues: [],
    issuesFixedList: [],
    issuesUnfixed: emptyUnfixed,
    summary: createSummary([], [], emptyUnfixed),
    issuesByValidator: {},
  };
}

/**
 * Create empty repair result (same structure as ValidationResult but typed as RepairResult).
 */
export function createEmptyRepairResult(entityId: string, entityType: EntityType): RepairResult {
  return createEmptyResult(entityId, entityType) as RepairResult;
}

/**
 * Delete an entity using the centralized deletion service.
 * This ensures proper cleanup of references and consistent deletion behavior.
 */
export function deleteEntity(ctx: UniverseContext, entityId: string): boolean {
  try {
    const result = deleteEntityWithCleanup(ctx, entityId, { throwOnNotFound: false });
    if (result?.success) {
      logger.info('IntegrityRepair', `Deleted entity ${entityId}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('IntegrityRepair', 'Failed to delete entity', {
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Format unfixed issues breakdown for logging.
 */
export function formatUnfixedBreakdown(unfixed: UnfixedIssues): string {
  const parts = [
    unfixed.mediumConfidence.length > 0 ? `mediumConf=${unfixed.mediumConfidence.length}` : '',
    unfixed.fixFailed.length > 0 ? `failed=${unfixed.fixFailed.length}` : '',
    unfixed.skipped.length > 0 ? `skipped=${unfixed.skipped.length}` : '',
  ].filter(Boolean);

  return parts.length > 0 ? ` unfixed: ${parts.join(' ')}` : '';
}

/**
 * Format validator counts for logging.
 */
export function formatValidatorCounts(issues: ValidationIssue[]): string {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.validatorId, (counts.get(issue.validatorId) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([v, c]) => `${v}=${c}`)
    .join(' ');
}
