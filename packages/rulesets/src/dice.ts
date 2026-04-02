/**
 * Dice utilities for ruleset resolution.
 * Provides roll functions with optional seed for deterministic tests.
 */

/**
 * Roll a d20 (1-20).
 * @param randomFn Optional custom random function (returns 0-1). Defaults to Math.random.
 *                 Pass a seeded function for deterministic tests.
 */
export function rollD20(randomFn: () => number = Math.random): number {
  return Math.floor(randomFn() * 20) + 1;
}

/**
 * Roll a d100 (1-100).
 * @param randomFn Optional custom random function (returns 0-1). Defaults to Math.random.
 *                 Pass a seeded function for deterministic tests.
 */
export function rollD100(randomFn: () => number = Math.random): number {
  return Math.floor(randomFn() * 100) + 1;
}
