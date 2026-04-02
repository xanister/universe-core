/**
 * Set Story Flags Tool
 *
 * Sets story flags on active plots. Flags are used to track progress
 * and trigger turning points in the story.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const setStoryFlagsTool = tool({
  name: 'set_story_flags',
  description:
    'Set story flags on active plots. Flags track player progress and can trigger story events. ' +
    'Only flags valid for active plots will be set. Returns which flags were actually applied.',
  inputSchema: z.object({
    flags: z
      .array(z.string())
      .describe('Array of flag IDs to set (e.g., ["met_broker", "searched_warehouse"])'),
  }),
  async execute(input: { flags: string[] }, { context }: { context: ToolContext }) {
    const { universe, character, services } = context;
    const { time, flag: flagService, logger } = services;
    const { flags } = input;

    if (flags.length === 0) {
      return { success: true, appliedFlags: [], message: 'No flags provided' };
    }

    const state = character.info.storytellerState;
    if (!state || state.activePlots.length === 0) {
      return {
        success: false,
        appliedFlags: [],
        message: 'No active plots to apply flags to',
      };
    }

    const universeData = universe.universe;
    if (!universeData.calendar || !universeData.date) {
      return {
        success: false,
        appliedFlags: [],
        message: 'No calendar configured',
      };
    }

    const currentDate = time.parseDate(universeData.calendar, universeData.date);
    const appliedFlags: string[] = [];
    const rejectedFlags: Array<{ flag: string; reason: string }> = [];

    for (const plot of state.activePlots) {
      const plotStatus = flagService.getPlotStatus(plot, currentDate, universeData.calendar);
      if (plotStatus !== 'active') {
        continue;
      }

      const validFlags = flagService.collectValidFlags(plot.plan);
      const validFlagSet = new Set(validFlags);

      const newFlags = flags.filter((f) => {
        if (!validFlagSet.has(f)) {
          rejectedFlags.push({ flag: f, reason: `not valid for plot ${plot.id}` });
          return false;
        }
        if (plot.storyFlags.includes(f)) {
          rejectedFlags.push({ flag: f, reason: 'already set' });
          return false;
        }
        return true;
      });

      if (newFlags.length > 0) {
        plot.storyFlags = flagService.addStoryFlags(plot.storyFlags, newFlags);
        appliedFlags.push(...newFlags);
        logger.info('SetFlagsTool', `Flags applied to plot ${plot.id}: [${newFlags.join(', ')}]`);
      }
    }

    if (appliedFlags.length > 0) {
      await flagService.saveStorytellerState(universe, character.id, state);

      if (!context.newlySetFlags) {
        context.newlySetFlags = [];
      }
      context.newlySetFlags.push(...appliedFlags);
    }

    return {
      success: true,
      appliedFlags,
      rejectedFlags: rejectedFlags.length > 0 ? rejectedFlags : undefined,
      message:
        appliedFlags.length > 0 ? `Set ${appliedFlags.length} flag(s)` : 'No flags were applied',
    };
  },
});
