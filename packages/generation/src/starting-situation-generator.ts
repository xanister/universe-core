/**
 * Starting Situation Generator
 *
 * Generates contextual StartingSituation based on:
 * - Universe lore/setting
 * - Character background
 * - Starting place
 * - Storyteller tone/style
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import {
  buildVerbosityGuidance,
  calculateVerbosityTokens,
} from '@dmnpc/core/prompts/verbosity-utils.js';
import { generateEventId } from '@dmnpc/core/universe/universe-store.js';
import type { StartingSituation, StorytellerDefinition } from '@dmnpc/types/npc';
import type { Character, Place, Universe, Fact, UniverseEvent } from '@dmnpc/types/entity';

export interface GenerateStartingSituationParams {
  /** The universe context */
  universe: Universe;
  /** The player character */
  character: Character;
  /** The starting place */
  place: Place;
  /** Optional storyteller for tone guidance */
  storyteller?: StorytellerDefinition;
}

interface GeneratedSituation {
  narrative: string;
  characterState: string;
  initialEvents: Array<{
    content: string;
    importance: 'minor' | 'moderate' | 'major';
  }>;
  initialKnowledge: Array<{
    content: string;
    category: 'world' | 'relationship' | 'knowledge';
  }>;
}

/**
 * Generate a contextual starting situation for a character in a universe.
 * Creates narrative, key events, and initial knowledge that fit the setting.
 */
export async function generateStartingSituation(
  params: GenerateStartingSituationParams,
): Promise<StartingSituation> {
  const { universe, character, place, storyteller } = params;

  logger.info(
    'StartingSituationGenerator',
    `Generating starting situation: universeId=${universe.id} characterId=${character.id} placeId=${place.id}`,
  );

  // Build context about the universe
  const universeContext = [
    `Universe: ${universe.name}`,
    universe.description ? `Setting: ${universe.description}` : '',
    universe.tone ? `Tone: ${universe.tone}` : '',
    universe.rules ? `World Rules: ${universe.rules}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Build context about the character
  const characterContext = [
    `Character: ${character.label}`,
    character.description ? `Description: ${character.description}` : '',
    character.info.race ? `Race: ${character.info.race}` : '',
    character.info.personality ? `Personality: ${character.info.personality}` : '',
    character.info.birthPlace ? `Birth Place: ${character.info.birthPlace}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Build context about the starting place
  const placeContext = [
    `Starting Location: ${place.label}`,
    place.description ? `Location Description: ${place.description}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Build storyteller guidance if available
  const storytellerContext = storyteller
    ? [
        `Storyteller Style: ${storyteller.label}`,
        storyteller.description ? `Narrative Approach: ${storyteller.description}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  // Build verbosity guidance from storyteller
  const verbosityGuidance = buildVerbosityGuidance(storyteller?.verbosity ?? undefined);

  const systemPrompt = `You are a narrative designer creating a simple starting situation for a role-playing game.

Your task is to generate a brief starting situation that:
1. Naturally places the character in the starting location
2. Provides basic context for why they are there
3. Fits the universe's tone and setting

IMPORTANT: This is just an introduction to the setting. Do NOT create story hooks or plot elements.
The storyteller will add those separately during the opening event.

WRITING STYLE:
- Write the narrative in second person, present tense ("You find yourself...")
- Keep it short and simple (1-2 paragraphs)
- Focus on grounding the character in their immediate surroundings

KEY EVENTS:
- These are recent events that brought the character to this moment
- Should be 1-2 events that explain their current situation
- Write as objective facts about what happened TO them

INITIAL KNOWLEDGE:
- These are things the character knows or has just noticed
- Should be 1-3 observations/memories relevant to their situation
- Write from the character's perspective (what they understand)

${storytellerContext ? `\nNARRATIVE GUIDANCE:\n${storytellerContext}` : ''}${verbosityGuidance ? `\n\n${verbosityGuidance}` : ''}`;

  const userPrompt = `Generate a simple starting situation for this character:

${universeContext}

${characterContext}

${placeContext}

Create a brief introduction that places this character in this location. Just introduce them to the setting - no story hooks or plot elements.`;

  // Scale token limits by verbosity (0.7x to 1.0x, floor of 800)
  const maxTokens = calculateVerbosityTokens(1500, storyteller?.verbosity ?? undefined);

  try {
    const result = await queryLlm<GeneratedSituation>({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'reasoning',
      context: 'Starting Situation Generator',
      maxTokensOverride: maxTokens,
      schema: {
        name: 'starting_situation_schema',
        schema: {
          type: 'object',
          properties: {
            narrative: {
              type: 'string',
              description: 'Brief opening narrative in second person, 1-2 paragraphs',
            },
            characterState: {
              type: 'string',
              description: 'Brief description of character emotional/psychological state',
            },
            initialEvents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: {
                    type: 'string',
                    description: 'The event that happened to the character',
                  },
                  importance: {
                    type: 'string',
                    enum: ['minor', 'moderate', 'major'],
                    description: 'How significant this event is',
                  },
                },
                required: ['content', 'importance'],
                additionalProperties: false,
              },
              description: '1-3 recent events that explain the situation',
            },
            initialKnowledge: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: {
                    type: 'string',
                    description: 'What the character knows or has noticed',
                  },
                  category: {
                    type: 'string',
                    enum: ['world', 'relationship', 'knowledge'],
                    description:
                      'Type of knowledge: world (facts about setting), relationship (connections to others), knowledge (learned information)',
                  },
                },
                required: ['content', 'category'],
                additionalProperties: false,
              },
              description: '2-4 pieces of initial knowledge',
            },
          },
          required: ['narrative', 'characterState', 'initialEvents', 'initialKnowledge'],
          additionalProperties: false,
        },
      },
    });

    const generated = result.content;

    // Convert to StartingSituation format - create UniverseEvents with generated IDs
    const initialEvents: UniverseEvent[] = generated.initialEvents.map((event) => ({
      id: generateEventId(event.content),
      date: null,
      placeId: null,
      eventType: null,
      category: 'world' as const,
      subject: 'Background',
      subjectId: null,
      fact: event.content,
      significance: event.importance,
      important: true, // Starting situation events should survive reset
      witnessIds: null,
      importanceScore: null,
      scope: null,
      relevantPlaceIds: null,
    }));

    const initialKnowledge: Fact[] = generated.initialKnowledge.map((knowledge) => ({
      placeId: null,
      category: knowledge.category,
      subject: 'Current Situation',
      subjectId: null,
      fact: knowledge.content,
      significance: 'minor' as const,
      important: false,
    }));

    const startingSituation: StartingSituation = {
      narrative: generated.narrative,
      characterState: generated.characterState,
      initialEvents,
      initialKnowledge,
    };

    logger.info(
      'StartingSituationGenerator',
      `Generated starting situation: characterId=${character.id} narrativeLength=${startingSituation.narrative?.length ?? 0} eventCount=${initialEvents.length}`,
    );

    return startingSituation;
  } catch (error) {
    logger.error('StartingSituationGenerator', 'Failed to generate starting situation', {
      error: error instanceof Error ? error.message : String(error),
      characterId: character.id,
    });
    throw error;
  }
}
