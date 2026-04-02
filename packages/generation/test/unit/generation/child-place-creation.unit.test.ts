/**
 * Unit tests for child place handling during layout generation.
 *
 * BUG-204: Layout generator must NOT create child place entities — that is
 * handled by generatePlace() which calls the LLM for proper naming.
 * The layout generator only repositions existing children (for regeneration).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Place } from '@dmnpc/types/entity';
import type { GeneratedSlot } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// ============================================================================
// Hoisted mocks
// ============================================================================

const {
  mockGetLayoutTemplate,
  mockSelectLayoutVariant,
  mockLoadPurposeCategory,
  mockLoadPurposeDefinition,
  mockGenerateEntityId,
  mockGenerateShapeFromTemplate,
  mockPopulateSlots,
  mockDetectContext,
  mockGetSpriteBoundingBox,
  mockCreateObjectEntity,
  mockGenerateObjectDescriptions,
  mockComputeBackdropOffset,
} = vi.hoisted(() => ({
  mockGetLayoutTemplate: vi.fn(),
  mockSelectLayoutVariant: vi.fn(),
  mockLoadPurposeCategory: vi.fn(),
  mockLoadPurposeDefinition: vi.fn(),
  mockGenerateEntityId: vi.fn(),
  mockGenerateShapeFromTemplate: vi.fn(),
  mockPopulateSlots: vi.fn(),
  mockDetectContext: vi.fn(),
  mockGetSpriteBoundingBox: vi.fn(),
  mockCreateObjectEntity: vi.fn(),
  mockGenerateObjectDescriptions: vi.fn(),
  mockComputeBackdropOffset: vi.fn(),
}));

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@dmnpc/generation/place-layout/layout-templates.js', () => ({
  getLayoutTemplate: mockGetLayoutTemplate,
  selectLayoutVariant: mockSelectLayoutVariant,
}));

vi.mock('@dmnpc/generation/purpose-loader.js', () => ({
  loadPurposeCategory: mockLoadPurposeCategory,
  loadPurposeDefinition: mockLoadPurposeDefinition,
}));

vi.mock('@dmnpc/generation/id-generator.js', () => ({
  generateEntityId: mockGenerateEntityId,
}));

vi.mock('@dmnpc/generation/place-layout/layers/shape-generator.js', () => ({
  generateShapeFromTemplate: mockGenerateShapeFromTemplate,
}));

vi.mock('@dmnpc/generation/place-layout/layers/context-populator.js', () => ({
  populateSlots: mockPopulateSlots,
}));

vi.mock('@dmnpc/generation/place-layout/classifier.js', () => ({
  detectContext: mockDetectContext,
}));

vi.mock('@dmnpc/generation/place-layout/object-catalog.js', () => ({
  getSpriteBoundingBox: mockGetSpriteBoundingBox,
  getSpriteDimensions: () => ({ width: 32, height: 32 }),
  computeWorldPosition: (tileX: number, tileY: number) => {
    const tileSize = 32;
    return { x: tileX * tileSize + tileSize / 2, y: (tileY + 1) * tileSize };
  },
  resolveEntityLayerBySprite: (_purpose: string, _spriteId: string, fallback: string) => fallback,
  getSpriteDefaultLayer: () => null,
}));

vi.mock('@dmnpc/generation/place-layout/object-factory.js', () => ({
  createObjectEntity: mockCreateObjectEntity,
}));

vi.mock('@dmnpc/generation/place-layout/ai-augment.js', () => ({
  generateObjectDescriptions: mockGenerateObjectDescriptions,
}));

vi.mock('@dmnpc/generation/place-layout/algorithms/shape-algorithms.js', () => ({
  computeBackdropOffset: mockComputeBackdropOffset,
}));

vi.mock('@dmnpc/generation/place-layout/algorithms/index.js', () => ({
  getPlacementAlgorithm: vi.fn(),
}));

// Import after mocks
const { generatePlaceLayout, mergeTagArrays } = await import(
  '@dmnpc/generation/place-layout/generator.js'
);

// ============================================================================
// Helpers
// ============================================================================

const TILE_SIZE = 32;

const corridorTemplate = {
  name: 'Ship Corridor',
  description: 'Below-deck corridor',
  purposes: ['ship_corridor'],
  spriteId: 'corridor_sprite',
  variants: [],
  characterScale: 1,
  timeScale: 1,
};

const corridorVariant = {
  id: 'default',
  scale: 'feet' as const,
  environment: ENVIRONMENT_PRESETS.interior(),
  width: { min: 20, max: 20 },
  height: { min: 10, max: 10 },
  terrainLayers: [],
  slots: [],
  description: 'A corridor',
  weight: 1,
};

const shipTemplate = {
  name: 'Sailing Ship',
  description: 'A sailing ship',
  purposes: ['sailing_ship'],
  spriteId: 'ship_sloop',
  variants: [],
  characterScale: 1,
  timeScale: 1,
};

const shipVariant = {
  id: 'sloop',
  scale: 'feet' as const,
  environment: ENVIRONMENT_PRESETS.exterior(),
  width: { min: 20, max: 20 },
  height: { min: 20, max: 20 },
  terrainLayers: [
    {
      id: 'room',
      type: 'sprite_backdrop',
      tilesetId: 'custom-ship',
      tilesetOffset: null,
      renderOrder: 1,
      blocking: 'unblocks',
      terrain: 'land',
      procedural: false,
      fill: [0],
      anchorX: 0.5,
      anchorY: 0.5,
      gridWidth: 20,
      gridHeight: 10,
      unblockedTiles: [[5, 5]],
      slots: [
        {
          purposes: ['ship_corridor'],
          candidates: [{ x: 10, y: 5 }],
          min: 1,
          max: 1,
          chance: null,
          forbiddenTags: null,
          inheritableTags: null,
          flags: { useLlmSelection: false },
        },
      ],
    },
  ],
  slots: [],
  description: 'A sloop',
  weight: 1,
};

function createParentPlace(): Place {
  return {
    id: 'PLACE_the_ship',
    label: 'The Ship',
    description: 'A ship',
    short_description: 'a ship',
    tags: [],
    entityType: 'place',
    info: {
      purpose: 'sailing_ship',
      environment: ENVIRONMENT_PRESETS.exterior(),
      scale: 'feet',
      spriteConfig: { spriteId: 'ship_sloop' },
      music: null,
      musicHints: null,
      commonKnowledge: null,
      secrets: null,
      isTemporary: false,
      dockedAtPlaceId: null,
      timeScale: 1,
      battleBackgroundUrl: '',
      inheritedRequiredTags: null,
    },
    position: { x: 100, y: 100, width: 64, height: 64, parent: 'PLACE_ocean' },
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction: { typeId: 'enter' },
    relationships: [],
    important: false,
  } as Place;
}

let upsertedEntities: Array<{ type: string; entity: unknown }>;

function createMockCtx(parentPlace: Place, childPlaces: Place[] = []) {
  upsertedEntities = [];
  return {
    universeId: 'test_universe',
    getPlace: (id: string) => {
      if (id === parentPlace.id) return parentPlace;
      throw new Error(`Place ${id} not found`);
    },
    findPlace: (id: string) => (id === parentPlace.id ? parentPlace : undefined),
    getChildPlaces: (_placeId: string) => childPlaces,
    getObjectsByPlace: (_placeId: string) => [],
    get places() {
      return [parentPlace, ...childPlaces];
    },
    upsertEntity: (type: string, entity: unknown) => {
      upsertedEntities.push({ type, entity });
    },
  } as unknown as import('@dmnpc/core/universe/universe-context.js').UniverseContext;
}

// ============================================================================
// Tests
// ============================================================================

describe('child place handling during layout generation (BUG-204)', () => {
  beforeEach(() => {
    upsertedEntities = [];

    // Default mock setup for a ship layout with a ship_corridor backdrop slot
    mockGetLayoutTemplate.mockImplementation((purpose: string) => {
      if (purpose === 'sailing_ship') return shipTemplate;
      if (purpose === 'ship_corridor') return corridorTemplate;
      return undefined;
    });
    mockSelectLayoutVariant.mockImplementation((template: unknown) => {
      if (template === shipTemplate) return shipVariant;
      if (template === corridorTemplate) return corridorVariant;
      return shipVariant;
    });
    mockLoadPurposeCategory.mockImplementation((purpose: string) => {
      if (purpose === 'ship_corridor') return 'place';
      return 'object';
    });
    mockLoadPurposeDefinition.mockImplementation((purpose: string) => {
      if (purpose === 'ship_corridor') {
        return {
          id: 'ship_corridor',
          label: 'Ship corridor',
          description: 'Ship corridor',
          category: 'place',
          interactionTypeId: null,
          defaultActivityId: null,
          defaultSchedule: null,
          system: false,
        };
      }
      return null;
    });
    mockGenerateEntityId.mockReturnValue('PLACE_ship_corridor_0001');
    mockGenerateShapeFromTemplate.mockReturnValue({
      bounds: { width: 20, height: 20 },
      layers: [],
      terrainGrid: null,
      blockedMask: [],
    });
    mockComputeBackdropOffset.mockReturnValue({ offsetCol: 0, offsetRow: 5 });
    mockPopulateSlots.mockResolvedValue([]);
    mockDetectContext.mockResolvedValue({
      wealth: 'moderate',
      cleanliness: 'worn',
      crowding: 'normal',
      atmosphere: 'casual',
    });
  });

  it('skips place-category slots without creating child entities (BUG-204)', async () => {
    const parent = createParentPlace();
    const ctx = createMockCtx(parent);

    await generatePlaceLayout(ctx, { placeId: parent.id });

    // Layout generator should NOT create child places — generatePlace() handles that
    const placeUpserts = upsertedEntities.filter((e) => e.type === 'place');
    expect(placeUpserts.length).toBe(0);
    expect(mockGenerateEntityId).not.toHaveBeenCalled();
  });

  it('includes place-category slots in layout.slots for generatePlace() to read', async () => {
    const parent = createParentPlace();
    const ctx = createMockCtx(parent);

    const result = await generatePlaceLayout(ctx, { placeId: parent.id });

    // The slot should be in layout.slots so generatePlace() can find it
    const placeSlots = result.layout.slots.filter(
      (s: GeneratedSlot) => s.category === 'place'
    );
    expect(placeSlots.length).toBe(1);
    expect(placeSlots[0].purpose).toBe('ship_corridor');
  });

  it('repositions existing child place instead of creating a new one', async () => {
    const parent = createParentPlace();
    const existingChild: Place = {
      ...createParentPlace(),
      id: 'PLACE_existing_corridor',
      label: 'Below Deck',
      info: {
        ...createParentPlace().info,
        purpose: 'ship_corridor',
      },
      position: { x: 50, y: 50, width: 64, height: 64, parent: parent.id },
    } as Place;
    const ctx = createMockCtx(parent, [existingChild]);

    await generatePlaceLayout(ctx, { placeId: parent.id });

    // Should reposition existing child, not create a new one
    const placeUpserts = upsertedEntities.filter((e) => e.type === 'place');
    expect(placeUpserts.length).toBe(1);

    const repositioned = placeUpserts[0].entity as Place;
    expect(repositioned.id).toBe('PLACE_existing_corridor');
    expect(repositioned.label).toBe('Below Deck');
    // generateEntityId should NOT have been called for a new child
    expect(mockGenerateEntityId).not.toHaveBeenCalled();
  });

  it('does not throw when place-category slot has no layout template', async () => {
    mockGetLayoutTemplate.mockImplementation((purpose: string) => {
      if (purpose === 'sailing_ship') return shipTemplate;
      return undefined; // No template serves ship_corridor
    });

    const parent = createParentPlace();
    const ctx = createMockCtx(parent);

    // Should not throw — place-category slots are simply skipped
    await expect(generatePlaceLayout(ctx, { placeId: parent.id })).resolves.toBeDefined();
  });

  it('does not throw when place-category slot has no purpose definition', async () => {
    mockLoadPurposeDefinition.mockReturnValue(null);

    const parent = createParentPlace();
    const ctx = createMockCtx(parent);

    // Should not throw — place-category slots are simply skipped
    await expect(generatePlaceLayout(ctx, { placeId: parent.id })).resolves.toBeDefined();
  });
});

// ============================================================================
// FEAT-227: mergeTagArrays (used by generatePlace for child tag inheritance)
// ============================================================================

describe('mergeTagArrays', () => {
  it('merges two tag arrays with deduplication', () => {
    expect(mergeTagArrays(['dark'], ['ship'])).toEqual(
      expect.arrayContaining(['dark', 'ship'])
    );
    expect(mergeTagArrays(['dark'], ['ship'])).toHaveLength(2);
  });

  it('returns parent tags when slot has no inheritableTags', () => {
    expect(mergeTagArrays(['ship'], null)).toEqual(['ship']);
  });

  it('returns slot tags when parent has no inheritedRequiredTags', () => {
    expect(mergeTagArrays(null, ['ship'])).toEqual(['ship']);
  });

  it('returns null when both inputs are null', () => {
    expect(mergeTagArrays(null, null)).toBeNull();
  });

  it('returns null when both inputs are empty arrays', () => {
    expect(mergeTagArrays([], [])).toBeNull();
  });

  it('deduplicates overlapping tags', () => {
    expect(mergeTagArrays(['dark', 'ship'], ['ship', 'cold'])).toEqual(
      expect.arrayContaining(['dark', 'ship', 'cold'])
    );
    expect(mergeTagArrays(['dark', 'ship'], ['ship', 'cold'])).toHaveLength(3);
  });
});
