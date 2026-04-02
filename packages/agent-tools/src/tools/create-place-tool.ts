/**
 * Create Place Tool
 *
 * Generates a new location in the universe.
 * This is a granular state change tool - call when the plan requires a new place.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import {
  ENVIRONMENT_PRESET_NAMES,
  type Purpose,
  type EnvironmentPresetName,
} from '@dmnpc/types/world';
import type { ToolContext } from '../types.js';

export const createPlaceTool = tool({
  name: 'create_place',
  description:
    'Generate a new location in the universe. ' +
    'IMPORTANT: Use search_places first to find valid parentId values. ' +
    'Do NOT invent place IDs - use IDs from search_places or the context. ' +
    'Returns the place ID for use in create_exit or move_character.',
  inputSchema: z.object({
    name: z.string().describe('Name of the new place (e.g., "Tavern Backroom", "Hidden Cellar")'),
    description: z.string().describe('Description of the place - atmosphere, features, contents'),
    parentId: z
      .string()
      .describe(
        'Parent place ID (PLACE_xxx) - MUST be a valid ID from search_places or context. ' +
          'Sub-locations use current location. Distant locations use a regional ancestor.',
      ),
    environment: z
      .enum(ENVIRONMENT_PRESET_NAMES)
      .describe(
        'Environment type: interior (enclosed), exterior (open), space (vacuum), or underwater (submerged).',
      ),
    purpose: z
      .string()
      .describe(
        'Purpose from the purpose registry (e.g., tavern, shop, forest), or "unspecified" to let the system infer from description.',
      ),
  }),
  async execute(
    input: {
      name: string;
      description: string;
      parentId: string;
      environment: EnvironmentPresetName;
      purpose: Purpose;
    },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { place, logger } = services;

    const existing = place.findSimilarPlace(universe, input.name);
    if (existing) {
      logger.info('CreatePlaceTool', `Found existing place: ${existing.place.id}`);
      return {
        success: true,
        placeId: existing.place.id,
        label: existing.place.label,
        action: 'found_existing' as const,
      };
    }

    const result = await place.generatePlace({
      ctx: universe,
      name: input.name,
      description: input.description,
      parentId: input.parentId,
      environment: input.environment,
      purpose: input.purpose === 'unspecified' ? undefined : input.purpose,
    });

    logger.info('CreatePlaceTool', `Created place: ${result.id} "${result.label}"`);

    return {
      success: true,
      placeId: result.id,
      label: result.label,
      action: 'created' as const,
    };
  },
});
