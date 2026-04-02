/**
 * Algorithm Registries
 *
 * Pluggable algorithm system for slot placement.
 * Templates specify which algorithm to use, and the registry dispatches to the right implementation.
 */

export type { GeneratedShape } from './algorithm-types.js';
export {
  PLACEMENT_ALGORITHM_REGISTRY,
  PLACEMENT_ALGORITHM_META,
  getPlacementAlgorithm,
  getPlacementAlgorithmMeta,
  registerPlacementAlgorithm,
  registerPlacementAlgorithmMeta,
  type PlacementAlgorithmFn,
  type PlacementAlgorithmMeta,
  type PlacementContext,
  type PositionedSlot,
} from './algorithm-types.js';

export {
  getWalkableLayerIds,
  selectByDistribution,
  selectByDistributionWithDistrict,
} from './placement-utils.js';

// Import placement-algorithms to register built-in algorithms synchronously at module load
import './placement-algorithms.js';
