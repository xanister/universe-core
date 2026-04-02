/**
 * Update Disposition Tool
 *
 * Modifies the disposition (relationship) between two characters.
 * This is a granular state change tool for social interactions.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const updateDispositionTool = tool({
  name: 'update_disposition',
  description:
    'Update the disposition between two characters. ' +
    'Use after positive or negative social interactions. ' +
    'Delta range: -100 to +100. Typical: +5 to +15 for positive, -5 to -20 for negative.',
  inputSchema: z.object({
    characterId: z.string().describe('Character whose disposition is changing (CHAR_xxx)'),
    targetId: z.string().describe('Character they feel differently about (CHAR_xxx)'),
    delta: z
      .number()
      .min(-100)
      .max(100)
      .describe('Change in disposition: positive = friendlier, negative = hostile'),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(
    input: { characterId: string; targetId: string; delta: number },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { disposition, logger } = services;

    const newDisposition = disposition.updateDisposition(
      universe,
      input.characterId,
      input.targetId,
      input.delta,
    );

    logger.info(
      'UpdateDispositionTool',
      `Disposition: ${input.characterId} -> ${input.targetId}: delta=${input.delta} new=${newDisposition}`,
    );

    return {
      success: true,
      characterId: input.characterId,
      targetId: input.targetId,
      delta: input.delta,
      newDisposition,
    };
  },
});
