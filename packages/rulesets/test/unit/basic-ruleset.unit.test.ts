/**
 * Tests for BasicRuleset (FEAT-157 Phase 1).
 *
 * Validates: stat definitions, derived stat computation, percentile resolution,
 * outcome tiers, purpose-aware NPC stat generation, and lifecycle hook stubs.
 */

import { describe, it, expect } from 'vitest';
import { createBasicRuleset } from '@dmnpc/rulesets/basic/basic-ruleset.js';
import type { ResolutionContext, DifficultyClass } from '@dmnpc/types/combat';
import type { Place } from '@dmnpc/types/entity';
import { createTestCharacter } from '../helpers/character-factory.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(
  overrides?: Partial<{
    difficulty: DifficultyClass | null;
    suggestedStat: string | null;
    stats: Record<string, number>;
    actionCount: number;
  }>
): ResolutionContext {
  const stats = overrides?.stats ?? { physical: 50, mental: 50, social: 50 };
  const actionCount = overrides?.actionCount ?? 1;
  const difficulty = overrides?.difficulty ?? 'moderate';
  const suggestedStat = overrides?.suggestedStat ?? null;

  return {
    actions: Array.from({ length: actionCount }, () => ({
      type: 'Action' as const,
      intent: 'test action',
      targetRef: null,
      targetId: null,
      suggestedDifficulty: difficulty,
      suggestedStat: suggestedStat,
      opposedBy: null,
      actionId: null,
      combatInitiated: false,
    })),
    character: createTestCharacter(stats),
    place: { id: 'PLACE_test', label: 'Test Place' } as Place,
    nearbyCharacters: [],
    weaponStatModifiers: {},
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('BasicRuleset', () => {
  describe('metadata', () => {
    const ruleset = createBasicRuleset();

    it('has correct id and name', () => {
      expect(ruleset.id).toBe('basic');
      expect(ruleset.name).toBe('Basic Ruleset');
    });

    it('defines 12 stats: 3 base + 3 derived + 2 poise + 4 vitals', () => {
      expect(ruleset.statDefinitions).toHaveLength(12);
      const base = ruleset.statDefinitions.filter((s) => s.category === 'base');
      const derived = ruleset.statDefinitions.filter((s) => s.category === 'derived');
      const resource = ruleset.statDefinitions.filter((s) => s.category === 'resource');
      const vital = ruleset.statDefinitions.filter((s) => s.category === 'vital');
      const internal = ruleset.statDefinitions.filter((s) => s.category === 'internal');
      expect(base).toHaveLength(3);
      expect(derived).toHaveLength(3);
      expect(resource).toHaveLength(1); // poise
      expect(vital).toHaveLength(4); // bloodloss, anxiety, fatigue, hunger
      expect(internal).toHaveLength(1); // max_poise
    });

    it('base stats are physical, mental, social', () => {
      const baseIds = ruleset.statDefinitions
        .filter((s) => s.allocatable)
        .map((s) => s.id);
      expect(baseIds).toEqual(['physical', 'mental', 'social']);
    });

    it('derived stats have derivedFrom pairs', () => {
      const derived = ruleset.statDefinitions.filter((s) => !s.allocatable);
      expect(derived.find((d) => d.id === 'dexterity')?.derivedFrom).toEqual(['physical', 'mental']);
      expect(derived.find((d) => d.id === 'charisma')?.derivedFrom).toEqual(['physical', 'social']);
      expect(derived.find((d) => d.id === 'wisdom')?.derivedFrom).toEqual(['social', 'mental']);
    });

    it('all stats use 0-100 scale', () => {
      for (const def of ruleset.statDefinitions) {
        expect(def.min).toBe(0);
        expect(def.max).toBe(100);
      }
    });

    it('base stats default to 50, poise and vitals default to 0', () => {
      const baseStats = ruleset.statDefinitions.filter((d) => d.category === 'base');
      for (const def of baseStats) {
        expect(def.default).toBe(50);
      }
      const poiseAndVitals = ruleset.statDefinitions.filter(
        (d) => d.category === 'resource' || d.category === 'vital' || d.category === 'internal'
      );
      for (const def of poiseAndVitals) {
        expect(def.default).toBe(0);
      }
    });

    it('has point-buy allocation with budget 15', () => {
      expect(ruleset.statAllocationConfig).toEqual({
        method: 'point_buy',
        budget: 15,
        startingValues: { physical: 50, mental: 50, social: 50 },
      });
    });
  });

  describe('derived stat computation', () => {
    it('dexterity = average of physical and mental', () => {
      // Roll that produces a known outcome to verify stat resolution
      // With physical=60, mental=40: dexterity = 50, moderate check → 50% success
      const ruleset = createBasicRuleset(() => 0.01); // roll 1 → always succeeds
      const ctx = createTestContext({
        stats: { physical: 60, mental: 40, social: 50 },
        difficulty: 'moderate',
        suggestedStat: 'dexterity',
      });
      const results = ruleset.resolve(ctx);
      // effectiveStat = floor((60+40)/2) = 50
      expect(results[0].check?.statValue).toBe(50);
    });

    it('charisma = average of physical and social', () => {
      const ruleset = createBasicRuleset(() => 0.01);
      const ctx = createTestContext({
        stats: { physical: 70, mental: 50, social: 30 },
        difficulty: 'moderate',
        suggestedStat: 'charisma',
      });
      const results = ruleset.resolve(ctx);
      // effectiveStat = floor((70+30)/2) = 50
      expect(results[0].check?.statValue).toBe(50);
    });

    it('wisdom = average of social and mental', () => {
      const ruleset = createBasicRuleset(() => 0.01);
      const ctx = createTestContext({
        stats: { physical: 50, mental: 80, social: 60 },
        difficulty: 'moderate',
        suggestedStat: 'wisdom',
      });
      const results = ruleset.resolve(ctx);
      // effectiveStat = floor((60+80)/2) = 70
      expect(results[0].check?.statValue).toBe(70);
    });
  });

  describe('percentile resolution', () => {
    it('auto-passes trivial difficulty', () => {
      const ruleset = createBasicRuleset();
      const ctx = createTestContext({ difficulty: 'trivial' });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('success');
      expect(results[0].checkRequired).toBe(false);
      expect(results[0].check).toBeNull();
    });

    it('uses base stat directly for base stat checks', () => {
      const ruleset = createBasicRuleset(() => 0.01); // roll 1
      const ctx = createTestContext({
        stats: { physical: 65, mental: 50, social: 50 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(ctx);
      expect(results[0].check?.statValue).toBe(65);
    });

    it('clamps success chance to minimum 5%', () => {
      // stat 10, extreme difficulty modifier = -35 → 10-35 = -25, clamped to 5
      const ruleset = createBasicRuleset(() => 0.03); // roll 4, should succeed at 5% threshold
      const ctx = createTestContext({
        stats: { physical: 10, mental: 10, social: 10 },
        difficulty: 'extreme',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(ctx);
      expect(results[0].check?.target).toBe(5);
    });

    it('clamps success chance to maximum 95%', () => {
      // stat 100, easy modifier = +35 → 135, clamped to 95
      const ruleset = createBasicRuleset(() => 0.93); // roll 94, should succeed at 95%
      const ctx = createTestContext({
        stats: { physical: 100, mental: 100, social: 100 },
        difficulty: 'easy',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(ctx);
      expect(results[0].check?.target).toBe(95);
    });

    it('applies correct difficulty modifiers', () => {
      const expected: [DifficultyClass, number][] = [
        ['easy', 85],       // 50 + 35
        ['moderate', 65],   // 50 + 15
        ['hard', 40],       // 50 - 10
        ['extreme', 15],    // 50 - 35
      ];

      for (const [difficulty, expectedTarget] of expected) {
        const ruleset = createBasicRuleset(() => 0.01);
        const ctx = createTestContext({ difficulty, suggestedStat: 'physical' });
        const results = ruleset.resolve(ctx);
        expect(results[0].check?.target).toBe(expectedTarget);
      }
    });

    it('defaults to physical when suggestedStat is null', () => {
      const ruleset = createBasicRuleset(() => 0.01);
      const ctx = createTestContext({
        stats: { physical: 60, mental: 40, social: 50 },
        difficulty: 'moderate',
        suggestedStat: null,
      });
      const results = ruleset.resolve(ctx);
      expect(results[0].check?.stat).toBe('physical');
      expect(results[0].check?.statValue).toBe(60);
    });
  });

  describe('outcome tiers', () => {
    // stat 50, moderate → successChance 65, target = 65
    // roll ≤ 32 → success (critical), roll ≤ 65 → success, roll ≤ 80 → partial, roll > 80 → failure

    it('critical success when roll ≤ successChance/2', () => {
      // successChance 65, roll = 1 (≤ 32) → success
      const ruleset = createBasicRuleset(() => 0); // floor(0*100)+1 = 1
      const ctx = createTestContext({ difficulty: 'moderate', suggestedStat: 'physical' });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('success');
      expect(results[0].check?.roll).toBe(1);
    });

    it('success when roll ≤ successChance', () => {
      // successChance 65, roll = 65 (≤ 65) → success
      const ruleset = createBasicRuleset(() => 0.64); // floor(0.64*100)+1 = 65
      const ctx = createTestContext({ difficulty: 'moderate', suggestedStat: 'physical' });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('success');
    });

    it('partial when roll ≤ successChance + 15', () => {
      // successChance 65, roll = 70 (> 65, ≤ 80) → partial
      const ruleset = createBasicRuleset(() => 0.69); // floor(0.69*100)+1 = 70
      const ctx = createTestContext({ difficulty: 'moderate', suggestedStat: 'physical' });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('partial');
    });

    it('failure when roll > successChance + 15', () => {
      // successChance 65, roll = 85 (> 80) → failure
      const ruleset = createBasicRuleset(() => 0.84); // floor(0.84*100)+1 = 85
      const ctx = createTestContext({ difficulty: 'moderate', suggestedStat: 'physical' });
      const results = ruleset.resolve(ctx);
      expect(results[0].outcome).toBe('failure');
    });

    it('resolves multiple actions', () => {
      const ruleset = createBasicRuleset(() => 0.5);
      const ctx = createTestContext({ difficulty: 'easy', actionCount: 3, suggestedStat: 'physical' });
      const results = ruleset.resolve(ctx);
      expect(results).toHaveLength(3);
      results.forEach((r, i) => {
        expect(r.actionIndex).toBe(i);
        expect(r.checkRequired).toBe(true);
      });
    });

    it('mechanicalSummary contains stat name and roll info', () => {
      const ruleset = createBasicRuleset(() => 0.49);
      const ctx = createTestContext({ difficulty: 'moderate', suggestedStat: 'physical' });
      const results = ruleset.resolve(ctx);
      expect(results[0].mechanicalSummary).toContain('Physical');
      expect(results[0].mechanicalSummary).toContain('d100');
      expect(results[0].mechanicalSummary).toContain('65%');
    });
  });

  describe('generateStats', () => {
    it('returns balanced defaults for null purpose', () => {
      const ruleset = createBasicRuleset();
      const stats = ruleset.generateStats({ purpose: null });
      expect(stats.physical).toBe(50);
      expect(stats.mental).toBe(50);
      expect(stats.social).toBe(50);
    });

    it('returns balanced defaults for player purpose', () => {
      const ruleset = createBasicRuleset();
      const stats = ruleset.generateStats({ purpose: 'player' });
      // Player gets no variance (purpose !== 'player' check in generateStats)
      expect(stats.physical).toBe(50);
      expect(stats.mental).toBe(50);
      expect(stats.social).toBe(50);
    });

    it('biases guard toward physical', () => {
      // Use deterministic random that returns 0.5 → variance = 0
      const ruleset = createBasicRuleset(() => 0.5);
      const stats = ruleset.generateStats({ purpose: 'guard' });
      expect(stats.physical).toBe(60);  // 50 + 10 bias
      expect(stats.mental).toBe(45);    // 50 - 5 bias
      expect(stats.social).toBe(40);    // 50 - 10 bias
    });

    it('biases merchant toward social', () => {
      const ruleset = createBasicRuleset(() => 0.5);
      const stats = ruleset.generateStats({ purpose: 'merchant' });
      expect(stats.physical).toBe(40);  // 50 - 10 bias
      expect(stats.mental).toBe(55);    // 50 + 5 bias
      expect(stats.social).toBe(60);    // 50 + 10 bias
    });

    it('returns base stats plus poise and vitals (no derived)', () => {
      const ruleset = createBasicRuleset();
      const stats = ruleset.generateStats({ purpose: null });
      expect(Object.keys(stats).sort()).toEqual([
        'anxiety', 'bloodloss', 'fatigue', 'hunger',
        'max_poise', 'mental', 'physical', 'poise', 'social',
      ]);
      // Poise = floor(avg of base stats)
      expect(stats.poise).toBe(50);
      expect(stats.max_poise).toBe(50);
      // Vitals start at 0
      expect(stats.bloodloss).toBe(0);
      expect(stats.anxiety).toBe(0);
      expect(stats.fatigue).toBe(0);
      expect(stats.hunger).toBe(0);
    });

    it('unknown purpose gets balanced defaults with variance', () => {
      // deterministic random at 0.5 → variance = floor(0.5 * 11) - 5 = 0
      const ruleset = createBasicRuleset(() => 0.5);
      const stats = ruleset.generateStats({ purpose: 'quest_giver' });
      // quest_giver has biases: physical: -5, mental: +5, social: +5
      expect(stats.physical).toBe(45);
      expect(stats.mental).toBe(55);
      expect(stats.social).toBe(55);
    });
  });

  describe('lifecycle hooks', () => {
    it('onTimeTick with no ailments returns hunger drift and poise recovery', () => {
      const ruleset = createBasicRuleset();
      // Character with poise below max and all vitals at 0
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 30, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character,
        minutesElapsed: 10,
        previousDate: '1.1.100',
        newDate: '1.1.100',
      });
      // Should include hunger drift + poise recovery
      const hungerEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'hunger');
      const poiseEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'poise');
      expect(hungerEffect).toBeDefined();
      expect(poiseEffect).toBeDefined();
      // Poise recovery: 2/min * 10min = 20
      expect(poiseEffect!.type === 'modify_stat' && poiseEffect!.delta).toBe(20);
    });

    it('onTimeTick returns empty when 0 minutes elapsed', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character,
        minutesElapsed: 0,
        previousDate: '1.1.100',
        newDate: '1.1.100',
      });
      expect(effects).toEqual([]);
    });

    it('onActionComplete returns increment_stat_usage when check present', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'climb', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'physical', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: {
          actionIndex: 0,
          checkRequired: true,
          outcome: 'success',
          margin: 10,
          check: { type: 'standard' as const, stat: 'physical', statValue: 50, roll: 40, modifier: 0, target: 50 },
          mechanicalSummary: 'test',
        },
        opponent: null,
      });
      // Should include stat usage + no poise change for regular success
      const usageEffect = effects.find((e) => e.type === 'increment_stat_usage');
      expect(usageEffect).toBeDefined();
      expect(usageEffect).toEqual({
        type: 'increment_stat_usage',
        characterId: 'CHAR_test',
        stat: 'physical',
        delta: 1,
        reason: expect.stringContaining('physical'),
      });
    });

    it('onActionComplete returns empty when no check', () => {
      const ruleset = createBasicRuleset();
      const effects = ruleset.onActionComplete({
        character: createTestCharacter({ physical: 50 }),
        action: { type: 'Action', intent: 'walk', targetRef: null, targetId: null, suggestedDifficulty: 'trivial', suggestedStat: null, opposedBy: null, actionId: null, combatInitiated: false },
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
  });

  // ===========================================================================
  // Phase 2: Poise, Ailments, Vitals
  // ===========================================================================

  describe('poise mechanics', () => {
    it('failure reduces poise (scaled by difficulty)', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 40, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'climb', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'physical', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: { actionIndex: 0, checkRequired: true, outcome: 'failure', margin: -10, check: { type: 'standard' as const, stat: 'physical', statValue: 50, roll: 60, modifier: 0, target: 50 }, mechanicalSummary: 'test' },
        opponent: null,
      });
      const poiseEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'poise');
      expect(poiseEffect).toBeDefined();
      expect(poiseEffect!.type === 'modify_stat' && poiseEffect!.delta).toBe(-10); // moderate = -10
    });

    it('success does not change poise', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 40, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'climb', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'physical', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: { actionIndex: 0, checkRequired: true, outcome: 'success', margin: 10, check: { type: 'standard' as const, stat: 'physical', statValue: 50, roll: 40, modifier: 0, target: 50 }, mechanicalSummary: 'test' },
        opponent: null,
      });
      const poiseEffects = effects.filter((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'poise');
      expect(poiseEffects).toHaveLength(0);
    });

    it('partial reduces poise by 5', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 40, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'climb', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'physical', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: { actionIndex: 0, checkRequired: true, outcome: 'partial', margin: -3, check: { type: 'standard' as const, stat: 'physical', statValue: 50, roll: 53, modifier: 0, target: 50 }, mechanicalSummary: 'test' },
        opponent: null,
      });
      const poiseEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'poise');
      expect(poiseEffect).toBeDefined();
      expect(poiseEffect!.type === 'modify_stat' && poiseEffect!.delta).toBe(-5);
    });

    it('poise depleted on failure → ailment applied', () => {
      const ruleset = createBasicRuleset();
      // Poise at 5, moderate failure costs 10 → poise goes to -5 → ailment
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 5, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'climb', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'physical', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: { actionIndex: 0, checkRequired: true, outcome: 'failure', margin: -10, check: { type: 'standard' as const, stat: 'physical', statValue: 50, roll: 60, modifier: 0, target: 50 }, mechanicalSummary: 'test' },
        opponent: null,
      });
      const ailmentEffect = effects.find((e) => e.type === 'apply_condition');
      expect(ailmentEffect).toBeDefined();
      // Physical stat → physical category → wound
      expect(ailmentEffect!.type === 'apply_condition' && ailmentEffect!.conditionId).toBe('wound');
    });

    it('mental check failure with depleted poise → rattled ailment', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 0, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'think', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'mental', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: { actionIndex: 0, checkRequired: true, outcome: 'failure', margin: -10, check: { type: 'standard' as const, stat: 'mental', statValue: 50, roll: 60, modifier: 0, target: 50 }, mechanicalSummary: 'test' },
        opponent: null,
      });
      const ailmentEffect = effects.find((e) => e.type === 'apply_condition');
      expect(ailmentEffect).toBeDefined();
      expect(ailmentEffect!.type === 'apply_condition' && ailmentEffect!.conditionId).toBe('rattled');
    });

    it('social check failure with depleted poise → humiliation ailment', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 0, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'persuade', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'social', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: { actionIndex: 0, checkRequired: true, outcome: 'failure', margin: -10, check: { type: 'standard' as const, stat: 'social', statValue: 50, roll: 60, modifier: 0, target: 50 }, mechanicalSummary: 'test' },
        opponent: null,
      });
      const ailmentEffect = effects.find((e) => e.type === 'apply_condition');
      expect(ailmentEffect!.type === 'apply_condition' && ailmentEffect!.conditionId).toBe('humiliation');
    });

    it('poise recovers toward max during onTimeTick', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 10, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character, minutesElapsed: 5, previousDate: '1.1.100', newDate: '1.1.100',
      });
      const poiseEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'poise');
      expect(poiseEffect).toBeDefined();
      // 2/min * 5min = 10
      expect(poiseEffect!.type === 'modify_stat' && poiseEffect!.delta).toBe(10);
    });
  });

  describe('ailment stat modifiers in resolution', () => {
    it('wound reduces effective physical stat', () => {
      // Roll 40 against deterministic d100, wound severity 1 = physical -5
      const ruleset = createBasicRuleset(() => 0); // roll returns 1 (always success)
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      // Add a wound condition
      character.info.rulesetState.conditions = [{ typeId: 'wound', severity: 1 }];
      const ctx = createTestContext({ stats: { physical: 50, mental: 50, social: 50 }, difficulty: 'moderate', suggestedStat: 'physical' });
      ctx.character = character;
      const results = ruleset.resolve(ctx);
      // effectiveStat = 50 - 5 (wound) = 45
      expect(results[0].check!.statValue).toBe(45);
    });

    it('severity stacking multiplies modifier', () => {
      const ruleset = createBasicRuleset(() => 0);
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      character.info.rulesetState.conditions = [{ typeId: 'wound', severity: 3 }];
      const ctx = createTestContext({ stats: { physical: 50, mental: 50, social: 50 }, difficulty: 'moderate', suggestedStat: 'physical' });
      ctx.character = character;
      const results = ruleset.resolve(ctx);
      // effectiveStat = 50 - 15 (wound severity 3 × -5) = 35
      expect(results[0].check!.statValue).toBe(35);
    });
  });

  describe('vital threshold penalties in resolution', () => {
    it('bloodloss at 50 applies physical -5 penalty', () => {
      const ruleset = createBasicRuleset(() => 0);
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 55, anxiety: 0, fatigue: 0, hunger: 0 });
      const ctx = createTestContext({ stats: { physical: 50, mental: 50, social: 50 }, difficulty: 'moderate', suggestedStat: 'physical' });
      ctx.character = character;
      const results = ruleset.resolve(ctx);
      // effectiveStat = 50 - 5 (bloodloss ≥ 50 threshold) = 45
      expect(results[0].check!.statValue).toBe(45);
    });

    it('vital threshold penalties cumulate with ailment modifiers', () => {
      const ruleset = createBasicRuleset(() => 0);
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 55, anxiety: 0, fatigue: 0, hunger: 0 });
      character.info.rulesetState.conditions = [{ typeId: 'wound', severity: 1 }];
      const ctx = createTestContext({ stats: { physical: 50, mental: 50, social: 50 }, difficulty: 'moderate', suggestedStat: 'physical' });
      ctx.character = character;
      const results = ruleset.resolve(ctx);
      // effectiveStat = 50 - 5 (wound) - 5 (bloodloss threshold) = 40
      expect(results[0].check!.statValue).toBe(40);
    });
  });

  describe('time tick: vitals and ailments', () => {
    it('wound feeds bloodloss vital', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      character.info.rulesetState.conditions = [{ typeId: 'wound', severity: 2 }];
      const effects = ruleset.onTimeTick({
        character, minutesElapsed: 1, previousDate: '1.1.100', newDate: '1.1.100',
      });
      const bloodlossEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'bloodloss');
      expect(bloodlossEffect).toBeDefined();
      // wound: bloodloss +3 per severity × severity 2 × 1 min = 6
      expect(bloodlossEffect!.type === 'modify_stat' && bloodlossEffect!.delta).toBe(6);
    });

    it('vital recovers when no ailments feed it', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 20, anxiety: 0, fatigue: 0, hunger: 0 });
      // No wound conditions → bloodloss should recover
      const effects = ruleset.onTimeTick({
        character, minutesElapsed: 10, previousDate: '1.1.100', newDate: '1.1.100',
      });
      const bloodlossEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'bloodloss');
      expect(bloodlossEffect).toBeDefined();
      // Recovery: 1/min × 10min = -10
      expect(bloodlossEffect!.type === 'modify_stat' && bloodlossEffect!.delta).toBe(-10);
    });

    it('hunger drifts upward naturally', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 10 });
      const effects = ruleset.onTimeTick({
        character, minutesElapsed: 10, previousDate: '1.1.100', newDate: '1.1.100',
      });
      const hungerEffect = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'hunger');
      expect(hungerEffect).toBeDefined();
      // Drift: 0.1/min × 10min = 1
      expect(hungerEffect!.type === 'modify_stat' && hungerEffect!.delta).toBe(1);
    });
  });

  describe('use-based stat progression', () => {
    it('bumps stat when usage meets threshold', () => {
      const ruleset = createBasicRuleset();
      // Physical 50 → threshold = floor(50 * 0.5) = 25 uses needed
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      character.info.rulesetState.statUsage = { physical: 25 };
      const effects = ruleset.onTimeTick({
        character, minutesElapsed: 1, previousDate: '1.1.100', newDate: '1.1.100',
      });
      const physicalBump = effects.find((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'physical');
      expect(physicalBump).toBeDefined();
      expect(physicalBump!.type === 'modify_stat' && physicalBump!.delta).toBe(1);
      // Usage should be reset
      const usageReset = effects.find((e) => e.type === 'increment_stat_usage' && 'stat' in e && e.stat === 'physical');
      expect(usageReset).toBeDefined();
      expect(usageReset!.type === 'increment_stat_usage' && usageReset!.delta).toBe(-25);
    });

    it('does not bump when below threshold', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      character.info.rulesetState.statUsage = { physical: 10 }; // < 25 threshold
      const effects = ruleset.onTimeTick({
        character, minutesElapsed: 1, previousDate: '1.1.100', newDate: '1.1.100',
      });
      const physicalBump = effects.find(
        (e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'physical' && 'reason' in e && e.reason.includes('Progression')
      );
      expect(physicalBump).toBeUndefined();
    });

    it('higher stats require more uses (diminishing returns)', () => {
      const ruleset = createBasicRuleset();
      // Physical 80 → threshold = floor(80 * 0.5) = 40 uses needed
      const character = createTestCharacter({ physical: 80, mental: 50, social: 50, poise: 60, max_poise: 60, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      character.info.rulesetState.statUsage = { physical: 39 }; // just below threshold
      const effects = ruleset.onTimeTick({
        character, minutesElapsed: 1, previousDate: '1.1.100', newDate: '1.1.100',
      });
      const physicalBump = effects.find(
        (e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'physical' && 'reason' in e && e.reason.includes('Progression')
      );
      expect(physicalBump).toBeUndefined(); // 39 < 40, no bump
    });
  });

  describe('condition definitions', () => {
    it('defines 7 ailment types', () => {
      const ruleset = createBasicRuleset();
      expect(ruleset.conditionDefinitions).toHaveLength(7);
      const ids = ruleset.conditionDefinitions.map((d) => d.id);
      expect(ids).toContain('wound');
      expect(ids).toContain('bruise');
      expect(ids).toContain('exhaustion');
      expect(ids).toContain('rattled');
      expect(ids).toContain('sickness');
      expect(ids).toContain('depression');
      expect(ids).toContain('humiliation');
    });

    it('each definition has statModifiers', () => {
      const ruleset = createBasicRuleset();
      for (const def of ruleset.conditionDefinitions) {
        expect(Object.keys(def.statModifiers).length).toBeGreaterThan(0);
      }
    });

    it('each definition has a category (physical, mental, or social)', () => {
      const ruleset = createBasicRuleset();
      const validCategories = new Set(['physical', 'mental', 'social']);
      for (const def of ruleset.conditionDefinitions) {
        expect(validCategories.has(def.category)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Phase 7: Contested Checks (FEAT-179)
  // ===========================================================================

  describe('contested resolution', () => {
    function createContestContext(opts: {
      initiatorStats: Record<string, number>;
      opponentStats: Record<string, number>;
      difficulty: DifficultyClass;
      suggestedStat: string;
    }) {
      const opponent = createTestCharacter(opts.opponentStats);
      opponent.id = 'CHAR_opponent';
      opponent.info.isPlayer = false;
      opponent.info.purpose = 'guard';
      (opponent as { label: string }).label = 'Guard';
      return {
        context: {
          actions: [{
            type: 'Action' as const,
            intent: 'attack guard',
            targetRef: 'guard',
            targetId: 'CHAR_opponent',
            suggestedDifficulty: opts.difficulty,
            suggestedStat: opts.suggestedStat,
            opposedBy: 'CHAR_opponent',
            actionId: null,
            combatInitiated: false,
          }],
          character: createTestCharacter(opts.initiatorStats),
          place: { id: 'PLACE_test', label: 'Test Place' } as Place,
          nearbyCharacters: [opponent],
          weaponStatModifiers: {},
        } satisfies ResolutionContext,
        opponent,
      };
    }

    it('initiator wins when higher outcome tier (success > failure)', () => {
      // Initiator rolls low (success), opponent rolls high (failure)
      let callCount = 0;
      const ruleset = createBasicRuleset(() => {
        callCount++;
        // First call: initiator roll → very low (success)
        // Second call: opponent roll → very high (failure)
        return callCount === 1 ? 0.01 : 0.95;
      });
      const { context } = createContestContext({
        initiatorStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        opponentStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(context);
      expect(results[0].outcome).toBe('success');
      expect(results[0].check?.type).toBe('contested');
    });

    it('initiator loses when lower outcome tier (failure < success)', () => {
      let callCount = 0;
      const ruleset = createBasicRuleset(() => {
        callCount++;
        return callCount === 1 ? 0.95 : 0.01; // initiator fails, opponent succeeds
      });
      const { context } = createContestContext({
        initiatorStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        opponentStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(context);
      expect(results[0].outcome).toBe('failure');
    });

    it('same tier: higher margin wins', () => {
      // Both succeed, but initiator has better margin
      let callCount = 0;
      const ruleset = createBasicRuleset(() => {
        callCount++;
        return callCount === 1 ? 0.1 : 0.4; // initiator roll ~11, opponent roll ~41
      });
      const { context } = createContestContext({
        initiatorStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        opponentStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(context);
      expect(results[0].outcome).toBe('success');
    });

    it('same roll but higher stat produces a better margin (initiator wins)', () => {
      // Identical rolls (0.2) but initiator has physical 60 vs opponent 40
      // Higher stat → higher successChance → larger margin → initiator wins
      let callCount = 0;
      const ruleset = createBasicRuleset(() => {
        callCount++;
        return callCount === 1 ? 0.2 : 0.2; // Same roll for both
      });
      const { context } = createContestContext({
        initiatorStats: { physical: 60, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        opponentStats: { physical: 40, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(context);
      expect(results[0].check?.type).toBe('contested');
      expect(results[0].outcome).toBe('success');
    });

    it('true tie (same tier, margin, stat) → draw with partial outcome', () => {
      // Identical stats, identical rolls → true tie
      let callCount = 0;
      const ruleset = createBasicRuleset(() => {
        callCount++;
        return callCount === 1 ? 0.3 : 0.3; // Same roll
      });
      const { context } = createContestContext({
        initiatorStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        opponentStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(context);
      expect(results[0].outcome).toBe('partial'); // Draw
    });

    it('trivial actions NOT contested (auto-pass even with opposedBy)', () => {
      const ruleset = createBasicRuleset();
      const { context } = createContestContext({
        initiatorStats: { physical: 50, mental: 50, social: 50 },
        opponentStats: { physical: 50, mental: 50, social: 50 },
        difficulty: 'trivial',
        suggestedStat: 'physical',
      });
      // Override difficulty to trivial
      context.actions[0].suggestedDifficulty = 'trivial';
      const results = ruleset.resolve(context);
      expect(results[0].outcome).toBe('success');
      expect(results[0].checkRequired).toBe(false);
      expect(results[0].check).toBeNull();
    });

    it('opponent not found → falls back to standard check', () => {
      const ruleset = createBasicRuleset(() => 0.01);
      const context: ResolutionContext = {
        actions: [{
          type: 'Action' as const,
          intent: 'attack ghost',
          targetRef: 'ghost',
          targetId: 'CHAR_ghost',
          suggestedDifficulty: 'moderate',
          suggestedStat: 'physical',
          opposedBy: 'CHAR_ghost', // Not in nearbyCharacters
          actionId: null,
          combatInitiated: false,
        }],
        character: createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 }),
        place: { id: 'PLACE_test', label: 'Test Place' } as Place,
        nearbyCharacters: [], // Opponent not here
        weaponStatModifiers: {},
      };
      const results = ruleset.resolve(context);
      expect(results[0].check?.type).toBe('standard'); // Fell back
      expect(results[0].checkRequired).toBe(true);
    });

    it('contested CheckDetail has correct type discriminant and both participants', () => {
      let callCount = 0;
      const ruleset = createBasicRuleset(() => {
        callCount++;
        return callCount === 1 ? 0.1 : 0.8;
      });
      const { context } = createContestContext({
        initiatorStats: { physical: 60, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        opponentStats: { physical: 40, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(context);
      const check = results[0].check;
      expect(check).not.toBeNull();
      expect(check!.type).toBe('contested');
      if (check!.type === 'contested') {
        expect(check!.initiator.stat).toBe('physical');
        expect(check!.opponent.stat).toBe('physical');
        expect(check!.opponentId).toBe('CHAR_opponent');
        expect(check!.opponentName).toBeDefined();
        expect(check!.initiator.statValue).toBe(60); // initiator has physical 60
        expect(check!.opponent.statValue).toBe(40); // opponent has physical 40
      }
    });

    it('standard CheckDetail has correct type discriminant', () => {
      const ruleset = createBasicRuleset(() => 0.01);
      const ctx = createTestContext({
        stats: { physical: 50, mental: 50, social: 50 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(ctx);
      expect(results[0].check?.type).toBe('standard');
    });

    it('mechanicalSummary contains contested label for opposed checks', () => {
      let callCount = 0;
      const ruleset = createBasicRuleset(() => {
        callCount++;
        return callCount === 1 ? 0.1 : 0.8;
      });
      const { context } = createContestContext({
        initiatorStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        opponentStats: { physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 },
        difficulty: 'moderate',
        suggestedStat: 'physical',
      });
      const results = ruleset.resolve(context);
      expect(results[0].mechanicalSummary).toContain('Contested');
      expect(results[0].mechanicalSummary).toContain('physical');
    });
  });

  describe('contested onActionComplete effects', () => {
    function makeContestedContext(opts: {
      outcome: 'success' | 'partial' | 'failure';
      difficulty: DifficultyClass;
      stat: string;
      initiatorPoise?: number;
      opponentPoise?: number;
    }) {
      const character = createTestCharacter({
        physical: 50, mental: 50, social: 50,
        poise: opts.initiatorPoise ?? 50, max_poise: 50,
        bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0,
      });
      const opponent = createTestCharacter({
        physical: 50, mental: 50, social: 50,
        poise: opts.opponentPoise ?? 50, max_poise: 50,
        bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0,
      });
      opponent.id = 'CHAR_opponent';
      return {
        character,
        action: {
          type: 'Action' as const, intent: 'attack', targetRef: null, targetId: 'CHAR_opponent',
          suggestedDifficulty: opts.difficulty, suggestedStat: opts.stat, opposedBy: 'CHAR_opponent', actionId: null, combatInitiated: false,
        },
        resolution: {
          actionIndex: 0, checkRequired: true, outcome: opts.outcome, margin: 10,
          check: {
            type: 'contested' as const,
            initiator: { stat: opts.stat, statValue: 50, roll: 30, modifier: 0, target: 50 },
            opponent: { stat: opts.stat, statValue: 50, roll: 70, modifier: 0, target: 50 },
            opponentId: 'CHAR_opponent',
            opponentName: 'Guard',
          },
          mechanicalSummary: 'test',
        },
        opponent,
      };
    }

    it('both characters get stat usage in contested check', () => {
      const ruleset = createBasicRuleset();
      const ctx = makeContestedContext({ outcome: 'success', difficulty: 'moderate', stat: 'physical' });
      const effects = ruleset.onActionComplete(ctx);
      const usageEffects = effects.filter((e) => e.type === 'increment_stat_usage');
      expect(usageEffects).toHaveLength(2);
      expect(usageEffects.find((e) => e.type === 'increment_stat_usage' && e.characterId === 'CHAR_test')).toBeDefined();
      expect(usageEffects.find((e) => e.type === 'increment_stat_usage' && e.characterId === 'CHAR_opponent')).toBeDefined();
    });

    it('winner gets poise boost in contested check', () => {
      const ruleset = createBasicRuleset();
      const ctx = makeContestedContext({ outcome: 'success', difficulty: 'moderate', stat: 'physical' });
      const effects = ruleset.onActionComplete(ctx);
      const winnerPoise = effects.find(
        (e) => e.type === 'modify_stat' && e.characterId === 'CHAR_test' && e.stat === 'poise'
      );
      expect(winnerPoise).toBeDefined();
      expect(winnerPoise!.type === 'modify_stat' && winnerPoise!.delta).toBe(5); // confidence boost
    });

    it('loser gets poise loss in contested check', () => {
      const ruleset = createBasicRuleset();
      const ctx = makeContestedContext({ outcome: 'success', difficulty: 'moderate', stat: 'physical' });
      const effects = ruleset.onActionComplete(ctx);
      const loserPoise = effects.find(
        (e) => e.type === 'modify_stat' && e.characterId === 'CHAR_opponent' && e.stat === 'poise'
      );
      expect(loserPoise).toBeDefined();
      expect(loserPoise!.type === 'modify_stat' && loserPoise!.delta).toBe(-10); // moderate cost
    });

    it('loser gets ailment when poise depleted in contested check', () => {
      const ruleset = createBasicRuleset();
      const ctx = makeContestedContext({
        outcome: 'success', difficulty: 'moderate', stat: 'physical', opponentPoise: 5,
      });
      const effects = ruleset.onActionComplete(ctx);
      const ailmentEffect = effects.find(
        (e) => e.type === 'apply_condition' && e.characterId === 'CHAR_opponent'
      );
      expect(ailmentEffect).toBeDefined();
      expect(ailmentEffect!.type === 'apply_condition' && ailmentEffect!.conditionId).toBe('wound');
    });

    it('draw → both take minor poise cost', () => {
      const ruleset = createBasicRuleset();
      const ctx = makeContestedContext({ outcome: 'partial', difficulty: 'moderate', stat: 'physical' });
      const effects = ruleset.onActionComplete(ctx);
      const poiseEffects = effects.filter((e) => e.type === 'modify_stat' && 'stat' in e && e.stat === 'poise');
      expect(poiseEffects).toHaveLength(2);
      for (const effect of poiseEffects) {
        expect(effect.type === 'modify_stat' && effect.delta).toBe(-3);
      }
    });

    it('when initiator loses, opponent gets poise boost', () => {
      const ruleset = createBasicRuleset();
      const ctx = makeContestedContext({ outcome: 'failure', difficulty: 'moderate', stat: 'physical' });
      const effects = ruleset.onActionComplete(ctx);
      const opponentBoost = effects.find(
        (e) => e.type === 'modify_stat' && e.characterId === 'CHAR_opponent' && e.stat === 'poise' && e.delta > 0
      );
      expect(opponentBoost).toBeDefined();
      expect(opponentBoost!.type === 'modify_stat' && opponentBoost!.delta).toBe(5);
      // Initiator loses → poise cost
      const initiatorLoss = effects.find(
        (e) => e.type === 'modify_stat' && e.characterId === 'CHAR_test' && e.stat === 'poise' && e.delta < 0
      );
      expect(initiatorLoss).toBeDefined();
    });

    it('standard check with opponent null still works (regression)', () => {
      const ruleset = createBasicRuleset();
      const character = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onActionComplete({
        character,
        action: { type: 'Action', intent: 'climb', targetRef: null, targetId: null, suggestedDifficulty: 'moderate', suggestedStat: 'physical', opposedBy: null, actionId: null, combatInitiated: false },
        resolution: {
          actionIndex: 0, checkRequired: true, outcome: 'success', margin: 10,
          check: { type: 'standard' as const, stat: 'physical', statValue: 50, roll: 40, modifier: 0, target: 50 },
          mechanicalSummary: 'test',
        },
        opponent: null,
      });
      const usageEffect = effects.find((e) => e.type === 'increment_stat_usage');
      expect(usageEffect).toBeDefined();
    });
  });

  describe('generateStats includes poise and vitals', () => {
    it('initializes poise at max (derived from base stat average)', () => {
      const ruleset = createBasicRuleset(() => 0.5);
      const stats = ruleset.generateStats({ purpose: 'guard' });
      // guard: physical 60, mental 45, social 40 → avg = floor(145/3) = 48
      expect(stats.max_poise).toBe(48);
      expect(stats.poise).toBe(48);
    });

    it('initializes all vitals at 0', () => {
      const ruleset = createBasicRuleset();
      const stats = ruleset.generateStats({ purpose: null });
      expect(stats.bloodloss).toBe(0);
      expect(stats.anxiety).toBe(0);
      expect(stats.fatigue).toBe(0);
      expect(stats.hunger).toBe(0);
    });
  });

  // ==========================================================================
  // FEAT-176: Incapacitation, Death, Hunger Cascade
  // ==========================================================================

  describe('incapacitationConfig on stat definitions', () => {
    it('bloodloss has incapacitationConfig with priority 1 and deathAfterMinutes 30', () => {
      const ruleset = createBasicRuleset();
      const bloodloss = ruleset.statDefinitions.find((s) => s.id === 'bloodloss')!;
      expect(bloodloss.incapacitationConfig).toEqual(expect.objectContaining({
        name: 'Unconscious',
        priority: 1,
        deathAfterMinutes: 30,
        allowedActionTypes: [],
      }));
    });

    it('anxiety has incapacitationConfig with priority 2 and no death', () => {
      const ruleset = createBasicRuleset();
      const anxiety = ruleset.statDefinitions.find((s) => s.id === 'anxiety')!;
      expect(anxiety.incapacitationConfig).toEqual(expect.objectContaining({
        name: 'Panicking',
        priority: 2,
        deathAfterMinutes: null,
        allowedActionTypes: ['Action', 'Transition'],
      }));
    });

    it('fatigue has incapacitationConfig with priority 3 and no death', () => {
      const ruleset = createBasicRuleset();
      const fatigue = ruleset.statDefinitions.find((s) => s.id === 'fatigue')!;
      expect(fatigue.incapacitationConfig).toEqual(expect.objectContaining({
        name: 'Collapsed',
        priority: 3,
        deathAfterMinutes: null,
      }));
    });

    it('hunger has no incapacitationConfig', () => {
      const ruleset = createBasicRuleset();
      const hunger = ruleset.statDefinitions.find((s) => s.id === 'hunger')!;
      expect(hunger.incapacitationConfig).toBeNull();
    });

    it('non-vital stats have null incapacitationConfig', () => {
      const ruleset = createBasicRuleset();
      const nonVitals = ruleset.statDefinitions.filter(
        (s) => s.category !== 'vital'
      );
      for (const def of nonVitals) {
        expect(def.incapacitationConfig).toBeNull();
      }
    });
  });

  describe('onTimeTick incapacitation', () => {
    const DATE_A = '2026-01-01T12:00:00Z';
    const DATE_B = '2026-01-01T12:15:00Z';

    function makeIncapContext(
      stats: Record<string, number>,
      overrides?: { incapacitation?: string | null; incapacitatedSince?: string | null; deathdate?: string | null }
    ) {
      const char = createTestCharacter({
        ...stats,
        poise: stats.poise ?? 50,
        max_poise: stats.max_poise ?? 50,
      });
      char.info.rulesetState.incapacitation = overrides?.incapacitation ?? null;
      char.info.rulesetState.incapacitatedSince = overrides?.incapacitatedSince ?? null;
      if (overrides?.deathdate !== undefined) {
        char.info.deathdate = overrides.deathdate;
      }
      return char;
    }

    it('emits set_incapacitation when bloodloss reaches 100', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext({ physical: 50, mental: 50, social: 50, bloodloss: 100 });
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const incap = effects.find((e) => e.type === 'set_incapacitation');
      expect(incap).toBeDefined();
      expect(incap!.type === 'set_incapacitation' && incap!.vitalId).toBe('bloodloss');
    });

    it('emits set_incapacitation when anxiety reaches 100', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext({ physical: 50, mental: 50, social: 50, anxiety: 100 });
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const incap = effects.find((e) => e.type === 'set_incapacitation');
      expect(incap).toBeDefined();
      expect(incap!.type === 'set_incapacitation' && incap!.vitalId).toBe('anxiety');
    });

    it('emits set_incapacitation when fatigue reaches 100', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext({ physical: 50, mental: 50, social: 50, fatigue: 100 });
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const incap = effects.find((e) => e.type === 'set_incapacitation');
      expect(incap).toBeDefined();
      expect(incap!.type === 'set_incapacitation' && incap!.vitalId).toBe('fatigue');
    });

    it('clears incapacitation when causing vital drops below 100', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext(
        { physical: 50, mental: 50, social: 50, bloodloss: 90 },
        { incapacitation: 'bloodloss', incapacitatedSince: DATE_A }
      );
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const clear = effects.find(
        (e) => e.type === 'set_incapacitation' && e.vitalId === null
      );
      expect(clear).toBeDefined();
    });

    it('does not re-emit set_incapacitation if already incapacitated by same vital at >= 100', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext(
        { physical: 50, mental: 50, social: 50, bloodloss: 100 },
        { incapacitation: 'bloodloss', incapacitatedSince: DATE_A }
      );
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const incapEffects = effects.filter((e) => e.type === 'set_incapacitation');
      expect(incapEffects).toHaveLength(0);
    });

    it('picks highest priority vital when multiple are at 100', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext({ physical: 50, mental: 50, social: 50, bloodloss: 100, fatigue: 100 });
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const incap = effects.find((e) => e.type === 'set_incapacitation' && e.vitalId !== null);
      expect(incap).toBeDefined();
      expect(incap!.type === 'set_incapacitation' && incap!.vitalId).toBe('bloodloss');
    });

    it('clears one incapacitation and picks next vital if still >= 100', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext(
        { physical: 50, mental: 50, social: 50, bloodloss: 90, fatigue: 100 },
        { incapacitation: 'bloodloss', incapacitatedSince: DATE_A }
      );
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const clear = effects.find(
        (e) => e.type === 'set_incapacitation' && e.vitalId === null
      );
      expect(clear).toBeDefined();
      const reincap = effects.find(
        (e) => e.type === 'set_incapacitation' && e.vitalId === 'fatigue'
      );
      expect(reincap).toBeDefined();
    });

    it('hunger at 100 does NOT trigger incapacitation', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext({ physical: 50, mental: 50, social: 50, hunger: 100 });
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 15, previousDate: DATE_A, newDate: DATE_B });
      const incap = effects.find((e) => e.type === 'set_incapacitation');
      expect(incap).toBeUndefined();
    });

    it('RulesetState incapacitation and incapacitatedSince default to null', () => {
      const ruleset = createBasicRuleset();
      const char = makeIncapContext({ physical: 50, mental: 50, social: 50 });
      expect(char.info.rulesetState.incapacitation).toBeNull();
      expect(char.info.rulesetState.incapacitatedSince).toBeNull();
    });
  });

  describe('onTimeTick death timer', () => {
    it('emits set_death when unconscious for 30+ game-minutes', () => {
      const ruleset = createBasicRuleset();
      const onset = '2026-01-01T12:00:00Z';
      const now = '2026-01-01T12:31:00Z';
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 100, anxiety: 0, fatigue: 0, hunger: 0 });
      char.info.rulesetState.incapacitation = 'bloodloss';
      char.info.rulesetState.incapacitatedSince = onset;
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 1, previousDate: '2026-01-01T12:30:00Z', newDate: now });
      const death = effects.find((e) => e.type === 'set_death');
      expect(death).toBeDefined();
    });

    it('does NOT emit set_death when unconscious for < 30 game-minutes', () => {
      const ruleset = createBasicRuleset();
      const onset = '2026-01-01T12:00:00Z';
      const now = '2026-01-01T12:29:00Z';
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 100, anxiety: 0, fatigue: 0, hunger: 0 });
      char.info.rulesetState.incapacitation = 'bloodloss';
      char.info.rulesetState.incapacitatedSince = onset;
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 1, previousDate: '2026-01-01T12:28:00Z', newDate: now });
      const death = effects.find((e) => e.type === 'set_death');
      expect(death).toBeUndefined();
    });

    it('non-fatal incapacitation (anxiety) never emits set_death regardless of duration', () => {
      const ruleset = createBasicRuleset();
      const onset = '2026-01-01T10:00:00Z';
      const now = '2026-01-01T14:00:00Z';
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 100, fatigue: 0, hunger: 0 });
      char.info.rulesetState.incapacitation = 'anxiety';
      char.info.rulesetState.incapacitatedSince = onset;
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 60, previousDate: '2026-01-01T13:00:00Z', newDate: now });
      const death = effects.find((e) => e.type === 'set_death');
      expect(death).toBeUndefined();
    });
  });

  describe('onTimeTick dead character skip', () => {
    it('skips all processing for dead characters', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 0, max_poise: 50, bloodloss: 100, anxiety: 100, fatigue: 100, hunger: 100 });
      char.info.deathdate = '2026-01-01T12:00:00Z';
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 60, previousDate: '2026-01-01T12:00:00Z', newDate: '2026-01-01T13:00:00Z' });
      expect(effects).toHaveLength(0);
    });
  });

  describe('onTimeTick hunger cascade', () => {
    it('feeds fatigue at +0.5/min when hunger >= 100', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 100 });
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 10, previousDate: '2026-01-01T12:00:00Z', newDate: '2026-01-01T12:10:00Z' });
      const fatigueFeed = effects.find(
        (e) => e.type === 'modify_stat' && e.stat === 'fatigue' && e.reason.includes('Hunger cascade')
      );
      expect(fatigueFeed).toBeDefined();
      expect(fatigueFeed!.type === 'modify_stat' && fatigueFeed!.delta).toBe(5); // 0.5 * 10 min
    });

    it('does not cascade fatigue when hunger < 100', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 90 });
      const effects = ruleset.onTimeTick({ character: char, minutesElapsed: 10, previousDate: '2026-01-01T12:00:00Z', newDate: '2026-01-01T12:10:00Z' });
      const fatigueFeed = effects.find(
        (e) => e.type === 'modify_stat' && e.stat === 'fatigue' && e.reason.includes('Hunger cascade')
      );
      expect(fatigueFeed).toBeUndefined();
    });
  });

  describe('onTimeTick disabledVitals (FEAT-344)', () => {
    it('skips hunger drift when hunger is disabled', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 60, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const hungerEffect = effects.find((e) => e.type === 'modify_stat' && e.stat === 'hunger');
      expect(hungerEffect).toBeUndefined();
    });

    it('skips fatigue recovery when fatigue is disabled', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 30, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 10, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const fatigueEffect = effects.find((e) => e.type === 'modify_stat' && e.stat === 'fatigue');
      expect(fatigueEffect).toBeUndefined();
    });

    it('still ticks bloodloss and anxiety when hunger/fatigue are disabled', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 20, anxiety: 20, fatigue: 0, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 10, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const bloodlossRecovery = effects.find((e) => e.type === 'modify_stat' && e.stat === 'bloodloss');
      const anxietyRecovery = effects.find((e) => e.type === 'modify_stat' && e.stat === 'anxiety');
      expect(bloodlossRecovery).toBeDefined();
      expect(anxietyRecovery).toBeDefined();
    });

    it('skips ailment contributions to disabled vitals', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      char.info.rulesetState.conditions = [{ typeId: 'exhaustion', severity: 2 }];
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 10, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const fatigueFromAilment = effects.find(
        (e) => e.type === 'modify_stat' && e.stat === 'fatigue'
      );
      expect(fatigueFromAilment).toBeUndefined();
    });

    it('still applies ailment contributions to non-disabled vitals', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      char.info.rulesetState.conditions = [{ typeId: 'wound', severity: 2 }];
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 1, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const bloodlossFromWound = effects.find(
        (e) => e.type === 'modify_stat' && e.stat === 'bloodloss'
      );
      expect(bloodlossFromWound).toBeDefined();
    });

    it('skips hunger cascade when hunger is disabled', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 100 });
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 10, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const cascadeEffect = effects.find(
        (e) => e.type === 'modify_stat' && e.stat === 'fatigue' && e.reason.includes('Hunger cascade')
      );
      expect(cascadeEffect).toBeUndefined();
    });

    it('skips incapacitation for disabled vitals', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 100, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 1, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const incapEffect = effects.find(
        (e) => e.type === 'set_incapacitation' && e.vitalId === 'fatigue'
      );
      expect(incapEffect).toBeUndefined();
    });

    it('clears incapacitation when its causing vital becomes disabled', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 50, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 100, hunger: 0 });
      char.info.rulesetState.incapacitation = 'fatigue';
      char.info.rulesetState.incapacitatedSince = '2026-01-01T12:00:00Z';
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 1, previousDate: '2026-01-01T12:00:00Z', newDate: '2026-01-01T12:01:00Z',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const clearIncap = effects.find(
        (e) => e.type === 'set_incapacitation' && e.vitalId === null
      );
      expect(clearIncap).toBeDefined();
    });

    it('still recovers poise when hunger/fatigue are disabled', () => {
      const ruleset = createBasicRuleset();
      const char = createTestCharacter({ physical: 50, mental: 50, social: 50, poise: 30, max_poise: 50, bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0 });
      const effects = ruleset.onTimeTick({
        character: char, minutesElapsed: 5, previousDate: '1.1.100', newDate: '1.1.100',
        disabledVitals: ['hunger', 'fatigue'],
      });
      const poiseEffect = effects.find((e) => e.type === 'modify_stat' && e.stat === 'poise');
      expect(poiseEffect).toBeDefined();
      expect(poiseEffect!.type === 'modify_stat' && poiseEffect!.delta).toBe(10);
    });
  });
});
