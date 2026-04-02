import { describe, it, expect } from 'vitest';
import {
  calculateWang2CornerIndex,
  applyWang2CornerAutotile,
  applyWang2CornerLayered,
  wang2CornerIndexToCoords,
  WANG_2CORNER_WEIGHTS,
  loadAutotileConfig,
} from '@dmnpc/generation/autotile/index.js';

// Load the wang2corner-clean config for testing
const config = loadAutotileConfig('wang2corner-clean');

describe('Wang 2-corner (16-tile) standard autotile', () => {
  describe('WANG_2CORNER_WEIGHTS', () => {
    it('has correct corner weights', () => {
      expect(WANG_2CORNER_WEIGHTS.NE).toBe(1);
      expect(WANG_2CORNER_WEIGHTS.SE).toBe(2);
      expect(WANG_2CORNER_WEIGHTS.SW).toBe(4);
      expect(WANG_2CORNER_WEIGHTS.NW).toBe(8);
    });

    it('weights sum to 15 for all corners', () => {
      const sum =
        WANG_2CORNER_WEIGHTS.NE +
        WANG_2CORNER_WEIGHTS.SE +
        WANG_2CORNER_WEIGHTS.SW +
        WANG_2CORNER_WEIGHTS.NW;
      expect(sum).toBe(15);
    });
  });

  describe('calculateWang2CornerIndex', () => {
    it('returns 0 when no corners match', () => {
      // 2x2 grid representing corners of a single tile
      const grid = [
        ['water', 'water'],
        ['water', 'water'],
      ];
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(0);
    });

    it('returns 15 when all corners match', () => {
      const grid = [
        ['grass', 'grass'],
        ['grass', 'grass'],
      ];
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(15);
    });

    it('returns correct index for NW corner only', () => {
      const grid = [
        ['grass', 'water'],
        ['water', 'water'],
      ];
      // NW = (0,0) = grass = weight 8
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(WANG_2CORNER_WEIGHTS.NW);
    });

    it('returns correct index for NE corner only', () => {
      const grid = [
        ['water', 'grass'],
        ['water', 'water'],
      ];
      // NE = (1,0) = grass = weight 1
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(WANG_2CORNER_WEIGHTS.NE);
    });

    it('returns correct index for SW corner only', () => {
      const grid = [
        ['water', 'water'],
        ['grass', 'water'],
      ];
      // SW = (0,1) = grass = weight 4
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(WANG_2CORNER_WEIGHTS.SW);
    });

    it('returns correct index for SE corner only', () => {
      const grid = [
        ['water', 'water'],
        ['water', 'grass'],
      ];
      // SE = (1,1) = grass = weight 2
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(WANG_2CORNER_WEIGHTS.SE);
    });

    it('returns correct index for top edge (NW + NE)', () => {
      const grid = [
        ['grass', 'grass'],
        ['water', 'water'],
      ];
      // NW(8) + NE(1) = 9
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(
        WANG_2CORNER_WEIGHTS.NW | WANG_2CORNER_WEIGHTS.NE
      );
    });

    it('returns correct index for bottom edge (SW + SE)', () => {
      const grid = [
        ['water', 'water'],
        ['grass', 'grass'],
      ];
      // SW(4) + SE(2) = 6
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(
        WANG_2CORNER_WEIGHTS.SW | WANG_2CORNER_WEIGHTS.SE
      );
    });

    it('returns correct index for left edge (NW + SW)', () => {
      const grid = [
        ['grass', 'water'],
        ['grass', 'water'],
      ];
      // NW(8) + SW(4) = 12
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(
        WANG_2CORNER_WEIGHTS.NW | WANG_2CORNER_WEIGHTS.SW
      );
    });

    it('returns correct index for right edge (NE + SE)', () => {
      const grid = [
        ['water', 'grass'],
        ['water', 'grass'],
      ];
      // NE(1) + SE(2) = 3
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(
        WANG_2CORNER_WEIGHTS.NE | WANG_2CORNER_WEIGHTS.SE
      );
    });

    it('handles multiple terrain types as matching', () => {
      const grid = [
        ['grass', 'forest'],
        ['forest', 'grass'],
      ];
      // All corners match when we pass both grass and forest
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass', 'forest'])).toBe(15);
    });

    it('handles out of bounds as non-matching', () => {
      const grid = [['grass']];
      // Only NW corner is within bounds
      expect(calculateWang2CornerIndex(grid, 0, 0, ['grass'])).toBe(WANG_2CORNER_WEIGHTS.NW);
    });
  });

  describe('applyWang2CornerAutotile', () => {
    it('returns grid one smaller in each dimension', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result = applyWang2CornerAutotile(grid, ['grass']);

      // 3x3 input -> 2x2 output (corners-based)
      expect(result.length).toBe(2);
      expect(result[0].length).toBe(2);
    });

    it('returns all 15s for uniform matching grid', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result = applyWang2CornerAutotile(grid, ['grass']);

      for (const row of result) {
        for (const tile of row) {
          expect(tile).toBe(15);
        }
      }
    });

    it('returns all 0s for non-matching grid', () => {
      const grid = [
        ['water', 'water', 'water'],
        ['water', 'water', 'water'],
        ['water', 'water', 'water'],
      ];

      const result = applyWang2CornerAutotile(grid, ['grass']);

      for (const row of result) {
        for (const tile of row) {
          expect(tile).toBe(0);
        }
      }
    });

    it('handles empty grid', () => {
      const result = applyWang2CornerAutotile([], ['grass']);
      expect(result).toEqual([]);
    });

    it('handles 1x1 grid', () => {
      const grid = [['grass']];
      const result = applyWang2CornerAutotile(grid, ['grass']);
      // 1x1 -> 0x0 output
      expect(result).toEqual([]);
    });
  });

  describe('applyWang2CornerLayered', () => {
    it('returns same dimensions as input', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result = applyWang2CornerLayered(grid, ['grass'], config);

      expect(result.length).toBe(3);
      expect(result[0].length).toBe(3);
    });

    it('returns -1 for cells not in match terrains', () => {
      const grid = [
        ['water', 'grass', 'water'],
        ['grass', 'grass', 'grass'],
        ['water', 'grass', 'water'],
      ];

      const result = applyWang2CornerLayered(grid, ['grass'], config);

      // Water cells should be -1
      expect(result[0][0]).toBe(-1);
      expect(result[0][2]).toBe(-1);
      expect(result[2][0]).toBe(-1);
      expect(result[2][2]).toBe(-1);

      // Grass cells should have valid indices
      expect(result[1][1]).toBeGreaterThanOrEqual(0);
    });

    it('handles single grass cell in water - Mini Micro formula includes cell itself', () => {
      const grid = [
        ['water', 'water', 'water'],
        ['water', 'grass', 'water'],
        ['water', 'water', 'water'],
      ];

      const result = applyWang2CornerLayered(grid, ['grass'], config);

      // Mini Micro formula: 1*corner(x,y) + 2*corner(x,y+1) + 4*corner(x-1,y+1) + 8*corner(x-1,y)
      // Center cell (1,1): 1*grass + 2*water + 4*water + 8*water = 1
      expect(result[1][1]).toBe(1);
    });

    it('handles 2x2 grass block - each cell uses Mini Micro formula', () => {
      const grid = [
        ['water', 'water', 'water', 'water'],
        ['water', 'grass', 'grass', 'water'],
        ['water', 'grass', 'grass', 'water'],
        ['water', 'water', 'water', 'water'],
      ];

      const result = applyWang2CornerLayered(grid, ['grass'], config);

      // Formula: n = 1*corner(x,y) + 2*corner(x,y+1) + 4*corner(x-1,y+1) + 8*corner(x-1,y)
      // Top-left grass (1,1): 1*grass(1,1) + 2*grass(1,2) + 4*water(0,2) + 8*water(0,1) = 1+2+0+0 = 3
      expect(result[1][1]).toBe(3);
      // Top-right grass (1,2): 1*grass(2,1) + 2*grass(2,2) + 4*grass(1,2) + 8*grass(1,1) = 1+2+4+8 = 15
      expect(result[1][2]).toBe(15);
      // Bottom-left grass (2,1): 1*grass(1,2) + 2*water(1,3) + 4*water(0,3) + 8*grass(0,2) = 1+0+0+0 = 1
      expect(result[2][1]).toBe(1);
      // Bottom-right grass (2,2): 1*grass(2,2) + 2*water(2,3) + 4*grass(1,3) + 8*grass(1,2) = 1+0+0+8 = 9
      expect(result[2][2]).toBe(9);
    });

    it('handles interior cell with all diagonal neighbors matching', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result = applyWang2CornerLayered(grid, ['grass'], config);

      // Center cell has all 4 diagonal neighbors = index 15
      expect(result[1][1]).toBe(15);
    });
  });

  describe('wang2CornerIndexToCoords', () => {
    it('converts index 0 to origin', () => {
      expect(wang2CornerIndexToCoords(0, 32, 4)).toEqual({ x: 0, y: 0 });
    });

    it('converts index 3 to end of first row', () => {
      expect(wang2CornerIndexToCoords(3, 32, 4)).toEqual({ x: 96, y: 0 });
    });

    it('converts index 4 to start of second row', () => {
      expect(wang2CornerIndexToCoords(4, 32, 4)).toEqual({ x: 0, y: 32 });
    });

    it('converts index 15 to last position', () => {
      expect(wang2CornerIndexToCoords(15, 32, 4)).toEqual({ x: 96, y: 96 });
    });

    it('handles different tile sizes', () => {
      expect(wang2CornerIndexToCoords(5, 16, 4)).toEqual({ x: 16, y: 16 });
    });
  });

  describe('autotile preset', () => {
    it('loads wang2corner-clean preset', () => {
      const preset = loadAutotileConfig('wang2corner-clean');
      expect(preset.name).toBe('wang2corner-clean');
      expect(preset.format).toBe('wang-2corner');
      expect(preset.tileCount).toBe(16);
    });

    it('has correct grid size', () => {
      const preset = loadAutotileConfig('wang2corner-clean');
      if (preset.format === 'wang-2corner') {
        // The preset uses 16 cols to fit all 16 tiles in a 512x128 image
        expect(preset.gridSize).toEqual({ cols: 16, rows: 4 });
        expect(preset.tileSize).toBe(32);
      }
    });
  });

  describe('real-world scenarios', () => {
    it('handles island in ocean', () => {
      const grid = [
        ['water', 'water', 'water', 'water', 'water'],
        ['water', 'grass', 'grass', 'grass', 'water'],
        ['water', 'grass', 'grass', 'grass', 'water'],
        ['water', 'grass', 'grass', 'grass', 'water'],
        ['water', 'water', 'water', 'water', 'water'],
      ];

      const result = applyWang2CornerLayered(grid, ['grass'], config);

      // Center should have high index (surrounded by grass)
      expect(result[2][2]).toBeGreaterThan(0);

      // Water cells should be transparent
      expect(result[0][0]).toBe(-1);
      expect(result[4][4]).toBe(-1);
    });

    it('handles forest on grass', () => {
      const grid = [
        ['grass', 'grass', 'grass', 'grass'],
        ['grass', 'forest', 'forest', 'grass'],
        ['grass', 'forest', 'forest', 'grass'],
        ['grass', 'grass', 'grass', 'grass'],
      ];

      // Forest layer should work
      const forestResult = applyWang2CornerLayered(grid, ['forest'], config);

      // Grass cells should be -1 in forest layer
      expect(forestResult[0][0]).toBe(-1);
      expect(forestResult[0][3]).toBe(-1);

      // Forest cells should have valid indices
      expect(forestResult[1][1]).toBeGreaterThanOrEqual(0);
      expect(forestResult[2][2]).toBeGreaterThanOrEqual(0);

      // Grass layer treating forest as same terrain
      const grassResult = applyWang2CornerLayered(grid, ['grass', 'forest'], config);

      // All cells should have valid indices when both terrains match
      for (const row of grassResult) {
        for (const tile of row) {
          expect(tile).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('produces consistent results', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'water', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result1 = applyWang2CornerLayered(grid, ['grass'], config);
      const result2 = applyWang2CornerLayered(grid, ['grass'], config);

      expect(result1).toEqual(result2);
    });
  });
});
