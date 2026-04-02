/**
 * Create Exit Tool
 *
 * Creates an exit from a place to its parent.
 * Exits are objects with purpose: 'exit' that allow travel to the parent place.
 * In the hierarchical exit model, exits only go from child to parent.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const createExitTool = tool({
  name: 'create_exit',
  description:
    'Create an exit in a place leading to its parent. ' +
    'Exits only go from child to parent in the place hierarchy. ' +
    'Entry to child places is via the position/slot system, not exits.',
  inputSchema: z.object({
    label: z.string().describe('Exit label (usually the parent place name)'),
    exitType: z
      .string()
      .describe('How to get there: door, path, stairs, gate, ladder, tunnel, etc.'),
    placeId: z
      .string()
      .describe('Place ID (PLACE_xxx) - where the exit is located (exit leads to parent)'),
    direction: z
      .string()
      .describe(
        'Direction: north, south, up, down, outside, etc. Use empty string "" if no specific direction.',
      ),
  }),
  async execute(
    input: {
      label: string;
      exitType: string;
      placeId: string;
      direction: string;
    },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { exit, logger } = services;

    const result = await exit.createExit({
      ctx: universe,
      placeId: input.placeId,
      label: input.label,
      exitType: input.exitType,
      direction: input.direction === '' ? undefined : input.direction,
    });

    if (!context.recentlyCreatedExits) {
      context.recentlyCreatedExits = [];
    }
    context.recentlyCreatedExits.push({
      exitId: result.id,
      label: result.label,
      exitType: result.exitType,
    });

    logger.info(
      'CreateExitTool',
      `Created exit: ${result.id} "${result.label}" (${result.exitType}) in ${input.placeId}`,
    );

    return {
      success: true,
      exitId: result.id,
      label: result.label,
      exitType: result.exitType,
    };
  },
});
