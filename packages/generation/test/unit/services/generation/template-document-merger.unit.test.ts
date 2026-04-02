/**
 * Template Document Merger Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mergeCharacterSources,
  mergeAllMatches,
} from '@dmnpc/generation/document/template-document-merger.js';
import type { CharacterRef, TemplateMatch } from '@dmnpc/generation/template-matcher.js';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';
import type { Universe } from '@dmnpc/types/entity';

// Mock the OpenAI client
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn(),
}));

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';

const mockQueryLlm = vi.mocked(queryLlm);

// Sample template for testing
const mockTemplate: TemplateCharacterDefinition = {
  id: 'TEMPLATE_xanister_majere',
  label: 'Xanister Majere',
  description:
    'A mysterious, lithe elf with sharp features and pale grey eyes. Wears black and white motley.',
  short_description: 'mysterious jester',
  personality: 'Hedonistic and charming.',
  backstoryThemes: ['mask vs authenticity', 'self-made reinvention'],
  physicalTraits: {
    gender: 'male',
    eyeColor: 'bright green',
    hairColor: 'silver-blond',
    race: 'humanoid',
    raceAdaptation: 'elvish-leaning',
  },
  keyEvents: [
    {
      fact: 'Fled their homeland after a scandal.',
      category: 'world',
      significance: 'major',
    },
  ],
  voice: {
    voiceId: 'test-voice',
    voiceName: 'Test Voice',
    settings: { stability: 0.5, similarityBoost: 0.75 },
  },
};

const mockCharacterRef: CharacterRef = {
  name: 'Xanister Majere',
  description: 'The royal court jester who secretly manipulates nobles.',
  temporalStatus: 'contemporary',
  activeEra: 'Third Age',
};

const mockUniverse: Omit<Universe, 'characters' | 'places'> = {
  id: 'test_universe',
  name: 'Test Universe',
  version: '1.0.0',
  description: 'A test fantasy world.',
  custom: {},
  rules: 'Magic is common.',
  tone: 'Dark fantasy',
  style: 'Medieval fantasy',
  date: '01.01.100',
  races: [{ id: 'elf', label: 'Elf', description: 'Pointy-eared folk', rarity: 'common' }],
  rootPlaceId: 'PLACE_root',
};

describe('template-document-merger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mergeCharacterSources', () => {
    it('merges template and document data using LLM', async () => {
      const mockMergeResponse = {
        enhancedDescription:
          'A mysterious, lithe elf with sharp features and pale grey eyes, wearing the black and white motley of a court jester. In this realm, he serves as the royal court jester, secretly manipulating the nobles through whispered suggestions and well-timed jest.',
        enhancedShortDescription: 'manipulative court jester',
        additionalEvents: [
          {
            fact: 'Gained influence over several key nobles through blackmail.',
            category: 'relationship',
            significance: 'moderate',
          },
        ],
        eraContext: 'During the Third Age, jesters held unusual power in royal courts.',
      };

      mockQueryLlm.mockResolvedValueOnce({ content: mockMergeResponse });

      const result = await mergeCharacterSources(mockTemplate, mockCharacterRef, mockUniverse);

      expect(result.template).toBe(mockTemplate);
      expect(result.enhancedDescription).toBe(mockMergeResponse.enhancedDescription);
      expect(result.enhancedShortDescription).toBe(mockMergeResponse.enhancedShortDescription);
      expect(result.additionalEvents).toHaveLength(1);
      expect(result.additionalEvents[0].fact).toContain('blackmail');
      expect(result.eraContext).toBe(mockMergeResponse.eraContext);
      expect(result.documentContext.documentDescription).toBe(mockCharacterRef.description);
      expect(result.documentContext.temporalStatus).toBe('contemporary');
    });

    it('preserves template data on LLM failure', async () => {
      mockQueryLlm.mockRejectedValueOnce(new Error('LLM error'));

      const result = await mergeCharacterSources(mockTemplate, mockCharacterRef, mockUniverse);

      // Should fall back to template values
      expect(result.template).toBe(mockTemplate);
      expect(result.enhancedDescription).toBe(mockTemplate.description);
      expect(result.enhancedShortDescription).toBe(mockTemplate.short_description);
      expect(result.additionalEvents).toHaveLength(0);
      expect(result.documentContext.documentDescription).toBe(mockCharacterRef.description);
    });

    it('includes document context in result', async () => {
      const mockMergeResponse = {
        enhancedDescription: 'Enhanced description.',
        enhancedShortDescription: 'short desc',
        additionalEvents: [],
        eraContext: '',
      };

      mockQueryLlm.mockResolvedValueOnce({ content: mockMergeResponse });

      const charRefWithEra: CharacterRef = {
        name: 'Xanister',
        description: 'A jester in the court.',
        temporalStatus: 'historical',
        activeEra: 'Second Age',
      };

      const result = await mergeCharacterSources(mockTemplate, charRefWithEra, mockUniverse);

      expect(result.documentContext).toEqual({
        documentDescription: 'A jester in the court.',
        temporalStatus: 'historical',
        activeEra: 'Second Age',
      });
    });

    it('passes correct context to LLM', async () => {
      const mockMergeResponse = {
        enhancedDescription: 'Enhanced.',
        enhancedShortDescription: 'short',
        additionalEvents: [],
        eraContext: '',
      };

      mockQueryLlm.mockResolvedValueOnce({ content: mockMergeResponse });

      await mergeCharacterSources(mockTemplate, mockCharacterRef, mockUniverse);

      expect(mockQueryLlm).toHaveBeenCalledTimes(1);
      const callArgs = mockQueryLlm.mock.calls[0][0];

      // Check system prompt contains universe info
      expect(callArgs.system).toContain(mockUniverse.name);
      expect(callArgs.system).toContain(mockUniverse.tone);

      // Check user prompt contains template and document info
      expect(callArgs.prompt).toContain(mockTemplate.label);
      expect(callArgs.prompt).toContain(mockTemplate.description);
      expect(callArgs.prompt).toContain(mockCharacterRef.description);
    });
  });

  describe('mergeAllMatches', () => {
    it('merges multiple matches', async () => {
      const mockMergeResponse = {
        enhancedDescription: 'Enhanced description.',
        enhancedShortDescription: 'short desc',
        additionalEvents: [],
        eraContext: '',
      };

      mockQueryLlm.mockResolvedValue({ content: mockMergeResponse });

      const matches: TemplateMatch[] = [
        {
          template: mockTemplate,
          characterRef: mockCharacterRef,
          confidence: 1.0,
        },
        {
          template: {
            ...mockTemplate,
            id: 'TEMPLATE_other',
            label: 'Other Character',
          },
          characterRef: {
            name: 'Other',
            description: 'Another character.',
            temporalStatus: 'contemporary',
          },
          confidence: 0.9,
        },
      ];

      const results = await mergeAllMatches(matches, mockUniverse);

      expect(results).toHaveLength(2);
      expect(mockQueryLlm).toHaveBeenCalledTimes(2);
    });

    it('continues on individual merge failure', async () => {
      const mockMergeResponse = {
        enhancedDescription: 'Enhanced.',
        enhancedShortDescription: 'short',
        additionalEvents: [],
        eraContext: '',
      };

      // First call fails, second succeeds
      mockQueryLlm
        .mockRejectedValueOnce(new Error('First merge failed'))
        .mockResolvedValueOnce({ content: mockMergeResponse });

      const matches: TemplateMatch[] = [
        {
          template: mockTemplate,
          characterRef: mockCharacterRef,
          confidence: 1.0,
        },
        {
          template: {
            ...mockTemplate,
            id: 'TEMPLATE_other',
            label: 'Other Character',
          },
          characterRef: {
            name: 'Other',
            description: 'Another character.',
            temporalStatus: 'contemporary',
          },
          confidence: 0.9,
        },
      ];

      const results = await mergeAllMatches(matches, mockUniverse);

      // Both should succeed - first one falls back to template
      expect(results).toHaveLength(2);
    });

    it('returns empty array for empty matches', async () => {
      const results = await mergeAllMatches([], mockUniverse);

      expect(results).toHaveLength(0);
      expect(mockQueryLlm).not.toHaveBeenCalled();
    });
  });
});
