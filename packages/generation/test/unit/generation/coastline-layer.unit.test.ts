/**
 * Unit tests for the coastline terrain layer type.
 *
 * Tests boundary detection, beach width expansion, autotiling,
 * error handling, and integration with processLayers.
 */

import { describe, it, expect } from 'vitest';
import { processLayers } from '@dmnpc/generation/place-layout/algorithms/shape-algorithms.js';
import type { LayoutVariant, CoastlineLayerConfig, TerrainLayerConfig } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// ============================================================================
// Test Helpers
// ============================================================================

function makeVariant(overrides: Partial<LayoutVariant>): LayoutVariant {
  return {
    id: 'test',
    scale: 'feet',
    environment: ENVIRONMENT_PRESETS.interior(),
    width: { min: 40, max: 40 },
    height: { min: 40, max: 40 },
    terrainLayers: [],
    slots: [],
    description: 'test variant',
    weight: 1,
    defaultBlocked: false,
    ...overrides,
  };
}

/**
 * Standard test setup: grass fill + water noise_patch (island) + coastline.
 * The water noise_patch only covers PART of the map (island preset with falloff),
 * so the coastline finds real boundaries between water and non-water tiles.
 */
function makeWaterIslandLayers(
  coastlineOverrides: Partial<CoastlineLayerConfig> = {}
): TerrainLayerConfig[] {
  return [
    {
      id: 'base',
      type: 'fill',
      tilesetId: 'blob47-grass',
      renderOrder: 0,
      blocking: null,
      terrain: 'land',
      fill: [0],
      procedural: false,
      inheritable: false,
    },
    {
      id: 'water',
      type: 'noise_patch',
      tilesetId: 'blob47-ocean',
      renderOrder: 0,
      blocking: 'blocks',
      terrain: 'water',
      fill: [],
      procedural: false,
      inheritable: false,
      shapePreset: 'island',
      autotilePreset: 'canonical',
      autotileAgainst: [],
      withinTerrain: null,
    },
    {
      id: 'shore',
      type: 'coastline',
      tilesetId: 'blob47-beach',
      renderOrder: 1,
      blocking: 'unblocks',
      terrain: 'land',
      fill: [],
      procedural: false,
      inheritable: false,
      sourceLayerId: 'water',
      beachWidth: 1,
      autotilePreset: 'canonical',
      autotileAgainst: [],
      ...coastlineOverrides,
    } as CoastlineLayerConfig,
  ];
}

// ============================================================================
// Coastline Layer
// ============================================================================

describe('coastline layer', () => {
  describe('boundary detection', () => {
    it('generates shore tiles at the water-land boundary', () => {
      const variant = makeVariant({
        terrainLayers: makeWaterIslandLayers(),
      });

      const shape = processLayers(variant, 0, 0, 42);
      const waterMask = shape.layerMasks['water'];
      const shoreMask = shape.layerMasks['shore'];

      const shoreCount = shoreMask.flat().filter(Boolean).length;
      const waterCount = waterMask.flat().filter(Boolean).length;

      // Water noise_patch (island preset) should produce some tiles but not fill map
      expect(waterCount).toBeGreaterThan(0);
      expect(waterCount).toBeLessThan(40 * 40);

      // Shore should form a ring around the water body
      expect(shoreCount).toBeGreaterThan(0);
    });

    it('places shore tiles only outside the source layer', () => {
      const variant = makeVariant({
        terrainLayers: makeWaterIslandLayers(),
      });

      const shape = processLayers(variant, 0, 0, 42);
      const waterMask = shape.layerMasks['water'];
      const shoreMask = shape.layerMasks['shore'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (shoreMask[y][x]) {
            expect(waterMask[y][x]).toBe(false);
          }
        }
      }
    });

    it('every shore tile has at least one cardinal water neighbor', () => {
      const variant = makeVariant({
        terrainLayers: makeWaterIslandLayers(),
      });

      const shape = processLayers(variant, 0, 0, 42);
      const waterMask = shape.layerMasks['water'];
      const shoreMask = shape.layerMasks['shore'];
      const h = shape.bounds.height;
      const w = shape.bounds.width;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!shoreMask[y][x]) continue;
          const hasWaterNeighbor =
            (y > 0 && waterMask[y - 1][x]) ||
            (y < h - 1 && waterMask[y + 1][x]) ||
            (x > 0 && waterMask[y][x - 1]) ||
            (x < w - 1 && waterMask[y][x + 1]);
          expect(hasWaterNeighbor).toBe(true);
        }
      }
    });
  });

  describe('beach width', () => {
    it('width 3 produces more beach tiles than width 1', () => {
      const variant1 = makeVariant({
        terrainLayers: makeWaterIslandLayers({ beachWidth: 1 }),
      });
      const shape1 = processLayers(variant1, 0, 0, 42);
      const count1 = shape1.layerMasks['shore'].flat().filter(Boolean).length;

      // Width 3 — use a separate variant with different ID to avoid mask collision
      const layers3 = makeWaterIslandLayers({ beachWidth: 3 });
      const variant3 = makeVariant({ terrainLayers: layers3 });
      const shape3 = processLayers(variant3, 0, 0, 42);
      const count3 = shape3.layerMasks['shore'].flat().filter(Boolean).length;

      expect(count3).toBeGreaterThan(count1);
    });

    it('width 1 only includes immediate boundary tiles', () => {
      const variant = makeVariant({
        terrainLayers: makeWaterIslandLayers({ beachWidth: 1 }),
      });

      const shape = processLayers(variant, 0, 0, 42);
      const waterMask = shape.layerMasks['water'];
      const shoreMask = shape.layerMasks['shore'];
      const h = shape.bounds.height;
      const w = shape.bounds.width;

      // Every width-1 shore tile must directly touch water
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!shoreMask[y][x]) continue;
          const touchesWater =
            (y > 0 && waterMask[y - 1][x]) ||
            (y < h - 1 && waterMask[y + 1][x]) ||
            (x > 0 && waterMask[y][x - 1]) ||
            (x < w - 1 && waterMask[y][x + 1]);
          expect(touchesWater).toBe(true);
        }
      }
    });
  });

  describe('error handling', () => {
    it('throws when sourceLayerId references a non-existent layer', () => {
      const layers: TerrainLayerConfig[] = [
        {
          id: 'shore',
          type: 'coastline',
          tilesetId: 'blob47-beach',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [],
          procedural: false,
          inheritable: false,
          sourceLayerId: 'nonexistent',
          beachWidth: 1,
          autotilePreset: 'canonical',
          autotileAgainst: [],
        } as CoastlineLayerConfig,
      ];

      const variant = makeVariant({ terrainLayers: layers });

      expect(() => processLayers(variant, 0, 0, 42)).toThrow(
        /sourceLayerId "nonexistent" but no such layer mask exists/
      );
    });
  });

  describe('dependency ordering', () => {
    it('processes coastline after its source layer regardless of array order', () => {
      // Put coastline BEFORE its source in the array
      const layers: TerrainLayerConfig[] = [
        {
          id: 'shore',
          type: 'coastline',
          tilesetId: 'blob47-beach',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [],
          procedural: false,
          inheritable: false,
          sourceLayerId: 'water',
          beachWidth: 1,
          autotilePreset: 'canonical',
          autotileAgainst: [],
        } as CoastlineLayerConfig,
        {
          id: 'water',
          type: 'noise_patch',
          tilesetId: 'blob47-ocean',
          renderOrder: 0,
          blocking: 'blocks',
          terrain: 'water',
          fill: [],
          procedural: false,
          inheritable: false,
          shapePreset: 'island',
          autotilePreset: 'canonical',
          autotileAgainst: [],
          withinTerrain: null,
        },
      ];

      const variant = makeVariant({ terrainLayers: layers });

      // Should not throw — dependency ordering resolves water before shore
      const shape = processLayers(variant, 0, 0, 42);
      expect(shape.layerMasks['shore']).toBeDefined();
      expect(shape.layerMasks['water']).toBeDefined();
    });
  });

  describe('blocking behavior', () => {
    it('unblocks beach tiles on a defaultBlocked map', () => {
      const variant = makeVariant({
        defaultBlocked: true,
        terrainLayers: makeWaterIslandLayers(),
      });

      const shape = processLayers(variant, 0, 0, 42);
      const shoreMask = shape.layerMasks['shore'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (shoreMask[y][x]) {
            expect(shape.blockedMask[y][x]).toBe(false);
          }
        }
      }
    });
  });

  describe('terrain grid', () => {
    it('paints coastline layer ID onto the terrain grid', () => {
      const variant = makeVariant({
        terrainLayers: makeWaterIslandLayers(),
      });

      const shape = processLayers(variant, 0, 0, 42);
      const shoreMask = shape.layerMasks['shore'];

      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (shoreMask[y][x]) {
            expect(shape.terrainGrid![y][x]).toBe('shore');
          }
        }
      }
    });
  });

  describe('fill + noise_patch + coastline (planet pattern)', () => {
    it('generates shore tiles when source is a fill layer overwritten by noise_patch', () => {
      const layers: TerrainLayerConfig[] = [
        {
          id: 'ocean',
          type: 'fill',
          tilesetId: 'blob47-ocean',
          renderOrder: 0,
          blocking: null,
          terrain: 'water',
          fill: [0],
          procedural: false,
          inheritable: false,
        },
        {
          id: 'continents',
          type: 'noise_patch',
          tilesetId: 'blob47-grass',
          renderOrder: 0,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [],
          procedural: false,
          inheritable: false,
          shapePreset: 'continent',
          autotilePreset: 'canonical',
          autotileAgainst: [],
          withinTerrain: null,
        },
        {
          id: 'shore',
          type: 'coastline',
          tilesetId: 'blob47-beach',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [],
          procedural: false,
          inheritable: false,
          sourceLayerId: 'ocean',
          beachWidth: 1,
          autotilePreset: 'canonical',
          autotileAgainst: ['continents'],
        } as CoastlineLayerConfig,
      ];

      const variant = makeVariant({
        width: { min: 60, max: 60 },
        height: { min: 60, max: 60 },
        terrainLayers: layers,
      });

      const shape = processLayers(variant, 0, 0, 42);
      const shoreCount = shape.layerMasks['shore'].flat().filter(Boolean).length;
      const continentCount = shape.layerMasks['continents'].flat().filter(Boolean).length;

      expect(continentCount).toBeGreaterThan(0);
      expect(shoreCount).toBeGreaterThan(0);
    });

    it('shore tiles are on the land side of the water-land boundary', () => {
      const layers: TerrainLayerConfig[] = [
        {
          id: 'ocean',
          type: 'fill',
          tilesetId: 'blob47-ocean',
          renderOrder: 0,
          blocking: null,
          terrain: 'water',
          fill: [0],
          procedural: false,
          inheritable: false,
        },
        {
          id: 'continents',
          type: 'noise_patch',
          tilesetId: 'blob47-grass',
          renderOrder: 0,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [],
          procedural: false,
          inheritable: false,
          shapePreset: 'continent',
          autotilePreset: 'canonical',
          autotileAgainst: [],
          withinTerrain: null,
        },
        {
          id: 'shore',
          type: 'coastline',
          tilesetId: 'blob47-beach',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [],
          procedural: false,
          inheritable: false,
          sourceLayerId: 'ocean',
          beachWidth: 1,
          autotilePreset: 'canonical',
          autotileAgainst: ['continents'],
        } as CoastlineLayerConfig,
      ];

      const variant = makeVariant({
        width: { min: 60, max: 60 },
        height: { min: 60, max: 60 },
        terrainLayers: layers,
      });

      const shape = processLayers(variant, 0, 0, 42);
      const shoreMask = shape.layerMasks['shore'];
      const continentMask = shape.layerMasks['continents'];
      const h = shape.bounds.height;
      const w = shape.bounds.width;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!shoreMask[y][x]) continue;
          // Shore tiles must overlap continent tiles (they're on the land side)
          expect(continentMask[y][x]).toBe(true);
        }
      }
    });
  });

  describe('seed determinism', () => {
    it('produces identical results with the same seed', () => {
      const variant = makeVariant({
        width: { min: 30, max: 30 },
        height: { min: 30, max: 30 },
        terrainLayers: makeWaterIslandLayers({ beachWidth: 2 }),
      });

      const shape1 = processLayers(variant, 0, 0, 99);
      const shape2 = processLayers(variant, 0, 0, 99);

      expect(shape1.layerMasks['shore']).toEqual(shape2.layerMasks['shore']);
    });
  });
});
