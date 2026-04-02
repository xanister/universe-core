/**
 * Plot Validation Types
 *
 * Types and interfaces for the plot validation and repair system.
 * Follows patterns from entity integrity-types.ts but adapted for plot definitions.
 */

import type { PlotDefinition, PlotTurningPoint, PlotGoal } from '@dmnpc/types/npc';
import type { ClarificationQuestion } from '@dmnpc/core/clarification/clarification-types.js';

/**
 * Severity levels for plot validation issues.
 */
export type PlotIssueSeverity = 'error' | 'warning' | 'info';

/**
 * Confidence level for suggested fixes.
 * - 'high': Safe to auto-apply (deterministic fix)
 * - 'medium': Requires manual review
 */
type PlotFixConfidence = 'high' | 'medium';

/**
 * Repair method for fixing a plot issue.
 * - 'deterministic': Rule-based fix (set value, add missing item)
 * - 'delete': Remove the problematic item
 * - 'rename': Rename an identifier
 */
type PlotRepairMethod = 'deterministic' | 'delete' | 'rename';

/**
 * A suggested fix for a plot validation issue.
 */
export interface PlotSuggestedFix {
  /** The field or path to fix */
  field: string;
  /** The suggested value or action */
  value: unknown;
  /** Confidence level - only 'high' confidence fixes are auto-applied */
  confidence: PlotFixConfidence;
  /** The repair method to use */
  method: PlotRepairMethod;
}

/**
 * A validation issue detected by a plot validator.
 */
export interface PlotValidationIssue {
  /** The plot ID with the issue */
  plotId: string;
  /** The validator that detected this issue */
  validatorId: string;
  /** Severity of the issue */
  severity: PlotIssueSeverity;
  /** The field with the issue (if applicable) */
  field?: string;
  /** Turning point ID if issue is TP-specific */
  turningPointId?: string;
  /** Goal ID if issue is goal-specific */
  goalId?: string;
  /** Human-readable description of the issue */
  message: string;
  /** Suggested fix (if available) */
  suggestedFix?: PlotSuggestedFix;
  /**
   * If this issue requires user clarification before a confident fix can be made.
   * When present, the issue won't be auto-fixed until the question is answered.
   */
  clarificationQuestion?: ClarificationQuestion;
}

/**
 * Breakdown of unfixed issues by reason.
 */
export interface PlotUnfixedIssues {
  /** Issues with medium-confidence fixes (only fixed during repair, not validation) */
  mediumConfidence: PlotValidationIssue[];
  /** Issues where fix was attempted but failed */
  fixFailed: PlotValidationIssue[];
  /** Issues that require clarification */
  needsClarification: PlotValidationIssue[];
}

/**
 * Summary statistics for plot validation/repair results.
 */
export interface PlotIssueSummary {
  /** Total issues found */
  totalFound: number;
  /** Total issues fixed */
  totalFixed: number;
  /** Issues with medium-confidence fixes */
  mediumConfidence: number;
  /** Issues where fix failed */
  fixFailed: number;
  /** Issues needing clarification */
  needsClarification: number;
}

/**
 * Issues grouped by validator ID.
 */
export interface PlotIssuesByValidator {
  [validatorId: string]: PlotValidationIssue[];
}

/**
 * Result of validating a plot.
 */
export interface PlotValidationResult {
  /** The plot ID that was validated */
  plotId: string;
  /** Number of issues found */
  issuesFound: number;
  /** Number of issues that were fixed */
  issuesFixed: number;
  /** All issues detected (including unfixed ones) */
  issues: PlotValidationIssue[];
  /** Issues that were fixed */
  issuesFixedList: PlotValidationIssue[];
  /** Issues that weren't fixed, grouped by reason */
  issuesUnfixed: PlotUnfixedIssues;
  /** Summary statistics */
  summary: PlotIssueSummary;
  /** Issues grouped by validator ID */
  issuesByValidator: PlotIssuesByValidator;
  /** The repaired plot (if repair was requested and changes were made) */
  repairedPlot?: PlotDefinition;
}

/**
 * Result of validating multiple plots.
 */
export interface PlotBatchValidationResult {
  /** Number of plots checked */
  plotsChecked: number;
  /** Total issues found across all plots */
  totalIssuesFound: number;
  /** Total issues fixed across all plots */
  totalIssuesFixed: number;
  /** Individual results for each plot */
  results: PlotValidationResult[];
  /** Aggregated summary statistics */
  summary: PlotIssueSummary;
}

/**
 * Context provided to plot validators.
 */
export interface PlotValidationContext {
  /** The plot being validated */
  plot: PlotDefinition;
  /** All turning points for quick lookup */
  turningPointsById: Map<string, PlotTurningPoint>;
  /** All goals for quick lookup (goals are at plan level) */
  goalsById: Map<string, PlotGoal>;
  /** All possible flag IDs defined in possibleFlags */
  possibleFlagIds: Set<string>;
  /** All flag IDs referenced in goals (successFlags + failureFlags + revealOnFlags) */
  goalFlagIds: Set<string>;
  /** All flag IDs referenced in goal blockedByFlags */
  blockedByFlagIds: Set<string>;
  /** All flag IDs referenced in ending card conditions */
  endingCardFlagIds: Set<string>;
}

/**
 * Interface for a plot validator module.
 */
export interface PlotValidator {
  /** Unique identifier for this validator */
  id: string;
  /** Human-readable name */
  name: string;
  /**
   * Validate a plot and return any issues found.
   * May be async to allow LLM-assisted validation (e.g., generating suggested fixes).
   * @param ctx - Plot validation context
   * @returns Array of validation issues (empty if no issues)
   */
  validate(ctx: PlotValidationContext): PlotValidationIssue[] | Promise<PlotValidationIssue[]>;
  /**
   * Attempt to repair issues found by this validator.
   * Mutates the plot in place.
   * @param ctx - Plot validation context
   * @param issues - Issues to repair (from this validator only)
   * @returns Array of issues that were successfully fixed
   */
  repair?(
    ctx: PlotValidationContext,
    issues: PlotValidationIssue[],
  ): PlotValidationIssue[] | Promise<PlotValidationIssue[]>;
}

/**
 * Build a validation context from a plot definition.
 */
export function buildPlotValidationContext(plot: PlotDefinition): PlotValidationContext {
  const turningPointsById = new Map<string, PlotTurningPoint>();
  const goalsById = new Map<string, PlotGoal>();
  const possibleFlagIds = new Set<string>();
  const goalFlagIds = new Set<string>();
  const blockedByFlagIds = new Set<string>();
  const endingCardFlagIds = new Set<string>();

  // Index turning points
  for (const tp of plot.turningPoints) {
    turningPointsById.set(tp.id, tp);
  }

  // Collect possibleFlags from root level
  for (const flagDef of plot.possibleFlags) {
    possibleFlagIds.add(flagDef.id);
  }

  // Index goals and collect goal flags (goals are at plan level)
  for (const goal of plot.goals) {
    goalsById.set(goal.id, goal);
    // Collect revealOnFlags
    for (const flag of goal.revealOnFlags) {
      goalFlagIds.add(flag);
    }
    for (const flag of goal.successFlags ?? []) {
      goalFlagIds.add(flag);
    }
    for (const flag of goal.failureFlags ?? []) {
      goalFlagIds.add(flag);
    }
    // Collect blockedByFlags
    for (const flag of goal.blockedByFlags ?? []) {
      blockedByFlagIds.add(flag);
    }
  }

  // Collect ending card flags
  for (const card of plot.endingCards) {
    if (card.condition.flag) {
      endingCardFlagIds.add(card.condition.flag);
    }
  }

  return {
    plot,
    turningPointsById,
    goalsById,
    possibleFlagIds,
    goalFlagIds,
    blockedByFlagIds,
    endingCardFlagIds,
  };
}

/**
 * Create an empty unfixed issues object.
 */
export function createEmptyUnfixedIssues(): PlotUnfixedIssues {
  return {
    mediumConfidence: [],
    fixFailed: [],
    needsClarification: [],
  };
}
