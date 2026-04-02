/**
 * Routine Generator
 *
 * Generates and regenerates character routines (daily schedules).
 * Used for initial character creation and event-driven updates (job loss, home destroyed, etc.).
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { ensureTags, getExistingTagLabels } from '@dmnpc/core/entities/tag-manager.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Character, Place } from '@dmnpc/types/entity';
import type { CharacterRoutine, TimePeriod, LocationType } from '@dmnpc/types/npc';
import {
  getHomeOccupancy,
  getWorkplaceOccupancy,
  type PlaceOccupancy,
} from '../place/occupancy.js';
import { ensureSystemTags } from '../place/capacity-rules.js';
import { findJobMatches, getCharacterOccupation, type JobMatchResult } from '../job-matching.js';

// ============================================================================
// Types
// ============================================================================

export interface GenerateRoutineParams {
  /** Universe ID to generate the routine in */
  universeId: string;
  /** Character ID to generate routine for */
  characterId: string;
  /** For initial generation: the place where the character was created */
  creationPlace?: Place;
  /** For regeneration: what event triggered the routine update */
  event?: {
    type:
      | 'job_loss'
      | 'home_destroyed'
      | 'relocated'
      | 'new_job'
      | 'promotion'
      | 'retirement'
      | 'custom';
    description: string;
    /** Place IDs that are no longer valid for this character */
    affectedLocations?: string[];
  };
}

interface LLMRoutineOutput {
  schedule: Record<TimePeriod, LocationType>;
  home: {
    placeId?: string;
    description: string;
    areaHint?: string;
  };
  work?: {
    placeId?: string;
    description: string;
    areaHint?: string;
  };
  leisure?: {
    favoriteSpot?: {
      placeId?: string;
      description: string;
      areaHint?: string;
    };
    preferences: string[]; // Tag labels, will be converted to tag IDs
  };
  variance: number;
  creationPlaceRelationship?: 'workplace' | 'home' | 'leisure' | 'passing_through';
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generates a routine for a character.
 * Can be used for initial generation (with creationPlace) or regeneration (with event).
 * Call this synchronously after character creation using the same context.
 */
export async function generateCharacterRoutine(
  ctx: UniverseContext,
  params: GenerateRoutineParams,
): Promise<CharacterRoutine> {
  const { universeId, characterId, creationPlace, event } = params;

  logger.info(
    'Routine Generator',
    `Generating routine for ${characterId}${creationPlace ? ' with creation place' : ''}${event ? ` event: ${event.type}` : ''}`,
  );

  const universe = ctx.universe;
  const character = ctx.getCharacter(characterId);

  // Skip player characters
  if (character.info.messages.length > 0 || character.info.storytellerState !== null) {
    logger.warn('Routine Generator', `Skipping player character: ${characterId}`);
    throw new Error('Cannot generate routine for player character');
  }

  // Ensure system tags exist in this universe
  await ensureSystemTags(ctx);

  // Build context for LLM
  const existingTagLabels = await getExistingTagLabels(universeId);
  const nearbyPlaces = getNearbyPlaces(universe.places ?? [], character, creationPlace);
  const homeOccupancy = getHomeOccupancy(universe.characters ?? [], nearbyPlaces);
  const workplaceOccupancy = getWorkplaceOccupancy(universe.characters ?? [], nearbyPlaces);
  const jobMatches = findJobMatches(character, workplaceOccupancy);

  // Build the LLM prompt
  const routineOutput = await callLLMForRoutine({
    character,
    creationPlace,
    event,
    nearbyPlaces,
    homeOccupancy,
    workplaceOccupancy,
    jobMatches,
    existingTagLabels,
    universeContext: {
      name: universe.name,
      tone: universe.tone,
    },
  });

  // Convert LLM output to CharacterRoutine
  const routine = await convertLLMOutputToRoutine(routineOutput, ctx);

  // Save the routine to the character
  character.info.routine = routine;
  ctx.upsertEntity('character', character);

  logger.info(
    'Routine Generator',
    `Routine generated and saved for ${characterId}: hasWork=${!!routine.work}, variance=${routine.variance}`,
  );

  return routine;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets places that are relevant for routine generation.
 * Prioritizes the creation place and nearby places.
 * Characters can be at any place.
 */
function getNearbyPlaces(allPlaces: Place[], character: Character, creationPlace?: Place): Place[] {
  const places: Place[] = [];

  // Add creation place first if provided
  if (creationPlace) {
    places.push(creationPlace);
  }

  // Add the place where the character currently is
  const currentPlace = allPlaces.find((p) => p.id === character.position.parent);
  if (currentPlace && currentPlace.id !== creationPlace?.id) {
    places.push(currentPlace);
  }

  // Add other places (limit to avoid token bloat)
  const otherPlaces = allPlaces.filter(
    (p) => p.id !== creationPlace?.id && p.id !== character.position.parent,
  );
  places.push(...otherPlaces.slice(0, 10));

  return places;
}

/**
 * Calls the LLM to generate the routine.
 */
async function callLLMForRoutine(context: {
  character: Character;
  creationPlace?: Place;
  event?: GenerateRoutineParams['event'];
  nearbyPlaces: Place[];
  homeOccupancy: PlaceOccupancy[];
  workplaceOccupancy: PlaceOccupancy[];
  jobMatches: JobMatchResult;
  existingTagLabels: string[];
  universeContext: { name: string; tone: string };
}): Promise<LLMRoutineOutput> {
  const systemPrompt = buildSystemPrompt(context);
  const userPrompt = buildUserPrompt(context);

  const routineSchema = {
    type: 'object',
    properties: {
      schedule: {
        type: 'object',
        properties: {
          dawn: { type: 'string', enum: ['home', 'work', 'leisure', 'away'] },
          morning: {
            type: 'string',
            enum: ['home', 'work', 'leisure', 'away'],
          },
          afternoon: {
            type: 'string',
            enum: ['home', 'work', 'leisure', 'away'],
          },
          evening: {
            type: 'string',
            enum: ['home', 'work', 'leisure', 'away'],
          },
          night: { type: 'string', enum: ['home', 'work', 'leisure', 'away'] },
        },
        required: ['dawn', 'morning', 'afternoon', 'evening', 'night'],
        additionalProperties: false,
      },
      home: {
        type: 'object',
        properties: {
          placeId: { type: ['string', 'null'] },
          description: { type: 'string' },
          areaHint: { type: ['string', 'null'] },
        },
        required: ['placeId', 'description', 'areaHint'],
        additionalProperties: false,
      },
      work: {
        type: ['object', 'null'],
        properties: {
          placeId: { type: ['string', 'null'] },
          description: { type: 'string' },
          areaHint: { type: ['string', 'null'] },
        },
        required: ['placeId', 'description', 'areaHint'],
        additionalProperties: false,
      },
      leisure: {
        type: ['object', 'null'],
        properties: {
          favoriteSpot: {
            type: ['object', 'null'],
            properties: {
              placeId: { type: ['string', 'null'] },
              description: { type: 'string' },
              areaHint: { type: ['string', 'null'] },
            },
            required: ['placeId', 'description', 'areaHint'],
            additionalProperties: false,
          },
          preferences: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['favoriteSpot', 'preferences'],
        additionalProperties: false,
      },
      variance: {
        type: 'number',
        description:
          'How punctual the character is (0.0 = always on time, 1.0 = very unpredictable)',
      },
      creationPlaceRelationship: {
        type: ['string', 'null'],
        enum: ['workplace', 'home', 'leisure', 'passing_through', null],
      },
    },
    required: ['schedule', 'home', 'work', 'leisure', 'variance', 'creationPlaceRelationship'],
    additionalProperties: false,
  };

  try {
    const result = await queryLlm<LLMRoutineOutput>({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'reasoning', // Complex reasoning for schedule generation
      context: 'Routine Generator',
      schema: {
        name: 'routine_schema',
        schema: routineSchema,
      },
    });

    return result.content;
  } catch (error) {
    logger.error('Routine Generator', 'LLM call failed', {
      characterId: context.character.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function buildSystemPrompt(context: {
  existingTagLabels: string[];
  universeContext: { name: string; tone: string };
}): string {
  const tagList =
    context.existingTagLabels.length > 0
      ? `Available leisure preference tags: ${context.existingTagLabels.slice(0, 30).join(', ')}`
      : 'No existing tags yet - suggest appropriate tags like "tavern", "temple", "market", "park"';

  return `You are a character routine generator for a role-playing game${context.universeContext.name ? ` set in ${context.universeContext.name}` : ''}.${context.universeContext.tone ? `\nTone: ${context.universeContext.tone}` : ''}

Generate a daily schedule/routine for the character. Consider:
- Their apparent occupation/role based on description and tags
- Where they were first encountered (creation place) - this hints at their relationship to that location
- Realistic daily patterns (workers work during day, night workers work at night, etc.)
- Personality affecting punctuality (variance field)

RULES:
1. Schedule uses 5 time periods: dawn, morning, afternoon, evening, night
2. Each period maps to: home, work, leisure, or away
3. Most characters should spend time at home at least once per day
4. Characters without jobs have no "work" location - they may spend time at home, leisure, or away
5. If creation place is a workplace (tavern, shop, etc.), the character likely works there
6. If creation place is a residence, it may be their home
7. If creation place is a social venue and they seem like a patron, it's their leisure spot
8. Variance: 0.0 = punctual (soldiers, clerks), 0.5 = average, 1.0 = unpredictable (artists, vagabonds)

For location descriptions:
- Be specific but brief (e.g., "a cramped room above the tavern", "modest lodgings in the harbor district")
- Use areaHint for geographic placement (e.g., "the Undercroft", "Harbor District")
- Only set placeId if you're assigning an EXISTING place from the provided list

HOME ASSIGNMENT RULES:
- Only assign home.placeId to a residence that has available capacity (see AVAILABLE RESIDENCES)
- If no suitable residence has capacity, leave home.placeId as null and provide description + areaHint
- A new residence will be generated when needed during gameplay

${tagList}

For leisure preferences, pick 1-3 tags that describe places this character would enjoy spending free time at.`;
}

function buildUserPrompt(context: {
  character: Character;
  creationPlace?: Place;
  event?: GenerateRoutineParams['event'];
  nearbyPlaces: Place[];
  homeOccupancy: PlaceOccupancy[];
  workplaceOccupancy: PlaceOccupancy[];
  jobMatches: JobMatchResult;
}): string {
  const {
    character,
    creationPlace,
    event,
    nearbyPlaces,
    homeOccupancy,
    workplaceOccupancy,
    jobMatches,
  } = context;

  let prompt = `CHARACTER:
- Name: ${character.label}
- Description: ${character.description}
- Tags: ${character.tags.join(', ') || 'none'}
- Personality: ${character.info.personality}
- Current Location: ${character.position.parent}
`;

  if (creationPlace) {
    prompt += `
CREATION PLACE (where the character was first encountered):
- ID: ${creationPlace.id}
- Name: ${creationPlace.label}
- Description: ${creationPlace.description}
- Tags: ${creationPlace.tags.join(', ') || 'none'}
- Environment: ${creationPlace.info.environment.type}

Determine how this character relates to the creation place:
- If they seem to work there (bartender at tavern, guard at gate) → workplace
- If it seems to be their residence → home
- If they appear to be a patron/visitor → leisure
- If they're just passing through → passing_through
`;
  }

  if (event) {
    prompt += `
EVENT (reason for routine regeneration):
- Type: ${event.type}
- Description: ${event.description}
${event.affectedLocations ? `- Affected locations (no longer valid): ${event.affectedLocations.join(', ')}` : ''}
`;
  }

  if (nearbyPlaces.length > 0) {
    prompt += `
NEARBY PLACES (can assign placeId for concrete locations):
${nearbyPlaces
  .map((p) => {
    const tagsStr = p.tags.length > 0 ? p.tags.join(', ') : 'no tags';
    return `- ${p.id}: "${p.label}" (${tagsStr})`;
  })
  .join('\n')}
`;
  }

  if (homeOccupancy.length > 0) {
    const available = homeOccupancy.filter((h) => h.totalCurrent < h.totalCapacity);
    const full = homeOccupancy.filter((h) => h.totalCurrent >= h.totalCapacity);

    const getPlaceName = (placeId: string) =>
      nearbyPlaces.find((p) => p.id === placeId)?.label ?? placeId;

    prompt += `
AVAILABLE RESIDENCES (places with capacity for new residents):
${available.length > 0 ? available.map((h) => `- ${h.placeId}: "${getPlaceName(h.placeId)}" (${h.totalCurrent}/${h.totalCapacity} occupants)`).join('\n') : 'None available'}
${full.length > 0 ? `\nFULL RESIDENCES (do NOT assign these as home.placeId):\n${full.map((h) => `- ${h.placeId}: "${getPlaceName(h.placeId)}" (FULL: ${h.totalCurrent}/${h.totalCapacity})`).join('\n')}` : ''}

IMPORTANT: Only assign home.placeId to a residence that has available capacity.
If no suitable residence has capacity, omit placeId and provide description + areaHint (a new place will be generated when needed).
`;
  }

  if (workplaceOccupancy.length > 0) {
    const getPlaceName = (placeId: string) =>
      nearbyPlaces.find((p) => p.id === placeId)?.label ?? placeId;

    prompt += `
WORKPLACES WITH OPENINGS:
${workplaceOccupancy
  .map((w) => {
    const placeName = getPlaceName(w.placeId);
    const filledRoles = w.slots
      .filter((s) => s.current > 0)
      .map((s) => `${s.roleTag?.replace('TAG_', '')}: ${s.current}`)
      .join(', ');
    const openRoles = w.openings
      .map((o) => `${o.roleTag?.replace('TAG_', '') ?? 'any'}: ${o.count}`)
      .join(', ');
    return `${placeName} (${w.totalCurrent}/${w.totalCapacity} staff):
  Filled: ${filledRoles || 'none'}
  Openings: ${openRoles || 'none'}`;
  })
  .join('\n\n')}

Only assign work.placeId to a workplace with available openings matching the character's occupation.
If no suitable workplace has capacity, omit placeId and provide description + areaHint.
`;
  }

  // Add job matching section if character has an occupation
  const characterOccupation = getCharacterOccupation(character);
  if (characterOccupation || jobMatches.matching.length > 0 || jobMatches.other.length > 0) {
    const getPlaceName = (placeId: string) =>
      nearbyPlaces.find((p) => p.id === placeId)?.label ?? placeId;

    prompt += `
JOB MATCHING (based on character skills${characterOccupation ? ` - ${characterOccupation.replace('TAG_', '')}` : ''}):
`;

    if (jobMatches.matching.length > 0) {
      prompt += `MATCHING JOBS (preferred - fit character skills):
${jobMatches.matching.map((j) => `- ${getPlaceName(j.placeId)}: ${j.roleTag.replace('TAG_', '')} (${j.openings} opening${j.openings > 1 ? 's' : ''}) [${j.matchType}]`).join('\n')}
`;
    } else {
      prompt += `MATCHING JOBS: None available
`;
    }

    if (jobMatches.other.length > 0) {
      prompt += `
OTHER AVAILABLE JOBS (poor fit - would require career change):
${jobMatches.other
  .slice(0, 5)
  .map(
    (j) =>
      `- ${getPlaceName(j.placeId)}: ${j.roleTag.replace('TAG_', '')} (${j.openings} opening${j.openings > 1 ? 's' : ''})`,
  )
  .join('\n')}

Prefer matching jobs. Only assign non-matching if character would realistically change careers.
`;
    }
  }

  prompt += `
Generate a routine for this character. Return valid JSON.`;

  return prompt;
}

/**
 * Converts the LLM output to a proper CharacterRoutine with validated tag IDs.
 */
async function convertLLMOutputToRoutine(
  output: LLMRoutineOutput,
  ctx: UniverseContext,
): Promise<CharacterRoutine> {
  // Convert leisure preference strings to tag IDs
  let preferredTagIds: string[] = [];
  if (output.leisure?.preferences && output.leisure.preferences.length > 0) {
    preferredTagIds = await ensureTags(output.leisure.preferences, ctx);
  }

  const routine: CharacterRoutine = {
    schedule: output.schedule,
    home: {
      placeId: output.home.placeId ?? null,
      description: output.home.description,
      areaHint: output.home.areaHint ?? null,
    },
    leisure: null,
    variance: Math.max(0, Math.min(1, output.variance)), // Clamp to 0-1
  };

  if (output.work) {
    routine.work = {
      placeId: output.work.placeId ?? null,
      description: output.work.description,
      areaHint: output.work.areaHint ?? null,
    };
  }

  if (output.leisure || preferredTagIds.length > 0) {
    routine.leisure = {
      favoriteSpot: null,
      preferredTagIds,
    };
    if (output.leisure?.favoriteSpot) {
      routine.leisure.favoriteSpot = {
        placeId: output.leisure.favoriteSpot.placeId ?? null,
        description: output.leisure.favoriteSpot.description,
        areaHint: output.leisure.favoriteSpot.areaHint ?? null,
      };
    }
  }

  return routine;
}
