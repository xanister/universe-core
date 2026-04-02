/**
 * Proof-of-concept ruleset: single "Skill" stat, d20 + modifier resolution.
 *
 * Intentionally minimal — validates the GameRuleset contract end-to-end.
 * Will be replaced by a real ruleset after playtesting (Phase 5).
 */

import type {
  GameRuleset,
  ResolutionContext,
  ResolutionResult,
  RulesetEffect,
  TimeTickHookContext,
  ActionCompleteHookContext,
  DifficultyClass,
  StatGenerationContext,
} from '@dmnpc/types/combat';
import { rollD20 } from '../dice.js';

/** DC targets for each difficulty class. */
const DIFFICULTY_TARGETS: Record<DifficultyClass, number> = {
  trivial: 0, // auto-pass
  easy: 8,
  moderate: 12,
  hard: 16,
  extreme: 20,
};

/**
 * Create a PoC ruleset instance.
 * @param randomFn Optional custom random function for deterministic tests.
 */
export function createPocRuleset(randomFn?: () => number): GameRuleset {
  return {
    id: 'poc',
    name: 'Proof of Concept',
    description: 'Single-stat d20 ruleset for contract validation.',

    statDefinitions: [
      {
        id: 'skill',
        name: 'Skill',
        description: 'General aptitude for physical and mental tasks.',
        min: 1,
        max: 20,
        default: 5,
        allocatable: true,
        category: 'base',
        incapacitationConfig: null,
      },
    ],

    conditionDefinitions: [],

    statAllocationConfig: {
      method: 'point_buy',
      budget: 5,
      startingValues: { skill: 3 },
    },

    resolve(context: ResolutionContext): ResolutionResult[] {
      return context.actions.map((action, i) => {
        const difficulty = action.suggestedDifficulty;

        // Trivial = auto-pass, no roll
        if (difficulty === 'trivial') {
          return {
            actionIndex: i,
            checkRequired: false,
            outcome: 'success' as const,
            margin: 0,
            check: null,
            mechanicalSummary: 'Auto-pass (trivial)',
          };
        }

        const target = DIFFICULTY_TARGETS[difficulty];
        const stats = context.character.info.rulesetState.stats;
        const statValue = 'skill' in stats ? stats.skill : 5;
        const modifier = Math.floor(statValue / 2);
        const roll = rollD20(randomFn);
        const total = roll + modifier;
        const margin = total - target;

        let outcome: 'success' | 'partial' | 'failure';
        if (margin >= 5) {
          outcome = 'success';
        } else if (margin >= 0) {
          outcome = 'partial';
        } else {
          outcome = 'failure';
        }

        return {
          actionIndex: i,
          checkRequired: true,
          outcome,
          margin,
          check: {
            type: 'standard' as const,
            stat: 'skill',
            statValue,
            roll,
            modifier,
            target,
          },
          mechanicalSummary: `Skill check: d20(${roll}) + ${modifier} = ${total} vs DC ${target} → ${outcome} (margin ${margin >= 0 ? '+' : ''}${margin})`,
        };
      });
    },

    generateStats(_context: StatGenerationContext): Record<string, number> {
      return { skill: 5 };
    },

    onTimeTick(_context: TimeTickHookContext): RulesetEffect[] {
      return [];
    },

    onActionComplete(context: ActionCompleteHookContext): RulesetEffect[] {
      const { character, resolution } = context;
      // Track stat usage for progression: increment the stat that was checked
      // PoC only supports standard checks (no contested logic)
      if (resolution.checkRequired && resolution.check?.type === 'standard') {
        return [
          {
            type: 'increment_stat_usage',
            characterId: character.id,
            stat: resolution.check.stat,
            delta: 1,
            reason: `Used ${resolution.check.stat} in ${resolution.outcome} check`,
          },
        ];
      }
      return [];
    },
  };
}

/** Default PoC ruleset instance (non-deterministic rolls). */
export const pocRuleset = createPocRuleset();
