/**
 * In-wall placement algorithm
 *
 * Places slots on wall tiles adjacent to passable tiles.
 * Used for doors and entrances that should sit on the wall boundary.
 */

import {
  createRng,
  occupy,
  isBlockAvailable,
  hasAdjacentFloor,
  collectPlacedPositions,
  selectByDistribution,
  type Occupancy,
} from './placement-utils.js';
import { getWallBoundaryTiles, getFloorTileSet, type WallSide } from './placement-tile-sets.js';
import {
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
  getPlacementAlgorithmMeta,
} from './algorithm-types.js';
import { getAnyAllowedFacingsForPurpose } from '../object-catalog.js';

/**
 * Get occupancy for wall placement based on wall direction.
 * Horizontal walls (north/south) occupy 2x1; vertical walls (east/west) occupy 1x2.
 */
function getWallOccupancy(tile: { wall: WallSide }): Occupancy {
  return tile.wall === 'north' || tile.wall === 'south' ? { w: 2, h: 1 } : { w: 1, h: 2 };
}

/**
 * Mark floor tiles adjacent to a placed in_wall door as occupied (BUG-064).
 * Prevents against_wall furniture from blocking access to doors.
 *
 * For a horizontal wall (w:2, h:1) at (x, y): buffer the floor row on the
 * floor side (above or below).
 * For a vertical wall (w:1, h:2) at (x, y): buffer the floor column on the
 * floor side (left or right).
 */
function occupyDoorBuffer(
  occupiedTiles: Set<string>,
  x: number,
  y: number,
  occ: Occupancy,
  floorTileSet: Set<string>,
): void {
  if (occ.w === 2 && occ.h === 1) {
    if (floorTileSet.has(`${x},${y + 1}`)) {
      occupiedTiles.add(`${x},${y + 1}`);
      occupiedTiles.add(`${x + 1},${y + 1}`);
    } else if (floorTileSet.has(`${x},${y - 1}`)) {
      occupiedTiles.add(`${x},${y - 1}`);
      occupiedTiles.add(`${x + 1},${y - 1}`);
    }
  } else if (occ.w === 1 && occ.h === 2) {
    if (floorTileSet.has(`${x + 1},${y}`)) {
      occupiedTiles.add(`${x + 1},${y}`);
      occupiedTiles.add(`${x + 1},${y + 1}`);
    } else if (floorTileSet.has(`${x - 1},${y}`)) {
      occupiedTiles.add(`${x - 1},${y}`);
      occupiedTiles.add(`${x - 1},${y + 1}`);
    }
  }
}

const OPPOSITE_WALL: Record<WallSide, WallSide> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/**
 * In-wall placement - places slots on wall tiles adjacent to passable tiles.
 * Used for doors and entrances that should sit on the wall boundary.
 *
 * Uses 2-tile occupancy along the wall to prevent adjacent slots (exit, helm,
 * gangplank) from overlapping when sprites exceed 32px (BUG-059).
 * Also reserves adjacent floor tiles as buffer zones so against_wall furniture
 * cannot block door access (BUG-064).
 */
export const inWallPlacement: PlacementAlgorithmFn = (ctx: PlacementContext): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];
  const allCandidates = getWallBoundaryTiles(shape, variant);
  const floorTileSet = getFloorTileSet(shape, variant);

  for (const slot of slots) {
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;
    const distribution = slot.distribution;

    // BUG-175: Pre-filter candidates by supported facings so wall-mounted
    // objects are never placed on walls their sprites don't support.
    // BUG-121: Apply defaultRequiredTags from registry when slot has no opinion
    // (null), matching the effective tags that convertPositionedToGenerated
    // will apply. Using raw slot.requiredTags (null) included non-wall objects
    // in the facing union, causing south-wall tiles to qualify as candidates
    // but then failing object selection when the wall tag filter is applied.
    const algoMeta = getPlacementAlgorithmMeta('in_wall');
    const effectiveRequiredTags = slot.requiredTags ?? algoMeta?.defaultRequiredTags ?? undefined;
    const allowedFacings = new Set(
      getAnyAllowedFacingsForPurpose(slot.purpose, effectiveRequiredTags),
    );
    const candidates = allCandidates.filter((t) => allowedFacings.has(OPPOSITE_WALL[t.wall]));

    for (let i = 0; i < max; i++) {
      const wallTileSet = new Set(candidates.map((c) => `${c.x},${c.y}`));
      const available = candidates.filter((t) => {
        const occ = getWallOccupancy(t);
        if (!isBlockAvailable(occupiedTiles, t.x, t.y, occ)) return false;
        for (let dy = 0; dy < occ.h; dy++) {
          for (let dx = 0; dx < occ.w; dx++) {
            if (!wallTileSet.has(`${t.x + dx},${t.y + dy}`)) return false;
          }
        }
        // BUG-180: Reject positions where no tile in the occupancy block has
        // an adjacent walkable floor tile. Without this, wall objects can land
        // on boundary tiles surrounded by other wall/void tiles (e.g. room
        // corners where room and wall masks overlap).
        if (!hasAdjacentFloor(t.x, t.y, occ, floorTileSet)) return false;
        return true;
      });
      if (available.length === 0) {
        if (i < min) {
          throw new Error(
            `Cannot place required in_wall slot (purpose: ${slot.purpose}, ${i + 1}/${min} min): no wall boundary tiles available`,
          );
        }
        break;
      }

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const tile = selectByDistribution(available, allPlaced, rng, distribution);
      const occ = getWallOccupancy(tile);
      const facing = OPPOSITE_WALL[tile.wall];

      positioned.push({
        slot,
        x: tile.x,
        y: tile.y,
        width: 1,
        height: 1,
        facing,
        // North-wall doors (south-facing) use Y-sorted depth for correct
        // top-down perspective. Non-north walls use fixed 'wall' depth so the
        // doorframe renders above wall trim and the player. Both object and
        // child-place pipelines fall back to this layer via slot.layer when
        // the sprite has no defaultLayer (BUG-171).
        layer: tile.wall === 'north' ? 'default' : 'wall',
      });

      occupy(occupiedTiles, tile.x, tile.y, occ);
      // Reserve adjacent floor tiles so furniture can't block door access (BUG-064)
      occupyDoorBuffer(occupiedTiles, tile.x, tile.y, occ, floorTileSet);
    }
  }

  return positioned;
};
