/**
 * Tests for the modifier stacking system (FEAT-189).
 *
 * Covers:
 * - collectStatModifiers: gathering modifiers from conditions, equipment, vital thresholds
 * - computeStackedDelta: bonus non-stacking, penalty accumulation
 * - computeStackedDeltaForStat: per-stat filtering
 * - Integration with BasicRuleset (weapon modifiers affect resolution)
 */

import { describe, it, expect } from 'vitest';
import type { ConditionDefinition, ConditionInstance, StatModifier } from '@dmnpc/types/combat';
import {
  collectStatModifiers,
  computeStackedDelta,
  computeStackedDeltaForStat,
  getModifiersForStat,
  type VitalThresholdConfig,
} from '../../src/basic/modifier-stacking.js';

// ============================================================================
// Test Data
// ============================================================================

const WOUND_DEF: ConditionDefinition = {
  id: 'wound',
  name: 'Wound',
  description: 'Physical injury.',
  category: 'physical',
  statModifiers: { physical: -5 },
};

const EXHAUSTION_DEF: ConditionDefinition = {
  id: 'exhaustion',
  name: 'Exhaustion',
  description: 'Physical exhaustion.',
  category: 'physical',
  statModifiers: { physical: -3, mental: -2 },
};

const HUMILIATION_DEF: ConditionDefinition = {
  id: 'humiliation',
  name: 'Humiliation',
  description: 'Social defeat.',
  category: 'social',
  statModifiers: { social: -5, charisma: -3 },
};

const CONDITION_DEFS = [WOUND_DEF, EXHAUSTION_DEF, HUMILIATION_DEF];

const BLOODLOSS_CONFIG: VitalThresholdConfig = {
  vitalId: 'bloodloss',
  vitalName: 'Blood Loss',
  thresholds: [
    { value: 50, statPenalties: { physical: -5 } },
    { value: 75, statPenalties: { physical: -10, dexterity: -10 } },
  ],
};

const FATIGUE_CONFIG: VitalThresholdConfig = {
  vitalId: 'fatigue',
  vitalName: 'Fatigue',
  thresholds: [
    { value: 50, statPenalties: { physical: -3, mental: -3 } },
    { value: 75, statPenalties: { physical: -5, mental: -5, social: -5 } },
  ],
};

const VITAL_CONFIGS = [BLOODLOSS_CONFIG, FATIGUE_CONFIG];

// ============================================================================
// collectStatModifiers
// ============================================================================

describe('collectStatModifiers', () => {
  it('returns empty array when no modifiers exist', () => {
    const result = collectStatModifiers({
      conditions: [],
      conditionDefs: CONDITION_DEFS,
      weaponStatModifiers: {},
      weaponName: null,
      vitalStats: { bloodloss: 0, fatigue: 0 },
      vitalThresholdConfigs: VITAL_CONFIGS,
    });
    expect(result).toEqual([]);
  });

  it('collects condition modifiers scaled by severity', () => {
    const conditions: ConditionInstance[] = [{ typeId: 'wound', severity: 2 }];
    const result = collectStatModifiers({
      conditions,
      conditionDefs: CONDITION_DEFS,
      weaponStatModifiers: {},
      weaponName: null,
      vitalStats: {},
      vitalThresholdConfigs: [],
    });
    expect(result).toEqual([
      { source: 'Wound ×2', sourceType: 'condition', stat: 'physical', value: -10 },
    ]);
  });

  it('collects modifiers from multiple conditions', () => {
    const conditions: ConditionInstance[] = [
      { typeId: 'wound', severity: 1 },
      { typeId: 'exhaustion', severity: 1 },
    ];
    const result = collectStatModifiers({
      conditions,
      conditionDefs: CONDITION_DEFS,
      weaponStatModifiers: {},
      weaponName: null,
      vitalStats: {},
      vitalThresholdConfigs: [],
    });
    expect(result).toHaveLength(3); // wound:physical, exhaustion:physical, exhaustion:mental
    expect(result).toContainEqual({ source: 'Wound', sourceType: 'condition', stat: 'physical', value: -5 });
    expect(result).toContainEqual({ source: 'Exhaustion', sourceType: 'condition', stat: 'physical', value: -3 });
    expect(result).toContainEqual({ source: 'Exhaustion', sourceType: 'condition', stat: 'mental', value: -2 });
  });

  it('skips unknown condition types', () => {
    const conditions: ConditionInstance[] = [{ typeId: 'unknown', severity: 1 }];
    const result = collectStatModifiers({
      conditions,
      conditionDefs: CONDITION_DEFS,
      weaponStatModifiers: {},
      weaponName: null,
      vitalStats: {},
      vitalThresholdConfigs: [],
    });
    expect(result).toEqual([]);
  });

  it('collects weapon equipment modifiers', () => {
    const result = collectStatModifiers({
      conditions: [],
      conditionDefs: [],
      weaponStatModifiers: { physical: 3, dexterity: 1 },
      weaponName: 'Iron Sword',
      vitalStats: {},
      vitalThresholdConfigs: [],
    });
    expect(result).toEqual([
      { source: 'Iron Sword', sourceType: 'equipment', stat: 'physical', value: 3 },
      { source: 'Iron Sword', sourceType: 'equipment', stat: 'dexterity', value: 1 },
    ]);
  });

  it('uses fallback label when weaponName is null', () => {
    const result = collectStatModifiers({
      conditions: [],
      conditionDefs: [],
      weaponStatModifiers: { physical: 3 },
      weaponName: null,
      vitalStats: {},
      vitalThresholdConfigs: [],
    });
    expect(result).toEqual([
      { source: 'Weapon', sourceType: 'equipment', stat: 'physical', value: 3 },
    ]);
  });

  it('skips weapon modifiers when weaponStatModifiers is empty', () => {
    const result = collectStatModifiers({
      conditions: [],
      conditionDefs: [],
      weaponStatModifiers: {},
      weaponName: 'Iron Sword',
      vitalStats: {},
      vitalThresholdConfigs: [],
    });
    expect(result).toEqual([]);
  });

  it('collects vital threshold penalties when threshold crossed', () => {
    const result = collectStatModifiers({
      conditions: [],
      conditionDefs: [],
      weaponStatModifiers: {},
      weaponName: null,
      vitalStats: { bloodloss: 60, fatigue: 0 },
      vitalThresholdConfigs: VITAL_CONFIGS,
    });
    expect(result).toEqual([
      { source: 'Blood Loss ≥50', sourceType: 'vital_threshold', stat: 'physical', value: -5 },
    ]);
  });

  it('collects cumulative vital threshold penalties when multiple thresholds crossed', () => {
    const result = collectStatModifiers({
      conditions: [],
      conditionDefs: [],
      weaponStatModifiers: {},
      weaponName: null,
      vitalStats: { bloodloss: 80 },
      vitalThresholdConfigs: [BLOODLOSS_CONFIG],
    });
    expect(result).toHaveLength(3); // ≥50:physical, ≥75:physical, ≥75:dexterity
    expect(result).toContainEqual({ source: 'Blood Loss ≥50', sourceType: 'vital_threshold', stat: 'physical', value: -5 });
    expect(result).toContainEqual({ source: 'Blood Loss ≥75', sourceType: 'vital_threshold', stat: 'physical', value: -10 });
    expect(result).toContainEqual({ source: 'Blood Loss ≥75', sourceType: 'vital_threshold', stat: 'dexterity', value: -10 });
  });

  it('collects modifiers from all sources simultaneously', () => {
    const conditions: ConditionInstance[] = [{ typeId: 'wound', severity: 1 }];
    const result = collectStatModifiers({
      conditions,
      conditionDefs: CONDITION_DEFS,
      weaponStatModifiers: { physical: 5 },
      weaponName: 'Battle Axe',
      vitalStats: { bloodloss: 55 },
      vitalThresholdConfigs: [BLOODLOSS_CONFIG],
    });
    // Wound: physical -5, Battle Axe: physical +5, Blood Loss ≥50: physical -5
    const physicalMods = result.filter((m) => m.stat === 'physical');
    expect(physicalMods).toHaveLength(3);
    expect(physicalMods).toContainEqual({ source: 'Wound', sourceType: 'condition', stat: 'physical', value: -5 });
    expect(physicalMods).toContainEqual({ source: 'Battle Axe', sourceType: 'equipment', stat: 'physical', value: 5 });
    expect(physicalMods).toContainEqual({ source: 'Blood Loss ≥50', sourceType: 'vital_threshold', stat: 'physical', value: -5 });
  });
});

// ============================================================================
// computeStackedDelta
// ============================================================================

describe('computeStackedDelta', () => {
  it('returns 0 for empty modifiers', () => {
    expect(computeStackedDelta([])).toBe(0);
  });

  it('accumulates all penalties', () => {
    const mods: StatModifier[] = [
      { source: 'Wound', sourceType: 'condition', stat: 'physical', value: -5 },
      { source: 'Exhaustion', sourceType: 'condition', stat: 'physical', value: -3 },
    ];
    expect(computeStackedDelta(mods)).toBe(-8);
  });

  it('accumulates penalties across different sourceTypes', () => {
    const mods: StatModifier[] = [
      { source: 'Wound', sourceType: 'condition', stat: 'physical', value: -5 },
      { source: 'Blood Loss ≥50', sourceType: 'vital_threshold', stat: 'physical', value: -5 },
    ];
    expect(computeStackedDelta(mods)).toBe(-10);
  });

  it('takes only the highest bonus per sourceType', () => {
    const mods: StatModifier[] = [
      { source: 'Iron Sword', sourceType: 'equipment', stat: 'physical', value: 3 },
      { source: 'Shield', sourceType: 'equipment', stat: 'physical', value: 2 },
    ];
    // Same sourceType (equipment), only highest bonus (3) applies
    expect(computeStackedDelta(mods)).toBe(3);
  });

  it('stacks bonuses from different sourceTypes', () => {
    const mods: StatModifier[] = [
      { source: 'Iron Sword', sourceType: 'equipment', stat: 'physical', value: 3 },
      { source: 'Blessing', sourceType: 'condition', stat: 'physical', value: 5 },
    ];
    // Different sourceTypes → both apply
    expect(computeStackedDelta(mods)).toBe(8);
  });

  it('combines bonuses and penalties correctly', () => {
    const mods: StatModifier[] = [
      { source: 'Iron Sword', sourceType: 'equipment', stat: 'physical', value: 3 },
      { source: 'Wound', sourceType: 'condition', stat: 'physical', value: -5 },
      { source: 'Blood Loss ≥50', sourceType: 'vital_threshold', stat: 'physical', value: -5 },
    ];
    // +3 (equipment) + -5 (condition) + -5 (vital) = -7
    expect(computeStackedDelta(mods)).toBe(-7);
  });

  it('non-stacking applies per sourceType not globally', () => {
    const mods: StatModifier[] = [
      { source: 'Sword', sourceType: 'equipment', stat: 'physical', value: 3 },
      { source: 'Shield', sourceType: 'equipment', stat: 'physical', value: 2 },
      { source: 'Buff', sourceType: 'condition', stat: 'physical', value: 4 },
    ];
    // equipment: max(3, 2) = 3, condition: 4 → total = 7
    expect(computeStackedDelta(mods)).toBe(7);
  });
});

// ============================================================================
// computeStackedDeltaForStat
// ============================================================================

describe('computeStackedDeltaForStat', () => {
  it('filters modifiers by stat before computing', () => {
    const mods: StatModifier[] = [
      { source: 'Wound', sourceType: 'condition', stat: 'physical', value: -5 },
      { source: 'Exhaustion', sourceType: 'condition', stat: 'mental', value: -2 },
      { source: 'Sword', sourceType: 'equipment', stat: 'physical', value: 3 },
    ];
    expect(computeStackedDeltaForStat('physical', mods)).toBe(-2); // -5 + 3
    expect(computeStackedDeltaForStat('mental', mods)).toBe(-2); // just -2
    expect(computeStackedDeltaForStat('social', mods)).toBe(0); // nothing
  });
});

// ============================================================================
// getModifiersForStat
// ============================================================================

describe('getModifiersForStat', () => {
  it('returns only modifiers for the requested stat', () => {
    const mods: StatModifier[] = [
      { source: 'Wound', sourceType: 'condition', stat: 'physical', value: -5 },
      { source: 'Exhaustion', sourceType: 'condition', stat: 'mental', value: -2 },
    ];
    expect(getModifiersForStat('physical', mods)).toHaveLength(1);
    expect(getModifiersForStat('mental', mods)).toHaveLength(1);
    expect(getModifiersForStat('social', mods)).toHaveLength(0);
  });
});

// ============================================================================
// Integration: weapon modifiers affect BasicRuleset resolution
// ============================================================================

import { createBasicRuleset } from '../../src/basic/basic-ruleset.js';
import type { Place } from '@dmnpc/types/entity';
import type { ResolutionContext } from '@dmnpc/types/combat';
import { createTestCharacter as createMinimalCharacter } from '../helpers/character-factory.js';

describe('BasicRuleset weapon modifier integration', () => {
  it('weapon modifiers increase effective stat in resolution', () => {
    // Deterministic roll: always returns 0.49 → d100 roll of ~50
    const ruleset = createBasicRuleset(() => 0.49);

    const character = createMinimalCharacter({
      physical: 50, mental: 50, social: 50,
      poise: 50, max_poise: 50,
      bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0,
    });

    const baseContext: Omit<ResolutionContext, 'weaponStatModifiers'> = {
      actions: [{
        type: 'Action' as const,
        intent: 'test',
        targetRef: null,
        targetId: null,
        suggestedDifficulty: 'moderate' as const,
        suggestedStat: 'physical',
        opposedBy: null,
        actionId: null,
        combatInitiated: false,
      }],
      character,
      place: { id: 'PLACE_test', label: 'Test' } as Place,
      nearbyCharacters: [],
    };

    // Without weapon modifiers
    const resultNoWeapon = ruleset.resolve({ ...baseContext, weaponStatModifiers: {} });
    // With +5 physical from weapon
    const resultWithWeapon = ruleset.resolve({ ...baseContext, weaponStatModifiers: { physical: 5 } });

    const checkNoWeapon = resultNoWeapon[0].check;
    const checkWithWeapon = resultWithWeapon[0].check;
    expect(checkNoWeapon?.type).toBe('standard');
    expect(checkWithWeapon?.type).toBe('standard');

    if (checkNoWeapon?.type === 'standard' && checkWithWeapon?.type === 'standard') {
      // Weapon bonus raises effective stat by 5
      expect(checkWithWeapon.statValue).toBe(checkNoWeapon.statValue + 5);
      // Success chance (target) also increases by 5
      expect(checkWithWeapon.target).toBe(checkNoWeapon.target + 5);
    }
  });

  it('weapon modifiers do not stack with another equipment bonus (same sourceType)', () => {
    // This tests the stacking rule: two equipment bonuses → only highest applies
    // Currently we only have one equipment source (weapon), but the stacking logic
    // is tested via computeStackedDelta above. This verifies end-to-end behavior.
    const ruleset = createBasicRuleset(() => 0.49);
    const character = createMinimalCharacter({
      physical: 50, mental: 50, social: 50,
      poise: 50, max_poise: 50,
      bloodloss: 0, anxiety: 0, fatigue: 0, hunger: 0,
    });

    const context: ResolutionContext = {
      actions: [{
        type: 'Action' as const,
        intent: 'test',
        targetRef: null,
        targetId: null,
        suggestedDifficulty: 'moderate' as const,
        suggestedStat: 'physical',
        opposedBy: null,
        actionId: null,
        combatInitiated: false,
      }],
      character,
      place: { id: 'PLACE_test', label: 'Test' } as Place,
      nearbyCharacters: [],
      weaponStatModifiers: { physical: 3 },
    };

    const result = ruleset.resolve(context);
    const check = result[0].check;
    expect(check?.type).toBe('standard');
    if (check?.type === 'standard') {
      // physical 50 + weapon 3 = effective 53
      expect(check.statValue).toBe(53);
    }
  });
});
