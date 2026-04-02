/**
 * Query Nearby Entities Tool
 *
 * Read-only tool to get characters and exits at a location.
 * Use for gathering context before making decisions.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { Character } from '@dmnpc/types/entity';
import type { ToolContext } from '../types.js';

export const queryNearbyTool = tool({
  name: 'query_nearby_entities',
  description:
    'Get characters and exits at a location. ' +
    'Use to gather context about who is present and what exits are available.',
  inputSchema: z.object({
    placeId: z
      .string()
      .describe('Place ID to query (PLACE_xxx). Use empty string to use player current location'),
    includeCharacters: z.boolean().describe('Include characters in the result'),
    includeExits: z.boolean().describe('Include exits in the result'),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(
    input: { placeId: string; includeCharacters: boolean; includeExits: boolean },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { logger } = services;

    const placeId =
      input.placeId && input.placeId !== '' ? input.placeId : context.character.position.parent;
    const includeCharacters = input.includeCharacters;
    const includeExits = input.includeExits;

    if (!placeId) {
      throw new Error('No place ID provided and player has no current location');
    }

    const place = universe.findPlace(placeId);
    if (!place) {
      throw new Error(`Place not found: ${placeId}`);
    }

    const result: {
      placeId: string;
      placeLabel: string;
      characters?: Array<{
        id: string;
        label: string;
        shortDescription?: string;
        isPlayer: boolean;
      }>;
      exits?: Array<{
        id: string;
        label: string;
        exitType: string;
        targetPlaceId?: string;
      }>;
    } = {
      placeId: place.id,
      placeLabel: place.label,
    };

    if (includeCharacters) {
      const nearby = universe.getEntitiesByPlace(placeId, context.character.id);
      const characters = nearby.filter((e): e is Character => e.entityType === 'character');
      result.characters = characters.map((c) => ({
        id: c.id,
        label: c.label,
        shortDescription: c.short_description,
        isPlayer: c.info.isPlayer || false,
      }));
    }

    if (includeExits) {
      const exits = universe.exits.filter((e) => e.position.parent === placeId);
      // In hierarchical model, target is derived from place.position.parent
      const derivedTargetPlaceId = place.position.parent ?? undefined;
      result.exits = exits.map((e) => ({
        id: e.id,
        label: e.label,
        exitType: e.short_description || 'door',
        targetPlaceId: derivedTargetPlaceId,
      }));
    }

    logger.info(
      'QueryNearbyTool',
      `Queried ${placeId}: ${result.characters?.length || 0} characters, ${result.exits?.length || 0} exits`,
    );

    return {
      success: true,
      ...result,
    };
  },
});
