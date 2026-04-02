import { describe, it, expect } from 'vitest';
import { pickRandomElement, randomInt, randomIntWithRng } from '@dmnpc/core/infra/random-utils.js';

describe('random-utils', () => {
  describe('pickRandomElement', () => {
    it('throws on empty array', () => {
      expect(() => pickRandomElement([])).toThrow('array must not be empty');
    });

    it('returns the only element from a single-element array', () => {
      expect(pickRandomElement([42])).toBe(42);
    });

    it('returns an element from the array', () => {
      const arr = ['a', 'b', 'c', 'd'];
      for (let i = 0; i < 50; i++) {
        expect(arr).toContain(pickRandomElement(arr));
      }
    });
  });

  describe('randomInt', () => {
    it('returns min when min equals max', () => {
      expect(randomInt(5, 5)).toBe(5);
    });

    it('returns values within inclusive range', () => {
      const results = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const val = randomInt(1, 3);
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(3);
        results.add(val);
      }
      // With 200 iterations, all 3 values should appear
      expect(results.size).toBe(3);
    });

    it('works with negative ranges', () => {
      for (let i = 0; i < 50; i++) {
        const val = randomInt(-5, -2);
        expect(val).toBeGreaterThanOrEqual(-5);
        expect(val).toBeLessThanOrEqual(-2);
      }
    });
  });

  describe('randomIntWithRng', () => {
    it('uses the provided RNG function', () => {
      // RNG that always returns 0 → should always pick min
      expect(randomIntWithRng(() => 0, 10, 20)).toBe(10);

      // RNG that returns 0.999... → should pick max
      expect(randomIntWithRng(() => 0.999, 10, 20)).toBe(20);
    });

    it('respects seeded RNG for deterministic output', () => {
      let callCount = 0;
      const deterministicRng = () => {
        callCount++;
        return 0.5;
      };
      // 0.5 * (20 - 10 + 1) = 5.5, floor = 5, + 10 = 15
      expect(randomIntWithRng(deterministicRng, 10, 20)).toBe(15);
      expect(callCount).toBe(1);
    });
  });
});
