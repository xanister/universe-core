/**
 * Clarification Store
 *
 * Persistence layer for clarification questions and answers.
 * Stores data in universes/definitions/{universeId}/clarifications.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUniversePath } from '@dmnpc/data';
import { isErrnoException } from '../entities/type-guards.js';
import type {
  ClarificationQuestion,
  ClarificationAnswer,
  UniverseClarifications,
  ClarificationStatus,
  ClarificationSummary,
  QuestionCategory,
} from './clarification-types.js';
import { logger } from '../infra/logger.js';

/**
 * Get the path to the clarifications file for a universe.
 */
function getClarificationsPath(universeId: string): string {
  return path.join(getUniversePath(universeId), 'clarifications.json');
}

/**
 * Load clarifications for a universe.
 *
 * @param universeId - Universe ID
 * @returns Clarifications data or null if file doesn't exist
 */
export async function loadClarifications(
  universeId: string,
): Promise<UniverseClarifications | null> {
  const filePath = getClarificationsPath(universeId);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- self-authored JSON data, trust-the-contract (same pattern as readJsonFile)
    return JSON.parse(content) as UniverseClarifications;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    logger.error('ClarificationStore', `Failed to load clarifications for ${universeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Save clarifications for a universe.
 *
 * @param universeId - Universe ID
 * @param data - Clarifications data to save
 */
export async function saveClarifications(
  universeId: string,
  data: UniverseClarifications,
): Promise<void> {
  const filePath = getClarificationsPath(universeId);
  const dir = path.dirname(filePath);

  data.lastUpdated = new Date().toISOString();

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    logger.info(
      'ClarificationStore',
      `Saved clarifications for ${universeId}: ${data.questions.length} questions, ${data.answers.length} answers`,
    );
  } catch (error) {
    logger.error('ClarificationStore', `Failed to save clarifications for ${universeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get or create clarifications for a universe.
 * Creates an empty structure if none exists.
 *
 * @param universeId - Universe ID
 * @returns Clarifications data (never null)
 */
export async function getOrCreateClarifications(
  universeId: string,
): Promise<UniverseClarifications> {
  const existing = await loadClarifications(universeId);
  if (existing) {
    return existing;
  }

  const empty: UniverseClarifications = {
    universeId,
    questions: [],
    answers: [],
    lastUpdated: new Date().toISOString(),
  };

  await saveClarifications(universeId, empty);
  return empty;
}

/**
 * Add a question to the store.
 * Deduplicates by ID - if a question with the same ID exists, behavior depends on status:
 * - 'pending': Update with new question data
 * - 'applied': Reset to pending (fix didn't work, issue recurred)
 * - 'answered' or 'skipped': Skip (user already made a choice)
 *
 * @param universeId - Universe ID
 * @param question - Question to add
 */
export async function addQuestion(
  universeId: string,
  question: ClarificationQuestion,
): Promise<void> {
  const data = await getOrCreateClarifications(universeId);

  const existingIndex = data.questions.findIndex((q) => q.id === question.id);
  if (existingIndex >= 0) {
    const existing = data.questions[existingIndex];

    if (existing.status === 'applied') {
      // If question was already applied but the same issue is detected again,
      // it means the fix didn't work - reset to pending so user can re-answer
      question.status = 'pending';
      data.questions[existingIndex] = question;
      logger.info(
        'ClarificationStore',
        `Reset previously-applied question to pending (issue recurred): ${question.id}`,
      );
    } else if (existing.status === 'pending') {
      data.questions[existingIndex] = question;
      logger.info('ClarificationStore', `Updated existing question: ${question.id}`);
    } else {
      logger.info(
        'ClarificationStore',
        `Skipped question update (status=${existing.status}): ${question.id}`,
      );
    }
  } else {
    data.questions.push(question);
    logger.info('ClarificationStore', `Added new question: ${question.id}`);
  }

  await saveClarifications(universeId, data);
}

/**
 * Add multiple questions to the store.
 *
 * @param universeId - Universe ID
 * @param questions - Questions to add
 */
export async function addQuestions(
  universeId: string,
  questions: ClarificationQuestion[],
): Promise<void> {
  if (questions.length === 0) return;

  const data = await getOrCreateClarifications(universeId);
  let addedCount = 0;
  let skippedCount = 0;

  for (const question of questions) {
    const existingIndex = data.questions.findIndex((q) => q.id === question.id);
    if (existingIndex >= 0) {
      const existing = data.questions[existingIndex];
      // If question was already applied but the same issue is detected again,
      // it means the fix didn't work - reset to pending so user can re-answer
      if (existing.status === 'applied') {
        question.status = 'pending';
        data.questions[existingIndex] = question;
        addedCount++;
        logger.info(
          'ClarificationStore',
          `Reset previously-applied question to pending (issue recurred): ${question.id}`,
        );
      } else if (existing.status === 'pending') {
        data.questions[existingIndex] = question;
        addedCount++;
      } else {
        skippedCount++;
      }
    } else {
      data.questions.push(question);
      addedCount++;
    }
  }

  await saveClarifications(universeId, data);
  if (addedCount > 0 || skippedCount > 0) {
    logger.info(
      'ClarificationStore',
      `Added/updated ${addedCount} questions for ${universeId}${skippedCount > 0 ? ` (skipped ${skippedCount} already processed)` : ''}`,
    );
  }
}

/**
 * Get a specific question by ID.
 *
 * @param universeId - Universe ID
 * @param questionId - Question ID
 * @returns The question or undefined if not found
 */
export async function getQuestion(
  universeId: string,
  questionId: string,
): Promise<ClarificationQuestion | undefined> {
  const data = await loadClarifications(universeId);
  return data?.questions.find((q) => q.id === questionId);
}

/**
 * Get all questions for a universe.
 *
 * @param universeId - Universe ID
 * @returns Array of questions
 */
export async function getAllQuestions(universeId: string): Promise<ClarificationQuestion[]> {
  const data = await loadClarifications(universeId);
  return data?.questions ?? [];
}

/**
 * Get questions with a specific status.
 *
 * @param universeId - Universe ID
 * @param status - Status to filter by
 * @returns Filtered questions
 */
async function getQuestionsByStatus(
  universeId: string,
  status: ClarificationStatus,
): Promise<ClarificationQuestion[]> {
  const data = await loadClarifications(universeId);
  return data?.questions.filter((q) => q.status === status) ?? [];
}

/**
 * Get pending questions (not answered or applied).
 *
 * @param universeId - Universe ID
 * @returns Pending questions
 */
export async function getPendingQuestions(universeId: string): Promise<ClarificationQuestion[]> {
  return getQuestionsByStatus(universeId, 'pending');
}

/**
 * Get answered but not yet applied questions.
 *
 * @param universeId - Universe ID
 * @returns Answered questions awaiting application
 */
export async function getAnsweredQuestions(universeId: string): Promise<ClarificationQuestion[]> {
  return getQuestionsByStatus(universeId, 'answered');
}

/**
 * Update a question's status.
 *
 * @param universeId - Universe ID
 * @param questionId - Question ID
 * @param status - New status
 */
export async function updateQuestionStatus(
  universeId: string,
  questionId: string,
  status: ClarificationStatus,
): Promise<void> {
  const data = await getOrCreateClarifications(universeId);
  const question = data.questions.find((q) => q.id === questionId);

  if (!question) {
    throw new Error(`Question not found: ${questionId}`);
  }

  question.status = status;
  await saveClarifications(universeId, data);
  logger.info('ClarificationStore', `Updated question ${questionId} status to ${status}`);
}

/**
 * Delete a question.
 *
 * @param universeId - Universe ID
 * @param questionId - Question ID
 * @returns true if deleted, false if not found
 */
export async function deleteQuestion(universeId: string, questionId: string): Promise<boolean> {
  const data = await loadClarifications(universeId);
  if (!data) return false;

  const initialLength = data.questions.length;
  data.questions = data.questions.filter((q) => q.id !== questionId);

  if (data.questions.length < initialLength) {
    data.answers = data.answers.filter((a) => a.questionId !== questionId);
    await saveClarifications(universeId, data);
    logger.info('ClarificationStore', `Deleted question: ${questionId}`);
    return true;
  }

  return false;
}

/**
 * Record an answer to a question.
 * Updates the question status to 'answered'.
 *
 * @param universeId - Universe ID
 * @param answer - Answer to record
 */
export async function recordAnswer(universeId: string, answer: ClarificationAnswer): Promise<void> {
  const data = await getOrCreateClarifications(universeId);

  const question = data.questions.find((q) => q.id === answer.questionId);
  if (!question) {
    throw new Error(`Question not found: ${answer.questionId}`);
  }

  const existingIndex = data.answers.findIndex((a) => a.questionId === answer.questionId);
  if (existingIndex >= 0) {
    data.answers[existingIndex] = answer;
  } else {
    data.answers.push(answer);
  }

  question.status = 'answered';

  await saveClarifications(universeId, data);
  logger.info('ClarificationStore', `Recorded answer for question: ${answer.questionId}`);
}

/**
 * Get the answer for a specific question.
 *
 * @param universeId - Universe ID
 * @param questionId - Question ID
 * @returns The answer or undefined if not answered
 */
export async function getAnswer(
  universeId: string,
  questionId: string,
): Promise<ClarificationAnswer | undefined> {
  const data = await loadClarifications(universeId);
  return data?.answers.find((a) => a.questionId === questionId);
}

/**
 * Get a summary of clarifications for a universe.
 *
 * @param universeId - Universe ID
 * @returns Summary statistics
 */
export async function getClarificationSummary(universeId: string): Promise<ClarificationSummary> {
  const data = await loadClarifications(universeId);
  const questions = data?.questions ?? [];

  const byStatus: Record<ClarificationStatus, number> = {
    pending: 0,
    answered: 0,
    applied: 0,
    skipped: 0,
  };

  const byCategory: Record<QuestionCategory, number> = {
    classification: 0,
    hierarchy: 0,
    temporal: 0,
    relationship: 0,
    identity: 0,
    attribute: 0,
  };

  const byProvider: Record<string, number> = {};

  for (const q of questions) {
    byStatus[q.status]++;
    byCategory[q.category]++;
    byProvider[q.providerId] = (byProvider[q.providerId] ?? 0) + 1;
  }

  return {
    total: questions.length,
    byStatus,
    byCategory,
    byProvider,
  };
}

/**
 * Clear all clarifications for a universe.
 * Use with caution - this deletes all questions and answers.
 *
 * @param universeId - Universe ID
 */
export async function clearClarifications(universeId: string): Promise<void> {
  const filePath = getClarificationsPath(universeId);

  try {
    await fs.unlink(filePath);
    logger.info('ClarificationStore', `Cleared all clarifications for ${universeId}`);
  } catch (error) {
    if (!(isErrnoException(error) && error.code === 'ENOENT')) {
      logger.error('ClarificationStore', `Failed to clear clarifications for ${universeId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * Remove all resolved (applied or skipped) questions.
 * Useful for cleaning up after a generation cycle.
 *
 * @param universeId - Universe ID
 * @returns Number of questions removed
 */
export async function pruneResolvedQuestions(universeId: string): Promise<number> {
  const data = await loadClarifications(universeId);
  if (!data) return 0;

  const initialCount = data.questions.length;
  const resolvedIds = new Set(
    data.questions.filter((q) => q.status === 'applied' || q.status === 'skipped').map((q) => q.id),
  );

  data.questions = data.questions.filter((q) => !resolvedIds.has(q.id));
  data.answers = data.answers.filter((a) => !resolvedIds.has(a.questionId));

  const removedCount = initialCount - data.questions.length;
  if (removedCount > 0) {
    await saveClarifications(universeId, data);
    logger.info(
      'ClarificationStore',
      `Pruned ${removedCount} resolved questions from ${universeId}`,
    );
  }

  return removedCount;
}
