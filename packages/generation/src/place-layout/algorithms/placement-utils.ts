/**
 * Shared placement utilities
 *
 * Math, tile filtering, distribution selection, and walkability helpers
 * used by all placement algorithm modules.
 */

import { randomIntWithRng } from '@dmnpc/core/infra/random-utils.js';
import {
  type LayoutVariant,
  type SlotDistribution,
  type ResolvedDistrict,
  resolveTerrainCost,
  WALKING_PROFILE,
} from '@dmnpc/types/world';
import type { LayoutSlot } from '../layout-templates.js';
import type { GeneratedShape, PositionedSlot } from './algorithm-types.js';

export function createRng(seed: number): () => number {
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
 * Occupancy block size derived from slot's resolved slotSize.
 * Placement algorithms reserve a contiguous block of this size
 * to prevent object overlap and ensure player interaction access.
 */
export interface Occupancy {
  w: number;
  h: number;
}

/**
 * Derive occupancy from a slot's resolved slotSize.
 * Throws if slotSize is null — resolveSlotSizes must run before placement.
 */
export function slotOccupancy(slot: LayoutSlot): Occupancy {
  if (!slot.slotSize) {
    throw new Error(
      `slotOccupancy: slot "${slot.purpose}" has null slotSize. ` +
        `resolveSlotSizes must run before placement algorithms.`,
    );
  }
  return { w: slot.slotSize.width, h: slot.slotSize.height };
}

/**
 * Mark all tiles covered by an occupancy block as occupied.
 */
export function occupy(occupiedTiles: Set<string>, x: number, y: number, occ: Occupancy): void {
  for (let dy = 0; dy < occ.h; dy++) {
    for (let dx = 0; dx < occ.w; dx++) {
      occupiedTiles.add(`${x + dx},${y + dy}`);
    }
  }
}

/**
 * Check if an occupancy block is fully available (no tile in the block is occupied).
 */
export function isBlockAvailable(
  occupiedTiles: Set<string>,
  x: number,
  y: number,
  occ: Occupancy,
): boolean {
  for (let dy = 0; dy < occ.h; dy++) {
    for (let dx = 0; dx < occ.w; dx++) {
      if (occupiedTiles.has(`${x + dx},${y + dy}`)) return false;
    }
  }
  return true;
}

/**
 * BUG-180: Check that at least one tile in the occupancy block has a cardinal
 * neighbor in the floor tile set. Prevents wall objects from being placed on
 * boundary tiles with no walkable approach (e.g. room corners where room and
 * wall masks overlap but no adjacent floor exists).
 */
export function hasAdjacentFloor(
  x: number,
  y: number,
  occ: Occupancy,
  floorTileSet: Set<string>,
): boolean {
  for (let dy = 0; dy < occ.h; dy++) {
    for (let dx = 0; dx < occ.w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (
        floorTileSet.has(`${tx},${ty - 1}`) ||
        floorTileSet.has(`${tx},${ty + 1}`) ||
        floorTileSet.has(`${tx - 1},${ty}`) ||
        floorTileSet.has(`${tx + 1},${ty}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Filter tiles to those where the occupancy block fits within bounds, is fully
 * within validTileSet (if provided), and is fully available.
 */
export function filterTilesForPlacement(
  tiles: { x: number; y: number }[],
  bounds: { x: number; y: number; width: number; height: number },
  occupiedTiles: Set<string>,
  occ: Occupancy,
  validTileSet?: Set<string>,
): { x: number; y: number }[] {
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width - occ.w;
  const maxY = bounds.y + bounds.height - occ.h;
  return tiles.filter((t) => {
    if (t.x < minX || t.y < minY || t.x > maxX || t.y > maxY) return false;
    if (!isBlockAvailable(occupiedTiles, t.x, t.y, occ)) return false;
    if (validTileSet) {
      for (let dy = 0; dy < occ.h; dy++) {
        for (let dx = 0; dx < occ.w; dx++) {
          if (!validTileSet.has(`${t.x + dx},${t.y + dy}`)) return false;
        }
      }
    }
    return true;
  });
}

/**
 * Build a set of layer IDs whose terrain is walkable per WALKING_PROFILE.
 * Used to filter placement tiles by terrain passability (BUG-106).
 */
export function getWalkableLayerIds(variant: LayoutVariant): Set<string> {
  const walkable = new Set<string>();
  for (const layer of variant.terrainLayers) {
    const cost = resolveTerrainCost(layer.terrain, WALKING_PROFILE);
    if (cost !== null) walkable.add(layer.id);
  }
  return walkable;
}

/**
 * Find passable tiles in the shape using the blocked mask.
 * A tile is valid if it is within bounds and not blocked.
 * When walkableLayerIds is provided, also checks that the tile's terrain
 * layer is walkable per WALKING_PROFILE (BUG-106: prevents placement on
 * tiles with impassable terrain tags like wall, water, void).
 */
export function getValidTiles(
  shape: GeneratedShape,
  walkableLayerIds?: Set<string>,
): { x: number; y: number }[] {
  const valid: { x: number; y: number }[] = [];
  const { width, height } = shape.bounds;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (shape.blockedMask[y]?.[x]) continue;
      // Terrain passability check (BUG-106)
      if (walkableLayerIds && shape.terrainGrid) {
        const layerId = shape.terrainGrid[y]?.[x];
        if (!walkableLayerIds.has(layerId)) continue;
      }
      valid.push({ x: shape.bounds.x + x, y: shape.bounds.y + y });
    }
  }
  return valid;
}

/**
 * Compute the cardinal direction from (fromX, fromY) toward (toX, toY).
 * When the angle is exactly diagonal, prefers east/west over north/south
 * (arbitrary tiebreak consistent with typical 2D game conventions).
 */
export function computeFacingToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): 'north' | 'south' | 'east' | 'west' {
  const dx = toX - fromX;
  const dy = toY - fromY;

  // Same tile — default south (facing camera)
  if (dx === 0 && dy === 0) return 'south';

  // Prefer horizontal when magnitudes are equal (tiebreak)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'east' : 'west';
  }
  // Screen y increases downward: positive dy = south, negative dy = north
  return dy > 0 ? 'south' : 'north';
}

/**
 * Build the list of all placed positions from context + algorithm-local placements.
 * Used by selectByDistribution to compute distances from already-placed objects.
 */
export function collectPlacedPositions(
  ctxPlacedSlots: PositionedSlot[],
  localPositioned: PositionedSlot[],
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  for (const ps of ctxPlacedSlots) {
    positions.push({ x: ps.x, y: ps.y });
  }
  for (const ps of localPositioned) {
    positions.push({ x: ps.x, y: ps.y });
  }
  return positions;
}

/**
 * Calculate distance between two points.
 */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Select a tile from available candidates using the slot's distribution mode.
 *
 * - 'even': quadratic weight favoring tiles farther from placed objects
 * - 'random': uniform random (no spatial bias)
 * - 'clumped': quadratic weight favoring tiles closer to placed objects
 *
 * Falls back to uniform random when no placed objects exist or only 1 candidate.
 */
export function selectByDistribution<T extends { x: number; y: number }>(
  available: T[],
  allPlaced: { x: number; y: number }[],
  rng: () => number,
  distribution: SlotDistribution,
): T {
  if (distribution === 'random' || allPlaced.length === 0 || available.length <= 1) {
    return available[randomIntWithRng(rng, 0, available.length - 1)];
  }

  const weights: number[] = new Array<number>(available.length);
  for (let i = 0; i < available.length; i++) {
    let minDist = Infinity;
    for (const placed of allPlaced) {
      const d = distance(available[i], placed);
      if (d < minDist) minDist = d;
    }

    if (distribution === 'even') {
      // Quadratic preference for farther tiles
      weights[i] = (minDist + 1) * (minDist + 1);
    } else {
      // 'clumped': quadratic preference for closer tiles
      weights[i] = 1 / ((minDist + 1) * (minDist + 1));
    }
  }

  let totalWeight = 0;
  for (const w of weights) totalWeight += w;
  let pick = rng() * totalWeight;
  for (let i = 0; i < available.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return available[i];
  }

  return available[available.length - 1];
}

/**
 * Select a candidate tile using combined distribution + district weighting.
 *
 * When a district is specified, each candidate's weight is multiplied by
 * an inverse-distance factor: `1 / (1 + (dist / radius)²)`.
 * This biases selection toward the district center while preserving
 * the existing even/random/clumped spatial distribution.
 */
export function selectByDistributionWithDistrict<T extends { x: number; y: number }>(
  available: T[],
  allPlaced: { x: number; y: number }[],
  rng: () => number,
  distribution: SlotDistribution,
  district: ResolvedDistrict | null,
): T {
  // No district bias or trivial cases → fall through to standard selection
  if (!district || available.length <= 1) {
    return selectByDistribution(available, allPlaced, rng, distribution);
  }

  const weights: number[] = new Array<number>(available.length);
  for (let i = 0; i < available.length; i++) {
    let distWeight = 1;
    if (distribution !== 'random' && allPlaced.length > 0) {
      let minDist = Infinity;
      for (const placed of allPlaced) {
        const d = distance(available[i], placed);
        if (d < minDist) minDist = d;
      }
      if (distribution === 'even') {
        distWeight = (minDist + 1) * (minDist + 1);
      } else {
        distWeight = 1 / ((minDist + 1) * (minDist + 1));
      }
    }

    // District bias: quadratic decay from center
    const dx = available[i].x - district.center.x;
    const dy = available[i].y - district.center.y;
    const tileDist = Math.sqrt(dx * dx + dy * dy);
    const normalized = tileDist / district.influenceRadius;
    const districtBias = 1 / (1 + normalized * normalized);

    // Combine: lerp between unbiased and biased based on district.weight
    // weight=0 → pure distribution, weight=1 → full district bias
    weights[i] = distWeight * (1 - district.weight + district.weight * districtBias);
  }

  let totalWeight = 0;
  for (const w of weights) totalWeight += w;
  let pick = rng() * totalWeight;
  for (let i = 0; i < available.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return available[i];
  }
  return available[available.length - 1];
}
