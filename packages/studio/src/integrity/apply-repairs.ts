/**
 * Apply Repairs
 *
 * Applies fixes to entities based on validation issues.
 * Routes to appropriate repair method (deterministic, LLM, merge, delete).
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import type { ValidationIssue, ValidationContext, FixConfidence } from './integrity-types.js';
import { getEntityType, deleteEntity } from './integrity-helpers.js';
import { applyDeterministicRepair } from './repairs/deterministic-repairs.js';
import { applyLlmRepair } from './repairs/llm-repairs.js';
import { applyDuplicateMerge } from './repairs/duplicate-merge.js';
import { applyImageRepair } from './repairs/image-repairs.js';
import { applyCharacterSpriteRepair } from './repairs/character-sprite-repairs.js';
import { applyLayoutRepair } from './repairs/layout-repairs.js';
import { applyBattleBackgroundRepair } from './repairs/battle-background-repairs.js';
import { addQuestion } from '@dmnpc/core/clarification/clarification-store.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { getEntityFileMtime } from '@dmnpc/core/universe/universe-store.js';

/**
 * Result of applying repairs to an entity.
 */
export interface RepairApplicationResult {
  /** Number of issues successfully fixed */
  fixedCount: number;
  /** Issues that were fixed */
  fixedIssues: ValidationIssue[];
  /** Issues where fix was attempted but failed */
  failedIssues: ValidationIssue[];
}

/**
 * Apply fixes to an entity based on validation issues.
 *
 * @param entity - The entity to repair
 * @param issues - Validation issues found
 * @param ctx - Validation context
 * @param universeCtx - Universe context (mutated during repairs, persisted at end)
 * @param minConfidence - Minimum confidence level to apply ('high' for validation, 'medium' for repair)
 * @param originalMtime - Optional file modification time from when validation started (for optimistic locking)
 */
export async function applyRepairs(
  entity: BaseEntity,
  issues: ValidationIssue[],
  ctx: ValidationContext,
  universeCtx: UniverseContext,
  minConfidence: FixConfidence = 'high',
  originalMtime?: number | null,
): Promise<RepairApplicationResult> {
  const fixedIssues: ValidationIssue[] = [];
  const failedIssues: ValidationIssue[] = [];
  const entityType = getEntityType(entity.id);
  let entityModified = false;
  let entityDeleted = false;

  const allowedConfidences: FixConfidence[] =
    minConfidence === 'medium' ? ['high', 'medium'] : ['high'];

  const repairableIssues = issues.filter(
    (i) => i.suggestedFix && allowedConfidences.includes(i.suggestedFix.confidence),
  );
  if (repairableIssues.length > 0) {
    logger.info(
      'IntegrityRepair',
      `Attempting repairs for ${entity.id}: ${repairableIssues.length} issues (minConfidence=${minConfidence}) out of ${issues.length} total`,
    );
  }

  for (const issue of issues) {
    // If this issue has a clarification question, store it (even without suggestedFix)
    // The clarification system will handle resolution
    if (issue.clarificationQuestion) {
      try {
        await addQuestion(universeCtx.universeId, issue.clarificationQuestion);
        logger.info(
          'IntegrityRepair',
          `Stored clarification question for ${entity.id}: ${issue.clarificationQuestion.question}`,
        );
      } catch (error) {
        logger.error('IntegrityRepair', 'Failed to store clarification question', {
          entityId: entity.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Skip auto-repair - wait for user to answer the question
      continue;
    }

    if (!issue.suggestedFix || !allowedConfidences.includes(issue.suggestedFix.confidence)) {
      continue;
    }

    const { method } = issue.suggestedFix;
    let success = false;

    logger.info(
      'IntegrityRepair',
      `Attempting ${method} repair for ${entity.id} field=${issue.field}`,
    );

    try {
      switch (method) {
        case 'deterministic':
          success = applyDeterministicRepair(entity, issue, ctx);
          if (success) entityModified = true;
          break;

        case 'llm':
          success = await applyLlmRepair(entity, issue, ctx, universeCtx);
          if (success) entityModified = true;
          break;

        case 'merge':
          success = await applyDuplicateMerge(entity, issue, universeCtx);
          if (success) entityDeleted = true; // Duplicate was deleted
          break;

        case 'delete':
          success = deleteEntity(universeCtx, entity.id);
          if (success) entityDeleted = true;
          break;

        case 'image':
          // Image repair handles its own persistence via generateEntityImage
          success = await applyImageRepair(entity, issue, universeCtx);
          // Don't set entityModified - generateEntityImage already persists
          break;

        case 'character-sprite':
          success = await applyCharacterSpriteRepair(entity, issue, universeCtx);
          if (success) entityModified = true;
          break;

        case 'layout':
          // Layout repair generates layout file and objects via getOrGenerateLayout
          success = await applyLayoutRepair(entity, issue, ctx, universeCtx);
          // Don't set entityModified - layout generation handles its own persistence
          break;

        case 'battle-background':
          success = await applyBattleBackgroundRepair(entity, issue, universeCtx);
          if (success) entityModified = true;
          break;

        default:
          logger.warn('IntegrityRepair', `Unknown repair method for ${entity.id}: ${method}`);
      }
    } catch (error) {
      logger.error('IntegrityRepair', 'Repair attempt threw error', {
        entityId: entity.id,
        field: issue.field,
        method,
        error: error instanceof Error ? error.message : String(error),
      });
      success = false;
    }

    if (success) {
      fixedIssues.push(issue);
      logger.info('IntegrityRepair', `Successfully fixed ${entity.id} field=${issue.field}`);
    } else {
      failedIssues.push(issue);
      logger.warn('IntegrityRepair', `Failed to fix ${entity.id} field=${issue.field}`);
    }
  }

  if (entityModified && !entityDeleted) {
    // Optimistic locking: check if entity was modified during validation
    if (originalMtime !== undefined && originalMtime !== null) {
      const currentMtime = await getEntityFileMtime(universeCtx.universeId, entityType, entity.id);
      if (currentMtime !== null && currentMtime !== originalMtime) {
        logger.warn(
          'IntegrityRepair',
          `Entity ${entity.id} modified during validation, skipping repairs (will retry on next scan)`,
        );
        return {
          fixedCount: 0,
          fixedIssues: [],
          failedIssues: [],
        };
      }
    }

    universeCtx.upsertEntity(entityType, entity);
    logger.info(
      'IntegrityRepair',
      `Saved repaired entity ${entity.id}: ${fixedIssues.length} fixes applied`,
    );
  }

  return {
    fixedCount: fixedIssues.length,
    fixedIssues,
    failedIssues,
  };
}
