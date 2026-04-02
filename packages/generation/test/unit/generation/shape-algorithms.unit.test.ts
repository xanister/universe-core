/**
 * Unit tests for the terrain layer processor.
 *
 * Tests the layer-driven shape generation system:
 * - Layer type handlers (rectangle, l_shape, t_shape, wall, fill)
 * - Automatic north-facing wall overhead passthrough
 * - Dimension resolution
 * - Blocking composition
 * - Seed determinism
 */

import { describe, it, expect } from 'vitest';
import { processLayers } from '@dmnpc/generation/place-layout/algorithms/shape-algorithms.js';
import type { LayoutVariant, TerrainLayerConfig } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS, createDefaultLayerConfig, LAYER_TYPES } from '@dmnpc/types/world';

// ============================================================================
// Test Helpers
// ============================================================================

function makeVariant(overrides: Partial<LayoutVariant>): LayoutVariant {
  return {
    id: 'test',
    scale: 'feet',
    environment: ENVIRONMENT_PRESETS.interior(),
    width: { min: 10, max: 20 },
    height: { min: 10, max: 20 },
    terrainLayers: [],
    slots: [],
    description: 'test variant',
    weight: 1,
    defaultBlocked: false,
    ...overrides,
  };
}

// ============================================================================
// Layer Processor
// ============================================================================

describe('processLayers', () => {
  describe('empty layers', () => {
    it('returns valid shape with no layers', () => {
      const variant = makeVariant({
        width: { min: 15, max: 15 },
        height: { min: 10, max: 10 },
      });

      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.bounds.width).toBe(15);
      expect(shape.bounds.height).toBe(10);
      expect(shape.layers).toEqual([]);
      expect(shape.layerMasks).toEqual({});
    });

    it('initializes blockedMask to all false when defaultBlocked is false', () => {
      const variant = makeVariant({
        width: { min: 5, max: 5 },
        height: { min: 5, max: 5 },
        defaultBlocked: false,
      });

      const shape = processLayers(variant, 0, 0, 42);

      for (const row of shape.blockedMask) {
        for (const cell of row) {
          expect(cell).toBe(false);
        }
      }
    });

    it('initializes blockedMask to all true when defaultBlocked is true', () => {
      const variant = makeVariant({
        width: { min: 5, max: 5 },
        height: { min: 5, max: 5 },
        defaultBlocked: true,
      });

      const shape = processLayers(variant, 0, 0, 42);

      for (const row of shape.blockedMask) {
        for (const cell of row) {
          expect(cell).toBe(true);
        }
      }
    });

    it('defaultBlocked true + unblocking layer carves walkable area', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        defaultBlocked: true,
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      const roomMask = shape.layerMasks['room'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (roomMask[y][x]) {
            expect(shape.blockedMask[y][x]).toBe(false);
          } else {
            expect(shape.blockedMask[y][x]).toBe(true);
          }
        }
      }
    });
  });

  describe('rectangle layer', () => {
    it('generates a rectangular room mask inset from edges', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.layers).toHaveLength(1);
      expect(shape.layers[0].id).toBe('room');

      // Edges should be empty (inset), interior should have tiles
      const tiles = shape.layers[0].tiles;
      expect(tiles[0][0]).toBe(-1); // Corner - outside inset
      expect(tiles[1][1]).toBe(0); // Interior - floor tile
    });
  });

  describe('l_shape layer', () => {
    it('generates an L-shaped room mask', () => {
      const variant = makeVariant({
        width: { min: 15, max: 15 },
        height: { min: 15, max: 15 },
        terrainLayers: [
          {
            id: 'room',
            type: 'l_shape',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
            minArmWidth: 2,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.layers).toHaveLength(1);
      expect(shape.bounds.width).toBe(15);

      // L-shape should have some cut-out area (blocked tiles in the room mask)
      const mask = shape.layerMasks['room'];
      let hasTrue = false;
      let hasFalse = false;
      for (const row of mask) {
        for (const cell of row) {
          if (cell) hasTrue = true;
          else hasFalse = true;
        }
      }
      expect(hasTrue).toBe(true);
      expect(hasFalse).toBe(true);
    });
  });

  describe('t_shape layer', () => {
    it('generates a T-shaped room mask', () => {
      const variant = makeVariant({
        width: { min: 15, max: 15 },
        height: { min: 15, max: 15 },
        terrainLayers: [
          {
            id: 'room',
            type: 't_shape',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
            minArmWidth: 2,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.layers).toHaveLength(1);

      // T-shape should have some cut-out area
      const mask = shape.layerMasks['room'];
      let hasTrue = false;
      let hasFalse = false;
      for (const row of mask) {
        for (const cell of row) {
          if (cell) hasTrue = true;
          else hasFalse = true;
        }
      }
      expect(hasTrue).toBe(true);
      expect(hasFalse).toBe(true);
    });
  });

  describe('l_shape minimum arm width', () => {
    function makeLayer(minArmWidth: number) {
      return {
        id: 'room',
        type: 'l_shape' as const,
        tilesetId: 'lpc-interior-floors',
        tilesetOffset: null,
        renderOrder: 0,
        blocking: 'unblocks' as const,
        terrain: 'land' as const,
        fill: [0],
        minArmWidth,
      };
    }

    it('both arms are >= minArmWidth across 50 seeds on an 8×8 room', () => {
      for (let seed = 0; seed < 50; seed++) {
        const variant = makeVariant({
          width: { min: 8, max: 8 },
          height: { min: 8, max: 8 },
          terrainLayers: [makeLayer(2)],
        });
        const shape = processLayers(variant, 0, 0, seed);
        const mask = shape.layerMasks['room'];
        const h = shape.bounds.height;
        const w = shape.bounds.width;

        for (let col = 0; col < w; col++) {
          let span = 0;
          for (let row = 0; row < h; row++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
        for (let row = 0; row < h; row++) {
          let span = 0;
          for (let col = 0; col < w; col++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('both arms are >= minArmWidth across 50 seeds on a larger room', () => {
      for (let seed = 0; seed < 50; seed++) {
        const variant = makeVariant({
          width: { min: 15, max: 15 },
          height: { min: 15, max: 15 },
          terrainLayers: [makeLayer(2)],
        });
        const shape = processLayers(variant, 0, 0, seed);
        const mask = shape.layerMasks['room'];
        const h = shape.bounds.height;
        const w = shape.bounds.width;

        for (let col = 0; col < w; col++) {
          let span = 0;
          for (let row = 0; row < h; row++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
        for (let row = 0; row < h; row++) {
          let span = 0;
          for (let col = 0; col < w; col++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('extension arm depth >= minArmWidth at minimum corridor height (BUG-172)', () => {
      // Ship corridor scenario: 16×9 grid → innerH=7. Before fix, cutHeight
      // could be floor(7*0.3)=2 which equals minArmWidth but with even smaller
      // innerH (e.g. 8×6 → innerH=4) the 30% range produced cutHeight=1 < minArmWidth.
      const minArmWidth = 2;
      for (let seed = 0; seed < 100; seed++) {
        const variant = makeVariant({
          width: { min: 8, max: 8 },
          height: { min: 6, max: 6 },
          terrainLayers: [makeLayer(minArmWidth)],
        });
        const shape = processLayers(variant, 0, 0, seed);
        const mask = shape.layerMasks['room'];
        const h = shape.bounds.height;
        const w = shape.bounds.width;

        // Find the cut region: the rectangular void inside the inset boundary.
        // The cut is the contiguous block of false tiles surrounded by true tiles.
        // Measure extension arm depth by finding the exclusive rows/cols of each arm.
        const rowHasFloor: boolean[] = [];
        const colHasFloor: boolean[] = [];
        const rowFloorCounts: number[] = [];
        const colFloorCounts: number[] = [];

        for (let row = 0; row < h; row++) {
          let count = 0;
          for (let col = 0; col < w; col++) {
            if (mask[row][col]) count++;
          }
          rowHasFloor.push(count > 0);
          rowFloorCounts.push(count);
        }
        for (let col = 0; col < w; col++) {
          let count = 0;
          for (let row = 0; row < h; row++) {
            if (mask[row][col]) count++;
          }
          colHasFloor.push(count > 0);
          colFloorCounts.push(count);
        }

        // Find the max floor width (full arm) and a narrower width (extension arm).
        const maxRowWidth = Math.max(...rowFloorCounts);
        const maxColHeight = Math.max(...colFloorCounts);

        // Extension arm rows are those with fewer floor tiles than the widest row.
        const extensionRows = rowFloorCounts.filter(
          (c) => c > 0 && c < maxRowWidth
        );
        const extensionCols = colFloorCounts.filter(
          (c) => c > 0 && c < maxColHeight
        );

        // At least one extension arm must exist (it's an L, not a rectangle)
        const hasExtension = extensionRows.length > 0 || extensionCols.length > 0;
        expect(hasExtension).toBe(true);

        // Extension arm depth (number of exclusive rows or columns) must be >= minArmWidth
        if (extensionRows.length > 0) {
          expect(extensionRows.length).toBeGreaterThanOrEqual(minArmWidth);
        }
        if (extensionCols.length > 0) {
          expect(extensionCols.length).toBeGreaterThanOrEqual(minArmWidth);
        }
      }
    });
  });

  describe('t_shape minimum arm width', () => {
    function makeLayer(minArmWidth: number) {
      return {
        id: 'room',
        type: 't_shape' as const,
        tilesetId: 'lpc-interior-floors',
        tilesetOffset: null,
        renderOrder: 0,
        blocking: 'unblocks' as const,
        terrain: 'land' as const,
        fill: [0],
        minArmWidth,
      };
    }

    it('stem and wings are >= minArmWidth across 50 seeds on an 8×8 room', () => {
      for (let seed = 0; seed < 50; seed++) {
        const variant = makeVariant({
          width: { min: 8, max: 8 },
          height: { min: 8, max: 8 },
          terrainLayers: [makeLayer(2)],
        });
        const shape = processLayers(variant, 0, 0, seed);
        const mask = shape.layerMasks['room'];
        const h = shape.bounds.height;
        const w = shape.bounds.width;

        for (let col = 0; col < w; col++) {
          let span = 0;
          for (let row = 0; row < h; row++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
        for (let row = 0; row < h; row++) {
          let span = 0;
          for (let col = 0; col < w; col++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('stem and wings are >= minArmWidth across 50 seeds on a larger room', () => {
      for (let seed = 0; seed < 50; seed++) {
        const variant = makeVariant({
          width: { min: 15, max: 15 },
          height: { min: 15, max: 15 },
          terrainLayers: [makeLayer(2)],
        });
        const shape = processLayers(variant, 0, 0, seed);
        const mask = shape.layerMasks['room'];
        const h = shape.bounds.height;
        const w = shape.bounds.width;

        for (let col = 0; col < w; col++) {
          let span = 0;
          for (let row = 0; row < h; row++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
        for (let row = 0; row < h; row++) {
          let span = 0;
          for (let col = 0; col < w; col++) {
            if (mask[row][col]) span++;
          }
          if (span > 0) expect(span).toBeGreaterThanOrEqual(2);
        }
      }
    });
  });

  describe('wall layer', () => {
    it('traces the boundary of the layer below', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
          },
          {
            id: 'walls',
            type: 'wall',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            renderOrder: 100,
            blocking: 'blocks',
            terrain: 'wall',
            fill: [],
            wallStyle: 'brick_brown',
            inheritable: false,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // 3 layers: floor + wall + automatic north-overhead
      expect(shape.layers).toHaveLength(3);

      // Wall layer should have tiles where room boundary is
      const wallMask = shape.layerMasks['walls'];
      let hasWalls = false;
      for (const row of wallMask) {
        for (const cell of row) {
          if (cell) hasWalls = true;
        }
      }
      expect(hasWalls).toBe(true);

      // Non-north-facing wall tiles should be blocked
      const northMask = shape.layerMasks['walls__north_overhead'];
      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (wallMask[y][x] && !northMask?.[y]?.[x]) {
            expect(shape.blockedMask[y][x]).toBe(true);
          }
        }
      }
    });

    it('places wall tiles at room boundary cells', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
          },
          {
            id: 'walls',
            type: 'wall',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            renderOrder: 100,
            blocking: 'blocks',
            terrain: 'wall',
            fill: [],
            wallStyle: 'brick_brown',
            inheritable: false,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      const wallMask = shape.layerMasks['walls'];
      const roomMask = shape.layerMasks['room'];

      // Wang 2-corner walls appear on room cells that are not fully interior.
      // Room boundary cells (e.g. [1,1]) should have wall tiles.
      // Cells outside the room (e.g. [0,0]) get no wall tile (corner key 0,0,0,0).
      const roomBoundary = [
        [1, 1],
        [1, shape.bounds.width - 2],
        [shape.bounds.height - 2, 1],
        [shape.bounds.height - 2, shape.bounds.width - 2],
      ];

      for (const [y, x] of roomBoundary) {
        expect(roomMask[y][x]).toBe(true);
        expect(wallMask[y][x]).toBe(true);
      }
    });
  });

  describe('blocking composition', () => {
    it('room unblocks, wall blocks', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
          },
          {
            id: 'walls',
            type: 'wall',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            renderOrder: 100,
            blocking: 'blocks',
            terrain: 'wall',
            fill: [],
            wallStyle: 'brick_brown',
            inheritable: false,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      let hasBlocked = false;
      let hasUnblocked = false;
      for (const row of shape.blockedMask) {
        for (const cell of row) {
          if (cell) hasBlocked = true;
          else hasUnblocked = true;
        }
      }
      expect(hasBlocked).toBe(true);
      expect(hasUnblocked).toBe(true);
    });
  });

  describe('dimension resolution', () => {
    it('uses template range when targetWidth is 0', () => {
      const variant = makeVariant({
        width: { min: 15, max: 15 },
        height: { min: 10, max: 10 },
      });

      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.bounds.width).toBe(15);
      expect(shape.bounds.height).toBe(10);
    });

    it('clamps target dimensions to range', () => {
      const variant = makeVariant({
        width: { min: 10, max: 20 },
        height: { min: 10, max: 20 },
      });

      // Target 1000px = 31 tiles at 32px/tile, clamped to max 20
      const shape = processLayers(variant, 1000, 1000, 42);

      expect(shape.bounds.width).toBeLessThanOrEqual(20);
      expect(shape.bounds.height).toBeLessThanOrEqual(20);
    });
  });

  describe('multi-tile fill variation', () => {
    it('uses multiple fill tiles for variation in a rectangle layer', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [10, 20, 30],
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      const tiles = shape.layers[0].tiles;

      // Collect all non-empty tile indices
      const usedTiles = new Set<number>();
      for (const row of tiles) {
        for (const tile of row) {
          if (tile >= 0) usedTiles.add(tile);
        }
      }

      // Should use more than one tile from the fill array
      expect(usedTiles.size).toBeGreaterThan(1);
      // All used tiles should be from the fill array
      for (const tile of usedTiles) {
        expect([10, 20, 30]).toContain(tile);
      }
    });

    it('uses multiple fill tiles for variation in a fill layer', () => {
      const variant = makeVariant({
        width: { min: 8, max: 8 },
        height: { min: 8, max: 8 },
        terrainLayers: [
          {
            id: 'floor',
            type: 'fill',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: null,
            terrain: 'land',
            fill: [5, 15, 25],
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      const tiles = shape.layers[0].tiles;

      const usedTiles = new Set<number>();
      for (const row of tiles) {
        for (const tile of row) {
          usedTiles.add(tile);
        }
      }

      expect(usedTiles.size).toBeGreaterThan(1);
      for (const tile of usedTiles) {
        expect([5, 15, 25]).toContain(tile);
      }
    });

    it('single fill tile produces uniform output', () => {
      const variant = makeVariant({
        width: { min: 8, max: 8 },
        height: { min: 8, max: 8 },
        terrainLayers: [
          {
            id: 'floor',
            type: 'fill',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: null,
            terrain: 'land',
            fill: [42],
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 99);
      const tiles = shape.layers[0].tiles;

      for (const row of tiles) {
        for (const tile of row) {
          expect(tile).toBe(42);
        }
      }
    });

    it('multi-tile fill is deterministic with same seed', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [10, 20, 30],
          },
        ],
      });

      const shape1 = processLayers(variant, 0, 0, 42);
      const shape2 = processLayers(variant, 0, 0, 42);

      expect(shape1.layers[0].tiles).toEqual(shape2.layers[0].tiles);
    });
  });

  describe('animated_overlay layer', () => {
    it('generates fill tiles like a fill layer', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'ocean',
            type: 'fill',
            tilesetId: 'blob47-ocean',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'water',
            fill: [46, 47, 48, 49],
            procedural: false,
          },
          {
            id: 'waves',
            type: 'animated_overlay',
            tilesetId: 'blob47-ocean',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: null,
            terrain: 'void',
            fill: [46, 47, 48, 49],
            frames: [46, 47, 48, 49],
            tickMs: 400,
            density: 8,
            procedural: false,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // Should produce 2 layers
      expect(shape.layers).toHaveLength(2);

      // Overlay layer should have fill tiles from the pool
      const overlayLayer = shape.layers.find((l) => l.id === 'waves')!;
      expect(overlayLayer).toBeDefined();
      expect(overlayLayer.tiles).toHaveLength(10);
      expect(overlayLayer.tiles[0]).toHaveLength(10);

      const usedTiles = new Set<number>();
      for (const row of overlayLayer.tiles) {
        for (const tile of row) {
          usedTiles.add(tile);
        }
      }
      for (const tile of usedTiles) {
        expect([46, 47, 48, 49]).toContain(tile);
      }
    });

    it('does not affect the blocked mask or terrain grid', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'ocean',
            type: 'fill',
            tilesetId: 'blob47-ocean',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'water',
            fill: [46],
            procedural: false,
          },
          {
            id: 'waves',
            type: 'animated_overlay',
            tilesetId: 'blob47-ocean',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: null,
            terrain: 'void',
            fill: [46, 47, 48, 49],
            frames: [46, 47, 48, 49],
            tickMs: 400,
            density: 8,
            procedural: false,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // terrain grid should show 'ocean' (from the fill layer), not 'waves'
      // because animated_overlay has terrain: 'void' and blocking: null
      expect(shape.terrainGrid).not.toBeNull();
      for (const row of shape.terrainGrid!) {
        for (const cell of row) {
          expect(cell).toBe('ocean');
        }
      }
    });
  });

  describe('clearing layer', () => {
    it('generates an organic clearing mask with both true and false tiles', () => {
      const variant = makeVariant({
        width: { min: 60, max: 60 },
        height: { min: 50, max: 50 },
        terrainLayers: [
          {
            id: 'trees',
            type: 'fill',
            tilesetId: 'blob47-grass_dark',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'dense_forest' as TerrainLayerConfig['terrain'],
            fill: [46],
            procedural: false,
          },
          {
            id: 'clearing',
            type: 'noise_patch',
            tilesetId: 'blob47-grass',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [],
            procedural: false,
            autotilePreset: 'canonical',
            autotileAgainst: [],
            withinTerrain: null,
            shapePreset: 'clearing',
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.layers).toHaveLength(2);
      expect(shape.layers[1].id).toBe('clearing');

      // Clearing should produce both true (clearing) and false (forest) tiles
      const mask = shape.layerMasks['clearing'];
      let hasClearing = false;
      let hasForest = false;
      for (const row of mask) {
        for (const cell of row) {
          if (cell) hasClearing = true;
          else hasForest = true;
        }
      }
      expect(hasClearing).toBe(true);
      expect(hasForest).toBe(true);
    });

    it('clearing unblocks tiles that fill layer blocked', () => {
      const variant = makeVariant({
        width: { min: 60, max: 60 },
        height: { min: 50, max: 50 },
        terrainLayers: [
          {
            id: 'trees',
            type: 'fill',
            tilesetId: 'blob47-grass_dark',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'dense_forest' as TerrainLayerConfig['terrain'],
            fill: [46],
            procedural: false,
          },
          {
            id: 'clearing',
            type: 'noise_patch',
            tilesetId: 'blob47-grass',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [],
            procedural: false,
            autotilePreset: 'canonical',
            autotileAgainst: [],
            withinTerrain: null,
            shapePreset: 'clearing',
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // Where clearing mask is true, blockedMask should be false (unblocked)
      const clearingMask = shape.layerMasks['clearing'];
      let hasUnblockedClearing = false;
      let hasBlockedForest = false;
      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (clearingMask[y][x]) {
            if (!shape.blockedMask[y][x]) hasUnblockedClearing = true;
          } else {
            if (shape.blockedMask[y][x]) hasBlockedForest = true;
          }
        }
      }
      expect(hasUnblockedClearing).toBe(true);
      expect(hasBlockedForest).toBe(true);
    });

    it('terrainGrid reflects both dense_forest and land terrain', () => {
      const variant = makeVariant({
        width: { min: 60, max: 60 },
        height: { min: 50, max: 50 },
        terrainLayers: [
          {
            id: 'trees',
            type: 'fill',
            tilesetId: 'blob47-grass_dark',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'dense_forest' as TerrainLayerConfig['terrain'],
            fill: [46],
            procedural: false,
          },
          {
            id: 'clearing',
            type: 'noise_patch',
            tilesetId: 'blob47-grass',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [],
            procedural: false,
            autotilePreset: 'canonical',
            autotileAgainst: [],
            withinTerrain: null,
            shapePreset: 'clearing',
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // terrainGrid should contain both layer IDs
      const terrainValues = new Set<string>();
      for (const row of shape.terrainGrid!) {
        for (const cell of row) {
          terrainValues.add(cell);
        }
      }
      expect(terrainValues).toContain('trees');
      expect(terrainValues).toContain('clearing');
    });

    it('clearing mask reaches at least one map edge', () => {
      const variant = makeVariant({
        width: { min: 80, max: 80 },
        height: { min: 60, max: 60 },
        terrainLayers: [
          {
            id: 'clearing',
            type: 'noise_patch',
            tilesetId: 'blob47-grass',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [],
            procedural: false,
            autotilePreset: 'canonical',
            autotileAgainst: [],
            withinTerrain: null,
            shapePreset: 'clearing',
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['clearing'];
      const w = shape.bounds.width;
      const h = shape.bounds.height;

      // Check if any edge row/column contains a true tile
      let reachesEdge = false;

      // North edge (y=0)
      for (let x = 0; x < w; x++) {
        if (mask[0][x]) { reachesEdge = true; break; }
      }
      // South edge (y=h-1)
      if (!reachesEdge) {
        for (let x = 0; x < w; x++) {
          if (mask[h - 1][x]) { reachesEdge = true; break; }
        }
      }
      // West edge (x=0)
      if (!reachesEdge) {
        for (let y = 0; y < h; y++) {
          if (mask[y][0]) { reachesEdge = true; break; }
        }
      }
      // East edge (x=w-1)
      if (!reachesEdge) {
        for (let y = 0; y < h; y++) {
          if (mask[y][w - 1]) { reachesEdge = true; break; }
        }
      }

      expect(reachesEdge).toBe(true);
    });

    it('is deterministic with same seed', () => {
      const variant = makeVariant({
        width: { min: 60, max: 60 },
        height: { min: 50, max: 50 },
        terrainLayers: [
          {
            id: 'clearing',
            type: 'noise_patch',
            tilesetId: 'blob47-grass',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [],
            procedural: false,
            autotilePreset: 'canonical',
            autotileAgainst: [],
            withinTerrain: null,
            shapePreset: 'clearing',
          } as TerrainLayerConfig,
        ],
      });

      const shape1 = processLayers(variant, 0, 0, 42);
      const shape2 = processLayers(variant, 0, 0, 42);

      expect(shape1.layerMasks['clearing']).toEqual(shape2.layerMasks['clearing']);
    });

    it('produces different output with different seeds', () => {
      const variant = makeVariant({
        width: { min: 60, max: 60 },
        height: { min: 50, max: 50 },
        terrainLayers: [
          {
            id: 'clearing',
            type: 'noise_patch',
            tilesetId: 'blob47-grass',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [],
            procedural: false,
            autotilePreset: 'canonical',
            autotileAgainst: [],
            withinTerrain: null,
            shapePreset: 'clearing',
          } as TerrainLayerConfig,
        ],
      });

      const shape1 = processLayers(variant, 0, 0, 100);
      const shape2 = processLayers(variant, 0, 0, 200);

      const flat1 = shape1.layerMasks['clearing'].flat().map(String).join('');
      const flat2 = shape2.layerMasks['clearing'].flat().map(String).join('');
      expect(flat1).not.toBe(flat2);
    });
  });

  describe('sprite_backdrop layer', () => {
    it('produces empty mask and all-empty tiles', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 8, max: 8 },
        terrainLayers: [
          {
            id: 'hull',
            type: 'sprite_backdrop',
            tilesetId: 'ship_hull_sloop',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: null,
            terrain: 'void',
            fill: [0],
            procedural: false,
            anchorX: 0.5,
            anchorY: 0.5,
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // Should have one layer
      expect(shape.layers).toHaveLength(1);
      expect(shape.layers[0].id).toBe('hull');
      expect(shape.layers[0].tilesetId).toBe('ship_hull_sloop');
      expect(shape.layers[0].depth).toBe(1);

      // All tiles should be -1 (empty)
      for (const row of shape.layers[0].tiles) {
        for (const tile of row) {
          expect(tile).toBe(-1);
        }
      }

      // Mask should be all false (no blocking impact)
      for (const row of shape.layerMasks['hull']) {
        for (const cell of row) {
          expect(cell).toBe(false);
        }
      }
    });

    it('does not affect blockedMask', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 8, max: 8 },
        terrainLayers: [
          {
            id: 'hull',
            type: 'sprite_backdrop',
            tilesetId: 'ship_hull_sloop',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: null,
            terrain: 'void',
            fill: [0],
            procedural: false,
            anchorX: 0.5,
            anchorY: 0.5,
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // blockedMask should be all false — sprite_backdrop doesn't block anything
      for (const row of shape.blockedMask) {
        for (const cell of row) {
          expect(cell).toBe(false);
        }
      }
    });

    it('marks unblockedTiles in mask when provided', () => {
      // anchor (0.5, 0.5) + grid matching layout = offset (0, 0)
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 8, max: 8 },
        terrainLayers: [
          {
            id: 'ocean',
            type: 'fill',
            tilesetId: 'ocean',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'water',
            fill: [0],
            procedural: false,
          },
          {
            id: 'ship',
            type: 'sprite_backdrop',
            tilesetId: 'ship_hull',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
            procedural: false,
            anchorX: 0.5,
            anchorY: 0.5,
            gridWidth: 10,
            gridHeight: 8,
            unblockedTiles: [
              [3, 2],
              [4, 2],
              [3, 3],
              [4, 3],
            ],
            slots: null,
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // Ocean blocks everything, then sprite_backdrop unblocks the 4 deck tiles
      expect(shape.blockedMask[2][3]).toBe(false); // unblocked
      expect(shape.blockedMask[2][4]).toBe(false); // unblocked
      expect(shape.blockedMask[3][3]).toBe(false); // unblocked
      expect(shape.blockedMask[3][4]).toBe(false); // unblocked
      // Adjacent tiles should still be blocked by ocean
      expect(shape.blockedMask[0][0]).toBe(true);
      expect(shape.blockedMask[7][9]).toBe(true);
      expect(shape.blockedMask[2][2]).toBe(true); // just outside unblocked area
    });

    it('paints terrain grid for unblocked tiles', () => {
      const variant = makeVariant({
        width: { min: 5, max: 5 },
        height: { min: 5, max: 5 },
        terrainLayers: [
          {
            id: 'ocean',
            type: 'fill',
            tilesetId: 'ocean',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'water',
            fill: [0],
            procedural: false,
          },
          {
            id: 'deck',
            type: 'sprite_backdrop',
            tilesetId: 'ship_hull',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
            procedural: false,
            anchorX: 0.5,
            anchorY: 0.5,
            gridWidth: 5,
            gridHeight: 5,
            unblockedTiles: [
              [2, 2],
              [3, 2],
            ],
            slots: null,
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.terrainGrid![2][2]).toBe('deck');
      expect(shape.terrainGrid![2][3]).toBe('deck');
      expect(shape.terrainGrid![0][0]).toBe('ocean');
      expect(shape.terrainGrid![4][4]).toBe('ocean');
    });

    it('ignores out-of-bounds unblockedTiles', () => {
      const variant = makeVariant({
        width: { min: 5, max: 5 },
        height: { min: 5, max: 5 },
        terrainLayers: [
          {
            id: 'ship',
            type: 'sprite_backdrop',
            tilesetId: 'ship_hull',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
            procedural: false,
            anchorX: 0.5,
            anchorY: 0.5,
            gridWidth: 5,
            gridHeight: 5,
            unblockedTiles: [
              [2, 2],
              [99, 99],
              [-1, 0],
            ],
            slots: null,
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      expect(shape.layerMasks['ship'][2][2]).toBe(true);
    });

    it('produces empty mask when unblockedTiles is null', () => {
      const variant = makeVariant({
        width: { min: 5, max: 5 },
        height: { min: 5, max: 5 },
        terrainLayers: [
          {
            id: 'ship',
            type: 'sprite_backdrop',
            tilesetId: 'ship_hull',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: null,
            terrain: 'void',
            fill: [0],
            procedural: false,
            anchorX: 0.5,
            anchorY: 0.5,
            unblockedTiles: null,
            slots: null,
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      // All mask cells should be false (same as before)
      for (const row of shape.layerMasks['ship']) {
        for (const cell of row) {
          expect(cell).toBe(false);
        }
      }
    });

    it('paints terrain grid with layer id', () => {
      const variant = makeVariant({
        width: { min: 5, max: 5 },
        height: { min: 5, max: 5 },
        terrainLayers: [
          {
            id: 'ocean_fill',
            type: 'fill',
            tilesetId: 'blob47-ocean',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'blocks',
            terrain: 'water',
            fill: [0],
            procedural: false,
          },
          {
            id: 'hull_backdrop',
            type: 'sprite_backdrop',
            tilesetId: 'ship_hull_sloop',
            tilesetOffset: null,
            renderOrder: 1,
            blocking: null,
            terrain: 'void',
            fill: [0],
            procedural: false,
            anchorX: 0.5,
            anchorY: 0.5,
          } as TerrainLayerConfig,
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);

      // sprite_backdrop has an empty mask, so it doesn't overwrite the terrain grid
      // (updateTerrainGrid only paints where mask is true)
      // The ocean_fill layer should still own all cells
      expect(shape.terrainGrid).not.toBeNull();
      for (const row of shape.terrainGrid!) {
        for (const cell of row) {
          expect(cell).toBe('ocean_fill');
        }
      }
    });
  });

  describe('noise_fill layer', () => {
    function makeNoiseFillVariant(
      fillDirection: 'north' | 'south' | 'east' | 'west',
      fillPercent: number,
      noiseAmplitude = 0.15
    ) {
      return makeVariant({
        width: { min: 40, max: 40 },
        height: { min: 40, max: 40 },
        terrainLayers: [
          {
            id: 'ocean',
            type: 'noise_fill',
            tilesetId: 'blob47-ocean',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: null,
            terrain: 'water',
            fill: [],
            procedural: false,
            fillDirection,
            fillPercent,
            noiseScale: 0.05,
            noiseAmplitude,
            autotilePreset: 'canonical',
            autotileAgainst: [],
          } as TerrainLayerConfig,
        ],
      });
    }

    it('fills from south: bottom portion of mask is true', () => {
      const variant = makeNoiseFillVariant('south', 0.3, 0);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];
      const h = shape.bounds.height;

      // With zero noise amplitude, the boundary is a clean line.
      // Bottom 30% should be filled, top 70% should be empty.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (y >= h * 0.7) {
            expect(mask[y][x]).toBe(true);
          } else if (y < h * 0.6) {
            // Leave a margin to avoid boundary-row flakiness
            expect(mask[y][x]).toBe(false);
          }
        }
      }
    });

    it('fills from north: top portion of mask is true', () => {
      const variant = makeNoiseFillVariant('north', 0.3, 0);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];
      const h = shape.bounds.height;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (y < h * 0.3) {
            expect(mask[y][x]).toBe(true);
          } else if (y >= h * 0.4) {
            expect(mask[y][x]).toBe(false);
          }
        }
      }
    });

    it('fills from west: left portion of mask is true', () => {
      const variant = makeNoiseFillVariant('west', 0.3, 0);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];
      const w = shape.bounds.width;

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < w; x++) {
          if (x < w * 0.3) {
            expect(mask[y][x]).toBe(true);
          } else if (x >= w * 0.4) {
            expect(mask[y][x]).toBe(false);
          }
        }
      }
    });

    it('fills from east: right portion of mask is true', () => {
      const variant = makeNoiseFillVariant('east', 0.3, 0);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];
      const w = shape.bounds.width;

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < w; x++) {
          if (x >= w * 0.7) {
            expect(mask[y][x]).toBe(true);
          } else if (x < w * 0.6) {
            expect(mask[y][x]).toBe(false);
          }
        }
      }
    });

    it('fillPercent 0 produces an empty mask', () => {
      const variant = makeNoiseFillVariant('south', 0, 0);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];

      const anyFilled = mask.some((row) => row.some((v) => v));
      expect(anyFilled).toBe(false);
    });

    it('fillPercent 1 fills the entire mask', () => {
      const variant = makeNoiseFillVariant('south', 1, 0);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];

      const allFilled = mask.every((row) => row.every((v) => v));
      expect(allFilled).toBe(true);
    });

    it('noise amplitude > 0 produces a non-straight boundary', () => {
      const variant = makeNoiseFillVariant('south', 0.5, 0.2);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];
      const h = shape.bounds.height;

      // Find the boundary row for each column (first true from bottom)
      const boundaryRows: number[] = [];
      for (let x = 0; x < shape.bounds.width; x++) {
        for (let y = 0; y < h; y++) {
          if (mask[y][x]) {
            boundaryRows.push(y);
            break;
          }
        }
      }

      // With noise, not all columns should have the same boundary row
      const uniqueRows = new Set(boundaryRows);
      expect(uniqueRows.size).toBeGreaterThan(1);
    });

    it('updates terrainGrid with the layer ID', () => {
      const variant = makeNoiseFillVariant('south', 0.5, 0);
      const shape = processLayers(variant, 0, 0, 42);
      const mask = shape.layerMasks['ocean'];

      expect(shape.terrainGrid).not.toBeNull();
      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (mask[y][x]) {
            expect(shape.terrainGrid![y][x]).toBe('ocean');
          }
        }
      }
    });
  });

  describe('seed determinism', () => {
    it('produces identical output with same seed', () => {
      const variant = makeVariant({
        width: { min: 10, max: 20 },
        height: { min: 10, max: 20 },
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
          },
        ],
      });

      const shape1 = processLayers(variant, 0, 0, 42);
      const shape2 = processLayers(variant, 0, 0, 42);

      expect(shape1.bounds).toEqual(shape2.bounds);
      expect(shape1.blockedMask).toEqual(shape2.blockedMask);
    });

    it('produces different output with different seeds', () => {
      const variant = makeVariant({
        width: { min: 10, max: 20 },
        height: { min: 10, max: 20 },
        terrainLayers: [
          {
            id: 'room',
            type: 'l_shape',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
            minArmWidth: 2,
          },
        ],
      });

      const shape1 = processLayers(variant, 0, 0, 100);
      const shape2 = processLayers(variant, 0, 0, 200);

      // L-shape with different seeds should produce different masks
      const flat1 = shape1.layerMasks['room'].flat().map(String).join('');
      const flat2 = shape2.layerMasks['room'].flat().map(String).join('');
      expect(flat1).not.toBe(flat2);
    });
  });

  describe('automatic north-facing wall overhead', () => {
    const makeRoomWallVariant = () =>
      makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        defaultBlocked: true,
        terrainLayers: [
          {
            id: 'room',
            type: 'rectangle',
            tilesetId: 'lpc-interior-floors',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: 'unblocks',
            terrain: 'land',
            fill: [0],
          },
          {
            id: 'walls',
            type: 'wall',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            renderOrder: 100,
            blocking: 'blocks',
            terrain: 'wall',
            fill: [],
            wallStyle: 'brick_brown',
            inheritable: false,
          },
        ],
      });

    it('automatically generates a north-overhead layer from the wall layer', () => {
      const shape = processLayers(makeRoomWallVariant(), 0, 0, 42);
      const northLayer = shape.layers.find((l) => l.id === 'walls__north_overhead');
      expect(northLayer).toBeDefined();
    });

    it('selects only wall tiles whose north neighbor is floor (room AND not wall)', () => {
      const shape = processLayers(makeRoomWallVariant(), 0, 0, 42);
      const wallMask = shape.layerMasks['walls'];
      const roomMask = shape.layerMasks['room'];
      const northMask = shape.layerMasks['walls__north_overhead'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          const northIsFloor =
            y > 0 && roomMask[y - 1]?.[x] === true && !wallMask[y - 1]?.[x];
          const expected = wallMask[y][x] === true && northIsFloor;
          expect(northMask[y][x]).toBe(expected);
        }
      }

      const anySelected = northMask.some((row) => row.some((v) => v));
      expect(anySelected).toBe(true);
    });

    it('does NOT select corners or east/west walls', () => {
      const shape = processLayers(makeRoomWallVariant(), 0, 0, 42);
      const wallMask = shape.layerMasks['walls'];
      const northMask = shape.layerMasks['walls__north_overhead'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (!northMask[y][x]) continue;
          // Every selected tile must have a non-wall neighbor to the north
          expect(wallMask[y - 1]?.[x]).not.toBe(true);
        }
      }
    });

    it('unblocks north-facing wall tiles in blockedMask', () => {
      const shape = processLayers(makeRoomWallVariant(), 0, 0, 42);
      const northMask = shape.layerMasks['walls__north_overhead'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (northMask[y][x]) {
            expect(shape.blockedMask[y][x]).toBe(false);
          }
        }
      }
    });

    it('paints terrainGrid with synthetic layer ID at north-facing positions', () => {
      const shape = processLayers(makeRoomWallVariant(), 0, 0, 42);
      const northMask = shape.layerMasks['walls__north_overhead'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (northMask[y][x]) {
            expect(shape.terrainGrid![y][x]).toBe('walls__north_overhead');
          }
        }
      }
    });

    it('tile indices match the wall layer for selected tiles, -1 elsewhere', () => {
      const shape = processLayers(makeRoomWallVariant(), 0, 0, 42);
      const wallLayer = shape.layers.find((l) => l.id === 'walls')!;
      const northLayer = shape.layers.find((l) => l.id === 'walls__north_overhead')!;
      const northMask = shape.layerMasks['walls__north_overhead'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (northMask[y][x]) {
            expect(northLayer.tiles[y][x]).toBe(wallLayer.tiles[y][x]);
          } else {
            expect(northLayer.tiles[y][x]).toBe(-1);
          }
        }
      }
    });

    it('renders at higher depth than the wall layer', () => {
      const shape = processLayers(makeRoomWallVariant(), 0, 0, 42);
      const wallLayer = shape.layers.find((l) => l.id === 'walls')!;
      const northLayer = shape.layers.find((l) => l.id === 'walls__north_overhead')!;

      expect(northLayer.depth).toBeGreaterThan(wallLayer.depth);
    });

    it('produces no overhead layer when there is no room-shape layer', () => {
      const variant = makeVariant({
        width: { min: 10, max: 10 },
        height: { min: 10, max: 10 },
        terrainLayers: [
          {
            id: 'base',
            type: 'fill',
            tilesetId: 'void',
            tilesetOffset: null,
            renderOrder: 0,
            blocking: null,
            terrain: 'void',
            fill: [0],
          },
          {
            id: 'walls',
            type: 'wall',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            renderOrder: 100,
            blocking: 'blocks',
            terrain: 'wall',
            fill: [],
            wallStyle: 'brick_brown',
            inheritable: false,
          },
        ],
      });

      const shape = processLayers(variant, 0, 0, 42);
      const northLayer = shape.layers.find((l) => l.id === 'walls__north_overhead');
      expect(northLayer).toBeUndefined();
    });
  });
});

// ============================================================================
// createDefaultLayerConfig Factory
// ============================================================================

describe('createDefaultLayerConfig', () => {
  const base = {
    id: 'test_layer',
    tilesetId: 'test-tileset',
  };

  it('creates sprite_backdrop with correct defaults', () => {
    const config = createDefaultLayerConfig('sprite_backdrop', base);

    expect(config.type).toBe('sprite_backdrop');
    expect(config.id).toBe('test_layer');
    expect(config.tilesetId).toBe('test-tileset');
    // renderOrder is derived from LAYER_TYPE_META — sprite_backdrop defaults to 0
    expect(config.renderOrder).toBe(0);
    expect(config.blocking).toBeNull();
    expect(config.terrain).toBe('void');
    expect(config.procedural).toBe(false);
    expect((config as { anchorX: number }).anchorX).toBe(0.5);
    expect((config as { anchorY: number }).anchorY).toBe(0.5);
  });

  it('handles all layer types without throwing', () => {
    for (const layerType of LAYER_TYPES) {
      const config = createDefaultLayerConfig(layerType, base);
      expect(config.type).toBe(layerType);
    }
  });

  it('sets minArmWidth: 6 by default for l_shape', () => {
    const config = createDefaultLayerConfig('l_shape', base);
    expect((config as { minArmWidth: number }).minArmWidth).toBe(6);
  });

  it('sets minArmWidth: 6 by default for t_shape', () => {
    const config = createDefaultLayerConfig('t_shape', base);
    expect((config as { minArmWidth: number }).minArmWidth).toBe(6);
  });
});
