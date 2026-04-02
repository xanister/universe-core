/**
 * Plot Descriptions Validator
 *
 * Validates that turning points have essentialInformation defined.
 * essentialInformation is the primary driver of turning points:
 * - Defines WHAT the player must learn (the contract)
 * - Must be abstract and player-centric (not character-specific delivery)
 * - Scene context is derived from dramaticRole + involvedCharacter + essentialInformation
 */

import type {
  PlotValidator,
  PlotValidationContext,
  PlotValidationIssue,
} from '../../plot-validation-types.js';

export const plotDescriptionsValidator: PlotValidator = {
  id: 'plot-descriptions',
  name: 'Plot Essential Information Validator',

  validate(ctx: PlotValidationContext): PlotValidationIssue[] {
    const issues: PlotValidationIssue[] = [];
    const { plot } = ctx;
    const turningPoints = plot.turningPoints;

    for (const tp of turningPoints) {
      // Check for missing essentialInformation (the primary driver)
      if (tp.essentialInformation.length === 0) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'essentialInformation',
          turningPointId: tp.id,
          message: `Turning point "${tp.id}" has no essentialInformation - this is the primary driver of turning points`,
        });
        continue;
      }

      // Check essentialInformation count - must be 1-3 items for all turning points
      const count = tp.essentialInformation.length;
      if (count > 3) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'essentialInformation',
          turningPointId: tp.id,
          message: `Turning point "${tp.id}" has ${count} essentialInformation items - maximum is 3`,
        });
      }
    }

    return issues;
  },

  /**
   * No automatic repairs for essentialInformation - requires human review.
   */
  repair(_ctx: PlotValidationContext, _issues: PlotValidationIssue[]): PlotValidationIssue[] {
    // essentialInformation issues require human review - cannot auto-repair
    return [];
  },
};
