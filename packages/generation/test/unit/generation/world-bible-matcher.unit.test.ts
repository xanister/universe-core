import { describe, it, expect, vi } from 'vitest';
import {
  ENVIRONMENT_PRESETS,
  type WorldBible,
  type WorldBiblePlaceRef,
  type GeneratedSlot
} from '@dmnpc/types/world';

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn(),
}));

function createWorldBible(places: WorldBiblePlaceRef[]): WorldBible {
  return {
    themes: ['fantasy'],
    characters: [],
    places,
    lore: '',
    rules: [],
    tone: 'epic',
    overview: 'A fantasy world',
    keyConflicts: [],
    atmosphere: 'medieval',
    narrativePresent: '',
    historicalLore: '',
    historicalEvents: [],
  };
}

function createWBPlace(
  name: string,
  parentName: string,
  purpose = 'planet'
): WorldBiblePlaceRef {
  return {
    name,
    description: `Description of ${name}`,
    isSuitableStart: false,
    environment: ENVIRONMENT_PRESETS.exterior(),
    purpose,
    parentName,
  };
}

function createSlot(purpose: string, x = 0, y = 0): GeneratedSlot {
  return {
    purpose,
    x,
    y,
    width: 32,
    height: 32,
    facing: 'south',
    inheritableTags: null,
    isStructural: false,
  };
}

describe('world-bible-matcher', () => {
  describe('getWorldBibleChildrenOf', () => {
    it('returns children matching parent name (case-insensitive)', async () => {
      const { getWorldBibleChildrenOf } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );
      const wb = createWorldBible([
        createWBPlace('Gaardia', 'Western Muraii'),
        createWBPlace('Seura', 'Western Muraii'),
        createWBPlace('High Gaardia', 'Gaardia'),
      ]);

      const children = getWorldBibleChildrenOf(wb, 'Western Muraii');
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.name)).toEqual(['Gaardia', 'Seura']);
    });

    it('returns empty array when no children match', async () => {
      const { getWorldBibleChildrenOf } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );
      const wb = createWorldBible([createWBPlace('Gaardia', 'Western Muraii')]);

      const children = getWorldBibleChildrenOf(wb, 'Nonexistent');
      expect(children).toHaveLength(0);
    });
  });

  describe('getWorldBibleChildrenOfRoot', () => {
    it('returns children with "Cosmos" sentinel AND matching root label', async () => {
      const { getWorldBibleChildrenOfRoot } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );
      const wb = createWorldBible([
        createWBPlace('Anslem', 'Cosmos'),
        createWBPlace('Muraii', 'Anslem'),
      ]);

      const children = getWorldBibleChildrenOfRoot(wb, 'Anslem');
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.name)).toEqual(['Anslem', 'Muraii']);
    });

    it('returns children with "Root" sentinel as parentName', async () => {
      const { getWorldBibleChildrenOfRoot } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );
      const wb = createWorldBible([
        createWBPlace('Continent', 'Root'),
        createWBPlace('Subregion', 'Continent'),
      ]);

      const children = getWorldBibleChildrenOfRoot(wb, 'Planet');
      expect(children).toHaveLength(1);
      expect(children[0].name).toBe('Continent');
    });

    it('also returns children with matching root label', async () => {
      const { getWorldBibleChildrenOfRoot } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );
      const wb = createWorldBible([
        createWBPlace('Muraii', 'Anslem'),
        createWBPlace('Miza', 'Anslem'),
        createWBPlace('Forest', 'Cosmos'),
      ]);

      const children = getWorldBibleChildrenOfRoot(wb, 'Anslem');
      expect(children).toHaveLength(3);
    });
  });

  describe('matchChildrenToSlots', () => {
    it('returns all slots as unmatched when no WB children', async () => {
      const { matchChildrenToSlots } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );

      const result = await matchChildrenToSlots(
        [],
        [createSlot('tavern'), createSlot('forest')],
        'A planet'
      );

      expect(result.matched).toHaveLength(0);
      expect(result.unmatchedChildren).toHaveLength(0);
      expect(result.unmatchedSlots).toEqual([0, 1]);
    });

    it('matches WB children to slots via LLM', async () => {
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');
      vi.mocked(queryLlm).mockResolvedValueOnce({
        content: {
          matches: [
            { childIndex: 0, slotIndex: 1 },
            { childIndex: 1, slotIndex: 0 },
          ],
        },
      } as never);

      const { matchChildrenToSlots } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );

      const wbChildren = [
        createWBPlace('Dark Forest', 'Planet', 'forest'),
        createWBPlace('The Rusty Mug', 'Planet', 'tavern'),
      ];
      const slots = [createSlot('tavern', 10, 10), createSlot('forest', 20, 20)];

      const result = await matchChildrenToSlots(wbChildren, slots, 'A planet');

      expect(result.matched).toHaveLength(2);
      expect(result.matched[0].wbPlace.name).toBe('Dark Forest');
      expect(result.matched[0].slotIndex).toBe(1);
      expect(result.matched[1].wbPlace.name).toBe('The Rusty Mug');
      expect(result.matched[1].slotIndex).toBe(0);
      expect(result.unmatchedChildren).toHaveLength(0);
      expect(result.unmatchedSlots).toHaveLength(0);
    });

    it('deduplicates slot assignments (first match wins)', async () => {
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');
      vi.mocked(queryLlm).mockResolvedValueOnce({
        content: {
          matches: [
            { childIndex: 0, slotIndex: 0 },
            { childIndex: 1, slotIndex: 0 },
          ],
        },
      } as never);

      const { matchChildrenToSlots } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );

      const wbChildren = [
        createWBPlace('Inn A', 'Planet', 'tavern'),
        createWBPlace('Inn B', 'Planet', 'tavern'),
      ];
      const slots = [createSlot('tavern')];

      const result = await matchChildrenToSlots(wbChildren, slots, 'Planet');

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].wbPlace.name).toBe('Inn A');
      expect(result.unmatchedChildren).toHaveLength(1);
      expect(result.unmatchedChildren[0].name).toBe('Inn B');
      expect(result.unmatchedSlots).toHaveLength(0);
    });

    it('ignores out-of-bounds indices from LLM', async () => {
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');
      vi.mocked(queryLlm).mockResolvedValueOnce({
        content: {
          matches: [{ childIndex: 99, slotIndex: 99 }],
        },
      } as never);

      const { matchChildrenToSlots } = await import(
        '@dmnpc/generation/place/world-bible-matcher.js'
      );

      const result = await matchChildrenToSlots(
        [createWBPlace('Forest', 'Planet', 'forest')],
        [createSlot('forest')],
        'Planet'
      );

      expect(result.matched).toHaveLength(0);
      expect(result.unmatchedChildren).toHaveLength(1);
      expect(result.unmatchedSlots).toEqual([0]);
    });
  });
});
