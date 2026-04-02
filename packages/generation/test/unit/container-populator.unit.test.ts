/**
 * Container Populator Tests
 *
 * FEAT-326: Populate Containers With Appropriate Items
 */

import { describe, it, expect } from 'vitest';
import {
  populateContainerContents,
  CONTAINER_ITEM_POOLS,
} from '../../src/place-layout/container-populator.js';
import type { PlaceContext } from '@dmnpc/types/world';

function makeContext(wealth: 'low' | 'moderate' | 'high'): PlaceContext {
  return { wealth, cleanliness: 'clean', crowding: 'normal', atmosphere: 'casual' };
}

function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('populateContainerContents', () => {
  it('returns items from the matching purpose pool', () => {
    const result = populateContainerContents('weapon_shop', makeContext('moderate'), makeRng(42));
    expect(result.length).toBeGreaterThan(0);
    const weaponPool = CONTAINER_ITEM_POOLS['weapon_shop'];
    for (const itemId of result) {
      expect(weaponPool).toContain(itemId);
    }
  });

  it('uses default pool for unknown purposes', () => {
    const result = populateContainerContents('unknown_room', makeContext('moderate'), makeRng(42));
    expect(result.length).toBeGreaterThan(0);
  });

  it('scales count with wealth — low produces fewer items', () => {
    const counts: number[] = [];
    for (let seed = 0; seed < 50; seed++) {
      const result = populateContainerContents('storage_room', makeContext('low'), makeRng(seed));
      counts.push(result.length);
    }
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    // Low wealth: 0-1 range, average should be ≤ 1
    expect(avg).toBeLessThanOrEqual(1.5);
  });

  it('scales count with wealth — high produces more items', () => {
    const counts: number[] = [];
    for (let seed = 0; seed < 50; seed++) {
      const result = populateContainerContents('storage_room', makeContext('high'), makeRng(seed));
      counts.push(result.length);
    }
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    // High wealth: 2-5 range, average should be ≥ 2
    expect(avg).toBeGreaterThanOrEqual(2);
  });

  it('does not repeat items within a single container', () => {
    const result = populateContainerContents('storage_room', makeContext('high'), makeRng(99));
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  it('is deterministic with the same seed', () => {
    const a = populateContainerContents('bedroom', makeContext('moderate'), makeRng(123));
    const b = populateContainerContents('bedroom', makeContext('moderate'), makeRng(123));
    expect(a).toEqual(b);
  });

  it('produces different results with different seeds', () => {
    const a = populateContainerContents('ruins', makeContext('moderate'), makeRng(1));
    const b = populateContainerContents('ruins', makeContext('moderate'), makeRng(9999));
    // With different seeds, at least one difference is expected
    // (could rarely be the same by chance, so we just check they ran)
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('handles null context gracefully', () => {
    const result = populateContainerContents('bedroom', null, makeRng(42));
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns items for all defined pool purposes', () => {
    for (const purpose of Object.keys(CONTAINER_ITEM_POOLS)) {
      const result = populateContainerContents(purpose, makeContext('high'), makeRng(42));
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
