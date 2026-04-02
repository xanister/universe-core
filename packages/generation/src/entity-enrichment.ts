/**
 * Entity Enrichment Service
 *
 * Enriches existing entities with new information from WorldBible data.
 * Uses LLM to intelligently merge descriptions.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { normalizeName } from '@dmnpc/core/entities/entity-utils.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Place, Character } from '@dmnpc/types/entity';
import type { WorldBible, WorldBiblePlaceRef, WorldBibleCharacterRef } from '@dmnpc/types/world';

export interface PlaceMatch {
  place: Place;
  wbPlace: WorldBiblePlaceRef;
}

export interface CharacterMatch {
  character: Character;
  wbChar: WorldBibleCharacterRef;
}

export interface EntityMatchResult {
  placeMatches: PlaceMatch[];
  characterMatches: CharacterMatch[];
  unmatchedPlaces: WorldBiblePlaceRef[];
  unmatchedCharacters: WorldBibleCharacterRef[];
}

/**
 * Check if two names match (case-insensitive, handles aliases).
 */
function namesMatch(
  name1: string,
  name2: string,
  aliases1: string[] = [],
  aliases2: string[] = [],
): boolean {
  const normalized1 = normalizeName(name1);
  const normalized2 = normalizeName(name2);

  if (normalized1 === normalized2) return true;

  const allNames1 = [normalized1, ...aliases1.map(normalizeName)];
  const allNames2 = [normalized2, ...aliases2.map(normalizeName)];

  return allNames1.some((n1) => allNames2.includes(n1));
}

/**
 * Match WorldBible entities to existing universe entities.
 */
export function matchEntitiesToWorldBible(
  ctx: UniverseContext,
  worldBible: WorldBible,
): EntityMatchResult {
  const placeMatches: PlaceMatch[] = [];
  const characterMatches: CharacterMatch[] = [];
  const unmatchedPlaces: WorldBiblePlaceRef[] = [];
  const unmatchedCharacters: WorldBibleCharacterRef[] = [];

  for (const wbPlace of worldBible.places) {
    const match = ctx.places.find((p) => namesMatch(p.label, wbPlace.name, p.aliases || []));
    if (match) {
      placeMatches.push({
        place: match,
        wbPlace,
      });
    } else {
      unmatchedPlaces.push(wbPlace);
    }
  }

  for (const wbChar of worldBible.characters) {
    const match = ctx.characters.find((c) =>
      namesMatch(c.label, wbChar.name, c.aliases || [], wbChar.aliases || []),
    );
    if (match) {
      characterMatches.push({
        character: match,
        wbChar,
      });
    } else {
      unmatchedCharacters.push(wbChar);
    }
  }

  logger.info(
    'EntityEnrichment',
    `Matched ${placeMatches.length} places, ${characterMatches.length} characters. Unmatched: ${unmatchedPlaces.length} places, ${unmatchedCharacters.length} characters`,
  );

  return {
    placeMatches,
    characterMatches,
    unmatchedPlaces,
    unmatchedCharacters,
  };
}

const PLACE_MERGE_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'The merged description incorporating both existing and new information',
    },
    commonKnowledge: {
      type: 'string',
      description: 'Updated common knowledge about the place (what locals know)',
    },
  },
  required: ['description', 'commonKnowledge'],
  additionalProperties: false,
};

const CHARACTER_MERGE_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description: 'The merged description incorporating both existing and new information',
    },
    personality: {
      type: 'string',
      description: 'Updated personality description if new insights are available',
    },
  },
  required: ['description', 'personality'],
  additionalProperties: false,
};

/**
 * Enrich an existing place with new information from WorldBible.
 * Uses LLM to intelligently merge descriptions.
 */
async function enrichPlace(
  existingPlace: Place,
  wbPlace: WorldBiblePlaceRef,
): Promise<{ description: string; commonKnowledge?: string }> {
  const result = await queryLlm<{
    description: string;
    commonKnowledge: string;
  }>({
    system: `You are merging information about a location from two sources into a cohesive description.

Rules:
- Preserve all important details from the existing description
- Incorporate new information that adds depth or context
- If there are contradictions, prefer the existing description but note new perspectives
- Keep the tone consistent with the existing description
- The merged description should feel natural, not like a list of facts
- Keep it concise but comprehensive (2-4 paragraphs)`,
    prompt: `Merge the following information about "${existingPlace.label}":

EXISTING DESCRIPTION:
${existingPlace.description}

NEW INFORMATION FROM DOCUMENTS:
${wbPlace.description}

Provide:
1. A merged description that incorporates both sources
2. Common knowledge - what locals would know about this place (1-2 sentences)`,
    complexity: 'simple',
    context: `Place Enrichment: ${existingPlace.label}`,
    maxTokensOverride: 2048,
    schema: {
      name: 'place_merge',
      schema: PLACE_MERGE_SCHEMA,
    },
  });

  logger.info('EntityEnrichment', `Enriched place: ${existingPlace.id} (${existingPlace.label})`);

  return {
    description: result.content.description,
    commonKnowledge: result.content.commonKnowledge,
  };
}

/**
 * Enrich an existing character with new information from WorldBible.
 * Uses LLM to intelligently merge descriptions.
 */
async function enrichCharacter(
  existingChar: Character,
  wbChar: WorldBibleCharacterRef,
): Promise<{ description: string; personality?: string }> {
  const result = await queryLlm<{ description: string; personality: string }>({
    system: `You are merging information about a character from two sources into a cohesive description.

Rules:
- Preserve all important details from the existing description (physical traits, backstory, etc.)
- Incorporate new information that adds depth or context
- If there are contradictions, prefer the existing description but note new perspectives
- Keep the tone objective - describe by actions and roles, not value judgments
- The merged description should feel natural, not like a list of facts
- Keep it concise but comprehensive (2-3 paragraphs)
- For personality, enhance with new insights but preserve core traits`,
    prompt: `Merge the following information about "${existingChar.label}":

EXISTING DESCRIPTION:
${existingChar.description}

EXISTING PERSONALITY:
${existingChar.info.personality}

NEW INFORMATION FROM DOCUMENTS:
Name: ${wbChar.name}${wbChar.title ? ` (${wbChar.title})` : ''}
Aliases: ${wbChar.aliases?.join(', ') || 'none'}
Description: ${wbChar.description}
Temporal Status: ${wbChar.temporalStatus}
Active Era: ${wbChar.activeEra || 'unknown'}

Provide:
1. A merged description that incorporates both sources
2. An enhanced personality description`,
    complexity: 'simple',
    context: `Character Enrichment: ${existingChar.label}`,
    maxTokensOverride: 2048,
    schema: {
      name: 'character_merge',
      schema: CHARACTER_MERGE_SCHEMA,
    },
  });

  logger.info('EntityEnrichment', `Enriched character: ${existingChar.id} (${existingChar.label})`);

  return {
    description: result.content.description,
    personality: result.content.personality,
  };
}

/**
 * Enrich all matched entities and save them.
 * Returns IDs of enriched entities.
 */
export async function enrichMatchedEntities(
  ctx: UniverseContext,
  matchResult: EntityMatchResult,
): Promise<{ enrichedPlaces: string[]; enrichedCharacters: string[] }> {
  const enrichedPlaces: string[] = [];
  const enrichedCharacters: string[] = [];

  for (const match of matchResult.placeMatches) {
    try {
      const enriched = await enrichPlace(match.place, match.wbPlace);

      const updatedPlace: Place = {
        ...match.place,
        description: enriched.description,
        info: {
          ...match.place.info,
          commonKnowledge: enriched.commonKnowledge || match.place.info.commonKnowledge,
        },
      };

      // Place dimensions come only from layout when generated (single source of truth); no fallback here

      ctx.upsertEntity('place', updatedPlace);
      enrichedPlaces.push(match.place.id);
    } catch (error) {
      logger.error('EntityEnrichment', `Failed to enrich place ${match.place.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const match of matchResult.characterMatches) {
    try {
      const enriched = await enrichCharacter(match.character, match.wbChar);

      const existingAliases = match.character.aliases || match.character.info.aliases;
      const newAliases = match.wbChar.aliases || [];
      const mergedAliases = [...new Set([...existingAliases, ...newAliases])];

      const updatedChar: Character = {
        ...match.character,
        description: enriched.description,
        aliases: mergedAliases,
        info: {
          ...match.character.info,
          aliases: mergedAliases,
          personality: enriched.personality || match.character.info.personality,
          title: match.wbChar.title || match.character.info.title,
        },
      };

      ctx.upsertEntity('character', updatedChar);
      enrichedCharacters.push(match.character.id);
    } catch (error) {
      logger.error('EntityEnrichment', `Failed to enrich character ${match.character.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info(
    'EntityEnrichment',
    `Enriched ${enrichedPlaces.length} places, ${enrichedCharacters.length} characters`,
  );

  return { enrichedPlaces, enrichedCharacters };
}
