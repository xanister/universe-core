/**
 * Check Storyteller Triggers Tool
 *
 * Checks if any storyteller events should fire based on time or flags.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const checkStorytellerTool = tool({
  name: 'check_storyteller_triggers',
  description:
    'Check if any storyteller events have been triggered. ' +
    'MUST call AFTER determine_action_outcome (which runs storyteller arbitration). ' +
    'Returns whether a plot event will interrupt/blend with the player action.',
  inputSchema: z.object({}),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(_input: Record<string, never>, { context }: { context: ToolContext }) {
    const hasStorytellerEvent = context.arbiterResult?.sceneContributions.some(
      (c) => c.source === 'storyteller_event',
    );

    return {
      willTrigger: hasStorytellerEvent ?? false,
      hasStorytellerContext: !!context.storytellerContext,
      eventType: context.storytellerContext?.eventType ?? null,
      plotId: context.storytellerContext?.plotId ?? null,
    };
  },
});
