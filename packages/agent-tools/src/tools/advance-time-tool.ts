/**
 * Advance Time Tool
 *
 * Advances the game clock by a specified number of minutes.
 * This is a granular state change tool - call after determine_action_outcome.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const advanceTimeTool = tool({
  name: 'advance_time',
  description:
    'Advance the game clock by a specified number of minutes. ' +
    'Use for action duration, waiting, sleeping, or travel time. ' +
    'Max 1440 minutes (24 hours) per call.',
  inputSchema: z.object({
    minutes: z.number().min(1).max(1440).describe('Minutes to advance (1-1440)'),
    reason: z
      .string()
      .describe('Brief reason for time passing (e.g., "searching the room", "waiting for dawn")'),
  }),
  async execute(input: { minutes: number; reason: string }, { context }: { context: ToolContext }) {
    const { universe, services } = context;
    const { time, logger } = services;
    const universeData = universe.universe;

    if (!universeData.calendar) {
      throw new Error('No calendar configured for this universe');
    }

    const previousDate = universeData.date;

    logger.info('AdvanceTimeTool', `Time advancing: +${input.minutes}min reason="${input.reason}"`);

    await time.advanceGameTime(context, input.minutes, null);

    return {
      success: true,
      previousDate,
      newDate: universeData.date,
      minutesAdvanced: input.minutes,
      reason: input.reason,
    };
  },
});
