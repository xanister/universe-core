/**
 * Unit tests for continent and nebula terrain layer processing.
 *
 * Tests the layer-driven architecture via processLayers:
 * - Fill + noise_patch continent layers (planet pattern)
 * - Noise_patch nebula layers (cosmos pattern)
 * - Blocking composition, terrainGrid composition
 * - Seed determinism
 */

import { describe, it, expect } from 'vitest';
import { processLayers } from '@dmnpc/generation/place-layout/algorithms/shape-algorithms.js';
import type { LayoutVariant, FillLayerConfig, NoisePatchLayerConfig } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS, resolveNoiseParams, NOISE_PRESETS } from '@dmnpc/types/world';

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
  id: 'grass',
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

const NEBULA_LAYER: NoisePatchLayerConfig = {
  id: 'nebula',
  tilesetId: 'blob47-nebula_purple',
  tilesetOffset: null,
  renderOrder: 5000,
  type: 'noise_patch',
  fill: [],
  autotileAgainst: ['nebula', 'dense_nebula'],
  autotilePreset: 'canonical',
  withinTerrain: null,
  shapePreset: 'nebula',
  blocking: null,
  terrain: 'nebula',
  procedural: false,
};

const DENSE_NEBULA_LAYER: NoisePatchLayerConfig = {
  id: 'dense_nebula',
  tilesetId: 'blob47-nebula_blue',
  tilesetOffset: null,
  renderOrder: 5001,
  type: 'noise_patch',
  fill: [],
  autotileAgainst: ['nebula', 'dense_nebula'],
  autotilePreset: 'canonical',
  withinTerrain: 'nebula',
  shapePreset: 'sub_nebula',
  blocking: null,
  terrain: 'nebula',
  procedural: false,
};

// ============================================================================
// Continent (fill + continent layers)
// ============================================================================

describe('continent layers', () => {
  describe('fill layer', () => {
    it('produces a layer with uniform tile index', () => {
      const variant = makeVariant({ terrainLayers: [OCEAN_FILL_LAYER] });
      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.layers).toHaveLength(1);
      const oceanLayer = shape.layers[0];
      expect(oceanLayer.id).toBe('ocean');
      expect(oceanLayer.tilesetId).toBe('blob47-ocean');
      expect(oceanLayer.depth).toBe(-1);

      for (const row of oceanLayer.tiles) {
        for (const tile of row) {
          expect(tile).toBe(10);
        }
      }
    });

    it('blocks all tiles when blocking: blocks', () => {
      const variant = makeVariant({ terrainLayers: [OCEAN_FILL_LAYER] });
      const shape = processLayers(variant, 0, 0, 42);

      for (const row of shape.blockedMask) {
        for (const cell of row) {
          expect(cell).toBe(true);
        }
      }
    });
  });

  describe('fill + continent (planet pattern)', () => {
    it('produces two layers', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER],
      });
      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.layers).toHaveLength(2);
      expect(shape.layers[0].id).toBe('ocean');
      expect(shape.layers[1].id).toBe('grass');
    });

    it('sorts layers by renderOrder', () => {
      const variant = makeVariant({
        terrainLayers: [GRASS_CONTINENT_LAYER, OCEAN_FILL_LAYER],
      });
      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.layers[0].id).toBe('ocean'); // renderOrder -1
      expect(shape.layers[1].id).toBe('grass'); // renderOrder 0
    });

    it('composes blockedMask: ocean blocks, grass unblocks', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER],
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

    it('composes terrainGrid from layer masks', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER],
      });
      const shape = processLayers(variant, 0, 0, 42);

      expect(shape.terrainGrid).not.toBeNull();
      let hasWater = false;
      let hasGrass = false;

      for (const row of shape.terrainGrid!) {
        for (const cell of row) {
          if (cell === 'water' || cell === 'ocean') hasWater = true;
          if (cell === 'grass') hasGrass = true;
        }
      }

      expect(hasGrass).toBe(true);
    });

    it('continent layer uses autotile (tiles are not uniform)', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER],
      });
      const shape = processLayers(variant, 0, 0, 42);

      const grassLayer = shape.layers.find((l) => l.id === 'grass')!;
      const uniqueTiles = new Set<number>();

      for (const row of grassLayer.tiles) {
        for (const tile of row) {
          uniqueTiles.add(tile);
        }
      }

      expect(uniqueTiles.size).toBeGreaterThan(1);
    });
  });

  describe('seed determinism', () => {
    it('produces identical output with same seed', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER],
      });

      const shape1 = processLayers(variant, 0, 0, 42);
      const shape2 = processLayers(variant, 0, 0, 42);

      expect(shape1.blockedMask).toEqual(shape2.blockedMask);
      expect(shape1.terrainGrid).toEqual(shape2.terrainGrid);
      expect(shape1.layers.length).toBe(shape2.layers.length);

      for (let i = 0; i < shape1.layers.length; i++) {
        expect(shape1.layers[i].tiles).toEqual(shape2.layers[i].tiles);
      }
    });

    it('produces different output with different seeds', () => {
      const variant = makeVariant({
        terrainLayers: [OCEAN_FILL_LAYER, GRASS_CONTINENT_LAYER],
      });

      const shape1 = processLayers(variant, 0, 0, 100);
      const shape2 = processLayers(variant, 0, 0, 200);

      const flat1 = shape1.terrainGrid!.flat().join('');
      const flat2 = shape2.terrainGrid!.flat().join('');
      expect(flat1).not.toBe(flat2);
    });
  });
});

// ============================================================================
// Nebula layers (space pattern)
// ============================================================================

describe('nebula layers', () => {
  it('generates nebula region with terrainGrid', () => {
    const variant = makeVariant({
      scale: 'lightyears',
      environment: ENVIRONMENT_PRESETS.space(),
      terrainLayers: [NEBULA_LAYER],
    });
    const shape = processLayers(variant, 0, 0, 42);

    expect(shape.layers).toHaveLength(1);
    expect(shape.layers[0].id).toBe('nebula');
    expect(shape.terrainGrid).not.toBeNull();
  });

  it('all tiles are passable (blocking: null)', () => {
    const variant = makeVariant({
      terrainLayers: [NEBULA_LAYER],
    });
    const shape = processLayers(variant, 0, 0, 42);

    for (const row of shape.blockedMask) {
      for (const cell of row) {
        expect(cell).toBe(false);
      }
    }
  });

  it('dense nebula constrained to within nebula regions', () => {
    const variant = makeVariant({
      terrainLayers: [NEBULA_LAYER, DENSE_NEBULA_LAYER],
    });
    const shape = processLayers(variant, 0, 0, 42);

    expect(shape.layers).toHaveLength(2);

    // Dense nebula mask should only be true where nebula mask is true
    const nebulaMask = shape.layerMasks['nebula'];
    const denseMask = shape.layerMasks['dense_nebula'];

    for (let y = 0; y < shape.bounds.height; y++) {
      for (let x = 0; x < shape.bounds.width; x++) {
        if (denseMask[y][x]) {
          expect(nebulaMask[y][x]).toBe(true);
        }
      }
    }
  });

  describe('seed determinism', () => {
    it('produces identical output with same seed', () => {
      const variant = makeVariant({
        terrainLayers: [NEBULA_LAYER],
      });

      const shape1 = processLayers(variant, 0, 0, 42);
      const shape2 = processLayers(variant, 0, 0, 42);

      expect(shape1.terrainGrid).toEqual(shape2.terrainGrid);
      expect(shape1.layers[0].tiles).toEqual(shape2.layers[0].tiles);
    });

    it('produces different output with different seeds', () => {
      const variant = makeVariant({
        terrainLayers: [NEBULA_LAYER],
      });

      const shape1 = processLayers(variant, 0, 0, 100);
      const shape2 = processLayers(variant, 0, 0, 200);

      const flat1 = shape1.terrainGrid!.flat().join('');
      const flat2 = shape2.terrainGrid!.flat().join('');
      expect(flat1).not.toBe(flat2);
    });
  });
});

// ============================================================================
// Noise Preset Resolution
// ============================================================================

describe('resolveNoiseParams', () => {
  it('returns preset defaults for named presets', () => {
    const config: NoisePatchLayerConfig = {
      ...GRASS_CONTINENT_LAYER,
      shapePreset: 'continent',
    };
    const params = resolveNoiseParams(config);
    expect(params).toEqual(NOISE_PRESETS.continent);
  });

  it('allows overrides on named presets', () => {
    const config: NoisePatchLayerConfig = {
      ...GRASS_CONTINENT_LAYER,
      shapePreset: 'continent',
      noiseScale: 0.05,
      threshold: 0.3,
    };
    const params = resolveNoiseParams(config);
    expect(params.noiseScale).toBe(0.05);
    expect(params.threshold).toBe(0.3);
    // Non-overridden fields use preset defaults
    expect(params.octaves).toBe(NOISE_PRESETS.continent!.octaves);
    expect(params.persistence).toBe(NOISE_PRESETS.continent!.persistence);
    expect(params.edgeBehavior).toBe(NOISE_PRESETS.continent!.edgeBehavior);
  });

  it('requires all fields for custom preset', () => {
    const config: NoisePatchLayerConfig = {
      ...GRASS_CONTINENT_LAYER,
      shapePreset: 'custom',
      noiseScale: 0.03,
      octaves: 5,
      persistence: 0.6,
      threshold: 0.2,
      edgeBehavior: 'none',
    };
    const params = resolveNoiseParams(config);
    expect(params).toEqual({
      noiseScale: 0.03,
      octaves: 5,
      persistence: 0.6,
      threshold: 0.2,
      edgeBehavior: 'none',
    });
  });

  it('throws when custom preset is missing required fields', () => {
    const config = {
      ...GRASS_CONTINENT_LAYER,
      shapePreset: 'custom' as const,
    };
    // Remove optional noise override fields
    delete (config as Record<string, unknown>).noiseScale;
    delete (config as Record<string, unknown>).octaves;
    delete (config as Record<string, unknown>).persistence;
    delete (config as Record<string, unknown>).threshold;
    delete (config as Record<string, unknown>).edgeBehavior;

    expect(() => resolveNoiseParams(config)).toThrow('missing required noise parameters');
  });

  it('resolves all named presets without error', () => {
    const presetNames = ['continent', 'island', 'clearing', 'patches', 'scattered', 'nebula', 'sub_nebula'] as const;
    for (const name of presetNames) {
      const config: NoisePatchLayerConfig = {
        ...GRASS_CONTINENT_LAYER,
        shapePreset: name,
      };
      const params = resolveNoiseParams(config);
      expect(params.noiseScale).toBeGreaterThan(0);
      expect(params.octaves).toBeGreaterThanOrEqual(1);
    }
  });

});
