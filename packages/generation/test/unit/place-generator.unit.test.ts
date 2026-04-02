/**
 * Unit tests for place-generator.ts
 *
 * Tests the findSimilarPlace function for duplicate detection.
 * Tests findCandidatesWithWordOverlap for identifying places needing LLM similarity checks.
 * Tests checkPlaceSimilarityWithLlm for semantic similarity detection (mocked).
 * Tests hasVesselTags and initializeVesselIfNeeded for vessel detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findSimilarPlace,
  findCandidatesWithWordOverlap,
  checkPlaceSimilarityWithLlm,
  hasVesselTags,
  initializeVesselIfNeeded,
} from '@dmnpc/generation/place-generator.js';
import { createMockUniverseContext, createTestPlace, createTestObjectEntity } from '@dmnpc/core/test-helpers/index.js';
import type { Place } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// Mock the LLM client for checkPlaceSimilarityWithLlm tests
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn(),
}));

// Import the mocked module at top level (vitest hoists the mock)
import * as openaiClientModule from '@dmnpc/core/clients/openai-client.js';
const queryLlmMock = vi.mocked(openaiClientModule.queryLlm);

describe('findSimilarPlace', () => {
  // Create test places
  const testPlaces: Place[] = [
    {
      id: 'PLACE_farsreach_gates',
      label: 'Farsreach Gates',
      description: 'The great iron-bound gates of Farsreach.',
      short_description: 'iron city gates',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'outdoors',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      relationships: [],
      aliases: ['Iron-bound gates', 'the iron-bound gates', 'the gates'],
      position: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        parent: null,
      },
    },
    {
      id: 'PLACE_saltfog_harbor_ward',
      label: 'Saltfog Harbor Ward',
      description: 'A foggy harbor district.',
      short_description: 'foggy harbor district',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'district',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'miles',
        size: { width: 2, height: 2 },
      },
      relationships: [],
      aliases: ['the harbor', 'harbor ward', 'the docks'],
      position: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        parent: null,
      },
    },
    {
      id: 'PLACE_rusty_anchor',
      label: 'The Rusty Anchor',
      description: 'A tavern near the docks.',
      short_description: 'dockside tavern',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'building',
        environment: ENVIRONMENT_PRESETS.interior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      relationships: [],
      aliases: ['Rusty Anchor Tavern'],
      position: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        parent: null,
      },
    },
  ];

  function createCtx() {
    return createMockUniverseContext({
      universeId: 'test_universe',
      places: testPlaces,
    });
  }

  describe('label matching', () => {
    it('finds place by exact label match', () => {
      const ctx = createCtx();
      const match = findSimilarPlace(ctx, 'Farsreach Gates');

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_farsreach_gates');
      expect(match!.matchType).toBe('label');
      expect(match!.matchedValue).toBe('Farsreach Gates');
    });

    it('finds place by label match (case-insensitive)', () => {
      const ctx = createCtx();

      const match1 = findSimilarPlace(ctx, 'farsreach gates');
      expect(match1).not.toBeNull();
      expect(match1!.place.id).toBe('PLACE_farsreach_gates');
      expect(match1!.matchType).toBe('label');

      const match2 = findSimilarPlace(ctx, 'FARSREACH GATES');
      expect(match2).not.toBeNull();
      expect(match2!.place.id).toBe('PLACE_farsreach_gates');
    });

    it('finds place by label match (trimmed)', () => {
      const ctx = createCtx();
      const match = findSimilarPlace(ctx, '  Farsreach Gates  ');

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_farsreach_gates');
    });
  });

  describe('alias matching', () => {
    it('finds place by alias match', () => {
      const ctx = createCtx();
      const match = findSimilarPlace(ctx, 'Iron-bound gates');

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_farsreach_gates');
      expect(match!.matchType).toBe('alias');
      expect(match!.matchedValue).toBe('Iron-bound gates');
    });

    it('finds place by alias match (case-insensitive)', () => {
      const ctx = createCtx();

      const match1 = findSimilarPlace(ctx, 'THE IRON-BOUND GATES');
      expect(match1).not.toBeNull();
      expect(match1!.place.id).toBe('PLACE_farsreach_gates');
      expect(match1!.matchType).toBe('alias');

      const match2 = findSimilarPlace(ctx, 'the harbor');
      expect(match2).not.toBeNull();
      expect(match2!.place.id).toBe('PLACE_saltfog_harbor_ward');
      expect(match2!.matchType).toBe('alias');
    });

    it('matches "the docks" to harbor via alias', () => {
      const ctx = createCtx();
      const match = findSimilarPlace(ctx, 'the docks');

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_saltfog_harbor_ward');
      expect(match!.matchType).toBe('alias');
    });
  });

  describe('canonical hint matching', () => {
    it('matches by canonical hint when place is nearby', () => {
      const ctx = createCtx();
      const nearbyPlaceIds = new Set(['PLACE_farsreach_gates', 'PLACE_saltfog_harbor_ward']);

      // "the city gate" has canonical hint "gate" which should match "Farsreach Gates"
      const match = findSimilarPlace(ctx, 'the city gate', nearbyPlaceIds);

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_farsreach_gates');
      expect(match!.matchType).toBe('canonicalHint');
      expect(match!.matchedValue).toBe('gate');
    });

    it('matches by canonical hint "harbor" to harbor ward', () => {
      const ctx = createCtx();
      const nearbyPlaceIds = new Set(['PLACE_saltfog_harbor_ward']);

      const match = findSimilarPlace(ctx, 'the port', nearbyPlaceIds);

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_saltfog_harbor_ward');
      expect(match!.matchType).toBe('canonicalHint');
      expect(match!.matchedValue).toBe('harbor');
    });

    it('matches by canonical hint "tavern" to tavern', () => {
      const ctx = createCtx();
      const nearbyPlaceIds = new Set(['PLACE_rusty_anchor']);

      const match = findSimilarPlace(ctx, 'the inn', nearbyPlaceIds);

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_rusty_anchor');
      expect(match!.matchType).toBe('canonicalHint');
      expect(match!.matchedValue).toBe('tavern');
    });

    it('does not match by canonical hint when place is not nearby', () => {
      const ctx = createCtx();
      // Only include harbor, not gates
      const nearbyPlaceIds = new Set(['PLACE_saltfog_harbor_ward']);

      // "the city gate" should NOT match gates since they're not nearby
      const match = findSimilarPlace(ctx, 'the city gate', nearbyPlaceIds);

      // Should be null or not a canonicalHint match to gates
      if (match) {
        // It might match something else, but not via canonicalHint to gates
        if (match.place.id === 'PLACE_farsreach_gates') {
          expect(match.matchType).not.toBe('canonicalHint');
        }
      }
    });

    it('does not match by canonical hint when no nearby places provided', () => {
      const ctx = createCtx();

      // Without nearby places, canonical hint matching should not trigger
      const match = findSimilarPlace(ctx, 'the city gate');

      // Might still match via alias/label, but not via canonicalHint
      if (match && match.place.id === 'PLACE_farsreach_gates') {
        expect(match.matchType).not.toBe('canonicalHint');
      }
    });
  });

  describe('no match scenarios', () => {
    it('returns null for genuinely new places', () => {
      const ctx = createCtx();

      expect(findSimilarPlace(ctx, 'Temple of the Silver Moon')).toBeNull();
      expect(findSimilarPlace(ctx, "Blacksmith's Forge")).toBeNull();
      expect(findSimilarPlace(ctx, 'The Golden Goose Inn')).toBeNull();
    });

    it('returns null for single-word partial matches', () => {
      const ctx = createCtx();

      // "Farsreach" alone should not match "Farsreach Gates" (only 1 word)
      expect(findSimilarPlace(ctx, 'Farsreach')).toBeNull();

      // "Gates" alone should not match (only 1 word)
      expect(findSimilarPlace(ctx, 'Gates')).toBeNull();
    });
  });

  describe('priority: label > alias > canonicalHint', () => {
    it('prefers label match over alias match', () => {
      const ctx = createCtx();

      // Add a place where one has "Harbor" as alias and another as label
      const placesWithOverlap: Place[] = [
        {
          id: 'PLACE_harbor_district',
          label: 'Harbor District',
          description: 'The main harbor.',
          short_description: 'harbor',
          entityType: 'place',
          tags: [],
          info: {
            purpose: 'outdoors',
            environment: ENVIRONMENT_PRESETS.exterior(),
            scale: 'feet',
            size: { width: 100, height: 100 },
          },
          relationships: [],
          aliases: [],
        },
        {
          id: 'PLACE_market',
          label: 'Market Square',
          description: 'A market.',
          short_description: 'market',
          entityType: 'place',
          tags: [],
          info: {
            purpose: 'outdoors',
            environment: ENVIRONMENT_PRESETS.exterior(),
            scale: 'feet',
            size: { width: 100, height: 100 },
          },
          relationships: [],
          aliases: ['Harbor District'], // Same as other's label
        },
      ];

      const ctxOverlap = createMockUniverseContext({
        universeId: 'test_overlap',
        places: placesWithOverlap,
      });

      const match = findSimilarPlace(ctxOverlap, 'Harbor District');

      // Should match via label to PLACE_harbor_district, not via alias to PLACE_market
      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_harbor_district');
      expect(match!.matchType).toBe('label');
    });
  });

  describe('duplicate scenario prevention', () => {
    it('prevents Farsreach Gates duplicate via alias', () => {
      const ctx = createCtx();

      // The original bug: "Farsreach's iron-bound gates" was generated as a new place
      // when "Farsreach Gates" with alias "the iron-bound gates" existed
      const match = findSimilarPlace(ctx, 'the iron-bound gates');

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_farsreach_gates');
    });

    it('prevents Watch Office duplicate via canonical hint', () => {
      // Create context with watch office
      const watchPlaces: Place[] = [
        {
          id: 'PLACE_saltfog_watch_office',
          label: 'Saltfog Harbor Watch Office',
          description: 'The cramped watch office.',
          short_description: 'watch office',
          entityType: 'place',
          tags: [],
          info: {
            purpose: 'room',
            environment: ENVIRONMENT_PRESETS.interior(),
            scale: 'feet',
            size: { width: 100, height: 100 },
          },
          relationships: [],
          aliases: ['the watch office'],
        },
        {
          id: 'PLACE_gate_road',
          label: 'The Gate Road',
          description: 'A road near the gates.',
          short_description: 'road',
          entityType: 'place',
          tags: [],
          info: {
            purpose: 'outdoors',
            environment: ENVIRONMENT_PRESETS.exterior(),
            scale: 'feet',
            size: { width: 100, height: 100 },
          },
          relationships: [],
          aliases: [],
        },
      ];

      const ctx = createMockUniverseContext({
        universeId: 'test_watch',
        places: watchPlaces,
      });

      // "Harbor Ward Watch Office" should match via alias "the watch office"
      // or via alias similarity if we add it
      const match = findSimilarPlace(ctx, 'the watch office');

      expect(match).not.toBeNull();
      expect(match!.place.id).toBe('PLACE_saltfog_watch_office');
    });
  });
});

describe('findCandidatesWithWordOverlap', () => {
  const testPlaces: Place[] = [
    {
      id: 'PLACE_fogfen_cross',
      label: 'Fogfen Cross',
      description: 'A crossroads hamlet.',
      short_description: 'crossroads hamlet',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'outdoors',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      relationships: [],
    },
    {
      id: 'PLACE_seacouver_warehouse_twelve',
      label: 'Seacouver Old City District — Warehouse Twelve',
      description: 'A warehouse in Seacouver.',
      short_description: 'warehouse',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'room',
        environment: ENVIRONMENT_PRESETS.interior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      relationships: [],
    },
    {
      id: 'PLACE_saltfog_harbor_ward',
      label: 'Saltfog Harbor Ward',
      description: 'A foggy harbor district.',
      short_description: 'foggy harbor',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'outdoors',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      relationships: [],
    },
  ];

  function createCtx() {
    return createMockUniverseContext({
      universeId: 'test_candidates',
      places: testPlaces,
    });
  }

  it('finds candidates with 2+ shared words', () => {
    const ctx = createCtx();

    // "Fogfen Cross library" shares 2 words with "Fogfen Cross"
    const candidates = findCandidatesWithWordOverlap(ctx, 'Fogfen Cross library');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('PLACE_fogfen_cross');
  });

  it('finds candidates when label contains existing place name', () => {
    const ctx = createCtx();

    // "Warehouse Twelve" shares 2 words with "Seacouver Old City District — Warehouse Twelve"
    const candidates = findCandidatesWithWordOverlap(ctx, 'Warehouse Twelve');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('PLACE_seacouver_warehouse_twelve');
  });

  it('returns empty for labels with only 1 shared word', () => {
    const ctx = createCtx();

    // "Harbor" only shares 1 word - not enough for a candidate
    const candidates = findCandidatesWithWordOverlap(ctx, 'Harbor');
    expect(candidates).toHaveLength(0);
  });

  it('returns empty for labels with single word', () => {
    const ctx = createCtx();

    // Single word labels don't qualify for overlap checking
    const candidates = findCandidatesWithWordOverlap(ctx, 'Library');
    expect(candidates).toHaveLength(0);
  });

  it('ignores short words (2 chars or less) when matching', () => {
    const ctx = createCtx();

    // "of" and "to" are too short to count as matching words
    const candidates = findCandidatesWithWordOverlap(ctx, 'Hall of Fogfen');
    // Should still match "Fogfen Cross" since "fogfen" is a significant word
    // But "Hall of" doesn't contribute meaningful overlap
    // Need at least 2 significant words
    expect(candidates).toHaveLength(0); // "fogfen" alone isn't enough
  });

    it('returns multiple candidates when multiple places have overlap', () => {
    const places: Place[] = [
      {
        id: 'PLACE_harbor_market',
        label: 'Harbor Market Square',
        description: 'A market in the harbor.',
        short_description: 'market',
        entityType: 'place',
        tags: [],
        info: {
          purpose: 'outdoors',
          environment: ENVIRONMENT_PRESETS.exterior(),
          scale: 'feet',
          size: { width: 100, height: 100 },
        },
        relationships: [],
        position: {
          x: 0,
          y: 0,
          width: 400,
          height: 400,
          parent: null,
        },
      },
      {
        id: 'PLACE_harbor_tavern',
        label: 'Harbor Tavern Row',
        description: 'Taverns near the harbor.',
        short_description: 'taverns',
        entityType: 'place',
        tags: [],
        info: {
          purpose: 'outdoors',
          environment: ENVIRONMENT_PRESETS.exterior(),
          scale: 'feet',
          size: { width: 100, height: 100 },
        },
        relationships: [],
        position: {
          x: 0,
          y: 0,
          width: 400,
          height: 400,
          parent: null,
        },
      },
    ];

    const ctx = createMockUniverseContext({
      universeId: 'test_multiple',
      places,
    });

    // "Harbor Market" shares 2 words with "Harbor Market Square"
    const candidates = findCandidatesWithWordOverlap(ctx, 'Harbor Market');
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.some((c) => c.id === 'PLACE_harbor_market')).toBe(true);
  });
});

describe('checkPlaceSimilarityWithLlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testPlaces: Place[] = [
    {
      id: 'PLACE_fogfen_cross',
      label: 'Fogfen Cross',
      description: 'A crossroads hamlet in the marshes.',
      short_description: 'crossroads hamlet',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'outdoors',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      relationships: [],
      position: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        parent: null,
      },
    },
    {
      id: 'PLACE_seacouver_warehouse',
      label: 'Seacouver Old City District — Warehouse Twelve',
      description: 'A large warehouse in the old city district.',
      short_description: 'warehouse',
      entityType: 'place',
      tags: [],
      info: {
        purpose: 'room',
        environment: ENVIRONMENT_PRESETS.interior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      relationships: [],
      position: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        parent: null,
      },
    },
  ];

  it('returns existing place when LLM determines they are the same', async () => {
    queryLlmMock.mockResolvedValueOnce({
      content: { result: 'same', confidence: 0.95 },
    } as any);

    const result = await checkPlaceSimilarityWithLlm('Warehouse Twelve', 'A warehouse.', [
      testPlaces[1],
    ]);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('PLACE_seacouver_warehouse');
    expect(queryLlmMock).toHaveBeenCalledOnce();
  });

  it('returns null when LLM determines they are different', async () => {
    queryLlmMock.mockResolvedValueOnce({
      content: { result: 'different', confidence: 0.9 },
    } as any);

    const result = await checkPlaceSimilarityWithLlm(
      'Fogfen Cross library',
      'A library in Fogfen Cross.',
      [testPlaces[0]]
    );

    expect(result).toBeNull();
    expect(queryLlmMock).toHaveBeenCalledOnce();
  });

  it('returns null when no candidates provided', async () => {
    const result = await checkPlaceSimilarityWithLlm('Some Place', 'Some description.', []);

    expect(result).toBeNull();
    expect(queryLlmMock).not.toHaveBeenCalled();
  });

  it('checks multiple candidates until finding a match', async () => {
    queryLlmMock
      .mockResolvedValueOnce({ content: { result: 'different', confidence: 0.85 } } as any)
      .mockResolvedValueOnce({ content: { result: 'same', confidence: 0.9 } } as any);

    const result = await checkPlaceSimilarityWithLlm('Warehouse Twelve', 'A warehouse.', [
      testPlaces[0],
      testPlaces[1],
    ]);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('PLACE_seacouver_warehouse');
    expect(queryLlmMock).toHaveBeenCalledTimes(2);
  });

  it('returns null if all candidates are different', async () => {
    queryLlmMock
      .mockResolvedValueOnce({ content: { result: 'different', confidence: 0.88 } } as any)
      .mockResolvedValueOnce({ content: { result: 'different', confidence: 0.92 } } as any);

    const result = await checkPlaceSimilarityWithLlm(
      'New Unique Place',
      'A completely new place.',
      [testPlaces[0], testPlaces[1]]
    );

    expect(result).toBeNull();
    expect(queryLlmMock).toHaveBeenCalledTimes(2);
  });

  it('propagates errors from LLM calls', async () => {
    queryLlmMock.mockRejectedValueOnce(new Error('LLM API error'));

    await expect(
      checkPlaceSimilarityWithLlm('Some Place', 'Some description.', [testPlaces[0]])
    ).rejects.toThrow('LLM API error');
  });
});

describe('hasVesselTags', () => {
  it('returns true for place with vessel_helm object', () => {
    const place = createTestPlace({ id: 'PLACE_ship', label: 'The Sea Serpent' });
    const helm = createTestObjectEntity({ id: 'OBJ_helm', info: { purpose: 'vessel_helm' }, position: { parent: 'PLACE_ship' } });
    const ctx = createMockUniverseContext({ universeId: 'test', places: [place], objects: [helm] });
    expect(hasVesselTags(ctx, place)).toBe(true);
  });

  it('returns false for place without vessel_helm object', () => {
    const place = createTestPlace({ id: 'PLACE_town', label: 'Fogfen Cross' });
    const ctx = createMockUniverseContext({ universeId: 'test', places: [place] });
    expect(hasVesselTags(ctx, place)).toBe(false);
  });

  it('returns false for place with non-helm objects only', () => {
    const place = createTestPlace({ id: 'PLACE_tavern' });
    const table = createTestObjectEntity({ id: 'OBJ_table', info: { purpose: 'table' }, position: { parent: 'PLACE_tavern' } });
    const ctx = createMockUniverseContext({ universeId: 'test', places: [place], objects: [table] });
    expect(hasVesselTags(ctx, place)).toBe(false);
  });
});

describe('initializeVesselIfNeeded', () => {
  it('initializes vessel with position.parent when place has vessel_helm', () => {
    const harbor = createTestPlace({ id: 'PLACE_harbor', label: 'The Harbor', position: { innerWidth: 800, innerHeight: 600, parent: null } });
    const place = createTestPlace({ id: 'PLACE_ship', label: 'The Sea Serpent', position: { parent: null } });
    const helm = createTestObjectEntity({ id: 'OBJ_helm', info: { purpose: 'vessel_helm' }, position: { parent: 'PLACE_ship' } });
    const ctx = createMockUniverseContext({ universeId: 'test', places: [place, harbor], objects: [helm] });

    initializeVesselIfNeeded(place, 'PLACE_harbor', 'The Harbor', ctx);
    expect(place.position.parent).toBe('PLACE_harbor');
  });

  it('does NOT initialize place without vessel_helm', () => {
    const place = createTestPlace({ id: 'PLACE_town', position: { parent: null } });
    const ctx = createMockUniverseContext({ universeId: 'test', places: [place] });

    initializeVesselIfNeeded(place, 'PLACE_the_cosmos', 'The Cosmos', ctx);
    expect(place.position.parent).toBeNull();
  });

  it('skips initialization if already has position.parent set', () => {
    const place = createTestPlace({ id: 'PLACE_ship', position: { parent: 'PLACE_other_harbor' } });
    const helm = createTestObjectEntity({ id: 'OBJ_helm', info: { purpose: 'vessel_helm' }, position: { parent: 'PLACE_ship' } });
    const ctx = createMockUniverseContext({ universeId: 'test', places: [place], objects: [helm] });

    initializeVesselIfNeeded(place, 'PLACE_harbor', 'The Harbor', ctx);
    expect(place.position.parent).toBe('PLACE_other_harbor');
  });

  it('skips initialization if already has destinationPlaceId (in transit)', () => {
    const place = createTestPlace({ id: 'PLACE_ship', position: { parent: 'PLACE_open_sea' }, destinationPlaceId: 'PLACE_port_b' });
    const helm = createTestObjectEntity({ id: 'OBJ_helm', info: { purpose: 'vessel_helm' }, position: { parent: 'PLACE_ship' } });
    const ctx = createMockUniverseContext({ universeId: 'test', places: [place], objects: [helm] });

    initializeVesselIfNeeded(place, 'PLACE_harbor', 'The Harbor', ctx);
    expect(place.position.parent).toBe('PLACE_open_sea');
    expect(place.destinationPlaceId).toBeDefined();
  });
});
