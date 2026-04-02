import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockQueryLlmSchemaResponse } from '@dmnpc/core/test-helpers/index.js';
import type { Character, Place, Universe } from '@dmnpc/types/entity';
import type { StorytellerDefinition } from '@dmnpc/types/npc';

const { queryLlmMock } = vi.hoisted(() => ({
  queryLlmMock: vi.fn(),
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: queryLlmMock,
}));

import { generateStartingSituation } from '@dmnpc/generation/starting-situation-generator.js';

describe('starting-situation-generator', () => {
  const mockUniverse: Universe = {
    id: 'test_universe',
    name: 'Test Universe',
    description: 'A fantasy world for testing',
    tone: 'Adventurous and mysterious',
    rules: 'Magic exists but is rare',
    date: '01.01.1477 4A',
    rootPlaceId: 'PLACE_tavern',
  };

  const mockCharacter: Character = {
    id: 'CHAR_test',
    label: 'Test Hero',
    description: 'A brave adventurer',
    entityType: 'character',
    info: {
      aliases: [],
      birthdate: 'Year 1450, 4th Age',
      birthPlace: 'Unknown village',
      race: 'Human',
      personality: 'Curious and brave',
    },
  };

  const mockPlace: Place = {
    id: 'PLACE_tavern',
    label: 'The Golden Mug',
    description: 'A cozy tavern at the crossroads',
    entityType: 'place',
  };

  const mockStoryteller: StorytellerDefinition = {
    id: 'STORYTELLER_classic',
    label: 'Classic Adventure',
    description: 'Traditional fantasy storytelling with a sense of wonder',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a starting situation with narrative and events', async () => {
    const mockLlmResponse = {
      narrative: 'You find yourself in the warmth of The Golden Mug...',
      characterState: 'Curious and slightly disoriented',
      initialEvents: [{ content: 'Arrived at the tavern yesterday', importance: 'minor' as const }],
      initialKnowledge: [
        { content: 'The barkeep seems friendly', category: 'relationship' as const },
      ],
    };

    queryLlmMock.mockResolvedValueOnce(mockQueryLlmSchemaResponse(mockLlmResponse));

    const result = await generateStartingSituation({
      universe: mockUniverse,
      character: mockCharacter,
      place: mockPlace,
      storyteller: mockStoryteller,
    });

    expect(result.narrative).toBe('You find yourself in the warmth of The Golden Mug...');
    expect(result.characterState).toBe('Curious and slightly disoriented');
    expect(result.initialEvents).toHaveLength(1);
    expect(result.initialKnowledge).toHaveLength(1);
  });

  it('converts LLM response to proper Fact structure', async () => {
    const mockLlmResponse = {
      narrative: 'The adventure begins...',
      characterState: 'Ready for action',
      initialEvents: [
        { content: 'Left home to seek fortune', importance: 'major' as const },
        { content: 'Heard rumors of treasure nearby', importance: 'moderate' as const },
      ],
      initialKnowledge: [
        { content: 'The locals speak of ancient ruins', category: 'world' as const },
        {
          content: 'A mysterious stranger watches from the corner',
          category: 'knowledge' as const,
        },
      ],
    };

    queryLlmMock.mockResolvedValueOnce(mockQueryLlmSchemaResponse(mockLlmResponse));

    const result = await generateStartingSituation({
      universe: mockUniverse,
      character: mockCharacter,
      place: mockPlace,
    });

    // Check key events are converted to Facts
    expect(result.initialEvents).toHaveLength(2);
    expect(result.initialEvents![0]).toMatchObject({
      category: 'world',
      subject: 'Background',
      fact: 'Left home to seek fortune',
      significance: 'major',
    });

    // Check knowledge is converted to Facts
    expect(result.initialKnowledge).toHaveLength(2);
    expect(result.initialKnowledge![0]).toMatchObject({
      category: 'world',
      subject: 'Current Situation',
      fact: 'The locals speak of ancient ruins',
      significance: 'minor',
    });
  });

  it('works without a storyteller', async () => {
    const mockLlmResponse = {
      narrative: 'A simple beginning...',
      characterState: 'Neutral',
      initialEvents: [],
      initialKnowledge: [],
    };

    queryLlmMock.mockResolvedValueOnce(mockQueryLlmSchemaResponse(mockLlmResponse));

    const result = await generateStartingSituation({
      universe: mockUniverse,
      character: mockCharacter,
      place: mockPlace,
      // no storyteller
    });

    expect(result.narrative).toBe('A simple beginning...');
  });

  it('passes context to queryLlm', async () => {
    const mockLlmResponse = {
      narrative: 'Test narrative',
      characterState: 'Test state',
      initialEvents: [],
      initialKnowledge: [],
    };

    queryLlmMock.mockResolvedValueOnce(mockQueryLlmSchemaResponse(mockLlmResponse));

    await generateStartingSituation({
      universe: mockUniverse,
      character: mockCharacter,
      place: mockPlace,
      storyteller: mockStoryteller,
    });

    expect(queryLlmMock).toHaveBeenCalledTimes(1);
    const callArgs = queryLlmMock.mock.calls[0][0];

    // Check system prompt includes universe info
    expect(callArgs.system).toContain('narrative designer');

    // Check user prompt includes character and place
    expect(callArgs.prompt).toContain(mockCharacter.label);
    expect(callArgs.prompt).toContain(mockPlace.label);

    // Check schema is provided
    expect(callArgs.schema).toBeDefined();
    expect(callArgs.schema.name).toBe('starting_situation_schema');
  });

  it('throws when LLM returns null content', async () => {
    queryLlmMock.mockResolvedValueOnce({ content: null });

    await expect(
      generateStartingSituation({
        universe: mockUniverse,
        character: mockCharacter,
        place: mockPlace,
      })
    ).rejects.toThrow();
  });

  it('includes storyteller guidance in prompt when provided', async () => {
    const mockLlmResponse = {
      narrative: 'Test',
      characterState: 'Test',
      initialEvents: [],
      initialKnowledge: [],
    };

    queryLlmMock.mockResolvedValueOnce(mockQueryLlmSchemaResponse(mockLlmResponse));

    await generateStartingSituation({
      universe: mockUniverse,
      character: mockCharacter,
      place: mockPlace,
      storyteller: mockStoryteller,
    });

    const callArgs = queryLlmMock.mock.calls[0][0];
    expect(callArgs.system).toContain(mockStoryteller.label);
    expect(callArgs.system).toContain(mockStoryteller.description);
  });

  it('handles character without optional fields', async () => {
    const minimalCharacter: Character = {
      id: 'CHAR_minimal',
      label: 'Minimal Hero',
      description: 'Just a description',
      entityType: 'character',
      info: {
        aliases: [],
        birthdate: '',
        birthPlace: '',
      },
    };

    const mockLlmResponse = {
      narrative: 'Minimal narrative',
      characterState: 'Unknown',
      initialEvents: [],
      initialKnowledge: [],
    };

    queryLlmMock.mockResolvedValueOnce(mockQueryLlmSchemaResponse(mockLlmResponse));

    const result = await generateStartingSituation({
      universe: mockUniverse,
      character: minimalCharacter,
      place: mockPlace,
    });

    expect(result.narrative).toBe('Minimal narrative');
  });
});
