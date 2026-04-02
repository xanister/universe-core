/**
 * Unit tests for place-layout-service.
 *
 * Tests that getOrGenerateLayout syncs place fields from the layout template:
 * - spriteId
 * - dimensions from sprite
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Place, Universe } from '@dmnpc/types/entity';
import type { PlaceLayout } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

// ============================================================================
// Test data
// ============================================================================

const mockPlace: Place = {
  id: 'PLACE_spaceship',
  label: 'The Errata Barge',
  description: 'A rusty spaceship',
  short_description: 'rusty spaceship',
  entityType: 'place',
  tags: [],
  info: {
    purpose: 'spaceship',
    environment: ENVIRONMENT_PRESETS.interior(),
    scale: 'feet',
    spriteConfig: { spriteId: 'old_sprite' },
    music: null,
    musicHints: null,
    commonKnowledge: null,
    secrets: null,
    isTemporary: false,
    isVessel: true,
    dockedAtPlaceId: null,
    timeScale: 5,
    battleBackgroundUrl: '',
    inheritedRequiredTags: null,
  },
  position: {
    x: 0,
    y: 0,
    parent: 'PLACE_cosmos',
    width: 64,
    height: 64,
    innerWidth: 0,
    innerHeight: 0,
  },
  relationships: [],
};

const mockLayout: PlaceLayout = {
  bounds: { width: 800, height: 600 },
  terrain: [],
  slots: [],
  objectPlacements: [],
};

const mockUniverse: Universe = {
  id: 'test_universe',
  name: 'Test Universe',
  description: 'Test',
  version: '1.0.0',
  custom: {},
  rules: 'Test rules',
  tone: 'Neutral',
  style: 'Test style',
  date: '1.1.1',
  races: [],
  rootPlaceId: 'PLACE_root',
};

// ============================================================================
// Mocks
// ============================================================================

// Mock the layout generator
vi.mock('@dmnpc/generation/place-layout/index.js', () => ({
  generatePlaceLayout: vi.fn().mockResolvedValue({
    layout: {
      bounds: { width: 800, height: 600 },
      terrain: [],
      slots: [],
      objectPlacements: [],
    },
    objectEntities: [],
  }),
}));

// Mock layout template loader
vi.mock('@dmnpc/generation/place-layout/layout-templates.js', () => ({
  getLayoutTemplate: vi.fn().mockReturnValue({
    name: 'Spaceship',
    description: 'A spaceship layout',
    purposes: ['spaceship'],
    spriteId: 'spaceship_explorer',
    variants: [
      {
        id: 'default',
        weight: 1,
        environment: ENVIRONMENT_PRESETS.interior(),
        width: { min: 10, max: 20 },
        height: { min: 10, max: 20 },
        slots: [],
      },
    ],
    characterScale: 1,
    timeScale: 10,
  }),
}));

// Mock sprite dimensions
vi.mock('@dmnpc/generation/sprite-dimensions.js', () => ({
  getSpriteDimensions: vi.fn().mockResolvedValue({ width: 128, height: 128 }),
}));

// Mock battle background generator
vi.mock('@dmnpc/generation/media/battle-background-generator.js', () => ({
  generateBattleBackground: vi.fn().mockResolvedValue('https://s3.example.com/battles/PLACE_spaceship.png?v=123'),
  extractTerrainHints: vi.fn().mockReturnValue(['land']),
}));

// Mock core persistence functions
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('@dmnpc/core/universe/universe-store.js', () => ({
  loadPlaceLayout: vi.fn().mockResolvedValue(null),
  savePlaceLayout: vi.fn(),
  deletePlaceLayout: vi.fn(),
}));

import { getOrGenerateLayout, regenerateLayout } from '@dmnpc/generation/place/place-layout-service.js';
import { getLayoutTemplate } from '@dmnpc/generation/place-layout/layout-templates.js';
import { getSpriteDimensions } from '@dmnpc/generation/sprite-dimensions.js';
import { loadPlaceLayout, deletePlaceLayout } from '@dmnpc/core/universe/universe-store.js';
import { generatePlaceLayout } from '@dmnpc/generation/place-layout/index.js';

// ============================================================================
// Context helper
// ============================================================================

let upsertedEntities: { type: string; entity: unknown }[];
let persistCalled: boolean;

function createMockCtx(): UniverseContext {
  const places = new Map<string, Place>([['PLACE_spaceship', structuredClone(mockPlace)]]);

  return {
    universeId: 'test_universe',
    universe: mockUniverse,
    findPlace: (id: string) => places.get(id) ?? null,
    getPlace: (id: string) => {
      const p = places.get(id);
      if (!p) throw new Error(`Place ${id} not found`);
      return p;
    },
    upsertEntity: (type: string, entity: unknown) => {
      upsertedEntities.push({ type, entity });
    },
    getChildPlaces: () => [],
    getObjectsByPlace: () => [],
    persistAll: vi.fn().mockImplementation(async () => {
      persistCalled = true;
    }),
  } as unknown as UniverseContext;
}

// ============================================================================
// Tests
// ============================================================================

describe('getOrGenerateLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertedEntities = [];
    persistCalled = false;
  });

  it('updates spriteId from layout template after generation', async () => {
    const ctx = createMockCtx();

    await getOrGenerateLayout(ctx, 'PLACE_spaceship');

    // Should have upserted the place with the template's spriteId
    const upserted = upsertedEntities.find((e) => e.type === 'place');
    expect(upserted).toBeDefined();
    const place = upserted!.entity as Place;
    expect(place.info.spriteConfig.spriteId).toBe('spaceship_explorer');
  });

  it('updates timeScale from layout template after generation', async () => {
    const ctx = createMockCtx();

    // mockPlace starts with timeScale: 5, template has timeScale: 10
    await getOrGenerateLayout(ctx, 'PLACE_spaceship');

    const upserted = upsertedEntities.find((e) => e.type === 'place');
    expect(upserted).toBeDefined();
    const place = upserted!.entity as Place;
    expect(place.info.timeScale).toBe(10);
  });

  it('updates dimensions from new sprite after generation', async () => {
    const ctx = createMockCtx();

    await getOrGenerateLayout(ctx, 'PLACE_spaceship');

    // getSpriteDimensions should be called with the template's spriteId, not the old one
    expect(getSpriteDimensions).toHaveBeenCalledWith('spaceship_explorer');

    const upserted = upsertedEntities.find((e) => e.type === 'place');
    const place = upserted!.entity as Place;
    expect(place.position.width).toBe(128);
    expect(place.position.height).toBe(128);
    expect(place.position.innerWidth).toBe(800);
    expect(place.position.innerHeight).toBe(600);
  });

  it('persists updated place entity', async () => {
    const ctx = createMockCtx();

    await getOrGenerateLayout(ctx, 'PLACE_spaceship');

    expect(persistCalled).toBe(true);
    expect(upsertedEntities.length).toBe(1);
    expect(upsertedEntities[0].type).toBe('place');
  });

  it('handles missing layout template gracefully', async () => {
    vi.mocked(getLayoutTemplate).mockReturnValueOnce(undefined);
    const ctx = createMockCtx();

    const layout = await getOrGenerateLayout(ctx, 'PLACE_spaceship');

    // Should still return the layout
    expect(layout).toBeDefined();

    // spriteId should remain unchanged (old value)
    const upserted = upsertedEntities.find((e) => e.type === 'place');
    const place = upserted!.entity as Place;
    expect(place.info.spriteConfig.spriteId).toBe('old_sprite');
  });

  it('syncs environment from template variant after generation', async () => {
    // Template variant has maxDarkness: 1.0 (pitch black dungeon)
    const dungeonEnv = { ...ENVIRONMENT_PRESETS.interior(), maxDarkness: 1.0 };
    vi.mocked(getLayoutTemplate).mockReturnValueOnce({
      name: 'Spaceship',
      description: 'A spaceship layout',
      purposes: ['spaceship'],
      spriteId: 'spaceship_explorer',
      variants: [{ id: 'dark', weight: 1, environment: dungeonEnv, width: { min: 10, max: 20 }, height: { min: 10, max: 20 }, slots: [] }],
      characterScale: 1,
      timeScale: 10,
    } as ReturnType<typeof getLayoutTemplate>);

    const ctx = createMockCtx();
    await getOrGenerateLayout(ctx, 'PLACE_spaceship');

    const upserted = upsertedEntities.find((e) => e.type === 'place');
    const place = upserted!.entity as Place;
    // Environment should be synced from the template variant
    expect(place.info.environment.maxDarkness).toBe(1.0);
  });

  // ==========================================================================
  // BUG-160: Layout regeneration must generate layouts for child places
  // ==========================================================================

  it('does not recursively regenerate child layouts during forceRegenerate (BUG-204)', async () => {
    // BUG-204: Child layout generation is handled by generatePlace(), not the layout service.
    // forceRegenerate only regenerates the target place's layout; children are repositioned
    // by the layout generator's pool-matching but their own layouts are not regenerated.
    const childPlace: Place = {
      ...structuredClone(mockPlace),
      id: 'PLACE_corridor',
      label: 'Corridor',
      info: {
        ...mockPlace.info,
        purpose: 'ship_corridor',
      },
      position: {
        x: 100,
        y: 100,
        parent: 'PLACE_spaceship',
        width: 32,
        height: 32,
      },
    };

    const places = new Map<string, Place>([
      ['PLACE_spaceship', structuredClone(mockPlace)],
      ['PLACE_corridor', childPlace],
    ]);

    const ctx = {
      universeId: 'test_universe',
      universe: mockUniverse,
      findPlace: (id: string) => places.get(id) ?? null,
      getPlace: (id: string) => {
        const p = places.get(id);
        if (!p) throw new Error(`Place ${id} not found`);
        return p;
      },
      upsertEntity: (type: string, entity: unknown) => {
        upsertedEntities.push({ type, entity });
      },
      getChildPlaces: (placeId: string) =>
        placeId === 'PLACE_spaceship' ? [childPlace] : [],
      getObjectsByPlace: () => [],
      persistAll: vi.fn(),
    } as unknown as UniverseContext;

    vi.mocked(loadPlaceLayout).mockImplementation(async (_universeId, placeId) => {
      if (placeId === 'PLACE_spaceship') return mockLayout;
      return null;
    });

    await getOrGenerateLayout(ctx, 'PLACE_spaceship', { forceRegenerate: true });

    // Only the parent's layout should be generated — not the child's
    expect(generatePlaceLayout).toHaveBeenCalledTimes(1);
    expect(generatePlaceLayout).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ placeId: 'PLACE_spaceship' })
    );
  });

  it('skips child layout generation when child already has a layout (BUG-160)', async () => {
    const childPlace: Place = {
      ...structuredClone(mockPlace),
      id: 'PLACE_corridor',
      label: 'Corridor',
      info: {
        ...mockPlace.info,
        purpose: 'ship_corridor',
      },
      position: {
        x: 100,
        y: 100,
        parent: 'PLACE_spaceship',
        width: 32,
        height: 32,
        innerWidth: 400,
        innerHeight: 300,
      },
    };

    const places = new Map<string, Place>([
      ['PLACE_spaceship', structuredClone(mockPlace)],
      ['PLACE_corridor', childPlace],
    ]);

    const ctx = {
      universeId: 'test_universe',
      universe: mockUniverse,
      findPlace: (id: string) => places.get(id) ?? null,
      getPlace: (id: string) => {
        const p = places.get(id);
        if (!p) throw new Error(`Place ${id} not found`);
        return p;
      },
      upsertEntity: (type: string, entity: unknown) => {
        upsertedEntities.push({ type, entity });
      },
      getChildPlaces: (placeId: string) =>
        placeId === 'PLACE_spaceship' ? [childPlace] : [],
      getObjectsByPlace: () => [],
      persistAll: vi.fn(),
    } as unknown as UniverseContext;

    // Both parent and child have existing layouts
    vi.mocked(loadPlaceLayout).mockResolvedValue(mockLayout);

    await getOrGenerateLayout(ctx, 'PLACE_spaceship', { forceRegenerate: true });

    // generatePlaceLayout called only for parent (child has existing layout, reused)
    expect(generatePlaceLayout).toHaveBeenCalledTimes(1);
    expect(generatePlaceLayout).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ placeId: 'PLACE_spaceship' })
    );
  });
});

// ============================================================================
// regenerateLayout tests
// ============================================================================

describe('regenerateLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertedEntities = [];
    persistCalled = false;
  });

  it('passes existing objects to the generator for reuse', async () => {
    const existingObj = {
      id: 'OBJ_chair_01',
      label: 'Chair',
      description: 'A wooden chair',
      entityType: 'object' as const,
      tags: [],
      info: {
        purpose: 'chair',
        spriteConfig: { spriteId: 'chair_wooden' },
        layer: 'default',
        material: null,
        tint: null,
        contents: null,
      },
      position: { x: 100, y: 100, parent: 'PLACE_spaceship' },
      relationships: [],
    };

    const ctx = {
      universeId: 'test_universe',
      universe: mockUniverse,
      findPlace: (id: string) => (id === 'PLACE_spaceship' ? structuredClone(mockPlace) : null),
      getPlace: (id: string) => {
        if (id === 'PLACE_spaceship') return structuredClone(mockPlace);
        throw new Error(`Place ${id} not found`);
      },
      upsertEntity: (type: string, entity: unknown) => {
        upsertedEntities.push({ type, entity });
      },
      getChildPlaces: () => [],
      getObjectsByPlace: () => [existingObj],
      persistAll: vi.fn(),
    } as unknown as UniverseContext;

    vi.mocked(loadPlaceLayout).mockResolvedValue(mockLayout);
    vi.mocked(generatePlaceLayout).mockResolvedValue({
      layout: mockLayout,
      objectEntities: [],
      reuse: {
        matchedObjectIds: ['OBJ_chair_01'],
        matchedPlaceIds: [],
        orphanedObjectIds: [],
        orphanedPlaceIds: [],
        unfilledPlaceSlots: [],
      },
    });

    const result = await regenerateLayout(ctx, 'PLACE_spaceship');

    // Generator should receive existing objects
    expect(generatePlaceLayout).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        placeId: 'PLACE_spaceship',
        existingObjects: [existingObj],
      })
    );

    expect(result.matchedObjectIds).toEqual(['OBJ_chair_01']);
    expect(result.orphanedObjectIds).toEqual([]);
  });

  it('returns orphaned objects and unfilled place slots', async () => {
    const ctx = createMockCtx();

    vi.mocked(loadPlaceLayout).mockResolvedValue(mockLayout);
    vi.mocked(generatePlaceLayout).mockResolvedValue({
      layout: mockLayout,
      objectEntities: [],
      reuse: {
        matchedObjectIds: [],
        matchedPlaceIds: ['PLACE_child_a'],
        orphanedObjectIds: ['OBJ_orphan_01'],
        orphanedPlaceIds: ['PLACE_orphan_01'],
        unfilledPlaceSlots: [
          { purpose: 'tavern', category: 'place', x: 5, y: 5, width: 3, height: 3, facing: 'south', layer: 'default' },
        ],
      },
    });

    const result = await regenerateLayout(ctx, 'PLACE_spaceship');

    expect(result.orphanedObjectIds).toEqual(['OBJ_orphan_01']);
    expect(result.orphanedPlaceIds).toEqual(['PLACE_orphan_01']);
    expect(result.matchedPlaceIds).toEqual(['PLACE_child_a']);
    expect(result.unfilledPlaceSlots).toHaveLength(1);
    expect(result.unfilledPlaceSlots[0].purpose).toBe('tavern');
  });

  it('deletes existing layout file before regenerating', async () => {
    const ctx = createMockCtx();

    vi.mocked(loadPlaceLayout).mockResolvedValue(mockLayout);
    vi.mocked(generatePlaceLayout).mockResolvedValue({
      layout: mockLayout,
      objectEntities: [],
      reuse: {
        matchedObjectIds: [],
        matchedPlaceIds: [],
        orphanedObjectIds: [],
        orphanedPlaceIds: [],
        unfilledPlaceSlots: [],
      },
    });

    await regenerateLayout(ctx, 'PLACE_spaceship');

    expect(deletePlaceLayout).toHaveBeenCalledWith('test_universe', 'PLACE_spaceship');
  });

  it('reuses existing context to avoid redundant LLM call', async () => {
    const existingContext = { wealth: 'moderate' as const, cleanliness: 'clean' as const, crowding: 'normal' as const, atmosphere: 'formal' as const };
    const layoutWithContext = { ...mockLayout, context: existingContext };

    const ctx = createMockCtx();

    vi.mocked(loadPlaceLayout).mockResolvedValue(layoutWithContext);
    vi.mocked(generatePlaceLayout).mockResolvedValue({
      layout: mockLayout,
      objectEntities: [],
      reuse: {
        matchedObjectIds: [],
        matchedPlaceIds: [],
        orphanedObjectIds: [],
        orphanedPlaceIds: [],
        unfilledPlaceSlots: [],
      },
    });

    await regenerateLayout(ctx, 'PLACE_spaceship');

    expect(generatePlaceLayout).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        existingContext,
      })
    );
  });
});
