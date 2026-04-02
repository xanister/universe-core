/**
 * Search Characters Tool
 *
 * Search for characters by name/keyword or list characters at a location.
 * Returns IDs that must be used verbatim in other tools.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import { searchEntities } from './search-entities.js';
import type { ToolContext } from '../types.js';

export const searchCharactersTool = tool({
  name: 'search_characters',
  description:
    'Search for characters by name/keyword OR list characters at a location. ' +
    'Use sortBy: "distance" to find the closest match. ' +
    'Returns IDs to use in other tools - do NOT invent IDs.',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Name or keyword to search (e.g., "merchant", "guard", "innkeeper"). ' +
          'Use empty string "" if using atPlaceId instead.',
      ),
    atPlaceId: z
      .string()
      .describe(
        'List characters at this place (PLACE_xxx). Use empty string "" to search globally by query.',
      ),
    sortBy: z
      .enum(['distance', 'name', 'none'])
      .describe(
        'Sort: "distance" = closest to player first, "name" = alphabetical, "none" = no sorting',
      ),
    limit: z.number().describe('Max results to return'),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(
    input: {
      query: string;
      atPlaceId: string;
      sortBy: 'distance' | 'name' | 'none';
      limit: number;
    },
    { context }: { context: ToolContext },
  ) {
    return searchEntities(context, {
      entityType: 'character',
      query: input.query || undefined, // Empty string = not provided
      atPlaceId: input.atPlaceId || undefined, // Empty string = not provided
      sortBy: input.sortBy === 'none' ? undefined : input.sortBy,
      limit: input.limit || 10,
    });
  },
});
