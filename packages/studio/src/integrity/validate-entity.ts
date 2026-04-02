/**
 * Validate Entity
 *
 * Core function for validating a single entity.
 * This is the main entry point for the integrity service.
 */

import type {
  BaseEntity,
  Character,
  Place,
  ObjectEntity,
  UniverseEvent,
} from '@dmnpc/types/entity';
import type {
  ValidationResult,
  ValidationContext,
  ValidationIssue,
  Validator,
} from './integrity-types.js';
import {
  getEntityType,
  categorizeUnfixedIssues,
  createSummary,
  createEmptyResult,
  groupIssuesByValidator,
  mapToObject,
  formatUnfixedBreakdown,
  formatValidatorCounts,
} from './integrity-helpers.js';
import { getEntityValidators } from './validator-registry.js';
import { applyRepairs } from './apply-repairs.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { isUniverseEvent } from '@dmnpc/core/entities/type-guards.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { getEntityFileMtime } from '@dmnpc/core/universe/universe-store.js';

/**
 * Build a validation context from a UniverseContext.
 * Uses the already-loaded WorldBible from the context instead of re-loading from disk.
 */
export function buildValidationContext(ctx: UniverseContext): ValidationContext {
  const universe = ctx.universe;

  // Build maps for fast lookup - use ctx getters which have the loaded entities
  const characters = new Map<string, Character>();
  const places = new Map<string, Place>();
  const objects = new Map<string, ObjectEntity>();
  const events = new Map<string, UniverseEvent>();

  for (const char of ctx.characters) {
    characters.set(char.id, char);
  }

  for (const place of ctx.places) {
    places.set(place.id, place);
  }

  for (const obj of ctx.objects) {
    objects.set(obj.id, obj);
  }

  for (const event of ctx.events) {
    events.set(event.id, event);
  }

  // Build valid race IDs set
  const validRaceIds = new Set<string>();
  for (const race of universe.races) {
    validRaceIds.add(race.id);
  }

  // Use WorldBible from context (already loaded by UniverseContext.loadAtEntryPoint)
  const worldBible = ctx.worldBible;

  return {
    universe,
    characters,
    places,
    objects,
    events,
    validRaceIds,
    rootPlaceId: universe.rootPlaceId || '',
    worldBible: worldBible ?? undefined,
  };
}

/**
 * Validate a single entity and apply repairs.
 *
 * @param entityId - The ID of the entity to validate
 * @param ctx - The universe context containing the entity
 * @param customValidators - Optional list of validators to use (defaults to all validators)
 * @returns ValidationResult with issues found and fixed
 */
export async function validateEntity(
  entityId: string,
  ctx: UniverseContext,
  customValidators?: Validator[],
): Promise<ValidationResult> {
  const startTime = Date.now();

  try {
    const validationCtx = buildValidationContext(ctx);

    let entity: BaseEntity | UniverseEvent | undefined;
    let entityType;

    try {
      entityType = getEntityType(entityId);
    } catch (error) {
      logger.error('IntegrityService', `Invalid entity ID format: ${entityId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return createEmptyResult(entityId, 'character');
    }

    if (entityType === 'character') {
      entity = validationCtx.characters.get(entityId);
    } else if (entityType === 'place') {
      entity = validationCtx.places.get(entityId);
    } else if (entityType === 'object') {
      entity = validationCtx.objects.get(entityId);
    } else {
      entity = validationCtx.events.get(entityId);
    }

    if (!entity) {
      return createEmptyResult(entityId, entityType);
    }

    // Capture file modification time for optimistic locking
    const originalMtime = await getEntityFileMtime(ctx.universeId, entityType, entityId);

    const allIssues: ValidationIssue[] = [];
    const validators = customValidators ?? getEntityValidators();

    for (const validator of validators) {
      try {
        const issues = await validator.validate(entity, validationCtx);
        allIssues.push(...issues);
      } catch (error) {
        logger.error('IntegrityService', 'Validator failed', {
          validatorId: validator.id,
          entityId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Apply repairs for high-confidence fixes only (with optimistic locking via mtime)
    // Events only have validation, not repairs — applyRepairs operates on BaseEntity fields
    let fixedIssues: ValidationIssue[] = [];
    let failedIssues: ValidationIssue[] = [];
    let fixedCount = 0;
    if (!isUniverseEvent(entity)) {
      const repairResult = await applyRepairs(
        entity,
        allIssues,
        validationCtx,
        ctx,
        'high',
        originalMtime,
      );
      fixedIssues = repairResult.fixedIssues;
      failedIssues = repairResult.failedIssues;
      fixedCount = repairResult.fixedCount;
    }

    const issuesUnfixed = categorizeUnfixedIssues(allIssues, fixedIssues, failedIssues);

    const summary = createSummary(allIssues, fixedIssues, issuesUnfixed);

    const issuesByValidatorMap = groupIssuesByValidator(allIssues);
    const issuesByValidator = mapToObject(issuesByValidatorMap);

    const duration = Date.now() - startTime;

    logger.info(
      'IntegrityService',
      `Entity validated ${entityId} (${entityType}): ${allIssues.length} issues found, ${fixedCount} fixed, ${duration}ms [${formatValidatorCounts(allIssues)}]${formatUnfixedBreakdown(issuesUnfixed)}`,
    );

    return {
      entityId,
      entityType,
      issuesFound: allIssues.length,
      issuesFixed: fixedCount,
      issues: allIssues,
      issuesFixedList: fixedIssues,
      issuesUnfixed,
      summary,
      issuesByValidator,
    };
  } catch (error) {
    logger.error('IntegrityService', 'Validation failed', {
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createEmptyResult(entityId, 'character');
  }
}
