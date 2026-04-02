/**
 * Missing Image Validator
 *
 * Detects entities (characters/places) that are missing their image field.
 * Repair: Generate new image via image generation service.
 */

import type { BaseEntity, Character, Place } from '@dmnpc/types/entity';
import { isCharacter, isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Validate that a character has an image field.
 */
function validateCharacterImage(character: Character): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Skip if already has an image
  if (character.image) {
    return issues;
  }

  // No image - needs to be generated
  issues.push({
    entityId: character.id,
    entityType: 'character',
    validatorId: 'missing-image',
    severity: 'warning',
    field: 'image',
    message: `Character is missing image`,
    suggestedFix: {
      field: 'image',
      value: null,
      confidence: 'high',
      method: 'image',
    },
  });

  return issues;
}

/**
 * Validate that a place has an image field.
 */
function validatePlaceImage(place: Place): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Skip if already has an image
  if (place.image) {
    return issues;
  }

  // No image - needs to be generated
  issues.push({
    entityId: place.id,
    entityType: 'place',
    validatorId: 'missing-image',
    severity: 'warning',
    field: 'image',
    message: `Place is missing image`,
    suggestedFix: {
      field: 'image',
      value: null,
      confidence: 'high',
      method: 'image',
    },
  });

  return issues;
}

/**
 * Missing Image Validator
 *
 * Checks for missing image fields on characters and places.
 */
export const missingImageValidator: Validator = {
  id: 'missing-image',
  name: 'Missing Image Validator',

  validate(entity: BaseEntity, _ctx: ValidationContext): ValidationIssue[] {
    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return validateCharacterImage(entity);
    }

    if (entity.id.startsWith('PLACE_') && isPlace(entity)) {
      return validatePlaceImage(entity);
    }

    // Exits and events don't have images
    return [];
  },
};
