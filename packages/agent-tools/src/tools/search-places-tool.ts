/**
 * Search Places Tool
 *
 * Search for places by name/keyword or list children of a place.
 * Returns IDs that must be used verbatim in other tools.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import { searchEntities } from './search-entities.js';
import type { ToolContext } from '../types.js';

export const searchPlacesTool = tool({
  name: 'search_places',
  description:
    'Search for places by name/keyword OR list children of a place. ' +
    'Use sortBy: "distance" to find the closest match. ' +
    'Returns IDs to use in other tools - do NOT invent IDs.',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'Name or keyword to search (e.g., "tavern", "docks", "castle"). ' +
          'Use empty string "" to list top-level regions or combine with parentId to list children.',
      ),
    parentId: z
      .string()
      .describe(
        'List children of this place (PLACE_xxx). Use empty string "" to search globally or list top-level regions.',
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
      parentId: string;
      sortBy: 'distance' | 'name' | 'none';
      limit: number;
    },
    { context }: { context: ToolContext },
  ) {
    return searchEntities(context, {
      entityType: 'place',
      query: input.query || undefined, // Empty string = not provided
      parentId: input.parentId || undefined, // Empty string = not provided
      sortBy: input.sortBy === 'none' ? undefined : input.sortBy,
      limit: input.limit || 10,
    });
  },
});
