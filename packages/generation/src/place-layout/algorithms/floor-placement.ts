/**
 * Floor placement algorithms
 *
 * Algorithms that place slots on passable floor tiles:
 * - random_valid: scatter across valid floor space
 * - clustered: group related slots together
 * - near_slot: place near a previously-placed slot
 * - center_floor: place toward the center of the room
 * - under: place beneath furniture (for rugs, floor mats)
 */

import { randomIntWithRng } from '@dmnpc/core/infra/random-utils.js';
import {
  createRng,
  slotOccupancy,
  occupy,
  filterTilesForPlacement,
  getWalkableLayerIds,
  getValidTiles,
  computeFacingToward,
  collectPlacedPositions,
  selectByDistribution,
  distance,
  type Occupancy,
} from './placement-utils.js';
import {
  getFloorTileSet,
  getWallAdjacentFloorTiles,
  resolveWallFaceMask,
} from './placement-tile-sets.js';
import {
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
} from './algorithm-types.js';
import type { GeneratedShape } from './algorithm-types.js';
import { getRandomSupportedFacing } from '../object-catalog.js';

/**
 * Random valid placement - places slots randomly on passable tiles.
 * No grouping, no zones. Simple scatter across valid floor space.
 */
export const randomValidPlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];
  const walkableLayerIds = getWalkableLayerIds(variant);
  const validTiles = getValidTiles(shape, walkableLayerIds);
  const validTileSet = new Set(validTiles.map((t) => `${t.x},${t.y}`));

  for (const slot of slots) {
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;
    const distribution = slot.distribution;
    const occ = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      const available = filterTilesForPlacement(
        validTiles,
        placementBounds,
        occupiedTiles,
        occ,
        validTileSet,
      );
      if (available.length === 0) {
        if (i < min) {
          throw new Error(
            `Cannot place required slot (purpose: ${slot.purpose}, ${i + 1}/${min} min): no passable tiles available`,
          );
        }
        break;
      }

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const tile = selectByDistribution(available, allPlaced, rng, distribution);

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
 * Clustered placement - groups related slots together.
 */
export const clusteredPlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];
  const walkableLayerIds = getWalkableLayerIds(variant);
  const validTiles = getValidTiles(shape, walkableLayerIds);

  const groups: Map<string, typeof slots> = new Map();
  for (const slot of slots) {
    const primaryPurpose = slot.purpose;
    const existing = groups.get(primaryPurpose) ?? [];
    existing.push(slot);
    groups.set(primaryPurpose, existing);
  }

  const validTileSet = new Set(validTiles.map((t) => `${t.x},${t.y}`));

  for (const [_purpose, groupSlots] of groups) {
    // Use first slot's occupancy for the cluster center search
    const firstOcc = slotOccupancy(groupSlots[0]);
    const available = filterTilesForPlacement(
      validTiles,
      placementBounds,
      occupiedTiles,
      firstOcc,
      validTileSet,
    );
    if (available.length === 0) continue;

    const centerIdx = randomIntWithRng(rng, 0, available.length - 1);
    const center = available[centerIdx];

    for (const slot of groupSlots) {
      const max = slot.max ?? 1;
      const distribution = slot.distribution;
      const occ = slotOccupancy(slot);

      for (let i = 0; i < max; i++) {
        const nearbyTiles = filterTilesForPlacement(
          validTiles,
          placementBounds,
          occupiedTiles,
          occ,
          validTileSet,
        ).filter((t) => {
          const dx = t.x - center.x;
          const dy = t.y - center.y;
          return Math.sqrt(dx * dx + dy * dy) < 5;
        });

        const tilesToUse =
          nearbyTiles.length > 0
            ? nearbyTiles
            : filterTilesForPlacement(
                validTiles,
                placementBounds,
                occupiedTiles,
                occ,
                validTileSet,
              );
        if (tilesToUse.length === 0) break;

        const allPlaced = collectPlacedPositions(placedSlots, positioned);
        const tile = selectByDistribution(tilesToUse, allPlaced, rng, distribution);

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
  }

  return positioned;
};

/**
 * Collect unblocked tiles within a given Chebyshev distance of any anchor slot.
 * Uses the blockedMask directly instead of requiring floor tiles from an unblocking layer,
 * so it works for any layout structure (including layouts without explicit unblocking layers).
 * When walkableLayerIds is provided, also checks terrain passability (BUG-106).
 */
function collectNearbyUnblockedTiles(
  anchors: PositionedSlot[],
  radius: number,
  shape: GeneratedShape,
  walkableLayerIds?: Set<string>,
): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  const { bounds, blockedMask } = shape;
  for (const anchor of anchors) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = anchor.x + dx;
        const ty = anchor.y + dy;
        const key = `${tx},${ty}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lx = tx - bounds.x;
        const ly = ty - bounds.y;
        if (lx < 0 || lx >= bounds.width || ly < 0 || ly >= bounds.height) continue;
        if (blockedMask[ly]?.[lx]) continue;
        // Terrain passability check (BUG-106)
        if (walkableLayerIds && shape.terrainGrid) {
          const layerId = shape.terrainGrid[ly]?.[lx];
          if (!walkableLayerIds.has(layerId)) continue;
        }
        tiles.push({ x: tx, y: ty });
      }
    }
  }
  return tiles;
}

/** Initial Chebyshev search radius for near_slot placement. */
const INITIAL_NEAR_DISTANCE = 2;
/** Maximum Chebyshev search radius before giving up (BUG-077). */
const MAX_NEAR_DISTANCE = 5;

/**
 * Near-slot placement - places slots near a previously-placed slot matching nearPurpose.
 * Used for spatial relationships: nightstand near bed, chair near desk.
 *
 * Searches placedSlots for any slot whose purposes include the configured nearPurpose.
 * Starts at Chebyshev distance 2 and expands up to MAX_NEAR_DISTANCE if the initial
 * radius is fully occupied (BUG-077: tight layouts like tapered ship hulls).
 */
export const nearSlotPlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];
  const walkableLayerIds = getWalkableLayerIds(variant);

  for (const slot of slots) {
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;
    const nearPurpose = slot.nearPurpose;
    const distribution = slot.distribution;

    const anchors = nearPurpose ? placedSlots.filter((ps) => ps.slot.purpose === nearPurpose) : [];

    if (anchors.length === 0) {
      if (min > 0 && nearPurpose) {
        throw new Error(
          `Cannot place required near_slot slot (purpose: ${slot.purpose}): no placed slot with purpose "${nearPurpose}" found. Ensure the anchor slot appears earlier in the template.`,
        );
      }
      // Optional slot with no anchor — skip gracefully
      continue;
    }

    const occ = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      // Try expanding radii until we find an available tile (BUG-077)
      let available: { x: number; y: number }[] = [];
      const startRadius = slot.flags.facesAnchor ? 1 : INITIAL_NEAR_DISTANCE;
      for (let radius = startRadius; radius <= MAX_NEAR_DISTANCE; radius++) {
        const nearbyTiles = collectNearbyUnblockedTiles(anchors, radius, shape, walkableLayerIds);
        // Filter using full occupancy block, not just top-left tile
        available = filterTilesForPlacement(nearbyTiles, shape.bounds, occupiedTiles, occ);
        if (available.length > 0) break;
      }

      if (available.length === 0) {
        if (i < min) {
          throw new Error(
            `Cannot place required near_slot slot (purpose: ${slot.purpose}, ${i + 1}/${min} min): no available unblocked tiles near "${nearPurpose}"`,
          );
        }
        break;
      }

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const tile = selectByDistribution(available, allPlaced, rng, distribution);

      let facing: 'north' | 'south' | 'east' | 'west';
      if (slot.flags.facesAnchor && anchors.length > 0) {
        let nearest = anchors[0];
        let nearestCx = nearest.x + nearest.width / 2;
        let nearestCy = nearest.y + nearest.height / 2;
        let bestDist = Math.max(Math.abs(tile.x - nearestCx), Math.abs(tile.y - nearestCy));
        for (let a = 1; a < anchors.length; a++) {
          const cx = anchors[a].x + anchors[a].width / 2;
          const cy = anchors[a].y + anchors[a].height / 2;
          const dist = Math.max(Math.abs(tile.x - cx), Math.abs(tile.y - cy));
          if (dist < bestDist) {
            bestDist = dist;
            nearest = anchors[a];
            nearestCx = cx;
            nearestCy = cy;
          }
        }
        facing = computeFacingToward(tile.x, tile.y, nearestCx, nearestCy);
      } else {
        facing = getRandomSupportedFacing(slot.purpose, rng, slot.requiredTags ?? undefined);
      }
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
 * Center-floor placement - places slots toward the center of the room, away from walls.
 * Used for rugs, central tables, and focal pieces.
 *
 * Valid tiles are floor tiles NOT adjacent to any wall tile.
 * Selection is weighted toward the centroid of the floor area.
 */
export const centerFloorPlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];
  const floorTileSet = getFloorTileSet(shape, variant);
  const wallAdjacentSet = new Set(
    getWallAdjacentFloorTiles(shape, variant).map((t) => `${t.x},${t.y}`),
  );

  const centerTiles: { x: number; y: number }[] = [];
  for (const key of floorTileSet) {
    if (!wallAdjacentSet.has(key)) {
      const [wxStr, wyStr] = key.split(',');
      centerTiles.push({ x: Number(wxStr), y: Number(wyStr) });
    }
  }

  // If no center tiles (very small room), fall back to all floor tiles
  const candidateTiles =
    centerTiles.length > 0
      ? centerTiles
      : [...floorTileSet].map((key) => {
          const [wxStr, wyStr] = key.split(',');
          return { x: Number(wxStr), y: Number(wyStr) };
        });

  if (candidateTiles.length === 0) {
    return [];
  }

  let sumX = 0;
  let sumY = 0;
  for (const t of candidateTiles) {
    sumX += t.x;
    sumY += t.y;
  }
  const centroidX = sumX / candidateTiles.length;
  const centroidY = sumY / candidateTiles.length;

  const sorted = [...candidateTiles].sort((a, b) => {
    const da = distance(a, { x: centroidX, y: centroidY });
    const db = distance(b, { x: centroidX, y: centroidY });
    return da - db;
  });

  for (const slot of slots) {
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;
    const distribution = slot.distribution;
    const occ = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      const available = filterTilesForPlacement(
        sorted,
        placementBounds,
        occupiedTiles,
        occ,
        floorTileSet,
      );
      if (available.length === 0) {
        if (i < min) {
          throw new Error(
            `Cannot place required center_floor slot (purpose: ${slot.purpose}, ${i + 1}/${min} min): no center floor tiles available`,
          );
        }
        break;
      }

      // Pick from the top 30% closest to centroid (or at least 1 tile)
      const topCount = Math.max(1, Math.floor(available.length * 0.3));
      const topTiles = available.slice(0, topCount);

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const tile = selectByDistribution(topTiles, allPlaced, rng, distribution);

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
 * Under placement - places slots on tiles already occupied by furniture, so the
 * object renders beneath the furniture above it. Intended for rugs, floor mats,
 * and other floor coverings.
 *
 * Key properties:
 * - Prefers tiles already in occupiedTiles (furniture is present). Falls back to
 *   non-wall-adjacent center tiles when no occupied tiles exist yet.
 * - Does NOT add to occupiedTiles after placing — furniture and other objects can
 *   still be placed on the same tiles.
 * - Always runs last (generator sorts 'under' slots after all others) so it can
 *   see the full occupiedTiles set from prior placement passes.
 * - Footprint size is derived from the actual sprite dimensions in the object
 *   catalog — no hardcoded tile counts.
 */
export const underPlacement: PlacementAlgorithmFn = (ctx: PlacementContext): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];
  const floorTileSet = getFloorTileSet(shape, variant);
  const wallFaceMask = resolveWallFaceMask(shape, variant);

  // Track all footprint tiles used by rugs in this call.
  // Prevents rug-on-rug overlap both within a single slot and across multiple slots.
  const localOccupied = new Set<string>();

  /**
   * True when the single tile at (wx, wy) is safe: unblocked, not a wall face
   * tile, and not immediately below a wall face tile (visual overlap strip).
   */
  const tileValid = (wx: number, wy: number): boolean => {
    const lx = wx - shape.bounds.x;
    const ly = wy - shape.bounds.y;
    if (shape.blockedMask[ly]?.[lx] === true) return false;
    if (wallFaceMask?.[ly]?.[lx] === true) return false;
    if (ly > 0 && wallFaceMask?.[ly - 1]?.[lx] === true) return false;
    return true;
  };

  /**
   * True when every tile in the sprite's visual footprint at anchor (wx, wy) is
   * within bounds, in floorTileSet, and passes tileValid().
   *
   * Sprites use setOrigin(0.5, 1): bottom-center anchored. A 3×3 sprite anchored
   * at tile (wx, wy) renders:
   *   x: wx - floor(occ.w/2)  to  wx - floor(occ.w/2) + occ.w - 1
   *   y: wy - occ.h + 1        to  wy
   */
  const footprintValid = (wx: number, wy: number, occ: Occupancy): boolean => {
    const startX = wx - Math.floor(occ.w / 2);
    const startY = wy - occ.h + 1;
    if (startX < shape.bounds.x) return false;
    if (startX + occ.w > shape.bounds.x + shape.bounds.width) return false;
    if (startY < shape.bounds.y) return false;
    for (let dy = 0; dy < occ.h; dy++) {
      for (let dx = 0; dx < occ.w; dx++) {
        const tx = startX + dx;
        const ty = startY + dy;
        if (!floorTileSet.has(`${tx},${ty}`)) return false;
        if (!tileValid(tx, ty)) return false;
        if (localOccupied.has(`${tx},${ty}`)) return false;
      }
    }
    return true;
  };

  // Build candidate pools with a per-tile validity check only. Full footprint
  // validation is deferred to the per-slot loop where occ is known.
  const occupiedFloorTiles: { x: number; y: number }[] = [];
  for (const key of occupiedTiles) {
    if (floorTileSet.has(key)) {
      const [wxStr, wyStr] = key.split(',');
      const wx = Number(wxStr);
      const wy = Number(wyStr);
      if (tileValid(wx, wy)) occupiedFloorTiles.push({ x: wx, y: wy });
    }
  }

  const wallAdjacentSet = new Set(
    getWallAdjacentFloorTiles(shape, variant).map((t) => `${t.x},${t.y}`),
  );
  const centerTiles: { x: number; y: number }[] = [];
  for (const key of floorTileSet) {
    if (!wallAdjacentSet.has(key)) {
      const [wxStr, wyStr] = key.split(',');
      const wx = Number(wxStr);
      const wy = Number(wyStr);
      if (tileValid(wx, wy)) centerTiles.push({ x: wx, y: wy });
    }
  }
  const fallbackTiles =
    centerTiles.length > 0
      ? centerTiles
      : [...floorTileSet]
          .map((key) => {
            const [wxStr, wyStr] = key.split(',');
            return { x: Number(wxStr), y: Number(wyStr) };
          })
          .filter((t) => tileValid(t.x, t.y));

  const candidateTiles = occupiedFloorTiles.length > 0 ? occupiedFloorTiles : fallbackTiles;
  if (candidateTiles.length === 0) return [];

  for (const slot of slots) {
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;
    const distribution = slot.distribution;
    const slotOcc = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      const available = candidateTiles.filter(
        (t) => !localOccupied.has(`${t.x},${t.y}`) && footprintValid(t.x, t.y, slotOcc),
      );
      if (available.length === 0) {
        if (i < min) {
          throw new Error(
            `Cannot place required under slot (purpose: ${slot.purpose}, ${i + 1}/${min} min): no valid floor tiles available`,
          );
        }
        break;
      }

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const tile = selectByDistribution(available, allPlaced, rng, distribution);

      const facing = getRandomSupportedFacing(slot.purpose, rng, slot.requiredTags ?? undefined);
      positioned.push({
        slot,
        x: tile.x,
        y: tile.y,
        width: 1,
        height: 1,
        facing,
        layer: 'floor',
      });

      // Record all footprint tiles so no subsequent rug can overlap.
      const fStartX = tile.x - Math.floor(slotOcc.w / 2);
      const fStartY = tile.y - slotOcc.h + 1;
      for (let dy = 0; dy < slotOcc.h; dy++) {
        for (let dx = 0; dx < slotOcc.w; dx++) {
          localOccupied.add(`${fStartX + dx},${fStartY + dy}`);
        }
      }
      // Intentionally do NOT call occupy() — rugs do not block other object placement.
    }
  }

  return positioned;
};
