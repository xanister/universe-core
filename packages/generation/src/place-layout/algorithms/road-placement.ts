/**
 * Road placement algorithms
 *
 * Algorithms that place slots relative to road and path tiles:
 * - along_road: place buildings fronting onto roads
 * - road_intersection: place at or near road junctions
 * - road_end: place at road terminus points
 */

import { type LayoutVariant } from '@dmnpc/types/world';
import {
  createRng,
  slotOccupancy,
  occupy,
  filterTilesForPlacement,
  collectPlacedPositions,
  selectByDistribution,
  selectByDistributionWithDistrict,
} from './placement-utils.js';
import {
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
} from './algorithm-types.js';
import type { GeneratedShape } from './algorithm-types.js';
import { getRandomSupportedFacing } from '../object-catalog.js';

/**
 * Build a set of "x,y" keys for all road/path tiles from layer masks.
 * Uses variant terrain layer configs to find layers with type 'road' or 'path'.
 */
function getRoadTileSet(shape: GeneratedShape, variant: LayoutVariant): Set<string> {
  const roadTiles = new Set<string>();
  const { x: ox, y: oy } = shape.bounds;
  for (const layer of variant.terrainLayers) {
    if (layer.type !== 'road' && layer.type !== 'path') continue;
    const mask = shape.layerMasks[layer.id];
    for (let y = 0; y < mask.length; y++) {
      for (let x = 0; x < (mask[y]?.length ?? 0); x++) {
        if (mask[y][x]) roadTiles.add(`${ox + x},${oy + y}`);
      }
    }
  }
  return roadTiles;
}

/**
 * Find passable non-road tiles within `maxDistance` of a road tile.
 * Returns world coordinates. These are the "building frontage" tiles
 * where structures should face the road.
 */
function getRoadAdjacentTiles(
  shape: GeneratedShape,
  roadTileSet: Set<string>,
  maxDistance: number = 1,
): { x: number; y: number }[] {
  const { x: ox, y: oy, width, height } = shape.bounds;
  const adjacent: { x: number; y: number }[] = [];

  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      if (shape.blockedMask[ly]?.[lx]) continue;
      const wx = ox + lx;
      const wy = oy + ly;
      if (roadTileSet.has(`${wx},${wy}`)) continue;

      let nearRoad = false;
      for (let dy = -maxDistance; dy <= maxDistance && !nearRoad; dy++) {
        for (let dx = -maxDistance; dx <= maxDistance && !nearRoad; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (roadTileSet.has(`${wx + dx},${wy + dy}`)) {
            nearRoad = true;
          }
        }
      }
      if (nearRoad) {
        adjacent.push({ x: wx, y: wy });
      }
    }
  }

  return adjacent;
}

/**
 * Determine the facing direction toward the nearest road tile from a given position.
 * Expands outward from the position until a road tile is found on a cardinal axis.
 */
function facingTowardRoad(
  x: number,
  y: number,
  roadTileSet: Set<string>,
  maxSearch: number = 5,
): 'north' | 'south' | 'east' | 'west' {
  for (let d = 1; d <= maxSearch; d++) {
    if (roadTileSet.has(`${x},${y - d}`)) return 'north';
    if (roadTileSet.has(`${x + d},${y}`)) return 'east';
    if (roadTileSet.has(`${x},${y + d}`)) return 'south';
    if (roadTileSet.has(`${x - d},${y}`)) return 'west';
  }
  return 'south'; // fallback
}

/**
 * Find the nearest unoccupied passable tile to a target coordinate.
 * Uses BFS expanding outward from the target.
 *
 * All coordinates (targetX/Y, return value, occupiedTiles, forbiddenTiles keys)
 * are in world space. blockedMask is indexed with local (bounds-relative) coords.
 */
function findNearestPassableTile(
  targetX: number,
  targetY: number,
  shape: GeneratedShape,
  occupiedTiles: Set<string>,
  maxRadius: number = 10,
  forbiddenTiles?: Set<string>,
): { x: number; y: number } | null {
  const { x: ox, y: oy, width, height } = shape.bounds;

  function isPassable(wx: number, wy: number): boolean {
    const lx = wx - ox;
    const ly = wy - oy;
    if (lx < 0 || lx >= width || ly < 0 || ly >= height) return false;
    if (shape.blockedMask[ly]?.[lx]) return false;
    if (occupiedTiles.has(`${wx},${wy}`)) return false;
    if (forbiddenTiles?.has(`${wx},${wy}`)) return false;
    return true;
  }

  if (isPassable(targetX, targetY)) {
    return { x: targetX, y: targetY };
  }

  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only perimeter
        const nx = targetX + dx;
        const ny = targetY + dy;
        if (isPassable(nx, ny)) return { x: nx, y: ny };
      }
    }
  }

  return null;
}

/**
 * Place slots on passable tiles adjacent to road tiles.
 * Buildings front onto roads — the slot faces toward the nearest road tile.
 *
 * BUG-232: computes maxSearchRadius from slot dimensions so wider buildings
 * can find road-adjacent tiles further away. Also checks left-overhang and
 * upward visual clearance so sprites don't visually overlap road tiles.
 */
export const alongRoadPlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  const roadTileSet = getRoadTileSet(shape, variant);
  if (roadTileSet.size === 0) return [];

  // Valid tile set ensures multi-tile footprints stay entirely on non-road, non-blocked tiles.
  const nonRoadTileSet = new Set<string>();
  const { x: ox, y: oy } = shape.bounds;
  for (let ly = 0; ly < shape.bounds.height; ly++) {
    for (let lx = 0; lx < shape.bounds.width; lx++) {
      const wx = ox + lx;
      const wy = oy + ly;
      const key = `${wx},${wy}`;
      if (!roadTileSet.has(key) && !shape.blockedMask[ly]?.[lx]) {
        nonRoadTileSet.add(key);
      }
    }
  }

  const positioned: PositionedSlot[] = [];

  for (const slot of slots) {
    const max = slot.max ?? 1;
    const distribution = slot.distribution;
    const occ = slotOccupancy(slot);

    // Compute search radius: wider buildings need to search further from the road
    const maxSearchRadius = Math.max(occ.w, occ.h, 1);
    const adjacentTiles = getRoadAdjacentTiles(shape, roadTileSet, maxSearchRadius);
    if (adjacentTiles.length === 0) continue;

    const upwardClearance = slot.visualClearanceAbove ?? 0;

    for (let i = 0; i < max; i++) {
      const available = filterTilesForPlacement(
        adjacentTiles,
        placementBounds,
        occupiedTiles,
        occ,
        nonRoadTileSet,
      ).filter((t) => {
        // Check upward visual clearance doesn't overlap road.
        // t.x/t.y is top-left of the occupancy block; the sprite visual
        // extends upward above the footprint (roof). Check the full width
        // of the footprint for each clearance row above.
        for (let dy = 1; dy <= upwardClearance; dy++) {
          for (let dx = 0; dx < occ.w; dx++) {
            if (roadTileSet.has(`${t.x + dx},${t.y - dy}`)) return false;
          }
        }
        return true;
      });
      if (available.length === 0) break;

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const district =
        slot.preferDistrict && shape.districts
          ? (shape.districts.find((d) => d.id === slot.preferDistrict) ?? null)
          : null;
      const tile = selectByDistributionWithDistrict(
        available,
        allPlaced,
        rng,
        distribution,
        district,
      );
      const facing = facingTowardRoad(tile.x, tile.y, roadTileSet, maxSearchRadius);

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
 * Place slots at or near road junction nodes (intersections).
 * Ideal for town squares, fountains, market stalls.
 *
 * BUG-232: builds a roadTileSet and uses area search near intersections
 * instead of findNearestPassableTile, with road avoidance filters
 * (footprint + left overhang must not overlap road tiles).
 */
export const roadIntersectionPlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  if (!shape.roadGraph) return [];

  const intersections = shape.roadGraph.nodes.filter((n) => n.type === 'intersection');
  if (intersections.length === 0) return [];

  const { x: ox, y: oy } = shape.bounds;
  const roadTileSet = getRoadTileSet(shape, variant);
  const positioned: PositionedSlot[] = [];

  for (const slot of slots) {
    const max = slot.max ?? 1;
    const distribution = slot.distribution;
    const occ = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      const candidates: { x: number; y: number }[] = [];
      const searchRadius = Math.max(occ.w, occ.h, 3);
      for (const node of intersections) {
        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
          for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            // node.x/y are local; lx/ly for blockedMask, wx/wy for world-space checks
            const lx = node.x + dx;
            const ly = node.y + dy;
            if (lx < 0 || lx >= shape.bounds.width || ly < 0 || ly >= shape.bounds.height) continue;
            if (shape.blockedMask[ly]?.[lx]) continue;
            const wx = ox + lx;
            const wy = oy + ly;
            if (roadTileSet.has(`${wx},${wy}`)) continue;
            candidates.push({ x: wx, y: wy });
          }
        }
      }

      const seen = new Set<string>();
      const unique = candidates.filter((t) => {
        const key = `${t.x},${t.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const available = filterTilesForPlacement(unique, placementBounds, occupiedTiles, occ).filter(
        (t) => {
          // Road avoidance: footprint tiles must not overlap road (top-left convention)
          for (let dy = 0; dy < occ.h; dy++) {
            for (let dx = 0; dx < occ.w; dx++) {
              if (roadTileSet.has(`${t.x + dx},${t.y + dy}`)) return false;
            }
          }
          return true;
        },
      );
      if (available.length === 0) break;

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const district =
        slot.preferDistrict && shape.districts
          ? (shape.districts.find((d) => d.id === slot.preferDistrict) ?? null)
          : null;
      const tile = selectByDistributionWithDistrict(
        available,
        allPlaced,
        rng,
        distribution,
        district,
      );
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
 * Place slots at road terminus points (endpoints on map edges, branch dead-ends).
 * Ideal for gates, dead-end buildings, guard posts.
 *
 * BUG-232: same road avoidance as roadIntersectionPlacement.
 */
export const roadEndPlacement: PlacementAlgorithmFn = (ctx: PlacementContext): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  if (!shape.roadGraph) return [];

  const endpoints = shape.roadGraph.nodes.filter(
    (n) => n.type === 'endpoint' || n.type === 'branch',
  );
  if (endpoints.length === 0) return [];

  const { x: ox, y: oy } = shape.bounds;
  const roadTileSet = getRoadTileSet(shape, variant);
  const positioned: PositionedSlot[] = [];

  for (const slot of slots) {
    const max = slot.max ?? 1;
    const distribution = slot.distribution;
    const occ = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      const candidates: { x: number; y: number }[] = [];
      for (const node of endpoints) {
        // node.x/y are local coords; convert to world before passing
        const tile = findNearestPassableTile(
          ox + node.x,
          oy + node.y,
          shape,
          occupiedTiles,
          10,
          roadTileSet,
        );
        if (tile) candidates.push(tile);
      }

      const seen = new Set<string>();
      const unique = candidates.filter((t) => {
        const key = `${t.x},${t.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const available = filterTilesForPlacement(unique, placementBounds, occupiedTiles, occ).filter(
        (t) => {
          // Road avoidance: footprint tiles must not overlap road (top-left convention)
          for (let dy = 0; dy < occ.h; dy++) {
            for (let dx = 0; dx < occ.w; dx++) {
              if (roadTileSet.has(`${t.x + dx},${t.y + dy}`)) return false;
            }
          }
          return true;
        },
      );
      if (available.length === 0) break;

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
