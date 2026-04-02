/**
 * Shared random utilities.
 *
 * Consolidates scattered `Math.floor(Math.random() * arr.length)` patterns
 * and `randomInt`/`randomBetween` reimplementations into tested helpers.
 */

/**
 * Pick a random element from a non-empty array.
 *
 * @throws Error if the array is empty
 */
export function pickRandomElement<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error('pickRandomElement: array must not be empty');
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Random integer in [min, max] (inclusive both ends).
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random integer in [min, max] (inclusive) using a custom RNG function.
 * The RNG function must return a value in [0, 1).
 */
export function randomIntWithRng(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
