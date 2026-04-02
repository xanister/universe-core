/**
 * Unit tests for purpose-driven interaction type resolution.
 *
 * FEAT-071: interactionType renamed to interactionTypeId; family removed.
 * The purpose-loader resolves interaction type IDs from purpose definitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the purpose registry data (new format: interactionTypeId, no family)
const mockPurposes = [
  { id: 'exit', label: 'Exit', description: '', category: 'object', interactionTypeId: 'enter', defaultActivityId: null, defaultSchedule: null, system: true },
  { id: 'vessel_helm', label: 'Vessel Helm', description: '', category: 'object', interactionTypeId: 'helm', defaultActivityId: null, defaultSchedule: null, system: true },
  { id: 'airlock', label: 'Airlock', description: '', category: 'object', interactionTypeId: 'dock_enter', defaultActivityId: null, defaultSchedule: null, system: true },
  { id: 'gangplank', label: 'Gangplank', description: '', category: 'object', interactionTypeId: 'dock_enter', defaultActivityId: null, defaultSchedule: null, system: true },
  { id: 'seating', label: 'Seating', description: '', category: 'object', interactionTypeId: null, defaultActivityId: null, defaultSchedule: null, system: false },
  { id: 'decoration', label: 'Decoration', description: '', category: 'object', interactionTypeId: null, defaultActivityId: null, defaultSchedule: null, system: true },
  { id: 'tavern', label: 'Tavern', description: '', category: 'place', interactionTypeId: null, defaultActivityId: null, defaultSchedule: null, system: false },
  { id: 'bartender', label: 'Bartender', description: '', category: 'character', interactionTypeId: 'talk', defaultActivityId: 'tavern_work', defaultSchedule: { dawn: 'home', morning: 'work', afternoon: 'work', evening: 'work', night: 'home' }, system: false },
];

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
    version: '1.0.0',
    purposes: mockPurposes,
  })),
}));

vi.mock('@dmnpc/data', () => ({
  PURPOSES_REGISTRY_PATH: '/mock/purposes.json',
}));

// Import after mocks are set up
const { loadInteractionTypeIdForPurpose, loadPurposeCategory, loadPurposeDefinition, clearPurposeIdsCache } = await import(
  '../../src/purpose-loader.js'
);

describe('loadInteractionTypeIdForPurpose', () => {
  beforeEach(() => {
    clearPurposeIdsCache();
  });

  it('returns "enter" for exit purpose', () => {
    expect(loadInteractionTypeIdForPurpose('exit')).toBe('enter');
  });

  it('returns "helm" for vessel_helm purpose', () => {
    expect(loadInteractionTypeIdForPurpose('vessel_helm')).toBe('helm');
  });

  it('returns "dock_enter" for airlock purpose', () => {
    expect(loadInteractionTypeIdForPurpose('airlock')).toBe('dock_enter');
  });

  it('returns "dock_enter" for gangplank purpose', () => {
    expect(loadInteractionTypeIdForPurpose('gangplank')).toBe('dock_enter');
  });

  it('returns null for non-interactive purposes', () => {
    expect(loadInteractionTypeIdForPurpose('seating')).toBeNull();
    expect(loadInteractionTypeIdForPurpose('decoration')).toBeNull();
  });

  it('returns null for place purposes', () => {
    expect(loadInteractionTypeIdForPurpose('tavern')).toBeNull();
  });

  it('returns null for unknown purposes', () => {
    expect(loadInteractionTypeIdForPurpose('nonexistent')).toBeNull();
  });

  it('returns "talk" for character purposes', () => {
    expect(loadInteractionTypeIdForPurpose('bartender')).toBe('talk');
  });

  it('caches results across calls in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { readFileSync } = await import('fs');
      const mockReadFileSync = vi.mocked(readFileSync);
      mockReadFileSync.mockClear();

      loadInteractionTypeIdForPurpose('airlock');
      loadInteractionTypeIdForPurpose('airlock');

      // Should only read once due to caching in production
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe('loadPurposeCategory', () => {
  beforeEach(() => {
    clearPurposeIdsCache();
  });

  it('returns "object" for object purposes', () => {
    expect(loadPurposeCategory('seating')).toBe('object');
  });

  it('returns "place" for place purposes', () => {
    expect(loadPurposeCategory('tavern')).toBe('place');
  });

  it('returns "character" for character purposes', () => {
    expect(loadPurposeCategory('bartender')).toBe('character');
  });

  it('returns null for unknown purposes', () => {
    expect(loadPurposeCategory('nonexistent')).toBeNull();
  });
});

describe('loadPurposeDefinition', () => {
  beforeEach(() => {
    clearPurposeIdsCache();
  });

  it('returns full definition for a known purpose', () => {
    const def = loadPurposeDefinition('bartender');
    expect(def).not.toBeNull();
    expect(def!.id).toBe('bartender');
    expect(def!.category).toBe('character');
    expect(def!.defaultActivityId).toBe('tavern_work');
    expect(def!.defaultSchedule).toEqual({
      dawn: 'home', morning: 'work', afternoon: 'work', evening: 'work', night: 'home',
    });
  });

  it('returns null for an unknown purpose', () => {
    expect(loadPurposeDefinition('nonexistent')).toBeNull();
  });

  it('returns definition with null schedule for non-character purposes', () => {
    const def = loadPurposeDefinition('seating');
    expect(def).not.toBeNull();
    expect(def!.defaultActivityId).toBeNull();
    expect(def!.defaultSchedule).toBeNull();
  });
});
