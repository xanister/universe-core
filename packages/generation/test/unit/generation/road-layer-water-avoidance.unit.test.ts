/**
 * Regression tests for BUG-308: road/path layers must not render over water tiles.
 *
 * Root cause: processRoadLayer and processPathLayer passed the raw generated mask
 * directly to updateTerrainGrid without checking whether tiles were already occupied
 * by water layers. The fix adds avoidLayerIds to RoadLayerConfig/PathLayerConfig
 * and calls applyLayerAvoidance before writing to the terrain grid.
 */

import { describe, it, expect } from 'vitest';
import { processLayers } from '@dmnpc/generation/place-layout/algorithms/shape-algorithms.js';
import type { LayoutVariant, TerrainLayerConfig } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

function makeVariant(overrides: Partial<LayoutVariant>): LayoutVariant {
  return {
    id: 'test',
    scale: 'feet',
    environment: ENVIRONMENT_PRESETS.exterior(),
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

// ============================================================================
// Road layer avoidance
// ============================================================================

describe('BUG-308: road layer does not overwrite water tiles', () => {
  it('road tiles are absent from water-filled cells when avoidLayerIds includes water layer', () => {
    // fill the whole map with water, then run road on top — with avoidLayerIds the
    // road should produce zero road tiles because all cells are water.
    const variant = makeVariant({
      terrainLayers: [
        {
          id: 'ocean',
          type: 'fill',
          tilesetId: 'terrain-ocean',
          renderOrder: 0,
          blocking: 'blocks',
          terrain: 'water',
          fill: [0],
          procedural: false,
        } as TerrainLayerConfig,
        {
          id: 'road_layer',
          type: 'road',
          tilesetId: 'terrain-cobble',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'road',
          fill: [0],
          procedural: false,
          roadWidth: 2,
          branchCount: 0,
          curvature: 0,
          autotilePreset: 'canonical',
          autotileAgainst: ['road_layer'],
          avoidLayerIds: ['ocean'],
        } as TerrainLayerConfig,
      ] as TerrainLayerConfig[],
    });

    const shape = processLayers(variant, 0, 0, 42);

    // No tile in the terrain grid should be painted as road — ocean fills everything
    const width = shape.bounds.width;
    const height = shape.bounds.height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        expect(shape.terrainGrid![y][x]).not.toBe('road_layer');
      }
    }
  });

  it('road tiles are present when avoidLayerIds is empty (no water to avoid)', () => {
    const variant = makeVariant({
      terrainLayers: [
        {
          id: 'ground',
          type: 'fill',
          tilesetId: 'terrain-grass',
          renderOrder: 0,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [0],
          procedural: false,
        } as TerrainLayerConfig,
        {
          id: 'road_layer',
          type: 'road',
          tilesetId: 'terrain-cobble',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'road',
          fill: [0],
          procedural: false,
          roadWidth: 2,
          branchCount: 0,
          curvature: 0,
          autotilePreset: 'canonical',
          autotileAgainst: ['road_layer'],
          avoidLayerIds: [],
        } as TerrainLayerConfig,
      ] as TerrainLayerConfig[],
    });

    const shape = processLayers(variant, 0, 0, 42);

    const grid = shape.terrainGrid!;
    const hasRoad = grid.some((row) => row.some((cell) => cell === 'road_layer'));
    expect(hasRoad).toBe(true);
  });

  it('road avoids only listed layer IDs and paints over unlisted layers', () => {
    // Two fill layers: "ocean" (water) and "sand" (land). Road avoids ocean but
    // should freely paint over sand.
    const variant = makeVariant({
      width: { min: 20, max: 20 },
      height: { min: 20, max: 20 },
      terrainLayers: [
        {
          id: 'sand',
          type: 'fill',
          tilesetId: 'terrain-sand',
          renderOrder: 0,
          blocking: 'unblocks',
          terrain: 'land',
          fill: [0],
          procedural: false,
        } as TerrainLayerConfig,
        {
          id: 'road_layer',
          type: 'road',
          tilesetId: 'terrain-cobble',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'road',
          fill: [0],
          procedural: false,
          roadWidth: 2,
          branchCount: 0,
          curvature: 0,
          autotilePreset: 'canonical',
          autotileAgainst: ['road_layer'],
          avoidLayerIds: ['ocean'],
        } as TerrainLayerConfig,
      ] as TerrainLayerConfig[],
    });

    const shape = processLayers(variant, 0, 0, 42);

    // Road should still appear (sand is not in avoidLayerIds)
    const grid = shape.terrainGrid!;
    const hasRoad = grid.some((row) => row.some((cell) => cell === 'road_layer'));
    expect(hasRoad).toBe(true);

    // No tile should be 'ocean' since no ocean layer was defined
    const hasOcean = grid.some((row) => row.some((cell) => cell === 'ocean'));
    expect(hasOcean).toBe(false);
  });
});

// ============================================================================
// Path layer avoidance
// ============================================================================

describe('BUG-308: path layer does not overwrite water tiles', () => {
  it('path tiles are absent from water-filled cells when avoidLayerIds includes water layer', () => {
    const variant = makeVariant({
      terrainLayers: [
        {
          id: 'ocean',
          type: 'fill',
          tilesetId: 'terrain-ocean',
          renderOrder: 0,
          blocking: 'blocks',
          terrain: 'water',
          fill: [0],
          procedural: false,
        } as TerrainLayerConfig,
        {
          id: 'path_layer',
          type: 'path',
          tilesetId: 'terrain-dirt',
          renderOrder: 1,
          blocking: 'unblocks',
          terrain: 'road',
          fill: [0],
          procedural: false,
          curvature: 0,
          autotilePreset: 'canonical',
          autotileAgainst: ['path_layer'],
          avoidLayerIds: ['ocean'],
        } as TerrainLayerConfig,
      ] as TerrainLayerConfig[],
    });

    const shape = processLayers(variant, 0, 0, 42);

    const width = shape.bounds.width;
    const height = shape.bounds.height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        expect(shape.terrainGrid![y][x]).not.toBe('path_layer');
      }
    }
  });
});
