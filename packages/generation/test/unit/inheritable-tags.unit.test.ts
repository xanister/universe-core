/**
 * Unit tests for inheritable slot tag requirements (FEAT-227).
 *
 * Tests mergeTagArrays helper and the inheritance propagation logic
 * in generatePositionedSlots and child place creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Place } from '@dmnpc/types/entity';
import type { GeneratedSlot } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import { mergeTagArrays } from '../../src/place-layout/generator.js';

// ============================================================================
// mergeTagArrays pure helper tests
// ============================================================================

describe('mergeTagArrays (FEAT-227)', () => {
  it('returns null when both inputs are null', () => {
    expect(mergeTagArrays(null, null)).toBeNull();
  });

  it('returns null when both inputs are undefined', () => {
    expect(mergeTagArrays(undefined, undefined)).toBeNull();
  });

  it('returns null when both inputs are empty arrays', () => {
    expect(mergeTagArrays([], [])).toBeNull();
  });

  it('returns first array when second is null', () => {
    expect(mergeTagArrays(['ship'], null)).toEqual(['ship']);
  });

  it('returns second array when first is null', () => {
    expect(mergeTagArrays(null, ['ship'])).toEqual(['ship']);
  });

  it('returns first array when second is undefined', () => {
    expect(mergeTagArrays(['ship'], undefined)).toEqual(['ship']);
  });

  it('returns second array when first is undefined', () => {
    expect(mergeTagArrays(undefined, ['dark'])).toEqual(['dark']);
  });

  it('merges two arrays into a union', () => {
    const result = mergeTagArrays(['ship'], ['dark']);
    expect(result).toEqual(expect.arrayContaining(['ship', 'dark']));
    expect(result).toHaveLength(2);
  });

  it('deduplicates overlapping tags', () => {
    const result = mergeTagArrays(['ship', 'dark'], ['dark', 'metal']);
    expect(result).toEqual(expect.arrayContaining(['ship', 'dark', 'metal']));
    expect(result).toHaveLength(3);
  });

  it('deduplicates fully identical arrays', () => {
    const result = mergeTagArrays(['ship'], ['ship']);
    expect(result).toEqual(['ship']);
  });

  it('handles one empty and one populated array', () => {
    expect(mergeTagArrays([], ['ship'])).toEqual(['ship']);
    expect(mergeTagArrays(['ship'], [])).toEqual(['ship']);
  });
});

// ============================================================================
// Generator-level inherited tag propagation tests
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
  mockComputeBackdropOffset: vi.fn(),
}));

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/place-layout/layout-templates.js', () => ({
  getLayoutTemplate: mockGetLayoutTemplate,
  selectLayoutVariant: mockSelectLayoutVariant,
}));

vi.mock('../../src/purpose-loader.js', () => ({
  loadPurposeCategory: mockLoadPurposeCategory,
  loadPurposeDefinition: mockLoadPurposeDefinition,
}));

vi.mock('../../src/id-generator.js', () => ({
  generateEntityId: mockGenerateEntityId,
}));

vi.mock('../../src/place-layout/layers/shape-generator.js', () => ({
  generateShapeFromTemplate: mockGenerateShapeFromTemplate,
}));

vi.mock('../../src/place-layout/layers/context-populator.js', () => ({
  populateSlots: mockPopulateSlots,
}));

vi.mock('../../src/place-layout/classifier.js', () => ({
  detectContext: mockDetectContext,
}));

vi.mock('../../src/place-layout/object-catalog.js', () => ({
  getSpriteBoundingBox: vi.fn(),
  getSpriteDimensions: () => ({ width: 32, height: 32 }),
  getEntitiesByPurpose: vi.fn((purpose) => [
    {
      id: `test_${purpose}`,
      width: 32,
      height: 32,
      tags: ['ship', 'metal'],
    },
  ]),
  computeWorldPosition: (tileX: number, tileY: number) => ({
    x: tileX * 32 + 16,
    y: (tileY + 1) * 32,
  }),
  resolveEntityLayerBySprite: (_purpose: string, _spriteId: string, fallback: string) => fallback,
  getSpriteDefaultLayer: () => null,
}));

vi.mock('../../src/place-layout/object-factory.js', () => ({
  createObjectEntity: vi.fn(),
}));

vi.mock('../../src/place-layout/ai-augment.js', () => ({
  generateObjectDescriptions: vi.fn(),
}));

vi.mock('../../src/place-layout/algorithms/shape-algorithms.js', () => ({
  computeBackdropOffset: mockComputeBackdropOffset,
}));

// Mock the placement algorithm registry to return a trivial algorithm
vi.mock('../../src/place-layout/algorithms/index.js', () => ({
  getPlacementAlgorithm: () => {
    return (ctx: { slots: Array<{ purposes: string[] }> }) =>
      ctx.slots.map((slot) => ({
        slot,
        x: 5,
        y: 5,
        width: 1,
        height: 1,
        facing: 'south' as const,
        layer: 'default' as const,
      }));
  },
  getPlacementAlgorithmMeta: () => undefined,
}));

const { generatePlaceLayout } = await import('../../src/place-layout/generator.js');

function createPlace(overrides: Partial<Place['info']> = {}): Place {
  return {
    id: 'PLACE_test_room',
    label: 'Test Room',
    description: 'A test room',
    short_description: 'test',
    tags: [],
    entityType: 'place',
    info: {
      purpose: 'tavern',
      environment: ENVIRONMENT_PRESETS.interior(),
      scale: 'feet',
      spriteConfig: { spriteId: 'room_sprite', facing: 'south', layer: 'default' },
      music: null,
      musicHints: null,
      commonKnowledge: null,
      secrets: null,
      isTemporary: false,
      dockedAtPlaceId: null,
      timeScale: 1,
      battleBackgroundUrl: '',
      inheritedRequiredTags: null,
      ...overrides,
    },
    position: { x: 100, y: 100, width: 64, height: 64, parent: 'PLACE_parent' },
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

function createMockCtx(place: Place) {
  return {
    universeId: 'test_universe',
    getPlace: () => place,
    findPlace: () => place,
    getChildPlaces: () => [],
    getObjectsByPlace: () => [],
    get places() {
      return [place];
    },
    upsertEntity: vi.fn(),
  } as unknown as import('@dmnpc/core/universe/universe-context.js').UniverseContext;
}

describe('inherited tag propagation in generated slots (FEAT-227)', () => {
  const template = {
    name: 'Test Room',
    description: 'A room',
    purposes: ['tavern'],
    spriteId: 'room_sprite',
    variants: [],
    characterScale: 1,
    timeScale: 1,
  };

  beforeEach(() => {
    mockGetLayoutTemplate.mockReturnValue(template);
    mockSelectLayoutVariant.mockReturnValue({
      id: 'default',
      scale: 'feet',
      environment: ENVIRONMENT_PRESETS.interior(),
      width: { min: 10, max: 10 },
      height: { min: 10, max: 10 },
      terrainLayers: [],
      slots: [
        {
          purpose: 'lighting',
          positionAlgorithm: 'random_valid',
          distribution: 'even',
          requiredTags: null,
          forbiddenTags: null,
          inheritableTags: null,
          min: 1,
          max: 1,
          nearPurpose: null,
          slotSize: null,
          visualClearanceAbove: null,
          preferDistrict: null,
          distributionGroup: null,
          flags: { isStructural: false, facesAnchor: false, useLlmSelection: false },
        },
      ],
      description: 'default',
      weight: 1,
    });
    mockLoadPurposeCategory.mockReturnValue('object');
    mockLoadPurposeDefinition.mockReturnValue(null);
    mockGenerateShapeFromTemplate.mockReturnValue({
      bounds: { width: 10, height: 10 },
      layers: [],
      terrainGrid: null,
      blockedMask: [],
    });
    mockPopulateSlots.mockResolvedValue([]);
    mockDetectContext.mockResolvedValue({
      wealth: 'moderate',
      cleanliness: 'worn',
      crowding: 'normal',
      atmosphere: 'casual',
    });
  });

  it('merges inheritedRequiredTags into generated slot requiredTags', async () => {
    const place = createPlace({ inheritedRequiredTags: ['ship'] });
    const ctx = createMockCtx(place);

    const result = await generatePlaceLayout(ctx, {
      placeId: place.id,
      skipAugmentation: true,
    });

    const objectSlots = result.layout.slots.filter(
      (s: GeneratedSlot) => s.category === 'object'
    );
    expect(objectSlots.length).toBeGreaterThan(0);
    for (const slot of objectSlots) {
      expect(slot.requiredTags).toEqual(['ship']);
    }
  });

  it('merges template requiredTags with inherited tags (deduped)', async () => {
    const place = createPlace({ inheritedRequiredTags: ['ship'] });

    mockSelectLayoutVariant.mockReturnValue({
      id: 'default',
      scale: 'feet',
      environment: ENVIRONMENT_PRESETS.interior(),
      width: { min: 10, max: 10 },
      height: { min: 10, max: 10 },
      terrainLayers: [],
      slots: [
        {
          purpose: 'lighting',
          positionAlgorithm: 'random_valid',
          distribution: 'even',
          requiredTags: ['metal'],
          forbiddenTags: null,
          inheritableTags: null,
          min: 1,
          max: 1,
          nearPurpose: null,
          slotSize: null,
          visualClearanceAbove: null,
          preferDistrict: null,
          distributionGroup: null,
          flags: { isStructural: false, facesAnchor: false, useLlmSelection: false },
        },
      ],
      description: 'default',
      weight: 1,
    });

    const ctx = createMockCtx(place);

    const result = await generatePlaceLayout(ctx, {
      placeId: place.id,
      skipAugmentation: true,
    });

    const objectSlots = result.layout.slots.filter(
      (s: GeneratedSlot) => s.category === 'object'
    );
    expect(objectSlots.length).toBeGreaterThan(0);
    for (const slot of objectSlots) {
      expect(slot.requiredTags).toEqual(expect.arrayContaining(['metal', 'ship']));
      expect(slot.requiredTags).toHaveLength(2);
    }
  });
});
