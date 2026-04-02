/**
 * Unit tests for plot-flags validator
 */

import { describe, it, expect } from 'vitest';
import { plotFlagsValidator } from '@dmnpc/studio/integrity/validators/plot/plot-flags.js';
import { buildPlotValidationContext } from '@dmnpc/studio/integrity/plot-validation-types.js';
import type { PlotDefinition } from '@dmnpc/types/npc';

describe('plot-flags validator', () => {
  const createBasicPlot = (overrides: Partial<PlotDefinition> = {}): PlotDefinition => ({
    id: 'PLOT_test',
    label: 'Test Plot',
    description: 'A test plot',
    plot: 'Test plot summary',
    characters: [],
    places: [],
    items: [],
    turningPoints: [
      {
        id: 'TP_inciting',
        description: 'Inciting incident',
        progressTarget: 0,
        dramaticRole: 'inciting_incident',
        essentialInformation: ['The battle approaches'],
      },
      {
        id: 'TP_climax',
        description: 'Climax',
        progressTarget: 80,
        dramaticRole: 'climax',
        essentialInformation: ['The final confrontation'],
      },
    ],
    possibleFlags: [
      { id: 'story_started', triggerDescription: 'Story begins' },
      { id: 'victory_achieved', triggerDescription: 'Player wins' },
      { id: 'defeat_suffered', triggerDescription: 'Player loses' },
    ],
    goals: [
      {
        id: 'GOAL_win',
        description: 'Win the battle',
        progressBoost: 20,
        revealOnFlags: ['story_started'],
        successFlags: ['victory_achieved'],
        failureFlags: ['defeat_suffered'],
      },
    ],
    endingCards: [
      { condition: { type: 'flag_set', flag: 'victory_achieved' }, text: 'You win!' },
      { condition: { type: 'always' }, text: 'The end' },
    ],
    credits: { title: 'Test Plot', entries: [] },
    ...overrides,
  });

  describe('validate', () => {
    it('returns no issues for valid flag configuration', () => {
      const plot = createBasicPlot();
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);

      // May have warnings about naming but no errors
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('detects ending card flag not achievable by any goal', () => {
      const plot = createBasicPlot({
        endingCards: [
          { condition: { type: 'flag_set', flag: 'nonexistent_flag' }, text: 'Bad ending' },
          { condition: { type: 'always' }, text: 'Default' },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('nonexistent_flag'))).toBe(true);
      expect(issues.some((i) => i.severity === 'error')).toBe(true);
    });

    it('detects goal flag not in possibleFlags', () => {
      const plot = createBasicPlot({
        possibleFlags: [
          { id: 'story_started', triggerDescription: 'Story begins' },
          { id: 'some_flag', triggerDescription: 'Some trigger' },
        ],
        goals: [
          {
            id: 'GOAL_test',
            description: 'Test goal',
            progressBoost: 10,
            revealOnFlags: ['story_started'],
            successFlags: ['missing_flag'], // Not in possibleFlags
          },
        ],
        endingCards: [{ condition: { type: 'always' }, text: 'The end' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);

      const flagIssue = issues.find((i) => i.message.includes('missing_flag'));
      expect(flagIssue).toBeDefined();
      expect(flagIssue?.severity).toBe('error');
      expect(flagIssue?.goalId).toBe('GOAL_test');
    });

    it('warns about negative flag naming', () => {
      const plot = createBasicPlot({
        possibleFlags: [
          { id: 'story_started', triggerDescription: 'Story begins' },
          { id: 'not_saved_merchant', triggerDescription: 'Merchant died' },
        ],
        goals: [
          {
            id: 'GOAL_test',
            description: 'Save merchant',
            progressBoost: 10,
            revealOnFlags: ['story_started'],
            failureFlags: ['not_saved_merchant'],
          },
        ],
        endingCards: [{ condition: { type: 'always' }, text: 'The end' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);

      const namingIssue = issues.find((i) => i.message.includes('negative naming'));
      expect(namingIssue).toBeDefined();
      expect(namingIssue?.severity).toBe('warning');
      expect(namingIssue?.clarificationQuestion).toBeDefined();
    });

    it('detects orphaned flags (defined but never used)', () => {
      const plot = createBasicPlot({
        possibleFlags: [
          { id: 'story_started', triggerDescription: 'Story begins' },
          { id: 'used_flag', triggerDescription: 'Used' },
          { id: 'orphaned_flag', triggerDescription: 'Never referenced' },
        ],
        goals: [
          {
            id: 'GOAL_test',
            description: 'Test',
            progressBoost: 10,
            revealOnFlags: ['story_started'],
            successFlags: ['used_flag'],
          },
        ],
        endingCards: [
          { condition: { type: 'flag_set', flag: 'used_flag' }, text: 'Used flag ending' },
          { condition: { type: 'always' }, text: 'Default' },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);

      const orphanedIssue = issues.find((i) => i.message.includes('orphaned_flag'));
      expect(orphanedIssue).toBeDefined();
      expect(orphanedIssue?.severity).toBe('info');
      expect(orphanedIssue?.clarificationQuestion).toBeDefined();
    });

    it('detects duplicate flag IDs in possibleFlags', () => {
      const plot = createBasicPlot({
        possibleFlags: [
          { id: 'duplicate_flag', triggerDescription: 'First' },
          { id: 'duplicate_flag', triggerDescription: 'Second' },
        ],
        endingCards: [{ condition: { type: 'always' }, text: 'Default' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('duplicate flag ID'))).toBe(true);
    });
  });

  describe('repair', () => {
    it('does not auto-repair goal flag issues (no high confidence fix)', () => {
      const plot = createBasicPlot({
        possibleFlags: [{ id: 'story_started', triggerDescription: 'Story begins' }],
        goals: [
          {
            id: 'GOAL_test',
            description: 'Test',
            progressBoost: 10,
            revealOnFlags: ['story_started'],
            successFlags: ['new_flag'],
          },
        ],
        endingCards: [{ condition: { type: 'always' }, text: 'Default' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);
      const fixed = plotFlagsValidator.repair!(ctx, issues);

      // Goal flag issues don't have suggestedFix with high confidence, so no auto-repair
      expect(fixed.length).toBe(0);
    });

    it('deduplicates flags in possibleFlags', () => {
      const plot = createBasicPlot({
        possibleFlags: [
          { id: 'dup', triggerDescription: 'First' },
          { id: 'dup', triggerDescription: 'Second' },
          { id: 'unique', triggerDescription: 'Unique' },
        ],
        endingCards: [{ condition: { type: 'always' }, text: 'Default' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotFlagsValidator.validate(ctx);
      const fixed = plotFlagsValidator.repair!(ctx, issues);

      expect(fixed.length).toBeGreaterThan(0);
      expect(plot.possibleFlags?.filter((f) => f.id === 'dup').length).toBe(1);
    });
  });
});
