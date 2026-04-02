/**
 * Clarification Store - Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import {
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
  recordAnswer,
  getAnswer,
  getClarificationSummary,
  clearClarifications,
  pruneResolvedQuestions,
} from '@dmnpc/core/clarification/clarification-store.js';
import { type UniverseClarifications, createClarificationQuestion } from '@dmnpc/core/clarification/clarification-types.js';

// Mock the filesystem
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
  },
}));

describe('clarification-store', () => {
  const mockUniverseId = 'test-universe';

  // Helper to create test question
  const createTestQuestion = (
    id: string,
    status: 'pending' | 'answered' | 'applied' | 'skipped' = 'pending'
  ) =>
    createClarificationQuestion({
      id,
      providerId: 'test-provider',
      category: 'classification',
      question: `Test question ${id}?`,
      context: 'Test context',
      affectedEntityIds: ['ENTITY_1'],
      resolutionContext: {},
      status,
    });

  // Helper to create mock data
  const createMockData = (
    questions: ReturnType<typeof createTestQuestion>[] = []
  ): UniverseClarifications => ({
    universeId: mockUniverseId,
    questions,
    answers: [],
    lastUpdated: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('loadClarifications', () => {
    it('should return null when file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await loadClarifications(mockUniverseId);

      expect(result).toBeNull();
    });

    it('should return parsed data when file exists', async () => {
      const mockData = createMockData([createTestQuestion('q1')]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await loadClarifications(mockUniverseId);

      expect(result).toEqual(mockData);
    });

    it('should throw on non-ENOENT errors', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      await expect(loadClarifications(mockUniverseId)).rejects.toThrow('Permission denied');
    });
  });

  describe('saveClarifications', () => {
    it('should write data to file with updated timestamp', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue();
      const mockData = createMockData();

      await saveClarifications(mockUniverseId, mockData);

      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[0]).toContain('clarifications.json');

      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.lastUpdated).toBeTruthy();
    });
  });

  describe('getOrCreateClarifications', () => {
    it('should return existing data', async () => {
      const mockData = createMockData([createTestQuestion('q1')]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await getOrCreateClarifications(mockUniverseId);

      expect(result.questions).toHaveLength(1);
    });

    it('should create empty structure when none exists', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);
      vi.mocked(fs.writeFile).mockResolvedValue();

      const result = await getOrCreateClarifications(mockUniverseId);

      expect(result.universeId).toBe(mockUniverseId);
      expect(result.questions).toEqual([]);
      expect(result.answers).toEqual([]);
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('addQuestion', () => {
    it('should add new question', async () => {
      const mockData = createMockData();
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      const question = createTestQuestion('q1');
      await addQuestion(mockUniverseId, question);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions).toHaveLength(1);
      expect(writtenData.questions[0].id).toBe('q1');
    });

    it('should update existing question with same ID when pending', async () => {
      const existingQuestion = createTestQuestion('q1', 'pending');
      const mockData = createMockData([existingQuestion]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      const updatedQuestion = createTestQuestion('q1');
      updatedQuestion.question = 'Updated question?';
      await addQuestion(mockUniverseId, updatedQuestion);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions).toHaveLength(1);
      expect(writtenData.questions[0].question).toBe('Updated question?');
    });

    it('should NOT overwrite question with status "answered"', async () => {
      const existingQuestion = createTestQuestion('q1', 'answered');
      existingQuestion.question = 'Original question?';
      const mockData = createMockData([existingQuestion]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      const newQuestion = createTestQuestion('q1', 'pending');
      newQuestion.question = 'New question that should be ignored?';
      await addQuestion(mockUniverseId, newQuestion);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions).toHaveLength(1);
      // Should preserve the original question and status
      expect(writtenData.questions[0].question).toBe('Original question?');
      expect(writtenData.questions[0].status).toBe('answered');
    });

    it('should NOT overwrite question with status "skipped"', async () => {
      const existingQuestion = createTestQuestion('q1', 'skipped');
      existingQuestion.question = 'Original question?';
      const mockData = createMockData([existingQuestion]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      const newQuestion = createTestQuestion('q1', 'pending');
      newQuestion.question = 'New question that should be ignored?';
      await addQuestion(mockUniverseId, newQuestion);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions).toHaveLength(1);
      // Should preserve the original question and status
      expect(writtenData.questions[0].question).toBe('Original question?');
      expect(writtenData.questions[0].status).toBe('skipped');
    });

    it('should reset "applied" question to pending if issue recurs', async () => {
      const existingQuestion = createTestQuestion('q1', 'applied');
      const mockData = createMockData([existingQuestion]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      const newQuestion = createTestQuestion('q1', 'pending');
      newQuestion.question = 'Updated question after issue recurred?';
      await addQuestion(mockUniverseId, newQuestion);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions).toHaveLength(1);
      // Should update and reset to pending since the fix didn't work
      expect(writtenData.questions[0].question).toBe('Updated question after issue recurred?');
      expect(writtenData.questions[0].status).toBe('pending');
    });
  });

  describe('addQuestions', () => {
    it('should add multiple questions', async () => {
      const mockData = createMockData();
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      const questions = [createTestQuestion('q1'), createTestQuestion('q2')];
      await addQuestions(mockUniverseId, questions);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions).toHaveLength(2);
    });

    it('should do nothing for empty array', async () => {
      await addQuestions(mockUniverseId, []);

      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });

  describe('getQuestion', () => {
    it('should return question by ID', async () => {
      const question = createTestQuestion('q1');
      const mockData = createMockData([question]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await getQuestion(mockUniverseId, 'q1');

      expect(result?.id).toBe('q1');
    });

    it('should return undefined for unknown ID', async () => {
      const mockData = createMockData([createTestQuestion('q1')]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await getQuestion(mockUniverseId, 'unknown');

      expect(result).toBeUndefined();
    });
  });

  describe('getPendingQuestions', () => {
    it('should return only pending questions', async () => {
      const mockData = createMockData([
        createTestQuestion('q1', 'pending'),
        createTestQuestion('q2', 'answered'),
        createTestQuestion('q3', 'pending'),
        createTestQuestion('q4', 'applied'),
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await getPendingQuestions(mockUniverseId);

      expect(result).toHaveLength(2);
      expect(result.map((q) => q.id)).toEqual(['q1', 'q3']);
    });
  });

  describe('getAnsweredQuestions', () => {
    it('should return only answered questions', async () => {
      const mockData = createMockData([
        createTestQuestion('q1', 'pending'),
        createTestQuestion('q2', 'answered'),
        createTestQuestion('q3', 'answered'),
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await getAnsweredQuestions(mockUniverseId);

      expect(result).toHaveLength(2);
      expect(result.map((q) => q.id)).toEqual(['q2', 'q3']);
    });
  });

  describe('updateQuestionStatus', () => {
    it('should update question status', async () => {
      const mockData = createMockData([createTestQuestion('q1', 'pending')]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      await updateQuestionStatus(mockUniverseId, 'q1', 'answered');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions[0].status).toBe('answered');
    });

    it('should throw for unknown question', async () => {
      const mockData = createMockData();
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      await expect(updateQuestionStatus(mockUniverseId, 'unknown', 'answered')).rejects.toThrow(
        'Question not found: unknown'
      );
    });
  });

  describe('recordAnswer', () => {
    it('should record answer and update question status', async () => {
      const mockData = createMockData([createTestQuestion('q1', 'pending')]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      await recordAnswer(mockUniverseId, {
        questionId: 'q1',
        selectedOptionId: 'option-1',
        answeredAt: new Date().toISOString(),
      });

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions[0].status).toBe('answered');
      expect(writtenData.answers).toHaveLength(1);
      expect(writtenData.answers[0].selectedOptionId).toBe('option-1');
    });

    it('should throw for unknown question', async () => {
      const mockData = createMockData();
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      await expect(
        recordAnswer(mockUniverseId, {
          questionId: 'unknown',
          selectedOptionId: 'option-1',
          answeredAt: new Date().toISOString(),
        })
      ).rejects.toThrow('Question not found: unknown');
    });
  });

  describe('getAnswer', () => {
    it('should return answer for question', async () => {
      const mockData = createMockData([createTestQuestion('q1', 'answered')]);
      mockData.answers.push({
        questionId: 'q1',
        selectedOptionId: 'option-1',
        answeredAt: new Date().toISOString(),
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await getAnswer(mockUniverseId, 'q1');

      expect(result?.selectedOptionId).toBe('option-1');
    });

    it('should return undefined for unanswered question', async () => {
      const mockData = createMockData([createTestQuestion('q1', 'pending')]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const result = await getAnswer(mockUniverseId, 'q1');

      expect(result).toBeUndefined();
    });
  });

  describe('getClarificationSummary', () => {
    it('should return correct summary', async () => {
      const mockData = createMockData([
        createTestQuestion('q1', 'pending'),
        createTestQuestion('q2', 'pending'),
        createTestQuestion('q3', 'answered'),
        createTestQuestion('q4', 'applied'),
        createTestQuestion('q5', 'skipped'),
      ]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

      const summary = await getClarificationSummary(mockUniverseId);

      expect(summary.total).toBe(5);
      expect(summary.byStatus.pending).toBe(2);
      expect(summary.byStatus.answered).toBe(1);
      expect(summary.byStatus.applied).toBe(1);
      expect(summary.byStatus.skipped).toBe(1);
      expect(summary.byCategory.classification).toBe(5);
      expect(summary.byProvider['test-provider']).toBe(5);
    });

    it('should return zeros when no questions', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const summary = await getClarificationSummary(mockUniverseId);

      expect(summary.total).toBe(0);
      expect(summary.byStatus.pending).toBe(0);
    });
  });

  describe('clearClarifications', () => {
    it('should delete the file', async () => {
      vi.mocked(fs.unlink).mockResolvedValue();

      await clearClarifications(mockUniverseId);

      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should not throw if file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.unlink).mockRejectedValue(error);

      await expect(clearClarifications(mockUniverseId)).resolves.not.toThrow();
    });
  });

  describe('pruneResolvedQuestions', () => {
    it('should remove applied and skipped questions', async () => {
      const mockData = createMockData([
        createTestQuestion('q1', 'pending'),
        createTestQuestion('q2', 'answered'),
        createTestQuestion('q3', 'applied'),
        createTestQuestion('q4', 'skipped'),
      ]);
      mockData.answers.push({
        questionId: 'q3',
        selectedOptionId: 'opt',
        answeredAt: new Date().toISOString(),
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fs.writeFile).mockResolvedValue();

      const count = await pruneResolvedQuestions(mockUniverseId);

      expect(count).toBe(2);
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string) as UniverseClarifications;
      expect(writtenData.questions).toHaveLength(2);
      expect(writtenData.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    });
  });
});
