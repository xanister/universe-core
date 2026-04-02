/**
 * Plot Progress Validator
 *
 * Validates story progress-related requirements with auto-repair:
 * - inciting_incident must have progressTarget = 0
 * - Turning points should be sorted by progressTarget (ascending)
 *
 * Note: Resolution having higher progressTarget than climax is CORRECT behavior.
 * progressTarget represents "when in the story this triggers" (sequence), not dramatic intensity.
 * Resolution happens AFTER climax, so it should have a higher progressTarget.
 *
 * All issues from this validator can be auto-repaired.
 */

import type {
  PlotValidator,
  PlotValidationContext,
  PlotValidationIssue,
} from '../../plot-validation-types.js';

export const plotProgressValidator: PlotValidator = {
  id: 'plot-progress',
  name: 'Plot Progress Validator',

  validate(ctx: PlotValidationContext): PlotValidationIssue[] {
    const issues: PlotValidationIssue[] = [];
    const { plot } = ctx;
    const turningPoints = plot.turningPoints;

    // Check inciting_incident progressTarget = 0
    for (const tp of turningPoints) {
      if (tp.dramaticRole === 'inciting_incident' && tp.progressTarget !== 0) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'progressTarget',
          turningPointId: tp.id,
          message: `Turning point "${tp.id}" with dramaticRole "inciting_incident" must have progressTarget 0, but has ${tp.progressTarget}`,
          suggestedFix: {
            field: `turningPoints.${tp.id}.progressTarget`,
            value: 0,
            confidence: 'high',
            method: 'deterministic',
          },
        });
      }
    }

    // Check if turning points are sorted by progressTarget
    if (turningPoints.length > 1) {
      const isSorted = turningPoints.every((tp, idx) => {
        if (idx === 0) return true;
        return tp.progressTarget >= turningPoints[idx - 1].progressTarget;
      });

      if (!isSorted) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'turningPoints',
          message: 'Turning points are not sorted by progressTarget (ascending)',
          suggestedFix: {
            field: 'turningPoints',
            value: 'sort',
            confidence: 'high',
            method: 'deterministic',
          },
        });
      }
    }

    // Check for reasonable progress values
    const nonIncitingTPs = turningPoints.filter((tp) => tp.dramaticRole !== 'inciting_incident');

    for (const tp of nonIncitingTPs) {
      if (tp.progressTarget === 0 && tp.dramaticRole !== 'resolution') {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'progressTarget',
          turningPointId: tp.id,
          message: `Non-inciting turning point "${tp.id}" has progressTarget 0 - consider increasing for dramatic progression`,
        });
      }
    }

    return issues;
  },

  repair(ctx: PlotValidationContext, issues: PlotValidationIssue[]): PlotValidationIssue[] {
    const fixed: PlotValidationIssue[] = [];
    const { plot } = ctx;

    for (const issue of issues) {
      if (!issue.suggestedFix || issue.suggestedFix.confidence !== 'high') {
        continue;
      }

      const fix = issue.suggestedFix;

      if (fix.field.includes('progressTarget') && issue.turningPointId) {
        // Fix inciting_incident progressTarget
        const tp = plot.turningPoints.find((t) => t.id === issue.turningPointId);
        if (tp && typeof fix.value === 'number') {
          tp.progressTarget = fix.value;
          fixed.push(issue);
        }
      } else if (fix.field === 'turningPoints' && fix.value === 'sort') {
        // Sort turning points by progressTarget
        if (plot.turningPoints.length > 1) {
          plot.turningPoints.sort((a, b) => a.progressTarget - b.progressTarget);
          fixed.push(issue);
        }
      }
    }

    return fixed;
  },
};
