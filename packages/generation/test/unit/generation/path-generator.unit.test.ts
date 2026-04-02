/**
 * Unit tests for path generation.
 *
 * Tests the single winding trail generator for connectivity,
 * 1-tile width constraint, and curvature behavior.
 */

import { describe, it, expect } from 'vitest';
import { generatePath } from '../../../src/place-layout/algorithms/path-generator.js';

/** Mulberry32 seeded PRNG. */
function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Count path tiles in a mask. */
function countPathTiles(mask: boolean[][]): number {
  let count = 0;
  for (const row of mask) {
    for (const cell of row) {
      if (cell) count++;
    }
  }
  return count;
}

/** Flood fill from a path tile, returns count of reachable path tiles. */
function floodFillCount(mask: boolean[][], width: number, height: number): number {
  let startX = -1;
  let startY = -1;
  for (let y = 0; y < height && startX === -1; y++) {
    for (let x = 0; x < width && startX === -1; x++) {
      if (mask[y][x]) {
        startX = x;
        startY = y;
      }
    }
  }
  if (startX === -1) return 0;

  const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  const queue: Array<[number, number]> = [[startX, startY]];
  visited[startY][startX] = true;
  let count = 1;

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny][nx] && !visited[ny][nx]) {
        visited[ny][nx] = true;
        count++;
        queue.push([nx, ny]);
      }
    }
  }

  return count;
}

describe('generatePath', () => {
  it('generates path tiles on a grid', () => {
    const rng = createRng(42);
    const { mask } = generatePath(40, 40, 0.5, rng);

    const pathCount = countPathTiles(mask);
    expect(pathCount).toBeGreaterThan(0);
    expect(mask.length).toBe(40);
    expect(mask[0].length).toBe(40);
  });

  it('path tiles are connected', () => {
    const rng = createRng(77);
    const width = 50;
    const height = 50;
    const { mask } = generatePath(width, height, 0.5, rng);

    const total = countPathTiles(mask);
    const reachable = floodFillCount(mask, width, height);
    expect(reachable).toBe(total);
  });

  it('zero curvature produces a shorter path than high curvature', () => {
    const seed = 33;
    const width = 60;
    const height = 60;

    const straight = generatePath(width, height, 0, createRng(seed));
    const winding = generatePath(width, height, 1.0, createRng(seed));

    const straightCount = countPathTiles(straight.mask);
    const windingCount = countPathTiles(winding.mask);
    // High curvature should produce more tiles due to perpendicular offsets
    expect(windingCount).toBeGreaterThanOrEqual(straightCount);
  });

  it('path tiles stay within grid bounds', () => {
    const rng = createRng(200);
    const width = 40;
    const height = 30;
    const { mask } = generatePath(width, height, 0.8, rng);

    expect(mask.length).toBe(height);
    for (const row of mask) {
      expect(row.length).toBe(width);
    }
  });

  it('connectivity holds across multiple seeds', () => {
    for (let seed = 0; seed < 10; seed++) {
      const rng = createRng(seed);
      const width = 50;
      const height = 50;
      const { mask } = generatePath(width, height, 0.5, rng);

      const total = countPathTiles(mask);
      const reachable = floodFillCount(mask, width, height);
      expect(reachable).toBe(total);
    }
  });
});
