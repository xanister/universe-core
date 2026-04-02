/**
 * Query Universe Tools
 *
 * Three tools for the agent to inspect what has been created during generation.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { GeneratorToolContext } from '../types.js';

export const listPlacesTool = tool({
  name: 'list_places',
  description: 'List all places created so far with their hierarchy.',
  inputSchema: z.object({}),
  async execute(_input: unknown, { context }: { context: GeneratorToolContext }) {
    await Promise.resolve();
    const { universeContext: ctx } = context;
    const allPlaces = ctx.getAllPlaces();

    if (allPlaces.length === 0) {
      return { places: [], message: 'No places created yet.' };
    }

    return {
      places: allPlaces.map((p) => ({
        id: p.id,
        label: p.label,
        purpose: p.info.purpose,
        parentId: p.position.parent,
        childCount: ctx.getChildPlaces(p.id).length,
      })),
      total: allPlaces.length,
    };
  },
});

export const findPlaceTool = tool({
  name: 'find_place',
  description: 'Search for places by label substring or purpose ID.',
  inputSchema: z.object({
    query: z.string().describe('Label substring or purpose ID to search for'),
  }),
  async execute(input: { query: string }, { context }: { context: GeneratorToolContext }) {
    await Promise.resolve();
    const { universeContext: ctx } = context;
    const allPlaces = ctx.getAllPlaces();
    const lowerQuery = input.query.toLowerCase();

    const matches = allPlaces.filter(
      (p) =>
        p.label.toLowerCase().includes(lowerQuery) ||
        p.info.purpose.toLowerCase().includes(lowerQuery),
    );

    if (matches.length === 0) {
      return { matches: [], message: `No places match "${input.query}".` };
    }

    return {
      matches: matches.map((p) => ({
        id: p.id,
        label: p.label,
        purpose: p.info.purpose,
        parentId: p.position.parent,
      })),
    };
  },
});

export const getPlaceDetailsTool = tool({
  name: 'get_place_details',
  description: 'Get full details for a specific place including children, objects, and characters.',
  inputSchema: z.object({
    placeId: z.string().describe('The place ID to inspect'),
  }),
  async execute(input: { placeId: string }, { context }: { context: GeneratorToolContext }) {
    await Promise.resolve();
    const { universeContext: ctx } = context;

    const place = ctx.findPlace(input.placeId);
    if (!place) {
      throw new Error(`Place "${input.placeId}" not found.`);
    }

    const children = ctx.getChildPlaces(input.placeId);
    const objects = ctx.getObjectsByPlace(input.placeId);
    const allCharacters = ctx.getAllCharacters();
    const characters = allCharacters.filter((c) => c.position.parent === input.placeId);

    return {
      id: place.id,
      label: place.label,
      description: place.description,
      purpose: place.info.purpose,
      scale: place.info.scale,
      parentId: place.position.parent,
      children: children.map((c) => ({
        id: c.id,
        label: c.label,
        purpose: c.info.purpose,
      })),
      objects: objects.map((o) => ({
        id: o.id,
        label: o.label,
        purpose: o.info.purpose,
      })),
      characters: characters.map((c) => ({
        id: c.id,
        label: c.label,
        purpose: c.info.purpose,
      })),
    };
  },
});
