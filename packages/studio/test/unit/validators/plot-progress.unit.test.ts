/**
 * Unit tests for plot-progress validator
 */

import { describe, it, expect } from 'vitest';
import { plotProgressValidator } from '@dmnpc/studio/integrity/validators/plot/plot-progress.js';
import { buildPlotValidationContext } from '@dmnpc/studio/integrity/plot-validation-types.js';
import type { PlotDefinition } from '@dmnpc/types/npc';

describe('plot-progress validator', () => {
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
        essentialInformation: [],
      },
      {
        id: 'TP_rising',
        description: 'Rising action',
        progressTarget: 40,
        dramaticRole: 'rising_action',
        essentialInformation: [],
      },
      {
        id: 'TP_climax',
        description: 'Climax',
        progressTarget: 80,
        dramaticRole: 'climax',
        essentialInformation: [],
      },
    ],
    goals: [],
    possibleFlags: [],
    endingCards: [{ condition: { type: 'always' }, text: 'The end' }],
    credits: { title: 'Test Plot', entries: [] },
    ...overrides,
  });

  describe('validate', () => {
    it('returns no issues for valid progress configuration', () => {
      const plot = createBasicPlot();
      const ctx = buildPlotValidationContext(plot);
      const issues = plotProgressValidator.validate(ctx);
      expect(issues).toEqual([]);
    });

    it('detects inciting_incident with non-zero progressTarget', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting',
            progressTarget: 15, // Should be 0
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
          },
          {
            id: 'TP_climax',
            description: 'Climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotProgressValidator.validate(ctx);

      const issue = issues.find((i) => i.message.includes('progressTarget 0'));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('error');
      expect(issue?.suggestedFix?.value).toBe(0);
    });

    it('detects unsorted turning points', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_climax',
            description: 'Climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
          {
            id: 'TP_inciting',
            description: 'Inciting',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotProgressValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('not sorted'))).toBe(true);
    });

    // Note: We no longer warn when climax is not highest progress - that's correct behavior.
    // Resolution (with higher progressTarget) should come AFTER climax in the story sequence.

    it('warns about non-inciting TPs with zero progress', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
          },
          {
            id: 'TP_rising',
            description: 'Rising',
            progressTarget: 0, // Should have some progress
            dramaticRole: 'rising_action',
            essentialInformation: [],
          },
          {
            id: 'TP_climax',
            description: 'Climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotProgressValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('TP_rising') && i.message.includes('0'))).toBe(
        true
      );
    });
  });

  describe('repair', () => {
    it('fixes inciting_incident progressTarget to 0', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting',
            progressTarget: 25,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
          },
          {
            id: 'TP_climax',
            description: 'Climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotProgressValidator.validate(ctx);
      const fixed = plotProgressValidator.repair!(ctx, issues);

      expect(fixed.length).toBeGreaterThan(0);
      expect(plot.turningPoints![0].progressTarget).toBe(0);
    });

    it('sorts turning points by progressTarget', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_climax',
            description: 'Climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
          {
            id: 'TP_rising',
            description: 'Rising',
            progressTarget: 40,
            dramaticRole: 'rising_action',
            essentialInformation: [],
          },
          {
            id: 'TP_inciting',
            description: 'Inciting',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotProgressValidator.validate(ctx);
      const fixed = plotProgressValidator.repair!(ctx, issues);

      expect(fixed.length).toBeGreaterThan(0);
      expect(plot.turningPoints![0].id).toBe('TP_inciting');
      expect(plot.turningPoints![1].id).toBe('TP_rising');
      expect(plot.turningPoints![2].id).toBe('TP_climax');
    });
  });
});
