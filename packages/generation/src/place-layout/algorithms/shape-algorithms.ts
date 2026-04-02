/**
 * Terrain Layer Processor
 *
 * Processes terrain layers to produce a GeneratedShape.
 * Processing order is determined by dependency-aware topological sort (layers
 * that reference other layers by ID are processed after their dependencies).
 * Visual depth uses `renderOrder` from each layer config independently.
 *
 * Layer types:
 * - fill: uniform tile across entire map
 * - noise_fill: directional fill with noise-perturbed boundary edge + autotile
 * - noise_patch: configurable noise-based terrain shape with named presets + autotile
 * - rectangle: rectangular room interior, inset from canvas edges
 * - l_shape: L-shaped room interior, inset from canvas edges
 * - t_shape: T-shaped room interior, inset from canvas edges
 * - wall: edge/trim around the room shape (always 1 tile thick, ceiling trim autotile).
 *         Automatically detects north-facing tiles (wall tiles with room-interior north
 *         neighbor) and emits a high-depth overlay layer for overhead passthrough.
 * - wall_face: 3-tile face strips below wall edges (references wall + room layers)
 * - road: connected road network (spine + branches), autotiled
 * - path: single winding trail between two edge points, autotiled
 */

import { randomIntWithRng } from '@dmnpc/core/infra/random-utils.js';
import type {
  GeneratedShape,
  RoadGraph,
  CaveGraph,
  TerrainLayer,
  AutotilePreset,
  TerrainLayerConfig,
  LayoutVariant,
  DimensionRange,
  NoisePatchLayerConfig,
  NoiseFillLayerConfig,
  CoastlineLayerConfig,
  FillLayerConfig,
  StarfieldLayerConfig,
  SpriteBackdropLayerConfig,
  AnimatedOverlayLayerConfig,
  WallFaceLayerConfig,
  RoadLayerConfig,
  PathLayerConfig,
  TownCenterLayerConfig,
  CaveLayerConfig,
  ResolvedDistrict,
} from '@dmnpc/types/world';
import { resolveNoiseParams } from '@dmnpc/types/world';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { computeNodeDegrees, identifyDistrictCenters } from './district-identifier.js';
import {
  applyLayeredAutotile,
  applyWang16LayeredAutotile,
  applyWang2CornerLayered,
  applyAutotile47Layered,
  applyAutotile47LpcLayered,
  loadAutotileConfig,
} from '../../autotile/index.js';
import { loadFullWallStyle } from '../wall-styles.js';
import { generateRoadNetwork } from './road-generator.js';
import { generatePath } from './path-generator.js';
import { generateCaveNetwork } from './cave-generator.js';

// ============================================================================
// Seeded Random Number Generator
// ============================================================================

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

/**
 * Pick a tile index from a fill array. Randomly selects when multiple tiles provide variation.
 */
function pickFill(fills: number[], rng: () => number): number {
  if (fills.length === 0) return 0;
  if (fills.length === 1) return fills[0];
  return fills[Math.floor(rng() * fills.length)];
}

// ============================================================================
// Layer Processing Result
// ============================================================================

interface LayerResult {
  mask: boolean[][];
  tiles: number[][];
  terrainLayer: TerrainLayer;
  /** Additional terrain layers produced by this processor (e.g., wall overhead + face). */
  extraTerrainLayers?: TerrainLayer[];
  /** Road network graph produced by road/path layer types. */
  roadGraph?: RoadGraph;
  /** Cave network graph produced by cave layer types. */
  caveGraph?: CaveGraph;
}

// ============================================================================
// Layer Processing Order
// ============================================================================

/**
 * Build a dependency-aware processing order for terrain layers.
 *
 * Layers that reference other layers by ID (e.g. wall_face → wallLayerId, roomLayerId)
 * are guaranteed to process after their dependencies. Layers without dependencies
 * maintain their relative renderOrder. Uses DFS topological sort with renderOrder
 * as tiebreaker.
 */
function buildProcessingOrder(configs: readonly TerrainLayerConfig[]): TerrainLayerConfig[] {
  const byId = new Map(configs.map((c) => [c.id, c]));

  const getLayerDeps = (config: TerrainLayerConfig): string[] => {
    if (config.type === 'wall_face') {
      return [config.wallLayerId, config.roomLayerId];
    }
    if (config.type === 'coastline') {
      return [config.sourceLayerId];
    }
    return [];
  };

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: TerrainLayerConfig[] = [];

  const visit = (config: TerrainLayerConfig) => {
    if (visited.has(config.id)) return;
    if (visiting.has(config.id)) {
      throw new Error(
        `Circular layer dependency detected involving "${config.id}". ` +
          `Check wallLayerId / roomLayerId references.`,
      );
    }
    visiting.add(config.id);
    for (const depId of getLayerDeps(config)) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    visiting.delete(config.id);
    visited.add(config.id);
    result.push(config);
  };

  const sorted = [...configs].sort((a, b) => a.renderOrder - b.renderOrder);
  for (const config of sorted) {
    visit(config);
  }

  return result;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Process a layout variant into a GeneratedShape.
 *
 * Resolves dimensions from the variant, then iterates terrain layers in
 * dependency-aware order. Each layer handler produces tiles and a mask.
 * The wall handler reads the layer directly below it to trace its boundary.
 */
export function processLayers(
  variant: LayoutVariant,
  targetWidth: number,
  targetHeight: number,
  seed: number,
): GeneratedShape {
  const rng = createRng(seed);
  const tileSize = 32;

  // Resolve dimensions
  const widthTiles = resolveDimension(variant.width, targetWidth, tileSize, rng);
  const heightTiles = resolveDimension(variant.height, targetHeight, tileSize, rng);

  // Initialize output — variant.defaultBlocked controls starting state
  const blockedMask: boolean[][] = Array.from({ length: heightTiles }, () =>
    new Array<boolean>(widthTiles).fill(variant.defaultBlocked),
  );
  const layers: TerrainLayer[] = [];
  const layerMasks: Record<string, boolean[][]> = {};
  const layerTiles: Record<string, number[][]> = {};
  const layerTilesets: Record<string, { tilesetId: string }> = {};
  let terrainGrid: string[][] | null = null;
  let roadGraph: RoadGraph | null = null;
  let caveGraph: CaveGraph | null = null;

  // Build dependency-aware processing order (renderOrder for visual depth only)
  const sortedConfigs = buildProcessingOrder(variant.terrainLayers);

  // Track previous layer result for wall handler
  let previousResult: LayerResult | null = null;

  for (const layerConfig of sortedConfigs) {
    const result = processLayer(
      layerConfig,
      widthTiles,
      heightTiles,
      rng,
      previousResult,
      terrainGrid,
      layerMasks,
      roadGraph,
    );

    // Compose blocking — driven entirely by each layer's `blocking` config field.
    if (layerConfig.blocking === 'blocks') {
      for (let y = 0; y < heightTiles; y++) {
        for (let x = 0; x < widthTiles; x++) {
          if (result.mask[y][x]) blockedMask[y][x] = true;
        }
      }
    } else if (layerConfig.blocking === 'unblocks') {
      for (let y = 0; y < heightTiles; y++) {
        for (let x = 0; x < widthTiles; x++) {
          if (result.mask[y][x]) blockedMask[y][x] = false;
        }
      }
    }

    // Every layer paints its ID onto the terrainGrid — except animated overlays,
    // which are purely visual and should not affect terrain-based slot placement or movement.
    // The generator.ts converts layer IDs to terrain tags via layerTerrainMap when building
    // the final PlaceLayout (see generator.ts "Build terrain-tag grid" section).
    if (layerConfig.type !== 'animated_overlay') {
      terrainGrid = updateTerrainGrid(
        terrainGrid,
        widthTiles,
        heightTiles,
        layerConfig.id,
        result.mask,
      );
    }

    layerMasks[layerConfig.id] = result.mask;
    layerTiles[layerConfig.id] = result.tiles;
    layerTilesets[layerConfig.id] = {
      tilesetId: result.terrainLayer.tilesetId,
    };
    layers.push(result.terrainLayer);
    if (result.extraTerrainLayers) {
      for (const extra of result.extraTerrainLayers) {
        layers.push(extra);
      }
    }
    if (result.roadGraph) {
      roadGraph = mergeRoadGraphs(roadGraph, result.roadGraph);
    }
    if (result.caveGraph) {
      caveGraph = mergeCaveGraphs(caveGraph, result.caveGraph);
    }
    previousResult = result;
  }

  // Automatic north-facing wall overhead passthrough.
  // For each wall layer, find wall tiles whose north neighbor (y-1) is a floor
  // tile (room interior, not wall). Those tiles get unblocked and an extra
  // high-depth render layer so the player walks behind the wall.
  const roomMask = buildRoomMask(sortedConfigs, layerMasks, widthTiles, heightTiles);
  for (const layerConfig of sortedConfigs) {
    if (layerConfig.type !== 'wall') continue;
    const wallMask = layerMasks[layerConfig.id];
    const wallTiles = layerTiles[layerConfig.id];

    const northMask: boolean[][] = Array.from({ length: heightTiles }, () =>
      new Array<boolean>(widthTiles).fill(false),
    );
    const northTiles: number[][] = Array.from({ length: heightTiles }, () =>
      new Array<number>(widthTiles).fill(-1),
    );
    let hasNorthFacing = false;

    for (let y = 1; y < heightTiles; y++) {
      for (let x = 0; x < widthTiles; x++) {
        if (!wallMask[y][x]) continue;
        const northIsFloor = roomMask[y - 1]?.[x] === true && !wallMask[y - 1]?.[x];
        if (!northIsFloor) continue;
        northTiles[y][x] = wallTiles[y][x];
        northMask[y][x] = true;
        blockedMask[y][x] = false;
        hasNorthFacing = true;
      }
    }

    if (!hasNorthFacing) continue;

    const synthId = `${layerConfig.id}__north_overhead`;
    const wallTileset = layerTilesets[layerConfig.id];

    layers.push({
      id: synthId,
      tilesetId: wallTileset.tilesetId,
      tilesetOffset: 0,
      tiles: northTiles,
      depth: layerConfig.renderOrder + 3001,
    });

    layerMasks[synthId] = northMask;
    terrainGrid = updateTerrainGrid(terrainGrid, widthTiles, heightTiles, synthId, northMask);
  }

  // Resolve district centers from road topology
  let districts: ResolvedDistrict[] | null = null;
  if (variant.districts && variant.districts.length > 0 && roadGraph) {
    districts = identifyDistrictCenters(roadGraph, variant.districts);
  }

  return {
    blockedMask,
    bounds: { x: 0, y: 0, width: widthTiles, height: heightTiles },
    terrainGrid,
    layers,
    layerMasks,
    roadGraph,
    caveGraph,
    districts,
  };
}

// ============================================================================
// Dimension Resolution
// ============================================================================

function resolveDimension(
  range: DimensionRange,
  targetPixels: number,
  tileSize: number,
  rng: () => number,
): number {
  if (targetPixels > 0) {
    return Math.max(range.min, Math.min(range.max, Math.floor(targetPixels / tileSize)));
  }
  return randomIntWithRng(rng, range.min, range.max);
}

// ============================================================================
// Layer Dispatcher
// ============================================================================

function processLayer(
  config: TerrainLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  previousResult: LayerResult | null,
  terrainGrid: string[][] | null,
  layerMasks: Record<string, boolean[][]>,
  roadGraph: RoadGraph | null,
): LayerResult {
  switch (config.type) {
    case 'fill':
    case 'starfield':
      return processFillLayer(config, width, height, rng);
    case 'noise_fill':
      return processNoiseFillLayer(config, width, height, rng, terrainGrid);
    case 'noise_patch':
      return processNoisePatchLayer(config, width, height, rng, terrainGrid);
    case 'coastline':
      return processCoastlineLayer(config, width, height, rng, terrainGrid, layerMasks);
    case 'rectangle':
      return processRectangleLayer(config, width, height, rng);
    case 'l_shape':
      return processLShapeLayer(config, width, height, rng);
    case 't_shape':
      return processTShapeLayer(config, width, height, rng);
    case 'wall':
      return processWallLayer(config, width, height, rng, previousResult);
    case 'wall_face':
      return processWallFaceLayer(config, width, height, layerMasks);
    case 'sprite_backdrop':
      return processSpriteBackdropLayer(config, width, height);
    case 'animated_overlay':
      return processFillLayer(config, width, height, rng);
    case 'road':
      return processRoadLayer(config, width, height, rng, terrainGrid);
    case 'path':
      return processPathLayer(config, width, height, rng, terrainGrid);
    case 'town_center':
      return processTownCenterLayer(config, width, height, rng, terrainGrid, roadGraph);
    case 'cave':
      return processCaveLayer(config, width, height, rng, terrainGrid);
    default:
      throw new Error(`Unknown layer type: ${(config as TerrainLayerConfig).type}`);
  }
}

// ============================================================================
// Fill Layer
// ============================================================================

function processFillLayer(
  config: FillLayerConfig | StarfieldLayerConfig | AnimatedOverlayLayerConfig,
  width: number,
  height: number,
  rng: () => number,
): LayerResult {
  const mask = Array.from({ length: height }, () => new Array<boolean>(width).fill(true));
  const tiles: number[][] = Array.from({ length: height }, () => {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) {
      row[x] = pickFill(config.fill, rng);
    }
    return row;
  });

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Noise Fill Layer (directional fill with noise-perturbed edge)
// ============================================================================

/**
 * Directional fill with a noise-perturbed boundary edge.
 * Fills a configurable percentage of the map from one direction (N/S/E/W),
 * using 1D simplex noise along the boundary to create an organic edge.
 */
function processNoiseFillLayer(
  config: NoiseFillLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  terrainGrid: string[][] | null,
): LayerResult {
  const noise: NoiseFunction2D = createNoise2D(() => rng());

  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );

  // Determine primary axis dimension and boundary base position.
  // For N/S fills, the boundary is horizontal (varies along x).
  // For E/W fills, the boundary is vertical (varies along y).
  const isVerticalFill = config.fillDirection === 'north' || config.fillDirection === 'south';
  const axisDim = isVerticalFill ? height : width;
  const crossDim = isVerticalFill ? width : height;
  const baseLine = config.fillPercent * axisDim;
  const amplitude = config.noiseAmplitude * axisDim;

  for (let cross = 0; cross < crossDim; cross++) {
    // 1D noise along the boundary: use cross-axis position, constant on the other axis
    const noiseVal = noise(cross * config.noiseScale, 0);
    const boundary = baseLine + noiseVal * amplitude;

    for (let axis = 0; axis < axisDim; axis++) {
      // Determine if this tile is on the filled side of the boundary.
      // "North" fill originates from the top (y=0), "south" from the bottom,
      // "west" from the left (x=0), "east" from the right.
      let filled: boolean;
      switch (config.fillDirection) {
        case 'north':
          filled = axis < boundary; // fill from y=0 downward
          break;
        case 'south':
          filled = axisDim - 1 - axis < boundary; // fill from y=max upward
          break;
        case 'west':
          filled = axis < boundary; // fill from x=0 rightward
          break;
        case 'east':
          filled = axisDim - 1 - axis < boundary; // fill from x=max leftward
          break;
      }

      if (filled) {
        // Map (axis, cross) back to (x, y) based on fill direction
        const y = isVerticalFill ? axis : cross;
        const x = isVerticalFill ? cross : axis;
        mask[y][x] = true;
      }
    }
  }

  // Build autotile grid and dispatch
  const gridForAutotile = updateTerrainGrid(terrainGrid, width, height, config.id, mask);

  const matchTerrains = config.autotileAgainst.includes(config.id)
    ? config.autotileAgainst
    : [config.id, ...config.autotileAgainst];

  const tiles = autotileDispatch(
    gridForAutotile,
    matchTerrains,
    config.autotilePreset,
    rng,
    config.altCenterCount,
  );

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Noise Patch Layer (unified noise-based terrain generation)
// ============================================================================

/**
 * Unified noise-based terrain generation.
 * Replaces the old continent/nebula/forest/clearing handlers.
 * Noise parameters come from the named shapePreset (with optional overrides)
 * or are fully specified when shapePreset is 'custom'.
 */
function processNoisePatchLayer(
  config: NoisePatchLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  terrainGrid: string[][] | null,
): LayerResult {
  const noise: NoiseFunction2D = createNoise2D(() => rng());
  const params = resolveNoiseParams(config);

  // For 'open_one_edge', pick which edge to leave open
  const openEdge = params.edgeBehavior === 'open_one_edge' ? Math.floor(rng() * 4) : -1;

  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // If constrained to a parent layer, skip tiles outside it
      if (config.withinTerrain !== null && terrainGrid) {
        if (terrainGrid[y]?.[x] !== config.withinTerrain) continue;
      }

      const value = fbm(noise, x, y, params.octaves, params.noiseScale, params.persistence);

      // Apply edge behavior
      let falloff = 1.0;
      if (params.edgeBehavior === 'falloff') {
        falloff = getEdgeFalloff(x, y, width, height);
      } else if (params.edgeBehavior === 'open_one_edge') {
        falloff = getEdgeFalloffOpen(x, y, width, height, openEdge);
      }

      if (value * falloff > params.threshold) {
        mask[y][x] = true;
      }
    }
  }

  // Build autotile grid and dispatch
  const gridForAutotile = updateTerrainGrid(terrainGrid, width, height, config.id, mask);

  // Ensure self-ID is in the match list for autotile neighbor checks
  const matchTerrains = config.autotileAgainst.includes(config.id)
    ? config.autotileAgainst
    : [config.id, ...config.autotileAgainst];

  const tiles = autotileDispatch(
    gridForAutotile,
    matchTerrains,
    config.autotilePreset,
    rng,
    config.altCenterCount,
  );

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Coastline Layer
// ============================================================================

/**
 * Coastline: paints a beach/shore transition at the boundary between a water
 * layer (sourceLayerId) and adjacent terrain. Uses the terrain grid to find
 * where the source layer is STILL the active terrain (handles fill layers
 * that were partially overwritten by later layers like continents).
 * Optionally expands by beachWidth, then autotiles.
 */
function processCoastlineLayer(
  config: CoastlineLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  terrainGrid: string[][] | null,
  layerMasks: Record<string, boolean[][]>,
): LayerResult {
  if (!(config.sourceLayerId in layerMasks)) {
    throw new Error(
      `coastline layer "${config.id}" references sourceLayerId "${config.sourceLayerId}" but no such layer mask exists. ` +
        `Available: [${Object.keys(layerMasks).join(', ')}]`,
    );
  }

  // Derive the effective source mask from the terrain grid when available.
  // A fill layer's raw mask covers the entire map, but later layers (e.g.
  // continents) overwrite portions of the terrain grid. The effective mask
  // reflects where the source layer is STILL the active terrain.
  const effectiveSourceMask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );

  if (terrainGrid) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        effectiveSourceMask[y][x] = terrainGrid[y][x] === config.sourceLayerId;
      }
    }
  } else {
    const rawMask = layerMasks[config.sourceLayerId];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        effectiveSourceMask[y][x] = rawMask[y][x];
      }
    }
  }

  // Find boundary tiles: non-source tiles adjacent (cardinal) to source tiles.
  // These are the tiles just outside the water that form the beach.
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (effectiveSourceMask[y][x]) continue;
      const hasAdjacentSource =
        (y > 0 && effectiveSourceMask[y - 1][x]) ||
        (y < height - 1 && effectiveSourceMask[y + 1][x]) ||
        (x > 0 && effectiveSourceMask[y][x - 1]) ||
        (x < width - 1 && effectiveSourceMask[y][x + 1]);
      if (hasAdjacentSource) {
        mask[y][x] = true;
      }
    }
  }

  // Expand beach by beachWidth - 1 additional rings (width 1 = boundary only)
  for (let ring = 1; ring < config.beachWidth; ring++) {
    const snapshot = mask.map((row) => [...row]);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (snapshot[y][x] || effectiveSourceMask[y][x]) continue;
        const hasAdjacentBeach =
          (y > 0 && snapshot[y - 1][x]) ||
          (y < height - 1 && snapshot[y + 1][x]) ||
          (x > 0 && snapshot[y][x - 1]) ||
          (x < width - 1 && snapshot[y][x + 1]);
        if (hasAdjacentBeach) {
          mask[y][x] = true;
        }
      }
    }
  }

  // Build autotile grid and dispatch
  const gridForAutotile = updateTerrainGrid(terrainGrid, width, height, config.id, mask);

  const matchTerrains = config.autotileAgainst.includes(config.id)
    ? config.autotileAgainst
    : [config.id, ...config.autotileAgainst];

  const tiles = autotileDispatch(
    gridForAutotile,
    matchTerrains,
    config.autotilePreset,
    rng,
    config.altCenterCount,
  );

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Road Layer
// ============================================================================

function processRoadLayer(
  config: RoadLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  terrainGrid: string[][] | null,
): LayerResult {
  const { graph, mask: rawMask } = generateRoadNetwork(
    width,
    height,
    config.roadWidth,
    config.branchCount,
    config.curvature,
    rng,
  );

  const mask = applyLayerAvoidance(rawMask, terrainGrid, config.avoidLayerIds);

  // Build autotile grid and dispatch
  const gridForAutotile = updateTerrainGrid(terrainGrid, width, height, config.id, mask);

  const matchTerrains = config.autotileAgainst.includes(config.id)
    ? config.autotileAgainst
    : [config.id, ...config.autotileAgainst];

  const tiles = autotileDispatch(
    gridForAutotile,
    matchTerrains,
    config.autotilePreset,
    rng,
    config.altCenterCount,
  );

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
    roadGraph: graph,
  };
}

// ============================================================================
// Path Layer
// ============================================================================

function processPathLayer(
  config: PathLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  terrainGrid: string[][] | null,
): LayerResult {
  const { mask: rawMask } = generatePath(width, height, config.curvature, rng);

  const mask = applyLayerAvoidance(rawMask, terrainGrid, config.avoidLayerIds);

  // Build autotile grid and dispatch
  const gridForAutotile = updateTerrainGrid(terrainGrid, width, height, config.id, mask);

  const matchTerrains = config.autotileAgainst.includes(config.id)
    ? config.autotileAgainst
    : [config.id, ...config.autotileAgainst];

  const tiles = autotileDispatch(
    gridForAutotile,
    matchTerrains,
    config.autotilePreset,
    rng,
    config.altCenterCount,
  );

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Town Center Layer
// ============================================================================

function processTownCenterLayer(
  config: TownCenterLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  terrainGrid: string[][] | null,
  roadGraph: RoadGraph | null,
): LayerResult {
  // Find the highest-degree intersection from the road graph
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );

  if (roadGraph && roadGraph.nodes.length > 0) {
    const degrees = computeNodeDegrees(roadGraph);
    let bestIdx = 0;
    for (let i = 1; i < roadGraph.nodes.length; i++) {
      if (roadGraph.nodes[i].type === 'intersection' && degrees[i] > degrees[bestIdx]) {
        bestIdx = i;
      }
    }
    const center = roadGraph.nodes[bestIdx];

    // Generate circular clearing mask
    const r2 = config.radius * config.radius;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - center.x;
        const dy = y - center.y;
        if (dx * dx + dy * dy <= r2) {
          mask[y][x] = true;
        }
      }
    }
  }

  // Autotile the clearing
  const gridForAutotile = updateTerrainGrid(terrainGrid, width, height, config.id, mask);
  const matchTerrains = config.autotileAgainst.includes(config.id)
    ? config.autotileAgainst
    : [config.id, ...config.autotileAgainst];
  const tiles = autotileDispatch(
    gridForAutotile,
    matchTerrains,
    config.autotilePreset,
    rng,
    config.altCenterCount,
  );

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Road Graph Merge
// ============================================================================

/** Merge two road graphs (from multiple road/path layers). */
function mergeRoadGraphs(existing: RoadGraph | null, incoming: RoadGraph): RoadGraph {
  if (!existing) return incoming;
  const nodeOffset = existing.nodes.length;
  return {
    nodes: [...existing.nodes, ...incoming.nodes],
    edges: [
      ...existing.edges,
      ...incoming.edges.map((e) => ({ from: e.from + nodeOffset, to: e.to + nodeOffset })),
    ],
  };
}

// ============================================================================
// Cave Layer
// ============================================================================

function processCaveLayer(
  config: CaveLayerConfig,
  width: number,
  height: number,
  rng: () => number,
  terrainGrid: string[][] | null,
): LayerResult {
  const { graph, mask: tunnelMask } = generateCaveNetwork(
    width,
    height,
    config.tunnelWidth,
    config.branchCount,
    config.curvature,
    rng,
  );

  // Wall-side autotile: invert the tunnel mask so rock tiles get autotiled.
  // Rock tiles (tunnelMask=false) receive blob-47 indices based on their rock
  // neighbors — edges appear on the rock side facing inward toward carved space.
  const rockMask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rockMask[y][x] = !tunnelMask[y][x];
    }
  }

  const gridForAutotile = updateTerrainGrid(terrainGrid, width, height, config.id, rockMask);

  const matchTerrains = config.autotileAgainst.includes(config.id)
    ? config.autotileAgainst
    : [config.id, ...config.autotileAgainst];

  const tiles = autotileDispatch(
    gridForAutotile,
    matchTerrains,
    config.autotilePreset,
    rng,
    config.altCenterCount,
  );

  return {
    mask: rockMask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
    caveGraph: graph,
  };
}

/** Merge two cave graphs (from multiple cave layers). */
function mergeCaveGraphs(existing: CaveGraph | null, incoming: CaveGraph): CaveGraph {
  if (!existing) return incoming;
  const nodeOffset = existing.nodes.length;
  return {
    nodes: [...existing.nodes, ...incoming.nodes],
    edges: [
      ...existing.edges,
      ...incoming.edges.map((e) => ({ from: e.from + nodeOffset, to: e.to + nodeOffset })),
    ],
  };
}

// ============================================================================
// Rectangle Layer
// ============================================================================

function processRectangleLayer(
  config: Extract<TerrainLayerConfig, { type: 'rectangle' }>,
  width: number,
  height: number,
  rng: () => number,
): LayerResult {
  // Inset Y by 1 tile for north/south wall space. No X inset — east/west walls
  // use the grid edge directly so collision aligns with the visual boundary.
  const yInset = 1;
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  const tiles: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(-1));

  for (let y = yInset; y < height - yInset; y++) {
    for (let x = 0; x < width; x++) {
      mask[y][x] = true;
      tiles[y][x] = pickFill(config.fill, rng);
    }
  }

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// L-Shape Layer
// ============================================================================

function processLShapeLayer(
  config: Extract<TerrainLayerConfig, { type: 'l_shape' }>,
  width: number,
  height: number,
  rng: () => number,
): LayerResult {
  const inset = 1;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  const minArmWidth = config.minArmWidth;

  // L-shape: cut out a corner from the floor area.
  // Clamp cut dimensions so each remaining arm is at least minArmWidth tiles wide/tall.
  const maxCutW = innerW - minArmWidth;
  const maxCutH = innerH - minArmWidth;
  const cutWidth = Math.max(
    minArmWidth,
    Math.min(randomIntWithRng(rng, Math.floor(innerW * 0.3), Math.floor(innerW * 0.5)), maxCutW),
  );
  const cutHeight = Math.max(
    minArmWidth,
    Math.min(randomIntWithRng(rng, Math.floor(innerH * 0.3), Math.floor(innerH * 0.5)), maxCutH),
  );
  const cutCorner = randomIntWithRng(rng, 0, 3); // 0=NE, 1=NW, 2=SE, 3=SW

  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  const tiles: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(-1));

  for (let y = inset; y < height - inset; y++) {
    for (let x = inset; x < width - inset; x++) {
      const rx = x - inset;
      const ry = y - inset;
      let isCutOut = false;

      switch (cutCorner) {
        case 0: // NE
          isCutOut = rx >= innerW - cutWidth && ry < cutHeight;
          break;
        case 1: // NW
          isCutOut = rx < cutWidth && ry < cutHeight;
          break;
        case 2: // SE
          isCutOut = rx >= innerW - cutWidth && ry >= innerH - cutHeight;
          break;
        case 3: // SW
          isCutOut = rx < cutWidth && ry >= innerH - cutHeight;
          break;
      }

      if (!isCutOut) {
        mask[y][x] = true;
        tiles[y][x] = pickFill(config.fill, rng);
      }
    }
  }

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// T-Shape Layer
// ============================================================================

function processTShapeLayer(
  config: Extract<TerrainLayerConfig, { type: 't_shape' }>,
  width: number,
  height: number,
  rng: () => number,
): LayerResult {
  // Y inset only — east/west walls use grid edge (same as rectangle).
  const yInset = 1;
  const innerW = width;
  const innerH = height - yInset * 2;
  const minArmWidth = config.minArmWidth;

  // T-shape: top bar and bottom stem.
  // Clamp stem width so stem >= minArmWidth and each wing >= minArmWidth.
  // Clamp bar height so bar >= minArmWidth and stem height >= minArmWidth.
  const stemWidth = Math.max(
    minArmWidth,
    Math.min(Math.floor(innerW * 0.4), innerW - 2 * minArmWidth),
  );
  const stemStart = Math.floor((innerW - stemWidth) / 2);
  const barHeight = Math.max(minArmWidth, Math.min(Math.floor(innerH * 0.4), innerH - minArmWidth));

  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  const tiles: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(-1));

  for (let y = yInset; y < height - yInset; y++) {
    for (let x = 0; x < width; x++) {
      const rx = x;
      const ry = y - yInset;

      const inBar = ry < barHeight;
      const inStem = ry >= barHeight && rx >= stemStart && rx < stemStart + stemWidth;

      if (inBar || inStem) {
        mask[y][x] = true;
        tiles[y][x] = pickFill(config.fill, rng);
      }
    }
  }

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Wall Layer
// ============================================================================

/** Number of face tiles tall for the south-facing wall on the north side of a room. */
const WALL_FACE_HEIGHT = 3;

/**
 * Compute the Wang 2-corner key for a cell based on which corners are "room".
 * A corner is "room" (1) if the cell itself AND both adjacent cardinal neighbors
 * AND the diagonal neighbor sharing that corner are all room.
 * OOB = not room.
 *
 * Returns "TL,TR,BL,BR" string with 0/1 values.
 */
function computeRoomCornerKey(
  roomMask: boolean[][],
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const isRoom = (cx: number, cy: number): boolean =>
    cx >= 0 && cx < width && cy >= 0 && cy < height && roomMask[cy][cx];

  const TL = isRoom(x, y) && isRoom(x - 1, y) && isRoom(x, y - 1) && isRoom(x - 1, y - 1) ? 1 : 0;
  const TR = isRoom(x, y) && isRoom(x + 1, y) && isRoom(x, y - 1) && isRoom(x + 1, y - 1) ? 1 : 0;
  const BL = isRoom(x, y) && isRoom(x - 1, y) && isRoom(x, y + 1) && isRoom(x - 1, y + 1) ? 1 : 0;
  const BR = isRoom(x, y) && isRoom(x + 1, y) && isRoom(x, y + 1) && isRoom(x + 1, y + 1) ? 1 : 0;

  return `${TL},${TR},${BL},${BR}`;
}

function processWallLayer(
  config: Extract<TerrainLayerConfig, { type: 'wall' }>,
  width: number,
  height: number,
  _rng: () => number,
  previousResult: LayerResult | null,
): LayerResult {
  const style = loadFullWallStyle(config.wallStyle);

  const roomMask: boolean[][] = previousResult
    ? previousResult.mask
    : Array.from({ length: height }, () => new Array<boolean>(width).fill(false));

  // Wang 2-corner autotile — skip fully interior tiles (1,1,1,1)
  const tiles: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(-1));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cornerKey = computeRoomCornerKey(roomMask, x, y, width, height);
      if (cornerKey === '0,0,0,0' || cornerKey === '1,1,1,1') continue;
      const tileId = style.overheadTiles.get(cornerKey);
      if (tileId !== undefined) {
        tiles[y][x] = tileId;
      }
    }
  }

  // Derive mask from placed tiles — blocking matches exactly what was rendered.
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mask[y][x] = tiles[y][x] !== -1;
    }
  }

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Wall Face Layer
// ============================================================================

function processWallFaceLayer(
  config: WallFaceLayerConfig,
  width: number,
  height: number,
  layerMasks: Record<string, boolean[][]>,
): LayerResult {
  if (!(config.wallLayerId in layerMasks)) {
    throw new Error(
      `wall_face layer "${config.id}" references wallLayerId "${config.wallLayerId}" but no such layer mask exists. ` +
        `Available: [${Object.keys(layerMasks).join(', ')}]`,
    );
  }
  if (!(config.roomLayerId in layerMasks)) {
    throw new Error(
      `wall_face layer "${config.id}" references roomLayerId "${config.roomLayerId}" but no such layer mask exists. ` +
        `Available: [${Object.keys(layerMasks).join(', ')}]`,
    );
  }

  const edgeMask = layerMasks[config.wallLayerId];
  const roomMask = layerMasks[config.roomLayerId];

  const style = loadFullWallStyle(config.wallStyle);
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  const tiles: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(-1));

  // Pass 1: Build face mask — identify all positions that should have face tiles.
  const faceMask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edgeMask[y][x]) continue;
      if (y + 1 >= height || !roomMask[y + 1][x]) continue;

      for (let fy = 0; fy < WALL_FACE_HEIGHT; fy++) {
        const faceY = y + 1 + fy;
        if (faceY >= height || !roomMask[faceY][x]) break;
        faceMask[faceY][x] = true;
      }
    }
  }

  // Pass 2: Autotile lookup — compute corner key against the face mask, not the room mask.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!faceMask[y][x]) continue;
      const cornerKey = computeRoomCornerKey(faceMask, x, y, width, height);
      const tileId = style.faceTiles.get(cornerKey);
      if (tileId !== undefined) {
        tiles[y][x] = tileId;
        mask[y][x] = true;
      }
    }
  }

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Sprite Backdrop Layer
// ============================================================================

/**
 * Compute the tile offset from sprite-local coords to layout grid coords.
 * The sprite is anchored at (anchorX, anchorY) within the layout bounds.
 * Returns the top-left tile position of the sprite in layout grid space.
 */
export function computeBackdropOffset(
  anchorX: number,
  anchorY: number,
  gridWidth: number,
  gridHeight: number,
  layoutWidth: number,
  layoutHeight: number,
): { offsetCol: number; offsetRow: number } {
  return {
    offsetCol: Math.round(anchorX * layoutWidth - gridWidth / 2),
    offsetRow: Math.round(anchorY * layoutHeight - gridHeight / 2),
  };
}

/**
 * Sprite backdrop: renders a pre-composed sprite image.
 * When `unblockedTiles` is set, produces a mask marking those tiles as true so
 * the blocking system can unblock them (use with `blocking: 'unblocks'`).
 * Coordinates are converted from sprite-local space to layout grid space using
 * the anchor position and sprite grid dimensions.
 * Without `unblockedTiles`, behaves as before: empty mask, no terrain impact.
 */
function processSpriteBackdropLayer(
  config: SpriteBackdropLayerConfig,
  width: number,
  height: number,
): LayerResult {
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  const tiles: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(-1));

  // Mark unblocked tiles in the mask, converting sprite-local coords to layout grid coords
  if (config.unblockedTiles && config.gridWidth !== null && config.gridHeight !== null) {
    const { offsetCol, offsetRow } = computeBackdropOffset(
      config.anchorX,
      config.anchorY,
      config.gridWidth,
      config.gridHeight,
      width,
      height,
    );
    for (const [col, row] of config.unblockedTiles) {
      const layoutCol = col + offsetCol;
      const layoutRow = row + offsetRow;
      if (layoutRow >= 0 && layoutRow < height && layoutCol >= 0 && layoutCol < width) {
        mask[layoutRow][layoutCol] = true;
      }
    }
  }

  return {
    mask,
    tiles,
    terrainLayer: {
      id: config.id,
      tilesetId: config.tilesetId,
      tilesetOffset: 0,
      tiles,
      depth: config.renderOrder,
    },
  };
}

// ============================================================================
// Shared: Noise Helpers
// ============================================================================

/**
 * Multi-octave noise function (FBM - Fractal Brownian Motion).
 */
function fbm(
  noise: NoiseFunction2D,
  x: number,
  y: number,
  octaves: number,
  scale: number,
  persistence: number,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = scale;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise(x * frequency, y * frequency);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }

  return value / maxValue;
}

/**
 * Edge falloff for continent/nebula generation.
 * Returns 1.0 in the center, fading to 0.0 at edges.
 */
function getEdgeFalloff(x: number, y: number, width: number, height: number): number {
  const edgeMargin = Math.min(width, height) * 0.15;

  const minDistX = Math.min(x, width - 1 - x);
  const minDistY = Math.min(y, height - 1 - y);
  const minDist = Math.min(minDistX, minDistY);

  if (minDist >= edgeMargin) return 1.0;

  const t = minDist / edgeMargin;
  return t * t * (3 - 2 * t);
}

/**
 * Edge falloff that leaves one edge open.
 * Returns 1.0 in the center, fading to 0.0 at all edges except the open one.
 * This ensures the clearing extends to one map boundary for exit placement.
 */
function getEdgeFalloffOpen(
  x: number,
  y: number,
  width: number,
  height: number,
  openEdge: number,
): number {
  const edgeMargin = Math.min(width, height) * 0.15;

  // Distance from each edge
  const distN = y;
  const distS = height - 1 - y;
  const distW = x;
  const distE = width - 1 - x;

  // Collect distances, skipping the open edge
  const distances: number[] = [];
  if (openEdge !== 0) distances.push(distN);
  if (openEdge !== 1) distances.push(distE);
  if (openEdge !== 2) distances.push(distS);
  if (openEdge !== 3) distances.push(distW);

  const minDist = Math.min(...distances);

  if (minDist >= edgeMargin) return 1.0;

  const t = minDist / edgeMargin;
  return t * t * (3 - 2 * t);
}

// ============================================================================
// Shared: Autotile Dispatch
// ============================================================================

function autotileDispatch(
  terrainGrid: string[][],
  matchTerrains: string[],
  autotilePreset: AutotilePreset,
  rng?: (() => number) | null,
  altCenterCount?: number,
): number[][] {
  const autotileConfig = loadAutotileConfig(autotilePreset);

  if (autotileConfig.format === 'autotile-47') {
    if (autotileConfig.name.includes('lpc')) {
      return applyAutotile47LpcLayered(terrainGrid, matchTerrains, autotileConfig);
    }
    return applyAutotile47Layered(terrainGrid, matchTerrains, autotileConfig);
  } else if (autotileConfig.format === 'wang-2corner') {
    return applyWang2CornerLayered(terrainGrid, matchTerrains, autotileConfig);
  } else if (autotileConfig.format === 'wang-16') {
    return applyWang16LayeredAutotile(terrainGrid, matchTerrains, autotileConfig);
  } else {
    // blob-47 format — pass through RNG + altCenterCount for center tile variation
    return applyLayeredAutotile(terrainGrid, matchTerrains, autotileConfig, rng, altCenterCount);
  }
}

// ============================================================================
// Shared: Room Mask for North-Facing Wall Detection
// ============================================================================

const WALL_GROUP_TYPES = new Set(['wall', 'wall_face']);

/**
 * Build a boolean mask covering all room-interior tiles — the union of all
 * unblocking layers that are NOT wall-group types. Used by the automatic
 * north-facing wall detection to distinguish room tiles from void.
 */
function buildRoomMask(
  configs: TerrainLayerConfig[],
  layerMasks: Record<string, boolean[][]>,
  width: number,
  height: number,
): boolean[][] {
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  for (const config of configs) {
    if (config.blocking !== 'unblocks') continue;
    if (WALL_GROUP_TYPES.has(config.type)) continue;
    const lm = layerMasks[config.id];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (lm[y][x]) mask[y][x] = true;
      }
    }
  }
  return mask;
}

// ============================================================================
// Shared: Layer Avoidance
// ============================================================================

/**
 * Returns a copy of the mask with `false` for any tile whose terrain grid value
 * is listed in `avoidLayerIds`. Used to prevent road/path layers from overwriting
 * already-placed terrain such as water.
 */
function applyLayerAvoidance(
  mask: boolean[][],
  terrainGrid: string[][] | null,
  avoidLayerIds: string[] | undefined,
): boolean[][] {
  if (!terrainGrid || !avoidLayerIds || avoidLayerIds.length === 0) return mask;
  const avoidSet = new Set(avoidLayerIds);
  return mask.map((row, y) =>
    row.map((cell, x) => (cell && avoidSet.has(terrainGrid[y][x]) ? false : cell)),
  );
}

// ============================================================================
// Shared: Terrain Grid Update
// ============================================================================

function updateTerrainGrid(
  existing: string[][] | null,
  width: number,
  height: number,
  layerId: string,
  mask: boolean[][],
): string[][] {
  const grid: string[][] = existing
    ? existing.map((row) => [...row])
    : Array.from({ length: height }, () => new Array<string>(width).fill('__empty__'));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y][x]) {
        grid[y][x] = layerId;
      }
    }
  }

  return grid;
}
