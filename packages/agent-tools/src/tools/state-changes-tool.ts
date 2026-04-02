/**
 * Execute State Changes Tool
 *
 * Applies all state changes from the arbiter result.
 * This is handled internally by arbitrate() in the current architecture,
 * so this tool reports the state after arbitration.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const executeStateChangesTool = tool({
  name: 'execute_state_changes',
  description:
    'Apply all state changes from the arbiter result: create entities, move characters, ' +
    'update time, modify inventory, set flags. Call after arbitrate_actions.',
  inputSchema: z.object({}),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(_input: Record<string, never>, { context }: { context: ToolContext }) {
    const arbiterResult = context.arbiterResult;
    if (!arbiterResult) {
      throw new Error('No arbiter result - call arbitrate_actions first');
    }

    // State changes are already applied by arbitrate() in the current architecture
    const entityResult = context.arbiterEntityResult;

    return {
      entitiesCreated: {
        characters: entityResult?.createdCharacters.size ?? 0,
        places: entityResult?.createdPlaces.size ?? 0,
        exits: entityResult?.createdExits.size ?? 0,
      },
      stateChangesApplied: arbiterResult.stateChanges.length,
      flagsSet: context.newlySetFlags ?? [],
    };
  },
});
