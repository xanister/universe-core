/**
 * Unit tests for forest (patches preset) terrain layer processing.
 *
 * Tests via processLayers:
 * - Forest mask is subset of parent terrain (no forest outside land)
 * - No parent terrain tiles → empty forest mask
 * - Autotile produces valid tiles (no -1 within mask)
 * - Seed determinism
 */

import { describe, it, expect } from 'vitest';
import { processLayers } from '@dmnpc/generation/place-layout/algorithms/shape-algorithms.js';
import type { LayoutVariant, FillLayerConfig, NoisePatchLayerConfig } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// ============================================================================
// Test Helpers
// ============================================================================

function makeVariant(overrides: Partial<LayoutVariant>): LayoutVariant {
  return {
    id: 'test',
    scale: 'miles',
    environment: ENVIRONMENT_PRESETS.exterior(),
    width: { min: 30, max: 30 },
    height: { min: 20, max: 20 },
    terrainLayers: [],
    slots: [],
    description: 'test variant',
    weight: 1,
    defaultBlocked: false,
    ...overrides,
  };
}

// ============================================================================
// Shared layer configs
// ============================================================================

const OCEAN_FILL_LAYER: FillLayerConfig = {
  id: 'ocean',
  tilesetId: 'blob47-ocean',
  tilesetOffset: null,
  renderOrder: -1,
  type: 'fill',
  fill: [10],
  blocking: 'blocks',
  terrain: 'water',
  procedural: false,
};

const GRASS_CONTINENT_LAYER: NoisePatchLayerConfig = {
  id: 'continent',
  tilesetId: 'blob47-grass',
  tilesetOffset: null,
  renderOrder: 0,
  type: 'noise_patch',
  fill: [],
  autotilePreset: 'canonical',
  autotileAgainst: [],
  withinTerrain: null,
  shapePreset: 'continent',
  blocking: 'unblocks',
  terrain: 'land',
  procedural: false,
};

const FOREST_LAYER: NoisePatchLayerConfig = {
  id: 'forest',
  tilesetId: 'blob47-grass_dark',
  tilesetOffset: null,
  renderOrder: 1,
  type: 'noise_patch',
  fill: [],
  autotileAgainst: ['forest'],
  autotilePreset: 'canonical',
  withinTerrain: 'continent',
  shapePreset: 'patches',
  blocking: null,
  terrain: 'forest',
  procedural: false,
};

// ============================================================================
// Forest Layer Tests
// ============================================================================

describe('forest layer', () => {
  it('generates forest mask constrained to parent terrain', () => {
    const variant = makeVariant({
      terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER, FOREST_LAYER],
    });
    const shape = processLayers(variant, 0, 0, 42);

    expect(shape.layers).toHaveLength(3);
    expect(shape.layers[2].id).toBe('forest');

    // Forest mask must be a subset of continent mask
    const continentMask = shape.layerMasks['continent'];
    const forestMask = shape.layerMasks['forest'];

    let forestTileCount = 0;
    for (let y = 0; y < shape.bounds.height; y++) {
      for (let x = 0; x < shape.bounds.width; x++) {
        if (forestMask[y][x]) {
          expect(continentMask[y][x]).toBe(true);
          forestTileCount++;
        }
      }
    }

    // Should have generated some forest tiles (with seed 42 on a 30x20 map)
    expect(forestTileCount).toBeGreaterThan(0);
  });

  it('produces empty mask when no parent terrain tiles exist', () => {
    // Forest requires withinTerrain: 'continent', but there's no continent layer
    const variant = makeVariant({
      terrainLayers: [OCEAN_FILL_LAYER, FOREST_LAYER],
    });
    const shape = processLayers(variant, 0, 0, 42);

    const forestMask = shape.layerMasks['forest'];

    // Every tile should be false — no continent tiles to grow on
    for (let y = 0; y < shape.bounds.height; y++) {
      for (let x = 0; x < shape.bounds.width; x++) {
        expect(forestMask[y][x]).toBe(false);
      }
    }
  });

  it('autotile produces valid tiles (no -1 within mask)', () => {
    const variant = makeVariant({
      terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER, FOREST_LAYER],
    });
    const shape = processLayers(variant, 0, 0, 42);

    const forestLayer = shape.layers[2];
    const forestMask = shape.layerMasks['forest'];

    for (let y = 0; y < shape.bounds.height; y++) {
      for (let x = 0; x < shape.bounds.width; x++) {
        if (forestMask[y][x]) {
          expect(forestLayer.tiles[y][x]).not.toBe(-1);
        }
      }
    }
  });

  it('writes forest to terrainGrid', () => {
    const variant = makeVariant({
      terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER, FOREST_LAYER],
    });
    const shape = processLayers(variant, 0, 0, 42);

    expect(shape.terrainGrid).not.toBeNull();

    const forestMask = shape.layerMasks['forest'];
    for (let y = 0; y < shape.bounds.height; y++) {
      for (let x = 0; x < shape.bounds.width; x++) {
        if (forestMask[y][x]) {
          expect(shape.terrainGrid![y][x]).toBe('forest');
        }
      }
    }
  });

  describe('autotileAgainst edge cases', () => {
    it('produces valid tiles even when autotileAgainst is empty', () => {
      // Regression: empty autotileAgainst caused autotile to emit -1 for all
      // forest tiles because the layer's own ID wasn't in the match list.
      const forestWithEmptyAutotile: NoisePatchLayerConfig = {
        ...FOREST_LAYER,
        autotileAgainst: [],
      };
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER, forestWithEmptyAutotile],
      });
      const shape = processLayers(variant, 0, 0, 42);

      const forestLayer = shape.layers[2];
      const forestMask = shape.layerMasks['forest'];

      let forestTileCount = 0;
      for (let y = 0; y < shape.bounds.height; y++) {
        for (let x = 0; x < shape.bounds.width; x++) {
          if (forestMask[y][x]) {
            expect(forestLayer.tiles[y][x]).not.toBe(-1);
            forestTileCount++;
          }
        }
      }

      expect(forestTileCount).toBeGreaterThan(0);
    });
  });

  describe('seed determinism', () => {
    it('produces identical output with same seed', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER, FOREST_LAYER],
      });

      const shape1 = processLayers(variant, 0, 0, 42);
      const shape2 = processLayers(variant, 0, 0, 42);

      expect(shape1.terrainGrid).toEqual(shape2.terrainGrid);
      expect(shape1.layers[2].tiles).toEqual(shape2.layers[2].tiles);
    });

    it('produces different output with different seeds', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER, FOREST_LAYER],
      });

      const shape1 = processLayers(variant, 0, 0, 100);
      const shape2 = processLayers(variant, 0, 0, 200);

      const flat1 = shape1.terrainGrid!.flat().join('');
      const flat2 = shape2.terrainGrid!.flat().join('');
      expect(flat1).not.toBe(flat2);
    });
  });
});
