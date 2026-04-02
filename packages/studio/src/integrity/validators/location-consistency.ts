/**
 * Location Consistency Validator
 *
 * Validates that character and place location state is internally consistent:
 * - position.parent references valid places
 * - destinationPlaceId references valid places
 * - No conflicting location state (abstractLocation + traveling)
 *
 * Repair: Deterministic - clear invalid state or set to appropriate state.
 */

import type { BaseEntity, Character, Place } from '@dmnpc/types/entity';
import { isCharacter, isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Validate character location consistency.
 */
function validateCharacterLocation(
  character: Character,
  ctx: ValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, position, info } = character;
  const { abstractLocation } = info;

  // Skip if character has no position parent (dormant character)
  if (!position.parent) {
    return issues;
  }

  const currentPlace = ctx.places.get(position.parent);

  // Check: position.parent must exist
  if (!currentPlace) {
    issues.push({
      entityId: id,
      entityType: 'character',
      validatorId: 'location-consistency',
      severity: 'error',
      field: 'position.parent',
      message: `Character position.parent references non-existent place: ${position.parent}`,
      suggestedFix: {
        field: 'position.parent',
        value: null, // Will be determined by LLM
        confidence: 'medium',
        method: 'llm',
      },
    });
    return issues;
  }

  // Check: destinationPlaceId validation when present (character is traveling)
  const { destinationPlaceId } = character;
  if (destinationPlaceId) {
    // Destination place must exist
    if (!ctx.places.has(destinationPlaceId)) {
      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'location-consistency',
        severity: 'error',
        field: 'destinationPlaceId',
        message: `Character destinationPlaceId references non-existent place: ${destinationPlaceId}`,
        suggestedFix: {
          field: 'destinationPlaceId',
          value: undefined,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }

    // Should not have abstractLocation when traveling
    if (abstractLocation) {
      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'location-consistency',
        severity: 'warning',
        field: 'info.abstractLocation',
        message:
          'Character has both destinationPlaceId and abstractLocation - abstractLocation should be cleared',
        suggestedFix: {
          field: 'info.abstractLocation',
          value: undefined,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }
  }

  return issues;
}

/**
 * Validate vessel (mobile place) location consistency.
 */
function validatePlaceLocation(place: Place, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, position } = place;

  // Validate position.parent exists (except for root places like cosmos)
  if (position.parent !== null && !ctx.places.has(position.parent)) {
    issues.push({
      entityId: id,
      entityType: 'place',
      validatorId: 'location-consistency',
      severity: 'error',
      field: 'position.parent',
      message: `Place position.parent references non-existent place: ${position.parent}`,
      suggestedFix: {
        field: 'position.parent',
        value: null, // Will be determined by LLM
        confidence: 'medium',
        method: 'llm',
      },
    });
  }

  // NOTE: Vessel-specific validation (destinationPlaceId) is handled
  // by the vessel-routes validator. This validator only checks general place
  // location consistency (position.parent validity).

  return issues;
}

/**
 * Location Consistency Validator
 *
 * Checks for internally consistent location state across characters and vessels.
 */
export const locationConsistencyValidator: Validator = {
  id: 'location-consistency',
  name: 'Location Consistency Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return validateCharacterLocation(entity, ctx);
    }

    if (entity.id.startsWith('PLACE_') && isPlace(entity)) {
      return validatePlaceLocation(entity, ctx);
    }

    return [];
  },
};
