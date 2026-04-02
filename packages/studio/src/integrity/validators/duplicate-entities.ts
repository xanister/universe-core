/**
 * Duplicate Entity Validator
 *
 * Detects entities with _1, _2, etc. suffix indicating ID collision during generation.
 * These are likely duplicates of an existing entity.
 *
 * Also detects when an entity has duplicates (entities with _1, _2 suffixes of its ID).
 *
 * Repair: Merge into original entity, update all references, delete duplicate.
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Pattern to detect duplicate entity IDs.
 * Matches: CHAR_name_1, PLACE_name_2, etc.
 * Captures: [1] prefix (CHAR/PLACE), [2] base name, [3] numeric suffix
 */
const DUPLICATE_PATTERN = /^(CHAR|PLACE)_(.+)_(\d+)$/;

/**
 * Get the entity collection for a given prefix.
 */
function getEntityCollection(prefix: string, ctx: ValidationContext): Map<string, BaseEntity> {
  if (prefix === 'CHAR') return ctx.characters as Map<string, BaseEntity>;
  if (prefix === 'PLACE') return ctx.places as Map<string, BaseEntity>;
  return new Map();
}

/**
 * Check if an entity is a duplicate (has numeric suffix) and the original exists.
 */
function checkIfEntityIsDuplicate(
  entity: BaseEntity,
  ctx: ValidationContext,
): ValidationIssue | null {
  const { id } = entity;

  const match = id.match(DUPLICATE_PATTERN);
  if (!match) {
    return null;
  }

  const [, prefix, baseName] = match;
  const originalId = `${prefix}_${baseName}`;
  const collection = getEntityCollection(prefix, ctx);
  const original = collection.get(originalId);

  if (original) {
    const detectedEntityType: 'character' | 'place' = prefix === 'CHAR' ? 'character' : 'place';
    return {
      entityId: id,
      entityType: detectedEntityType,
      validatorId: 'duplicate-entities',
      severity: 'warning',
      message: `Entity appears to be a duplicate of ${originalId} (${original.label})`,
      suggestedFix: {
        field: 'entity',
        value: originalId, // The ID to merge into
        confidence: 'high',
        method: 'merge',
      },
    };
  }

  return null;
}

/**
 * Check if an entity has duplicates (entities with _1, _2 suffixes).
 */
function checkIfEntityHasDuplicates(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id } = entity;

  // Skip if this entity itself is a duplicate
  if (DUPLICATE_PATTERN.test(id)) {
    return issues;
  }

  // Determine the prefix and collection
  let prefix: string;
  let collection: Map<string, BaseEntity>;

  if (id.startsWith('CHAR_')) {
    prefix = 'CHAR';
    collection = ctx.characters as Map<string, BaseEntity>;
  } else if (id.startsWith('PLACE_')) {
    prefix = 'PLACE';
    collection = ctx.places as Map<string, BaseEntity>;
  } else {
    return issues;
  }

  // Look for duplicates with _1, _2, etc. suffixes
  const duplicateIds: string[] = [];
  const duplicateLabels: string[] = [];
  for (const [entityId, ent] of collection) {
    const match = entityId.match(DUPLICATE_PATTERN);
    if (match) {
      const [, , baseName] = match;
      const originalId = `${prefix}_${baseName}`;
      if (originalId === id) {
        duplicateIds.push(entityId);
        duplicateLabels.push(`${entityId} (${ent.label})`);
      }
    }
  }

  if (duplicateIds.length > 0) {
    const detectedEntityType: 'character' | 'place' = prefix === 'CHAR' ? 'character' : 'place';
    issues.push({
      entityId: id,
      entityType: detectedEntityType,
      validatorId: 'duplicate-entities',
      severity: 'warning',
      message: `Entity has ${duplicateIds.length} duplicate(s): ${duplicateLabels.join(', ')}`,
      suggestedFix: {
        field: 'entity',
        value: duplicateIds, // Array of duplicate IDs to merge into this entity
        confidence: 'high',
        method: 'merge', // Merge duplicates into the original entity
      },
    });
  }

  return issues;
}

/**
 * Duplicate Entity Validator
 *
 * Checks for entities with numeric suffix indicating ID collision,
 * and also checks if an entity has duplicates.
 */
export const duplicateEntityValidator: Validator = {
  id: 'duplicate-entities',
  name: 'Duplicate Entity Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check if this entity is a duplicate of another
    const duplicateOfIssue = checkIfEntityIsDuplicate(entity, ctx);
    if (duplicateOfIssue) {
      issues.push(duplicateOfIssue);
    }

    // Check if this entity has duplicates
    const hasDuplicatesIssues = checkIfEntityHasDuplicates(entity, ctx);
    issues.push(...hasDuplicatesIssues);

    return issues;
  },
};
