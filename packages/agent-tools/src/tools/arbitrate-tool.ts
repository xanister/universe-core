/**
 * Arbitrate Actions Tool
 *
 * Wraps the arbitrate function to determine outcomes, entities, and state changes.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const arbitrateActionsTool = tool({
  name: 'arbitrate_actions',
  description:
    'Execute game logic: determine outcomes, declare entities, plan state changes. ' +
    'Call after classify_input. Returns a plan that execute_state_changes will apply.',
  inputSchema: z.object({}),
  async execute(_input: Record<string, never>, { context }: { context: ToolContext }) {
    const { services } = context;
    await services.arbitration.arbitrate(context);
    const result = context.arbiterResult;

    return {
      outcome: result?.sceneContributions[0]?.outcome ?? 'unknown',
      outcomeReason: result?.sceneContributions[0]?.outcomeReason ?? null,
      stateChangesCount: result?.stateChanges.length ?? 0,
      entitiesDeclared:
        result?.stateChanges.filter((sc) => sc.type === 'create_entity').length ?? 0,
      flagsToSet: result?.flagsToSet ?? [],
      hasStorytellerEvent:
        result?.sceneContributions.some((c) => c.source === 'storyteller_event') ?? false,
      rejection: result?.rejectionReason ?? null,
    };
  },
});
