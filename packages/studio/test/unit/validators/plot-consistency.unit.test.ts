/**
 * Unit tests for plot-consistency validator
 */

import { describe, it, expect } from 'vitest';
import { plotConsistencyValidator } from '@dmnpc/studio/integrity/validators/plot/plot-consistency.js';
import { buildPlotValidationContext } from '@dmnpc/studio/integrity/plot-validation-types.js';
import type { PlotDefinition } from '@dmnpc/types/npc';

describe('plot-consistency validator', () => {
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
    credits: { title: 'Test Plot', entries: [{ role: 'Plot', name: 'Storyteller' }] },
    ...overrides,
  });

  describe('validate', () => {
    it('returns no issues for valid plot', () => {
      const plot = createBasicPlot();
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);
      expect(issues).toEqual([]);
    });

    it('detects missing required field: id', () => {
      const plot = createBasicPlot({ id: '' });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('missing required field: id'))).toBe(true);
    });

    it('detects id not starting with PLOT_', () => {
      const plot = createBasicPlot({ id: 'test_plot' });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('must start with "PLOT_"'))).toBe(true);
    });

    it('detects missing label', () => {
      const plot = createBasicPlot({ label: '' });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('missing required field: label'))).toBe(true);
    });

    it('detects missing description', () => {
      const plot = createBasicPlot({ description: '' });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('missing required field: description'))).toBe(
        true
      );
    });

    it('detects missing plot summary', () => {
      const plot = createBasicPlot({ plot: '' });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('missing required field: plot'))).toBe(true);
    });

    // Note: progressTarget and dramaticRole are now enforced by the TypeScript type system
    // and no longer validated at runtime by plot-consistency validator.

    it('detects invalid ending card condition type', () => {
      const plot = createBasicPlot({
        endingCards: [{ condition: { type: 'invalid_type' as any }, text: 'Bad ending' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('invalid condition type'))).toBe(true);
    });

    it('detects flag_set condition missing flag', () => {
      const plot = createBasicPlot({
        endingCards: [{ condition: { type: 'flag_set' }, text: 'Missing flag' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('missing flag'))).toBe(true);
    });

    it('warns about missing always ending card', () => {
      const plot = createBasicPlot({
        endingCards: [{ condition: { type: 'flag_set', flag: 'some_flag' }, text: 'Conditional' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('no "always" ending card'))).toBe(true);
    });

    // Note: progressBoost is now enforced by the TypeScript type system
    // and no longer validated at runtime by plot-consistency validator.

    it('detects flag missing triggerDescription', () => {
      const plot = createBasicPlot({
        possibleFlags: [{ id: 'test_flag', triggerDescription: '' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('missing triggerDescription'))).toBe(true);
    });

    // Character name/matchHint validation tests
    it('accepts character with only matchHint (no name)', () => {
      const plot = createBasicPlot({
        characters: [
          {
            matchHint: 'weathered passage broker who arranges travel',
            role: 'informant',
            description: 'A broker',
            publicFace: 'Helpful',
            hiddenTruth: 'Secret',
            locationHint: 'Somewhere',
            introductionProgress: 10,
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.filter((i) => i.field === 'characters')).toEqual([]);
    });

    it('accepts character with proper noun name', () => {
      const plot = createBasicPlot({
        characters: [
          {
            name: 'Marcus Vale',
            role: 'ally',
            description: 'A merchant',
            publicFace: 'Friendly',
            hiddenTruth: 'Secret',
            locationHint: 'Market',
            introductionProgress: 20,
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.filter((i) => i.field === 'characters')).toEqual([]);
    });

    it('warns when character has generic role-based name', () => {
      const plot = createBasicPlot({
        characters: [
          {
            name: 'The Passage Broker',
            role: 'informant',
            description: 'A broker',
            publicFace: 'Helpful',
            hiddenTruth: 'Secret',
            locationHint: 'Somewhere',
            introductionProgress: 10,
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      const charIssues = issues.filter((i) => i.field === 'characters');
      expect(charIssues.some((i) => i.message.includes('generic role-based name'))).toBe(true);
      expect(charIssues.some((i) => i.suggestedFix?.field.includes('name->matchHint'))).toBe(true);
    });

    it('errors when character has neither name nor matchHint', () => {
      const plot = createBasicPlot({
        characters: [
          {
            role: 'informant',
            description: 'A broker',
            publicFace: 'Helpful',
            hiddenTruth: 'Secret',
            locationHint: 'Somewhere',
            introductionProgress: 10,
          } as any,
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(
        issues.some(
          (i) => i.severity === 'error' && i.message.includes('missing both name and matchHint')
        )
      ).toBe(true);
    });

    // Place placeId/storyRole validation tests
    it('accepts place with placeId and storyRole', () => {
      const plot = createBasicPlot({
        places: [
          {
            placeId: 'PLACE_fort_kharos',
            storyRole: 'Destination',
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.filter((i) => i.field === 'places')).toEqual([]);
    });

    it('errors when place is missing placeId', () => {
      const plot = createBasicPlot({
        places: [
          {
            storyRole: 'Destination',
          } as any,
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(
        issues.some((i) => i.severity === 'error' && i.message.includes('missing placeId'))
      ).toBe(true);
    });

    it('errors when place is missing storyRole', () => {
      const plot = createBasicPlot({
        places: [
          {
            placeId: 'PLACE_fort_kharos',
          } as any,
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(
        issues.some((i) => i.severity === 'error' && i.message.includes('missing storyRole'))
      ).toBe(true);
    });

    it('detects lowercase name as generic', () => {
      const plot = createBasicPlot({
        characters: [
          {
            name: 'weathered old sailor',
            role: 'informant',
            description: 'A sailor',
            publicFace: 'Gruff',
            hiddenTruth: 'Secret',
            locationHint: 'Docks',
            introductionProgress: 10,
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.some((i) => i.message.includes('generic role-based name'))).toBe(true);
    });

    // Goal destinationPlaceId validation tests
    it('accepts goal with valid destinationPlaceId matching place placeId', () => {
      const plot = createBasicPlot({
        possibleFlags: [{ id: 'story_started', triggerDescription: 'Story begins' }],
        places: [
          {
            placeId: 'PLACE_fort_kharos',
            storyRole: 'Destination',
          },
        ],
        goals: [
          {
            id: 'GOAL_deliver',
            description: 'Deliver the package',
            progressBoost: 20,
            revealOnFlags: ['story_started'],
            destinationPlaceId: 'PLACE_fort_kharos',
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.filter((i) => i.field === 'destinationPlaceId')).toEqual([]);
    });

    it('errors when destinationPlaceId does not match any place', () => {
      const plot = createBasicPlot({
        possibleFlags: [{ id: 'story_started', triggerDescription: 'Story begins' }],
        places: [
          {
            placeId: 'PLACE_fort_kharos',
            storyRole: 'Destination',
          },
        ],
        goals: [
          {
            id: 'GOAL_deliver',
            description: 'Deliver the package',
            progressBoost: 20,
            revealOnFlags: ['story_started'],
            destinationPlaceId: 'PLACE_nonexistent',
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(
        issues.some(
          (i) =>
            i.severity === 'error' &&
            i.field === 'destinationPlaceId' &&
            i.message.includes('does not match any place')
        )
      ).toBe(true);
    });

    it('accepts goal without destinationPlace (optional field)', () => {
      const plot = createBasicPlot({
        possibleFlags: [{ id: 'story_started', triggerDescription: 'Story begins' }],
        goals: [
          {
            id: 'GOAL_investigate',
            description: 'Investigate the mystery',
            progressBoost: 20,
            revealOnFlags: ['story_started'],
            // No destinationPlace - that's fine
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);

      expect(issues.filter((i) => i.field === 'destinationPlace')).toEqual([]);
    });
  });

  describe('repair', () => {
    it('repairs missing credits title', () => {
      const plot = createBasicPlot({
        credits: { title: '', entries: [] },
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);
      const fixed = plotConsistencyValidator.repair!(ctx, issues);

      expect(fixed.length).toBeGreaterThan(0);
      expect(plot.credits?.title).toBe('Test Plot');
    });

    it('repairs missing triggerDescription', () => {
      const plot = createBasicPlot({
        possibleFlags: [{ id: 'test_flag', triggerDescription: '' }],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);
      const fixed = plotConsistencyValidator.repair!(ctx, issues);

      expect(fixed.length).toBeGreaterThan(0);
      const flagDef = plot.possibleFlags![0];
      expect(flagDef.triggerDescription).toBeTruthy();
    });

    // Note: progressBoost is now enforced by the TypeScript type system
    // and no longer validated/repaired at runtime by plot-consistency validator.

    it('repairs character generic name by converting to matchHint', () => {
      const plot = createBasicPlot({
        characters: [
          {
            name: 'The Passage Broker',
            role: 'informant',
            description: 'A broker',
            publicFace: 'Helpful',
            hiddenTruth: 'Secret',
            locationHint: 'Somewhere',
            introductionProgress: 10,
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);
      const fixed = plotConsistencyValidator.repair!(ctx, issues);

      expect(fixed.length).toBeGreaterThan(0);
      const char = plot.characters![0];
      expect(char.matchHint).toBe('The Passage Broker');
      expect(char.name).toBeUndefined();
    });

    it('repairs multiple character generic names in sequence', () => {
      const plot = createBasicPlot({
        characters: [
          {
            name: 'The Wise Elder',
            role: 'informant',
            description: 'An elder',
            publicFace: 'Helpful',
            hiddenTruth: 'Secret',
            locationHint: 'Temple',
            introductionProgress: 10,
          },
          {
            name: 'The Masked Stranger',
            role: 'antagonist',
            description: 'A stranger',
            publicFace: 'Mysterious',
            hiddenTruth: 'Secret',
            locationHint: 'Shadows',
            introductionProgress: 30,
          },
        ],
      });
      const ctx = buildPlotValidationContext(plot);
      const issues = plotConsistencyValidator.validate(ctx);
      const fixed = plotConsistencyValidator.repair!(ctx, issues);

      // Should fix both character generic names
      expect(fixed.length).toBe(2);
      expect(plot.characters![0].matchHint).toBe('The Wise Elder');
      expect(plot.characters![0].name).toBeUndefined();
      expect(plot.characters![1].matchHint).toBe('The Masked Stranger');
      expect(plot.characters![1].name).toBeUndefined();
    });
  });
});
