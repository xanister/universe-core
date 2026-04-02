/**
 * Integration tests for connectivity-aware slot pruning in the generator.
 *
 * Tests that pruneForConnectivity correctly removes optional slots when
 * placement creates disconnected floor regions, and throws when required
 * slots cause an unresolvable disconnect.
 */

import { describe, it, expect } from 'vitest';
import { pruneForConnectivity } from '@dmnpc/generation/place-layout/generator.js';
import type { GeneratedSlot } from '@dmnpc/types/world';
import type { GeneratedShape } from '@dmnpc/generation/place-layout/algorithms/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a blocked mask from a string grid. '#' = blocked, '.' = walkable */
function makeMask(grid: string[]): boolean[][] {
  return grid.map((row) => [...row].map((c) => c === '#'));
}

function makeShape(grid: string[]): GeneratedShape {
  const mask = makeMask(grid);
  const height = mask.length;
  const width = mask[0]?.length ?? 0;
  return {
    bounds: { x: 0, y: 0, width, height },
    blockedMask: mask,
    terrainGrid: null,
    layerTiles: new Map(),
  };
}

function makeSlot(overrides: Partial<GeneratedSlot> = {}): GeneratedSlot {
  return {
    purpose: 'decoration',
    category: 'object',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    facing: 'south',
    layer: 'default',
    ...overrides,
  };
}

// ============================================================================
// Pruning Tests
// ============================================================================

describe('pruneForConnectivity', () => {
  it('does nothing when the floor is already connected', () => {
    const shape = makeShape([
      '.....',
      '.....',
      '.....',
    ]);
    const slots = [makeSlot({ x: 2, y: 1 })];
    const optional = [true];
    const occupied = new Set(['2,1']);

    pruneForConnectivity(slots, optional, shape, occupied);

    expect(slots).toHaveLength(1);
    expect(occupied.has('2,1')).toBe(true);
  });

  it('prunes optional slots to restore connectivity', () => {
    // A narrow corridor with an optional object blocking the passage
    //   . . .
    //   # X #   <-- X = optional slot at (1,1) splitting top from bottom
    //   . . .
    const shape = makeShape([
      '...',
      '#.#',
      '...',
    ]);
    // The slot at (1,1) blocks the only path between top and bottom
    const slots = [makeSlot({ x: 1, y: 1 })];
    const optional = [true];
    const occupied = new Set(['1,1']);

    pruneForConnectivity(slots, optional, shape, occupied);

    // Slot should have been pruned
    expect(slots).toHaveLength(0);
    expect(occupied.has('1,1')).toBe(false);
  });

  it('preserves required slots and only prunes optional ones', () => {
    // Two objects: required at (0,0), optional at (1,1) blocking corridor
    const shape = makeShape([
      '...',
      '#.#',
      '...',
    ]);
    const required = makeSlot({ x: 0, y: 0, purpose: 'required_obj' });
    const blocking = makeSlot({ x: 1, y: 1, purpose: 'optional_obj' });
    const slots = [required, blocking];
    const optional = [false, true]; // first = required, second = optional
    const occupied = new Set(['0,0', '1,1']);

    pruneForConnectivity(slots, optional, shape, occupied);

    expect(slots).toHaveLength(1);
    expect(slots[0].purpose).toBe('required_obj');
    expect(occupied.has('0,0')).toBe(true);
    expect(occupied.has('1,1')).toBe(false);
  });

  it('prunes in reverse order (last placed first)', () => {
    // 5-wide corridor with two optional objects that both block it
    // . . . . .
    // # X # X #   <-- objects at (1,1) and (3,1)
    // . . . . .
    const shape = makeShape([
      '.....',
      '#.#.#',
      '.....',
    ]);
    const slot1 = makeSlot({ x: 1, y: 1, purpose: 'first' });
    const slot2 = makeSlot({ x: 3, y: 1, purpose: 'second' });
    const slots = [slot1, slot2];
    const optional = [true, true];
    const occupied = new Set(['1,1', '3,1']);

    pruneForConnectivity(slots, optional, shape, occupied);

    // Removing the last-placed (second, at 3,1) opens a path: rows 0 and 2
    // connect through column 3. So only the second slot is pruned.
    expect(slots).toHaveLength(1);
    expect(slots[0].purpose).toBe('first');
  });

  it('stops pruning as soon as connectivity is restored', () => {
    // Wide room, one optional object in the corner doesn't block anything
    // Another optional object in a narrow passage blocks connectivity
    const shape = makeShape([
      '.....',
      '##.##',
      '.....',
    ]);
    const cornerSlot = makeSlot({ x: 0, y: 0, purpose: 'corner' });
    const blockingSlot = makeSlot({ x: 2, y: 1, purpose: 'blocking' });
    const slots = [cornerSlot, blockingSlot];
    const optional = [true, true];
    const occupied = new Set(['0,0', '2,1']);

    pruneForConnectivity(slots, optional, shape, occupied);

    // Only the blocking slot (last in reverse order) should be removed
    expect(slots).toHaveLength(1);
    expect(slots[0].purpose).toBe('corner');
  });

  it('throws when required slots cause unresolvable disconnect', () => {
    // Required slot at (1,1) splits the room
    const shape = makeShape([
      '...',
      '#.#',
      '...',
    ]);
    const slots = [makeSlot({ x: 1, y: 1 })];
    const optional = [false]; // required
    const occupied = new Set(['1,1']);

    expect(() =>
      pruneForConnectivity(slots, optional, shape, occupied)
    ).toThrow(/Floor connectivity cannot be restored/);
  });

  it('error message does not include retry suffix when called directly', () => {
    // BUG-259: The retry loop in generatePlaceLayout appends "after N placement attempts"
    // to the error. When pruneForConnectivity is called directly, the original message
    // should not include that suffix.
    const shape = makeShape([
      '...',
      '#.#',
      '...',
    ]);
    const slots = [makeSlot({ x: 1, y: 1 })];
    const optional = [false];
    const occupied = new Set(['1,1']);

    expect(() =>
      pruneForConnectivity(slots, optional, shape, occupied)
    ).toThrow(/Required slots partition the floor\. Fix the layout template\.$/);
  });

  it('handles multi-tile building footprint pruning', () => {
    // A 5x1 building blocks a passage in a room.
    // Top-left convention: building at (0, 1) with width=5, height=1.
    // Footprint covers (0,1)...(4,1) — entire row 1.
    //
    // Baseline (before building footprint): floor is connected.
    // After building stamps blockedMask: row 1 fully blocked, splitting rows 0/2.
    const shape = makeShape([
      '.....',   // row 0: walkable
      '.....',   // row 1: walkable (building will stamp this row)
      '.....',   // row 2: walkable
    ]);
    // Simulate building footprint stamping in blockedMask (as generator does)
    for (let x = 0; x < 5; x++) shape.blockedMask[1][x] = true;

    const buildingSlot = makeSlot({
      x: 0,
      y: 1,
      width: 5,
      height: 1,
      category: 'place',
      purpose: 'building',
    });
    const slots = [buildingSlot];
    const optional = [true];
    const occupied = new Set<string>();

    // baselineConnected=true because the terrain was connected before building stamped
    pruneForConnectivity(slots, optional, shape, occupied, true);

    // Building should be removed and blockedMask cleared
    expect(slots).toHaveLength(0);
    expect(shape.blockedMask[1][0]).toBe(false);
    expect(shape.blockedMask[1][2]).toBe(false);
    expect(shape.blockedMask[1][4]).toBe(false);
  });

  it('does nothing when there are no walkable tiles', () => {
    const shape = makeShape([
      '###',
      '###',
    ]);
    const slots: GeneratedSlot[] = [];
    const optional: boolean[] = [];
    const occupied = new Set<string>();

    // Should not throw — vacuously connected
    pruneForConnectivity(slots, optional, shape, occupied);
    expect(slots).toHaveLength(0);
  });

  it('BUG-264: building footprint uses top-left convention (3x1 slot)', () => {
    // 3x3 grid. A 3x1 building at top-left (0,1) covers entire row 1.
    // This splits row 0 from row 2, forcing pruning.
    // With top-left convention: footprint = (0,1), (1,1), (2,1).
    const shape = makeShape([
      '...',
      '...',
      '...',
    ]);
    for (let x = 0; x < 3; x++) shape.blockedMask[1][x] = true;

    const buildingSlot = makeSlot({
      x: 0,
      y: 1,
      width: 3,
      height: 1,
      category: 'place',
      purpose: 'building',
    });
    const slots = [buildingSlot];
    const optional = [true];
    const occupied = new Set<string>();

    pruneForConnectivity(slots, optional, shape, occupied, true);

    // Building should be removed and blockedMask cleared at (0,1), (1,1), (2,1)
    expect(slots).toHaveLength(0);
    expect(shape.blockedMask[1][0]).toBe(false);
    expect(shape.blockedMask[1][1]).toBe(false);
    expect(shape.blockedMask[1][2]).toBe(false);
    // Rows 0 and 2 were never blocked
    expect(shape.blockedMask[0][0]).toBe(false);
    expect(shape.blockedMask[2][0]).toBe(false);
  });

  it('BUG-264: building footprint uses top-left convention (2x3 slot)', () => {
    // 4x5 grid. A 2x3 building at top-left (1,1) covers cols 1-2, rows 1-3.
    // Walls on both sides force traffic through cols 1-2, so blocking them
    // disconnects the floor.
    const shape = makeShape([
      '....',  // row 0
      '#..#',  // row 1: walls at edges, building will stamp (1,1)(2,1)
      '#..#',  // row 2: same
      '#..#',  // row 3: same
      '....',  // row 4
    ]);
    // Stamp the 2x3 building at top-left (1,1)
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        shape.blockedMask[1 + dy][1 + dx] = true;
      }
    }

    const buildingSlot = makeSlot({
      x: 1,
      y: 1,
      width: 2,
      height: 3,
      category: 'place',
      purpose: 'building',
    });
    const slots = [buildingSlot];
    const optional = [true];
    const occupied = new Set<string>();

    pruneForConnectivity(slots, optional, shape, occupied, true);

    // Building pruned — all 6 footprint tiles cleared
    expect(slots).toHaveLength(0);
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(shape.blockedMask[1 + dy][1 + dx]).toBe(false);
      }
    }
    // Wall tiles unaffected
    expect(shape.blockedMask[1][0]).toBe(true);
    expect(shape.blockedMask[1][3]).toBe(true);
  });
});
