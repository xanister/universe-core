/**
 * Entity Integrity Service
 *
 * A modular system for detecting and repairing entity data issues.
 * Can be triggered:
 * - On-demand after entity generation (fire-and-forget)
 * - Periodically via batch scanner (every N messages)
 * - Explicitly via agent tool
 */

// Core validation function
export { validateEntity } from './validate-entity.js';

// Batch scanner for periodic validation
export { triggerBatchValidation, resetBatchState } from './batch-scanner.js';

// Universe validator runner (centralized execution of universe-level validators)
export { runUniverseValidators } from './universe-validator-runner.js';
export type {
  RunUniverseValidatorsOptions,
  UniverseValidatorsResult,
} from './universe-validator-runner.js';

// Types
export type {
  ValidationIssue,
  ValidationResult,
  ValidationContext,
  Validator,
  BatchScannerOptions,
  BatchResult,
  IssueSeverity,
  FixConfidence,
  SuggestedFix,
} from './integrity-types.js';

// Validators (for testing/extension)
export { getEntityValidators, ENTITY_VALIDATORS } from './validator-registry.js';
