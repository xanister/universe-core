/**
 * Duplicate Entity Merge
 *
 * Merges duplicate entities into the original:
 * 1. Keep original entity as canonical
 * 2. Fill empty fields from duplicate
 * 3. Merge arrays with deduplication
 * 4. Update all references across universe
 * 5. Delete duplicate entity
 */

import type { BaseEntity, Character, EntityType } from '@dmnpc/types/entity';
import { isCharacter } from '@dmnpc/core/entities/type-guards.js';
import { UNIVERSES_DIR } from '@dmnpc/data';
import type { ValidationIssue } from '../integrity-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { unlink } from 'fs/promises';
import { join } from 'path';

/**
 * Apply a duplicate merge repair.
 *
 * Handles two cases:
 * 1. Entity IS a duplicate: suggestedFix.value is a string (original ID to merge into)
 * 2. Entity HAS duplicates: suggestedFix.value is an array (duplicate IDs to merge into this entity)
 *
 * Returns true if the merge was successful, false otherwise.
 */
export async function applyDuplicateMerge(
  entity: BaseEntity,
  issue: ValidationIssue,
  ctx: UniverseContext,
): Promise<boolean> {
  if (!issue.suggestedFix || issue.suggestedFix.method !== 'merge') {
    return false;
  }

  const fixValue = issue.suggestedFix.value;

  // Case 1: Entity IS a duplicate, merge into original
  if (typeof fixValue === 'string') {
    return await mergeDuplicateIntoOriginal(entity, fixValue, ctx);
  }

  // Case 2: Entity HAS duplicates, merge them into this entity
  if (
    Array.isArray(fixValue) &&
    fixValue.every((item): item is string => typeof item === 'string')
  ) {
    return await mergeDuplicatesIntoEntity(entity, fixValue, ctx);
  }

  logger.error('IntegrityRepair', 'Invalid merge fix value', {
    entityId: entity.id,
    fixValue,
  });
  return false;
}

/**
 * Merge a duplicate entity into its original.
 * Called when validating/repairing an entity with a _1, _2, etc. suffix.
 */
async function mergeDuplicateIntoOriginal(
  duplicateEntity: BaseEntity,
  originalId: string,
  ctx: UniverseContext,
): Promise<boolean> {
  const duplicateId = duplicateEntity.id;

  try {
    let original: BaseEntity | undefined;
    let entityType: EntityType;

    if (originalId.startsWith('CHAR_')) {
      original = ctx.findCharacter(originalId);
      entityType = 'character';
    } else if (originalId.startsWith('PLACE_')) {
      original = ctx.findPlace(originalId);
      entityType = 'place';
    } else if (originalId.startsWith('OBJ_')) {
      original = ctx.findObject(originalId);
      entityType = 'object';
    } else {
      logger.error('IntegrityRepair', 'Unknown entity type for merge', {
        originalId,
      });
      return false;
    }

    if (!original) {
      logger.error('IntegrityRepair', 'Original entity not found for merge', {
        originalId,
      });
      return false;
    }

    const mergedEntity = mergeEntities(original, duplicateEntity, entityType);

    ctx.upsertEntity(entityType, mergedEntity);

    updateAllReferences(ctx, duplicateId, originalId);

    await deleteDuplicateFile(ctx.universeId, entityType, duplicateId);

    logger.info(
      'IntegrityRepair',
      `Merged duplicate into original: ${duplicateId} -> ${originalId} (${entityType})`,
    );

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', 'Failed to merge duplicate into original', {
      duplicateId,
      originalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Merge multiple duplicates into the original entity.
 * Called when validating/repairing an entity that has _1, _2, etc. variants.
 */
async function mergeDuplicatesIntoEntity(
  originalEntity: BaseEntity,
  duplicateIds: string[],
  ctx: UniverseContext,
): Promise<boolean> {
  const originalId = originalEntity.id;
  const allSucceeded = true;

  try {
    let entityType: EntityType;

    if (originalId.startsWith('CHAR_')) {
      entityType = 'character';
    } else if (originalId.startsWith('PLACE_')) {
      entityType = 'place';
    } else if (originalId.startsWith('OBJ_')) {
      entityType = 'object';
    } else {
      logger.error('IntegrityRepair', 'Unknown entity type for merge', {
        originalId,
      });
      return false;
    }

    let mergedEntity: BaseEntity = structuredClone(originalEntity);

    for (const duplicateId of duplicateIds) {
      let duplicate: BaseEntity | undefined;

      if (entityType === 'character') {
        duplicate = ctx.findCharacter(duplicateId);
      } else if (entityType === 'place') {
        duplicate = ctx.findPlace(duplicateId);
      } else {
        duplicate = ctx.findObject(duplicateId);
      }

      if (!duplicate) {
        throw new Error(`IntegrityRepair: Duplicate not found for merge: ${duplicateId}`);
      }

      mergedEntity = mergeEntities(mergedEntity, duplicate, entityType);

      updateAllReferences(ctx, duplicateId, originalId);

      await deleteDuplicateFile(ctx.universeId, entityType, duplicateId);

      logger.info(
        'IntegrityRepair',
        `Merged duplicate into original: ${duplicateId} -> ${originalId} (${entityType})`,
      );
    }

    ctx.upsertEntity(entityType, mergedEntity);

    logger.info(
      'IntegrityRepair',
      `Completed merging all duplicates into ${originalId}: ${duplicateIds.length} duplicates (${entityType})`,
    );

    return allSucceeded;
  } catch (error) {
    logger.error('IntegrityRepair', 'Failed to merge duplicates into entity', {
      originalId,
      duplicateIds,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Merge fields from duplicate into original.
 * Original takes precedence for non-empty fields.
 */
function mergeEntities(
  original: BaseEntity,
  duplicate: BaseEntity,
  entityType: EntityType,
): BaseEntity {
  const merged: BaseEntity = structuredClone(original);

  if (!merged.description && duplicate.description) {
    merged.description = duplicate.description;
  }
  if (!merged.short_description && duplicate.short_description) {
    merged.short_description = duplicate.short_description;
  }

  if (duplicate.tags.length > 0) {
    const tagSet = new Set([...merged.tags, ...duplicate.tags]);
    merged.tags = Array.from(tagSet);
  }

  if (duplicate.relationships.length > 0) {
    const existingTargetIds = new Set(merged.relationships.map((r) => r.targetId));
    for (const rel of duplicate.relationships) {
      if (!existingTargetIds.has(rel.targetId)) {
        merged.relationships.push(rel);
        existingTargetIds.add(rel.targetId);
      }
    }
  }

  if (entityType === 'character' && isCharacter(merged) && isCharacter(duplicate)) {
    mergeCharacterInfo(merged, duplicate);
  }

  return merged;
}

/**
 * Merge character-specific info fields.
 */
function mergeCharacterInfo(original: Character, duplicate: Character): void {
  const origInfo = original.info;
  const dupInfo = duplicate.info;

  if (!origInfo.race && dupInfo.race) origInfo.race = dupInfo.race;
  if (!origInfo.birthdate && dupInfo.birthdate) origInfo.birthdate = dupInfo.birthdate;
  if (!origInfo.birthPlace && dupInfo.birthPlace) origInfo.birthPlace = dupInfo.birthPlace;
  if (!origInfo.eyeColor && dupInfo.eyeColor) origInfo.eyeColor = dupInfo.eyeColor;
  if (!origInfo.gender && dupInfo.gender) origInfo.gender = dupInfo.gender;
  if (!origInfo.hairColor && dupInfo.hairColor) origInfo.hairColor = dupInfo.hairColor;
  if (!origInfo.personality && dupInfo.personality) origInfo.personality = dupInfo.personality;
  if (!origInfo.title && dupInfo.title) origInfo.title = dupInfo.title;
  if (!origInfo.conversationContext && dupInfo.conversationContext)
    origInfo.conversationContext = dupInfo.conversationContext;

  if (dupInfo.aliases.length > 0) {
    const aliasSet = new Set([...origInfo.aliases, ...dupInfo.aliases]);
    origInfo.aliases = Array.from(aliasSet);
  }

  // Don't merge messages, journal, or storytellerState - these are session-specific
}

/**
 * Update all references to the duplicate ID across the universe.
 */
function updateAllReferences(ctx: UniverseContext, duplicateId: string, originalId: string): void {
  for (const character of ctx.characters) {
    let modified = false;

    if (character.position.parent === duplicateId) {
      character.position.parent = originalId;
      modified = true;
    }

    // Note: destinationPlaceId is already a place ID, so no update needed here.

    if (character.info.routine) {
      if (character.info.routine.home.placeId === duplicateId) {
        character.info.routine.home.placeId = originalId;
        modified = true;
      }
      if (character.info.routine.work?.placeId === duplicateId) {
        character.info.routine.work.placeId = originalId;
        modified = true;
      }
      if (character.info.routine.leisure?.favoriteSpot?.placeId === duplicateId) {
        character.info.routine.leisure.favoriteSpot.placeId = originalId;
        modified = true;
      }
    }

    if (character.relationships.length > 0) {
      for (const rel of character.relationships) {
        if (rel.targetId === duplicateId) {
          rel.targetId = originalId;
          modified = true;
        }
      }
      const seen = new Set<string>();
      character.relationships = character.relationships.filter((rel) => {
        if (seen.has(rel.targetId)) return false;
        seen.add(rel.targetId);
        return true;
      });
    }

    for (const entry of character.info.journal) {
      for (const fact of entry.facts) {
        if (fact.subjectId === duplicateId) {
          fact.subjectId = originalId;
          modified = true;
        }
        if (fact.placeId === duplicateId) {
          fact.placeId = originalId;
          modified = true;
        }
      }
    }

    if (character.info.storytellerState?.eventHistory) {
      for (const event of character.info.storytellerState.eventHistory) {
        const idx = event.affectedEntities.indexOf(duplicateId);
        if (idx !== -1) {
          event.affectedEntities[idx] = originalId;
          modified = true;
        }
      }
    }

    if (modified) {
      ctx.upsertEntity('character', character);
    }
  }

  for (const exit of ctx.objects) {
    if (exit.info.purpose !== 'exit') continue;

    let modified = false;

    // Update position.parent (where exit is located)
    if (exit.position.parent === duplicateId) {
      exit.position.parent = originalId;
      modified = true;
    }

    // Exit targets are derived from hierarchy (position.parent), no separate field to update.

    if (exit.relationships.length > 0) {
      for (const rel of exit.relationships) {
        if (rel.targetId === duplicateId) {
          rel.targetId = originalId;
          modified = true;
        }
      }
      const seen = new Set<string>();
      exit.relationships = exit.relationships.filter((rel: { targetId: string }) => {
        if (seen.has(rel.targetId)) return false;
        seen.add(rel.targetId);
        return true;
      });
    }

    if (modified) {
      ctx.upsertEntity('object', exit);
    }
  }

  for (const place of ctx.places) {
    let modified = false;

    if (place.relationships.length > 0) {
      for (const rel of place.relationships) {
        if (rel.targetId === duplicateId) {
          rel.targetId = originalId;
          modified = true;
        }
      }
      const seen = new Set<string>();
      place.relationships = place.relationships.filter((rel) => {
        if (seen.has(rel.targetId)) return false;
        seen.add(rel.targetId);
        return true;
      });
    }

    if (modified) {
      ctx.upsertEntity('place', place);
    }
  }
}

/**
 * Delete the duplicate entity file.
 */
async function deleteDuplicateFile(
  universeId: string,
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  const dirNames: Record<EntityType, string> = {
    character: 'characters',
    place: 'places',
    event: 'events',
    object: 'objects',
  };

  const filePath = join(
    UNIVERSES_DIR,
    universeId,
    'entities',
    dirNames[entityType],
    `${entityId}.json`,
  );

  try {
    await unlink(filePath);
    logger.info('IntegrityRepair', `Deleted duplicate entity file: ${filePath}`);
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to delete duplicate file ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
