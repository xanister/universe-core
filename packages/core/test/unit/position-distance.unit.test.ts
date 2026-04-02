import { describe, it, expect } from 'vitest';
import type { Position } from '@dmnpc/types';

import {
  TILE_SIZE_PX,
  METERS_PER_TILE,
  DEFAULT_NEARBY_METERS,
  pixelsToMeters,
  calculateDistanceMeters,
  isWithinRange,
} from '@dmnpc/core/entities/position-utils.js';

// ============================================================================
// Helper
// ============================================================================

function makePosition(x: number, y: number, parent: string | null = 'PLACE_test'): Position {
  return { x, y, parent, width: 32, height: 48 };
}

// ============================================================================
// Constants
// ============================================================================

describe('distance constants', () => {
  it('TILE_SIZE_PX is 32', () => {
    expect(TILE_SIZE_PX).toBe(32);
  });

  it('METERS_PER_TILE is 1', () => {
    expect(METERS_PER_TILE).toBe(1);
  });

  it('DEFAULT_NEARBY_METERS is ~0.5 miles', () => {
    expect(DEFAULT_NEARBY_METERS).toBe(805);
  });
});

// ============================================================================
// pixelsToMeters
// ============================================================================

describe('pixelsToMeters', () => {
  it('converts 0 pixels to 0 meters', () => {
    expect(pixelsToMeters(0)).toBe(0);
  });

  it('converts 1 tile width (32px) to 1 meter', () => {
    expect(pixelsToMeters(32)).toBe(1);
  });

  it('converts 10 tiles (320px) to 10 meters', () => {
    expect(pixelsToMeters(320)).toBe(10);
  });

  it('handles fractional pixels', () => {
    expect(pixelsToMeters(16)).toBe(0.5);
  });

  it('handles large pixel distances', () => {
    // A large tilemap: 7328px diagonal ≈ 229 meters
    expect(pixelsToMeters(7328)).toBe(229);
  });
});

// ============================================================================
// calculateDistanceMeters
// ============================================================================

describe('calculateDistanceMeters', () => {
  it('returns 0 for identical positions', () => {
    const pos = makePosition(100, 200);
    expect(calculateDistanceMeters(pos, pos)).toBe(0);
  });

  it('calculates horizontal distance correctly', () => {
    const a = makePosition(0, 0);
    const b = makePosition(320, 0); // 10 tiles apart
    expect(calculateDistanceMeters(a, b)).toBe(10);
  });

  it('calculates vertical distance correctly', () => {
    const a = makePosition(0, 0);
    const b = makePosition(0, 160); // 5 tiles apart
    expect(calculateDistanceMeters(a, b)).toBe(5);
  });

  it('calculates diagonal distance correctly', () => {
    const a = makePosition(0, 0);
    const b = makePosition(320, 320); // 10 tiles each axis
    const expected = pixelsToMeters(Math.sqrt(320 * 320 + 320 * 320));
    expect(calculateDistanceMeters(a, b)).toBeCloseTo(expected, 5);
  });

  it('returns null when positions have different parents', () => {
    const a = makePosition(0, 0, 'PLACE_a');
    const b = makePosition(100, 100, 'PLACE_b');
    expect(calculateDistanceMeters(a, b)).toBeNull();
  });

  it('returns null when one parent is null', () => {
    const a = makePosition(0, 0, null);
    const b = makePosition(100, 100, 'PLACE_a');
    expect(calculateDistanceMeters(a, b)).toBeNull();
  });

  it('handles positions with the same null parent', () => {
    // Both at root cosmos — same parent (null === null)
    const a = makePosition(0, 0, null);
    const b = makePosition(320, 0, null);
    expect(calculateDistanceMeters(a, b)).toBe(10);
  });

  it('treats null coordinates as 0 (JavaScript coercion)', () => {
    // Some entity data has x: null / y: null. In JS arithmetic, null coerces to 0.
    const a = { x: null as unknown as number, y: null as unknown as number, parent: 'PLACE_a', width: 32, height: 48 };
    const b = makePosition(100, 100, 'PLACE_a');
    // Distance from (0,0) to (100,100) = sqrt(20000) ≈ 141.4px ≈ 4.42m
    const result = calculateDistanceMeters(a, b);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(4.42, 1);
  });

  it('returns null for undefined coordinates (NaN)', () => {
    const a = { x: undefined as unknown as number, y: undefined as unknown as number, parent: 'PLACE_a', width: 32, height: 48 };
    const b = makePosition(100, 100, 'PLACE_a');
    expect(calculateDistanceMeters(a, b)).toBeNull();
  });
});

// ============================================================================
// isWithinRange
// ============================================================================

describe('isWithinRange', () => {
  it('returns true when distance is exactly at the threshold', () => {
    const a = makePosition(0, 0);
    const b = makePosition(320, 0); // 10 meters apart
    expect(isWithinRange(a, b, 10)).toBe(true);
  });

  it('returns true when distance is within threshold', () => {
    const a = makePosition(0, 0);
    const b = makePosition(160, 0); // 5 meters apart
    expect(isWithinRange(a, b, 10)).toBe(true);
  });

  it('returns false when distance exceeds threshold', () => {
    const a = makePosition(0, 0);
    const b = makePosition(352, 0); // 11 meters apart
    expect(isWithinRange(a, b, 10)).toBe(false);
  });

  it('returns false when positions have different parents', () => {
    const a = makePosition(0, 0, 'PLACE_a');
    const b = makePosition(0, 0, 'PLACE_b');
    expect(isWithinRange(a, b, 1000)).toBe(false);
  });

  it('returns true for same position with 0 range', () => {
    const pos = makePosition(100, 200);
    expect(isWithinRange(pos, pos, 0)).toBe(true);
  });

  it('handles the default nearby threshold with typical tilemap distances', () => {
    // Largest tilemap diagonal: ~7328x4064 pixels ≈ 260 meters
    // DEFAULT_NEARBY_METERS is 805, so everything in a tilemap is "nearby"
    const a = makePosition(0, 0);
    const b = makePosition(7328, 4064);
    const distanceMeters = pixelsToMeters(Math.sqrt(7328 ** 2 + 4064 ** 2));
    expect(distanceMeters).toBeLessThan(DEFAULT_NEARBY_METERS);
    expect(isWithinRange(a, b, DEFAULT_NEARBY_METERS)).toBe(true);
  });

  it('filters with a tight chat proximity threshold', () => {
    const viewer = makePosition(500, 500);
    const close = makePosition(500 + 15 * 32, 500); // 15 meters away
    const far = makePosition(500 + 60 * 32, 500); // 60 meters away

    const chatRange = 50; // ~50 meters conversational distance
    expect(isWithinRange(viewer, close, chatRange)).toBe(true);
    expect(isWithinRange(viewer, far, chatRange)).toBe(false);
  });

  it('treats null coordinates as (0,0) — within range if distance from origin is small', () => {
    // null coerces to 0 in JS arithmetic, so distance is from (0,0) to (100,100) ≈ 4.42m
    const a = { x: null as unknown as number, y: null as unknown as number, parent: 'PLACE_a', width: 32, height: 48 };
    const b = makePosition(100, 100, 'PLACE_a');
    expect(isWithinRange(a, b, 10)).toBe(true); // 4.42m < 10m
    expect(isWithinRange(a, b, 1)).toBe(false); // 4.42m > 1m
  });

  it('returns true when both coordinates are undefined (NaN → null → assume nearby)', () => {
    // undefined arithmetic produces NaN, calculateDistanceMeters returns null, isWithinRange assumes nearby
    const a = { x: undefined as unknown as number, y: undefined as unknown as number, parent: 'PLACE_a', width: 32, height: 48 };
    const b = makePosition(100, 100, 'PLACE_a');
    expect(isWithinRange(a, b, 10)).toBe(true);
  });

  it('returns false when parents differ even with null coords', () => {
    const a = { x: null as unknown as number, y: null as unknown as number, parent: 'PLACE_a', width: 32, height: 48 };
    const b = makePosition(100, 100, 'PLACE_b');
    expect(isWithinRange(a, b, 10000)).toBe(false);
  });
});
