/**
 * Modifier stacking system for stat computation.
 *
 * Pure functions for collecting, categorizing, and stacking stat modifiers from
 * multiple sources (conditions, equipment, vital thresholds).
 *
 * Stacking rule (Pathfinder 2e adapted):
 * - Bonuses: same-type non-stacking (highest bonus per sourceType per stat wins)
 * - Penalties: all accumulate (preserves existing ailment balance)
 * - Different sourceTypes always stack
 *
 * FEAT-189: Modifier Stacking (Combat & Equipment System — Phase 3)
 */

import type {
  StatModifier,
  StatModifierSourceType,
  ConditionInstance,
  ConditionDefinition,
} from '@dmnpc/types/combat';

// ============================================================================
// Vital Threshold Data (shared with basic-ruleset.ts)
// ============================================================================

export interface VitalThreshold {
  value: number;
  statPenalties: Record<string, number>;
}

export interface VitalThresholdConfig {
  vitalId: string;
  vitalName: string;
  thresholds: VitalThreshold[];
}

// ============================================================================
// Collector
// ============================================================================

/**
 * Collect all stat modifiers from conditions, equipment, and vital thresholds.
 *
 * Returns an unsorted array of StatModifier entries. Does not apply stacking —
 * use applyModifierStacking() on the result to compute effective deltas.
 */
export function collectStatModifiers(opts: {
  conditions: ConditionInstance[];
  conditionDefs: ConditionDefinition[];
  weaponStatModifiers: Record<string, number>;
  weaponName: string | null;
  vitalStats: Record<string, number>;
  vitalThresholdConfigs: VitalThresholdConfig[];
}): StatModifier[] {
  const modifiers: StatModifier[] = [];

  // 1. Condition modifiers (scaled by severity)
  const defMap = new Map<string, ConditionDefinition>();
  for (const def of opts.conditionDefs) {
    defMap.set(def.id, def);
  }

  for (const condition of opts.conditions) {
    const def = defMap.get(condition.typeId);
    if (!def) continue;

    for (const [stat, mod] of Object.entries(def.statModifiers)) {
      if (mod === 0) continue;
      const scaledMod = mod * condition.severity;
      const source = condition.severity > 1 ? `${def.name} ×${condition.severity}` : def.name;
      modifiers.push({
        source,
        sourceType: 'condition',
        stat,
        value: scaledMod,
      });
    }
  }

  // 2. Equipment modifiers (from weapon)
  const weaponLabel = opts.weaponName ?? 'Weapon';
  for (const [stat, value] of Object.entries(opts.weaponStatModifiers)) {
    if (value === 0) continue;
    modifiers.push({
      source: weaponLabel,
      sourceType: 'equipment',
      stat,
      value,
    });
  }

  // 3. Vital threshold penalties
  for (const config of opts.vitalThresholdConfigs) {
    const vitalValue = opts.vitalStats[config.vitalId] ?? 0;
    for (const threshold of config.thresholds) {
      if (vitalValue < threshold.value) continue;
      for (const [stat, penalty] of Object.entries(threshold.statPenalties)) {
        if (penalty === 0) continue;
        modifiers.push({
          source: `${config.vitalName} ≥${threshold.value}`,
          sourceType: 'vital_threshold',
          stat,
          value: penalty,
        });
      }
    }
  }

  return modifiers;
}

// ============================================================================
// Stacking
// ============================================================================

/**
 * Apply modifier stacking rules and return the total effective delta for one stat.
 *
 * Stacking rule:
 * - Bonuses (value > 0): within each sourceType, only the highest bonus applies.
 *   Across different sourceTypes, bonuses stack.
 * - Penalties (value < 0): all accumulate regardless of sourceType.
 *
 * @param modifiers All modifiers for a single stat (pre-filtered by caller).
 */
export function computeStackedDelta(modifiers: StatModifier[]): number {
  if (modifiers.length === 0) return 0;

  let totalDelta = 0;

  // Penalties: all accumulate
  for (const mod of modifiers) {
    if (mod.value < 0) {
      totalDelta += mod.value;
    }
  }

  // Bonuses: group by sourceType, take highest per group
  const bonusByType = new Map<StatModifierSourceType, number>();
  for (const mod of modifiers) {
    if (mod.value <= 0) continue;
    const current = bonusByType.get(mod.sourceType) ?? 0;
    if (mod.value > current) {
      bonusByType.set(mod.sourceType, mod.value);
    }
  }

  for (const bonus of bonusByType.values()) {
    totalDelta += bonus;
  }

  return totalDelta;
}

/**
 * Filter modifiers for a specific stat and compute stacked delta.
 */
export function computeStackedDeltaForStat(statId: string, allModifiers: StatModifier[]): number {
  const forStat = allModifiers.filter((m) => m.stat === statId);
  return computeStackedDelta(forStat);
}

/**
 * Get the modifiers affecting a specific stat (for tooltip display).
 */
export function getModifiersForStat(statId: string, allModifiers: StatModifier[]): StatModifier[] {
  return allModifiers.filter((m) => m.stat === statId);
}
