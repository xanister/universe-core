import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  setupAndLoadTestUniverse,
  cleanupTestUniverse,
  getTestUniverseDir,
} from '@dmnpc/core/test-helpers/index.js';
import { ensureTags, loadTags } from '@dmnpc/core/entities/tag-manager.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock OpenAI client - queryLlm is used for tag description generation
const { queryLlmMock } = vi.hoisted(() => ({
  queryLlmMock: vi.fn(),
}));
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  createOpenAIClient: vi.fn(() => ({})),
  queryLlm: queryLlmMock,
}));

const TEST_UNIVERSE_ID = '__test_tag_manager__';
const TEST_UNIVERSE_DIR = getTestUniverseDir(TEST_UNIVERSE_ID);

beforeAll(async () => {
  await setupAndLoadTestUniverse(TEST_UNIVERSE_ID, {
    name: 'Test Universe',
    description: 'Test universe for tag manager',
    places: [],
    characters: [],
  });
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

beforeEach(async () => {
  // Clear tags.json before each test
  const tagsPath = join(TEST_UNIVERSE_DIR, 'tags.json');
  if (existsSync(tagsPath)) {
    await writeFile(tagsPath, JSON.stringify({ tags: [] }, null, 2) + '\n', 'utf-8');
  }
  // Clear mocks
  vi.clearAllMocks();
});

describe('services/tag-manager.ts', () => {
  describe('ensureTags', () => {
    it('creates new tags in tags.json and returns tag IDs', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const tags = ['tavern', 'city', 'inn'];
      const result = await ensureTags(tags, ctx);

      // Returns tag IDs, not labels
      expect(result).toEqual(['TAG_tavern', 'TAG_city', 'TAG_inn']);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(3);
      expect(loadedTags.map((t) => t.label)).toEqual(['tavern', 'city', 'inn']);
      expect(loadedTags[0].tagId).toBe('TAG_tavern');
      expect(loadedTags[1].tagId).toBe('TAG_city');
      expect(loadedTags[2].tagId).toBe('TAG_inn');
    });

    it('does not create duplicate tags', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      // Create tags first time
      await ensureTags(['tavern', 'city'], ctx);

      // Try to create same tags again - returns existing tag IDs
      const result = await ensureTags(['tavern', 'city'], ctx);

      expect(result).toEqual(['TAG_tavern', 'TAG_city']);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(2);
      expect(loadedTags.map((t) => t.label)).toEqual(['tavern', 'city']);
    });

    it('only adds new tags, keeps existing ones', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      // Create initial tags
      await ensureTags(['tavern', 'city'], ctx);

      // Add more tags - returns tag IDs for all
      const result = await ensureTags(['tavern', 'city', 'inn', 'market'], ctx);

      expect(result).toEqual(['TAG_tavern', 'TAG_city', 'TAG_inn', 'TAG_market']);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(4);
      expect(loadedTags.map((t) => t.label)).toEqual(['tavern', 'city', 'inn', 'market']);
    });

    it('rejects proper nouns (tags starting with uppercase)', async () => {
      // Tags starting with uppercase that differ when lowercased are proper nouns
      const tags = ['Tavern', 'City Center', 'The Inn'];
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const result = await ensureTags(tags, ctx);

      // All rejected as proper nouns
      expect(result).toEqual([]);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(0);
    });

    it('handles empty tag arrays', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const result = await ensureTags([], ctx);
      expect(result).toEqual([]);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(0);
    });

    it('filters out empty tags', async () => {
      const tags = ['tavern', '', '  ', 'city'];
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const result = await ensureTags(tags, ctx);

      // Empty tags are filtered out when creating tag definitions
      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(2);
      expect(loadedTags.map((t) => t.label)).toEqual(['tavern', 'city']);
    });

    it('trims and normalizes tag labels, returns tag IDs', async () => {
      const tags = ['  tavern  ', '  city  '];
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const result = await ensureTags(tags, ctx);

      // Returns tag IDs
      expect(result).toEqual(['TAG_tavern', 'TAG_city']);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags.map((t) => t.label)).toEqual(['tavern', 'city']);
    });

    it('normalizes tags with special characters and deduplicates', async () => {
      // All three normalize to 'tavern', so only one is created
      const tags = ['tavern', 'tavern!', 'tavern@'];
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const result = await ensureTags(tags, ctx);

      // All normalize to 'tavern', returns same tag ID each time
      expect(result).toEqual(['TAG_tavern', 'TAG_tavern', 'TAG_tavern']);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      // Only one unique tag is created
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].tagId).toBe('TAG_tavern');
    });

    it('handles hyphenated vs spaced tags as same label', async () => {
      // test-tag and test tag both normalize to 'test-tag'
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['test-tag'], ctx);
      await ensureTags(['test tag'], ctx);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      // Both normalize to the same label, so only one tag is created
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].label).toBe('test-tag');
      expect(loadedTags[0].tagId).toBe('TAG_test_tag');
    });

    it('creates tags.json file if it does not exist', async () => {
      const tagsPath = join(TEST_UNIVERSE_DIR, 'tags.json');
      if (existsSync(tagsPath)) {
        await writeFile(tagsPath, JSON.stringify({ tags: [] }, null, 2) + '\n', 'utf-8');
      }

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['newtag'], ctx);

      expect(existsSync(tagsPath)).toBe(true);
      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(1);
    });
  });

  describe('loadTags', () => {
    it('returns empty array when tags.json does not exist', async () => {
      const tagsPath = join(TEST_UNIVERSE_DIR, 'tags.json');
      if (existsSync(tagsPath)) {
        // Remove file to test loading when it doesn't exist
        const { unlink } = await import('fs/promises');
        await unlink(tagsPath);
      }

      const tags = await loadTags(TEST_UNIVERSE_ID);
      expect(tags).toEqual([]);
    });

    it('returns empty array and logs error when tags.json has invalid JSON', async () => {
      const { logger } = await import('@dmnpc/core/infra/logger.js');
      const tagsPath = join(TEST_UNIVERSE_DIR, 'tags.json');
      await mkdir(TEST_UNIVERSE_DIR, { recursive: true });
      await writeFile(tagsPath, 'invalid json', 'utf-8');

      const tags = await loadTags(TEST_UNIVERSE_ID);

      expect(tags).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'TagManager',
        expect.stringContaining('Failed to load tags'),
        expect.objectContaining({ universeId: TEST_UNIVERSE_ID })
      );
    });

    it('returns tags from existing tags.json', async () => {
      const tagsPath = join(TEST_UNIVERSE_DIR, 'tags.json');
      await mkdir(TEST_UNIVERSE_DIR, { recursive: true });
      await writeFile(
        tagsPath,
        JSON.stringify(
          {
            tags: [
              { tagId: '1', label: 'existing' },
              { tagId: '2', label: 'tags' },
            ],
          },
          null,
          2
        ) + '\n',
        'utf-8'
      );

      const tags = await loadTags(TEST_UNIVERSE_ID);
      expect(tags).toHaveLength(2);
      expect(tags[0].label).toBe('existing');
      expect(tags[1].label).toBe('tags');
    });
  });

  describe('tag descriptions', () => {
    it('generates descriptions for new tags using OpenAI', async () => {
      // Mock queryLlm response
      queryLlmMock.mockResolvedValueOnce({
        content: 'A cozy establishment where travelers gather for food and drink.',
        truncated: false,
        durationMs: 100,
      });

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['tavern'], ctx);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].description).toBe(
        'A cozy establishment where travelers gather for food and drink.'
      );
      expect(loadedTags[0].description).not.toContain('A tag for');

      // Verify queryLlm was called
      expect(queryLlmMock).toHaveBeenCalledTimes(1);
      const call = queryLlmMock.mock.calls[0][0];
      expect(call.system).toContain('Do NOT include phrases like "A tag for"');
      expect(call.prompt).toContain('tavern');
    });

    it('uses fallback description when OpenAI fails', async () => {
      // Mock queryLlm to fail
      queryLlmMock.mockRejectedValueOnce(new Error('OpenAI error'));

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['market'], ctx);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].description).toBe('Market.');
      expect(loadedTags[0].description).not.toContain('A tag for');
    });

    it('uses fallback description when OpenAI returns empty response', async () => {
      // Mock queryLlm to return empty response
      queryLlmMock.mockResolvedValueOnce({
        content: '',
        truncated: false,
        durationMs: 100,
      });

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['inn'], ctx);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].description).toBe('Inn.');
    });

    it('removes quotes and markdown from generated descriptions', async () => {
      // Mock queryLlm response with quotes and markdown
      queryLlmMock.mockResolvedValueOnce({
        content: '"**A bustling marketplace**"',
        truncated: false,
        durationMs: 100,
      });

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['bazaar'], ctx);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].description).toBe('A bustling marketplace');
      expect(loadedTags[0].description).not.toContain('"');
      expect(loadedTags[0].description).not.toContain('**');
    });

    it('generates descriptions for multiple new tags', async () => {
      queryLlmMock
        .mockResolvedValueOnce({
          content: 'A place where goods are bought and sold.',
          truncated: false,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          content: 'A fortified structure for defense.',
          truncated: false,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          content: 'A coastal settlement by the sea.',
          truncated: false,
          durationMs: 100,
        });

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['market', 'fortress', 'port'], ctx);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(3);
      expect(loadedTags[0].description).toBe('A place where goods are bought and sold.');
      expect(loadedTags[1].description).toBe('A fortified structure for defense.');
      expect(loadedTags[2].description).toBe('A coastal settlement by the sea.');
      expect(queryLlmMock).toHaveBeenCalledTimes(3);
    });

    it('does not generate descriptions for existing tags', async () => {
      // First creation - generates description
      queryLlmMock.mockResolvedValueOnce({
        content: 'An ancient structure.',
        truncated: false,
        durationMs: 100,
      });

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['ruin'], ctx);

      // Second call - should not generate description again
      queryLlmMock.mockClear();
      await ensureTags(['ruin'], ctx);

      // queryLlm should not be called again for existing tag
      expect(queryLlmMock).not.toHaveBeenCalled();

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].description).toBe('An ancient structure.');
    });

    it('handles tags with hyphens in fallback description', async () => {
      queryLlmMock.mockRejectedValueOnce(new Error('OpenAI error'));

      // Use a hyphenated tag that's not in the synonyms list
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['fire-mage'], ctx);

      const loadedTags = await loadTags(TEST_UNIVERSE_ID);
      expect(loadedTags).toHaveLength(1);
      expect(loadedTags[0].description).toBe('Fire mage.');
    });

    it('includes universe context in OpenAI prompt', async () => {
      queryLlmMock.mockResolvedValueOnce({
        content: 'A magical tavern.',
        truncated: false,
        durationMs: 100,
      });

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await ensureTags(['tavern'], ctx);

      const call = queryLlmMock.mock.calls[0][0];
      expect(call.prompt).toContain('Test Universe');
      expect(call.prompt).toContain('tavern');
    });
  });
});
