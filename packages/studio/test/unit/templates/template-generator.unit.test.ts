/**
 * Unit tests for Template Character Generator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateTemplateCharacter } from '@dmnpc/studio/templates/template-generator.js';
import * as openaiClient from '@dmnpc/core/clients/openai-client.js';

// Mock OpenAI
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn(),
}));

// Mock generation context
vi.mock('@dmnpc/generation/generation-context.js', () => ({
  buildExistingTemplatesContext: vi.fn().mockResolvedValue(''),
}));

describe('generateTemplateCharacter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a template with proper structure', async () => {
    const mockGenerated = {
      label: 'Marcus Ironforge',
      description:
        'A broad-shouldered man with weathered skin and calloused hands. Deep-set gray eyes hold the weight of many battles.',
      short_description: 'grizzled blacksmith',
      personality:
        'Stoic and protective, he believes in earning respect through hard work. Slow to trust but fiercely loyal once won over.',
      backstoryThemes: ['redemption', 'duty', 'loss'],
      physicalTraits: {
        gender: 'male',
        eyeColor: 'gray',
        hairColor: 'iron-gray',
        race: 'human',
        raceAdaptation: 'human-like',
      },
      keyEvents: [
        {
          subject: 'Marcus',
          fact: 'Lost his family in a great conflict',
          category: 'world',
          significance: 'major',
        },
        {
          subject: 'Marcus',
          fact: 'Swore an oath to protect the innocent',
          category: 'knowledge',
          significance: 'major',
        },
      ],
    };

    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: mockGenerated,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    });

    const result = await generateTemplateCharacter({
      archetype: 'grizzled warrior',
      backstoryThemes: ['redemption'],
    });

    expect(result).toBeDefined();
    expect(result.id).toBe('TEMPLATE_marcus_ironforge');
    expect(result.label).toBe('Marcus Ironforge');
    expect(result.description).toContain('weathered skin');
    expect(result.short_description).toBe('grizzled blacksmith');
    expect(result.personality).toContain('Stoic and protective');
    expect(result.backstoryThemes).toEqual(['redemption', 'duty', 'loss']);
    expect(result.physicalTraits).toEqual({
      gender: 'male',
      eyeColor: 'gray',
      hairColor: 'iron-gray',
      race: 'human',
      raceAdaptation: 'human-like',
    });
    expect(result.keyEvents).toHaveLength(2);
  });

  it('truncates short_description if too long', async () => {
    const mockGenerated = {
      label: 'Test Character',
      description: 'A test character description.',
      short_description: 'this is a very long short description that exceeds thirty characters',
      personality: 'Test personality.',
      backstoryThemes: ['test'],
      physicalTraits: {
        gender: 'female',
        eyeColor: 'blue',
        hairColor: 'blonde',
        raceAdaptation: 'human-like',
      },
      keyEvents: [],
    };

    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: mockGenerated,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    });

    const result = await generateTemplateCharacter();

    expect(result.short_description.length).toBeLessThanOrEqual(30);
    expect(result.short_description).toBe('this is a very long short d...');
  });

  it('generates template with no hints', async () => {
    const mockGenerated = {
      label: 'Random Character',
      description: 'A randomly generated character.',
      short_description: 'mysterious figure',
      personality: 'Enigmatic and unpredictable.',
      backstoryThemes: ['mystery', 'adventure'],
      physicalTraits: {
        gender: 'non-binary',
        eyeColor: 'violet',
        hairColor: 'silver',
        raceAdaptation: 'elvish',
      },
      keyEvents: [],
    };

    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: mockGenerated,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    });

    const result = await generateTemplateCharacter();

    expect(result).toBeDefined();
    expect(result.id).toBe('TEMPLATE_random_character');
    expect(result.label).toBe('Random Character');
  });

  it('generates template with name hint', async () => {
    const mockGenerated = {
      label: 'Suggested Name',
      description: 'A character with the suggested name.',
      short_description: 'named character',
      personality: 'As named.',
      backstoryThemes: [],
      physicalTraits: {
        gender: 'male',
        eyeColor: 'brown',
        hairColor: 'black',
        raceAdaptation: 'human-like',
      },
      keyEvents: [],
    };

    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: mockGenerated,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    });

    const result = await generateTemplateCharacter({ name: 'Suggested Name' });

    expect(result.label).toBe('Suggested Name');
  });
});
