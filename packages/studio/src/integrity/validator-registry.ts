/**
 * Validator Registry
 *
 * Single source of truth for all validation checks in the system.
 * Provides a clear overview of:
 * - All active validators
 * - Whether they are integrity (ongoing) or migration (field cleanup)
 * - Whether they run at entity level or universe level
 * - Execution order and dependencies
 *
 * Usage:
 *   import { entityValidators, universeValidators } from './validator-registry.js';
 *   import { getIntegrityValidators, getMigrationValidators } from './validator-registry.js';
 */

import type { Validator, ValidationContext } from './integrity-types.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { UniverseValidatorResult } from '@dmnpc/types/entity';

/**
 * Category of validator:
 * - 'integrity': Ongoing data quality checks (will always be needed)
 * - 'migration': Field cleanup (can be removed once all data migrated)
 */
export type ValidatorCategory = 'integrity' | 'migration';

/**
 * Metadata for an entity-level validator.
 */
interface EntityValidatorEntry {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Whether this is an integrity check or migration cleanup */
  category: ValidatorCategory;
  /** Brief description of what this validator checks */
  description: string;
  /** The validator implementation */
  validator: Validator;
  /** Validators that must run before this one */
  runAfter?: string[];
}

/**
 * Metadata for a universe-level validator.
 */
export interface UniverseValidatorEntry {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Whether this is an integrity check or migration cleanup */
  category: ValidatorCategory;
  /** Brief description of what this validator checks */
  description: string;
  /** Validation function */
  validate: (ctx: ValidationContext) => UniverseValidatorResult;
  /** Repair function */
  repair: (
    ctx: ValidationContext,
    universeCtx: UniverseContext,
  ) => UniverseValidatorResult | Promise<UniverseValidatorResult>;
  /** Completely disable this validator (default: false) */
  disabled?: boolean;
}

import { missingFieldsValidator } from './validators/missing-fields.js';
import { orphanedRefsValidator } from './validators/orphaned-refs.js';
import { locationConsistencyValidator } from './validators/location-consistency.js';
import { placeEnvironmentValidator } from './validators/place-environment.js';
import { placeSizeValidator } from './validators/place-size.js';
import { regionScaleValidator } from './validators/region-scale.js';
import { parentChainValidator } from './validators/parent-chain.js';
import { vesselCrewConsistencyValidator } from './validators/vessel-crew-consistency.js';
import { relationshipSymmetryValidator } from './validators/relationship-symmetry.js';
import { internalConflictsValidator } from './validators/internal-conflicts.js';
import { duplicateEntityValidator } from './validators/duplicate-entities.js';
import { dateFormatValidator } from './validators/date-format.js';
import { missingImageValidator } from './validators/missing-image.js';
import { missingCharacterSpriteValidator } from './validators/missing-character-sprite.js';
import { placeLabelValidator } from './validators/place-label.js';
import { missingSpriteValidator } from './validators/missing-sprite.js';
import { placeLayoutValidator } from './validators/place-layout.js';
import { missingBattleBackgroundValidator } from './validators/missing-battle-background.js';

import { validateVesselRoutes, repairVesselRoutes } from './validators/vessel-routes.js';
import {
  validateTravelCoordinates,
  repairTravelCoordinates,
} from './validators/travel-coordinates.js';
import { validateVesselHierarchy, repairVesselHierarchy } from './validators/vessel-hierarchy.js';
import {
  validateMinimumHierarchy,
  repairMinimumHierarchy,
} from './validators/minimum-hierarchy.js';
import { validateMissingExits, repairMissingExits } from './validators/missing-exit.js';

/**
 * All entity-level validators in execution order.
 *
 * INTEGRITY validators: Ongoing data quality checks
 * MIGRATION validators: Field cleanup (remove when done)
 *
 * Order matters - validators may depend on earlier ones having run.
 */
export const ENTITY_VALIDATORS: EntityValidatorEntry[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Required field validation
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'missing-fields',
    name: 'Missing Fields Validator',
    category: 'integrity',
    description: 'Checks for missing required fields on entities',
    validator: missingFieldsValidator,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Reference validation
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'orphaned-refs',
    name: 'Orphaned References Validator',
    category: 'integrity',
    description: 'Detects references to non-existent entities',
    validator: orphanedRefsValidator,
    runAfter: ['missing-fields'],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Location and place validation
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'location-consistency',
    name: 'Location Consistency Validator',
    category: 'integrity',
    description: 'Validates character/entity location states',
    validator: locationConsistencyValidator,
    runAfter: ['orphaned-refs'],
  },
  {
    id: 'place-environment',
    name: 'Place Environment Validator',
    category: 'integrity',
    description: 'Validates place environment values and structure',
    validator: placeEnvironmentValidator,
    runAfter: ['location-consistency'],
  },
  {
    id: 'place-size',
    name: 'Place Size Validator',
    category: 'integrity',
    description: 'Validates place size field format',
    validator: placeSizeValidator,
    runAfter: ['place-environment'],
  },
  {
    id: 'region-scale',
    name: 'Region Scale Validator',
    category: 'integrity',
    description: 'Validates scale values for region-type places',
    validator: regionScaleValidator,
    runAfter: ['place-environment'],
  },
  {
    id: 'place-label',
    name: 'Place Label Validator',
    category: 'integrity',
    description:
      'Validates place labels: rejects parenthetical details (clarification), adds context to generic names (LLM)',
    validator: placeLabelValidator,
    runAfter: ['region-scale'],
  },
  {
    id: 'place-layout',
    name: 'Place Layout Validator',
    category: 'integrity',
    description: 'Validates feet-scale places have layouts and objects generated',
    validator: placeLayoutValidator,
    runAfter: ['place-label'],
  },
  {
    id: 'parent-chain',
    name: 'Parent Chain Validator',
    category: 'integrity',
    description: 'Validates hierarchy chains are complete',
    validator: parentChainValidator,
    runAfter: ['orphaned-refs'],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Vessel validation
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'vessel-crew-consistency',
    name: 'Vessel Crew Consistency Validator',
    category: 'integrity',
    description: 'Validates vessels have proper crew configuration',
    validator: vesselCrewConsistencyValidator,
    runAfter: ['parent-chain'],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Relationship validation
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'relationship-symmetry',
    name: 'Relationship Symmetry Validator',
    category: 'integrity',
    description: 'Ensures bidirectional relationships are symmetric',
    validator: relationshipSymmetryValidator,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Data consistency
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'internal-conflicts',
    name: 'Internal Conflicts Validator',
    category: 'integrity',
    description: 'Detects logical contradictions within entities',
    validator: internalConflictsValidator,
  },
  {
    id: 'duplicate-entities',
    name: 'Duplicate Entities Validator',
    category: 'integrity',
    description: 'Detects potential duplicate entities',
    validator: duplicateEntityValidator,
  },
  {
    id: 'date-format',
    name: 'Date Format Validator',
    category: 'integrity',
    description: 'Validates date strings are parseable',
    validator: dateFormatValidator,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Asset validation (runs last - may generate images)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'missing-battle-background',
    name: 'Missing Battle Background Validator',
    category: 'integrity',
    description: 'Validates places have battle background images',
    validator: missingBattleBackgroundValidator,
    runAfter: ['place-layout'],
  },
  {
    id: 'missing-image',
    name: 'Missing Image Validator',
    category: 'integrity',
    description: 'Validates entities have required images',
    validator: missingImageValidator,
  },
  {
    id: 'missing-character-sprite',
    name: 'Missing Character Sprite Validator',
    category: 'integrity',
    description: 'Validates characters have in-world sprite (spriteConfig.spriteUrl)',
    validator: missingCharacterSpriteValidator,
    runAfter: ['missing-fields'],
  },
  {
    id: 'missing-sprite',
    name: 'Missing Sprite Validator',
    category: 'integrity',
    description: 'Validates objects have resolvable sprites via objectTypeId',
    validator: missingSpriteValidator,
    runAfter: ['missing-fields'],
  },
];

/**
 * All universe-level validators.
 *
 * These run on the entire universe context, not individual entities.
 * They handle cross-entity validation and repairs.
 *
 * INTEGRITY validators: Ongoing structural checks
 * MIGRATION validators: Data cleanup (remove when done)
 */
export const UNIVERSE_VALIDATORS: UniverseValidatorEntry[] = [
  {
    id: 'minimum-hierarchy',
    name: 'Minimum Hierarchy Validator',
    category: 'integrity',
    description: 'Ensures minimum place counts at each hierarchy level',
    validate: validateMinimumHierarchy,
    repair: repairMinimumHierarchy,
  },
  {
    id: 'missing-exit',
    name: 'Missing Exit Validator',
    category: 'integrity',
    description: 'Ensures every non-root place has an exit to its parent',
    validate: validateMissingExits,
    repair: repairMissingExits,
  },
  {
    id: 'vessel-routes',
    name: 'Vessel Routes Validator',
    category: 'integrity',
    description: 'Validates vessels in transit have valid destinationPlaceId',
    validate: validateVesselRoutes,
    repair: repairVesselRoutes,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTEGRITY: Structural validation (always needed)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'vessel-hierarchy',
    name: 'Vessel Hierarchy Validator',
    category: 'integrity',
    description: 'Ensures vessel interiors are properly parented',
    validate: validateVesselHierarchy,
    repair: repairVesselHierarchy,
    // DISABLED: Generates false positives for legitimate gangway connections (ship-to-dock exits).
    // The validator flags places connected to vessel interiors as potentially misparented,
    // but this is normal for docks/harbors connected via gangways. Re-enable if we actually
    // observe rooms being incorrectly placed outside their parent vessels.
    disabled: true,
  },
  {
    id: 'travel-coordinates',
    name: 'Travel Coordinates Validator',
    category: 'integrity',
    description: 'Validates coordinates for vessels in transit',
    validate: validateTravelCoordinates,
    repair: repairTravelCoordinates,
  },
];

/**
 * Get all entity validators in execution order.
 */
export function getEntityValidators(): Validator[] {
  return ENTITY_VALIDATORS.map((entry) => entry.validator);
}

/**
 * Get entity validators by category.
 */
export function getEntityValidatorsByCategory(category: ValidatorCategory): Validator[] {
  return ENTITY_VALIDATORS.filter((entry) => entry.category === category).map(
    (entry) => entry.validator,
  );
}

/**
 * Get integrity entity validators only (excludes migration validators).
 */
export function getIntegrityEntityValidators(): Validator[] {
  return getEntityValidatorsByCategory('integrity');
}

/**
 * Get universe validators that should run during batch scans.
 * Returns all non-disabled validators.
 */
export function getBatchScanUniverseValidators(): UniverseValidatorEntry[] {
  return UNIVERSE_VALIDATORS.filter((entry) => !entry.disabled);
}

/**
 * Get universe validators by category.
 */
export function getUniverseValidatorsByCategory(
  category: ValidatorCategory,
): UniverseValidatorEntry[] {
  return UNIVERSE_VALIDATORS.filter((entry) => entry.category === category);
}

/**
 * Get a summary of all validators for documentation/debugging.
 */
export function getValidatorSummary(): {
  entity: { integrity: string[]; migration: string[] };
  universe: { integrity: string[]; migration: string[] };
} {
  return {
    entity: {
      integrity: ENTITY_VALIDATORS.filter((v) => v.category === 'integrity').map((v) => v.id),
      migration: ENTITY_VALIDATORS.filter((v) => v.category === 'migration').map((v) => v.id),
    },
    universe: {
      integrity: UNIVERSE_VALIDATORS.filter((v) => v.category === 'integrity').map((v) => v.id),
      migration: UNIVERSE_VALIDATORS.filter((v) => v.category === 'migration').map((v) => v.id),
    },
  };
}

/**
 * Entity validators that don't generate images.
 * Used when skipImageValidation option is enabled.
 */
export function getEntityValidatorsWithoutImages(): Validator[] {
  const excludedIds = new Set([
    'missing-image',
    'missing-character-sprite',
    'missing-battle-background',
    'place-environment',
  ]);
  return ENTITY_VALIDATORS.filter((entry) => !excludedIds.has(entry.id)).map(
    (entry) => entry.validator,
  );
}
