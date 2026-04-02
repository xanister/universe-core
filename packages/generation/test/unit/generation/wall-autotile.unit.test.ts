/**
 * Wall autotile unit tests.
 *
 * Tests the wall system:
 * - Wall layer: edge outline (Wang 2-corner) around floor tiles
 * - Wall face layer: 3-tile face strips below wall edges that have floor beneath them
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processLayers } from '../../../src/place-layout/algorithms/shape-algorithms.js';
import type { LayoutVariant, TerrainLayerConfig } from '@dmnpc/types/world';

const TEST_OVERHEAD = new Map<string, number>([
  ['1,0,0,0', 100],
  ['0,1,0,0', 101],
  ['0,0,1,0', 102],
  ['0,0,0,1', 103],
  ['1,1,0,0', 104],
  ['1,0,1,0', 105],
  ['0,1,0,1', 106],
  ['0,0,1,1', 107],
  ['1,1,1,0', 108],
  ['1,1,0,1', 109],
  ['1,0,1,1', 110],
  ['0,1,1,1', 111],
  ['1,1,1,1', 112],
]);

const TEST_FACE = new Map<string, number>([
  ['0,0,0,1', 200],
  ['0,0,1,1', 201],
  ['0,0,1,0', 202],
  ['0,1,0,1', 203],
  ['1,1,1,1', 204],
  ['1,0,1,0', 205],
  ['0,1,0,0', 206],
  ['1,1,0,0', 207],
  ['1,0,0,0', 208],
]);

vi.mock('../../../src/place-layout/wall-styles.js', () => ({
  loadFullWallStyle: vi.fn((styleId: string) => {
    if (styleId === 'test_style') {
      return {
        id: 'test_style',
        name: 'Test Style',
        overheadTiles: TEST_OVERHEAD,
        faceTiles: TEST_FACE,
      };
    }
    throw new Error(`Unknown wall style "${styleId}"`);
  }),
}));

function createVariant(
  terrainLayers: TerrainLayerConfig[],
  width = 10,
  height = 10
): LayoutVariant {
  return {
    id: 'test',
    terrainLayers,
    width: { min: width, max: width },
    height: { min: height, max: height },
    slots: [],
    description: 'test',
    weight: 1,
    defaultBlocked: false,
  };
}

const FLOOR_LAYER: TerrainLayerConfig = {
  id: 'floor',
  tilesetId: 'test-tileset',
  tilesetOffset: null,
  type: 'rectangle',
  blocking: 'unblocks',
  terrain: 'land',
  renderOrder: 0,
  fill: [0],
  procedural: false,
  inheritable: false,
};

const WALL_LAYER: TerrainLayerConfig = {
  id: 'walls',
  tilesetId: 'lpc-interior-walls',
  tilesetOffset: null,
  type: 'wall',
  blocking: 'blocks',
  terrain: 'wall',
  renderOrder: 1,
  fill: [],
  procedural: false,
  wallStyle: 'test_style',
  inheritable: false,
};

const WALL_FACE_LAYER: TerrainLayerConfig = {
  id: 'wall_faces',
  tilesetId: 'lpc-interior-walls',
  tilesetOffset: null,
  type: 'wall_face',
  blocking: 'blocks',
  terrain: 'wall',
  renderOrder: 2,
  fill: [],
  procedural: false,
  inheritable: false,
  wallLayerId: 'walls',
  roomLayerId: 'floor',
  wallStyle: 'test_style',
};

const L_FLOOR_LAYER: TerrainLayerConfig = {
  id: 'floor',
  tilesetId: 'test-tileset',
  tilesetOffset: null,
  type: 'l_shape',
  blocking: 'unblocks',
  terrain: 'land',
  renderOrder: 0,
  fill: [0],
  procedural: false,
  inheritable: false,
  minArmWidth: 2,
};

describe('Wall Autotile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('wall edge layer', () => {
    it('produces wall tiles at boundary positions', () => {
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER], 10, 10);
      const shape = processLayers(variant, 0, 0, 42);

      const wallLayer = shape.layers.find((l) => l.id === 'walls')!;
      const overheadTileIds = new Set([...TEST_OVERHEAD.values()]);

      let foundWallTile = false;
      for (const row of wallLayer.tiles) {
        for (const tile of row) {
          if (tile !== -1) {
            expect(overheadTileIds.has(tile)).toBe(true);
            foundWallTile = true;
          }
        }
      }
      expect(foundWallTile).toBe(true);
    });

    it('wall mask matches tile placement', () => {
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER], 10, 10);
      const shape = processLayers(variant, 0, 0, 42);

      const wallLayer = shape.layers.find((l) => l.id === 'walls')!;
      const wallMask = shape.layerMasks['walls'];

      for (let y = 0; y < wallLayer.tiles.length; y++) {
        for (let x = 0; x < wallLayer.tiles[0].length; x++) {
          expect(wallMask[y][x]).toBe(wallLayer.tiles[y][x] !== -1);
        }
      }
    });
  });

  describe('wall face layer', () => {
    it('places face tiles below wall edges that have floor beneath', () => {
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, WALL_FACE_LAYER], 10, 12);
      const shape = processLayers(variant, 0, 0, 42);

      const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;
      let faceTilesFound = 0;
      for (const row of faceLayer.tiles) {
        for (const tile of row) {
          if (tile !== -1) faceTilesFound++;
        }
      }
      expect(faceTilesFound).toBeGreaterThan(0);
    });

    it('face tiles come from faceTiles autotile map', () => {
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, WALL_FACE_LAYER], 10, 12);
      const shape = processLayers(variant, 0, 0, 42);

      const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;
      const validTileIds = new Set([...TEST_FACE.values()]);

      for (const row of faceLayer.tiles) {
        for (const tile of row) {
          if (tile === -1) continue;
          expect(validTileIds.has(tile)).toBe(true);
        }
      }
    });

    it('face tiles use correct corner keys for rectangular strip', () => {
      // Use a wide grid so interior face tiles exist
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, WALL_FACE_LAYER], 12, 12);
      const shape = processLayers(variant, 0, 0, 42);

      const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;
      const midX = 6;

      // Find the face strip at midX — should be 3 tiles tall
      const stripTiles: number[] = [];
      for (let y = 0; y < faceLayer.tiles.length; y++) {
        if (faceLayer.tiles[y][midX] !== -1) stripTiles.push(faceLayer.tiles[y][midX]);
      }
      expect(stripTiles).toHaveLength(3);

      // Top of strip: TL=0,TR=0 (wall above) → key "0,0,1,1" → tile 201
      expect(stripTiles[0]).toBe(201);
      // Middle of strip: all corners surrounded → key "1,1,1,1" → tile 204
      expect(stripTiles[1]).toBe(204);
      // Bottom of strip: BL=0,BR=0 (nothing below in face mask) → key "1,1,0,0" → tile 207
      expect(stripTiles[2]).toBe(207);
    });

    it('face tiles at left/right edges use edge corner keys', () => {
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, WALL_FACE_LAYER], 12, 12);
      const shape = processLayers(variant, 0, 0, 42);

      const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;

      // Find leftmost column with face tiles
      let leftX = -1;
      for (let x = 0; x < faceLayer.tiles[0].length; x++) {
        for (let y = 0; y < faceLayer.tiles.length; y++) {
          if (faceLayer.tiles[y][x] !== -1) {
            leftX = x;
            break;
          }
        }
        if (leftX !== -1) break;
      }
      expect(leftX).toBeGreaterThanOrEqual(0);

      // Top-left corner of face strip: TL=0,TR=0,BL=0,BR=1 → key "0,0,0,1" → tile 200
      expect(faceLayer.tiles.find((row) => row[leftX] !== -1)![leftX]).toBe(200);

      // Find rightmost column with face tiles
      let rightX = -1;
      for (let x = faceLayer.tiles[0].length - 1; x >= 0; x--) {
        for (let y = 0; y < faceLayer.tiles.length; y++) {
          if (faceLayer.tiles[y][x] !== -1) {
            rightX = x;
            break;
          }
        }
        if (rightX !== -1) break;
      }

      // Top-right corner of face strip: TL=0,TR=0,BL=1,BR=0 → key "0,0,1,0" → tile 202
      expect(faceLayer.tiles.find((row) => row[rightX] !== -1)![rightX]).toBe(202);
    });

    it('face strip is 3 tiles tall', () => {
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, WALL_FACE_LAYER], 10, 15);
      const shape = processLayers(variant, 0, 0, 42);

      const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;
      const midX = 5;
      let strip = 0;
      for (let y = 0; y < faceLayer.tiles.length; y++) {
        if (faceLayer.tiles[y][midX] !== -1) strip++;
        else if (strip > 0) break;
      }
      expect(strip).toBe(3);
    });

    it('blocks face area', () => {
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, WALL_FACE_LAYER], 10, 12);
      const shape = processLayers(variant, 0, 0, 42);

      let faceBlocked = false;
      for (let x = 1; x < 9; x++) {
        if (shape.blockedMask[1][x]) faceBlocked = true;
      }
      expect(faceBlocked).toBe(true);
    });

    it('throws for missing wall layer reference', () => {
      const badFace: TerrainLayerConfig = {
        ...WALL_FACE_LAYER,
        wallLayerId: 'nonexistent',
      };
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, badFace]);
      expect(() => processLayers(variant, 0, 0, 42)).toThrow('wallLayerId');
    });

    it('throws for missing room layer reference', () => {
      const badFace: TerrainLayerConfig = {
        ...WALL_FACE_LAYER,
        roomLayerId: 'nonexistent',
      };
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, badFace]);
      expect(() => processLayers(variant, 0, 0, 42)).toThrow('roomLayerId');
    });

    it('places faces at L-shape internal corners', () => {
      const variant = createVariant(
        [L_FLOOR_LAYER, WALL_LAYER, { ...WALL_FACE_LAYER, roomLayerId: 'floor' }],
        16,
        14
      );

      let found = false;
      for (let seed = 0; seed < 100; seed++) {
        const shape = processLayers(variant, 0, 0, seed);
        const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;

        // Check for face tiles beyond the main north wall strip (rows 1-3)
        for (let y = 4; y < faceLayer.tiles.length; y++) {
          for (let x = 0; x < faceLayer.tiles[0].length; x++) {
            if (faceLayer.tiles[y][x] !== -1) found = true;
          }
        }
        if (found) break;
      }
      expect(found).toBe(true);
    });
  });

  describe('wall style loading', () => {
    it('throws for unknown wall style on wall layer', () => {
      const badWall: TerrainLayerConfig = { ...WALL_LAYER, wallStyle: 'nonexistent_style' };
      const variant = createVariant([FLOOR_LAYER, badWall]);
      expect(() => processLayers(variant, 0, 0, 42)).toThrow('Unknown wall style');
    });

    it('throws for unknown wall style on wall_face layer', () => {
      const badFace: TerrainLayerConfig = { ...WALL_FACE_LAYER, wallStyle: 'nonexistent_style' };
      const variant = createVariant([FLOOR_LAYER, WALL_LAYER, badFace]);
      expect(() => processLayers(variant, 0, 0, 42)).toThrow('Unknown wall style');
    });
  });

  describe('dependency-aware processing order', () => {
    it('wall_face with lower renderOrder than wall processes without error', () => {
      const wallBehind: TerrainLayerConfig = {
        ...WALL_FACE_LAYER,
        renderOrder: 1,
      };
      const wallAbove: TerrainLayerConfig = {
        ...WALL_LAYER,
        renderOrder: 2,
      };
      const variant = createVariant([FLOOR_LAYER, wallAbove, wallBehind], 10, 12);
      expect(() => processLayers(variant, 0, 0, 42)).not.toThrow();
    });

    it('wall_face output depth matches its renderOrder, not processing order', () => {
      const wallBehind: TerrainLayerConfig = {
        ...WALL_FACE_LAYER,
        renderOrder: 1,
      };
      const wallAbove: TerrainLayerConfig = {
        ...WALL_LAYER,
        renderOrder: 2,
      };
      const variant = createVariant([FLOOR_LAYER, wallAbove, wallBehind], 10, 12);
      const shape = processLayers(variant, 0, 0, 42);

      const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;
      const wallLayer = shape.layers.find((l) => l.id === 'walls')!;
      expect(faceLayer.depth).toBe(1);
      expect(wallLayer.depth).toBe(2);
      expect(faceLayer.depth).toBeLessThan(wallLayer.depth);
    });

    it('wall_face still generates correct face tiles when renderOrder is lower than wall', () => {
      const wallBehind: TerrainLayerConfig = {
        ...WALL_FACE_LAYER,
        renderOrder: 1,
      };
      const wallAbove: TerrainLayerConfig = {
        ...WALL_LAYER,
        renderOrder: 2,
      };
      const variant = createVariant([FLOOR_LAYER, wallAbove, wallBehind], 10, 12);
      const shape = processLayers(variant, 0, 0, 42);

      const faceLayer = shape.layers.find((l) => l.id === 'wall_faces')!;
      let faceTilesFound = 0;
      for (const row of faceLayer.tiles) {
        for (const tile of row) {
          if (tile !== -1) faceTilesFound++;
        }
      }
      expect(faceTilesFound).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('handles wall layer with no layer below', () => {
      const wallOnly = createVariant([WALL_LAYER], 5, 5);
      const shape = processLayers(wallOnly, 0, 0, 42);

      // With no room beneath, all corner keys are 0,0,0,0 → no wall tiles placed
      const wallMask = shape.layerMasks['walls'];
      expect(wallMask[0][0]).toBe(false);
      expect(wallMask[2][2]).toBe(false);
    });
  });
});
