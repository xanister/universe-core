/**
 * Unit tests for floor connectivity validation.
 *
 * Tests the BFS flood-fill validator that checks whether all walkable floor
 * tiles form a single connected component. Used after slot placement to detect
 * rooms where objects partition the floor into unreachable regions.
 */

import { describe, it, expect } from 'vitest';
import { validateFloorConnectivity } from '@dmnpc/generation/place-layout/connectivity.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Create a blocked mask from a string grid. '#' = blocked, '.' = walkable */
function makeMask(grid: string[]): boolean[][] {
  return grid.map((row) => [...row].map((c) => c === '#'));
}

// ============================================================================
// Connected Rooms
// ============================================================================

describe('validateFloorConnectivity', () => {
  it('returns connected for a fully open room', () => {
    const mask = makeMask([
      '.....',
      '.....',
      '.....',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 5, 3);
    expect(result.connected).toBe(true);
    expect(result.componentCount).toBe(1);
    expect(result.totalWalkable).toBe(15);
    expect(result.largestComponentSize).toBe(15);
  });

  it('returns connected for a room with walls that do not split it', () => {
    // Wall juts in from the left but doesn't split the room
    const mask = makeMask([
      '......',
      '##....',
      '......',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 6, 3);
    expect(result.connected).toBe(true);
    expect(result.componentCount).toBe(1);
    expect(result.totalWalkable).toBe(16);
  });

  it('returns connected for a single walkable tile', () => {
    const mask = makeMask([
      '###',
      '#.#',
      '###',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 3, 3);
    expect(result.connected).toBe(true);
    expect(result.componentCount).toBe(1);
    expect(result.totalWalkable).toBe(1);
  });

  it('returns connected for a room with occupied tiles that do not split it', () => {
    const mask = makeMask([
      '.....',
      '.....',
      '.....',
    ]);
    // Object at (2,1) doesn't split the room
    const occupied = new Set(['2,1']);
    const result = validateFloorConnectivity(mask, occupied, 5, 3);
    expect(result.connected).toBe(true);
    expect(result.totalWalkable).toBe(14);
  });

  // ============================================================================
  // Disconnected Rooms
  // ============================================================================

  it('detects a room split by a wall into two regions', () => {
    const mask = makeMask([
      '..#..',
      '..#..',
      '..#..',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 5, 3);
    expect(result.connected).toBe(false);
    expect(result.componentCount).toBe(2);
    expect(result.totalWalkable).toBe(12);
  });

  it('detects disconnection caused by occupied tiles', () => {
    // Horizontal corridor, object blocks the only passage
    const mask = makeMask([
      '###',
      '...',
      '###',
    ]);
    // Blocking the center tile splits left from right
    const occupied = new Set(['1,1']);
    const result = validateFloorConnectivity(mask, occupied, 3, 3);
    expect(result.connected).toBe(false);
    expect(result.componentCount).toBe(2);
  });

  it('counts multiple isolated pockets', () => {
    // Two pockets separated by a wall column
    const mask = makeMask([
      '.#.',
      '.#.',
      '.#.',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 3, 3);
    expect(result.connected).toBe(false);
    expect(result.componentCount).toBe(2);
    expect(result.largestComponentSize).toBe(3);
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  it('returns connected (vacuously) for a fully blocked room', () => {
    const mask = makeMask([
      '###',
      '###',
      '###',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 3, 3);
    expect(result.connected).toBe(true); // 0 components → connected
    expect(result.componentCount).toBe(0);
    expect(result.totalWalkable).toBe(0);
  });

  it('does not count diagonal adjacency as connected', () => {
    // Two tiles only connected diagonally
    const mask = makeMask([
      '.#',
      '#.',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 2, 2);
    expect(result.connected).toBe(false);
    expect(result.componentCount).toBe(2);
  });

  it('handles a 1x1 grid', () => {
    const result = validateFloorConnectivity([[false]], new Set(), 1, 1);
    expect(result.connected).toBe(true);
    expect(result.totalWalkable).toBe(1);
  });

  it('tracks largest component size correctly', () => {
    const mask = makeMask([
      '...#.',
      '...#.',
      '...#.',
    ]);
    const result = validateFloorConnectivity(mask, new Set(), 5, 3);
    expect(result.connected).toBe(false);
    expect(result.largestComponentSize).toBe(9); // 3x3 left region
  });
});
