/**
 * Unit tests for plot-descriptions validator
 *
 * The validator checks for essentialInformation on turning points.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plotDescriptionsValidator } from '@dmnpc/studio/integrity/validators/plot/plot-descriptions.js';
import { buildPlotValidationContext } from '@dmnpc/studio/integrity/plot-validation-types.js';
import type { PlotDefinition } from '@dmnpc/types/npc';

describe('plot-descriptions validator', () => {
  const createBasicPlot = (overrides: Partial<PlotDefinition> = {}): PlotDefinition => ({
    id: 'PLOT_test',
    label: 'Test Plot',
    description: 'A test plot',
    plot: 'Test plot summary with details about the story.',
    characters: [],
    places: [],
    items: [],
    turningPoints: [
      {
        id: 'TP_inciting',
        description: 'A courier approaches with a message.',
        progressTarget: 0,
        dramaticRole: 'inciting_incident',
        essentialInformation: [
          'The distant fortress holds vital information',
          'Time is running out',
        ],
      },
      {
        id: 'TP_climax',
        description: 'The final confrontation.',
        progressTarget: 80,
        dramaticRole: 'climax',
        essentialInformation: ['The curse can only be broken by sacrifice'],
      },
    ],
    goals: [],
    possibleFlags: [],
    endingCards: [{ condition: { type: 'always' }, text: 'The end' }],
    credits: { title: 'Test Plot', entries: [] },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validate', () => {
    it('returns no issues for turning points with essentialInformation', async () => {
      const plot = createBasicPlot();
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);
      expect(issues).toEqual([]);
    });

    it('detects missing essentialInformation', async () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'A courier approaches.',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [], // Empty = treated as missing
          },
          {
            id: 'TP_climax',
            description: 'The final confrontation.',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: ['The curse can be broken'],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].turningPointId).toBe('TP_inciting');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('no essentialInformation');
    });

    it('detects empty essentialInformation array', async () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'A courier approaches.',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [], // Empty array
          },
          {
            id: 'TP_climax',
            description: 'The final confrontation.',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: ['The curse can be broken'],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].turningPointId).toBe('TP_inciting');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('no essentialInformation');
    });

    it('errors when turning point has more than 3 essential facts', async () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'A courier approaches.',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [
              'Fact 1',
              'Fact 2',
              'Fact 3',
              'Fact 4', // 4 facts - exceeds max of 3
            ],
          },
          {
            id: 'TP_climax',
            description: 'The final confrontation.',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: ['The curse can be broken'],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].turningPointId).toBe('TP_inciting');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('4 essentialInformation items');
      expect(issues[0].message).toContain('maximum is 3');
    });

    it('errors when non-inciting turning point has more than 3 essential facts', async () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'A courier approaches.',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: ['Fact 1', 'Fact 2'],
          },
          {
            id: 'TP_rising',
            description: 'Rising action.',
            progressTarget: 40,
            dramaticRole: 'rising_action',
            essentialInformation: ['Fact 1', 'Fact 2', 'Fact 3', 'Fact 4', 'Fact 5'], // Exceeds max of 3
          },
          {
            id: 'TP_climax',
            description: 'The final confrontation.',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: ['The curse can be broken'],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].turningPointId).toBe('TP_rising');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('5 essentialInformation items');
      expect(issues[0].message).toContain('maximum is 3');
    });

    it('allows exactly 3 essential facts', async () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'A courier approaches.',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: ['Fact 1', 'Fact 2', 'Fact 3'], // Exactly 3 - OK
          },
          {
            id: 'TP_climax',
            description: 'The final confrontation.',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: ['The curse can be broken'],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues).toEqual([]);
    });

    it('detects multiple turning points missing essentialInformation', async () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'A courier approaches.',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [], // Empty = treated as missing
          },
          {
            id: 'TP_climax',
            description: 'The final confrontation.',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [], // Empty = treated as missing
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues.length).toBe(2);
      expect(issues[0].turningPointId).toBe('TP_inciting');
      expect(issues[1].turningPointId).toBe('TP_climax');
    });

    it('handles plot with no turning points', async () => {
      const plot = createBasicPlot({
        turningPoints: [],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues).toEqual([]);
    });
  });

  describe('repair', () => {
    it('returns empty array (no auto-repair for essentialInformation)', async () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'A courier approaches.',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [], // Empty = treated as missing
          },
          {
            id: 'TP_climax',
            description: 'The final confrontation.',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: ['The curse can be broken'],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = await plotDescriptionsValidator.validate(ctx);

      expect(issues.length).toBe(1);

      // Repair should return empty - essentialInformation requires human review
      const fixed = plotDescriptionsValidator.repair!(ctx, issues);
      expect(fixed).toEqual([]);
    });
  });
});
