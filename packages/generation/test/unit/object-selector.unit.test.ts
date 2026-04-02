/**
 * Unit tests for object-selector.
 *
 * BUG-056: Object-category purposes with no matching objects must throw
 * instead of silently returning null.
 * BUG-111: Place-category purposes must also throw — the generator handles
 * them before they reach the object selector.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Place } from '@dmnpc/types/entity';
import type { PlaceContext, Purpose, GeneratedSlot } from '@dmnpc/types/world';

// Mock purpose registry
const mockPurposes = [
  { id: 'seating', label: 'Seating', description: '', category: 'object', family: null, interactionType: null },
  { id: 'lighting', label: 'Lighting', description: '', category: 'object', family: null, interactionType: null },
  { id: 'tavern', label: 'Tavern', description: '', category: 'place', family: null, interactionType: null },
  { id: 'unknown_purpose', label: 'Unknown', description: '', category: 'object', family: null, interactionType: null },
];

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({
      version: '1.0.0',
      purposes: mockPurposes,
    })),
  };
});

vi.mock('@dmnpc/data', () => ({
  PURPOSES_REGISTRY_PATH: '/mock/purposes.json',
  OBJECTS_DIR: '/mock/objects',
  SPRITE_REGISTRY_PATH: '/mock/sprite-registry.json',
}));

// Mock object catalog - 'seating' has objects; tag filtering handled by mock
vi.mock('../../src/place-layout/object-catalog.js', () => ({
  getEntitiesByPurpose: vi.fn((purpose: string, requiredTags?: string[]) => {
    if (purpose === 'seating') {
      const all = [
        { id: 'chair', name: 'Chair', description: 'A chair', width: 32, height: 32, tags: ['common', 'furniture'] },
        { id: 'ship_bench', name: 'Ship Bench', description: 'A bench', width: 32, height: 32, tags: ['common', 'ship'] },
      ];
      if (requiredTags && requiredTags.length > 0) {
        return all.filter((obj) => requiredTags.every((tag) => obj.tags.includes(tag)));
      }
      return all;
    }
    return [];
  }),
}));

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks
const { selectObjectWithoutLlm } = await import('../../src/place-layout/object-selector.js');
const { clearPurposeIdsCache } = await import('../../src/purpose-loader.js');

function createSlot(purpose: string, requiredTags?: string[]): GeneratedSlot {
  return { purpose: purpose as Purpose, x: 5, y: 5, width: 1, height: 1, category: 'object', facing: null, ...(requiredTags ? { requiredTags } : {}) };
}

function createContext(slotPurpose: string, requiredTags?: string[]) {
  return {
    slot: createSlot(slotPurpose, requiredTags),
    place: { id: 'PLACE_test', label: 'Test Place', description: 'A test place' } as Place,
    placeContext: { wealth: 'modest', cleanliness: 'clean', atmosphere: 'calm' } as PlaceContext,
    purpose: 'tavern' as Purpose,
    alreadyPlaced: [],
  };
}

describe('selectObjectWithoutLlm', () => {
  beforeEach(() => {
    clearPurposeIdsCache();
  });

  it('returns an object for a purpose with catalog matches', () => {
    const result = selectObjectWithoutLlm(createContext('seating'), 42);
    expect(['chair', 'ship_bench']).toContain(result.objectTypeId);
    expect(result.candidates).toHaveLength(2);
  });

  it('throws for object-category purpose with no catalog matches', () => {
    expect(() => selectObjectWithoutLlm(createContext('lighting'), 42)).toThrow(
      /No objects found for purpose "lighting"/
    );
  });

  it('throws for place-category purpose with no catalog matches (BUG-111)', () => {
    expect(() => selectObjectWithoutLlm(createContext('tavern'), 42)).toThrow(
      /No objects found for purpose "tavern"/
    );
  });

  it('throws for unknown object-category purpose with no catalog matches', () => {
    expect(() => selectObjectWithoutLlm(createContext('unknown_purpose'), 42)).toThrow(
      /No objects found for purpose "unknown_purpose"/
    );
  });

  it('passes requiredTags to getEntitiesByPurpose (FEAT-208)', () => {
    const result = selectObjectWithoutLlm(createContext('seating', ['ship']), 42);
    expect(result.objectTypeId).toBe('ship_bench');
    expect(result.candidates).toHaveLength(1);
  });

  it('returns all candidates when no requiredTags (FEAT-208)', () => {
    const result = selectObjectWithoutLlm(createContext('seating'), 42);
    expect(result.candidates).toHaveLength(2);
  });

  it('throws with tag info when requiredTags filter yields no candidates (FEAT-208)', () => {
    expect(() => selectObjectWithoutLlm(createContext('seating', ['nonexistent']), 42)).toThrow(
      /No objects found for purpose "seating" with required tags \[nonexistent\]/
    );
  });
});
