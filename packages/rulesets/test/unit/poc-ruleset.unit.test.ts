import { describe, it, expect } from 'vitest';
import { createPocRuleset } from '@dmnpc/rulesets/poc/poc-ruleset.js';
import type { ResolutionContext, DifficultyClass } from '@dmnpc/types/combat';
import type { Place } from '@dmnpc/types/entity';
import { createTestCharacter } from '../helpers/character-factory.js';

function createTestResolutionContext(
  overrides?: Partial<{
    difficulty: DifficultyClass | null;
    statValue: number;
    actionCount: number;
  }>
): ResolutionContext {
  const statValue = overrides?.statValue ?? 10;
  const character = createTestCharacter(
    { skill: statValue },
    { purpose: 'guard', isPlayer: false }
  );

  const actionCount = overrides?.actionCount ?? 1;
  const difficulty = overrides?.difficulty ?? 'moderate';
  const actions = Array.from({ length: actionCount }, () => ({
    type: 'Action' as const,
    intent: 'test action',
    targetRef: null,
    targetId: null,
    suggestedDifficulty: difficulty,
    suggestedStat: null,
    opposedBy: null,
    actionId: null,
    combatInitiated: false,
  }));

  return {
    actions,
    character,
    place: { id: 'PLACE_test', label: 'Test Place' } as Place,
    nearbyCharacters: [],
    weaponStatModifiers: {},
  };
}

describe('PocRuleset', () => {
  describe('metadata', () => {
    const ruleset = createPocRuleset();

    it('has correct id and name', () => {
      expect(ruleset.id).toBe('poc');
      expect(ruleset.name).toBe('Proof of Concept');
    });

    it('defines a single "skill" stat', () => {
      expect(ruleset.statDefinitions).toHaveLength(1);
      expect(ruleset.statDefinitions[0].id).toBe('skill');
      expect(ruleset.statDefinitions[0].min).toBe(1);
      expect(ruleset.statDefinitions[0].max).toBe(20);
      expect(ruleset.statDefinitions[0].default).toBe(5);
    });

    it('has no conditions', () => {
      expect(ruleset.conditionDefinitions).toHaveLength(0);
    });

    it('has point-buy stat allocation config', () => {
      expect(ruleset.statAllocationConfig).toEqual({
        method: 'point_buy',
        budget: 5,
        startingValues: { skill: 3 },
      });
    });
  });

  describe('resolve', () => {
    it('auto-passes trivial difficulty', () => {
      const ruleset = createPocRuleset();
      const ctx = createTestResolutionContext({ difficulty: 'trivial' });
      const results = ruleset.resolve(ctx);
      expect(results).toHaveLength(1);
      expect(results[0].outcome).toBe('success');
      expect(results[0].checkRequired).toBe(false);
      expect(results[0].check).toBeNull();
      expect(results[0].mechanicalSummary).toBe('Auto-pass (trivial)');
    });

    it('performs d20 check for non-trivial difficulty', () => {
      // Fixed roll: always returns 15
      const ruleset = createPocRuleset(() => 0.7); // floor(0.7 * 20) + 1 = 15
      const ctx = createTestResolutionContext({ difficulty: 'moderate', statValue: 10 });
      const results = ruleset.resolve(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].checkRequired).toBe(true);
      expect(results[0].check).not.toBeNull();
      expect(results[0].check?.stat).toBe('skill');
      expect(results[0].check?.roll).toBe(15);
      expect(results[0].check?.modifier).toBe(5); // floor(10/2)
      expect(results[0].check?.target).toBe(12); // moderate DC
    });

    it('succeeds with margin >= 5', () => {
      // Roll 15, modifier 5 (skill 10) = 20 vs DC 12 = margin 8 → success
      const ruleset = createPocRuleset(() => 0.7);
      const ctx = createTestResolutionContext({ difficulty: 'moderate', statValue: 10 });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('success');
      expect(results[0].margin).toBe(8);
    });

    it('partially succeeds with margin >= 0 and < 5', () => {
      // Roll 10, modifier 2 (skill 4) = 12 vs DC 12 = margin 0 → partial
      const ruleset = createPocRuleset(() => 0.45); // floor(0.45 * 20) + 1 = 10
      const ctx = createTestResolutionContext({ difficulty: 'moderate', statValue: 4 });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('partial');
      expect(results[0].margin).toBe(0);
    });

    it('fails with negative margin', () => {
      // Roll 3, modifier 1 (skill 2) = 4 vs DC 12 = margin -8 → failure
      const ruleset = createPocRuleset(() => 0.1); // floor(0.1 * 20) + 1 = 3
      const ctx = createTestResolutionContext({ difficulty: 'moderate', statValue: 2 });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('failure');
      expect(results[0].margin).toBeLessThan(0);
    });

    it('resolves multiple actions', () => {
      const ruleset = createPocRuleset(() => 0.5);
      const ctx = createTestResolutionContext({ difficulty: 'easy', actionCount: 3 });
      const results = ruleset.resolve(ctx);
      expect(results).toHaveLength(3);
      results.forEach((r, i) => {
        expect(r.actionIndex).toBe(i);
      });
    });

    it('uses correct DC targets for each difficulty', () => {
      const difficulties: DifficultyClass[] = ['easy', 'moderate', 'hard', 'extreme'];
      const targets = [8, 12, 16, 20];

      difficulties.forEach((difficulty, i) => {
        const ruleset = createPocRuleset(() => 0.5);
        const ctx = createTestResolutionContext({ difficulty });
        const results = ruleset.resolve(ctx);
        expect(results[0].check?.target).toBe(targets[i]);
      });
    });
  });

  describe('generateStats', () => {
    it('returns flat default stats', () => {
      const ruleset = createPocRuleset();
      expect(ruleset.generateStats({ purpose: null })).toEqual({ skill: 5 });
    });

    it('returns same stats regardless of purpose', () => {
      const ruleset = createPocRuleset();
      expect(ruleset.generateStats({ purpose: 'guard' })).toEqual({ skill: 5 });
    });
  });

  describe('lifecycle hooks', () => {
    it('onTimeTick returns empty effects', () => {
      const ruleset = createPocRuleset();
      const effects = ruleset.onTimeTick({
        character: createTestResolutionContext().character,
        minutesElapsed: 30,
        previousDate: '1.1.100',
        newDate: '1.1.100',
      });
      expect(effects).toEqual([]);
    });

    it('onActionComplete returns empty when check is null', () => {
      const ruleset = createPocRuleset();
      const effects = ruleset.onActionComplete({
        character: createTestResolutionContext().character,
        action: { type: 'Action', intent: 'test', targetRef: null, targetId: null, suggestedDifficulty: 'trivial', suggestedStat: null, opposedBy: null, actionId: null, combatInitiated: false },
        resolution: {
          actionIndex: 0,
          checkRequired: true,
          outcome: 'success',
          margin: 5,
          check: null,
          mechanicalSummary: 'test',
        },
        opponent: null,
      });
      expect(effects).toEqual([]);
    });

    it('onActionComplete returns empty when checkRequired is false', () => {
      const ruleset = createPocRuleset();
      const effects = ruleset.onActionComplete({
        character: createTestResolutionContext().character,
        action: { type: 'Action', intent: 'test', targetRef: null, targetId: null, suggestedDifficulty: 'trivial', suggestedStat: null, opposedBy: null, actionId: null, combatInitiated: false },
        resolution: {
          actionIndex: 0,
          checkRequired: false,
          outcome: 'success',
          margin: 0,
          check: null,
          mechanicalSummary: 'Auto-pass (trivial)',
        },
        opponent: null,
      });
      expect(effects).toEqual([]);
    });

    it('onActionComplete returns increment_stat_usage when check was required', () => {
      const ruleset = createPocRuleset();
      const character = createTestResolutionContext().character;
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'climb wall', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'skill', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: {
          actionIndex: 0,
          checkRequired: true,
          outcome: 'success',
          margin: 8,
          check: { type: 'standard' as const, stat: 'skill', statValue: 10, roll: 15, modifier: 5, target: 12 },
          mechanicalSummary: 'Skill check: d20(15) + 5 = 20 vs DC 12 → success',
        },
        opponent: null,
      });

      expect(effects).toHaveLength(1);
      expect(effects[0]).toEqual({
        type: 'increment_stat_usage',
        characterId: 'CHAR_test',
        stat: 'skill',
        delta: 1,
        reason: expect.stringContaining('skill'),
      });
    });

    it('onActionComplete tracks the correct stat from the check', () => {
      const ruleset = createPocRuleset();
      const character = createTestResolutionContext().character;
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'test', targetRef: null, targetId: null, suggestedDifficulty: 'hard', suggestedStat: 'skill', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: {
          actionIndex: 0,
          checkRequired: true,
          outcome: 'failure',
          margin: -5,
          check: { type: 'standard' as const, stat: 'skill', statValue: 5, roll: 3, modifier: 2, target: 16 },
          mechanicalSummary: 'test',
        },
        opponent: null,
      });

      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe('increment_stat_usage');
      // Stat usage increments even on failure (tracks usage, not success)
      expect((effects[0] as any).stat).toBe('skill');
    });
  });
});
