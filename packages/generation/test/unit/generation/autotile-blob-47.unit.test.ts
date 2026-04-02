import { describe, it, expect } from 'vitest';
import {
  calculateBitmask,
  bitmaskToTileIndex,
  getTileIndex,
  applyAutotile,
  applyLayeredAutotile,
  tileIndexToCoordinates,
  loadAutotileConfig,
  generateBitmaskLookupTable,
} from '@dmnpc/generation/autotile/index.js';
import type { Blob47Config } from '@dmnpc/types/world';

// Load the canonical config for testing
const config = loadAutotileConfig('canonical');

describe('47-tile blob autotile', () => {
  describe('calculateBitmask', () => {
    it('returns 0 for isolated tile (no matching neighbors)', () => {
      const grid = [
        ['water', 'water', 'water'],
        ['water', 'grass', 'water'],
        ['water', 'water', 'water'],
      ];
      expect(calculateBitmask(grid, 1, 1, 'grass', config)).toBe(0);
    });

    it('returns 255 for fully surrounded tile (all neighbors match)', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];
      expect(calculateBitmask(grid, 1, 1, 'grass', config)).toBe(255);
    });

    it('calculates correct bitmask for north neighbor only', () => {
      const grid = [
        ['water', 'grass', 'water'],
        ['water', 'grass', 'water'],
        ['water', 'water', 'water'],
      ];
      // N = 1 in canonical convention
      expect(calculateBitmask(grid, 1, 1, 'grass', config)).toBe(config.bitmaskConvention.N);
    });

    it('calculates correct bitmask for all cardinal neighbors', () => {
      const grid = [
        ['water', 'grass', 'water'],
        ['grass', 'grass', 'grass'],
        ['water', 'grass', 'water'],
      ];
      const { N, W, E, S } = config.bitmaskConvention;
      const expected = N | W | E | S;
      expect(calculateBitmask(grid, 1, 1, 'grass', config)).toBe(expected);
    });

    it('treats out-of-bounds as non-matching', () => {
      const grid = [['grass', 'grass', 'grass']];
      // Top-left corner: only E could match
      expect(calculateBitmask(grid, 0, 0, 'grass', config)).toBe(config.bitmaskConvention.E);
    });

    it('handles single-cell grid', () => {
      const grid = [['grass']];
      expect(calculateBitmask(grid, 0, 0, 'grass', config)).toBe(0);
    });
  });

  describe('bitmaskToTileIndex', () => {
    it('returns 0 (isolated) for bitmask 0', () => {
      expect(bitmaskToTileIndex(0, config)).toBe(0);
    });

    it('returns 46 (center all) for bitmask 255', () => {
      expect(bitmaskToTileIndex(255, config)).toBe(46);
    });

    it('returns correct edge tile for single cardinal N', () => {
      // N=1 in canonical, should map to position 1
      expect(bitmaskToTileIndex(config.bitmaskConvention.N, config)).toBe(1);
    });

    it('returns correct edge tile for single cardinal E', () => {
      // E=4 in canonical, should map to position 2
      expect(bitmaskToTileIndex(config.bitmaskConvention.E, config)).toBe(2);
    });

    it('returns correct edge tile for single cardinal S', () => {
      // S=16 in canonical, should map to position 5
      expect(bitmaskToTileIndex(config.bitmaskConvention.S, config)).toBe(5);
    });

    it('returns correct edge tile for single cardinal W', () => {
      // W=64 in canonical, should map to position 13
      expect(bitmaskToTileIndex(config.bitmaskConvention.W, config)).toBe(13);
    });

    it('returns correct corner tile for N+E', () => {
      const { N, E } = config.bitmaskConvention;
      // N+E = 5 in canonical, should map to position 3
      expect(bitmaskToTileIndex(N | E, config)).toBe(3);
    });

    it('returns correct inner corner tile for N+E+NE', () => {
      const { N, E, NE } = config.bitmaskConvention;
      // N+E+NE = 7 in canonical, should map to position 4
      expect(bitmaskToTileIndex(N | E | NE, config)).toBe(4);
    });

    it('returns correct strip tile for N+S (vertical)', () => {
      const { N, S } = config.bitmaskConvention;
      // N+S = 17 in canonical, should map to position 6
      expect(bitmaskToTileIndex(N | S, config)).toBe(6);
    });

    it('returns correct strip tile for E+W (horizontal)', () => {
      const { E, W } = config.bitmaskConvention;
      // E+W = 68 in canonical, should map to position 15
      expect(bitmaskToTileIndex(E | W, config)).toBe(15);
    });

    it('returns center tile for all cardinals', () => {
      const { N, E, S, W } = config.bitmaskConvention;
      // All cardinals = 85 in canonical, should map to position 21
      expect(bitmaskToTileIndex(N | E | S | W, config)).toBe(21);
    });

    it('ignores corner bits when adjacent cardinals are not set', () => {
      // NW corner bit without N or W should be masked out
      const justNW = config.bitmaskConvention.NW;
      expect(bitmaskToTileIndex(justNW, config)).toBe(0); // isolated

      // NW corner bit with only N should be masked out
      const nAndNW = config.bitmaskConvention.N | config.bitmaskConvention.NW;
      expect(bitmaskToTileIndex(nAndNW, config)).toBe(1); // N edge only
    });
  });

  describe('generateBitmaskLookupTable', () => {
    it('has entries for all 256 possible bitmasks', () => {
      const lookup = generateBitmaskLookupTable(config);
      expect(Object.keys(lookup).length).toBe(256);
    });

    it('all values are valid tile indices (0-46)', () => {
      const lookup = generateBitmaskLookupTable(config);
      for (const tileIndex of Object.values(lookup)) {
        expect(tileIndex).toBeGreaterThanOrEqual(0);
        expect(tileIndex).toBeLessThanOrEqual(46);
      }
    });

    it('produces exactly 47 unique tile indices', () => {
      const lookup = generateBitmaskLookupTable(config);
      const uniqueIndices = new Set(Object.values(lookup));
      expect(uniqueIndices.size).toBe(47);
    });
  });

  describe('getTileIndex', () => {
    it('combines bitmask calculation and tile lookup', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];
      // Fully surrounded -> position 46
      expect(getTileIndex(grid, 1, 1, 'grass', config)).toBe(46);
    });
  });

  describe('tileIndexToCoordinates', () => {
    it('converts tile index to tileset coordinates', () => {
      expect(tileIndexToCoordinates(0, 32)).toEqual({ x: 0, y: 0 });
      expect(tileIndexToCoordinates(6, 32)).toEqual({ x: 192, y: 0 });
      expect(tileIndexToCoordinates(7, 32)).toEqual({ x: 0, y: 32 });
      expect(tileIndexToCoordinates(46, 32)).toEqual({ x: 128, y: 192 });
    });
  });

  describe('applyAutotile', () => {
    it('processes entire grid and returns tile indices', () => {
      const grid = [
        ['grass', 'grass'],
        ['grass', 'water'],
      ];

      const result = applyAutotile(grid, config);

      expect(result.length).toBe(2);
      expect(result[0].length).toBe(2);

      // Each cell should have a valid tile index
      for (const row of result) {
        for (const tileIndex of row) {
          expect(tileIndex).toBeGreaterThanOrEqual(0);
          expect(tileIndex).toBeLessThanOrEqual(46);
        }
      }
    });

    it('handles empty grid', () => {
      const result = applyAutotile([], config);
      expect(result).toEqual([]);
    });

    it('produces consistent results', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'water', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result1 = applyAutotile(grid, config);
      const result2 = applyAutotile(grid, config);

      expect(result1).toEqual(result2);
    });
  });

  describe('real-world scenarios', () => {
    it('handles lake in grassland', () => {
      const grid = [
        ['grass', 'grass', 'grass', 'grass', 'grass'],
        ['grass', 'water', 'water', 'water', 'grass'],
        ['grass', 'water', 'water', 'water', 'grass'],
        ['grass', 'water', 'water', 'water', 'grass'],
        ['grass', 'grass', 'grass', 'grass', 'grass'],
      ];

      const result = applyAutotile(grid, config);

      // Center water tile should be fully surrounded (position 46)
      expect(result[2][2]).toBe(46);

      // Grass corners should have correct corner tiles
      // Top-left grass corner: has S and E neighbors matching (grass)
      // But we're autotiling grass, not water, so let's check those
    });

    it('handles single-tile island', () => {
      const grid = [
        ['water', 'water', 'water'],
        ['water', 'grass', 'water'],
        ['water', 'water', 'water'],
      ];

      const result = applyAutotile(grid, config);
      // The grass cell is isolated (no grass neighbors)
      expect(result[1][1]).toBe(0);
    });

    it('handles horizontal path', () => {
      const grid = [
        ['grass', 'grass', 'grass', 'grass', 'grass'],
        ['stone', 'stone', 'stone', 'stone', 'stone'],
        ['grass', 'grass', 'grass', 'grass', 'grass'],
      ];

      const result = applyAutotile(grid, config);

      // Stone path - checking the middle row
      // Left end: only E neighbor matches -> position 2
      expect(result[1][0]).toBe(2);

      // Right end: only W neighbor matches -> position 13
      expect(result[1][4]).toBe(13);

      // Middle tiles: E+W neighbors match -> position 15
      expect(result[1][1]).toBe(15);
      expect(result[1][2]).toBe(15);
      expect(result[1][3]).toBe(15);
    });
  });

  describe('autotile presets', () => {
    it('loads canonical preset', () => {
      const canonical = loadAutotileConfig('canonical');
      expect(canonical.name).toBe('canonical');
      expect(canonical.format).toBe('blob-47');
      expect(canonical.bitmaskConvention.N).toBe(1);
      expect(canonical.bitmaskConvention.E).toBe(4);
    });

    it('loads gamemaker preset', () => {
      const gamemaker = loadAutotileConfig('gamemaker');
      expect(gamemaker.name).toBe('gamemaker');
      expect(gamemaker.format).toBe('blob-47');
      expect(gamemaker.bitmaskConvention.N).toBe(2);
      expect(gamemaker.bitmaskConvention.E).toBe(16);
    });

    it('canonical preset has altCenterCount: 3', () => {
      const canonical = loadAutotileConfig('canonical') as Blob47Config;
      expect(canonical.altCenterCount).toBe(3);
    });

    it('gamemaker preset has altCenterCount: 3', () => {
      const gamemaker = loadAutotileConfig('gamemaker') as Blob47Config;
      expect(gamemaker.altCenterCount).toBe(3);
    });
  });

  describe('alt center tile variation (applyLayeredAutotile)', () => {
    const blob47Config = config as Blob47Config;

    /** Deterministic seeded RNG for testing. */
    function createTestRng(seed: number): () => number {
      let state = seed;
      return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /** 5x5 grid fully filled with one terrain — all interior tiles are center (bitmask 255). */
    function makeFullGrid(terrain: string, size: number = 5): string[][] {
      return Array.from({ length: size }, () => Array(size).fill(terrain) as string[]);
    }

    it('with altCenterCount: 0, center tiles always produce index 46', () => {
      const grid = makeFullGrid('grass');
      const rng = createTestRng(42);
      const result = applyLayeredAutotile(grid, ['grass'], blob47Config, rng, 0);

      // All interior tiles (not on edge) should be exactly 46
      for (let y = 1; y < 4; y++) {
        for (let x = 1; x < 4; x++) {
          expect(result[y][x]).toBe(46);
        }
      }
    });

    it('with altCenterCount: 3 + RNG, center tiles produce indices in [46, 47, 48, 49]', () => {
      const grid = makeFullGrid('grass', 10);
      const rng = createTestRng(42);
      const result = applyLayeredAutotile(grid, ['grass'], blob47Config, rng, 3);

      const centerIndices = new Set<number>();
      // Check interior tiles (away from edges where bitmask != 255)
      for (let y = 1; y < 9; y++) {
        for (let x = 1; x < 9; x++) {
          const idx = result[y][x];
          centerIndices.add(idx);
          expect(idx).toBeGreaterThanOrEqual(46);
          expect(idx).toBeLessThanOrEqual(49);
        }
      }
    });

    it('non-center tiles are completely unaffected by alt center config', () => {
      // Grid with mixed terrain — edge tiles should remain 0-45
      const grid = [
        ['water', 'water', 'water', 'water', 'water'],
        ['water', 'grass', 'grass', 'grass', 'water'],
        ['water', 'grass', 'grass', 'grass', 'water'],
        ['water', 'grass', 'grass', 'grass', 'water'],
        ['water', 'water', 'water', 'water', 'water'],
      ];
      const rng = createTestRng(42);
      const result = applyLayeredAutotile(grid, ['grass'], blob47Config, rng, 3);

      // Edge tiles of the grass region (bitmask != 255) should be 0-45
      // Top-left corner of grass region at (1,1): has E, S, SE neighbors
      expect(result[1][1]).toBeGreaterThanOrEqual(0);
      expect(result[1][1]).toBeLessThanOrEqual(45);

      // Center of grass region at (2,2): fully surrounded, should be 46-49
      expect(result[2][2]).toBeGreaterThanOrEqual(46);
      expect(result[2][2]).toBeLessThanOrEqual(49);
    });

    it('same seed produces same randomization (deterministic)', () => {
      const grid = makeFullGrid('grass', 10);

      const rng1 = createTestRng(12345);
      const result1 = applyLayeredAutotile(grid, ['grass'], blob47Config, rng1, 3);

      const rng2 = createTestRng(12345);
      const result2 = applyLayeredAutotile(grid, ['grass'], blob47Config, rng2, 3);

      expect(result1).toEqual(result2);
    });

    it('distribution: over a large grid, all 4 center variants appear', () => {
      const grid = makeFullGrid('grass', 20);
      const rng = createTestRng(42);
      const result = applyLayeredAutotile(grid, ['grass'], blob47Config, rng, 3);

      const centerVariants = new Set<number>();
      for (let y = 1; y < 19; y++) {
        for (let x = 1; x < 19; x++) {
          centerVariants.add(result[y][x]);
        }
      }

      // All 4 variants (46, 47, 48, 49) should appear in a 20x20 grid
      expect(centerVariants.has(46)).toBe(true);
      expect(centerVariants.has(47)).toBe(true);
      expect(centerVariants.has(48)).toBe(true);
      expect(centerVariants.has(49)).toBe(true);
    });

    it('undefined altCenterCount on layer config falls back to format default', () => {
      const grid = makeFullGrid('grass', 10);
      const rng = createTestRng(42);

      // Pass undefined altCenterCount — should use config.altCenterCount (3)
      const result = applyLayeredAutotile(grid, ['grass'], blob47Config, rng, undefined);

      const centerVariants = new Set<number>();
      for (let y = 1; y < 9; y++) {
        for (let x = 1; x < 9; x++) {
          centerVariants.add(result[y][x]);
        }
      }

      // Should see variation (not all 46)
      expect(centerVariants.size).toBeGreaterThan(1);
    });

    it('without RNG, center tiles remain at index 46', () => {
      const grid = makeFullGrid('grass');
      // No RNG passed — should work exactly like before
      const result = applyLayeredAutotile(grid, ['grass'], blob47Config);

      for (let y = 1; y < 4; y++) {
        for (let x = 1; x < 4; x++) {
          expect(result[y][x]).toBe(46);
        }
      }
    });

    it('transparent cells remain -1 regardless of alt center config', () => {
      const grid = [
        ['water', 'grass'],
        ['grass', 'water'],
      ];
      const rng = createTestRng(42);
      const result = applyLayeredAutotile(grid, ['grass'], blob47Config, rng, 3);

      // Water cells should be -1
      expect(result[0][0]).toBe(-1);
      expect(result[1][1]).toBe(-1);
    });
  });
});
