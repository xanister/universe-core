/**
 * Regression tests for resolveSlotSizes.
 *
 * BUG-259: Place-category sprites that resolve to 1×1 tiles must still
 * produce an explicit slotSize — the old code returned the original slot
 * (with slotSize: null) as an optimisation, which crashed slotOccupancy().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock purpose loader — all test slots are place-category
vi.mock('../../../src/purpose-loader.js', () => ({
  loadPurposeCategory: vi.fn(() => 'place'),
}));

// Mock object catalog — not needed for place-category tests
vi.mock('../../../src/place-layout/object-catalog.js', () => ({
  getSpriteBoundingBox: vi.fn(),
  getEntitiesByPurpose: vi.fn(() => []),
  computeWorldPosition: vi.fn(),
  resolveEntityLayerBySprite: vi.fn(),
  getSpriteDefaultLayer: vi.fn(),
  getEntityDefinition: vi.fn(),
}));

// Mock layout templates
vi.mock('../../../src/place-layout/layout-templates.js', () => ({
  getLayoutTemplate: vi.fn(),
  selectLayoutVariant: vi.fn(),
}));

import { resolveSlotSizes } from '../../../src/place-layout/generator.js';
import { getSpriteBoundingBox } from '../../../src/place-layout/object-catalog.js';
import { getLayoutTemplate } from '../../../src/place-layout/layout-templates.js';
import type { LayoutSlot } from '@dmnpc/types/world';

function makeSlot(overrides: Partial<LayoutSlot> = {}): LayoutSlot {
  return {
    purpose: 'planet',
    positionAlgorithm: 'open_space',
    min: 1,
    max: 1,
    nearPurpose: null,
    inheritableTags: null,
    distribution: 'even',
    requiredTags: null,
    forbiddenTags: null,
    slotSize: null,
    ...overrides,
  };
}

describe('resolveSlotSizes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets slotSize for 1×1 place-category sprites (BUG-259 regression)', () => {
    vi.mocked(getLayoutTemplate).mockReturnValue({
      id: 'planet',
      name: 'Planet',
      description: 'A celestial body',
      purposes: ['planet'],
      spriteId: 'planet_terran',
      variants: [],
      characterScale: 1,
      timeScale: 1,
      interactionZone: null,
    });
    vi.mocked(getSpriteBoundingBox).mockReturnValue({
      width: 32,
      height: 32,
      offsetX: 0,
      offsetY: 0,
    });

    const slots = [makeSlot()];
    const resolved = resolveSlotSizes(slots);

    expect(resolved[0].slotSize).toEqual({ width: 1, height: 1 });
  });

  it('sets slotSize for multi-tile place-category sprites', () => {
    vi.mocked(getLayoutTemplate).mockReturnValue({
      id: 'city',
      name: 'City',
      description: 'A city',
      purposes: ['city'],
      spriteId: 'city_large',
      variants: [],
      characterScale: 1,
      timeScale: 1,
      interactionZone: null,
    });
    vi.mocked(getSpriteBoundingBox).mockReturnValue({
      width: 96,
      height: 64,
      offsetX: 0,
      offsetY: 0,
    });

    const slots = [makeSlot({ purpose: 'city' })];
    const resolved = resolveSlotSizes(slots);

    expect(resolved[0].slotSize).toEqual({ width: 3, height: 2 });
  });

  it('preserves explicit slotSize without looking up sprite', () => {
    const slots = [makeSlot({ slotSize: { width: 5, height: 3 } })];
    const resolved = resolveSlotSizes(slots);

    expect(resolved[0].slotSize).toEqual({ width: 5, height: 3 });
    expect(getLayoutTemplate).not.toHaveBeenCalled();
  });

  it('throws when layout template is missing', () => {
    vi.mocked(getLayoutTemplate).mockReturnValue(undefined as never);

    const slots = [makeSlot({ purpose: 'nonexistent' })];

    expect(() => resolveSlotSizes(slots)).toThrow(
      /no layout template for place-category purpose "nonexistent"/
    );
  });

  it('throws when sprite has no bounding box', () => {
    vi.mocked(getLayoutTemplate).mockReturnValue({
      id: 'planet',
      name: 'Planet',
      description: 'A celestial body',
      purposes: ['planet'],
      spriteId: 'planet_terran',
      variants: [],
      characterScale: 1,
      timeScale: 1,
      interactionZone: null,
    });
    vi.mocked(getSpriteBoundingBox).mockReturnValue(undefined as never);

    const slots = [makeSlot()];

    expect(() => resolveSlotSizes(slots)).toThrow(/has no bounding box/);
  });
});
