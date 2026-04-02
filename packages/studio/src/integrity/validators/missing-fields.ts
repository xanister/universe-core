/**
 * Missing Fields Validator
 *
 * Detects empty required fields in entities.
 * Repair: LLM generates missing content from entity description/context.
 */

import type { BaseEntity, Character, Place } from '@dmnpc/types/entity';
import { isCharacter, isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Check if a string field is empty (undefined, null, or empty string).
 */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Validate character-specific required fields.
 */
function validateCharacterFields(character: Character, _ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, info } = character;

  // Required string fields that should not be empty
  const requiredFields: Array<{ field: keyof typeof info; label: string }> = [
    { field: 'race', label: 'race' },
    { field: 'birthdate', label: 'birthdate' },
    { field: 'birthPlace', label: 'birthPlace' },
    { field: 'eyeColor', label: 'eyeColor' },
    { field: 'gender', label: 'gender' },
    { field: 'hairColor', label: 'hairColor' },
    { field: 'personality', label: 'personality' },
  ];

  for (const { field, label } of requiredFields) {
    if (isEmpty(info[field])) {
      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'missing-fields',
        severity: 'error',
        field: `info.${label}`,
        message: `Character is missing required field: ${label}`,
        suggestedFix: {
          field: `info.${label}`,
          value: null, // Will be filled by LLM repair
          confidence: 'high',
          method: 'llm',
        },
      });
    }
  }

  // All characters should have a routine (when disconnected, players become NPCs with routines)
  // Characters with storytellerState are actively being played and will get routines if needed
  // Player characters (isPlayer: true) don't need routines as they're controlled by players
  const hasActiveStorytellerSession = info.storytellerState !== null;
  const isPlayerCharacter = info.isPlayer === true;
  if (!hasActiveStorytellerSession && !isPlayerCharacter && !info.routine) {
    issues.push({
      entityId: id,
      entityType: 'character',
      validatorId: 'missing-fields',
      severity: 'error',
      field: 'info.routine',
      message: 'NPC is missing required field: routine',
      suggestedFix: {
        field: 'info.routine',
        value: null, // Will be filled by routine generator
        confidence: 'high',
        method: 'llm',
      },
    });
  }

  return issues;
}

/**
 * Validate place-specific required fields.
 */
function validatePlaceFields(place: Place): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, position } = place;

  if (isEmpty(place.description)) {
    issues.push({
      entityId: id,
      entityType: 'place',
      validatorId: 'missing-fields',
      severity: 'error',
      field: 'description',
      message: 'Place is missing required field: description',
      suggestedFix: {
        field: 'description',
        value: null,
        confidence: 'high',
        method: 'llm',
      },
    });
  }

  if (isEmpty(place.short_description)) {
    issues.push({
      entityId: id,
      entityType: 'place',
      validatorId: 'missing-fields',
      severity: 'error',
      field: 'short_description',
      message: 'Place is missing required field: short_description',
      suggestedFix: {
        field: 'short_description',
        value: null,
        confidence: 'high',
        method: 'llm',
      },
    });
  }

  // Check for missing or invalid inner size (playable area from layout)
  const innerW = position.innerWidth;
  const innerH = position.innerHeight;
  const sizeIsValid =
    typeof innerW === 'number' && typeof innerH === 'number' && innerW > 0 && innerH > 0;

  if (!sizeIsValid) {
    // Dimensions come only from layout when generated; suggest generating layout
    const layoutFix = {
      field: 'position' as const,
      value: undefined as unknown,
      confidence: 'high' as const,
      method: 'layout' as const,
    };

    if (typeof innerW !== 'number' || innerW <= 0) {
      issues.push({
        entityId: id,
        entityType: 'place',
        validatorId: 'missing-fields',
        severity: 'error',
        field: 'position.innerWidth',
        message:
          'Place is missing inner dimensions (set when layout is generated). Generate layout for this place.',
        suggestedFix: layoutFix,
      });
    }

    if (typeof innerH !== 'number' || innerH <= 0) {
      issues.push({
        entityId: id,
        entityType: 'place',
        validatorId: 'missing-fields',
        severity: 'error',
        field: 'position.innerHeight',
        message:
          'Place is missing inner dimensions (set when layout is generated). Generate layout for this place.',
        suggestedFix: layoutFix,
      });
    }
  }

  return issues;
}

/**
 * Missing Fields Validator
 *
 * Checks for empty required fields across all entity types.
 */
export const missingFieldsValidator: Validator = {
  id: 'missing-fields',
  name: 'Missing Fields Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return validateCharacterFields(entity, ctx);
    }

    if (entity.id.startsWith('PLACE_') && isPlace(entity)) {
      return validatePlaceFields(entity);
    }

    return [];
  },
};
