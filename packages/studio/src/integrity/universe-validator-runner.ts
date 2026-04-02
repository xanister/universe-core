/**
 * Universe Validator Runner
 *
 * Centralized execution of universe-level validators.
 * Used by both batch-scanner (background) and validation routes (on-demand).
 *
 * This ensures validators are only configured in one place (validator-registry.ts)
 * and run consistently across all code paths.
 */

import type { ValidationContext } from './integrity-types.js';
import { addQuestions } from '@dmnpc/core/clarification/clarification-store.js';
import type { ClarificationQuestion } from '@dmnpc/core/clarification/clarification-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { UNIVERSE_VALIDATORS, type UniverseValidatorEntry } from './validator-registry.js';
import type { UniverseValidatorResult } from '@dmnpc/types/entity';

function hasClarificationQuestions(
  result: UniverseValidatorResult,
): result is UniverseValidatorResult & { clarificationQuestions: ClarificationQuestion[] } {
  return (
    'clarificationQuestions' in result &&
    Array.isArray(result.clarificationQuestions) &&
    result.clarificationQuestions.length > 0
  );
}

/**
 * Options for running universe validators.
 */
export interface RunUniverseValidatorsOptions {
  /** Validator IDs to skip (for testing or special cases) */
  skipValidators?: string[];
}

/**
 * Result from running universe validators.
 */
export interface UniverseValidatorsResult {
  /** Total issues found across all validators */
  totalIssuesFound: number;
  /** Total issues fixed across all validators */
  totalIssuesFixed: number;
  /** Results by validator ID (use these for detailed response building) */
  validatorResults: Record<string, UniverseValidatorResult>;
  /** Validators that were skipped */
  skippedValidators: string[];
}

/**
 * Run universe-level validators based on the registry configuration.
 *
 * @param validationCtx - Validation context with universe data
 * @param universeCtx - Universe context for persistence
 * @param options - Execution options
 * @returns Aggregated results from all validators
 */
export async function runUniverseValidators(
  validationCtx: ValidationContext,
  universeCtx: UniverseContext,
  options: RunUniverseValidatorsOptions = {},
): Promise<UniverseValidatorsResult> {
  const { skipValidators = [] } = options;

  const result: UniverseValidatorsResult = {
    totalIssuesFound: 0,
    totalIssuesFixed: 0,
    validatorResults: {},
    skippedValidators: [],
  };

  // Filter validators based on options
  const skipSet = new Set(skipValidators);
  const validators = UNIVERSE_VALIDATORS.filter((entry) => {
    // Skip if validator is disabled in registry
    if (entry.disabled) {
      result.skippedValidators.push(entry.id);
      return false;
    }
    // Skip if explicitly disabled via options
    if (skipSet.has(entry.id)) {
      result.skippedValidators.push(entry.id);
      return false;
    }
    return true;
  });

  // Run each validator
  for (const entry of validators) {
    const validatorResult = await runSingleValidator(entry, validationCtx, universeCtx);

    result.validatorResults[entry.id] = validatorResult;

    // Count repairs as issues found and fixed
    if (validatorResult.repaired) {
      result.totalIssuesFound += validatorResult.repairs.length;
      result.totalIssuesFixed += validatorResult.repairs.length;
    }

    // Handle clarification questions if the validator generates them
    if (hasClarificationQuestions(validatorResult)) {
      await addQuestions(universeCtx.universeId, validatorResult.clarificationQuestions);
      logger.info(
        'UniverseValidatorRunner',
        `Added ${validatorResult.clarificationQuestions.length} clarification questions from ${entry.id}`,
      );
    }
  }

  return result;
}

/**
 * Run a single universe validator.
 * Always runs repair - each repair function calls validate() internally
 * and returns early if nothing to repair.
 */
async function runSingleValidator(
  entry: UniverseValidatorEntry,
  validationCtx: ValidationContext,
  universeCtx: UniverseContext,
): Promise<UniverseValidatorResult> {
  const result = await entry.repair(validationCtx, universeCtx);

  if (result.repaired) {
    logger.info(
      'UniverseValidatorRunner',
      `${entry.name}: ${result.repairs.length} repairs applied`,
    );
  }

  return result;
}
