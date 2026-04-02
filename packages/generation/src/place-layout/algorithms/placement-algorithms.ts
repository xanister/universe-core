/**
 * Built-in Slot Placement Algorithms — Registration
 *
 * Registers all built-in placement algorithms with the registry.
 * Algorithm implementations live in their respective modules:
 *
 * - in-wall-placement.ts      (in_wall)
 * - floor-placement.ts        (random_valid, clustered, near_slot, center_floor, under)
 * - against-wall-placement.ts (against_wall)
 * - terrain-placement.ts      (open_space, on_land, on_water, on_coast, pier_end)
 * - road-placement.ts         (along_road, road_intersection, road_end)
 * - cave-placement.ts         (along_cave)
 * - surface-placement.ts      (on_surface)
 *
 * To add a new placement algorithm:
 * 1. Create a function implementing PlacementAlgorithmFn in the appropriate module
 *    (or a new module if it doesn't fit an existing group)
 * 2. Import it here and register it in registerBuiltInPlacementAlgorithms()
 */

import { registerPlacementAlgorithm, registerPlacementAlgorithmMeta } from './algorithm-types.js';
import { inWallPlacement } from './in-wall-placement.js';
import {
  randomValidPlacement,
  clusteredPlacement,
  nearSlotPlacement,
  centerFloorPlacement,
  underPlacement,
} from './floor-placement.js';
import { againstWallPlacement } from './against-wall-placement.js';
import {
  openSpacePlacement,
  onLandPlacement,
  onWaterPlacement,
  onCoastPlacement,
  pierEndPlacement,
} from './terrain-placement.js';
import {
  alongRoadPlacement,
  roadIntersectionPlacement,
  roadEndPlacement,
} from './road-placement.js';
import { alongCavePlacement } from './cave-placement.js';
import { onSurfacePlacement } from './surface-placement.js';

export function registerBuiltInPlacementAlgorithms(): void {
  registerPlacementAlgorithm('in_wall', inWallPlacement);
  registerPlacementAlgorithm('random_valid', randomValidPlacement);
  // 'random' was identical to 'random_valid' after BUG-046 fix (now respects
  // blockedMask + shared occupiedTiles). Alias to avoid dead code.
  registerPlacementAlgorithm('random', randomValidPlacement);
  registerPlacementAlgorithm('clustered', clusteredPlacement);
  registerPlacementAlgorithm('open_space', openSpacePlacement);
  registerPlacementAlgorithm('on_land', onLandPlacement);
  registerPlacementAlgorithm('on_water', onWaterPlacement);
  registerPlacementAlgorithm('on_coast', onCoastPlacement);
  registerPlacementAlgorithm('against_wall', againstWallPlacement);
  registerPlacementAlgorithm('near_slot', nearSlotPlacement);
  registerPlacementAlgorithm('center_floor', centerFloorPlacement);
  registerPlacementAlgorithm('under', underPlacement);
  registerPlacementAlgorithm('on_surface', onSurfacePlacement);
  registerPlacementAlgorithm('along_road', alongRoadPlacement);
  registerPlacementAlgorithm('road_intersection', roadIntersectionPlacement);
  registerPlacementAlgorithm('road_end', roadEndPlacement);
  registerPlacementAlgorithm('pier_end', pierEndPlacement);
  registerPlacementAlgorithm('along_cave', alongCavePlacement);

  // Default tag constraints for object selection safety.
  // null = slot uses algo defaults; [] = slot opts out; ["tag"] = slot overrides.
  registerPlacementAlgorithmMeta('in_wall', {
    defaultRequiredTags: ['wall'],
    defaultForbiddenTags: null,
  });
  registerPlacementAlgorithmMeta('against_wall', {
    defaultRequiredTags: null,
    defaultForbiddenTags: ['wall'],
  });
  registerPlacementAlgorithmMeta('along_road', {
    defaultRequiredTags: null,
    defaultForbiddenTags: ['wall'],
  });
  registerPlacementAlgorithmMeta('along_cave', {
    defaultRequiredTags: null,
    defaultForbiddenTags: ['wall'],
  });
}

registerBuiltInPlacementAlgorithms();
