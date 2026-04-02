/**
 * Orphaned References Validator Tests
 */

import { describe, it, expect } from 'vitest';
import { orphanedRefsValidator } from '@dmnpc/studio/integrity/validators/orphaned-refs.js';
import type {
  Character,
  Place,
  UniverseEvent,
  Universe
} from '@dmnpc/types/entity';
import type { StorytellerInstanceState, PlotState } from '@dmnpc/types/npc';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

function createTestContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  const places = new Map<string, Place>();
  places.set('PLACE_root', {
    id: 'PLACE_root',
    label: 'Root Place',
    description: 'The root place',
    short_description: 'root',
    tags: [],
    entityType: 'place',
    info: {},
    relationships: [],
  });
  places.set('PLACE_tavern', {
    id: 'PLACE_tavern',
    label: 'Tavern',
    description: 'A tavern',
    short_description: 'tavern',
    tags: [],
    entityType: 'place',
    info: {},
    relationships: [],
  });

  const characters = new Map<string, Character>();
  characters.set('CHAR_npc', {
    id: 'CHAR_npc',
    label: 'NPC',
    description: 'An NPC',
    short_description: 'npc',
    tags: [],
    entityType: 'character',
    position: { x: null, y: null, parent: 'PLACE_root' },
    info: {
      aliases: [],
      birthdate: '01.01.1450 4A',
      birthPlace: 'Test Town',
      eyeColor: 'Blue',
      gender: 'Male',
      hairColor: 'Brown',
      personality: 'Friendly',
      race: 'RACE_human',
      messages: [],
      journal: [],
    },
    relationships: [],
  });

  const events = new Map<string, UniverseEvent>();
  events.set('EVENT_test', {
    id: 'EVENT_test',
    category: 'world',
    subject: 'Test Event',
    fact: 'Something happened',
    significance: 'minor',
    witnessIds: ['CHAR_npc'],
    placeId: 'PLACE_root',
  });

  return {
    universe: {
      id: 'test',
      name: 'Test Universe',
      version: '1.0',
      description: '',
      custom: {},
      rules: '',
      tone: '',
      style: '',
      voice: 'alloy',
      date: '01.01.1477 4A',
      races: [],
      rootPlaceId: 'PLACE_root',
    } as Universe,
    characters,
    places,
    objects: new Map(),
    events,
    validRaceIds: new Set(['RACE_human']),
    rootPlaceId: 'PLACE_root',
    ...overrides,
  };
}

describe('OrphanedRefsValidator', () => {
  describe('character validation', () => {
    it('should detect invalid position.parent', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: 'PLACE_nonexistent' }, // Invalid
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          messages: [],
          journal: [],
        },
        relationships: [],
      };

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('position.parent');
      expect(issues[0].suggestedFix?.value).toBe('PLACE_root');
    });

    it('should detect empty position.parent', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: null }, // Empty
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          messages: [],
          journal: [],
        },
        relationships: [],
      };

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('position.parent');
      expect(issues[0].message).toBe('Character has empty position.parent');
      expect(issues[0].suggestedFix?.value).toBe('PLACE_root');
    });

    it('should detect invalid relationship references', async () => {
      const validRel = { targetId: 'CHAR_npc', type: 'knows' as const, disposition: 0, familiarity: 50, context: null };
      const invalidRel = { targetId: 'CHAR_nonexistent', type: 'knows' as const, disposition: 0, familiarity: 50, context: null };
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: 'PLACE_root' },
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          messages: [],
          journal: [],
        },
        relationships: [validRel, invalidRel], // One valid, one invalid
      };

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('relationships');
      expect(issues[0].suggestedFix?.value).toEqual([validRel]); // Only valid one
    });

    it('should not flag valid references', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: 'PLACE_root' },
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          messages: [],
          journal: [],
        },
        relationships: [
          { targetId: 'CHAR_npc', type: 'knows' as const, disposition: 0, familiarity: 50, context: null },
        ],
      };

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should detect invalid destinationPlaceId', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: 'PLACE_root' },
        destinationPlaceId: 'PLACE_nonexistent',
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          messages: [],
          journal: [],
        },
        relationships: [],
      };

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues.some((i) => i.field === 'destinationPlaceId')).toBe(true);
      const issue = issues.find((i) => i.field === 'destinationPlaceId')!;
      expect(issue.message).toContain('PLACE_nonexistent');
      expect(issue.suggestedFix?.value).toBeUndefined();
    });

    it('should detect invalid travelPath segment references', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: 'PLACE_root' },
        travelPath: {
          segments: [
            { fromPlaceId: 'PLACE_root', toPlaceId: 'PLACE_nonexistent', exitId: null, distanceMiles: 1 },
          ],
          totalDistanceMiles: 1,
          estimatedMinutes: 15,
        },
        travelSegmentIndex: 0,
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          messages: [],
          journal: [],
        },
        relationships: [],
      };

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues.some((i) => i.field === 'travelPath')).toBe(true);
      const issue = issues.find((i) => i.field === 'travelPath')!;
      expect(issue.message).toContain('PLACE_nonexistent');
      expect(issue.suggestedFix?.value).toBeUndefined();
    });

    it('should detect invalid vesselRoutes port references', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: 'PLACE_root' },
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          messages: [],
          journal: [],
          vesselRoutes: [
            {
              id: 'route_1',
              name: 'Trade Route',
              ports: ['PLACE_root', 'PLACE_nonexistent', 'PLACE_tavern'],
              departures: [{ hour: 8 }],
              farePerLeg: null,
            },
          ],
        },
        relationships: [],
      };

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues.some((i) => i.field === 'info.vesselRoutes[0].ports')).toBe(true);
      const issue = issues.find((i) => i.field === 'info.vesselRoutes[0].ports')!;
      expect(issue.message).toContain('PLACE_nonexistent');
      expect(issue.suggestedFix?.value).toEqual(['PLACE_root', 'PLACE_tavern']);
    });
  });

  describe('universe event validation', () => {
    it('should detect invalid witnessIds', async () => {
      const event = {
        id: 'EVENT_bad_witness',
        category: 'world',
        subject: 'Test Event',
        fact: 'Something happened',
        significance: 'minor',
        witnessIds: ['CHAR_npc', 'CHAR_nonexistent'], // One valid, one invalid
        placeId: 'PLACE_root',
      } as unknown as UniverseEvent;

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(event as unknown as Character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('witnessIds');
      expect(issues[0].message).toContain('CHAR_nonexistent');
      expect(issues[0].suggestedFix?.value).toEqual(['CHAR_npc']); // Only valid one
    });

    it('should detect all invalid witnessIds and suggest undefined', async () => {
      const event = {
        id: 'EVENT_all_bad_witness',
        category: 'world',
        subject: 'Test Event',
        fact: 'Something happened',
        significance: 'minor',
        witnessIds: ['CHAR_nonexistent1', 'CHAR_nonexistent2'], // All invalid
      } as unknown as UniverseEvent;

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(event as unknown as Character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('witnessIds');
      expect(issues[0].suggestedFix?.value).toBeUndefined(); // Clear all
    });

    it('should detect invalid placeId', async () => {
      const event = {
        id: 'EVENT_bad_place',
        category: 'world',
        subject: 'Test Event',
        fact: 'Something happened',
        significance: 'minor',
        placeId: 'PLACE_nonexistent', // Invalid
      } as unknown as UniverseEvent;

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(event as unknown as Character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('placeId');
      expect(issues[0].suggestedFix?.value).toBeUndefined();
    });

    it('should detect invalid subjectId', async () => {
      const event = {
        id: 'EVENT_bad_subject',
        category: 'world',
        subject: 'Test Event',
        fact: 'Something happened',
        significance: 'minor',
        subjectId: 'CHAR_nonexistent', // Invalid
      } as unknown as UniverseEvent;

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(event as unknown as Character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('subjectId');
      expect(issues[0].suggestedFix?.value).toBeUndefined();
    });

    it('should accept valid subjectId referencing any entity type', async () => {
      // Test character subjectId
      const eventWithChar = {
        id: 'EVENT_char_subject',
        category: 'world',
        subject: 'Test',
        fact: 'Something',
        significance: 'minor',
        subjectId: 'CHAR_npc',
      } as unknown as UniverseEvent;

      // Test place subjectId
      const eventWithPlace = {
        id: 'EVENT_place_subject',
        category: 'world',
        subject: 'Test',
        fact: 'Something',
        significance: 'minor',
        subjectId: 'PLACE_root',
      } as unknown as UniverseEvent;

      // Test event subjectId (self-reference allowed)
      const eventWithEvent = {
        id: 'EVENT_event_subject',
        category: 'world',
        subject: 'Test',
        fact: 'Something',
        significance: 'minor',
        subjectId: 'EVENT_test',
      } as unknown as UniverseEvent;

      const ctx = createTestContext();

      const charIssues = await orphanedRefsValidator.validate(
        eventWithChar as unknown as Character,
        ctx
      );
      const placeIssues = await orphanedRefsValidator.validate(
        eventWithPlace as unknown as Character,
        ctx
      );
      const eventIssues = await orphanedRefsValidator.validate(
        eventWithEvent as unknown as Character,
        ctx
      );

      expect(charIssues).toHaveLength(0);
      expect(placeIssues).toHaveLength(0);
      expect(eventIssues).toHaveLength(0);
    });

    it('should not flag event with no references', async () => {
      const event = {
        id: 'EVENT_minimal',
        category: 'world',
        subject: 'Test Event',
        fact: 'Something happened',
        significance: 'minor',
        // No witnessIds, placeId, or subjectId
      } as unknown as UniverseEvent;

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(event as unknown as Character, ctx);

      expect(issues).toHaveLength(0);
    });
  });

  describe('storyteller event validation', () => {
    function createCharacterWithStorytellerState(
      storytellerState: Partial<StorytellerInstanceState>
    ): Character {
      return {
        id: 'CHAR_player',
        label: 'Player',
        description: 'A player character',
        short_description: 'player',
        tags: [],
        entityType: 'character',
        position: { x: null, y: null, parent: 'PLACE_root' },
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Brave',
          race: 'RACE_human',
          messages: [],
          journal: [],
          sketches: [],
          voice: { voiceId: 'test', voiceName: 'Test' },
          isPlayer: true,
          storytellerState: {
            storytellerId: 'test',
            voice: { voiceId: 'test', voiceName: 'Test' },
            activePlots: [],
            generationInProgress: false,
            eventHistory: [],
            storytellerSelectedAt: '01.01.1477 4A',
            custom: {},
            ...storytellerState,
          },
        },
        relationships: [],
      };
    }

    function createPlotState(overrides: Partial<PlotState> = {}): PlotState {
      return {
        id: 'plot_123',
        progressLevel: 50,
        storyFlags: [],
        events: [
          {
            id: 'event_456',
            type: 'discovery',
            description: 'Found something',
            timestamp: '01.01.1477 4A',
            affectedEntities: [],
          },
        ],
        plan: {
          label: 'Test Plot',
          plot: 'A test plot',
          characters: [],
          places: [],
          items: [],
          turningPoints: [
            {
              id: 'tp_1',
              description: 'Inciting incident',
              progressTarget: 20,
              dramaticRole: 'inciting_incident',
              triggered: true,
              triggeredAt: '01.01.1477 4A',
              triggeredByEventId: 'event_456', // Valid reference
            },
          ],
        },
        ...overrides,
      };
    }

    it('should detect invalid triggeredByEventId', async () => {
      const plotWithBadRef = createPlotState({
        plan: {
          label: 'Test Plot',
          plot: 'A test plot',
          characters: [],
          places: [],
          items: [],
          turningPoints: [
            {
              id: 'tp_1',
              description: 'Inciting incident',
              progressTarget: 20,
              dramaticRole: 'inciting_incident',
              triggered: true,
              triggeredAt: '01.01.1477 4A',
              triggeredByEventId: 'event_nonexistent', // Invalid reference
            },
          ],
        },
      });

      const character = createCharacterWithStorytellerState({
        activePlots: [plotWithBadRef],
      });

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toContain('triggeredByEventId');
      expect(issues[0].message).toContain('event_nonexistent');
      expect(issues[0].suggestedFix?.value).toBeUndefined();
    });

    it('should not flag valid triggeredByEventId', async () => {
      const plotWithValidRef = createPlotState(); // Has event_456 and references it

      const character = createCharacterWithStorytellerState({
        activePlots: [plotWithValidRef],
      });

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should not flag turning points without triggeredByEventId', async () => {
      const plotWithNoRef = createPlotState({
        plan: {
          label: 'Test Plot',
          plot: 'A test plot',
          characters: [],
          places: [],
          items: [],
          turningPoints: [
            {
              id: 'tp_1',
              description: 'Inciting incident',
              progressTarget: 20,
              dramaticRole: 'inciting_incident',
              triggered: false, // Not triggered, no event ID
            },
          ],
        },
      });

      const character = createCharacterWithStorytellerState({
        activePlots: [plotWithNoRef],
      });

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should validate multiple plots independently', async () => {
      const plot1 = createPlotState({
        id: 'plot_1',
        events: [
          {
            id: 'event_1',
            type: 'discovery',
            description: 'Found',
            timestamp: 't',
            affectedEntities: [],
          },
        ],
        plan: {
          label: 'Plot 1',
          plot: 'Plot 1',
          characters: [],
          places: [],
          items: [],
          turningPoints: [
            {
              id: 'tp_1',
              description: 'TP1',
              progressTarget: 20,
              dramaticRole: 'inciting_incident',
              triggeredByEventId: 'event_1', // Valid in this plot
            },
          ],
        },
      });

      const plot2 = createPlotState({
        id: 'plot_2',
        events: [
          {
            id: 'event_2',
            type: 'discovery',
            description: 'Found',
            timestamp: 't',
            affectedEntities: [],
          },
        ],
        plan: {
          label: 'Plot 2',
          plot: 'Plot 2',
          characters: [],
          places: [],
          items: [],
          turningPoints: [
            {
              id: 'tp_2',
              description: 'TP2',
              progressTarget: 20,
              dramaticRole: 'inciting_incident',
              triggeredByEventId: 'event_1', // Invalid - event_1 is in plot_1, not plot_2
            },
          ],
        },
      });

      const character = createCharacterWithStorytellerState({
        activePlots: [plot1, plot2],
      });

      const ctx = createTestContext();
      const issues = await orphanedRefsValidator.validate(character, ctx);

      // Should flag plot_2's reference since event_1 doesn't exist in plot_2
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('event_1');
    });
  });
});
