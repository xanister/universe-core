/**
 * World Bible Merger Unit Tests
 *
 * Tests for the intelligent merging of WorldBibles.
 * LLM calls are mocked to test the merge logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeWorldBibles } from '@dmnpc/generation/place/world-bible-merger.js';
import type { WorldBible } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// Mock the LLM client
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn().mockImplementation(async ({ prompt }) => {
    // Simple mock: just concatenate the two versions
    // In real use, the LLM would intelligently synthesize
    return { content: { merged: 'Merged text from LLM' } };
  }),
}));

// Mock the logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('WorldBibleMerger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mergeWorldBibles', () => {
    it('returns document WorldBible when existing is null', async () => {
      const fromDocuments: WorldBible = {
        themes: ['adventure', 'mystery'],
        characters: [
          {
            name: 'Alice',
            description: 'A brave explorer',
            temporalStatus: 'contemporary',
          },
        ],
        places: [
          {
            name: 'The Tavern',
            description: 'A cozy tavern',
            isSuitableStart: true,
            environment: ENVIRONMENT_PRESETS.interior(),
          },
        ],
        lore: 'Ancient lore',
        rules: ['No magic after dark'],
        tone: 'Dark fantasy',
        overview: 'A world of mystery',
        keyConflicts: ['War brewing'],
        atmosphere: 'Mysterious',
        narrativePresent: 'Third Age',
        historicalLore: 'Long ago...',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(null, fromDocuments);

      expect(result.worldBible).toEqual(fromDocuments);
      expect(result.stats.newCharacters).toBe(1);
      expect(result.stats.newPlaces).toBe(1);
      expect(result.stats.updatedCharacters).toBe(0);
      expect(result.stats.updatedPlaces).toBe(0);
    });

    it('merges characters by name, preferring document descriptions', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Alice',
            description: 'Old description',
            temporalStatus: 'contemporary',
            aliases: ['Ali'],
          },
        ],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Alice',
            description: 'New description from documents',
            temporalStatus: 'contemporary',
            aliases: ['Alicia'],
          },
        ],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      expect(result.worldBible.characters).toHaveLength(1);
      expect(result.worldBible.characters[0].description).toBe('New description from documents');
      // Aliases should be merged
      expect(result.worldBible.characters[0].aliases).toContain('Ali');
      expect(result.worldBible.characters[0].aliases).toContain('Alicia');
      expect(result.stats.updatedCharacters).toBe(1);
      expect(result.stats.newCharacters).toBe(0);
    });

    it('matches characters by alias', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Robert',
            description: 'A knight',
            temporalStatus: 'contemporary',
            aliases: ['Bob', 'Bobby'],
          },
        ],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Bob', // Matches existing alias
            description: 'Updated knight description',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      expect(result.worldBible.characters).toHaveLength(1);
      expect(result.worldBible.characters[0].name).toBe('Bob'); // Document name preferred
      expect(result.worldBible.characters[0].description).toBe('Updated knight description');
      expect(result.stats.updatedCharacters).toBe(1);
    });

    it('adds new characters from documents', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Alice',
            description: 'Existing character',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Bob', // New character
            description: 'A new character',
            temporalStatus: 'contemporary',
          },
        ],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      expect(result.worldBible.characters).toHaveLength(2);
      expect(result.worldBible.characters.find((c) => c.name === 'Alice')).toBeDefined();
      expect(result.worldBible.characters.find((c) => c.name === 'Bob')).toBeDefined();
      expect(result.stats.newCharacters).toBe(1);
    });

    it('merges places by name, preferring document descriptions', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [],
        places: [
          {
            name: 'The Tavern',
            description: 'Old description',
            isSuitableStart: false,
            environment: ENVIRONMENT_PRESETS.interior(),
          },
        ],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [],
        places: [
          {
            name: 'The Tavern',
            description: 'New description from documents',
            isSuitableStart: true,
            environment: ENVIRONMENT_PRESETS.interior(),
          },
        ],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      expect(result.worldBible.places).toHaveLength(1);
      expect(result.worldBible.places[0].description).toBe('New description from documents');
      expect(result.worldBible.places[0].isSuitableStart).toBe(true);
      expect(result.stats.updatedPlaces).toBe(1);
    });

    it('deduplicates themes, rules, and conflicts', async () => {
      const existing: WorldBible = {
        themes: ['adventure', 'mystery'],
        characters: [],
        places: [],
        lore: '',
        rules: ['Rule 1', 'Rule 2'],
        tone: '',
        overview: '',
        keyConflicts: ['Conflict A'],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: ['mystery', 'horror'], // mystery is duplicate
        characters: [],
        places: [],
        lore: '',
        rules: ['Rule 2', 'Rule 3'], // Rule 2 is duplicate
        tone: '',
        overview: '',
        keyConflicts: ['Conflict A', 'Conflict B'], // Conflict A is duplicate
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      expect(result.worldBible.themes).toHaveLength(3);
      expect(result.worldBible.themes).toContain('adventure');
      expect(result.worldBible.themes).toContain('mystery');
      expect(result.worldBible.themes).toContain('horror');

      expect(result.worldBible.rules).toHaveLength(3);
      expect(result.worldBible.rules).toContain('Rule 1');
      expect(result.worldBible.rules).toContain('Rule 2');
      expect(result.worldBible.rules).toContain('Rule 3');

      expect(result.worldBible.keyConflicts).toHaveLength(2);
      expect(result.worldBible.keyConflicts).toContain('Conflict A');
      expect(result.worldBible.keyConflicts).toContain('Conflict B');
    });

    it('uses document version when existing text field is empty', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: 'New lore from documents',
        rules: [],
        tone: 'Dark fantasy',
        overview: 'A world overview',
        keyConflicts: [],
        atmosphere: 'Gloomy',
        narrativePresent: 'Third Age',
        historicalLore: 'Ancient history',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      expect(result.worldBible.lore).toBe('New lore from documents');
      expect(result.worldBible.tone).toBe('Dark fantasy');
      expect(result.worldBible.overview).toBe('A world overview');
      expect(result.worldBible.atmosphere).toBe('Gloomy');
      expect(result.worldBible.narrativePresent).toBe('Third Age');
      expect(result.worldBible.historicalLore).toBe('Ancient history');
    });

    it('keeps existing text when document version is empty', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: 'Existing lore',
        rules: [],
        tone: 'Epic fantasy',
        overview: 'Existing overview',
        keyConflicts: [],
        atmosphere: 'Bright',
        narrativePresent: 'Second Age',
        historicalLore: 'Old history',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [],
        places: [],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      expect(result.worldBible.lore).toBe('Existing lore');
      expect(result.worldBible.tone).toBe('Epic fantasy');
      expect(result.worldBible.overview).toBe('Existing overview');
      expect(result.worldBible.atmosphere).toBe('Bright');
      expect(result.worldBible.narrativePresent).toBe('Second Age');
      expect(result.worldBible.historicalLore).toBe('Old history');
    });

    it('preserves unmatched existing entities', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Alice',
            description: 'Existing character',
            temporalStatus: 'contemporary',
          },
        ],
        places: [
          {
            name: 'Old Town',
            description: 'An old town',
            environment: ENVIRONMENT_PRESETS.exterior(),
          },
        ],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Bob', // Different character
            description: 'New character',
            temporalStatus: 'contemporary',
          },
        ],
        places: [
          {
            name: 'New Town', // Different place
            description: 'A new town',
            environment: ENVIRONMENT_PRESETS.exterior(),
          },
        ],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      // Both old and new entities should be present
      expect(result.worldBible.characters).toHaveLength(2);
      expect(result.worldBible.characters.find((c) => c.name === 'Alice')).toBeDefined();
      expect(result.worldBible.characters.find((c) => c.name === 'Bob')).toBeDefined();

      expect(result.worldBible.places).toHaveLength(2);
      expect(result.worldBible.places.find((p) => p.name === 'Old Town')).toBeDefined();
      expect(result.worldBible.places.find((p) => p.name === 'New Town')).toBeDefined();
    });

    it('handles case-insensitive name matching', async () => {
      const existing: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'ALICE',
            description: 'Existing',
            temporalStatus: 'contemporary',
          },
        ],
        places: [
          {
            name: 'THE TAVERN',
            description: 'Existing',
            environment: ENVIRONMENT_PRESETS.interior(),
          },
        ],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const fromDocuments: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'alice', // Same name, different case
            description: 'New description',
            temporalStatus: 'contemporary',
          },
        ],
        places: [
          {
            name: 'the tavern', // Same name, different case
            description: 'New description',
            environment: ENVIRONMENT_PRESETS.interior(),
          },
        ],
        lore: '',
        rules: [],
        tone: '',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: '',
        historicalLore: '',
        historicalEvents: [],
      };

      const result = await mergeWorldBibles(existing, fromDocuments);

      // Should match and update, not create duplicates
      expect(result.worldBible.characters).toHaveLength(1);
      expect(result.worldBible.places).toHaveLength(1);

      expect(result.stats.updatedCharacters).toBe(1);
      expect(result.stats.updatedPlaces).toBe(1);
      expect(result.stats.newCharacters).toBe(0);
      expect(result.stats.newPlaces).toBe(0);
    });
  });
});
