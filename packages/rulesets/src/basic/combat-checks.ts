/**
 * Combat-specific check resolution for the battle engine.
 *
 * Pure functions that use d100 percentile rolling with numeric modifiers
 * (not DifficultyClass enum). The battle engine computes its own difficulty
 * from target stats instead of relying on LLM classification.
 *
 * FEAT-190: Battle Engine (Combat & Equipment System — Phase 4)
 */

import { rollD100 } from '../dice.js';

// ============================================================================
// Types
// ============================================================================

export interface CombatCheckResult {
  /** The d100 roll (1-100). */
  roll: number;
  /** Computed success chance (clamped 5-95). */
  successChance: number;
  /** Outcome tier. */
  outcome: 'success' | 'partial' | 'failure';
  /** successChance - roll. Positive = succeeded by this much. */
  margin: number;
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolve a combat check: d100 roll against effective stat + modifier.
 *
 * Same percentile thresholds as BasicRuleset's rollPercentile:
 * - roll <= successChance → success
 * - roll <= successChance + 15 → partial
 * - roll > successChance + 15 → failure
 *
 * @param effectiveStat The attacker's effective stat value (already includes modifiers).
 * @param modifier Numeric modifier (negative = harder, positive = easier).
 *                 For combat: typically -(targetEffectiveStat / 3).
 * @param randomFn Optional custom random function for deterministic tests.
 */
export function resolveCombatCheck(
  effectiveStat: number,
  modifier: number,
  randomFn?: () => number,
): CombatCheckResult {
  const successChance = clamp(effectiveStat + modifier, 5, 95);
  const roll = rollD100(randomFn);

  let outcome: 'success' | 'partial' | 'failure';
  if (roll <= successChance) {
    outcome = 'success';
  } else if (roll <= successChance + 15) {
    outcome = 'partial';
  } else {
    outcome = 'failure';
  }

  return { roll, successChance, outcome, margin: successChance - roll };
}

/**
 * Resolve a contested combat check between two participants.
 *
 * Both roll against the same stat. Winner determined by:
 * 1. Outcome tier (success > partial > failure)
 * 2. Margin (higher wins)
 * 3. Effective stat (higher wins)
 * 4. True tie → draw (both get partial)
 *
 * @param attackerStat Attacker's effective stat.
 * @param defenderStat Defender's effective stat.
 * @param defenderBonus Extra bonus for the defender (e.g. +15 for Defend stance).
 * @param randomFn Optional custom random function for deterministic tests.
 */
export function resolveContestedCombatCheck(
  attackerStat: number,
  defenderStat: number,
  defenderBonus: number,
  randomFn?: () => number,
): {
  attacker: CombatCheckResult;
  defender: CombatCheckResult;
  winner: 'attacker' | 'defender' | 'draw';
} {
  const attackerResult = resolveCombatCheck(attackerStat, 0, randomFn);
  const defenderResult = resolveCombatCheck(defenderStat, defenderBonus, randomFn);

  const tierMap: Record<string, number> = { success: 3, partial: 2, failure: 1 };
  const aTier = tierMap[attackerResult.outcome];
  const dTier = tierMap[defenderResult.outcome];

  let winner: 'attacker' | 'defender' | 'draw';

  if (aTier > dTier) {
    winner = 'attacker';
  } else if (aTier < dTier) {
    winner = 'defender';
  } else if (attackerResult.margin > defenderResult.margin) {
    winner = 'attacker';
  } else if (attackerResult.margin < defenderResult.margin) {
    winner = 'defender';
  } else if (attackerStat > defenderStat) {
    winner = 'attacker';
  } else if (attackerStat < defenderStat) {
    winner = 'defender';
  } else {
    winner = 'draw';
  }

  return { attacker: attackerResult, defender: defenderResult, winner };
}

// ============================================================================
// Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
