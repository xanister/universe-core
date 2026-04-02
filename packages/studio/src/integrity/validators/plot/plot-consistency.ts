/**
 * Plot Consistency Validator
 *
 * Validates internal consistency with auto-repair:
 * - Required fields are present
 * - IDs follow naming conventions
 * - Ending cards have valid condition types
 * - Credits structure is valid
 *
 * Most issues from this validator can be auto-repaired.
 */

import type {
  PlotValidator,
  PlotValidationContext,
  PlotValidationIssue,
} from '../../plot-validation-types.js';

/**
 * Detects if a name looks like a generic role-based description rather than a proper noun.
 * Generic names should use `matchHint` instead of `name`.
 *
 * Examples of generic names:
 * - "The Passage Broker" (starts with "The ")
 * - "A Mysterious Stranger" (starts with "A ")
 * - "distant ancient fort" (starts with lowercase, contains "distant")
 *
 * Examples of proper names:
 * - "Marcus Vale"
 * - "Fort Kharos"
 * - "Whispering Wyvern Inn"
 */
function looksLikeGenericName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('the ') ||
    lower.startsWith('a ') ||
    lower.startsWith('an ') ||
    /^[a-z]/.test(name) || // starts with lowercase letter
    /\b(distant|nearby|hidden|secret|old|ancient|abandoned|mysterious|unknown)\b/i.test(name)
  );
}

export const plotConsistencyValidator: PlotValidator = {
  id: 'plot-consistency',
  name: 'Plot Consistency Validator',

  validate(ctx: PlotValidationContext): PlotValidationIssue[] {
    const issues: PlotValidationIssue[] = [];
    const { plot } = ctx;

    // Check required fields
    if (!plot.id) {
      issues.push({
        plotId: plot.id || 'unknown',
        validatorId: this.id,
        severity: 'error',
        field: 'id',
        message: 'Plot is missing required field: id',
      });
    } else if (!plot.id.startsWith('PLOT_')) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'id',
        message: `Plot ID "${plot.id}" must start with "PLOT_"`,
      });
    }

    if (!plot.label) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'label',
        message: 'Plot is missing required field: label',
      });
    }

    if (!plot.description) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'description',
        message: 'Plot is missing required field: description',
      });
    }

    if (!plot.plot) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'error',
        field: 'plot',
        message: 'Plot is missing required field: plot (story summary)',
      });
    }

    // Check turning points have required fields
    for (const tp of plot.turningPoints) {
      if (!tp.id) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'turningPoints',
          message: 'Turning point is missing required field: id',
        });
      }

      // essentialInformation is the primary driver - validated by plot-descriptions.ts

      // progressTarget and dramaticRole are required by the type system
    }

    // Check root-level possibleFlags have required fields
    for (const flagDef of plot.possibleFlags) {
      if (!flagDef.id) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'possibleFlags',
          message: 'Flag definition is missing required field: id',
        });
      }

      if (!flagDef.triggerDescription) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'triggerDescription',
          message: `Flag "${flagDef.id}" is missing triggerDescription`,
          suggestedFix: {
            field: `possibleFlags.${flagDef.id}.triggerDescription`,
            value: `Set when ${flagDef.id.replace(/_/g, ' ')} condition is met`,
            confidence: 'high',
            method: 'deterministic',
          },
        });
      }
    }

    // Check goals have required fields (goals are at plan level)
    for (const goal of plot.goals) {
      if (!goal.id) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'goals',
          message: 'Goal is missing required field: id',
        });
      }

      if (!goal.description) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'description',
          goalId: goal.id,
          message: `Goal "${goal.id}" is missing description`,
        });
      }

      // progressBoost is required by the type system

      // Note: revealOnFlags is required by TypeScript types and LLM schema.
      // Empty revealOnFlags: [] is valid - it means the goal is instantly visible at plot start.

      // Check destinationPlaceId references a valid place in places array
      if (goal.destinationPlaceId) {
        const placeExists = plot.places.some((p) => p.placeId === goal.destinationPlaceId);
        if (!placeExists) {
          issues.push({
            plotId: plot.id,
            validatorId: this.id,
            severity: 'error',
            field: 'destinationPlaceId',
            goalId: goal.id,
            message: `Goal "${goal.id}" destinationPlaceId "${goal.destinationPlaceId}" does not match any place in places array`,
          });
        }
      }
    }

    // Check ending cards have valid conditions
    for (let i = 0; i < plot.endingCards.length; i++) {
      const card = plot.endingCards[i];

      const validConditionTypes = ['flag_set', 'flag_not_set', 'always'];
      if (!validConditionTypes.includes(card.condition.type)) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'endingCards',
          message: `Ending card ${i} has invalid condition type: "${card.condition.type}"`,
        });
      }

      if (card.condition.type !== 'always' && !card.condition.flag) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'endingCards',
          message: `Ending card ${i} with condition type "${card.condition.type}" is missing flag`,
        });
      }

      if (!card.text) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'endingCards',
          message: `Ending card ${i} is missing text`,
        });
      }
    }

    // Check for at least one "always" ending card
    const hasAlwaysCard = plot.endingCards.some((card) => card.condition.type === 'always');
    if (!hasAlwaysCard && plot.endingCards.length > 0) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'warning',
        field: 'endingCards',
        message:
          'Plot has no "always" ending card - consider adding one as a fallback that always displays',
      });
    }

    // Check credits structure
    if (!plot.credits.title) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'warning',
        field: 'credits',
        message: 'Credits is missing title',
        suggestedFix: {
          field: 'credits.title',
          value: plot.label || 'The End',
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }

    if (plot.credits.entries.length === 0) {
      issues.push({
        plotId: plot.id,
        validatorId: this.id,
        severity: 'info',
        field: 'credits',
        message: 'Credits has no entries',
      });
    }

    // Check characters have required fields (name OR matchHint)
    for (let i = 0; i < plot.characters.length; i++) {
      const char = plot.characters[i];
      const charIdentifier = char.name || char.matchHint || `index ${i}`;

      // Must have at least name or matchHint
      if (!char.name && !char.matchHint) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'characters',
          message: `Character at index ${i} is missing both name and matchHint (at least one is required)`,
        });
      }

      // Warn if name looks generic (should be matchHint instead)
      if (char.name && looksLikeGenericName(char.name)) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'characters',
          message: `Character "${char.name}" has a generic role-based name - should use matchHint instead of name`,
          suggestedFix: {
            field: `characters.${i}.name->matchHint`,
            value: char.name,
            confidence: 'high',
            method: 'rename',
          },
        });
      }

      if (!char.role) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'warning',
          field: 'characters',
          message: `Character "${charIdentifier}" is missing role`,
        });
      }
    }

    // Check places have required fields (placeId and storyRole)
    for (let i = 0; i < plot.places.length; i++) {
      const place = plot.places[i];

      // Must have placeId
      if (!place.placeId) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'places',
          message: `Place at index ${i} is missing placeId`,
        });
      }

      // Must have storyRole
      if (!place.storyRole) {
        issues.push({
          plotId: plot.id,
          validatorId: this.id,
          severity: 'error',
          field: 'places',
          message: `Place at index ${i} is missing storyRole`,
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

      // Handle credits.title fix
      if (fix.field === 'credits.title' && typeof fix.value === 'string') {
        plot.credits.title = fix.value;
        fixed.push(issue);
        continue;
      }

      // Handle triggerDescription fix for root-level possibleFlags
      if (fix.field.includes('triggerDescription')) {
        // Extract flag ID from the field path
        const flagIdMatch = fix.field.match(/possibleFlags\.([^.]+)\.triggerDescription/);
        if (flagIdMatch) {
          const flagDef = plot.possibleFlags.find((f) => f.id === flagIdMatch[1]);
          if (flagDef && typeof fix.value === 'string') {
            flagDef.triggerDescription = fix.value;
            fixed.push(issue);
          }
        }
        continue;
      }

      // Handle progressBoost fix for goals (goals are at plan level)
      if (fix.field.includes('progressBoost') && issue.goalId) {
        const goal = plot.goals.find((g) => g.id === issue.goalId);
        if (goal && typeof fix.value === 'number') {
          goal.progressBoost = fix.value;
          fixed.push(issue);
        }
        continue;
      }

      // Handle character name->matchHint conversion
      const charMatch = fix.field.match(/^characters\.(\d+)\.name->matchHint$/);
      if (charMatch && typeof fix.value === 'string') {
        const idx = parseInt(charMatch[1], 10);
        const char = plot.characters[idx];
        if (char.name) {
          // Move name to matchHint
          char.matchHint = char.name;
          delete char.name;
          fixed.push(issue);
        }
        continue;
      }

      // Place autofix code removed - PlannedPlace now only has placeId and storyRole
    }

    return fixed;
  },
};
