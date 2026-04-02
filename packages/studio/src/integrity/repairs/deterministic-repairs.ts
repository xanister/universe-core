/**
 * Deterministic Repairs
 *
 * Rule-based fixes that don't require LLM:
 * - Reset invalid placeIds to rootPlaceId
 * - Remove orphaned relationship IDs
 * - Clear invalid exit references
 * - Add missing reciprocal relationships
 */

import type { BaseEntity, Character, CharacterRelationship } from '@dmnpc/types/entity';
import { isCharacter, isRecord } from '@dmnpc/core/entities/type-guards.js';
import {
  getNestedValue,
  setNestedValue,
  deleteNestedField,
} from '@dmnpc/core/entities/nested-access.js';
import type { ValidationIssue, ValidationContext } from '../integrity-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';

/**
 * Apply a deterministic repair to an entity.
 * Returns true if the repair was applied, false otherwise.
 */
export function applyDeterministicRepair(
  entity: BaseEntity,
  issue: ValidationIssue,
  _ctx: ValidationContext,
): boolean {
  if (!issue.suggestedFix || issue.suggestedFix.method !== 'deterministic') {
    return false;
  }

  const { field, value } = issue.suggestedFix;

  try {
    // Special handling for relationship array additions
    if (
      field === 'relationships' &&
      issue.validatorId === 'relationship-symmetry' &&
      isCharacter(entity)
    ) {
      if (!isCharacterRelationship(value)) {
        return false;
      }
      return addRelationship(entity, value);
    }

    if (!isRecord(entity)) {
      return false;
    }
    const oldValue = getNestedValue(entity, field);

    // Handle field deletion when value is undefined
    if (value === undefined) {
      deleteNestedField(entity, field);
      logger.info(
        'IntegrityRepair',
        `Deleted field for ${entity.id}: ${field} (was "${JSON.stringify(oldValue)}")`,
      );
      return true;
    }

    setNestedValue(entity, field, value);

    logger.info(
      'IntegrityRepair',
      `Applied deterministic repair for ${entity.id}: ${field} changed from "${String(oldValue)}" to "${JSON.stringify(value)}"`,
    );

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', 'Failed to apply deterministic repair', {
      entityId: entity.id,
      field,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if a value has the shape of a CharacterRelationship.
 */
function isCharacterRelationship(v: unknown): v is CharacterRelationship {
  return (
    typeof v === 'object' &&
    v !== null &&
    'targetId' in v &&
    typeof v.targetId === 'string' &&
    'type' in v &&
    'disposition' in v &&
    'familiarity' in v &&
    typeof v.familiarity === 'number'
  );
}

/**
 * Add a relationship to a character's relationships array.
 */
function addRelationship(character: Character, relationship: CharacterRelationship): boolean {
  // Check if relationship already exists (avoid duplicates)
  const exists = character.relationships.some(
    (r) => r.targetId === relationship.targetId && r.type === relationship.type,
  );

  if (exists) {
    logger.info(
      'IntegrityRepair',
      `Skipping duplicate relationship for ${character.id}: ${relationship.type} to ${relationship.targetId}`,
    );
    return false;
  }

  character.relationships.push(relationship);

  logger.info(
    'IntegrityRepair',
    `Added reciprocal relationship for ${character.id}: ${relationship.type} to ${relationship.targetId}`,
  );

  return true;
}
