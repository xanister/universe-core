/**
 * Signal Complete Tool
 *
 * Agent declares generation is complete.
 * Validates that a minimum viable universe exists.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { GeneratorToolContext } from '../types.js';

const inputSchema = z.object({
  summary: z.string().describe('Brief summary of what was created'),
});

export const generatorSignalCompleteTool = tool({
  name: 'signal_complete',
  description:
    'Signal that universe generation is complete. ' +
    'Call this after creating the root place and any additional entities. ' +
    'Provide a brief summary of what was created.',
  inputSchema,
  async execute(
    input: z.infer<typeof inputSchema>,
    { context }: { context: GeneratorToolContext },
  ) {
    await Promise.resolve();
    const { universeContext: ctx } = context;

    const allPlaces = ctx.getAllPlaces();
    if (allPlaces.length === 0) {
      throw new Error('Cannot signal complete: no places have been created.');
    }

    const rootPlaceId = ctx.universe.rootPlaceId;
    if (!rootPlaceId || !ctx.findPlace(rootPlaceId)) {
      throw new Error('Cannot signal complete: root place not found.');
    }

    context.session.complete = true;

    const allCharacters = ctx.getAllCharacters();

    logger.info(
      'GeneratorAgent',
      `Generation complete: ${allPlaces.length} places, ${allCharacters.length} characters. ${input.summary}`,
    );

    return {
      complete: true,
      placesCreated: allPlaces.length,
      charactersCreated: allCharacters.length,
      summary: input.summary,
    };
  },
});
