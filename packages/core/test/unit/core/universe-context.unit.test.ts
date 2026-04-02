/**
 * Unit tests for UniverseContext
 *
 * Tests the core universe state container including:
 * - Static factory methods (loadAtEntryPoint, fromData)
 * - Entity accessors (get/find methods)
 * - Entity operations (upsertEntity, persistAll)
 * - Relationship management
 * - Query methods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import {
  createTestCharacter,
  createTestPlace,
  createTestExit,
  createTestObjectEntity,
  defaultMockUniverse,
} from '@dmnpc/core/test-helpers/index.js';
import type {
  Character,
  Place,
  ObjectEntity,
  Universe,
  UniverseEvent
} from '@dmnpc/types/entity';

// ============================================================================
// Mock Dependencies
// ============================================================================

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

vi.mock('@dmnpc/core/stores/world-bible-store.js', () => ({
  loadWorldBible: vi.fn().mockResolvedValue(null),
}));

// ============================================================================
// Test Helpers
// ============================================================================

function createTestUniverseContext(overrides?: {
  universeId?: string;
  characters?: Character[];
  places?: Place[];
  objects?: ObjectEntity[];
  events?: UniverseEvent[];
}): UniverseContext {
  const universeId = overrides?.universeId || 'test_universe';
  const universe: Universe = {
    ...defaultMockUniverse,
    id: universeId,
  };
  const characters = overrides?.characters || [];
  const places = overrides?.places || [];
  const objects = overrides?.objects || [];
  const events = overrides?.events || [];

  return UniverseContext.fromData(universeId, universe, characters, places, objects, events);
}

// ============================================================================
// Static Factory Methods
// ============================================================================

describe('UniverseContext static methods', () => {
  describe('fromData', () => {
    it('creates context from provided data', () => {
      const character = createTestCharacter({ id: 'CHAR_test' });
      const place = createTestPlace({ id: 'PLACE_test' });
      const exit = createTestExit({ id: 'OBJ_exit_test' });

      const universe: Universe = {
        ...defaultMockUniverse,
        id: 'test_universe',
      };
      const ctx = UniverseContext.fromData(
        'test_universe',
        universe,
        [character],
        [place],
        [exit]
      );

      expect(ctx.universeId).toBe('test_universe');
      expect(ctx.characters).toHaveLength(1);
      expect(ctx.places).toHaveLength(1);
      expect(ctx.objects).toHaveLength(1);
    });

    it('handles empty entity arrays', () => {
      const universe: Universe = {
        ...defaultMockUniverse,
        id: 'test_universe',
      };
      const ctx = UniverseContext.fromData('test_universe', universe);

      expect(ctx.characters).toHaveLength(0);
      expect(ctx.places).toHaveLength(0);
      expect(ctx.objects).toHaveLength(0);
      expect(ctx.events).toHaveLength(0);
    });
  });
});

// ============================================================================
// Getters
// ============================================================================

describe('UniverseContext getters', () => {
  it('returns universeId', () => {
    const ctx = createTestUniverseContext({ universeId: 'my_universe' });
    expect(ctx.universeId).toBe('my_universe');
  });

  it('returns universe object', () => {
    const universe: Universe = {
      ...defaultMockUniverse,
      id: 'test_universe',
    };
    const ctx = UniverseContext.fromData('test_universe', universe);
    expect(ctx.universe).toBe(universe);
  });

  it('returns characters array', () => {
    const char1 = createTestCharacter({ id: 'CHAR_1' });
    const char2 = createTestCharacter({ id: 'CHAR_2' });
    const ctx = createTestUniverseContext({ characters: [char1, char2] });

    const characters = ctx.characters;
    expect(characters).toHaveLength(2);
    expect(characters).toContain(char1);
    expect(characters).toContain(char2);
  });

  it('returns places array', () => {
    const place1 = createTestPlace({ id: 'PLACE_1' });
    const place2 = createTestPlace({ id: 'PLACE_2' });
    const ctx = createTestUniverseContext({ places: [place1, place2] });

    const places = ctx.places;
    expect(places).toHaveLength(2);
    expect(places).toContain(place1);
    expect(places).toContain(place2);
  });

  it('returns events array', () => {
    const event1: UniverseEvent = {
      id: 'EVENT_1',
      date: '15.03.1472 4A 14:00',
      placeId: 'PLACE_test',
      eventType: 'world',
      category: 'world',
      subject: 'Test',
      subjectId: 'PLACE_test',
      fact: 'Something happened',
      significance: 'minor',
      witnessIds: [],
    };
    const event2: UniverseEvent = {
      id: 'EVENT_2',
      date: '15.03.1472 4A 15:00',
      placeId: 'PLACE_test',
      eventType: 'world',
      category: 'world',
      subject: 'Test',
      subjectId: 'PLACE_test',
      fact: 'Something else happened',
      significance: 'minor',
      witnessIds: [],
    };
    const ctx = createTestUniverseContext({ events: [event1, event2] });

    const events = ctx.events;
    expect(events).toHaveLength(2);
    expect(events).toContain(event1);
    expect(events).toContain(event2);
  });

  it('returns worldBible when present', () => {
    const worldBible = {
      id: 'WORLDBIBLE_test',
      universeId: 'test_universe',
      extractedFacts: [],
      characterSummaries: [],
      placeSummaries: [],
      timeline: [],
    };
    const universe: Universe = {
      ...defaultMockUniverse,
      id: 'test_universe',
    };
    const ctx = UniverseContext.fromData('test_universe', universe, [], [], [], [], worldBible);

    expect(ctx.worldBible).toBe(worldBible);
    expect(ctx.hasWorldBible).toBe(true);
  });

  it('returns null worldBible when absent', () => {
    const ctx = createTestUniverseContext();
    expect(ctx.worldBible).toBeNull();
    expect(ctx.hasWorldBible).toBe(false);
  });
});

// ============================================================================
// Entity Accessors
// ============================================================================

describe('UniverseContext entity accessors', () => {
  describe('getCharacter', () => {
    it('returns character when found', () => {
      const character = createTestCharacter({ id: 'CHAR_test' });
      const ctx = createTestUniverseContext({ characters: [character] });

      expect(ctx.getCharacter('CHAR_test')).toBe(character);
    });

    it('throws error when character not found', () => {
      const ctx = createTestUniverseContext();
      expect(() => ctx.getCharacter('CHAR_nonexistent')).toThrow(
        'Character CHAR_nonexistent not found'
      );
    });
  });

  describe('findCharacter', () => {
    it('returns character when found', () => {
      const character = createTestCharacter({ id: 'CHAR_test' });
      const ctx = createTestUniverseContext({ characters: [character] });

      expect(ctx.findCharacter('CHAR_test')).toBe(character);
    });

    it('returns undefined when character not found', () => {
      const ctx = createTestUniverseContext();
      expect(ctx.findCharacter('CHAR_nonexistent')).toBeUndefined();
    });
  });

  describe('getPlace', () => {
    it('returns place when found', () => {
      const place = createTestPlace({ id: 'PLACE_test' });
      const ctx = createTestUniverseContext({ places: [place] });

      expect(ctx.getPlace('PLACE_test')).toBe(place);
    });

    it('throws error when place not found', () => {
      const ctx = createTestUniverseContext();
      expect(() => ctx.getPlace('PLACE_nonexistent')).toThrow('Place PLACE_nonexistent not found');
    });
  });

  describe('findPlace', () => {
    it('returns place when found', () => {
      const place = createTestPlace({ id: 'PLACE_test' });
      const ctx = createTestUniverseContext({ places: [place] });

      expect(ctx.findPlace('PLACE_test')).toBe(place);
    });

    it('returns undefined when place not found', () => {
      const ctx = createTestUniverseContext();
      expect(ctx.findPlace('PLACE_nonexistent')).toBeUndefined();
    });
  });

  describe('getEvent', () => {
    it('returns event when found', () => {
      const event: UniverseEvent = {
        id: 'EVENT_test',
        date: '15.03.1472 4A 14:00',
        placeId: 'PLACE_test',
        eventType: 'world',
        category: 'world',
        subject: 'Test',
        subjectId: 'PLACE_test',
        fact: 'Something happened',
        significance: 'minor',
        witnessIds: [],
      };
      const ctx = createTestUniverseContext({ events: [event] });

      expect(ctx.getEvent('EVENT_test')).toBe(event);
    });

    it('throws error when event not found', () => {
      const ctx = createTestUniverseContext();
      expect(() => ctx.getEvent('EVENT_nonexistent')).toThrow('Event EVENT_nonexistent not found');
    });
  });

  describe('findEvent', () => {
    it('returns event when found', () => {
      const event: UniverseEvent = {
        id: 'EVENT_test',
        date: '15.03.1472 4A 14:00',
        placeId: 'PLACE_test',
        eventType: 'world',
        category: 'world',
        subject: 'Test',
        subjectId: 'PLACE_test',
        fact: 'Something happened',
        significance: 'minor',
        witnessIds: [],
      };
      const ctx = createTestUniverseContext({ events: [event] });

      expect(ctx.findEvent('EVENT_test')).toBe(event);
    });

    it('returns undefined when event not found', () => {
      const ctx = createTestUniverseContext();
      expect(ctx.findEvent('EVENT_nonexistent')).toBeUndefined();
    });
  });
});

// ============================================================================
// Entity Operations
// ============================================================================

describe('UniverseContext entity operations', () => {
  describe('upsertEntity', () => {
    it('adds new character', () => {
      const ctx = createTestUniverseContext();
      const character = createTestCharacter({ id: 'CHAR_new' });

      ctx.upsertEntity('character', character);

      expect(ctx.findCharacter('CHAR_new')).toBe(character);
      expect(ctx.characters).toHaveLength(1);
    });

    it('updates existing character', () => {
      const original = createTestCharacter({ id: 'CHAR_test', label: 'Original' });
      const ctx = createTestUniverseContext({ characters: [original] });

      const updated = createTestCharacter({ id: 'CHAR_test', label: 'Updated' });
      ctx.upsertEntity('character', updated);

      expect(ctx.getCharacter('CHAR_test').label).toBe('Updated');
      expect(ctx.characters).toHaveLength(1);
    });

    it('adds new place', () => {
      const ctx = createTestUniverseContext();
      const place = createTestPlace({ id: 'PLACE_new' });

      ctx.upsertEntity('place', place);

      expect(ctx.findPlace('PLACE_new')).toBe(place);
      expect(ctx.places).toHaveLength(1);
    });

    it('updates existing place', () => {
      const original = createTestPlace({ id: 'PLACE_test', label: 'Original' });
      const ctx = createTestUniverseContext({ places: [original] });

      const updated = createTestPlace({ id: 'PLACE_test', label: 'Updated' });
      ctx.upsertEntity('place', updated);

      expect(ctx.getPlace('PLACE_test').label).toBe('Updated');
      expect(ctx.places).toHaveLength(1);
    });

    it('adds new event', () => {
      const ctx = createTestUniverseContext();
      const event: UniverseEvent = {
        id: 'EVENT_new',
        date: '15.03.1472 4A 14:00',
        placeId: 'PLACE_test',
        eventType: 'world',
        category: 'world',
        subject: 'Test',
        subjectId: 'PLACE_test',
        fact: 'Something happened',
        significance: 'minor',
        witnessIds: [],
      };

      ctx.upsertEvent(event);

      expect(ctx.findEvent('EVENT_new')).toBe(event);
      expect(ctx.events).toHaveLength(1);
    });
  });

  describe('getEventsForCharacter', () => {
    it('returns events witnessed by character', () => {
      const event1: UniverseEvent = {
        id: 'EVENT_1',
        date: '15.03.1472 4A 14:00',
        placeId: 'PLACE_test',
        eventType: 'world',
        category: 'world',
        subject: 'Test',
        subjectId: 'PLACE_test',
        fact: 'Event 1',
        significance: 'minor',
        witnessIds: ['CHAR_witness'],
      };
      const event2: UniverseEvent = {
        id: 'EVENT_2',
        date: '15.03.1472 4A 15:00',
        placeId: 'PLACE_test',
        eventType: 'world',
        category: 'world',
        subject: 'Test',
        subjectId: 'PLACE_test',
        fact: 'Event 2',
        significance: 'minor',
        witnessIds: ['CHAR_witness', 'CHAR_other'],
      };
      const event3: UniverseEvent = {
        id: 'EVENT_3',
        date: '15.03.1472 4A 16:00',
        placeId: 'PLACE_test',
        eventType: 'world',
        category: 'world',
        subject: 'Test',
        subjectId: 'PLACE_test',
        fact: 'Event 3',
        significance: 'minor',
        witnessIds: ['CHAR_other'],
      };

      const ctx = createTestUniverseContext({ events: [event1, event2, event3] });

      const witnessedEvents = ctx.getEventsForCharacter('CHAR_witness');
      expect(witnessedEvents).toHaveLength(2);
      expect(witnessedEvents).toContain(event1);
      expect(witnessedEvents).toContain(event2);
      expect(witnessedEvents).not.toContain(event3);
    });

    it('returns empty array when character witnessed no events', () => {
      const event: UniverseEvent = {
        id: 'EVENT_1',
        date: '15.03.1472 4A 14:00',
        placeId: 'PLACE_test',
        eventType: 'world',
        category: 'world',
        subject: 'Test',
        subjectId: 'PLACE_test',
        fact: 'Event',
        significance: 'minor',
        witnessIds: ['CHAR_other'],
      };

      const ctx = createTestUniverseContext({ events: [event] });

      expect(ctx.getEventsForCharacter('CHAR_witness')).toHaveLength(0);
    });
  });
});

// ============================================================================
// Relationship Management
// ============================================================================

describe('UniverseContext relationship management', () => {
  describe('getRelationship', () => {
    it('returns relationship when found', () => {
      const char1 = createTestCharacter({
        id: 'CHAR_1',
        relationships: [
          {
            targetId: 'CHAR_2',
            type: 'friend',
            familiarity: 50,
            disposition: 20,
          },
        ],
      });
      const char2 = createTestCharacter({ id: 'CHAR_2' });
      const ctx = createTestUniverseContext({ characters: [char1, char2] });

      const relationship = ctx.getRelationship('CHAR_1', 'CHAR_2');
      expect(relationship).toBeDefined();
      expect(relationship?.type).toBe('friend');
      expect(relationship?.familiarity).toBe(50);
    });

    it('returns undefined when relationship not found', () => {
      const char1 = createTestCharacter({ id: 'CHAR_1' });
      const char2 = createTestCharacter({ id: 'CHAR_2' });
      const ctx = createTestUniverseContext({ characters: [char1, char2] });

      expect(ctx.getRelationship('CHAR_1', 'CHAR_2')).toBeUndefined();
    });
  });

  describe('isKnown', () => {
    it('returns true when name_revealed event exists', () => {
      const char1 = createTestCharacter({ id: 'CHAR_1' });
      const char2 = createTestCharacter({ id: 'CHAR_2', label: 'Bob' });
      const nameRevealedEvent: UniverseEvent = {
        id: 'EVENT_name_revealed',
        date: '15.03.1472 4A 14:00',
        placeId: 'PLACE_test',
        eventType: 'name_revealed',
        category: 'knowledge',
        subject: 'Bob',
        subjectId: 'CHAR_2',
        fact: 'Learned the name "Bob"',
        significance: 'minor',
        witnessIds: ['CHAR_1'],
      };

      const ctx = createTestUniverseContext({
        characters: [char1, char2],
        events: [nameRevealedEvent],
      });

      // isKnown checks for name_revealed events
      expect(ctx.isKnown('CHAR_1', 'CHAR_2')).toBe(true);
    });

    it('returns true when character knows themselves', () => {
      const char1 = createTestCharacter({ id: 'CHAR_1' });
      const ctx = createTestUniverseContext({ characters: [char1] });

      expect(ctx.isKnown('CHAR_1', 'CHAR_1')).toBe(true);
    });

    it('returns false when relationship does not exist', () => {
      const char1 = createTestCharacter({ id: 'CHAR_1' });
      const char2 = createTestCharacter({ id: 'CHAR_2' });
      const ctx = createTestUniverseContext({ characters: [char1, char2] });

      expect(ctx.isKnown('CHAR_1', 'CHAR_2')).toBe(false);
    });
  });

  describe('upsertRelationship', () => {
    it('adds new relationship', () => {
      const char1 = createTestCharacter({ id: 'CHAR_1' });
      const char2 = createTestCharacter({ id: 'CHAR_2' });
      const ctx = createTestUniverseContext({ characters: [char1, char2] });

      const relationship = {
        targetId: 'CHAR_2',
        type: 'friend' as const,
        familiarity: 50,
        disposition: 20,
      };

      ctx.upsertRelationship('CHAR_1', relationship);

      const retrieved = ctx.getRelationship('CHAR_1', 'CHAR_2');
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('friend');
    });

    it('updates existing relationship', () => {
      const char1 = createTestCharacter({
        id: 'CHAR_1',
        relationships: [
          {
            targetId: 'CHAR_2',
            type: 'acquaintance',
            familiarity: 10,
            disposition: 0,
          },
        ],
      });
      const char2 = createTestCharacter({ id: 'CHAR_2' });
      const ctx = createTestUniverseContext({ characters: [char1, char2] });

      const updated = {
        targetId: 'CHAR_2',
        type: 'friend' as const,
        familiarity: 60,
        disposition: 30,
      };

      ctx.upsertRelationship('CHAR_1', updated);

      const retrieved = ctx.getRelationship('CHAR_1', 'CHAR_2');
      expect(retrieved?.type).toBe('friend');
      expect(retrieved?.familiarity).toBe(60);
    });
  });
});

// ============================================================================
// Query Methods
// ============================================================================

describe('UniverseContext query methods', () => {
  describe('getExitsFromPlace', () => {
    it('returns exit objects from a place', () => {
      const place = createTestPlace({ id: 'PLACE_tavern' });
      const exit1 = createTestExit({
        id: 'OBJ_exit_1',
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_tavern' },
      });
      const exit2 = createTestExit({
        id: 'OBJ_exit_2',
        position: { x: 100, y: 100, width: 32, height: 32, parent: 'PLACE_tavern' },
      });
      const exit3 = createTestExit({
        id: 'OBJ_exit_3',
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_other' },
      });
      const nonExitObject = createTestObjectEntity({
        id: 'OBJ_non_exit',
        label: 'Table',
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_tavern' },
        info: { purpose: 'furniture' },
      });

      const ctx = createTestUniverseContext({
        places: [place],
        objects: [exit1, exit2, exit3, nonExitObject],
      });

      const exits = ctx.getExitsFromPlace('PLACE_tavern');
      expect(exits).toHaveLength(2);
      expect(exits).toContain(exit1);
      expect(exits).toContain(exit2);
      expect(exits).not.toContain(exit3);
      expect(exits).not.toContain(nonExitObject);
    });

    it('returns empty array when no exits from place', () => {
      const place = createTestPlace({ id: 'PLACE_tavern' });
      const ctx = createTestUniverseContext({ places: [place] });

      expect(ctx.getExitsFromPlace('PLACE_tavern')).toHaveLength(0);
    });

    it('returns all exits in a place', () => {
      const place = createTestPlace({ id: 'PLACE_tavern' });
      const exit1 = createTestExit({
        id: 'OBJ_exit_front',
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_tavern' },
      });
      const exit2 = createTestExit({
        id: 'OBJ_exit_back',
        position: { x: 100, y: 100, width: 32, height: 32, parent: 'PLACE_tavern' },
      });

      const ctx = createTestUniverseContext({
        places: [place],
        objects: [exit1, exit2],
      });

      const exits = ctx.getExitsFromPlace('PLACE_tavern');
      expect(exits).toHaveLength(2);
      expect(exits).toContain(exit1);
      expect(exits).toContain(exit2);
    });
  });

  describe('getEntitiesByPlace', () => {
    it('returns characters at a place', () => {
      const place = createTestPlace({ id: 'PLACE_tavern' });
      const char1 = createTestCharacter({
        id: 'CHAR_1',
        position: { x: null, y: null, parent: 'PLACE_tavern' },
      });
      const char2 = createTestCharacter({
        id: 'CHAR_2',
        position: { x: null, y: null, parent: 'PLACE_tavern' },
      });
      const char3 = createTestCharacter({
        id: 'CHAR_3',
        position: { x: null, y: null, parent: 'PLACE_other' },
      });

      const ctx = createTestUniverseContext({
        places: [place],
        characters: [char1, char2, char3],
      });

      const entities = ctx.getEntitiesByPlace('PLACE_tavern');
      expect(entities).toHaveLength(2);
      expect(entities.map((e) => e.id)).toContain('CHAR_1');
      expect(entities.map((e) => e.id)).toContain('CHAR_2');
      expect(entities.map((e) => e.id)).not.toContain('CHAR_3');
    });

    it('excludes specified character when provided', () => {
      const place = createTestPlace({ id: 'PLACE_tavern' });
      const char1 = createTestCharacter({
        id: 'CHAR_1',
        position: { x: null, y: null, parent: 'PLACE_tavern' },
      });
      const char2 = createTestCharacter({
        id: 'CHAR_2',
        position: { x: null, y: null, parent: 'PLACE_tavern' },
      });

      const ctx = createTestUniverseContext({
        places: [place],
        characters: [char1, char2],
      });

      const entities = ctx.getEntitiesByPlace('PLACE_tavern', 'CHAR_1');
      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe('CHAR_2');
    });
  });
});

// ============================================================================
// persistAll() mutex (FEAT-358)
// ============================================================================

describe('persistAll mutex', () => {
  it('serializes concurrent persistAll calls', async () => {
    const ctx = createTestUniverseContext({
      characters: [createTestCharacter({ id: 'CHAR_a' })],
    });

    // Track the order of execution
    const executionOrder: string[] = [];

    // Mock readdir to introduce an async delay so we can observe serialization
    const { readdir } = await import('node:fs/promises');
    const readdirMock = vi.mocked(readdir);
    let callCount = 0;
    readdirMock.mockImplementation(async () => {
      callCount++;
      const myCall = callCount;
      executionOrder.push(`start-${myCall}`);
      // Small delay to make concurrency observable
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push(`end-${myCall}`);
      return [] as unknown as Awaited<ReturnType<typeof readdir>>;
    });

    // Fire two concurrent persistAll calls
    const p1 = ctx.persistAll();
    const p2 = ctx.persistAll();
    await Promise.all([p1, p2]);

    // With serialization: first call must fully complete before second starts.
    // persistAll iterates 4 entity types, so readdir is called 4 times per persistAll.
    // The second batch of 4 should start only after the first batch finishes.
    // Verify no interleaving: all start-1..start-4 entries come before start-5..start-8.
    const startIndices = executionOrder
      .map((entry, i) => (entry.startsWith('start-') ? i : -1))
      .filter((i) => i >= 0);
    const endIndices = executionOrder
      .map((entry, i) => (entry.startsWith('end-') ? i : -1))
      .filter((i) => i >= 0);

    // First batch: calls 1-4, Second batch: calls 5-8
    // The last end of the first batch must come before the first start of the second batch
    const firstBatchLastEnd = endIndices[3]; // end of 4th readdir call
    const secondBatchFirstStart = startIndices[4]; // start of 5th readdir call
    expect(secondBatchFirstStart).toBeGreaterThan(firstBatchLastEnd);
  });

  it('allows subsequent calls even if a prior call fails', async () => {
    const ctx = createTestUniverseContext({
      characters: [createTestCharacter({ id: 'CHAR_a' })],
    });

    // mkdirSync is NOT try-catch wrapped in _persistAllImpl, so throwing it
    // causes persistAll to reject.
    const { mkdirSync } = await import('node:fs');
    const mkdirMock = vi.mocked(mkdirSync);

    let callIdx = 0;
    mkdirMock.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        throw new Error('disk failure');
      }
      return undefined as unknown as ReturnType<typeof mkdirSync>;
    });

    // First call should fail (mkdirSync throws on first invocation)
    await expect(ctx.persistAll()).rejects.toThrow('disk failure');

    // Second call should succeed (chain not stuck)
    await expect(ctx.persistAll()).resolves.toBeUndefined();
  });
});
