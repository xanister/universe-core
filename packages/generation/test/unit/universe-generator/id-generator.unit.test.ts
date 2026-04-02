import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupAndLoadTestUniverse, cleanupTestUniverse } from '@dmnpc/core/test-helpers/index.js';
import { generateEntityId } from '@dmnpc/generation/id-generator.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

const TEST_UNIVERSE_ID = '__test_id_generator__';

let ctx: UniverseContext;

beforeAll(async () => {
  ctx = await setupAndLoadTestUniverse(TEST_UNIVERSE_ID, {
    name: 'Test Universe',
    description: 'Test universe for ID generator',
    places: [
      {
        id: 'PLACE_test_place',
        label: 'Test Place',
        description: 'A test place',
        entityType: 'place',
        tags: [],
        info: {},
        relationships: [],
      } as any,
    ],
    characters: [
      {
        id: 'CHAR_test_character',
        label: 'Test Character',
        description: 'A test character',
        entityType: 'character',
        tags: [],
        info: {},
        relationships: [],
      } as any,
    ],
  });
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('services/universe-generator/id-generator.ts', () => {
  describe('generateEntityId', () => {
    it('generates character ID from label', async () => {
      const id = await generateEntityId(ctx, 'John Smith', 'character');
      expect(id).toBe('CHAR_john_smith');
      expect(id.startsWith('CHAR_')).toBe(true);
    });

    it('generates place ID from label', async () => {
      const id = await generateEntityId(ctx, 'The Crossed Cask', 'place');
      expect(id).toBe('PLACE_the_crossed_cask');
      expect(id.startsWith('PLACE_')).toBe(true);
    });

    it('handles labels with special characters', async () => {
      const id = await generateEntityId(ctx, 'Tavern "The Dragon"', 'place');
      expect(id).toBe('PLACE_tavern_the_dragon');
      expect(id).not.toContain('"');
      expect(id).not.toContain(' ');
    });

    it('handles labels with multiple spaces', async () => {
      const id = await generateEntityId(ctx, 'John   Smith', 'character');
      expect(id).toBe('CHAR_john_smith');
      expect(id).not.toContain('  ');
    });

    it('handles labels with leading/trailing spaces', async () => {
      const id = await generateEntityId(ctx, '  New Place  ', 'place');
      expect(id).toBe('PLACE_new_place');
    });

    it('generates unique IDs when duplicates exist', async () => {
      // Add a character with a known ID to disk (so it persists through refresh)
      await ctx.upsertEntity('character', {
        id: 'CHAR_john_smith',
        label: 'Existing John Smith',
        description: 'Existing',
        entityType: 'character',
        tags: [],
        info: {} as any,
        relationships: [],
      } as any);
      await ctx.persistAll();

      // Try to generate ID for same label
      const id = await generateEntityId(ctx, 'John Smith', 'character');
      expect(id).toBe('CHAR_john_smith_1');
    });

    it('increments counter for multiple duplicates', async () => {
      // Add characters with known IDs to disk (so they persist through refresh)
      await ctx.upsertEntity('character', {
        id: 'CHAR_duplicate',
        label: 'Duplicate',
        description: 'Existing 1',
        entityType: 'character',
        tags: [],
        info: {} as any,
        relationships: [],
      } as any);
      await ctx.upsertEntity('character', {
        id: 'CHAR_duplicate_1',
        label: 'Duplicate',
        description: 'Existing 2',
        entityType: 'character',
        tags: [],
        info: {} as any,
        relationships: [],
      } as any);
      await ctx.persistAll();

      const id = await generateEntityId(ctx, 'Duplicate', 'character');
      expect(id).toBe('CHAR_duplicate_2');
    });

    it('truncates long labels to stay within max length', async () => {
      const longLabel = 'A'.repeat(100);
      const id = await generateEntityId(ctx, longLabel, 'character');
      expect(id.length).toBeLessThanOrEqual(60);
      expect(id.startsWith('CHAR_')).toBe(true);
    });

    it('preserves word boundaries when truncating', async () => {
      const label = 'This Is A Very Long Place Name That Should Be Truncated';
      const id = await generateEntityId(ctx, label, 'place');
      expect(id.length).toBeLessThanOrEqual(60);
      expect(id.startsWith('PLACE_')).toBe(true);
      // Should end at a word boundary (underscore)
      const withoutPrefix = id.replace('PLACE_', '');
      expect(withoutPrefix).not.toContain('truncated'); // Should be cut off at a word
    });

    it('handles empty label by using fallback', async () => {
      const id = await generateEntityId(ctx, '', 'character');
      expect(id).toBe('CHAR_entity');
    });

    it('handles label with only special characters', async () => {
      const id = await generateEntityId(ctx, '!!!@@@###', 'place');
      expect(id).toBe('PLACE_entity');
    });

    it('handles case differences correctly', async () => {
      const id1 = await generateEntityId(ctx, 'My Place', 'place');
      const id2 = await generateEntityId(ctx, 'my place', 'place');
      expect(id1).toBe('PLACE_my_place');
      expect(id2).toBe('PLACE_my_place');
    });
  });
});
