/**
 * Plot Clarification Store
 *
 * Persistence layer for plot clarification questions and answers.
 * Stores data globally in plots/clarifications.json since plots are not universe-specific.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { PLOT_CLARIFICATIONS_PATH } from '@dmnpc/data';
import { isErrnoException } from '../entities/type-guards.js';
import type {
  ClarificationQuestion,
  ClarificationAnswer,
  ClarificationStatus,
  ClarificationSummary,
  QuestionCategory,
} from './clarification-types.js';
import { logger } from '../infra/logger.js';

/**
 * Persisted plot clarification state.
 */
interface PlotClarifications {
  /** All questions (including resolved) */
  questions: ClarificationQuestion[];
  /** All answers */
  answers: ClarificationAnswer[];
  /** Last update timestamp */
  lastUpdated: string;
}

/**
 * Get the path to the global plot clarifications file.
 */
function getPlotClarificationsPath(): string {
  return PLOT_CLARIFICATIONS_PATH;
}

/**
 * Load plot clarifications.
 *
 * @returns Clarifications data or null if file doesn't exist
 */
async function loadPlotClarifications(): Promise<PlotClarifications | null> {
  const filePath = getPlotClarificationsPath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- self-authored JSON data, trust-the-contract (same pattern as readJsonFile)
    return JSON.parse(content) as PlotClarifications;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    logger.error('PlotClarificationStore', 'Failed to load plot clarifications', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Save plot clarifications.
 *
 * @param data - Clarifications data to save
 */
async function savePlotClarifications(data: PlotClarifications): Promise<void> {
  const filePath = getPlotClarificationsPath();

  data.lastUpdated = new Date().toISOString();

  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    logger.info(
      'PlotClarificationStore',
      `Saved plot clarifications: ${data.questions.length} questions, ${data.answers.length} answers`,
    );
  } catch (error) {
    logger.error('PlotClarificationStore', 'Failed to save plot clarifications', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get or create plot clarifications.
 * Creates an empty structure if none exists.
 *
 * @returns Clarifications data (never null)
 */
async function getOrCreatePlotClarifications(): Promise<PlotClarifications> {
  const existing = await loadPlotClarifications();
  if (existing) {
    return existing;
  }

  const empty: PlotClarifications = {
    questions: [],
    answers: [],
    lastUpdated: new Date().toISOString(),
  };

  await savePlotClarifications(empty);
  return empty;
}

/**
 * Add multiple questions to the store.
 *
 * @param questions - Questions to add
 */
export async function addPlotQuestions(questions: ClarificationQuestion[]): Promise<void> {
  if (questions.length === 0) return;

  const data = await getOrCreatePlotClarifications();
  let addedCount = 0;
  let skippedCount = 0;

  for (const question of questions) {
    const existingIndex = data.questions.findIndex((q) => q.id === question.id);
    if (existingIndex >= 0) {
      const existing = data.questions[existingIndex];
      if (existing.status === 'applied') {
        question.status = 'pending';
        data.questions[existingIndex] = question;
        addedCount++;
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

  await savePlotClarifications(data);
  if (addedCount > 0 || skippedCount > 0) {
    logger.info(
      'PlotClarificationStore',
      `Added/updated ${addedCount} questions${skippedCount > 0 ? ` (skipped ${skippedCount} already processed)` : ''}`,
    );
  }
}

/**
 * Get a specific question by ID.
 *
 * @param questionId - Question ID
 * @returns The question or undefined if not found
 */
export async function getPlotQuestion(
  questionId: string,
): Promise<ClarificationQuestion | undefined> {
  const data = await loadPlotClarifications();
  return data?.questions.find((q) => q.id === questionId);
}

/**
 * Get all questions.
 *
 * @returns Array of questions
 */
export async function getAllPlotQuestions(): Promise<ClarificationQuestion[]> {
  const data = await loadPlotClarifications();
  return data?.questions ?? [];
}

/**
 * Get questions with a specific status.
 *
 * @param status - Status to filter by
 * @returns Filtered questions
 */
async function getPlotQuestionsByStatus(
  status: ClarificationStatus,
): Promise<ClarificationQuestion[]> {
  const data = await loadPlotClarifications();
  return data?.questions.filter((q) => q.status === status) ?? [];
}

/**
 * Get pending questions.
 *
 * @returns Pending questions
 */
export async function getPendingPlotQuestions(): Promise<ClarificationQuestion[]> {
  return getPlotQuestionsByStatus('pending');
}

/**
 * Update a question's status.
 *
 * @param questionId - Question ID
 * @param status - New status
 */
export async function updatePlotQuestionStatus(
  questionId: string,
  status: ClarificationStatus,
): Promise<void> {
  const data = await getOrCreatePlotClarifications();
  const question = data.questions.find((q) => q.id === questionId);

  if (!question) {
    throw new Error(`Question not found: ${questionId}`);
  }

  question.status = status;
  await savePlotClarifications(data);
  logger.info('PlotClarificationStore', `Updated question ${questionId} status to ${status}`);
}

/**
 * Record an answer to a question.
 * Updates the question status to 'answered'.
 *
 * @param answer - Answer to record
 */
export async function recordPlotAnswer(answer: ClarificationAnswer): Promise<void> {
  const data = await getOrCreatePlotClarifications();

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

  await savePlotClarifications(data);
  logger.info('PlotClarificationStore', `Recorded answer for question: ${answer.questionId}`);
}

/**
 * Get a summary of plot clarifications.
 *
 * @returns Summary statistics
 */
export async function getPlotClarificationSummary(): Promise<ClarificationSummary> {
  const data = await loadPlotClarifications();
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
