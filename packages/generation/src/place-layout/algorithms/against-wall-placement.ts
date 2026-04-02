/**
 * Against-wall placement algorithm
 *
 * Places slots on floor tiles adjacent to walls.
 * Used for furniture that should sit against walls: beds, wardrobes, shelves, desks.
 */

import { type LayoutVariant } from '@dmnpc/types/world';
import {
  createRng,
  slotOccupancy,
  occupy,
  filterTilesForPlacement,
  collectPlacedPositions,
  selectByDistribution,
} from './placement-utils.js';
import {
  getRoomTileSet,
  getWallAdjacentFloorTiles,
  resolveWallMask,
  resolveWallFaceMask,
} from './placement-tile-sets.js';
import {
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
  getPlacementAlgorithmMeta,
} from './algorithm-types.js';
import type { GeneratedShape } from './algorithm-types.js';
import { getAnyAllowedFacingsForPurpose } from '../object-catalog.js';

/** Infer facing for against_wall slot: object faces away from the wall (into the room). */
function inferAgainstWallFacing(
  tile: { x: number; y: number },
  shape: GeneratedShape,
  variant: LayoutVariant,
): 'north' | 'south' | 'east' | 'west' {
  const wallMask = resolveWallMask(shape, variant);
  const bounds = shape.bounds;
  if (!wallMask) return 'south';

  const lx = tile.x - bounds.x;
  const ly = tile.y - bounds.y;
  if (ly > 0 && wallMask[ly - 1]?.[lx] === true) return 'south';
  // FEAT-276: tile below the face strip bottom — the face implies a north wall above it.
  const wallFaceMask = resolveWallFaceMask(shape, variant);
  if (wallFaceMask && ly > 0 && wallFaceMask[ly - 1]?.[lx] === true) return 'south';
  if (ly < bounds.height - 1 && wallMask[ly + 1]?.[lx] === true) return 'north';
  if (lx > 0 && wallMask[ly]?.[lx - 1] === true) return 'east';
  if (lx < bounds.width - 1 && wallMask[ly]?.[lx + 1] === true) return 'west';
  return 'south';
}

/**
 * Against-wall placement - places slots on floor tiles adjacent to walls.
 * Used for furniture that should sit against walls: beds, wardrobes, shelves, desks.
 *
 * Uses 2x2 occupancy blocks (same as other floor algorithms) for BUG-059 spacing.
 *
 * BUG-128: Only places against walls whose inferred facing is supported by the
 * candidate sprites for the slot's purpose. Single-direction sprites (no `directions`
 * in the sprite registry) are restricted to north-wall placement (facing south).
 */
export const againstWallPlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { shape, slots, seed, variant, occupiedTiles, placedSlots, placementBounds } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];
  const allCandidates = getWallAdjacentFloorTiles(shape, variant);

  if (allCandidates.length === 0) {
    return [];
  }

  // BUG-174: Use the uncleaned room tile set for 2x2 occupancy validation.
  // Furniture sits on a floor tile at the wall edge; the 2x2 block can extend
  // into wall boundary tiles (those tiles are right next to the wall where
  // the furniture sits, so reserving them is correct). The cleaned floorTileSet
  // would reject blocks that touch the wall boundary, breaking small rooms.
  const roomTileSet = getRoomTileSet(shape, variant);

  for (const slot of slots) {
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;
    const distribution = slot.distribution;

    // BUG-156: Use UNION of facings (any wall where at least one object fits).
    // The object selector filters by facing at selection time (BUG-128 safety preserved).
    // BUG-121: Apply defaultForbiddenTags from registry when slot has no opinion
    // (null), matching the effective tags that convertPositionedToGenerated
    // will apply. Without this, wall-tagged objects (which have no against_wall
    // sprites) inflate the facing union and allow placements on walls where
    // no valid object exists for the assigned facing.
    const algoMeta = getPlacementAlgorithmMeta('against_wall');
    const effectiveForbiddenTags =
      slot.forbiddenTags ?? algoMeta?.defaultForbiddenTags ?? undefined;
    const allowedFacings = new Set(
      getAnyAllowedFacingsForPurpose(
        slot.purpose,
        slot.requiredTags ?? undefined,
        effectiveForbiddenTags,
      ),
    );

    const directionFilteredCandidates = allCandidates.filter((tile) =>
      allowedFacings.has(inferAgainstWallFacing(tile, shape, variant)),
    );

    const occ = slotOccupancy(slot);

    for (let i = 0; i < max; i++) {
      const available = filterTilesForPlacement(
        directionFilteredCandidates,
        placementBounds,
        occupiedTiles,
        occ,
        roomTileSet,
      );
      if (available.length === 0) {
        if (i < min) {
          throw new Error(
            `Cannot place required against_wall slot (purpose: ${slot.purpose}, ${i + 1}/${min} min): no wall-adjacent floor tiles available with allowed facings [${[...allowedFacings].join(', ')}]`,
          );
        }
        break;
      }

      const allPlaced = collectPlacedPositions(placedSlots, positioned);
      const tile = selectByDistribution(available, allPlaced, rng, distribution);
      const facing = inferAgainstWallFacing(tile, shape, variant);

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
