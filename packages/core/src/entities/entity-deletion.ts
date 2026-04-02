/**
 * Entity Deletion Service
 *
 * Handles entity deletion with automatic cleanup of orphaned references.
 * When an entity is deleted, all references to it in other entities are cleaned up.
 */

import type { EntityType } from '@dmnpc/types/entity';
import { logger } from '../infra/logger.js';
import { UniverseContext } from '../universe/universe-context.js';
import { deletePlaceLayoutSync } from '../universe/universe-store.js';
import createHttpError from 'http-errors';

export interface DeleteEntityResult {
  success: boolean;
  entityId: string;
  entityType: EntityType;
  cleanedUp: {
    relationshipsRemoved: number;
    eventsUpdated: number;
    exitsDeleted: number;
    charactersRelocated: number;
    objectsDeleted: number;
    placesDeleted: number;
  };
}

export interface DeleteEntityOptions {
  /** Return null instead of throwing when entity not found (default: true = throws) */
  throwOnNotFound?: boolean;
}

/**
 * Delete an entity and clean up all orphaned references.
 * This is the centralized deletion function - all entity deletions should go through here.
 *
 * Cleanup by entity type:
 * - Character: Remove from all entities' relationships[] where targetId matches,
 *              remove from events' witnessIds[], null subjectId on events about that character
 * - Place: Cascade-delete entire subtree (descendant places, objects, all characters).
 *          Surviving entities' relationships and routine placeIds referencing any deleted
 *          entity are cleaned up.
 * - Object (exit): No special cleanup needed (was: clear reverseObjectId)
 * - Event: No cleanup currently
 */
export function deleteEntityWithCleanup(
  ctx: UniverseContext,
  entityId: string,
  options: DeleteEntityOptions = {},
): DeleteEntityResult | null {
  const { throwOnNotFound = true } = options;

  const result: DeleteEntityResult = {
    success: false,
    entityId,
    entityType: 'character', // Will be updated
    cleanedUp: {
      relationshipsRemoved: 0,
      eventsUpdated: 0,
      exitsDeleted: 0,
      charactersRelocated: 0,
      objectsDeleted: 0,
      placesDeleted: 0,
    },
  };

  // Determine entity type and verify it exists
  let entityType: EntityType;
  let entityExists = false;

  if (entityId.startsWith('CHAR_')) {
    entityType = 'character';
    entityExists = ctx.characters.some((c) => c.id === entityId);
    if (!entityExists) {
      if (throwOnNotFound) {
        throw createHttpError.NotFound(`Character ${entityId} not found`);
      }
      return null;
    }
  } else if (entityId.startsWith('PLACE_')) {
    entityType = 'place';
    entityExists = ctx.places.some((p) => p.id === entityId);
    if (!entityExists) {
      if (throwOnNotFound) {
        throw createHttpError.NotFound(`Place ${entityId} not found`);
      }
      return null;
    }
  } else if (entityId.startsWith('OBJ_')) {
    entityType = 'object';
    entityExists = ctx.objects.some((o) => o.id === entityId);
    if (!entityExists) {
      if (throwOnNotFound) {
        throw createHttpError.NotFound(`Object ${entityId} not found`);
      }
      return null;
    }
  } else if (entityId.startsWith('EVENT_')) {
    entityType = 'event';
    entityExists = ctx.events.some((e) => e.id === entityId);
    if (!entityExists) {
      if (throwOnNotFound) {
        throw createHttpError.NotFound(`Event ${entityId} not found`);
      }
      return null;
    }
  } else {
    throw createHttpError.BadRequest(`Unknown entity type for ID: ${entityId}`);
  }

  result.entityType = entityType;

  // Perform cleanup based on entity type
  if (entityType === 'character') {
    result.cleanedUp.relationshipsRemoved = cleanupCharacterReferences(ctx, entityId);
    result.cleanedUp.eventsUpdated = cleanupEventReferences(ctx, entityId);
  } else if (entityType === 'place') {
    const placeCleanup = cleanupPlaceReferences(ctx, entityId);
    result.cleanedUp.relationshipsRemoved = placeCleanup.relationshipsRemoved;
    result.cleanedUp.exitsDeleted = placeCleanup.exitsDeleted;
    result.cleanedUp.charactersRelocated = placeCleanup.charactersRelocated;
    result.cleanedUp.objectsDeleted = placeCleanup.objectsDeleted;
    result.cleanedUp.placesDeleted = placeCleanup.placesDeleted;
  } else if (entityType === 'object') {
    // Check if it's an exit object before cleaning up
    const obj = ctx.objects.find((o) => o.id === entityId);
    if (obj?.info.purpose === 'exit') {
      cleanupExitReferences(ctx, entityId);
    }
  } else {
    // Event deletion: no cross-entity cleanup needed
  }

  // Delete the entity itself
  const deleted = ctx.deleteEntity(entityType, entityId);
  if (!deleted) {
    throw createHttpError.InternalServerError(`Failed to delete entity ${entityId}`);
  }

  // Note: Manual persistence removed - relying on async handler from route context

  result.success = true;

  logger.info(
    'EntityDeletion',
    `Entity deleted with cleanup: entityId=${entityId} entityType=${entityType} relationshipsRemoved=${result.cleanedUp.relationshipsRemoved} exitsDeleted=${result.cleanedUp.exitsDeleted} charactersRelocated=${result.cleanedUp.charactersRelocated} objectsDeleted=${result.cleanedUp.objectsDeleted} placesDeleted=${result.cleanedUp.placesDeleted}`,
  );

  return result;
}

/**
 * Remove a character from all entities' relationships.
 * Returns the number of relationships removed.
 */
function cleanupCharacterReferences(ctx: UniverseContext, characterId: string): number {
  let removed = 0;

  // Clean up character relationships
  for (const char of ctx.characters) {
    if (char.id === characterId) continue;

    if (Array.isArray(char.relationships)) {
      const originalLength = char.relationships.length;
      char.relationships = char.relationships.filter((rel) => rel.targetId !== characterId);
      const removedCount = originalLength - char.relationships.length;
      if (removedCount > 0) {
        removed += removedCount;
        ctx.upsertEntity('character', char);
      }
    }
  }

  // Clean up place relationships
  for (const place of ctx.places) {
    if (Array.isArray(place.relationships)) {
      const originalLength = place.relationships.length;
      place.relationships = place.relationships.filter((rel) => rel.targetId !== characterId);
      const removedCount = originalLength - place.relationships.length;
      if (removedCount > 0) {
        removed += removedCount;
        ctx.upsertEntity('place', place);
      }
    }
  }

  // Clean up object relationships
  for (const obj of ctx.objects) {
    if (Array.isArray(obj.relationships)) {
      const originalLength = obj.relationships.length;
      obj.relationships = obj.relationships.filter((rel) => rel.targetId !== characterId);
      const removedCount = originalLength - obj.relationships.length;
      if (removedCount > 0) {
        removed += removedCount;
        ctx.upsertEntity('object', obj);
      }
    }
  }

  return removed;
}

/**
 * Clean up event references to a deleted character.
 * - Remove characterId from witnessIds arrays
 * - Null out subjectId where it matches the deleted character
 * Returns the number of events updated.
 */
function cleanupEventReferences(ctx: UniverseContext, characterId: string): number {
  let updated = 0;

  for (const event of ctx.events) {
    let modified = false;

    // Remove from witnessIds
    if (Array.isArray(event.witnessIds)) {
      const originalLength = event.witnessIds.length;
      event.witnessIds = event.witnessIds.filter((id) => id !== characterId);
      if (event.witnessIds.length !== originalLength) {
        modified = true;
      }
      // Normalize empty array to null
      if (event.witnessIds.length === 0) {
        event.witnessIds = null;
      }
    }

    // Null out subjectId if it references the deleted character
    if (event.subjectId === characterId) {
      event.subjectId = null;
      modified = true;
    }

    if (modified) {
      ctx.upsertEntity('event', event);
      updated++;
    }
  }

  return updated;
}

/**
 * Collect all descendant place IDs recursively (breadth-first).
 * Does NOT include the starting placeId itself.
 */
function collectDescendantPlaceIds(ctx: UniverseContext, placeId: string): string[] {
  const descendants: string[] = [];
  const queue = [placeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = ctx.places.filter((p) => p.position.parent === currentId);
    for (const child of children) {
      descendants.push(child.id);
      queue.push(child.id);
    }
  }

  return descendants;
}

/**
 * Clean up references to a deleted place and all its descendants.
 * Cascade-deletes the entire subtree: child places, objects, and characters
 * within the deleted place and all descendant places.
 *
 * All characters and objects inside the subtree are deleted.
 * Characters outside the subtree that reference any deleted place in routines
 * get those routine placeIds cleared.
 * Relationships referencing any deleted entity are removed from surviving entities.
 */
function cleanupPlaceReferences(
  ctx: UniverseContext,
  placeId: string,
): {
  relationshipsRemoved: number;
  exitsDeleted: number;
  charactersRelocated: number;
  objectsDeleted: number;
  placesDeleted: number;
} {
  let relationshipsRemoved = 0;
  let exitsDeleted = 0;
  const charactersRelocated = 0; // No relocation: all entities in subtree are deleted
  let objectsDeleted = 0;
  let placesDeleted = 0;

  // Collect the full subtree of place IDs to delete (descendants only; the
  // caller deletes the root place after this function returns)
  const descendantPlaceIds = collectDescendantPlaceIds(ctx, placeId);
  const allDeletedPlaceIds = new Set([placeId, ...descendantPlaceIds]);

  // Track all entity IDs that will be deleted so we can clean up references
  const allDeletedEntityIds = new Set<string>(allDeletedPlaceIds);

  // Delete layout files for all places in the subtree
  for (const deletedPlaceId of allDeletedPlaceIds) {
    deletePlaceLayoutSync(ctx.universeId, deletedPlaceId);
  }

  // --- Phase 1: Delete all objects inside the subtree ---
  for (const obj of ctx.objects) {
    if (allDeletedPlaceIds.has(obj.position.parent!)) {
      allDeletedEntityIds.add(obj.id);
      if (obj.info.purpose === 'exit') {
        exitsDeleted++;
      } else {
        objectsDeleted++;
      }
      ctx.deleteEntity('object', obj.id);
    }
  }

  // --- Phase 2: Delete all characters inside the subtree ---
  for (const char of ctx.characters) {
    if (allDeletedPlaceIds.has(char.position.parent!)) {
      allDeletedEntityIds.add(char.id);
      ctx.deleteEntity('character', char.id);
    }
  }

  // --- Phase 3: Delete descendant places (deepest first to avoid parent-before-child issues) ---
  // Reverse so children are deleted before parents
  for (const descId of descendantPlaceIds.reverse()) {
    ctx.deleteEntity('place', descId);
    placesDeleted++;
  }

  // --- Phase 4: Clean up surviving entities that reference any deleted entity ---

  // Characters outside the subtree: clear routine placeIds, remove relationships
  for (const char of ctx.characters) {
    if (allDeletedEntityIds.has(char.id)) continue;
    let modified = false;

    // Clear routine placeIds referencing any deleted place
    if (char.info.routine) {
      if (allDeletedPlaceIds.has(char.info.routine.home.placeId!)) {
        char.info.routine.home.placeId = null;
        modified = true;
      }
      if (char.info.routine.work && allDeletedPlaceIds.has(char.info.routine.work.placeId!)) {
        char.info.routine.work.placeId = null;
        modified = true;
      }
      if (
        char.info.routine.leisure?.favoriteSpot &&
        allDeletedPlaceIds.has(char.info.routine.leisure.favoriteSpot.placeId!)
      ) {
        char.info.routine.leisure.favoriteSpot.placeId = null;
        modified = true;
      }
    }

    // Clear travel destination referencing any deleted place
    if (char.destinationPlaceId && allDeletedPlaceIds.has(char.destinationPlaceId)) {
      char.destinationPlaceId = null;
      modified = true;
    }

    // Clear travel path if any segment references a deleted place
    if (char.travelPath) {
      const hasDeletedRef = char.travelPath.segments.some(
        (seg) => allDeletedPlaceIds.has(seg.fromPlaceId) || allDeletedPlaceIds.has(seg.toPlaceId),
      );
      if (hasDeletedRef) {
        char.travelPath = null;
        char.travelSegmentIndex = null;
        modified = true;
      }
    }

    // Remove deleted ports from vessel routes
    if (char.info.vesselRoutes) {
      for (let i = char.info.vesselRoutes.length - 1; i >= 0; i--) {
        const route = char.info.vesselRoutes[i];
        const originalLen = route.ports.length;
        route.ports = route.ports.filter((portId) => !allDeletedPlaceIds.has(portId));
        if (route.ports.length < 2) {
          char.info.vesselRoutes.splice(i, 1);
          modified = true;
        } else if (route.ports.length < originalLen) {
          modified = true;
        }
      }
      if (char.info.vesselRoutes.length === 0) {
        char.info.vesselRoutes = null;
      }
    }

    // Remove relationships referencing any deleted entity
    if (Array.isArray(char.relationships)) {
      const originalLength = char.relationships.length;
      char.relationships = char.relationships.filter(
        (rel) => !allDeletedEntityIds.has(rel.targetId),
      );
      const removedCount = originalLength - char.relationships.length;
      if (removedCount > 0) {
        relationshipsRemoved += removedCount;
        modified = true;
      }
    }

    if (modified) {
      ctx.upsertEntity('character', char);
    }
  }

  // Surviving places: remove relationships referencing any deleted entity
  for (const place of ctx.places) {
    if (allDeletedEntityIds.has(place.id)) continue;

    if (Array.isArray(place.relationships)) {
      const originalLength = place.relationships.length;
      place.relationships = place.relationships.filter(
        (rel) => !allDeletedEntityIds.has(rel.targetId),
      );
      const removedCount = originalLength - place.relationships.length;
      if (removedCount > 0) {
        relationshipsRemoved += removedCount;
        ctx.upsertEntity('place', place);
      }
    }
  }

  // Surviving objects: remove relationships referencing any deleted entity
  for (const obj of ctx.objects) {
    if (allDeletedEntityIds.has(obj.id)) continue;

    if (Array.isArray(obj.relationships)) {
      const originalLength = obj.relationships.length;
      obj.relationships = obj.relationships.filter((rel) => !allDeletedEntityIds.has(rel.targetId));
      const removedCount = originalLength - obj.relationships.length;
      if (removedCount > 0) {
        relationshipsRemoved += removedCount;
        ctx.upsertEntity('object', obj);
      }
    }
  }

  // Clean up event references to any deleted character
  for (const deletedId of allDeletedEntityIds) {
    if (deletedId.startsWith('CHAR_')) {
      cleanupEventReferences(ctx, deletedId);
    }
  }

  return { relationshipsRemoved, exitsDeleted, charactersRelocated, objectsDeleted, placesDeleted };
}

/**
 * Clean up references to a deleted exit object.
 * In the hierarchical exit model, exits are one-way (child to parent)
 * and don't have reverse exit references, so no cleanup is needed.
 */
function cleanupExitReferences(_ctx: UniverseContext, _exitId: string): void {
  // No-op: exits are one-way in the hierarchical model.
  // Exit data lives in the interaction type registry, not in shared references.
}
