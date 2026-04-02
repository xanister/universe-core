/**
 * Trigger Storyteller Tool
 *
 * Triggers a pending storyteller event.
 * Use when the storyteller check indicates an event should fire.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const triggerStorytellerTool = tool({
  name: 'trigger_storyteller_event',
  description:
    'Trigger a pending storyteller event. ' +
    'Call after check_storyteller indicates an event should fire. ' +
    'This activates the story event which will be incorporated into the narrative.',
  inputSchema: z.object({}),
  async execute(_input: Record<string, never>, { context }: { context: ToolContext }) {
    const { services } = context;
    const { storyteller, logger } = services;

    const pending = storyteller.checkPendingEvents(context);
    if (!pending) {
      logger.warn('TriggerStorytellerTool', 'No pending storyteller event to trigger');
      return {
        success: false,
        message: 'No pending storyteller event',
      };
    }

    await storyteller.triggerEvent(context);

    logger.info(
      'TriggerStorytellerTool',
      `Triggered storyteller event: ${pending.eventType} (plot: ${pending.plotId})`,
    );

    return {
      success: true,
      plotId: pending.plotId,
      eventType: pending.eventType,
      triggered: true,
    };
  },
});
