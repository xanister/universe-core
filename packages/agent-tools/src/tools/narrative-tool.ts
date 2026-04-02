/**
 * Describe Narrative Tool
 *
 * Unified narrative generator with type parameter.
 * Wraps the describe functions for all narrative types.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

const narrativeTypeSchema = z.enum([
  'action',
  'dialogue',
  'transition',
  'sleep',
  'storyteller_event',
]);

type NarrativeTypeInput = z.infer<typeof narrativeTypeSchema>;

export const describeNarrativeTool = tool({
  name: 'describe_narrative',
  description:
    "Generate the DM's narrative response. Choose the type based on classification: " +
    '- action: physical actions, searching, examining ' +
    '- dialogue: speaking to NPCs ' +
    '- transition: arriving at a new location ' +
    '- sleep: resting/sleeping ' +
    '- storyteller_event: when a plot event was triggered. ' +
    'Call after state changes have been executed (after execute_state_changes for Level 1, or after individual execute tools for Levels 2-4).',
  inputSchema: z.object({
    type: narrativeTypeSchema.describe('The narrative type to generate'),
  }),
  async execute({ type }: { type: NarrativeTypeInput }, { context }: { context: ToolContext }) {
    const { services } = context;
    const { narrative } = services;

    switch (type) {
      case 'action':
        await narrative.describeAction(context);
        break;
      case 'dialogue':
        await narrative.describeDialogue(context);
        break;
      case 'transition':
        await narrative.describeTransition(context);
        break;
      case 'sleep':
        await narrative.describeSleep(context);
        break;
      case 'storyteller_event':
        await narrative.describeStorytellerEvent(context);
        break;
    }
    return { generated: true, type };
  },
});
