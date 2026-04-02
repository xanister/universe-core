import { describe, it, expect } from 'vitest';
import { rollD20, rollD100 } from '@dmnpc/rulesets/dice.js';

describe('rollD20', () => {
  it('returns a value between 1 and 20 with default random', () => {
    for (let i = 0; i < 100; i++) {
      const result = rollD20();
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(20);
    }
  });

  it('returns 1 when random returns 0', () => {
    expect(rollD20(() => 0)).toBe(1);
  });

  it('returns 20 when random returns just below 1', () => {
    expect(rollD20(() => 0.999)).toBe(20);
  });

  it('produces deterministic results with a fixed seed function', () => {
    let seed = 0.42;
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const first = rollD20(seededRandom);
    // Reset seed
    seed = 0.42;
    const second = rollD20(seededRandom);
    expect(first).toBe(second);
  });

  it('returns integer values', () => {
    for (let i = 0; i < 50; i++) {
      const result = rollD20();
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});

describe('rollD100', () => {
  it('returns a value between 1 and 100 with default random', () => {
    for (let i = 0; i < 100; i++) {
      const result = rollD100();
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it('returns 1 when random returns 0', () => {
    expect(rollD100(() => 0)).toBe(1);
  });

  it('returns 100 when random returns just below 1', () => {
    expect(rollD100(() => 0.999)).toBe(100);
  });

  it('returns integer values', () => {
    for (let i = 0; i < 50; i++) {
      const result = rollD100();
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});
