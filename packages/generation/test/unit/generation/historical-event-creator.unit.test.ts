import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHistoricalEventsFromWorldBible } from '@dmnpc/generation/narrative/historical-event-creator.js';
import type { WorldBible, WorldBibleHistoricalEvent } from '@dmnpc/types/world';
import type { Place, UniverseEvent } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// Mock the universe-store module
vi.mock('@dmnpc/core/universe/universe-store.js', () => ({
  generateEventId: vi.fn().mockImplementation(async (_universeId, fact, _type) => {
    const slug = fact
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .substring(0, 30);
    return `EVENT_${slug}_${Date.now()}`;
  }),
}));

// Helper to create mock UniverseContext
const createMockContext = (places: Place[] = []) => {
  const events: UniverseEvent[] = [];
  const placesMap = new Map(places.map((p) => [p.id, p]));

  return {
    universeId: 'test_universe',
    places,
    events,
    findPlace: (id: string) => placesMap.get(id),
    upsertEvent: vi.fn().mockImplementation((event: UniverseEvent) => {
      events.push(event);
      return event;
    }),
  } as any;
};

// Helper to create test place
const createPlace = (id: string, label: string): Place => ({
  id,
  label,
  description: `${label} description`,
  short_description: label,
  tags: [],
  entityType: 'place',
  info: { environment: ENVIRONMENT_PRESETS.exterior() },
  position: { x: 0, y: 0, parent: null },
  relationships: [],
});

// Helper to create WorldBible historical event
const createWbEvent = (
  overrides: Partial<WorldBibleHistoricalEvent> = {}
): WorldBibleHistoricalEvent => ({
  fact: 'A significant event occurred',
  eventType: 'historical',
  scope: 'regional',
  significance: 'moderate',
  ...overrides,
});

describe('historical-event-creator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createHistoricalEventsFromWorldBible', () => {
    it('returns 0 when historicalEvents is empty', async () => {
      const ctx = createMockContext();
      const worldBible: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const count = await createHistoricalEventsFromWorldBible(ctx, worldBible);

      expect(count).toBe(0);
      expect(ctx.upsertEvent).not.toHaveBeenCalled();
    });

    it('returns 0 when historicalEvents is empty array', async () => {
      const ctx = createMockContext();
      const worldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      } as WorldBible;

      const count = await createHistoricalEventsFromWorldBible(ctx, worldBible);

      expect(count).toBe(0);
    });

    it('creates events for each WorldBible historical event', async () => {
      const ctx = createMockContext();
      const worldBible: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [
          createWbEvent({ fact: 'Event 1' }),
          createWbEvent({ fact: 'Event 2' }),
          createWbEvent({ fact: 'Event 3' }),
        ],
      };

      const count = await createHistoricalEventsFromWorldBible(ctx, worldBible);

      expect(count).toBe(3);
      expect(ctx.upsertEvent).toHaveBeenCalledTimes(3);
    });

    it('sets correct properties on created events', async () => {
      const ctx = createMockContext();
      const worldBible: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [
          createWbEvent({
            fact: 'The Great War ended',
            eventType: 'war',
            scope: 'global',
            significance: 'major',
          }),
        ],
      };

      await createHistoricalEventsFromWorldBible(ctx, worldBible);

      expect(ctx.upsertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'war',
          category: 'world',
          subject: 'War',
          fact: 'The Great War ended',
          significance: 'major',
          scope: 'global',
          important: true, // major significance = important
          // No witnessIds for public knowledge
        })
      );
    });

    it('resolves place names to place IDs', async () => {
      const places = [
        createPlace('PLACE_capital', 'Capital City'),
        createPlace('PLACE_harbor', 'Harbor District'),
      ];
      const ctx = createMockContext(places);

      const worldBible: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [
          createWbEvent({
            fact: 'The capital was founded',
            eventType: 'founding',
            relevantPlaces: ['Capital City', 'Unknown Place'],
          }),
        ],
      };

      await createHistoricalEventsFromWorldBible(ctx, worldBible);

      expect(ctx.upsertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          relevantPlaceIds: ['PLACE_capital'], // Only Capital City was resolved
        })
      );
    });

    it('sets importance based on significance', async () => {
      const ctx = createMockContext();
      const worldBible: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [
          createWbEvent({ fact: 'Major event', significance: 'major' }),
          createWbEvent({ fact: 'Moderate event', significance: 'moderate' }),
          createWbEvent({ fact: 'Minor event', significance: 'minor' }),
        ],
      };

      await createHistoricalEventsFromWorldBible(ctx, worldBible);

      const calls = ctx.upsertEvent.mock.calls;
      expect(calls[0][0].important).toBe(true); // major
      expect(calls[1][0].important).toBe(false); // moderate
      expect(calls[2][0].important).toBe(false); // minor
    });

    it('maps event types to subject labels', async () => {
      const ctx = createMockContext();
      const worldBible: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [
          createWbEvent({ fact: 'Founding', eventType: 'founding' }),
          createWbEvent({ fact: 'War', eventType: 'war' }),
          createWbEvent({ fact: 'Treaty', eventType: 'treaty' }),
          createWbEvent({ fact: 'Catastrophe', eventType: 'catastrophe' }),
          createWbEvent({ fact: 'Ruler change', eventType: 'ruler_change' }),
          createWbEvent({ fact: 'Discovery', eventType: 'discovery' }),
        ],
      };

      await createHistoricalEventsFromWorldBible(ctx, worldBible);

      const calls = ctx.upsertEvent.mock.calls;
      expect(calls[0][0].subject).toBe('Founding');
      expect(calls[1][0].subject).toBe('War');
      expect(calls[2][0].subject).toBe('Treaty');
      expect(calls[3][0].subject).toBe('Catastrophe');
      expect(calls[4][0].subject).toBe('Succession');
      expect(calls[5][0].subject).toBe('Discovery');
    });
  });
});
