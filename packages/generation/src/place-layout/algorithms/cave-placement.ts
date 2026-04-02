/**
 * Cave placement algorithms
 *
 * Algorithms that place slots relative to cave tunnel tiles:
 * - along_cave: place objects on passable tiles adjacent to cave walls (alcove positions)
 */

import {
  createRng,
  slotOccupancy,
  occupy,
  filterTilesForPlacement,
  collectPlacedPositions,
  selectByDistribution,
} from './placement-utils.js';
import {
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
} from './algorithm-types.js';

/**
 * Determine the facing direction toward the nearest cave wall (blocked tile) from a given position.
 * Expands outward until a blocked tile is found on a cardinal axis.
 */
function facingTowardWall(
  x: number,
  y: number,
  shape: PlacementContext['shape'],
  maxSearch: number = 5,
): 'north' | 'south' | 'east' | 'west' {
  const { x: ox, y: oy, width, height } = shape.bounds;

  function isBlocked(wx: number, wy: number): boolean {
    const lx = wx - ox;
    const ly = wy - oy;
    if (lx < 0 || lx >= width || ly < 0 || ly >= height) return true; // out-of-bounds = wall
    return shape.blockedMask[ly]?.[lx] ?? false;
  }

  for (let d = 1; d <= maxSearch; d++) {
    if (isBlocked(x, y - d)) return 'north';
    if (isBlocked(x + d, y)) return 'east';
    if (isBlocked(x, y + d)) return 'south';
    if (isBlocked(x - d, y)) return 'west';
  }
  return 'south'; // fallback
}

/**
 * Find all passable tiles that are adjacent (within maxDistance) to a cave wall (blocked tile).
 * Returns world coordinates. These are the alcove/treasure positions along cave walls.
 */
function getCaveWallAdjacentTiles(
  shape: PlacementContext['shape'],
  maxDistance: number = 1,
): { x: number; y: number }[] {
  const { x: ox, y: oy, width, height } = shape.bounds;
  const adjacent: { x: number; y: number }[] = [];

  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      // Tile must be passable
      if (shape.blockedMask[ly]?.[lx]) continue;

      const wx = ox + lx;
      const wy = oy + ly;

      // Check if any neighbor within maxDistance is a blocked (rock) tile
      let nearWall = false;
      outer: for (let dy = -maxDistance; dy <= maxDistance; dy++) {
        for (let dx = -maxDistance; dx <= maxDistance; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nlx = lx + dx;
          const nly = ly + dy;
          // Out-of-bounds counts as wall
          if (nlx < 0 || nlx >= width || nly < 0 || nly >= height) {
            nearWall = true;
            break outer;
          }
          if (shape.blockedMask[nly]?.[nlx]) {
            nearWall = true;
            break outer;
          }
        }
      }

      if (nearWall) {
        adjacent.push({ x: wx, y: wy });
      }
    }
  }

  return adjacent;
}

/**
 * Place slots on passable tiles adjacent to cave walls (alcove positions).
 * Objects face toward the nearest rock wall — they're nestled into the cave rock.
 */
export const alongCavePlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);

  const positioned: PositionedSlot[] = [];

  for (const slot of slots) {
    const max = slot.max ?? 1;
    const distribution = slot.distribution;
    const occ = slotOccupancy(slot);

    const maxSearchRadius = Math.max(occ.w, occ.h, 1);
    const adjacentTiles = getCaveWallAdjacentTiles(shape, maxSearchRadius);
    if (adjacentTiles.length === 0) continue;

    for (let i = 0; i < max; i++) {
      const available = filterTilesForPlacement(adjacentTiles, placementBounds, occupiedTiles, occ);
      if (available.length === 0) break;

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const tile = selectByDistribution(available, allPlaced, rng, distribution);
      const facing = facingTowardWall(tile.x, tile.y, shape, maxSearchRadius);

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
