/**
 * Classify Input Tool
 *
 * Wraps classifyPlayerInput to parse player messages into action sequences.
 */

import { getMessageText } from '@dmnpc/types/game';
import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const classifyInputTool = tool({
  name: 'classify_input',
  description:
    "Parse the player's message into an ordered sequence of actions. " +
    'Returns action types (Dialogue, Transition, Action, Sleep, Creative) with targets. ' +
    'Call this FIRST to understand what the player is trying to do.',
  inputSchema: z.object({}),
  async execute(_input: Record<string, never>, { context }: { context: ToolContext }) {
    const { services } = context;
    const text = getMessageText(context.userMessage) ?? '';
    const result = await services.classification.classifyPlayerInput(
      context.universe,
      context.character.id,
      text,
    );
    context.classificationResult = result;
    return {
      actions: result.actions.map((a) => ({
        type: a.type,
        intent: a.intent,
        targetRef: a.targetRef,
        targetId: a.targetId,
      })),
      rejection: result.rejection,
    };
  },
});
