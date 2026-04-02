/**
 * Template Matcher Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  matchCharactersToTemplates,
  findTemplateMatch,
} from '@dmnpc/generation/template-matcher.js';
import type { WorldBible } from '@dmnpc/generation/document/document-processor.js';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';

// Mock the template character store
vi.mock('@dmnpc/core/stores/template-character-store.js', () => ({
  listTemplateCharacters: vi.fn(),
}));

import { listTemplateCharacters } from '@dmnpc/core/stores/template-character-store.js';

const mockListTemplateCharacters = vi.mocked(listTemplateCharacters);

// Sample template for testing
const mockTemplate: TemplateCharacterDefinition = {
  id: 'TEMPLATE_xanister_majere',
  label: 'Xanister Majere',
  description: 'A mysterious jester with pale grey eyes.',
  short_description: 'mysterious jester',
  personality: 'Hedonistic and charming.',
  backstoryThemes: ['mask vs authenticity'],
  physicalTraits: {
    gender: 'male',
    eyeColor: 'bright green',
    hairColor: 'silver-blond',
    race: 'humanoid',
    raceAdaptation: 'elvish-leaning',
  },
  voice: {
    voiceId: 'test-voice',
    voiceName: 'Test Voice',
    settings: { stability: 0.5, similarityBoost: 0.75 },
  },
};

const mockTemplate2: TemplateCharacterDefinition = {
  id: 'TEMPLATE_haplo_inkwell',
  label: 'Haplo Inkwell',
  description: 'A scholarly mage.',
  short_description: 'scholarly mage',
  personality: 'Curious and methodical.',
  backstoryThemes: ['knowledge'],
  physicalTraits: {
    gender: 'male',
    eyeColor: 'brown',
    hairColor: 'black',
    race: 'human',
  },
  voice: {
    voiceId: 'test-voice-2',
    voiceName: 'Test Voice 2',
    settings: { stability: 0.5, similarityBoost: 0.75 },
  },
};

describe('template-matcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('matchCharactersToTemplates', () => {
    it('matches character with exact name match', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const worldBible: WorldBible = {
        themes: ['adventure'],
        characters: [
          {
            name: 'Xanister Majere',
            description: 'A jester in the royal court.',
            temporalStatus: 'contemporary',
            activeEra: 'Third Age',
          },
        ],
        places: [],
        lore: '',
        rules: [],
        tone: 'fantasy',
        overview: '',
        keyConflicts: [],
        atmosphere: '',
        narrativePresent: 'Year 100',
        historicalLore: '',
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(1);
      expect(result.unmatched).toHaveLength(0);
      expect(result.matched[0].template.id).toBe('TEMPLATE_xanister_majere');
      expect(result.matched[0].confidence).toBe(1.0);
    });

    it('matches character with case-insensitive name', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'XANISTER MAJERE',
            description: 'A jester.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].confidence).toBe(1.0);
    });

    it('matches character with partial name (first name only)', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Xanister',
            description: 'A mysterious figure.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].confidence).toBeGreaterThan(0.7);
      expect(result.matched[0].confidence).toBeLessThan(1.0);
    });

    it('does not match unrelated characters', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Gandalf the Grey',
            description: 'A wizard.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0].name).toBe('Gandalf the Grey');
    });

    it('matches multiple characters to different templates', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate, mockTemplate2]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Xanister Majere',
            description: 'A jester.',
            temporalStatus: 'contemporary',
          },
          {
            name: 'Haplo Inkwell',
            description: 'A scholar.',
            temporalStatus: 'contemporary',
          },
          {
            name: 'Random NPC',
            description: 'An innkeeper.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(2);
      expect(result.unmatched).toHaveLength(1);
      expect(result.matched.map((m) => m.template.id)).toContain('TEMPLATE_xanister_majere');
      expect(result.matched.map((m) => m.template.id)).toContain('TEMPLATE_haplo_inkwell');
    });

    it('returns empty matched when no templates available', async () => {
      mockListTemplateCharacters.mockResolvedValue([]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Xanister',
            description: 'A jester.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
    });

    it('each template can only match one character', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Xanister Majere',
            description: 'The real Xanister.',
            temporalStatus: 'contemporary',
          },
          {
            name: 'Xanister',
            description: 'Also called Xanister.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      // Only the first (best match) should be matched
      expect(result.matched).toHaveLength(1);
      expect(result.unmatched).toHaveLength(1);
    });
  });

  describe('findTemplateMatch', () => {
    it('finds matching template for a character name', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate, mockTemplate2]);

      const result = await findTemplateMatch('Xanister Majere');

      expect(result).not.toBeNull();
      expect(result?.template.id).toBe('TEMPLATE_xanister_majere');
      expect(result?.confidence).toBe(1.0);
    });

    it('returns null for non-matching name', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const result = await findTemplateMatch('Unknown Character');

      expect(result).toBeNull();
    });

    it('handles partial name matches', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const result = await findTemplateMatch('Xanister');

      expect(result).not.toBeNull();
      expect(result?.template.id).toBe('TEMPLATE_xanister_majere');
      expect(result?.confidence).toBeGreaterThan(0.6);
    });
  });

  describe('last-name-only rejection', () => {
    it('does NOT match characters with same last name but different first names', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Ashina Majere',
            description: 'A different person who happens to share the last name.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0].name).toBe('Ashina Majere');
    });

    it('does NOT match when only last name is provided', async () => {
      mockListTemplateCharacters.mockResolvedValue([mockTemplate]);

      const result = await findTemplateMatch('Majere');

      expect(result).toBeNull();
    });

    it('correctly matches siblings with different first names to their own templates', async () => {
      const ashinaTemplate: TemplateCharacterDefinition = {
        id: 'TEMPLATE_ashina_majere',
        label: 'Ashina Majere',
        description: 'A noble mage.',
        short_description: 'noble mage',
        personality: 'Dignified and wise.',
        backstoryThemes: ['family legacy'],
        physicalTraits: {
          gender: 'female',
          eyeColor: 'grey',
          hairColor: 'black',
          race: 'elf',
        },
        voice: {
          voiceId: 'test-voice-3',
          voiceName: 'Test Voice 3',
          settings: { stability: 0.5, similarityBoost: 0.75 },
        },
      };

      mockListTemplateCharacters.mockResolvedValue([mockTemplate, ashinaTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Xanister Majere',
            description: 'The jester.',
            temporalStatus: 'contemporary',
          },
          {
            name: 'Ashina Majere',
            description: 'The mage.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(2);
      expect(result.unmatched).toHaveLength(0);

      const xanisterMatch = result.matched.find((m) => m.characterRef.name === 'Xanister Majere');
      const ashinaMatch = result.matched.find((m) => m.characterRef.name === 'Ashina Majere');

      expect(xanisterMatch?.template.id).toBe('TEMPLATE_xanister_majere');
      expect(ashinaMatch?.template.id).toBe('TEMPLATE_ashina_majere');
    });
  });

  describe('nickname matching', () => {
    const piprasTemplate: TemplateCharacterDefinition = {
      id: 'TEMPLATE_pipras_pennyroyal',
      label: 'Pipras Pennyroyal',
      description: 'A clever wanderer.',
      short_description: 'wiry clever wanderer',
      personality: 'Quick-witted and charming.',
      backstoryThemes: ['found family'],
      physicalTraits: {
        gender: 'male',
        eyeColor: 'blue',
        hairColor: 'blonde',
        race: 'elf',
      },
      voice: {
        voiceId: 'test-voice-4',
        voiceName: 'Test Voice 4',
        settings: { stability: 0.5, similarityBoost: 0.75 },
      },
    };

    it('matches name with nickname in double quotes to template', async () => {
      mockListTemplateCharacters.mockResolvedValue([piprasTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Pipras "Pip" Pennyroyal',
            description: 'A wanderer known as Pip.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].template.id).toBe('TEMPLATE_pipras_pennyroyal');
      expect(result.matched[0].confidence).toBe(1.0);
    });

    it('matches name with nickname in curly quotes to template', async () => {
      mockListTemplateCharacters.mockResolvedValue([piprasTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Pipras "Pip" Pennyroyal',
            description: 'A wanderer known as Pip.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].template.id).toBe('TEMPLATE_pipras_pennyroyal');
    });

    it('matches name with nickname in parentheses to template', async () => {
      mockListTemplateCharacters.mockResolvedValue([piprasTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Pipras (Pip) Pennyroyal',
            description: 'A wanderer known as Pip.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].template.id).toBe('TEMPLATE_pipras_pennyroyal');
    });

    it('does NOT match unrelated character with same nickname pattern', async () => {
      mockListTemplateCharacters.mockResolvedValue([piprasTemplate]);

      const worldBible: WorldBible = {
        themes: [],
        characters: [
          {
            name: 'Gerald "Gerry" Pennyroyal',
            description: 'A different Pennyroyal.',
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
      };

      const result = await matchCharactersToTemplates(worldBible);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
    });
  });
});
