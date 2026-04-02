/**
 * Orphaned References Validator
 *
 * Detects references to non-existent entities.
 * Repair: Deterministic - reset to rootPlaceId, remove invalid IDs, or delete orphaned exits.
 */

import type {
  BaseEntity,
  Character,
  Place,
  UniverseEvent,
  ObjectEntity,
} from '@dmnpc/types/entity';
import type { PlotState } from '@dmnpc/types/npc';
import {
  isCharacter,
  isPlace,
  isObjectEntity,
  isUniverseEvent,
} from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Validate storyteller event references (triggeredByEventId in turning points).
 * Checks that triggeredByEventId references an event that exists in the same plot's events array.
 */
function validateStorytellerEventRefs(characterId: string, plots: PlotState[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const plot of plots) {
    // Build a set of valid event IDs for this plot
    const plotEventIds = new Set(plot.events.map((e) => e.id));

    // Check each turning point's triggeredByEventId
    for (const tp of plot.plan.turningPoints) {
      if (tp.triggeredByEventId && !plotEventIds.has(tp.triggeredByEventId)) {
        issues.push({
          entityId: characterId,
          entityType: 'character',
          validatorId: 'orphaned-refs',
          severity: 'warning',
          field: `info.storytellerState.activePlots[${plot.id}].plan.turningPoints[${tp.id}].triggeredByEventId`,
          message: `Turning point ${tp.id} references non-existent event: ${tp.triggeredByEventId}`,
          suggestedFix: {
            field: `info.storytellerState.activePlots[${plot.id}].plan.turningPoints[${tp.id}].triggeredByEventId`,
            value: undefined,
            confidence: 'high',
            method: 'deterministic',
          },
        });
      }
    }
  }

  return issues;
}

/**
 * Validate character references (position.parent, routine placeIds, relationship IDs).
 */
function validateCharacterRefs(character: Character, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, position, info, relationships } = character;

  // Check position.parent - must exist and reference a valid place
  if (!position.parent) {
    issues.push({
      entityId: id,
      entityType: 'character',
      validatorId: 'orphaned-refs',
      severity: 'error',
      field: 'position.parent',
      message: 'Character has empty position.parent',
      suggestedFix: {
        field: 'position.parent',
        value: ctx.rootPlaceId,
        confidence: 'high',
        method: 'deterministic',
      },
    });
  } else if (!ctx.places.has(position.parent)) {
    issues.push({
      entityId: id,
      entityType: 'character',
      validatorId: 'orphaned-refs',
      severity: 'error',
      field: 'position.parent',
      message: `Character references non-existent place: ${position.parent}`,
      suggestedFix: {
        field: 'position.parent',
        value: ctx.rootPlaceId,
        confidence: 'high',
        method: 'deterministic',
      },
    });
  }

  // Check routine placeIds
  if (info.routine) {
    if (info.routine.home.placeId && !ctx.places.has(info.routine.home.placeId)) {
      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'orphaned-refs',
        severity: 'warning',
        field: 'info.routine.home.placeId',
        message: `Character routine references non-existent home place: ${info.routine.home.placeId}`,
        suggestedFix: {
          field: 'info.routine.home.placeId',
          value: undefined, // Clear the invalid placeId, keep description
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }

    if (info.routine.work?.placeId && !ctx.places.has(info.routine.work.placeId)) {
      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'orphaned-refs',
        severity: 'warning',
        field: 'info.routine.work.placeId',
        message: `Character routine references non-existent work place: ${info.routine.work.placeId}`,
        suggestedFix: {
          field: 'info.routine.work.placeId',
          value: undefined,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }

    if (
      info.routine.leisure?.favoriteSpot?.placeId &&
      !ctx.places.has(info.routine.leisure.favoriteSpot.placeId)
    ) {
      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'orphaned-refs',
        severity: 'warning',
        field: 'info.routine.leisure.favoriteSpot.placeId',
        message: `Character routine references non-existent leisure place: ${info.routine.leisure.favoriteSpot.placeId}`,
        suggestedFix: {
          field: 'info.routine.leisure.favoriteSpot.placeId',
          value: undefined,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }
  }

  // Check destinationPlaceId
  if (character.destinationPlaceId && !ctx.places.has(character.destinationPlaceId)) {
    issues.push({
      entityId: id,
      entityType: 'character',
      validatorId: 'orphaned-refs',
      severity: 'warning',
      field: 'destinationPlaceId',
      message: `Character travel destination references non-existent place: ${character.destinationPlaceId}`,
      suggestedFix: {
        field: 'destinationPlaceId',
        value: undefined,
        confidence: 'high',
        method: 'deterministic',
      },
    });
  }

  // Check travelPath segments
  if (character.travelPath) {
    const invalidSegments = character.travelPath.segments.filter(
      (seg) => !ctx.places.has(seg.fromPlaceId) || !ctx.places.has(seg.toPlaceId),
    );
    if (invalidSegments.length > 0) {
      const invalidIds = [
        ...new Set(
          invalidSegments.flatMap((seg) =>
            [seg.fromPlaceId, seg.toPlaceId].filter((id) => !ctx.places.has(id)),
          ),
        ),
      ];
      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'orphaned-refs',
        severity: 'warning',
        field: 'travelPath',
        message: `Character travel path references non-existent place(s): ${invalidIds.join(', ')}`,
        suggestedFix: {
          field: 'travelPath',
          value: undefined,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }
  }

  // Check vesselRoutes port references
  if (info.vesselRoutes) {
    for (let i = 0; i < info.vesselRoutes.length; i++) {
      const route = info.vesselRoutes[i];
      const invalidPorts = route.ports.filter((portId) => !ctx.places.has(portId));
      if (invalidPorts.length > 0) {
        const validPorts = route.ports.filter((portId) => ctx.places.has(portId));
        issues.push({
          entityId: id,
          entityType: 'character',
          validatorId: 'orphaned-refs',
          severity: 'warning',
          field: `info.vesselRoutes[${i}].ports`,
          message: `Vessel route "${route.name ?? route.id}" references non-existent port(s): ${invalidPorts.join(', ')}`,
          suggestedFix: {
            field: `info.vesselRoutes[${i}].ports`,
            value: validPorts.length >= 2 ? validPorts : undefined,
            confidence: 'high',
            method: 'deterministic',
          },
        });
      }
    }
  }

  // Check relationship references
  {
    const orphanedRels = relationships.filter(
      (rel) => !ctx.characters.has(rel.targetId) && !ctx.places.has(rel.targetId),
    );

    if (orphanedRels.length > 0) {
      const orphanedIds = orphanedRels.map((rel) => rel.targetId);
      const validRels = relationships.filter(
        (rel) => ctx.characters.has(rel.targetId) || ctx.places.has(rel.targetId),
      );

      issues.push({
        entityId: id,
        entityType: 'character',
        validatorId: 'orphaned-refs',
        severity: 'warning',
        field: 'relationships',
        message: `Character has relationships to non-existent entities: ${orphanedIds.join(', ')}`,
        suggestedFix: {
          field: 'relationships',
          value: validRels,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }
  }

  // Check storyteller event references (triggeredByEventId in turning points)
  if (info.storytellerState?.activePlots) {
    issues.push(...validateStorytellerEventRefs(id, info.storytellerState.activePlots));
  }

  return issues;
}

/**
 * Validate place references (position.parent, relationships).
 */
function validatePlaceRefs(place: Place, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, position, relationships } = place;

  // Check position.parent - must exist or be null (for root places)
  if (position.parent !== null && !ctx.places.has(position.parent)) {
    issues.push({
      entityId: id,
      entityType: 'place',
      validatorId: 'orphaned-refs',
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

  // Validate relationships
  {
    const orphanedRels = relationships.filter(
      (rel) => !ctx.characters.has(rel.targetId) && !ctx.places.has(rel.targetId),
    );

    if (orphanedRels.length > 0) {
      const orphanedIds = orphanedRels.map((rel) => rel.targetId);
      const validRels = relationships.filter(
        (rel) => ctx.characters.has(rel.targetId) || ctx.places.has(rel.targetId),
      );

      issues.push({
        entityId: id,
        entityType: 'place',
        validatorId: 'orphaned-refs',
        severity: 'warning',
        field: 'relationships',
        message: `Place has relationships to non-existent entities: ${orphanedIds.join(', ')}`,
        suggestedFix: {
          field: 'relationships',
          value: validRels,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }
  }

  return issues;
}

/**
 * Check if an entity ID exists in any of the entity maps.
 */
function entityExists(refId: string, ctx: ValidationContext): boolean {
  return ctx.characters.has(refId) || ctx.places.has(refId) || ctx.events.has(refId);
}

/**
 * Validate universe event references (witnessIds, placeId, subjectId).
 */
function validateUniverseEventRefs(
  event: UniverseEvent,
  ctx: ValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, witnessIds, placeId, subjectId } = event;

  // Check witnessIds - must reference existing characters
  if (witnessIds && witnessIds.length > 0) {
    const invalidIds = witnessIds.filter((charId) => !ctx.characters.has(charId));

    if (invalidIds.length > 0) {
      const validIds = witnessIds.filter((charId) => ctx.characters.has(charId));

      issues.push({
        entityId: id,
        entityType: 'event',
        validatorId: 'orphaned-refs',
        severity: 'warning',
        field: 'witnessIds',
        message: `Event references non-existent character witnesses: ${invalidIds.join(', ')}`,
        suggestedFix: {
          field: 'witnessIds',
          value: validIds.length > 0 ? validIds : undefined,
          confidence: 'high',
          method: 'deterministic',
        },
      });
    }
  }

  // Check placeId - must reference existing place
  if (placeId && !ctx.places.has(placeId)) {
    issues.push({
      entityId: id,
      entityType: 'event',
      validatorId: 'orphaned-refs',
      severity: 'warning',
      field: 'placeId',
      message: `Event references non-existent place: ${placeId}`,
      suggestedFix: {
        field: 'placeId',
        value: undefined,
        confidence: 'high',
        method: 'deterministic',
      },
    });
  }

  // Check subjectId - must reference existing entity (any type)
  if (subjectId && !entityExists(subjectId, ctx)) {
    issues.push({
      entityId: id,
      entityType: 'event',
      validatorId: 'orphaned-refs',
      severity: 'warning',
      field: 'subjectId',
      message: `Event references non-existent subject entity: ${subjectId}`,
      suggestedFix: {
        field: 'subjectId',
        value: undefined,
        confidence: 'high',
        method: 'deterministic',
      },
    });
  }

  return issues;
}

/**
 * Validate exit object references.
 * In the hierarchical exit model, exits are one-way from child to parent.
 * Target is derived from hierarchy (exit's place's parent), not stored in options.
 */
function validateObjectRefs(obj: ObjectEntity, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Only check exits
  if (obj.info.purpose !== 'exit') {
    return issues;
  }

  // Check exit is in a valid place
  const exitPlaceId = obj.position.parent;
  if (!exitPlaceId) {
    issues.push({
      entityId: obj.id,
      entityType: 'object',
      validatorId: 'orphaned-refs',
      severity: 'error',
      field: 'position.parent',
      message: `Exit has no parent place - orphaned exit`,
      suggestedFix: {
        field: 'delete',
        value: true,
        confidence: 'high',
        method: 'deterministic',
      },
    });
    return issues;
  }

  const exitPlace = ctx.places.get(exitPlaceId);
  if (!exitPlace) {
    issues.push({
      entityId: obj.id,
      entityType: 'object',
      validatorId: 'orphaned-refs',
      severity: 'error',
      field: 'position.parent',
      message: `Exit's parent place does not exist: ${exitPlaceId}`,
      suggestedFix: {
        field: 'delete',
        value: true,
        confidence: 'high',
        method: 'deterministic',
      },
    });
    return issues;
  }

  // Check exit's target (derived from hierarchy) exists
  const targetPlaceId = exitPlace.position.parent;
  if (!targetPlaceId) {
    issues.push({
      entityId: obj.id,
      entityType: 'object',
      validatorId: 'orphaned-refs',
      severity: 'warning',
      field: 'position.parent',
      message: `Exit in root place has no target (place has no parent)`,
      suggestedFix: {
        field: 'delete',
        value: true,
        confidence: 'medium',
        method: 'deterministic',
      },
    });
    return issues;
  }

  if (!ctx.places.has(targetPlaceId)) {
    issues.push({
      entityId: obj.id,
      entityType: 'object',
      validatorId: 'orphaned-refs',
      severity: 'error',
      field: 'position.parent',
      message: `Exit's target place (derived from hierarchy) does not exist: ${targetPlaceId}`,
      suggestedFix: {
        field: 'delete',
        value: true,
        confidence: 'high',
        method: 'deterministic',
      },
    });
  }

  return issues;
}

/**
 * Orphaned References Validator
 *
 * Checks for references to non-existent entities across all entity types.
 */
export const orphanedRefsValidator: Validator = {
  id: 'orphaned-refs',
  name: 'Orphaned References Validator',

  validate(entity: BaseEntity | UniverseEvent, ctx: ValidationContext): ValidationIssue[] {
    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return validateCharacterRefs(entity, ctx);
    }

    if (entity.id.startsWith('PLACE_') && isPlace(entity)) {
      return validatePlaceRefs(entity, ctx);
    }

    if (entity.id.startsWith('EVENT_') && isUniverseEvent(entity)) {
      return validateUniverseEventRefs(entity, ctx);
    }

    if (entity.id.startsWith('OBJ_') && isObjectEntity(entity)) {
      return validateObjectRefs(entity, ctx);
    }

    return [];
  },
};
