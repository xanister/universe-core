/**
 * Stat Generator Helper
 *
 * Computes initial stats for a character using the universe's active ruleset.
 * Returns empty object when no ruleset is active.
 */

import { getRuleset } from './registry.js';
import { computeMaxPoise } from './basic/basic-ruleset.js';
import type { Universe } from '@dmnpc/types/entity';

/**
 * Generate default stats for a new character using the universe's active ruleset.
 * Returns an empty object when the universe has no ruleset (rulesetId is null).
 *
 * @param universe The universe whose ruleset determines stat generation.
 * @param purpose Character purpose (e.g. 'guard', 'merchant'). Drives stat biases in rulesets
 *                that support purpose-aware generation. Null for player characters or unspecified.
 */
export function generateDefaultStats(
  universe: Universe,
  purpose: string | null,
): Record<string, number> {
  if (!universe.rulesetId) return {};
  const ruleset = getRuleset(universe.rulesetId);
  return ruleset.generateStats({ purpose });
}

/**
 * Ensure user-allocated base stats include derived values (poise/max_poise, vitals).
 *
 * The character creator wizard only sends allocatable base stats (physical, mental, social).
 * This generates a full default template from the ruleset, overlays the user's allocations,
 * then recomputes poise from the (potentially modified) base stats.
 *
 * Returns the input unchanged when no ruleset is active or stats are empty.
 */
export function completeStats(
  universe: Universe,
  userStats: Record<string, number>,
): Record<string, number> {
  if (!universe.rulesetId || Object.keys(userStats).length === 0) return userStats;

  const ruleset = getRuleset(universe.rulesetId);
  const template = ruleset.generateStats({ purpose: null });

  const completed = { ...template, ...userStats };

  const maxPoise = computeMaxPoise(completed);
  completed.poise = maxPoise;
  completed.max_poise = maxPoise;

  return completed;
}
