/**
 * Create Character Tool
 *
 * Creates a new NPC character or finds an existing match.
 * Handles name matching, role matching, and spawn location resolution.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { PlannedCharacter } from '@dmnpc/types/npc';
import type { ToolContext } from '../types.js';

export const createCharacterTool = tool({
  name: 'create_character',
  description:
    'Create a new NPC character at a location (NOT the player character - the player already exists). ' +
    'IMPORTANT: Use search_characters first to check if a similar character exists. ' +
    'Use search_places to find valid placeId values. Do NOT invent IDs. ' +
    'Will try to match an existing character first to avoid duplicates.',
  inputSchema: z.object({
    name: z.string().describe('Display name or role description for the character'),
    role: z.string().describe('Role in the scene (e.g., "guard", "merchant", "informant")'),
    description: z.string().describe('Physical description and personality'),
    placeId: z
      .string()
      .describe('Where to spawn (PLACE_xxx) - MUST be a valid ID from search_places or context'),
    isInCurrentScene: z
      .boolean()
      .describe('Whether this character is appearing in the current scene'),
    searchScope: z.enum(['all', 'nearby']).describe('Where to search for existing matches'),
  }),
  async execute(
    input: {
      name: string;
      role: string;
      description: string;
      placeId: string;
      isInCurrentScene: boolean;
      searchScope: 'all' | 'nearby';
    },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { character: charService, queue, logger } = services;
    const { placeId: spawnPlaceId, searchScope } = input;

    const existingByName = universe.characters.find(
      (c) => c.label.toLowerCase() === input.name.toLowerCase(),
    );

    if (existingByName) {
      logger.info(
        'CreateCharacterTool',
        `Character already exists by name: "${input.name}" -> ${existingByName.id}`,
      );
      return {
        success: true,
        characterId: existingByName.id,
        characterLabel: existingByName.label,
        action: 'found_existing',
        matchType: 'name',
        location: existingByName.position.parent,
      };
    }

    const plannedCharacter: PlannedCharacter = {
      name: input.name,
      role: input.role,
      description: input.description,
      publicFace: input.role,
      hiddenTruth: '',
      locationHint: '',
      introductionProgress: 0,
      entityId: null,
    };

    const matchedCharacter = await charService.tryMatchExistingCharacter(
      universe,
      plannedCharacter,
      spawnPlaceId,
      new Set(),
      searchScope,
    );

    if (matchedCharacter) {
      logger.info(
        'CreateCharacterTool',
        `Matched existing character to role "${input.role}": ${matchedCharacter.label} (${matchedCharacter.id})`,
      );
      return {
        success: true,
        characterId: matchedCharacter.id,
        characterLabel: matchedCharacter.label,
        action: 'found_existing',
        matchType: 'role',
        location: matchedCharacter.position.parent,
      };
    }

    logger.info(
      'CreateCharacterTool',
      `Creating new character: "${input.name}" (${input.role}) at ${spawnPlaceId}`,
    );

    const newCharacter = await charService.generateCharacter({
      ctx: universe,
      description: `${input.role}. ${input.description}`,
      placeId: spawnPlaceId,
    });

    universe.upsertEntity('character', newCharacter);

    const place = universe.findPlace(spawnPlaceId);
    await charService.updateCharacterTags(universe, newCharacter.id, {
      currentPlace: place ?? undefined,
    });

    if (!charService.isPlayerCharacter(newCharacter)) {
      queue.enqueueJob(universe.universeId, {
        type: 'routine_generation',
        data: {
          characterId: newCharacter.id,
          creationPlaceId: place?.id,
        },
      });
    }

    logger.info(
      'CreateCharacterTool',
      `Created new character: ${newCharacter.label} (${newCharacter.id})`,
    );

    return {
      success: true,
      characterId: newCharacter.id,
      characterLabel: newCharacter.label,
      action: 'created',
      location: spawnPlaceId,
    };
  },
});
