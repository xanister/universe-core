/**
 * Create Event Tool
 *
 * Records a historical event in the universe.
 * Events are facts that characters can know about and reference.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const createEventTool = tool({
  name: 'create_event',
  description:
    'Record a historical event in the universe. ' +
    'Use for significant actions, discoveries, or encounters that should be remembered. ' +
    'Events can be queried later by NPCs and affect world knowledge.',
  inputSchema: z.object({
    fact: z
      .string()
      .describe(
        'Dense factual summary using entity IDs. ' +
          'Format: "[CHAR_id] [action] [CHAR_id/PLACE_id]". ' +
          'Example: "CHAR_player searched PLACE_cellar"',
      ),
    subject: z
      .string()
      .describe('Primary subject of the event (character name, place name, or item)'),
    placeId: z
      .string()
      .describe(
        'Where the event occurred (PLACE_xxx). Use empty string "" if location is unknown or irrelevant.',
      ),
    significance: z
      .enum(['major', 'moderate', 'minor'])
      .describe(
        'How important this event is: major (plot-critical), moderate (notable), minor (background)',
      ),
    witnessIds: z.array(z.string()).describe('Character IDs (CHAR_xxx) who witnessed this event'),
  }),
  async execute(
    input: {
      fact: string;
      subject: string;
      placeId: string;
      significance: 'major' | 'moderate' | 'minor';
      witnessIds: string[];
    },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { history, logger } = services;

    const event = await history.createEvent(
      universe,
      {
        date: universe.universe.date,
        fact: input.fact,
        subject: input.subject,
        placeId: input.placeId === '' ? undefined : input.placeId,
        significance: input.significance,
      },
      input.witnessIds,
    );

    logger.info('CreateEventTool', `Event created: "${input.fact}" (${input.significance})`);

    return {
      success: true,
      eventId: event.id,
      fact: event.fact,
      significance: event.significance,
      witnessCount: input.witnessIds.length,
    };
  },
});
