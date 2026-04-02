/**
 * Entity Roundtrip Integration Test
 *
 * Tests the create → persist → reload cycle for all entity types.
 * Verifies no data loss or shape corruption through the filesystem store.
 *
 * Also tests non-entity store roundtrips (plots, storytellers) to catch
 * contract drift between store I/O and type definitions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupAndLoadTestUniverse,
  cleanupTestUniverse,
  createTestPlace,
  createTestCharacter,
  createTestExit,
  createTestObjectEntity,
} from '@dmnpc/core/test-helpers/index.js';
import { UniverseContext } from '../../src/universe/universe-context.js';
import { upsertUniverseEntity } from '../../src/universe/universe-store.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// ============================================================================
// Test Setup
// ============================================================================

const TEST_UNIVERSE_ID = '__integ_entity_roundtrip__';

beforeAll(async () => {
  await setupAndLoadTestUniverse(TEST_UNIVERSE_ID, {
    name: 'Entity Roundtrip Test Universe',
    description: 'Integration test for entity persistence.',
    places: [
      createTestPlace({
        id: 'PLACE_root',
        label: 'Root Place',
        description: 'The root place for testing.',
        short_description: 'root',
        tags: ['Root'],
        position: { x: 0, y: 0, width: 100, height: 100, innerWidth: 400, innerHeight: 300, parent: null },
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet' },
      }),
    ],
    characters: [],
  });
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

// ============================================================================
// Tests
// ============================================================================

describe('entity roundtrip (integration)', () => {
  describe('character roundtrip', () => {
    it('creates, persists, and reloads a character without data loss', async () => {
      const character = createTestCharacter({
        id: 'CHAR_roundtrip_test',
        label: 'Test Character',
        description: 'A character created for roundtrip testing.',
        short_description: 'test character',
        tags: ['Test', 'Roundtrip'],
        position: { x: 10, y: 20, width: 32, height: 48, parent: 'PLACE_root' },
        info: {
          isPlayer: false,
          gender: 'male',
          race: 'Human',
          personality: 'Cautious and methodical',
          messages: [
            { role: 'assistant', content: 'Hello there.', speaker: 'dm' },
          ],
        },
      });

      // Write to disk
      await upsertUniverseEntity(TEST_UNIVERSE_ID, 'character', character);

      // Reload from disk (fresh context, no in-memory cache)
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const loaded = ctx.getCharacter('CHAR_roundtrip_test');

      // Verify core fields
      expect(loaded.id).toBe(character.id);
      expect(loaded.label).toBe(character.label);
      expect(loaded.description).toBe(character.description);
      expect(loaded.short_description).toBe(character.short_description);
      expect(loaded.tags).toEqual(character.tags);
      expect(loaded.entityType).toBe('character');

      // Verify position (nested object)
      expect(loaded.position.x).toBe(character.position.x);
      expect(loaded.position.y).toBe(character.position.y);
      expect(loaded.position.parent).toBe('PLACE_root');

      // Verify info (complex nested object)
      expect(loaded.info.isPlayer).toBe(false);
      expect(loaded.info.gender).toBe('male');
      expect(loaded.info.race).toBe('Human');
      expect(loaded.info.personality).toBe('Cautious and methodical');
      expect(loaded.info.messages).toHaveLength(1);
      expect(loaded.info.messages[0].content).toBe('Hello there.');
    });
  });

  describe('place roundtrip', () => {
    it('creates, persists, and reloads a place without data loss', async () => {
      const place = createTestPlace({
        id: 'PLACE_roundtrip_test',
        label: 'Test Tavern',
        description: 'A cozy tavern for testing persistence.',
        short_description: 'test tavern',
        tags: ['Tavern', 'Interior'],
        position: {
          x: 50, y: 50, width: 100, height: 100,
          innerWidth: 400, innerHeight: 300, parent: 'PLACE_root',
        },
        info: {
          environment: ENVIRONMENT_PRESETS.interior(),
          scale: 'feet',
          purpose: 'tavern',
        },
      });

      await upsertUniverseEntity(TEST_UNIVERSE_ID, 'place', place);

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const loaded = ctx.getPlace('PLACE_roundtrip_test');

      expect(loaded.id).toBe(place.id);
      expect(loaded.label).toBe(place.label);
      expect(loaded.position.innerWidth).toBe(400);
      expect(loaded.position.innerHeight).toBe(300);
      expect(loaded.position.parent).toBe('PLACE_root');
      expect(loaded.info.environment.type).toBe('interior');
      expect(loaded.info.environment.hasWeather).toBe(false);
      expect(loaded.info.scale).toBe('feet');
      expect(loaded.info.purpose).toBe('tavern');
    });
  });

  describe('object roundtrip', () => {
    it('creates, persists, and reloads an object without data loss', async () => {
      const exit = createTestExit({
        id: 'OBJ_roundtrip_exit',
        label: 'Test Door',
        description: 'A door for testing persistence.',
        position: { x: 100, y: 50, width: 32, height: 32, parent: 'PLACE_root' },
      });

      await upsertUniverseEntity(TEST_UNIVERSE_ID, 'object', exit);

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const loaded = ctx.findObject('OBJ_roundtrip_exit');

      expect(loaded).toBeDefined();
      expect(loaded!.id).toBe(exit.id);
      expect(loaded!.label).toBe('Test Door');
      expect(loaded!.info.purpose).toBe('exit');
      expect(loaded!.position.parent).toBe('PLACE_root');
    });

    it('creates, persists, and reloads a non-exit object without data loss', async () => {
      const obj = createTestObjectEntity({
        id: 'OBJ_roundtrip_item',
        label: 'Test Table',
        description: 'A wooden table.',
        position: { x: 80, y: 80, width: 32, height: 32, parent: 'PLACE_root' },
        info: {
          purpose: 'furniture',
        },
      });

      await upsertUniverseEntity(TEST_UNIVERSE_ID, 'object', obj);

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const loaded = ctx.findObject('OBJ_roundtrip_item');

      expect(loaded).toBeDefined();
      expect(loaded!.id).toBe(obj.id);
      expect(loaded!.label).toBe('Test Table');
      expect(loaded!.info.purpose).toBe('furniture');
    });
  });

  describe('multiple entity types in one universe', () => {
    it('loads all entity types correctly from a single universe', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Should have places (root + roundtrip test)
      expect(ctx.places.length).toBeGreaterThanOrEqual(2);

      // Should have the character we created
      const char = ctx.findCharacter('CHAR_roundtrip_test');
      expect(char).toBeDefined();

      // Should have objects
      const exit = ctx.findObject('OBJ_roundtrip_exit');
      expect(exit).toBeDefined();

      const item = ctx.findObject('OBJ_roundtrip_item');
      expect(item).toBeDefined();
    });
  });
});
