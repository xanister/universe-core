import { describe, it, expect } from 'vitest';
import {
  calculateWang16Index,
  applyWang16Autotile,
  applyWang16LayeredAutotile,
  wang16IndexToCoordinates,
  STANDARD_WANG16_CONVENTION,
  loadAutotileConfig,
} from '@dmnpc/generation/autotile/index.js';

// Load the wang16-lpc config for testing
const config = loadAutotileConfig('wang16-lpc');
const convention = STANDARD_WANG16_CONVENTION;

describe('Wang 2-corner (16-tile) autotile', () => {
  describe('calculateWang16Index', () => {
    it('returns 0 when no corners match', () => {
      // For position (0,0), check cells (0,0), (1,0), (0,1), (1,1)
      const grid = [
        ['water', 'water'],
        ['water', 'water'],
      ];
      // Looking for 'grass' - no cells match
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(0);
    });

    it('returns 15 when all corners match', () => {
      const grid = [
        ['grass', 'grass'],
        ['grass', 'grass'],
      ];
      // All 4 cells are grass
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(15);
    });

    it('returns correct index for NW corner only', () => {
      const grid = [
        ['grass', 'water'],
        ['water', 'water'],
      ];
      // NW = cell(0,0) = grass = 8
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(convention.NW);
    });

    it('returns correct index for NE corner only', () => {
      const grid = [
        ['water', 'grass'],
        ['water', 'water'],
      ];
      // NE = cell(1,0) = grass = 1
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(convention.NE);
    });

    it('returns correct index for SW corner only', () => {
      const grid = [
        ['water', 'water'],
        ['grass', 'water'],
      ];
      // SW = cell(0,1) = grass = 4
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(convention.SW);
    });

    it('returns correct index for SE corner only', () => {
      const grid = [
        ['water', 'water'],
        ['water', 'grass'],
      ];
      // SE = cell(1,1) = grass = 2
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(convention.SE);
    });

    it('returns correct index for top edge (NW + NE)', () => {
      const grid = [
        ['grass', 'grass'],
        ['water', 'water'],
      ];
      // NW(8) + NE(1) = 9
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(
        convention.NW | convention.NE
      );
    });

    it('returns correct index for bottom edge (SW + SE)', () => {
      const grid = [
        ['water', 'water'],
        ['grass', 'grass'],
      ];
      // SW(4) + SE(2) = 6
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(
        convention.SW | convention.SE
      );
    });

    it('returns correct index for left edge (NW + SW)', () => {
      const grid = [
        ['grass', 'water'],
        ['grass', 'water'],
      ];
      // NW(8) + SW(4) = 12
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(
        convention.NW | convention.SW
      );
    });

    it('returns correct index for right edge (NE + SE)', () => {
      const grid = [
        ['water', 'grass'],
        ['water', 'grass'],
      ];
      // NE(1) + SE(2) = 3
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(
        convention.NE | convention.SE
      );
    });

    it('returns correct index for diagonal NW-SE', () => {
      const grid = [
        ['grass', 'water'],
        ['water', 'grass'],
      ];
      // NW(8) + SE(2) = 10
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(
        convention.NW | convention.SE
      );
    });

    it('returns correct index for diagonal NE-SW', () => {
      const grid = [
        ['water', 'grass'],
        ['grass', 'water'],
      ];
      // NE(1) + SW(4) = 5
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(
        convention.NE | convention.SW
      );
    });

    it('handles multiple terrain types as matching', () => {
      const grid = [
        ['grass', 'forest'],
        ['forest', 'grass'],
      ];
      // All corners should match if we pass both grass and forest
      expect(calculateWang16Index(grid, 0, 0, ['grass', 'forest'], convention)).toBe(15);
    });

    it('handles out of bounds as non-matching', () => {
      const grid = [['grass']];
      // Only NW corner is within bounds
      expect(calculateWang16Index(grid, 0, 0, ['grass'], convention)).toBe(convention.NW);
    });
  });

  describe('applyWang16Autotile', () => {
    it('returns grid one smaller in each dimension', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result = applyWang16Autotile(grid, ['grass'], convention);

      // 3x3 input -> 2x2 output
      expect(result.length).toBe(2);
      expect(result[0].length).toBe(2);
    });

    it('returns all 15s for uniform grid', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result = applyWang16Autotile(grid, ['grass'], convention);

      // All tiles should be 15 (all corners filled)
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

      const result = applyWang16Autotile(grid, ['grass'], convention);

      // All tiles should be 0 (no corners filled)
      for (const row of result) {
        for (const tile of row) {
          expect(tile).toBe(0);
        }
      }
    });

    it('handles empty grid', () => {
      const result = applyWang16Autotile([], ['grass'], convention);
      expect(result).toEqual([]);
    });

    it('handles 1x1 grid', () => {
      const grid = [['grass']];
      const result = applyWang16Autotile(grid, ['grass'], convention);
      // 1x1 -> 0x0 output
      expect(result).toEqual([]);
    });
  });

  describe('applyWang16LayeredAutotile', () => {
    it('returns same dimensions as input', () => {
      const grid = [
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
        ['grass', 'grass', 'grass'],
      ];

      const result = applyWang16LayeredAutotile(grid, ['grass'], config);

      expect(result.length).toBe(3);
      expect(result[0].length).toBe(3);
    });

    it('returns -1 for cells not in match terrains', () => {
      const grid = [
        ['water', 'grass', 'water'],
        ['grass', 'grass', 'grass'],
        ['water', 'grass', 'water'],
      ];

      const result = applyWang16LayeredAutotile(grid, ['grass'], config);

      // Water cells should be -1
      expect(result[0][0]).toBe(-1);
      expect(result[0][2]).toBe(-1);
      expect(result[2][0]).toBe(-1);
      expect(result[2][2]).toBe(-1);

      // Grass cells should have valid indices
      expect(result[1][1]).toBeGreaterThanOrEqual(0);
    });

    it('handles single grass cell in water', () => {
      const grid = [
        ['water', 'water', 'water'],
        ['water', 'grass', 'water'],
        ['water', 'water', 'water'],
      ];

      const result = applyWang16LayeredAutotile(grid, ['grass'], config);

      // Only center is grass, but no neighbors match, so index should be 0
      expect(result[1][1]).toBe(0);
    });

    it('handles adjacent grass cells', () => {
      const grid = [
        ['water', 'water', 'water', 'water'],
        ['water', 'grass', 'grass', 'water'],
        ['water', 'grass', 'grass', 'water'],
        ['water', 'water', 'water', 'water'],
      ];

      const result = applyWang16LayeredAutotile(grid, ['grass'], config);

      // Check that grass cells have non-zero indices
      expect(result[1][1]).toBeGreaterThan(0);
      expect(result[1][2]).toBeGreaterThan(0);
      expect(result[2][1]).toBeGreaterThan(0);
      expect(result[2][2]).toBeGreaterThan(0);
    });
  });

  describe('wang16IndexToCoordinates', () => {
    it('converts index 0 to origin', () => {
      expect(wang16IndexToCoordinates(0, 32, 4)).toEqual({ x: 0, y: 0 });
    });

    it('converts index 3 to end of first row', () => {
      expect(wang16IndexToCoordinates(3, 32, 4)).toEqual({ x: 96, y: 0 });
    });

    it('converts index 4 to start of second row', () => {
      expect(wang16IndexToCoordinates(4, 32, 4)).toEqual({ x: 0, y: 32 });
    });

    it('converts index 15 to last position', () => {
      expect(wang16IndexToCoordinates(15, 32, 4)).toEqual({ x: 96, y: 96 });
    });

    it('handles different tile sizes', () => {
      expect(wang16IndexToCoordinates(5, 16, 4)).toEqual({ x: 16, y: 16 });
    });

    it('handles different grid columns', () => {
      // 8 columns means index 8 is at row 1, col 0
      expect(wang16IndexToCoordinates(8, 32, 8)).toEqual({ x: 0, y: 32 });
    });
  });

  describe('autotile preset', () => {
    it('loads wang16-lpc preset', () => {
      const preset = loadAutotileConfig('wang16-lpc');
      expect(preset.name).toBe('wang16-lpc');
      expect(preset.format).toBe('wang-16');
      expect(preset.tileCount).toBe(16);
    });

    it('has correct corner convention', () => {
      const preset = loadAutotileConfig('wang16-lpc');
      if (preset.format === 'wang-16') {
        expect(preset.cornerConvention.NE).toBe(1);
        expect(preset.cornerConvention.SE).toBe(2);
        expect(preset.cornerConvention.SW).toBe(4);
        expect(preset.cornerConvention.NW).toBe(8);
      }
    });

    it('has correct grid size', () => {
      const preset = loadAutotileConfig('wang16-lpc');
      if (preset.format === 'wang-16') {
        expect(preset.gridSize).toEqual({ cols: 4, rows: 4 });
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

      const result = applyWang16LayeredAutotile(grid, ['grass'], config);

      // Center should have all corners filled (index 15)
      expect(result[2][2]).toBe(15);

      // Corners of island should have 1 corner filled
      // Top-left grass (1,1): SE corner filled
      // Actually, for layered autotile, we check adjacent cells for continuity
    });

    it('handles forest on grass', () => {
      const grid = [
        ['grass', 'grass', 'grass', 'grass'],
        ['grass', 'forest', 'forest', 'grass'],
        ['grass', 'forest', 'forest', 'grass'],
        ['grass', 'grass', 'grass', 'grass'],
      ];

      // Forest layer should work
      const forestResult = applyWang16LayeredAutotile(grid, ['forest'], config);

      // Grass cells should be -1 in forest layer
      expect(forestResult[0][0]).toBe(-1);
      expect(forestResult[0][3]).toBe(-1);

      // Forest cells should have valid indices
      expect(forestResult[1][1]).toBeGreaterThanOrEqual(0);
      expect(forestResult[2][2]).toBeGreaterThanOrEqual(0);

      // Grass layer treating forest as same terrain
      const grassResult = applyWang16LayeredAutotile(grid, ['grass', 'forest'], config);

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

      const result1 = applyWang16LayeredAutotile(grid, ['grass'], config);
      const result2 = applyWang16LayeredAutotile(grid, ['grass'], config);

      expect(result1).toEqual(result2);
    });
  });
});
