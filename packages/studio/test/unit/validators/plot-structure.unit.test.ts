/**
 * Unit tests for plot-structure validator
 */

import { describe, it, expect } from 'vitest';
import { plotStructureValidator } from '@dmnpc/studio/integrity/validators/plot/plot-structure.js';
import { buildPlotValidationContext } from '@dmnpc/studio/integrity/plot-validation-types.js';
import type { PlotDefinition } from '@dmnpc/types/npc';

describe('plot-structure validator', () => {
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
    it('returns no errors for valid plot with climax and inciting_incident', () => {
      const plot = createBasicPlot();
      const ctx = buildPlotValidationContext(plot);
      const issues = plotStructureValidator.validate(ctx);
      // May have warnings (e.g., missing essentialInformation) but no errors
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('detects missing climax', () => {
      const plot = createBasicPlot({
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
            progressTarget: 50,
            dramaticRole: 'rising_action',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotStructureValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('climax'))).toBe(true);
      expect(issues.some((i) => i.clarificationQuestion)).toBe(true);
    });

    it('detects multiple climaxes and generates clarification question', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting incident',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
          },
          {
            id: 'TP_climax1',
            description: 'First climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
          {
            id: 'TP_climax2',
            description: 'Second climax',
            progressTarget: 90,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotStructureValidator.validate(ctx);

      const multiClimaxIssue = issues.find((i) => i.message.includes('2 climax'));
      expect(multiClimaxIssue).toBeDefined();
      expect(multiClimaxIssue?.clarificationQuestion).toBeDefined();
      expect(multiClimaxIssue?.clarificationQuestion?.options?.length).toBe(2);
    });

    it('detects missing inciting_incident', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_rising',
            description: 'Rising action',
            progressTarget: 30,
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
      const issues = plotStructureValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('inciting_incident'))).toBe(true);
    });

    it('detects invalid dramatic role', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting incident',
            progressTarget: 0,
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
          {
            id: 'TP_invalid',
            description: 'Invalid role',
            progressTarget: 50,
            dramaticRole: 'not_a_valid_role' as any,
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotStructureValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('invalid dramaticRole'))).toBe(true);
    });

    it('detects duplicate turning point IDs', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_duplicate',
            description: 'First',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
          },
          {
            id: 'TP_duplicate',
            description: 'Second with same ID',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotStructureValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('Duplicate turning point ID'))).toBe(true);
    });

    it('detects duplicate goal IDs in plot goals', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
            possibleFlags: [{ id: 'story_started', triggerDescription: 'Story begins' }],
          },
          {
            id: 'TP_climax',
            description: 'Climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
        ],
        goals: [
          {
            id: 'GOAL_dup',
            description: 'Goal 1',
            progressBoost: 10,
            revealOnFlags: ['story_started'],
          },
          {
            id: 'GOAL_dup',
            description: 'Goal 2',
            progressBoost: 20,
            revealOnFlags: ['story_started'],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotStructureValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('Duplicate goal ID'))).toBe(true);
    });

    it('warns when inciting_incident lacks essentialInformation', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting incident without essential info',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [],
            // Empty essentialInformation - should trigger warning
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
      const issues = plotStructureValidator.validate(ctx);

      const warningIssue = issues.find(
        (i) => i.severity === 'warning' && i.message.includes('essentialInformation')
      );
      expect(warningIssue).toBeDefined();
      expect(warningIssue?.turningPointId).toBe('TP_inciting');
      expect(warningIssue?.message).toContain('player may not understand the quest');
    });

    it('does not warn when inciting_incident has essentialInformation', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting incident with essential info',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: ['The destination is Ancient Fort Kharos', 'Time is limited'],
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
      const issues = plotStructureValidator.validate(ctx);

      const warningIssue = issues.find(
        (i) => i.severity === 'warning' && i.message.includes('essentialInformation')
      );
      expect(warningIssue).toBeUndefined();
    });

    it('warns when inciting_incident has empty essentialInformation array', () => {
      const plot = createBasicPlot({
        turningPoints: [
          {
            id: 'TP_inciting',
            description: 'Inciting incident with empty essential info',
            progressTarget: 0,
            dramaticRole: 'inciting_incident',
            essentialInformation: [], // Empty array should also trigger warning
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
      const issues = plotStructureValidator.validate(ctx);

      const warningIssue = issues.find(
        (i) => i.severity === 'warning' && i.message.includes('essentialInformation')
      );
      expect(warningIssue).toBeDefined();
    });
  });

  describe('repair', () => {
    it('repairs invalid dramatic role to rising_action', () => {
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
            id: 'TP_climax',
            description: 'Climax',
            progressTarget: 80,
            dramaticRole: 'climax',
            essentialInformation: [],
          },
          {
            id: 'TP_invalid',
            description: 'Invalid',
            progressTarget: 50,
            dramaticRole: 'bad_role' as any,
            essentialInformation: [],
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotStructureValidator.validate(ctx);
      const fixed = plotStructureValidator.repair!(ctx, issues);

      expect(fixed.length).toBeGreaterThan(0);
      expect(plot.turningPoints![2].dramaticRole).toBe('rising_action');
    });
  });
});
