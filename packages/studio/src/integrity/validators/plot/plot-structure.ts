/**
 * Plot Structure Validator
 *
 * Validates dramatic structure requirements:
 * - Exactly one climax turning point
 * - At least one inciting_incident turning point
 * - Valid dramatic roles on all turning points
 *
 * Issues generate clarification questions when ambiguous
 * (e.g., multiple climax candidates, no clear inciting incident).
 */

import type {
  PlotValidator,
  PlotValidationContext,
  PlotValidationIssue,
} from '../../plot-validation-types.js';
import {
  createClarificationQuestion,
  generateClarificationId,
} from '@dmnpc/core/clarification/clarification-types.js';
import type { DramaticRole } from '@dmnpc/types/npc';

const VALID_DRAMATIC_ROLES: DramaticRole[] = [
  'inciting_incident',
  'rising_action',
  'crisis',
  'midpoint',
  'climax',
  'resolution',
];

/**
 * Create a clarification question for selecting which turning point should be the climax.
 */
function createClimaxSelectionQuestion(
  plotId: string,
  candidates: Array<{
    id: string;
    dramaticRole: string;
    summary: string;
    progressTarget: number;
  }>,
): PlotValidationIssue['clarificationQuestion'] {
  return createClarificationQuestion({
    id: generateClarificationId('plot-validator', `climax_selection_${plotId}`),
    providerId: 'plot-validator',
    category: 'classification',
    question: 'Which turning point should be the climax?',
    context:
      'A plot must have exactly one climax - the highest point of progress and dramatic resolution. Multiple turning points could serve as the climax.',
    options: candidates.map((tp) => ({
      id: tp.id,
      label: `${tp.id} (${tp.dramaticRole})`,
      description: `${tp.summary} (progress: ${tp.progressTarget})`,
    })),
    freeformAllowed: false,
    confidence: 0.5,
    affectedEntityIds: [plotId],
    resolutionContext: {
      plotId,
      issueType: 'multiple_climax',
      candidateIds: candidates.map((c) => c.id),
    },
  });
}

/**
 * Create a clarification question for selecting which turning point should be inciting_incident.
 */
function createIncitingSelectionQuestion(
  plotId: string,
  candidates: Array<{
    id: string;
    dramaticRole: string;
    summary: string;
    progressTarget: number;
  }>,
): PlotValidationIssue['clarificationQuestion'] {
  return createClarificationQuestion({
    id: generateClarificationId('plot-validator', `inciting_selection_${plotId}`),
    providerId: 'plot-validator',
    category: 'classification',
    question: 'Which turning point should be the inciting incident?',
    context:
      'A plot must have at least one inciting incident - the event that starts the story in motion. Select the turning point that kicks off the narrative.',
    options: candidates.map((tp) => ({
      id: tp.id,
      label: `${tp.id} (${tp.dramaticRole})`,
      description: `${tp.summary} (progress: ${tp.progressTarget})`,
    })),
    freeformAllowed: false,
    confidence: 0.5,
    affectedEntityIds: [plotId],
    resolutionContext: {
      plotId,
      issueType: 'missing_inciting',
      candidateIds: candidates.map((c) => c.id),
    },
  });
}

export const plotStructureValidator: PlotValidator = {
  id: 'plot-structure',
  name: 'Plot Structure Validator',

  validate(ctx: PlotValidationContext): PlotValidationIssue[] {
    const issues: PlotValidationIssue[] = [];
    const { plot } = ctx;
    const turningPoints = plot.turningPoints;

    // Check for valid dramatic roles
    for (const tp of turningPoints) {
      if (!VALID_DRAMATIC_ROLES.includes(tp.dramaticRole)) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'dramaticRole',
          turningPointId: tp.id,
          message: `Turning point "${tp.id}" has invalid dramaticRole: "${tp.dramaticRole}"`,
        });
      }
    }

    // Check for climax
    const climaxTPs = turningPoints.filter((tp) => tp.dramaticRole === 'climax');

    if (climaxTPs.length === 0) {
      // No climax - suggest highest progress TP as candidate
      if (turningPoints.length > 0) {
        const candidates = [...turningPoints]
          .sort((a, b) => b.progressTarget - a.progressTarget)
          .slice(0, 3);

        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'turningPoints',
          message: 'Plot must have exactly one turning point with dramaticRole "climax"',
          clarificationQuestion: createIncitingSelectionQuestion(
            plot.id,
            candidates.map((tp) => ({
              id: tp.id,
              dramaticRole: tp.dramaticRole,
              summary: tp.essentialInformation.slice(0, 2).join('; ') || 'No information',
              progressTarget: tp.progressTarget,
            })),
          ),
        });
      } else {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'turningPoints',
          message: 'Plot has no turning points - cannot determine climax',
        });
      }
    } else if (climaxTPs.length > 1) {
      // Multiple climax - need clarification
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'turningPoints',
        message: `Plot has ${climaxTPs.length} climax turning points, should have exactly 1`,
        clarificationQuestion: createClimaxSelectionQuestion(
          plot.id,
          climaxTPs.map((tp) => ({
            id: tp.id,
            dramaticRole: tp.dramaticRole,
            summary: tp.essentialInformation.slice(0, 2).join('; ') || 'No information',
            progressTarget: tp.progressTarget,
          })),
        ),
      });
    }

    // Check for inciting incident
    const incitingTPs = turningPoints.filter((tp) => tp.dramaticRole === 'inciting_incident');

    if (incitingTPs.length === 0 && turningPoints.length > 0) {
      // No inciting incident - suggest lowest progress non-climax TPs
      const nonClimaxTPs = turningPoints.filter((tp) => tp.dramaticRole !== 'climax');
      const candidates = [...nonClimaxTPs]
        .sort((a, b) => a.progressTarget - b.progressTarget)
        .slice(0, 3);

      if (candidates.length > 0) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'turningPoints',
          message:
            'Plot must have at least one turning point with dramaticRole "inciting_incident"',
          clarificationQuestion: createIncitingSelectionQuestion(
            plot.id,
            candidates.map((tp) => ({
              id: tp.id,
              dramaticRole: tp.dramaticRole,
              summary: tp.essentialInformation.slice(0, 2).join('; ') || 'No information',
              progressTarget: tp.progressTarget,
            })),
          ),
        });
      }
    }

    // Check for inciting incidents without essentialInformation
    for (const tp of incitingTPs) {
      if (tp.essentialInformation.length === 0) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'essentialInformation',
          turningPointId: tp.id,
          message: `Inciting incident "${tp.id}" has no essentialInformation - player may not understand the quest premise`,
        });
      }
    }

    // Check for duplicate turning point IDs
    const tpIds = turningPoints.map((tp) => tp.id);
    const duplicateTpIds = tpIds.filter((id, idx) => tpIds.indexOf(id) !== idx);
    for (const dupId of [...new Set(duplicateTpIds)]) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'turningPoints',
        message: `Duplicate turning point ID: "${dupId}"`,
      });
    }

    // Check for duplicate goal IDs (goals are now at plan level)
    const allGoalIds = plot.goals.map((g) => g.id);
    const duplicateGoalIds = allGoalIds.filter((id, idx) => allGoalIds.indexOf(id) !== idx);
    for (const dupId of [...new Set(duplicateGoalIds)]) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'goals',
        message: `Duplicate goal ID: "${dupId}"`,
      });
    }

    return issues;
  },

  repair(ctx: PlotValidationContext, issues: PlotValidationIssue[]): PlotValidationIssue[] {
    const fixed: PlotValidationIssue[] = [];
    const { plot } = ctx;

    for (const issue of issues) {
      // Can only auto-fix invalid dramatic roles by setting to a sensible default
      if (issue.field === 'dramaticRole' && issue.turningPointId) {
        const tp = plot.turningPoints.find((t) => t.id === issue.turningPointId);
        if (tp) {
          // Default to rising_action as a safe middle-ground
          tp.dramaticRole = 'rising_action';
          fixed.push(issue);
        }
      }
    }

    return fixed;
  },
};
