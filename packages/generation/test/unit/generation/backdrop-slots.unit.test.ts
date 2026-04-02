/**
 * Unit tests for backdrop slot resolution.
 *
 * Tests the resolveBackdropSlots() function that picks candidate positions
 * from hand-placed slot definitions on sprite_backdrop layers.
 */

import { describe, it, expect } from 'vitest';
import { resolveBackdropSlots } from '@dmnpc/generation/place-layout/generator.js';
import type { BackdropSlot } from '@dmnpc/types/world';

// ============================================================================
// Helpers
// ============================================================================

function makeSlot(overrides: Partial<BackdropSlot>): BackdropSlot {
  return {
    purposes: ['decoration'],
    candidates: [{ x: 5, y: 5 }],
    min: 1,
    max: 1,
    chance: null,
    forbiddenTags: null,
    inheritableTags: null,
    flags: { useLlmSelection: false },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('resolveBackdropSlots', () => {
  it('places a single slot at the only candidate position', () => {
    const slots = [makeSlot({ purposes: ['vessel_helm'], candidates: [{ x: 10, y: 3 }] })];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(1);
    expect(result[0].purpose).toBe('vessel_helm');
    expect(result[0].x).toBe(10);
    expect(result[0].y).toBe(3);
    expect(result[0].category).toBeDefined();
  });

  it('respects min/max by placing multiple candidates', () => {
    const slots = [
      makeSlot({
        purposes: ['cannon'],
        candidates: [
          { x: 1, y: 1 },
          { x: 3, y: 1 },
          { x: 5, y: 1 },
          { x: 7, y: 1 },
        ],
        min: 2,
        max: 2,
      }),
    ];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(2);
    // All should have purpose 'cannon'
    for (const slot of result) {
      expect(slot.purpose).toBe('cannon');
    }
    // Positions should be unique
    const positions = result.map((s) => `${s.x},${s.y}`);
    expect(new Set(positions).size).toBe(2);
  });

  it('skips slot when chance rolls below threshold', () => {
    // Use chance: 0 to guarantee skipping
    const slots = [
      makeSlot({
        purposes: ['decoration'],
        candidates: [{ x: 5, y: 5 }],
        chance: 0,
      }),
    ];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(0);
  });

  it('always places slot when chance is null', () => {
    const slots = [
      makeSlot({
        purposes: ['vessel_helm'],
        candidates: [{ x: 5, y: 5 }],
        chance: null,
      }),
    ];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(1);
  });

  it('respects occupied tiles and skips candidates that overlap', () => {
    const slots = [
      makeSlot({
        purposes: ['barrel'],
        candidates: [
          { x: 2, y: 2 },
          { x: 4, y: 4 },
        ],
        min: 2,
        max: 2,
      }),
    ];
    // Pre-occupy the first candidate (2x2 block)
    const occupied = new Set<string>(['2,2', '3,2', '2,3', '3,3']);

    const result = resolveBackdropSlots(slots, 42, occupied);

    // Only the second candidate should be placed (first is occupied)
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(4);
    expect(result[0].y).toBe(4);
  });

  it('adds placed positions to the occupied set', () => {
    const slots = [makeSlot({ candidates: [{ x: 5, y: 5 }] })];
    const occupied = new Set<string>();

    resolveBackdropSlots(slots, 42, occupied);

    // Should have marked a 2x2 block as occupied
    expect(occupied.has('5,5')).toBe(true);
    expect(occupied.has('6,5')).toBe(true);
    expect(occupied.has('5,6')).toBe(true);
    expect(occupied.has('6,6')).toBe(true);
  });

  it('handles multiple slot definitions', () => {
    const slots = [
      makeSlot({ purposes: ['vessel_helm'], candidates: [{ x: 10, y: 3 }] }),
      makeSlot({ purposes: ['gangplank'], candidates: [{ x: 1, y: 5 }] }),
    ];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(2);
    const purposes = result.map((s) => s.purpose);
    expect(purposes).toContain('vessel_helm');
    expect(purposes).toContain('gangplank');
  });

  it('selects random purpose from array', () => {
    const slots = [
      makeSlot({
        purposes: ['barrel', 'crate', 'chest'],
        candidates: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 9, y: 1 },
        ],
        min: 3,
        max: 3,
      }),
    ];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(3);
    // All purposes should be from the valid set
    for (const slot of result) {
      expect(['barrel', 'crate', 'chest']).toContain(slot.purpose);
    }
  });

  it('skips slot definitions with empty purposes or candidates', () => {
    const slots = [
      makeSlot({ purposes: [], candidates: [{ x: 5, y: 5 }] }),
      makeSlot({ purposes: ['helm'], candidates: [] }),
    ];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(0);
  });

  it('produces deterministic results with same seed', () => {
    const slots = [
      makeSlot({
        purposes: ['cannon'],
        candidates: [
          { x: 1, y: 1 },
          { x: 3, y: 1 },
          { x: 5, y: 1 },
          { x: 7, y: 1 },
        ],
        min: 2,
        max: 2,
      }),
    ];

    const result1 = resolveBackdropSlots(slots, 42, new Set());
    const result2 = resolveBackdropSlots(slots, 42, new Set());

    expect(result1).toEqual(result2);
  });

  it('preserves facing from candidate', () => {
    const slots = [
      makeSlot({
        purposes: ['cannon'],
        candidates: [{ x: 5, y: 5, facing: 'east' }],
      }),
    ];
    const occupied = new Set<string>();

    const result = resolveBackdropSlots(slots, 42, occupied);

    expect(result).toHaveLength(1);
    expect(result[0].facing).toBe('east');
  });
});
