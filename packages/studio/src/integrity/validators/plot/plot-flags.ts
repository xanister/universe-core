/**
 * Plot Flags Validator
 *
 * Validates flag usage and naming:
 * - Ending card flags must be achievable (exist in goals)
 * - Goal flags must exist in possibleFlags
 * - Flags should use affirmative naming (not "not_", "failed_", etc.)
 * - Orphaned flags in possibleFlags (defined but never used)
 *
 * Issues generate clarification questions for flag naming and routing.
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
import { validateFlagNames } from '@dmnpc/core/stores/plot-utils.js';

/**
 * Patterns that indicate negative flag naming.
 */
const NEGATIVE_PATTERNS = [
  /^not_/i,
  /^failed_/i,
  /^didnt_/i,
  /^didnot_/i,
  /^did_not_/i,
  /^never_/i,
  /^no_/i,
  /_not_/i,
  /_failed$/i,
];

/**
 * Check if a flag name is negative (describes what didn't happen).
 */
function isNegativeFlag(flagId: string): boolean {
  return NEGATIVE_PATTERNS.some((pattern) => pattern.test(flagId));
}

/**
 * Suggest an affirmative version of a negative flag.
 */
function suggestAffirmativeFlag(flagId: string): string {
  // Common transformations
  let suggestion = flagId
    .replace(/^not_/i, '')
    .replace(/^failed_/i, '')
    .replace(/^didnt_/i, '')
    .replace(/^didnot_/i, '')
    .replace(/^did_not_/i, '')
    .replace(/^never_/i, '')
    .replace(/^no_/i, '')
    .replace(/_not_/i, '_')
    .replace(/_failed$/i, '_lost');

  // If nothing changed, just remove common prefixes
  if (suggestion === flagId) {
    suggestion = flagId.replace(/^(not|failed|never|no)_?/i, '');
  }

  // Ensure we have something
  if (!suggestion || suggestion === flagId) {
    suggestion = `${flagId}_happened`;
  }

  return suggestion;
}

/**
 * Create a clarification question for renaming a negative flag.
 */
function createFlagRenamingQuestion(
  plotId: string,
  flagId: string,
  suggestion: string,
): PlotValidationIssue['clarificationQuestion'] {
  return createClarificationQuestion({
    // Put flagId first to ensure uniqueness
    id: generateClarificationId('plot-validator', `rename_${flagId}_${plotId}`),
    providerId: 'plot-validator',
    category: 'attribute',
    question: `How should the flag "${flagId}" be renamed?`,
    context:
      'Flags should use affirmative naming - describe what happened, not what didn\'t. For example, use "merchant_died" instead of "not_saved_merchant".',
    options: [
      {
        id: 'suggested',
        label: suggestion,
        description: 'Use the suggested affirmative name',
      },
      {
        id: 'keep',
        label: flagId,
        description: 'Keep the current name (not recommended)',
      },
    ],
    freeformAllowed: true,
    confidence: 0.6,
    currentGuess: suggestion,
    affectedEntityIds: [plotId],
    resolutionContext: {
      plotId,
      issueType: 'negative_flag',
      flagId,
      suggestedName: suggestion,
    },
  });
}

/**
 * Create a clarification question for routing an unreachable ending card flag.
 * Goals set flags (via successFlags/failureFlags), not turning points directly.
 * The turning point selection determines which dramatic moment's goals should include this flag.
 */
function createFlagRoutingQuestion(
  plotId: string,
  flagId: string,
  turningPointOptions: Array<{
    id: string;
    dramaticRole: string;
    summary: string;
  }>,
): PlotValidationIssue['clarificationQuestion'] {
  return createClarificationQuestion({
    // Put flagId first to ensure uniqueness
    id: generateClarificationId('plot-validator', `route_${flagId}_${plotId}`),
    providerId: 'plot-validator',
    category: 'relationship',
    question: `Which dramatic moment should have a goal that sets the flag "${flagId}"?`,
    context: `The ending card requires flag "${flagId}" but no goal's successFlags or failureFlags includes it. Select which turning point should have a goal added that can set this flag.`,
    options: turningPointOptions.map((tp) => ({
      id: tp.id,
      label: `${tp.id} (${tp.dramaticRole})`,
      description: tp.summary,
    })),
    freeformAllowed: false,
    confidence: 0.4,
    affectedEntityIds: [plotId],
    resolutionContext: {
      plotId,
      issueType: 'unreachable_ending_flag',
      flagId,
      turningPointIds: turningPointOptions.map((tp) => tp.id),
    },
  });
}

/**
 * Create a clarification question for orphaned flags (root-level possibleFlags).
 */
function createOrphanedFlagQuestionRoot(
  plotId: string,
  flagId: string,
): PlotValidationIssue['clarificationQuestion'] {
  return createClarificationQuestion({
    // Put flagId first to ensure uniqueness (plotId can be long and get truncated)
    id: generateClarificationId('plot-validator', `orphan_${flagId}_${plotId}`),
    providerId: 'plot-validator',
    category: 'attribute',
    question: `Should the unused flag "${flagId}" be removed?`,
    context: `The flag "${flagId}" is defined in possibleFlags but is never referenced by any goal or ending card.`,
    options: [
      {
        id: 'delete',
        label: 'Delete the flag',
        description: 'Remove this unused flag from possibleFlags',
      },
      {
        id: 'keep',
        label: 'Keep the flag',
        description: 'The flag may be used in the future',
      },
    ],
    freeformAllowed: false,
    confidence: 0.7,
    currentGuess: 'delete',
    affectedEntityIds: [plotId],
    resolutionContext: {
      plotId,
      issueType: 'orphaned_flag',
      flagId,
    },
  });
}

export const plotFlagsValidator: PlotValidator = {
  id: 'plot-flags',
  name: 'Plot Flags Validator',

  validate(ctx: PlotValidationContext): PlotValidationIssue[] {
    const issues: PlotValidationIssue[] = [];
    const { plot, possibleFlagIds, goalFlagIds, endingCardFlagIds } = ctx;
    const turningPoints = plot.turningPoints;

    // Check ending card flags are achievable
    for (let i = 0; i < plot.endingCards.length; i++) {
      const card = plot.endingCards[i];
      const flag = card.condition.flag;

      if (card.condition.type === 'flag_set' && flag && !goalFlagIds.has(flag)) {
        // Flag required but no goal can set it
        const tpOptions = turningPoints
          .filter((tp) => tp.dramaticRole === 'climax' || tp.dramaticRole === 'crisis')
          .slice(0, 5);

        if (tpOptions.length === 0 && turningPoints.length > 0) {
          // Use highest progress TPs as fallback
          tpOptions.push(
            ...[...turningPoints].sort((a, b) => b.progressTarget - a.progressTarget).slice(0, 3),
          );
        }

        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'endingCards',
          message: `Ending card ${i} "${card.title ?? 'untitled'}" requires flag "${flag}" but no goal can set it`,
          clarificationQuestion:
            tpOptions.length > 0
              ? createFlagRoutingQuestion(
                  plot.id,
                  flag,
                  tpOptions.map((tp) => ({
                    id: tp.id,
                    dramaticRole: tp.dramaticRole,
                    summary: tp.essentialInformation.slice(0, 2).join('; ') || 'No information',
                  })),
                )
              : undefined,
        });
      }
    }

    // Check goal flags exist in root-level possibleFlags
    for (const goal of plot.goals) {
      // Check revealOnFlags
      for (const flag of goal.revealOnFlags) {
        if (!possibleFlagIds.has(flag)) {
          issues.push({
            plotId: plot.id,
            validatorId: this.id,
            severity: 'error',
            field: 'revealOnFlags',
            goalId: goal.id,
            message: `Goal "${goal.id}" revealOnFlags references flag "${flag}" not in possibleFlags`,
          });
        }
      }

      // Check successFlags
      for (const flag of goal.successFlags ?? []) {
        if (!possibleFlagIds.has(flag)) {
          issues.push({
            plotId: plot.id,
            validatorId: this.id,
            severity: 'error',
            field: 'successFlags',
            goalId: goal.id,
            message: `Goal "${goal.id}" successFlags references flag "${flag}" not in possibleFlags`,
          });
        }
      }

      // Check failureFlags
      for (const flag of goal.failureFlags ?? []) {
        if (!possibleFlagIds.has(flag)) {
          issues.push({
            plotId: plot.id,
            validatorId: this.id,
            severity: 'error',
            field: 'failureFlags',
            goalId: goal.id,
            message: `Goal "${goal.id}" failureFlags references flag "${flag}" not in possibleFlags`,
          });
        }
      }

      // Check blockedByFlags - these must also exist in possibleFlags
      for (const flag of goal.blockedByFlags ?? []) {
        if (!possibleFlagIds.has(flag)) {
          issues.push({
            plotId: plot.id,
            validatorId: this.id,
            severity: 'error',
            field: 'blockedByFlags',
            goalId: goal.id,
            message: `Goal "${goal.id}" blockedByFlags references flag "${flag}" not in possibleFlags`,
          });
        }
      }
    }

    // Check for negative flag naming
    const { blockedByFlagIds } = ctx;
    const allFlagIds = new Set([...possibleFlagIds, ...goalFlagIds, ...blockedByFlagIds]);
    for (const flagId of allFlagIds) {
      if (isNegativeFlag(flagId)) {
        const suggestion = suggestAffirmativeFlag(flagId);
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'flags',
          message: `Flag "${flagId}" uses negative naming - consider renaming to "${suggestion}"`,
          clarificationQuestion: createFlagRenamingQuestion(plot.id, flagId, suggestion),
        });
      }
    }

    // Use existing flag validation for additional checks
    const flagArray = Array.from(allFlagIds);
    const flagValidation = validateFlagNames(flagArray);
    if (!flagValidation.valid) {
      for (const warning of flagValidation.warnings) {
        // Avoid duplicate warnings for things we already caught
        if (!issues.some((i) => i.message.includes(warning.split(':')[0]))) {
          issues.push({
            plotId: plot.id,
            validatorId: this.id,
            severity: 'warning',
            field: 'flags',
            message: warning,
          });
        }
      }
    }

    // Check for orphaned flags (defined but never used)
    const usedFlags = new Set([...goalFlagIds, ...endingCardFlagIds]);
    for (const flagDef of plot.possibleFlags) {
      if (!usedFlags.has(flagDef.id)) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'info',
          field: 'possibleFlags',
          message: `Flag "${flagDef.id}" is defined but never used by any goal or ending card`,
          clarificationQuestion: createOrphanedFlagQuestionRoot(plot.id, flagDef.id),
        });
      }
    }

    // Check for duplicate flag IDs in possibleFlags
    const flagIds = plot.possibleFlags.map((f) => f.id);
    const duplicateFlags = flagIds.filter((id, idx) => flagIds.indexOf(id) !== idx);
    for (const dupId of [...new Set(duplicateFlags)]) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'possibleFlags',
        message: `Plot has duplicate flag ID: "${dupId}"`,
        suggestedFix: {
          field: 'possibleFlags',
          value: { flagId: dupId, action: 'dedupe' },
          confidence: 'high',
          method: 'deterministic',
        },
      });
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
      const value = fix.value;
      if (
        typeof value !== 'object' ||
        value === null ||
        !('flagId' in value) ||
        typeof value.flagId !== 'string' ||
        !('action' in value) ||
        typeof value.action !== 'string'
      ) {
        continue;
      }

      if (fix.method === 'deterministic' && value.action === 'add') {
        // Add missing flag to root-level possibleFlags
        const exists = plot.possibleFlags.some((f) => f.id === value.flagId);
        if (!exists) {
          plot.possibleFlags.push({
            id: value.flagId,
            triggerDescription: `Set when ${value.flagId.replace(/_/g, ' ')} condition is met`,
          });
          fixed.push(issue);
        }
      } else if (fix.method === 'deterministic' && value.action === 'dedupe') {
        // Remove duplicate flags from root-level possibleFlags
        const seen = new Set<string>();
        plot.possibleFlags = plot.possibleFlags.filter((f) => {
          if (seen.has(f.id)) {
            return false;
          }
          seen.add(f.id);
          return true;
        });
        fixed.push(issue);
      }
    }

    return fixed;
  },
};
