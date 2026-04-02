/**
 * Clarification System
 *
 * Re-exports core clarification infrastructure from @dmnpc/core
 * and the resolver (which stays in studio).
 */

export type {
  QuestionCategory,
  ClarificationOption,
  ClarificationStatus,
  ClarificationQuestion,
  ClarificationAnswer,
  ClarificationResolutionContext,
  ClarificationProvider,
  UniverseClarifications,
  ClarificationSummary,
  ClarificationResolutionResult,
  BulkClarificationResolutionResult,
} from '@dmnpc/core/clarification/clarification-types.js';

export {
  QUESTION_CATEGORIES,
  generateClarificationId,
  createClarificationQuestion,
} from '@dmnpc/core/clarification/clarification-types.js';

export { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';

export {
  loadClarifications,
  saveClarifications,
  getOrCreateClarifications,
  addQuestion,
  addQuestions,
  getQuestion,
  getAllQuestions,
  getPendingQuestions,
  getAnsweredQuestions,
  updateQuestionStatus,
  deleteQuestion,
  recordAnswer,
  getAnswer,
  getClarificationSummary,
  clearClarifications,
  pruneResolvedQuestions,
} from '@dmnpc/core/clarification/clarification-store.js';

export {
  applyAnswer,
  applyAllAnswers,
  applyAnswers,
  skipQuestion,
  skipAllPending,
} from './clarification-resolver.js';
