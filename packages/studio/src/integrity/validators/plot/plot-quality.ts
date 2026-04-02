/**
 * Plot Quality Validator
 *
 * Validates narrative quality (not just structure) using shared heuristics.
 * This is a thin adapter that calls the shared plot-quality-heuristics module
 * and maps the results to PlotValidationIssue format.
 *
 * Checks performed:
 * - Stakes clarity: At least one goal has stakes defined
 * - Escalation: Turning points increase in dramatic intensity
 * - Branching presence: Mutually exclusive goals for player agency
 * - Breadcrumb coverage: short_term/long_term goals have immediateHint or linked immediate goals
 * - Twist presence: Climax has substantive revelation
 * - Goal type usage: Consistent use of goalType field
 * - Player-focused information: essentialInformation describes player experience
 *
 * All logic lives in shared/plot-quality-heuristics.ts to avoid duplication
 * with plot-agent.ts validation loops.
 */

import type {
  PlotValidator,
  PlotValidationContext,
  PlotValidationIssue,
  PlotIssueSeverity,
} from '../../plot-validation-types.js';
import {
  type QualityIssue,
  type QualityIssueSeverity,
  checkPlotQuality,
} from '@dmnpc/core/plot-quality-heuristics.js';

/**
 * Map QualityIssueSeverity to PlotIssueSeverity.
 * They're currently identical but this provides a layer of indirection.
 */
function mapSeverity(severity: QualityIssueSeverity): PlotIssueSeverity {
  return severity;
}

/**
 * Convert a QualityIssue to a PlotValidationIssue.
 */
function toValidationIssue(
  plotId: string,
  validatorId: string,
  issue: QualityIssue,
): PlotValidationIssue {
  return {
    plotId,
    validatorId,
    severity: mapSeverity(issue.severity),
    field: issue.field,
    goalId: issue.goalId,
    turningPointId: issue.turningPointId,
    message: issue.message,
    // Quality issues don't have auto-fixes - they require human judgment
    // But we can provide guidance via the message and suggestion
  };
}

export const plotQualityValidator: PlotValidator = {
  id: 'plot-quality',
  name: 'Plot Quality Validator',

  validate(ctx: PlotValidationContext): PlotValidationIssue[] {
    const { plot } = ctx;

    // Run shared quality heuristics
    const result = checkPlotQuality({
      goals: plot.goals,
      turningPoints: plot.turningPoints,
      possibleFlags: plot.possibleFlags,
    });

    // Convert QualityIssue[] to PlotValidationIssue[]
    return result.issues.map((issue) => toValidationIssue(plot.id, this.id, issue));
  },

  // No repair method - quality issues require human judgment to fix properly.
  // The shared heuristics provide suggestions in the issue messages.
};
