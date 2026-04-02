/**
 * Entity Integrity Service - Types
 *
 * Shared types and interfaces for the entity validation and repair system.
 */

import type {
  EntityType,
  Universe,
  Character,
  Place,
  ObjectEntity,
  UniverseEvent,
  BaseEntity,
} from '@dmnpc/types/entity';
import type { WorldBible } from '@dmnpc/types/world';
import type { ClarificationQuestion } from '@dmnpc/core/clarification/clarification-types.js';

/**
 * Severity levels for validation issues.
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * Confidence level for suggested fixes.
 * - 'high': Safe to auto-apply (deterministic or validated LLM output)
 * - 'medium': Requires manual review
 */
export type FixConfidence = 'high' | 'medium';

/**
 * Repair method for fixing an issue.
 * - 'deterministic': Rule-based fix (reset to default, remove invalid ref)
 * - 'llm': LLM-generated fix (generate missing content)
 * - 'merge': Merge duplicate entities
 * - 'delete': Delete the entity (orphaned or invalid)
 * - 'image': Generate missing entity image
 * - 'map-image': Generate missing place map image
 * - 'layout': Generate place layout and objects
 * - 'character-sprite': Generate missing in-world character sprite (spriteConfig.spriteUrl)
 */
type RepairMethod =
  | 'deterministic'
  | 'llm'
  | 'merge'
  | 'delete'
  | 'image'
  | 'map-image'
  | 'layout'
  | 'character-sprite'
  | 'battle-background';

/**
 * A suggested fix for a validation issue.
 */
export interface SuggestedFix {
  /** The field to fix */
  field: string;
  /** The suggested value */
  value: unknown;
  /** Confidence level - only 'high' confidence fixes are auto-applied */
  confidence: FixConfidence;
  /** The repair method to use */
  method: RepairMethod;
}

/**
 * A validation issue detected by a validator.
 */
export interface ValidationIssue {
  /** The entity ID with the issue */
  entityId: string;
  /** The entity type */
  entityType: EntityType;
  /** The validator that detected this issue */
  validatorId: string;
  /** Severity of the issue */
  severity: IssueSeverity;
  /** The field with the issue (if applicable) */
  field?: string;
  /** Human-readable description of the issue */
  message: string;
  /** Suggested fix (if available) */
  suggestedFix?: SuggestedFix;
  /**
   * If this issue requires user clarification before a confident fix can be made.
   * When present, the issue won't be auto-fixed until the question is answered.
   * The clarificationQuestion.providerId should match validatorId for proper routing.
   */
  clarificationQuestion?: ClarificationQuestion;
}

/**
 * Context provided to validators for checking entities.
 */
export interface ValidationContext {
  /** The current universe configuration */
  universe: Universe;
  /** All characters in the universe, keyed by ID */
  characters: Map<string, Character>;
  /** All places in the universe, keyed by ID */
  places: Map<string, Place>;
  /** All objects in the universe, keyed by ID (includes exit objects) */
  objects: Map<string, ObjectEntity>;
  /** All universe events, keyed by ID */
  events: Map<string, UniverseEvent>;
  /** Valid race IDs from universe.races */
  validRaceIds: Set<string>;
  /** The root place ID for fallback */
  rootPlaceId: string;
  /** WorldBible for additional context (if available) */
  worldBible?: WorldBible;
}

/**
 * Interface for a validator module.
 */
export interface Validator {
  /** Unique identifier for this validator */
  id: string;
  /** Human-readable name */
  name: string;
  /**
   * Validate an entity and return any issues found.
   * @param entity - The entity to validate
   * @param ctx - Validation context with universe data
   * @returns Array of validation issues (empty if no issues)
   */
  validate(
    entity: BaseEntity | UniverseEvent,
    ctx: ValidationContext,
  ): ValidationIssue[] | Promise<ValidationIssue[]>;
}

/**
 * Breakdown of unfixed issues by reason.
 * Note: Issues with clarificationQuestion are NOT included here - they are
 * routed to the clarification system and have a resolution path.
 */
export interface UnfixedIssues {
  /** Issues with medium-confidence fixes (only fixed during repair, not validation) */
  mediumConfidence: ValidationIssue[];
  /** Issues where fix was attempted but failed */
  fixFailed: ValidationIssue[];
  /** Issues that were skipped for other reasons (e.g., entity deleted) */
  skipped: ValidationIssue[];
}

/**
 * Summary statistics for validation/repair results.
 */
export interface IssueSummary {
  /** Total issues found */
  totalFound: number;
  /** Total issues fixed */
  totalFixed: number;
  /** Issues with medium-confidence fixes */
  mediumConfidence: number;
  /** Issues where fix failed */
  fixFailed: number;
  /** Issues that were skipped */
  skipped: number;
}

/**
 * Issues grouped by validator ID.
 */
export interface IssuesByValidator {
  [validatorId: string]: ValidationIssue[];
}

/**
 * Result of validating an entity.
 */
export interface ValidationResult {
  /** The entity ID that was validated */
  entityId: string;
  /** The entity type */
  entityType: EntityType;
  /** Number of issues found */
  issuesFound: number;
  /** Number of issues that were fixed */
  issuesFixed: number;
  /** All issues detected (including unfixed ones) */
  issues: ValidationIssue[];
  /** Issues that were fixed */
  issuesFixedList: ValidationIssue[];
  /** Issues that weren't fixed, grouped by reason */
  issuesUnfixed: UnfixedIssues;
  /** Summary statistics */
  summary: IssueSummary;
  /** Issues grouped by validator ID */
  issuesByValidator: IssuesByValidator;
}

/**
 * Options for the batch validation scanner.
 */
export interface BatchScannerOptions {
  /** Number of entities to process per batch (default: 5) */
  batchSize?: number;
  /** Number of messages between batch runs (default: 10) */
  messageInterval?: number;
}

/**
 * Result of repairing an entity.
 */
export interface RepairResult {
  /** The entity ID that was repaired */
  entityId: string;
  /** The entity type */
  entityType: EntityType;
  /** Number of issues found */
  issuesFound: number;
  /** Number of issues that were fixed */
  issuesFixed: number;
  /** All issues detected (including unfixed ones) */
  issues: ValidationIssue[];
  /** Issues that were fixed */
  issuesFixedList: ValidationIssue[];
  /** Issues that weren't fixed, grouped by reason */
  issuesUnfixed: UnfixedIssues;
  /** Summary statistics */
  summary: IssueSummary;
  /** Issues grouped by validator ID (for compatibility with ValidationResult) */
  issuesByValidator: IssuesByValidator;
}

/**
 * Result of a batch validation run.
 */
export interface BatchResult {
  /** Number of entities checked */
  entitiesChecked: number;
  /** Total issues found across all entities */
  totalIssuesFound: number;
  /** Total issues fixed across all entities */
  totalIssuesFixed: number;
  /** Individual results for each entity */
  results: ValidationResult[];
  /** Aggregated unfixed issues across all entities */
  issuesUnfixed: UnfixedIssues;
  /** Summary statistics across all entities */
  summary: IssueSummary;
  /** Issues grouped by validator ID across all entities */
  issuesByValidator: IssuesByValidator;
}
