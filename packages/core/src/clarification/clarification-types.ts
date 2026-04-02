/**
 * Clarification System - Types
 *
 * Core types and interfaces for the clarification system.
 * This system captures uncertainty during generation and validation,
 * presents questions to users, and applies their answers.
 */

/** Categories for grouping and routing questions */
export const QUESTION_CATEGORIES = [
  'classification', // Is this a harbor/district/region?
  'hierarchy', // Is X inside Y? Same country?
  'temporal', // Contemporary or historical?
  'relationship', // How are entities related?
  'identity', // Are these the same entity?
  'attribute', // What is the value of X?
] as const;

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

/** Option for multiple-choice questions */
export interface ClarificationOption {
  /** Unique ID for this option */
  id: string;
  /** Human-readable label */
  label: string;
  /** Optional description/explanation */
  description?: string;
}

/** Status of a clarification question */
export type ClarificationStatus = 'pending' | 'answered' | 'applied' | 'skipped';

/**
 * A question generated when the system encounters uncertainty.
 * Can be created by validators, generators, or document processors.
 */
export interface ClarificationQuestion {
  /** Unique ID (format: CLARIFY_{providerId}_{timestamp}_{hash}) */
  id: string;

  /** Provider that generated this question */
  providerId: string;

  /** Category for grouping in UI */
  category: QuestionCategory;

  /** Human-readable question */
  question: string;

  /** Why this matters / additional context */
  context: string;

  /** Predefined options (if multiple choice) */
  options?: ClarificationOption[];

  /** Allow freeform text input */
  freeformAllowed: boolean;

  /** LLM's confidence in its current guess (0-1) */
  confidence: number;

  /** What the system chose (for display) */
  currentGuess?: string;

  /** Entity IDs affected by this answer */
  affectedEntityIds: string[];

  /** Source document filename (if from extraction) */
  sourceDocument?: string;

  /** Associated validation issue ID (if from validator) */
  validationIssueId?: string;

  /** Provider-specific data needed for resolution */
  resolutionContext: Record<string, unknown>;

  /** When this question was created */
  createdAt: string;

  /** Status of this question */
  status: ClarificationStatus;
}

/** User's answer to a clarification question */
export interface ClarificationAnswer {
  /** ID of the question being answered */
  questionId: string;
  /** Selected option ID (if multiple choice) */
  selectedOptionId?: string;
  /** Freeform text (if allowed) */
  freeformText?: string;
  /** When the answer was submitted */
  answeredAt: string;
}

/** Context passed to provider when resolving an answer */
export interface ClarificationResolutionContext {
  /** Universe context for making changes */
  universeCtx: import('../universe/universe-context.js').UniverseContext;
  /** The question being resolved */
  question: ClarificationQuestion;
  /** The user's answer */
  answer: ClarificationAnswer;
}

/**
 * Interface for any service that can generate clarification questions.
 * Implement this to add question generation to validators, generators, etc.
 */
export interface ClarificationProvider {
  /** Unique identifier for this provider */
  readonly providerId: string;

  /** Human-readable name */
  readonly providerName: string;

  /** Categories this provider can generate */
  readonly categories: readonly QuestionCategory[];

  /**
   * Called when a user answers a question from this provider.
   * The provider should apply the answer and update affected entities.
   *
   * @param ctx - Resolution context with universe, question, and answer
   * @returns Entity IDs that were modified
   */
  resolveAnswer(ctx: ClarificationResolutionContext): string[] | Promise<string[]>;
}

/** Persisted clarification state for a universe */
export interface UniverseClarifications {
  /** Universe ID */
  universeId: string;
  /** All questions (including resolved) */
  questions: ClarificationQuestion[];
  /** All answers */
  answers: ClarificationAnswer[];
  /** Last update timestamp */
  lastUpdated: string;
}

/** Summary of clarifications for a universe */
export interface ClarificationSummary {
  /** Total questions */
  total: number;
  /** Questions by status */
  byStatus: Record<ClarificationStatus, number>;
  /** Questions by category */
  byCategory: Record<QuestionCategory, number>;
  /** Questions by provider */
  byProvider: Record<string, number>;
}

/** Result of applying an answer */
export interface ClarificationResolutionResult {
  /** Question ID that was resolved */
  questionId: string;
  /** Whether resolution succeeded */
  success: boolean;
  /** Entity IDs that were modified */
  modifiedEntityIds: string[];
  /** Error message if failed */
  error?: string;
}

/** Result of applying multiple answers */
export interface BulkClarificationResolutionResult {
  /** Individual results */
  results: ClarificationResolutionResult[];
  /** Total questions processed */
  totalProcessed: number;
  /** Number of successes */
  successCount: number;
  /** Number of failures */
  failureCount: number;
}

/**
 * Generate a deterministic ID for a clarification question.
 *
 * The ID is based only on the provider and discriminator, so the same
 * entity/issue always produces the same ID. This enables proper deduplication
 * in addQuestion() - if a question with the same ID already exists, it will
 * be updated rather than creating a duplicate.
 *
 * @param providerId - ID of the provider generating the question
 * @param discriminator - Unique discriminator (e.g., "naming_PLACE_xxx", "hierarchy_PLACE_xxx")
 * @returns Deterministic question ID
 */
export function generateClarificationId(providerId: string, discriminator: string): string {
  const hash = discriminator
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 80); // Increased from 40 to preserve uniqueness for long IDs
  return `CLARIFY_${providerId}_${hash}`;
}

/**
 * Create a clarification question with defaults filled in.
 *
 * @param params - Partial question with required fields
 * @returns Complete clarification question
 */
export function createClarificationQuestion(
  params: Pick<
    ClarificationQuestion,
    'providerId' | 'category' | 'question' | 'context' | 'affectedEntityIds' | 'resolutionContext'
  > &
    Partial<ClarificationQuestion>,
): ClarificationQuestion {
  return {
    id: params.id ?? generateClarificationId(params.providerId, params.affectedEntityIds[0] ?? ''),
    providerId: params.providerId,
    category: params.category,
    question: params.question,
    context: params.context,
    options: params.options,
    freeformAllowed: params.freeformAllowed ?? false,
    confidence: params.confidence ?? 0.5,
    currentGuess: params.currentGuess,
    affectedEntityIds: params.affectedEntityIds,
    sourceDocument: params.sourceDocument,
    validationIssueId: params.validationIssueId,
    resolutionContext: params.resolutionContext,
    createdAt: params.createdAt ?? new Date().toISOString(),
    status: params.status ?? 'pending',
  };
}
