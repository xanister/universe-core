/**
 * Query Historical Events Tool
 *
 * Read-only tool to retrieve relevant historical events.
 * Use for gathering context about past happenings.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const queryEventsTool = tool({
  name: 'query_historical_events',
  description:
    'Retrieve relevant historical events from the universe. ' +
    'Use to understand what has happened in the past. Filter by topic, place, or character.',
  inputSchema: z.object({
    topic: z
      .string()
      .describe('Topic or keyword to search for in events. Use empty string "" for any topic.'),
    placeId: z
      .string()
      .describe('Filter to events at this place (PLACE_xxx). Use empty string "" for any place.'),
    characterId: z
      .string()
      .describe(
        'Filter to events involving this character (CHAR_xxx). Use empty string "" for any character.',
      ),
    maxEvents: z.number().min(1).max(20).describe('Maximum number of events to return (e.g. 10)'),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(
    input: { topic: string; placeId: string; characterId: string; maxEvents: number },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { history, logger } = services;

    const events = history.getRelevantEvents(universe, {
      topic: input.topic || undefined,
      placeId: input.placeId || undefined,
      characterId: input.characterId || undefined,
      maxEvents: input.maxEvents,
    });

    logger.info(
      'QueryEventsTool',
      `Found ${events.length} events (topic: ${input.topic || 'any'}, place: ${input.placeId || 'any'})`,
    );

    return {
      success: true,
      eventCount: events.length,
      events: events.map((e) => ({
        id: e.id,
        date: e.date,
        subject: e.subject,
        fact: e.fact,
        significance: e.significance,
        placeId: e.placeId,
      })),
    };
  },
});
