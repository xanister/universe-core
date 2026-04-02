/**
 * Validators Index
 *
 * Re-exports from validator-registry.ts and individual validator files.
 * See validator-registry.ts for the complete list of validators with
 * their categories (integrity/migration) and metadata.
 */

// =============================================================================
// REGISTRY (source of truth)
// =============================================================================

export {
  // Registry data
  ENTITY_VALIDATORS,
  UNIVERSE_VALIDATORS,
  // Types
  type ValidatorCategory,
  type UniverseValidatorEntry,
  // Helper functions
  getEntityValidators,
  getEntityValidatorsByCategory,
  getIntegrityEntityValidators,
  getBatchScanUniverseValidators,
  getUniverseValidatorsByCategory,
  getValidatorSummary,
  getEntityValidatorsWithoutImages,
} from '../validator-registry.js';

export type { UniverseValidatorResult } from '@dmnpc/types';

// =============================================================================
// INDIVIDUAL VALIDATOR EXPORTS (for direct use)
// =============================================================================

// Entity-level validators
export { missingFieldsValidator } from './missing-fields.js';
export { orphanedRefsValidator } from './orphaned-refs.js';
export { locationConsistencyValidator } from './location-consistency.js';
export { placeEnvironmentValidator } from './place-environment.js';
export { placeSizeValidator } from './place-size.js';
export { regionScaleValidator } from './region-scale.js';
export { placeLabelValidator, repairPlaceLabel } from './place-label.js';
export { parentChainValidator } from './parent-chain.js';
export { vesselCrewConsistencyValidator } from './vessel-crew-consistency.js';
export { relationshipSymmetryValidator } from './relationship-symmetry.js';
export { internalConflictsValidator } from './internal-conflicts.js';
export { duplicateEntityValidator } from './duplicate-entities.js';
export { dateFormatValidator } from './date-format.js';
export { missingImageValidator } from './missing-image.js';
export { missingCharacterSpriteValidator } from './missing-character-sprite.js';
export { placeLayoutValidator } from './place-layout.js';

// Universe-level validators (functions + result types)
export {
  validateVesselRoutes,
  repairVesselRoutes,
  type VesselRoutesResult,
} from './vessel-routes.js';
export {
  validateTravelCoordinates,
  repairTravelCoordinates,
  type TravelCoordinatesResult,
} from './travel-coordinates.js';
export {
  validateVesselHierarchy,
  repairVesselHierarchy,
  type VesselHierarchyResult,
  type VesselHierarchyOptions,
} from './vessel-hierarchy.js';
export {
  validateMissingExits,
  repairMissingExits,
  type MissingExitResult,
  type MissingExitIssue,
} from './missing-exit.js';
