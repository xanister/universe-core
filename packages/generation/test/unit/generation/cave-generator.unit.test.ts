/**
 * Unit tests for cave network generation.
 *
 * Tests the spine + branch cave generator for connectivity,
 * rasterization, width expansion, and graph structure.
 * Mirrors road-generator.unit.test.ts structure.
 */

import { describe, it, expect } from 'vitest';
import { generateCaveNetwork } from '../../../src/place-layout/algorithms/cave-generator.js';

/** Mulberry32 seeded PRNG (same as shape-algorithms.ts). */
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

/** Count carved (passable) tiles in the mask. */
function countTunnelTiles(mask: boolean[][]): number {
  let count = 0;
  for (const row of mask) {
    for (const cell of row) {
      if (cell) count++;
    }
  }
  return count;
}

/** Flood fill from a tunnel tile, returns count of reachable tunnel tiles. */
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
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
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

describe('generateCaveNetwork', () => {
  it('generates tunnel tiles on a small grid', () => {
    const rng = createRng(42);
    const { mask } = generateCaveNetwork(40, 40, 1, 2, 0.3, rng);

    const tunnelCount = countTunnelTiles(mask);
    expect(tunnelCount).toBeGreaterThan(0);
    expect(mask.length).toBe(40);
    expect(mask[0].length).toBe(40);
  });

  it('all tunnel tiles are connected (flood fill)', () => {
    const rng = createRng(123);
    const width = 60;
    const height = 60;
    const { mask } = generateCaveNetwork(width, height, 1, 3, 0.3, rng);

    const totalTunnels = countTunnelTiles(mask);
    const reachable = floodFillCount(mask, width, height);
    expect(reachable).toBe(totalTunnels);
  });

  it('spine-only (0 branches) still produces connected tunnels', () => {
    const rng = createRng(99);
    const width = 50;
    const height = 50;
    const { mask, graph } = generateCaveNetwork(width, height, 1, 0, 0, rng);

    const totalTunnels = countTunnelTiles(mask);
    const reachable = floodFillCount(mask, width, height);
    expect(totalTunnels).toBeGreaterThan(0);
    expect(reachable).toBe(totalTunnels);
    // Spine-only: exactly 2 endpoint nodes and 1 edge
    expect(graph.nodes.filter((n) => n.type === 'endpoint')).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });

  it('tunnel width 2 produces more carved tiles than width 1', () => {
    const seed = 55;
    const width = 60;
    const height = 60;

    const result1 = generateCaveNetwork(width, height, 1, 2, 0.3, createRng(seed));
    const result2 = generateCaveNetwork(width, height, 2, 2, 0.3, createRng(seed));

    const count1 = countTunnelTiles(result1.mask);
    const count2 = countTunnelTiles(result2.mask);
    expect(count2).toBeGreaterThan(count1);
  });

  it('graph has endpoint and junction nodes for branching caves', () => {
    const rng = createRng(77);
    const { graph } = generateCaveNetwork(80, 80, 1, 3, 0.3, rng);

    const endpoints = graph.nodes.filter((n) => n.type === 'endpoint');
    expect(endpoints.length).toBeGreaterThanOrEqual(2);
    // With 3 branches, expect spine edge + at least 1 branch edge
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('tunnel tiles stay within grid bounds', () => {
    const rng = createRng(200);
    const width = 40;
    const height = 30;
    const { mask } = generateCaveNetwork(width, height, 2, 4, 0.8, rng);

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
      const { mask } = generateCaveNetwork(width, height, 1, 2, 0.3, rng);

      const total = countTunnelTiles(mask);
      const reachable = floodFillCount(mask, width, height);
      expect(reachable).toBe(total);
    }
  });

  it('tunnel tiles respect default edge buffer across multiple seeds', () => {
    for (let seed = 0; seed < 10; seed++) {
      const rng = createRng(seed);
      const width = 60;
      const height = 60;
      const defaultBuffer = Math.max(3, Math.floor(Math.min(width, height) * 0.1));
      const { mask } = generateCaveNetwork(width, height, 1, 2, 0.3, rng);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (mask[y][x]) {
            expect(
              x,
              `seed=${seed} tunnel tile at (${x},${y}) too close to left/right edge`
            ).toBeGreaterThanOrEqual(defaultBuffer);
            expect(
              x,
              `seed=${seed} tunnel tile at (${x},${y}) too close to left/right edge`
            ).toBeLessThanOrEqual(width - 1 - defaultBuffer);
            expect(
              y,
              `seed=${seed} tunnel tile at (${x},${y}) too close to top/bottom edge`
            ).toBeGreaterThanOrEqual(defaultBuffer);
            expect(
              y,
              `seed=${seed} tunnel tile at (${x},${y}) too close to top/bottom edge`
            ).toBeLessThanOrEqual(height - 1 - defaultBuffer);
          }
        }
      }
    }
  });

  it('graph nodes respect edge buffer', () => {
    const rng = createRng(42);
    const width = 60;
    const height = 60;
    const defaultBuffer = Math.max(3, Math.floor(Math.min(width, height) * 0.1));
    const { graph } = generateCaveNetwork(width, height, 1, 3, 0.3, rng);

    for (const node of graph.nodes) {
      expect(
        node.x,
        `node (${node.x},${node.y}) type=${node.type} too close to edge`
      ).toBeGreaterThanOrEqual(defaultBuffer);
      expect(
        node.x,
        `node (${node.x},${node.y}) type=${node.type} too close to edge`
      ).toBeLessThanOrEqual(width - 1 - defaultBuffer);
      expect(
        node.y,
        `node (${node.x},${node.y}) type=${node.type} too close to edge`
      ).toBeGreaterThanOrEqual(defaultBuffer);
      expect(
        node.y,
        `node (${node.x},${node.y}) type=${node.type} too close to edge`
      ).toBeLessThanOrEqual(height - 1 - defaultBuffer);
    }
  });

  it('custom edge buffer is respected', () => {
    const rng = createRng(99);
    const width = 60;
    const height = 60;
    const customBuffer = 8;
    const { mask, graph } = generateCaveNetwork(width, height, 1, 2, 0.3, rng, customBuffer);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y][x]) {
          expect(x).toBeGreaterThanOrEqual(customBuffer);
          expect(x).toBeLessThanOrEqual(width - 1 - customBuffer);
          expect(y).toBeGreaterThanOrEqual(customBuffer);
          expect(y).toBeLessThanOrEqual(height - 1 - customBuffer);
        }
      }
    }

    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(customBuffer);
      expect(node.x).toBeLessThanOrEqual(width - 1 - customBuffer);
      expect(node.y).toBeGreaterThanOrEqual(customBuffer);
      expect(node.y).toBeLessThanOrEqual(height - 1 - customBuffer);
    }
  });
});
