/**
 * Repair Entity
 *
 * Attempts to repair issues found during validation.
 * Unlike automatic repairs during validation, this can apply medium-confidence fixes.
 */

import type { BaseEntity, UniverseEvent } from '@dmnpc/types/entity';
import type { ValidationIssue, RepairResult, Validator } from './integrity-types.js';
import {
  getEntityType,
  categorizeUnfixedIssues,
  createSummary,
  createEmptyRepairResult,
  groupIssuesByValidator,
  mapToObject,
  formatUnfixedBreakdown,
} from './integrity-helpers.js';
import { getEntityValidators } from './validator-registry.js';
import { buildValidationContext } from './validate-entity.js';
import { applyRepairs } from './apply-repairs.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { isUniverseEvent } from '@dmnpc/core/entities/type-guards.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

/**
 * Repair an entity by re-validating and applying all available fixes.
 * Unlike validateEntity, this also applies medium-confidence fixes.
 *
 * @param entityId - The ID of the entity to repair
 * @param ctx - The universe context containing the entity
 * @param customValidators - Optional list of validators to use (defaults to all validators)
 * @returns RepairResult with issues found and fixed
 */
export async function repairEntity(
  entityId: string,
  ctx: UniverseContext,
  customValidators?: Validator[],
): Promise<RepairResult> {
  const startTime = Date.now();

  try {
    const validationCtx = buildValidationContext(ctx);

    let entity: BaseEntity | UniverseEvent | undefined;
    let entityType;

    try {
      entityType = getEntityType(entityId);
    } catch (error) {
      logger.error('IntegrityRepair', `Invalid entity ID format: ${entityId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
      logger.warn('IntegrityRepair', `Entity not found for repair: ${entityId}`);
      return createEmptyRepairResult(entityId, entityType);
    }

    const allIssues: ValidationIssue[] = [];
    const validators = customValidators ?? getEntityValidators();

    for (const validator of validators) {
      try {
        const issues = await validator.validate(entity, validationCtx);
        allIssues.push(...issues);
      } catch (error) {
        logger.error('IntegrityRepair', 'Validator failed', {
          validatorId: validator.id,
          entityId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Events only have validation, not repairs — applyRepairs operates on BaseEntity fields
    let fixedIssues: ValidationIssue[] = [];
    let failedIssues: ValidationIssue[] = [];
    if (!isUniverseEvent(entity)) {
      const repairResult = await applyRepairs(entity, allIssues, validationCtx, ctx, 'medium');
      fixedIssues = repairResult.fixedIssues;
      failedIssues = repairResult.failedIssues;
    }

    const issuesUnfixed = categorizeUnfixedIssues(allIssues, fixedIssues, failedIssues);

    const summary = createSummary(allIssues, fixedIssues, issuesUnfixed);

    const issuesByValidatorMap = groupIssuesByValidator(allIssues);
    const issuesByValidator = mapToObject(issuesByValidatorMap);

    const duration = Date.now() - startTime;

    logger.info(
      'IntegrityRepair',
      `Entity repaired ${entityId} (${entityType}): ${allIssues.length} issues found, ${fixedIssues.length} fixed, ${duration}ms${formatUnfixedBreakdown(issuesUnfixed)}`,
    );

    return {
      entityId,
      entityType,
      issuesFound: allIssues.length,
      issuesFixed: fixedIssues.length,
      issues: allIssues,
      issuesFixedList: fixedIssues,
      issuesUnfixed,
      summary,
      issuesByValidator,
    };
  } catch (error) {
    logger.error('IntegrityRepair', 'Repair failed', {
      entityId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createEmptyRepairResult(entityId, 'character');
  }
}
