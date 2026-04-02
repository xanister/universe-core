/**
 * Terrain placement algorithms
 *
 * Algorithms that place slots based on terrain type (biome/map type):
 * - open_space: place on space/starfield tiles
 * - on_land: place on land tiles
 * - on_water: place on water tiles
 * - on_coast: place on land-water boundary tiles
 */

import { type LayoutVariant, type TerrainLayerConfig } from '@dmnpc/types/world';
import {
  createRng,
  slotOccupancy,
  occupy,
  filterTilesForPlacement,
  collectPlacedPositions,
  selectByDistribution,
  getValidTiles,
} from './placement-utils.js';
import {
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
  getPlacementAlgorithm,
} from './algorithm-types.js';
import type { GeneratedShape } from './algorithm-types.js';
import { getRandomSupportedFacing } from '../object-catalog.js';

/**
 * Collect layer IDs from the variant's terrain layers matching the given terrain tag.
 * Matches the semantic terrain tag regardless of layer type.
 * Used by on_water and open_space where blocking filter isn't needed.
 */
function getLayerIdsByTerrain(
  variant: LayoutVariant,
  terrain: TerrainLayerConfig['terrain'],
): Set<string> {
  const ids = new Set<string>();
  for (const layer of variant.terrainLayers) {
    if (layer.terrain === terrain) {
      ids.add(layer.id);
    }
  }
  return ids;
}

/**
 * Collect layer IDs from the variant's terrain layers that match the terrain tag
 * AND have blocking='unblocks'. Used by on_land and on_coast to find walkable areas.
 */
function getUnblockingLayerIds(
  variant: LayoutVariant,
  terrain: TerrainLayerConfig['terrain'],
): Set<string> {
  const ids = new Set<string>();
  for (const layer of variant.terrainLayers) {
    if (layer.terrain === terrain && layer.blocking === 'unblocks') {
      ids.add(layer.id);
    }
  }
  return ids;
}

/**
 * Find all tiles whose terrain layer is in the given set of layer IDs.
 * Falls back to getValidTiles when no terrainGrid exists.
 */
function getTilesMatchingLayers(
  shape: GeneratedShape,
  layerIds: Set<string>,
): { x: number; y: number }[] {
  if (!shape.terrainGrid) {
    return getValidTiles(shape);
  }
  const tiles: { x: number; y: number }[] = [];
  const { x: ox, y: oy, width, height } = shape.bounds;
  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      const layerId = shape.terrainGrid[ly]?.[lx];
      if (layerId && layerIds.has(layerId)) {
        tiles.push({ x: ox + lx, y: oy + ly });
      }
    }
  }
  return tiles;
}

/**
 * Find tiles at the boundary of the given layer set — tiles in the set that have
 * at least one cardinal neighbor NOT in the set.
 */
function getBoundaryTiles(
  shape: GeneratedShape,
  layerIds: Set<string>,
): { x: number; y: number }[] {
  if (!shape.terrainGrid) return [];
  const { x: ox, y: oy, width, height } = shape.bounds;
  const boundary: { x: number; y: number }[] = [];

  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      const layerId = shape.terrainGrid[ly]?.[lx];
      if (!layerId || !layerIds.has(layerId)) continue;

      const hasOutsideNeighbor =
        (ly > 0 && !layerIds.has(shape.terrainGrid[ly - 1]?.[lx] ?? '')) ||
        (ly < height - 1 && !layerIds.has(shape.terrainGrid[ly + 1]?.[lx] ?? '')) ||
        (lx > 0 && !layerIds.has(shape.terrainGrid[ly]?.[lx - 1] ?? '')) ||
        (lx < width - 1 && !layerIds.has(shape.terrainGrid[ly]?.[lx + 1] ?? ''));

      if (hasOutsideNeighbor) {
        boundary.push({ x: ox + lx, y: oy + ly });
      }
    }
  }

  return boundary;
}

/**
 * Shared strategy for terrain-based placement (on_land, on_water, open_space, on_coast).
 *
 * Handles cluster/spread/default purposes using purpose sets:
 * - cluster purposes: placed near boundary tiles, grouped together
 * - spread purposes: placed with even distribution across valid tiles
 * - default purposes: placed per slot's own distribution setting
 *
 * Uses slotOccupancy() for all placement to prevent overlapping
 * collision bodies.
 */
function placeWithStrategy(
  slots: PositionedSlot['slot'][],
  validTiles: { x: number; y: number }[],
  boundaryTiles: { x: number; y: number }[],
  bounds: { x: number; y: number; width: number; height: number },
  clusterPurposes: Set<string>,
  spreadPurposes: Set<string>,
  rng: () => number,
  occupiedTiles: Set<string>,
  validTileSet?: Set<string>,
  ctxPlacedSlots?: PositionedSlot[],
): PositionedSlot[] {
  const positioned: PositionedSlot[] = [];
  let clusterCenter: { x: number; y: number } | null = null;

  for (const slot of slots) {
    const max = slot.max ?? 1;
    const primaryPurpose = slot.purpose;
    const distribution = slot.distribution;
    const occ = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      const available = filterTilesForPlacement(
        validTiles,
        bounds,
        occupiedTiles,
        occ,
        validTileSet,
      );
      if (available.length === 0) break;

      let selectedTile: { x: number; y: number };

      if (clusterPurposes.has(primaryPurpose)) {
        if (clusterCenter === null) {
          // First cluster slot: prefer boundary tiles
          const availableBoundary = filterTilesForPlacement(
            boundaryTiles,
            bounds,
            occupiedTiles,
            occ,
            validTileSet,
          );
          if (availableBoundary.length > 0) {
            const allPlaced = collectPlacedPositions(ctxPlacedSlots ?? [], positioned);
            selectedTile = selectByDistribution(availableBoundary, allPlaced, rng, distribution);
          } else {
            const allPlaced = collectPlacedPositions(ctxPlacedSlots ?? [], positioned);
            selectedTile = selectByDistribution(available, allPlaced, rng, distribution);
          }
          clusterCenter = selectedTile;
        } else {
          // Subsequent cluster slots: near cluster center
          const nearbyTiles = available.filter(
            (t) =>
              Math.sqrt(
                (t.x - clusterCenter!.x) * (t.x - clusterCenter!.x) +
                  (t.y - clusterCenter!.y) * (t.y - clusterCenter!.y),
              ) < 15,
          );
          if (nearbyTiles.length > 0) {
            const allPlaced = collectPlacedPositions(ctxPlacedSlots ?? [], positioned);
            selectedTile = selectByDistribution(nearbyTiles, allPlaced, rng, distribution);
          } else {
            const sorted = [...available].sort(
              (a, b) =>
                Math.sqrt(
                  (a.x - clusterCenter!.x) * (a.x - clusterCenter!.x) +
                    (a.y - clusterCenter!.y) * (a.y - clusterCenter!.y),
                ) -
                Math.sqrt(
                  (b.x - clusterCenter!.x) * (b.x - clusterCenter!.x) +
                    (b.y - clusterCenter!.y) * (b.y - clusterCenter!.y),
                ),
            );
            selectedTile = sorted[0];
          }
        }
      } else if (spreadPurposes.has(primaryPurpose)) {
        // Spread purposes use 'even' distribution regardless of slot setting
        const allPlaced = collectPlacedPositions(ctxPlacedSlots ?? [], positioned);
        selectedTile = selectByDistribution(available, allPlaced, rng, 'even');
      } else {
        const allPlaced = collectPlacedPositions(ctxPlacedSlots ?? [], positioned);
        selectedTile = selectByDistribution(available, allPlaced, rng, distribution);
      }

      const facing = getRandomSupportedFacing(slot.purpose, rng, slot.requiredTags ?? undefined);
      positioned.push({
        slot,
        x: selectedTile.x,
        y: selectedTile.y,
        width: occ.w,
        height: occ.h,
        facing,
        layer: 'default',
      });
      occupy(occupiedTiles, selectedTile.x, selectedTile.y, occ);
    }
  }

  return positioned;
}

/** Purposes that cluster near feature boundaries in space */
const SPACE_CLUSTER_PURPOSES = new Set(['star_system', 'spaceport', 'station', 'planet']);

/** Purposes that spread across open space */
const SPACE_SPREAD_PURPOSES = new Set(['asteroid']);

/**
 * Open-space placement for space maps (cosmos, star_system).
 *
 * Reads the variant's terrain layers to find space-terrain layers (starfield, etc.).
 * Places slots on tiles matching those layers, avoiding feature layers (nebula).
 * Clusters space-urban purposes near nebula boundaries, spreads wilderness.
 * Uses terrain tag 'space' (no blocking filter — vessel movement profiles govern passability).
 */
export const openSpacePlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  const spaceLayerIds = getLayerIdsByTerrain(variant, 'space');
  const openTiles = getTilesMatchingLayers(shape, spaceLayerIds);

  if (openTiles.length === 0) {
    return [];
  }

  const boundaryTiles = getBoundaryTiles(shape, spaceLayerIds);
  const validTileSet = new Set(openTiles.map((t) => `${t.x},${t.y}`));

  return placeWithStrategy(
    slots,
    openTiles,
    boundaryTiles,
    placementBounds,
    SPACE_CLUSTER_PURPOSES,
    SPACE_SPREAD_PURPOSES,
    rng,
    occupiedTiles,
    validTileSet,
    placedSlots,
  );
};

/** Purposes that cluster near coastlines on land */
const LAND_CLUSTER_PURPOSES = new Set(['city', 'harbor', 'station', 'spaceport']);

/** Purposes that spread across the landscape */
const LAND_SPREAD_PURPOSES = new Set([
  'forest',
  'cave',
  'ruins',
  'mountain',
  'lake',
  'swamp',
  'desert',
  'coast',
  'plains',
]);

/**
 * On-land placement for world/planet maps.
 *
 * Reads the variant's terrain layers to find unblocking land layers.
 * Places slots on tiles matching those layers, avoiding ocean.
 * Clusters urban purposes near coastlines, spreads wilderness.
 * Uses terrain tag 'land' + blocking 'unblocks' to find placeable areas.
 */
export const onLandPlacement: PlacementAlgorithmFn = (ctx: PlacementContext): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  const landLayerIds = getUnblockingLayerIds(variant, 'land');
  const landTiles = getTilesMatchingLayers(shape, landLayerIds);

  if (landTiles.length === 0) {
    return [];
  }

  const coastalTiles = getBoundaryTiles(shape, landLayerIds);
  const validTileSet = new Set(landTiles.map((t) => `${t.x},${t.y}`));

  return placeWithStrategy(
    slots,
    landTiles,
    coastalTiles,
    placementBounds,
    LAND_CLUSTER_PURPOSES,
    LAND_SPREAD_PURPOSES,
    rng,
    occupiedTiles,
    validTileSet,
    placedSlots,
  );
};

/** Purposes that cluster together along the coastline on water (ports, harbors, docks) */
const WATER_CLUSTER_PURPOSES = new Set(['harbor']);

/** Purposes that spread across open water */
const WATER_SPREAD_PURPOSES = new Set<string>([]);

/**
 * On-water placement for ocean/lake maps.
 *
 * Reads the variant's terrain layers to find layers tagged with `terrain: "water"`.
 * Places slots on tiles matching those water layers.
 * Clusters coastal purposes (ports, docks) near land-water boundaries,
 * spreads open-water purposes across the water surface.
 */
export const onWaterPlacement: PlacementAlgorithmFn = (ctx: PlacementContext): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  const waterLayerIds = getLayerIdsByTerrain(variant, 'water');
  const waterTiles = getTilesMatchingLayers(shape, waterLayerIds);

  if (waterTiles.length === 0) {
    return [];
  }

  const coastlineTiles = getBoundaryTiles(shape, waterLayerIds);
  const validTileSet = new Set(waterTiles.map((t) => `${t.x},${t.y}`));

  return placeWithStrategy(
    slots,
    waterTiles,
    coastlineTiles,
    placementBounds,
    WATER_CLUSTER_PURPOSES,
    WATER_SPREAD_PURPOSES,
    rng,
    occupiedTiles,
    validTileSet,
    placedSlots,
  );
};

/** Purposes that cluster together along the coastline */
const COAST_CLUSTER_PURPOSES = new Set([
  'pier',
  'harbor',
  'port',
  'marina',
  'floating_market',
  'bridge',
  'gangplank',
]);

/** Purposes that spread out along the coastline */
const COAST_SPREAD_PURPOSES = new Set(['lighthouse', 'watchtower', 'beacon']);

/**
 * Pier-end placement — places slots at the northernmost tip of the pier.
 *
 * Scans the terrainGrid for tiles attributed to a layer with id='pier'
 * (painted by buildPierLayer from FEAT-480) and places the slot at the
 * northernmost pier tile, where ships actually moor.
 *
 * Coupling: buildPierLayer (FEAT-480) MUST paint its tiles with layer id='pier'.
 * If the id changes, this algorithm silently degrades to random_valid fallback.
 *
 * Fallback: when no pier layer exists in the variant or no pier tiles are
 * found in the grid, delegates to random_valid so the harbor still generates.
 */
export const pierEndPlacement: PlacementAlgorithmFn = (ctx: PlacementContext): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placementBounds } = ctx;

  const hasPierLayer = variant.terrainLayers.some((l) => l.id === 'pier');
  if (!hasPierLayer || !shape.terrainGrid) {
    const fallback = getPlacementAlgorithm('random_valid');
    if (!fallback) throw new Error('pier_end: random_valid fallback not registered');
    return fallback(ctx);
  }

  // Collect all tiles painted by the pier layer
  const { x: ox, y: oy, width, height } = shape.bounds;
  const pierTiles: { x: number; y: number }[] = [];
  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      if (shape.terrainGrid[ly]?.[lx] === 'pier') {
        pierTiles.push({ x: ox + lx, y: oy + ly });
      }
    }
  }

  if (pierTiles.length === 0) {
    const fallback = getPlacementAlgorithm('random_valid');
    if (!fallback) throw new Error('pier_end: random_valid fallback not registered');
    return fallback(ctx);
  }

  // Sort northernmost first (ascending y), then ascending x for determinism
  pierTiles.sort((a, b) => a.y - b.y || a.x - b.x);

  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];

  for (const slot of slots) {
    const occ = slotOccupancy(slot);
    const max = slot.max ?? 1;

    for (let i = 0; i < max; i++) {
      const available = filterTilesForPlacement(pierTiles, placementBounds, occupiedTiles, occ);
      if (available.length === 0) break;

      // Take the northernmost available pier tile (list is sorted, filter preserves order)
      const tile = available[0];
      const facing = getRandomSupportedFacing(slot.purpose, rng, slot.requiredTags ?? undefined);
      positioned.push({
        slot,
        x: tile.x,
        y: tile.y,
        width: occ.w,
        height: occ.h,
        facing,
        layer: 'default',
      });
      occupy(occupiedTiles, tile.x, tile.y, occ);
    }
  }

  return positioned;
};

/**
 * On-coast placement for land-water boundary tiles.
 *
 * Reads the variant's terrain layers to find continent-type layers (land).
 * Places slots on land tiles that are adjacent to non-land tiles (coastline).
 * Clusters port/dock purposes together, spreads lighthouse/watchtower purposes.
 */
export const onCoastPlacement: PlacementAlgorithmFn = (ctx: PlacementContext): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  const landLayerIds = getUnblockingLayerIds(variant, 'land');
  const coastlineTiles = getBoundaryTiles(shape, landLayerIds);

  if (coastlineTiles.length === 0) {
    return [];
  }

  // For on_coast, valid tiles ARE the coastline tiles.
  // Boundary tiles are the same set (used for initial cluster anchor).
  const validTileSet = new Set(coastlineTiles.map((t) => `${t.x},${t.y}`));

  return placeWithStrategy(
    slots,
    coastlineTiles,
    coastlineTiles,
    placementBounds,
    COAST_CLUSTER_PURPOSES,
    COAST_SPREAD_PURPOSES,
    rng,
    occupiedTiles,
    validTileSet,
    placedSlots,
  );
};
