/**
 * Plot Clarification Provider - Unit Tests
 *
 * Tests the clarification provider for plot-related questions,
 * including dramatic role selection, flag routing, flag renaming, and orphan cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlotDefinition } from '@dmnpc/types/npc';
import type { ClarificationResolutionContext } from '@dmnpc/core/clarification/clarification-types.js';
import { getPlot, savePlotRaw } from '@dmnpc/core/stores/plot-store.js';

// Mock dependencies BEFORE importing the provider
vi.mock('@dmnpc/core/stores/plot-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dmnpc/core/stores/plot-store.js')>();
  return {
    ...actual,
    getPlot: vi.fn(),
    savePlotRaw: vi.fn(),
  };
});

// Import after mocks
import { plotClarificationProvider } from '@dmnpc/generation/narrative/plot-clarification-provider.js';

describe('plot-clarification-provider', () => {
  const mockGetPlot = getPlot as ReturnType<typeof vi.fn>;
  const mockSavePlot = savePlotRaw as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSavePlot.mockResolvedValue({
      clarificationQuestions: [],
    });
    mockSavePlot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  function createPlot(overrides: Partial<PlotDefinition> = {}): PlotDefinition {
    return {
      id: 'PLOT_test',
      label: 'Test Plot',
      description: 'A test plot',
      items: [],
      turningPoints: [
        {
          id: 'TP_inciting',
          label: 'Inciting Incident',
          dramaticRole: 'inciting_incident',
          progressTarget: 0,
          triggerOnFlags: [],
        },
        {
          id: 'TP_rising',
          label: 'Rising Action',
          dramaticRole: 'rising_action',
          progressTarget: 30,
          triggerOnFlags: [],
        },
        {
          id: 'TP_climax',
          label: 'Climax',
          dramaticRole: 'climax',
          progressTarget: 100,
          triggerOnFlags: [],
        },
      ],
      possibleFlags: [],
      goals: [],
      endingCards: [
        {
          id: 'END_default',
          label: 'Default Ending',
          condition: { type: 'always' },
          credits: [],
        },
      ],
      ...overrides,
    };
  }

  function createClarificationResolutionContext(
    plotId: string,
    issueType: string,
    answer: ClarificationResolutionContext['answer'],
    extraClarificationResolutionContext: Record<string, unknown> = {}
  ): ClarificationResolutionContext {
    return {
      universeCtx: null as unknown as ClarificationResolutionContext['universeCtx'],
      question: {
        id: `CLARIFY_test_${Date.now()}`,
        providerId: 'plot-validator',
        category: 'classification',
        question: 'Test question',
        context: 'Test context',
        options: [],
        freeformAllowed: false,
        confidence: 0.5,
        affectedEntityIds: [plotId],
        resolutionContext: {
          plotId,
          issueType,
          ...extraClarificationResolutionContext,
        },
        createdAt: new Date().toISOString(),
      },
      answer,
    };
  }

  describe('provider registration', () => {
    it('has correct providerId', () => {
      expect(plotClarificationProvider.providerId).toBe('plot-validator');
    });

    it('has correct providerName', () => {
      expect(plotClarificationProvider.providerName).toBe('Plot Validator');
    });

    it('includes expected categories', () => {
      const categories = plotClarificationProvider.categories;
      expect(categories).toContain('classification');
      expect(categories).toContain('relationship');
      expect(categories).toContain('attribute');
    });
  });

  describe('resolveAnswer - multiple_climax', () => {
    it('sets selected TP as climax and demotes others to crisis', async () => {
      const plot = createPlot({
        turningPoints: [
          {
            id: 'TP_candidate1',
            label: 'First Candidate',
            dramaticRole: 'climax',
            progressTarget: 90,
            triggerOnFlags: [],
          },
          {
            id: 'TP_candidate2',
            label: 'Second Candidate',
            dramaticRole: 'climax',
            progressTarget: 100,
            triggerOnFlags: [],
          },
        ],
      });
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext('PLOT_test', 'multiple_climax', {
        questionId: 'q1',
        selectedOptionId: 'TP_candidate2',
        answeredAt: new Date().toISOString(),
      });

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toContain('PLOT_test');
      expect(mockSavePlot).toHaveBeenCalledWith(
        expect.objectContaining({
          turningPoints: expect.arrayContaining([
            expect.objectContaining({ id: 'TP_candidate1', dramaticRole: 'crisis' }),
            expect.objectContaining({ id: 'TP_candidate2', dramaticRole: 'climax' }),
          ]),
        })
      );
      expect(mockSavePlot).toHaveBeenCalled();
    });

    it('does nothing when plot is not found', async () => {
      mockGetPlot.mockResolvedValue(null);

      const ctx = createClarificationResolutionContext('PLOT_missing', 'multiple_climax', {
        questionId: 'q1',
        selectedOptionId: 'TP_something',
        answeredAt: new Date().toISOString(),
      });

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockSavePlot).not.toHaveBeenCalled();
    });

    it('does nothing when selectedOptionId is missing', async () => {
      const plot = createPlot();
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext('PLOT_test', 'multiple_climax', {
        questionId: 'q1',
        answeredAt: new Date().toISOString(),
      });

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockSavePlot).not.toHaveBeenCalled();
    });
  });

  describe('resolveAnswer - missing_inciting', () => {
    it('sets selected TP as inciting_incident with progress 0', async () => {
      const plot = createPlot({
        turningPoints: [
          {
            id: 'TP_candidate',
            label: 'Candidate',
            dramaticRole: 'rising_action',
            progressTarget: 20,
            triggerOnFlags: [],
          },
        ],
      });
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext('PLOT_test', 'missing_inciting', {
        questionId: 'q1',
        selectedOptionId: 'TP_candidate',
        answeredAt: new Date().toISOString(),
      });

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toContain('PLOT_test');
      expect(mockSavePlot).toHaveBeenCalledWith(
        expect.objectContaining({
          turningPoints: expect.arrayContaining([
            expect.objectContaining({
              id: 'TP_candidate',
              dramaticRole: 'inciting_incident',
              progressTarget: 0,
            }),
          ]),
        })
      );
      expect(mockSavePlot).toHaveBeenCalled();
    });

    it('does nothing when selected TP is not found', async () => {
      const plot = createPlot();
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext('PLOT_test', 'missing_inciting', {
        questionId: 'q1',
        selectedOptionId: 'TP_nonexistent',
        answeredAt: new Date().toISOString(),
      });

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockSavePlot).not.toHaveBeenCalled();
    });
  });

  describe('resolveAnswer - unreachable_ending_flag', () => {
    it('adds flag to root possibleFlags', async () => {
      const plot = createPlot({
        possibleFlags: [],
        goals: [
          {
            id: 'goal1',
            description: 'Test goal',
            revealOnFlags: ['FLAG_victory'],
          },
        ],
      });
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext(
        'PLOT_test',
        'unreachable_ending_flag',
        {
          questionId: 'q1',
          selectedOptionId: 'TP_target', // Selection is now ignored, flag goes to root
          answeredAt: new Date().toISOString(),
        },
        { flagId: 'FLAG_victory' }
      );

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toContain('PLOT_test');
      expect(mockSavePlot).toHaveBeenCalledWith(
        expect.objectContaining({
          possibleFlags: expect.arrayContaining([expect.objectContaining({ id: 'FLAG_victory' })]),
        })
      );
    });

    it('does not duplicate flag if already in possibleFlags', async () => {
      const plot = createPlot({
        possibleFlags: [{ id: 'FLAG_victory', triggerDescription: 'Existing' }],
      });
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext(
        'PLOT_test',
        'unreachable_ending_flag',
        {
          questionId: 'q1',
          selectedOptionId: 'TP_target',
          answeredAt: new Date().toISOString(),
        },
        { flagId: 'FLAG_victory' }
      );

      await plotClarificationProvider.resolveAnswer(ctx);

      // Should only have one flag entry at root
      const savedPlot = mockSavePlot.mock.calls[0][0] as PlotDefinition;
      expect(savedPlot.possibleFlags?.filter((f) => f.id === 'FLAG_victory')).toHaveLength(1);
    });
  });

  describe('resolveAnswer - negative_flag', () => {
    it('renames flag when suggested option selected', async () => {
      const plot = createPlot({
        turningPoints: [
          {
            id: 'TP_test',
            label: 'Test TP',
            dramaticRole: 'rising_action',
            progressTarget: 50,
            triggerOnFlags: ['FLAG_not_dead'],
          },
        ],
        possibleFlags: [{ id: 'FLAG_not_dead', triggerDescription: 'Test' }],
        goals: [
          {
            id: 'goal1',
            description: 'Test',
            revealOnFlags: ['FLAG_not_dead'],
            successFlags: ['FLAG_not_dead'],
          },
        ],
        endingCards: [
          {
            id: 'END_test',
            label: 'Test',
            condition: { type: 'flag', flag: 'FLAG_not_dead' },
            credits: [],
          },
        ],
      });
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext(
        'PLOT_test',
        'negative_flag',
        {
          questionId: 'q1',
          selectedOptionId: 'suggested',
          answeredAt: new Date().toISOString(),
        },
        { flagId: 'FLAG_not_dead', suggestedName: 'FLAG_alive' }
      );

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toContain('PLOT_test');
      // Verify flag was renamed throughout
      const savedPlot = mockSavePlot.mock.calls[0][0] as PlotDefinition;
      const tp = savedPlot.turningPoints?.[0];
      expect(tp?.triggerOnFlags).toContain('FLAG_alive');
      expect(tp?.triggerOnFlags).not.toContain('FLAG_not_dead');
      // possibleFlags is now at root level
      expect(savedPlot.possibleFlags?.[0].id).toBe('FLAG_alive');
      // Goals are now at plan level
      expect(savedPlot.goals?.[0].successFlags).toContain('FLAG_alive');
      expect(savedPlot.goals?.[0].revealOnFlags).toContain('FLAG_alive');
      expect(savedPlot.endingCards?.[0].condition.flag).toBe('FLAG_alive');
    });

    it('renames flag using freeform text', async () => {
      const plot = createPlot({
        possibleFlags: [{ id: 'FLAG_bad_name', triggerDescription: 'Test' }],
      });
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext(
        'PLOT_test',
        'negative_flag',
        {
          questionId: 'q1',
          freeformText: 'FLAG_good_name',
          answeredAt: new Date().toISOString(),
        },
        { flagId: 'FLAG_bad_name', suggestedName: 'FLAG_suggested' }
      );

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toContain('PLOT_test');
      const savedPlot = mockSavePlot.mock.calls[0][0] as PlotDefinition;
      expect(savedPlot.possibleFlags?.[0].id).toBe('FLAG_good_name');
    });

    it('does nothing when keep option selected', async () => {
      const plot = createPlot();
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext(
        'PLOT_test',
        'negative_flag',
        {
          questionId: 'q1',
          selectedOptionId: 'keep',
          answeredAt: new Date().toISOString(),
        },
        { flagId: 'FLAG_old', suggestedName: 'FLAG_new' }
      );

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockSavePlot).not.toHaveBeenCalled();
    });
  });

  describe('resolveAnswer - orphaned_flag', () => {
    it('deletes orphaned flag when delete option selected', async () => {
      const plot = createPlot({
        possibleFlags: [
          { id: 'FLAG_orphan', triggerDescription: 'Orphan' },
          { id: 'FLAG_keep', triggerDescription: 'Keep' },
        ],
      });
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext(
        'PLOT_test',
        'orphaned_flag',
        {
          questionId: 'q1',
          selectedOptionId: 'delete',
          answeredAt: new Date().toISOString(),
        },
        { flagId: 'FLAG_orphan' } // turningPointId no longer needed
      );

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toContain('PLOT_test');
      const savedPlot = mockSavePlot.mock.calls[0][0] as PlotDefinition;
      // possibleFlags is now at root level
      expect(savedPlot.possibleFlags).toHaveLength(1);
      expect(savedPlot.possibleFlags?.[0].id).toBe('FLAG_keep');
    });

    it('does nothing when keep option selected', async () => {
      const plot = createPlot();
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext(
        'PLOT_test',
        'orphaned_flag',
        {
          questionId: 'q1',
          selectedOptionId: 'keep',
          answeredAt: new Date().toISOString(),
        },
        { flagId: 'FLAG_orphan' }
      );

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockSavePlot).not.toHaveBeenCalled();
    });
  });

  // Note: Tests for 'climax_not_highest_progress' removed because we no longer validate that.
  // Resolution having higher progressTarget than climax is correct behavior (it happens AFTER).

  describe('resolveAnswer - unknown issue type', () => {
    it('logs warning and returns empty array', async () => {
      const plot = createPlot();
      mockGetPlot.mockResolvedValue(plot);

      const ctx = createClarificationResolutionContext('PLOT_test', 'unknown_issue_type', {
        questionId: 'q1',
        selectedOptionId: 'something',
        answeredAt: new Date().toISOString(),
      });

      const modifiedIds = await plotClarificationProvider.resolveAnswer(ctx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockSavePlot).not.toHaveBeenCalled();
    });
  });

  // Note: repairAndSavePlot was replaced with savePlotRaw (no pre-validation)
  // The save behavior is tested transitively through the resolve tests above.
});
