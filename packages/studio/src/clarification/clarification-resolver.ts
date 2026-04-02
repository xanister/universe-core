/**
 * Clarification Resolver
 *
 * Orchestrates applying answers by routing to the appropriate provider.
 * Each provider knows how to resolve its own questions.
 */

import { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';
import {
  getQuestion,
  getAnswer,
  getAnsweredQuestions,
  getPendingQuestions,
  updateQuestionStatus,
} from '@dmnpc/core/clarification/clarification-store.js';
import type {
  ClarificationResolutionContext,
  ClarificationResolutionResult,
  BulkClarificationResolutionResult,
} from '@dmnpc/core/clarification/clarification-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';

/**
 * Apply a single answer to a question.
 * Routes to the provider that generated the question.
 *
 * @param universeCtx - Universe context for making changes
 * @param questionId - Question ID to resolve
 * @returns Resolution result
 */
export async function applyAnswer(
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
  questionId: string,
): Promise<ClarificationResolutionResult> {
  const universeId = universeCtx.universeId;
  const startTime = Date.now();

  try {
    const question = await getQuestion(universeId, questionId);
    if (!question) {
      return {
        questionId,
        success: false,
        modifiedEntityIds: [],
        error: `Question not found: ${questionId}`,
      };
    }

    if (question.status !== 'answered') {
      return {
        questionId,
        success: false,
        modifiedEntityIds: [],
        error: `Question not in 'answered' status (current: ${question.status})`,
      };
    }

    const answer = await getAnswer(universeId, questionId);
    if (!answer) {
      return {
        questionId,
        success: false,
        modifiedEntityIds: [],
        error: `Answer not found for question: ${questionId}`,
      };
    }

    const provider = clarificationRegistry.getProvider(question.providerId);
    if (!provider) {
      return {
        questionId,
        success: false,
        modifiedEntityIds: [],
        error: `Provider not found: ${question.providerId}`,
      };
    }

    const ctx: ClarificationResolutionContext = {
      universeCtx,
      question,
      answer,
    };

    logger.info(
      'ClarificationResolver',
      `Resolving question ${questionId} via provider ${provider.providerId}`,
    );

    const modifiedEntityIds = await provider.resolveAnswer(ctx);

    await updateQuestionStatus(universeId, questionId, 'applied');

    const duration = Date.now() - startTime;
    logger.info(
      'ClarificationResolver',
      `Resolved question ${questionId}: ${modifiedEntityIds.length} entities modified (${duration}ms)`,
    );

    return {
      questionId,
      success: true,
      modifiedEntityIds,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('ClarificationResolver', `Failed to resolve question ${questionId}`, {
      error: errorMessage,
      universeId,
    });

    return {
      questionId,
      success: false,
      modifiedEntityIds: [],
      error: errorMessage,
    };
  }
}

/**
 * Apply all answered but unapplied questions for a universe.
 *
 * @param universeCtx - Universe context for making changes
 * @returns Bulk resolution result
 */
export async function applyAllAnswers(
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<BulkClarificationResolutionResult> {
  const universeId = universeCtx.universeId;
  const answeredQuestions = await getAnsweredQuestions(universeId);

  if (answeredQuestions.length === 0) {
    return {
      results: [],
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
    };
  }

  logger.info(
    'ClarificationResolver',
    `Applying ${answeredQuestions.length} answered questions for ${universeId}`,
  );

  const results: ClarificationResolutionResult[] = [];

  for (const question of answeredQuestions) {
    const result = await applyAnswer(universeCtx, question.id);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  logger.info(
    'ClarificationResolver',
    `Bulk resolution complete: ${successCount} succeeded, ${failureCount} failed`,
  );

  return {
    results,
    totalProcessed: results.length,
    successCount,
    failureCount,
  };
}

/**
 * Apply answers for specific questions.
 *
 * @param universeCtx - Universe context for making changes
 * @param questionIds - Question IDs to resolve
 * @returns Bulk resolution result
 */
export async function applyAnswers(
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
  questionIds: string[],
): Promise<BulkClarificationResolutionResult> {
  const universeId = universeCtx.universeId;
  if (questionIds.length === 0) {
    return {
      results: [],
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
    };
  }

  logger.info(
    'ClarificationResolver',
    `Applying ${questionIds.length} specific questions for ${universeId}`,
  );

  const results: ClarificationResolutionResult[] = [];

  for (const questionId of questionIds) {
    const result = await applyAnswer(universeCtx, questionId);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return {
    results,
    totalProcessed: results.length,
    successCount,
    failureCount,
  };
}

/**
 * Skip a question (use the current guess).
 * Updates status to 'skipped' without calling the provider.
 *
 * @param universeId - Universe ID
 * @param questionId - Question ID to skip
 */
export async function skipQuestion(universeId: string, questionId: string): Promise<void> {
  const question = await getQuestion(universeId, questionId);
  if (!question) {
    throw new Error(`Question not found: ${questionId}`);
  }

  if (question.status !== 'pending') {
    throw new Error(`Can only skip pending questions (current: ${question.status})`);
  }

  await updateQuestionStatus(universeId, questionId, 'skipped');
  logger.info('ClarificationResolver', `Skipped question: ${questionId}`);
}

/**
 * Skip all pending questions (use current guesses).
 *
 * @param universeId - Universe ID
 * @returns Number of questions skipped
 */
export async function skipAllPending(universeId: string): Promise<number> {
  const pending = await getPendingQuestions(universeId);

  for (const question of pending) {
    await updateQuestionStatus(universeId, question.id, 'skipped');
  }

  if (pending.length > 0) {
    logger.info(
      'ClarificationResolver',
      `Skipped ${pending.length} pending questions for ${universeId}`,
    );
  }

  return pending.length;
}
