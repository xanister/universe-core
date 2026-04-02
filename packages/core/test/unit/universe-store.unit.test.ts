import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestUniverse, cleanupTestUniverse } from '@dmnpc/core/test-helpers/index.js';
import { generateEventId, loadUniverse } from '@dmnpc/core/universe/universe-store.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

const TEST_UNIVERSE_ID = '__test_universe_store__';

beforeAll(async () => {
  await setupTestUniverse(TEST_UNIVERSE_ID, {
    name: 'Test Universe',
    description: 'Test universe for universe-store',
    places: [
      {
        id: 'PLACE_main',
        label: 'Main Square',
        description: 'A bustling town square.',
        short_description: 'bustling town square',
        entityType: 'place',
        tags: ['Public'],
        info: { environment: ENVIRONMENT_PRESETS.exterior() },
        relationships: [],
      } as any,
      {
        id: 'PLACE_tavern',
        label: 'The Tavern',
        description: 'A cozy tavern.',
        short_description: 'cozy tavern',
        entityType: 'place',
        tags: ['Tavern'],
        info: { environment: ENVIRONMENT_PRESETS.interior() },
        relationships: [],
      } as any,
      {
        id: 'PLACE_shop',
        label: 'General Store',
        description: 'A general store.',
        short_description: 'general store',
        entityType: 'place',
        tags: ['Shop'],
        info: { environment: ENVIRONMENT_PRESETS.interior() },
        relationships: [],
      } as any,
      {
        id: 'PLACE_other',
        label: 'Other Place',
        description: 'A different place.',
        short_description: 'different place',
        entityType: 'place',
        tags: ['Location'],
        info: { environment: ENVIRONMENT_PRESETS.exterior() },
        relationships: [],
      } as any,
    ],
    characters: [
      {
        id: 'CHAR_player',
        label: 'Player',
        description: 'The player character',
        short_description: 'player character',
        entityType: 'character',
        tags: ['Player'],
        info: { placeId: 'PLACE_main' },
        relationships: [],
      } as any,
      {
        id: 'CHAR_npc1',
        label: 'NPC 1',
        description: 'First NPC',
        short_description: 'first NPC',
        entityType: 'character',
        tags: ['NPC'],
        info: { placeId: 'PLACE_main' },
        relationships: [],
      } as any,
      {
        id: 'CHAR_npc2',
        label: 'NPC 2',
        description: 'Second NPC',
        short_description: 'second NPC',
        entityType: 'character',
        tags: ['NPC'],
        info: { placeId: 'PLACE_main' },
        relationships: [],
      } as any,
      {
        id: 'CHAR_elsewhere',
        label: 'Elsewhere NPC',
        description: 'NPC at different location',
        short_description: 'elsewhere NPC',
        entityType: 'character',
        tags: ['NPC'],
        info: { placeId: 'PLACE_other' },
        relationships: [],
      } as any,
    ],
    objects: [
      {
        id: 'OBJ_exit_main_tavern',
        label: 'The Tavern',
        description: 'Door to the tavern',
        short_description: 'door to tavern',
        entityType: 'object',
        tags: [],
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'door', targetPlaceId: 'PLACE_tavern' } },
        position: { x: null, y: null, parent: 'PLACE_main' },
        relationships: [],
      } as any,
      {
        id: 'OBJ_exit_main_shop',
        label: 'General Store',
        description: 'Door to the shop',
        short_description: 'door to shop',
        entityType: 'object',
        tags: [],
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'door', targetPlaceId: 'PLACE_shop' } },
        position: { x: null, y: null, parent: 'PLACE_main' },
        relationships: [],
      } as any,
      {
        id: 'OBJ_exit_tavern_main',
        label: 'Main Square',
        description: 'Door back to main square',
        short_description: 'door to square',
        entityType: 'object',
        tags: [],
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'door', targetPlaceId: 'PLACE_main' } },
        position: { x: null, y: null, parent: 'PLACE_tavern' },
        relationships: [],
      } as any,
      {
        id: 'OBJ_exit_shop_main',
        label: 'Main Square',
        description: 'Door back to main square',
        short_description: 'door to square',
        entityType: 'object',
        tags: [],
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'door', targetPlaceId: 'PLACE_main' } },
        position: { x: null, y: null, parent: 'PLACE_shop' },
        relationships: [],
      } as any,
    ],
  });
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

beforeEach(async () => {
  await loadUniverse(TEST_UNIVERSE_ID);
});

describe('services/universe-store.ts', () => {
  describe('generateEventId', () => {
    it('truncates long slugs to keep event IDs short', () => {
      const timestamp = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(timestamp);

      const longFact = 'a'.repeat(200);
      const id = generateEventId(longFact);

      expect(id).toMatch(/^EVENT_/);
      expect(id.endsWith(`_${timestamp}`)).toBe(true);

      const slug = id.slice('EVENT_'.length, id.length - `_${timestamp}`.length);
      expect(slug.length).toBeLessThanOrEqual(80);
    });

    it('falls back to a default slug when no words remain', () => {
      const timestamp = 1700000000001;
      vi.spyOn(Date, 'now').mockReturnValue(timestamp);

      const id = generateEventId('!!!');
      expect(id).toBe(`EVENT_event_${timestamp}`);
    });
  });

});

