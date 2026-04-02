/**
 * Query Flag Status Tool
 *
 * Read-only tool to check which story flags are set or available.
 * Use to understand current plot progress.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const queryFlagsTool = tool({
  name: 'query_flag_status',
  description:
    'Check which story flags are set and which are available to set. ' +
    'Use to understand current plot progress before setting flags.',
  inputSchema: z.object({
    plotId: z
      .string()
      .describe('Filter to a specific plot ID (PLOT_xxx). Use empty string "" for all plots.'),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(input: { plotId: string }, { context }: { context: ToolContext }) {
    const { character, services } = context;
    const { flag, logger } = services;

    const storytellerState = character.info.storytellerState;
    if (!storytellerState) {
      return {
        success: true,
        activePlots: 0,
        plots: [],
        message: 'No active plots for this character',
      };
    }

    const plots = storytellerState.activePlots
      .filter((p) => !input.plotId || input.plotId === '' || p.id === input.plotId)
      .map((plot) => {
        const validFlags = flag.collectValidFlags(plot.plan);
        const setFlags = plot.storyFlags;
        const availableFlags = validFlags.filter((f) => !setFlags.includes(f));

        return {
          plotId: plot.id,
          plotLabel: plot.plan.label,
          progress: plot.progressLevel || 0,
          setFlags,
          availableFlags,
          totalFlags: validFlags.length,
        };
      });

    logger.info(
      'QueryFlagsTool',
      `Queried flags: ${plots.length} plots, ${plots.reduce((sum, p) => sum + p.setFlags.length, 0)} flags set`,
    );

    return {
      success: true,
      activePlots: plots.length,
      plots,
    };
  },
});
