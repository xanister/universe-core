/**
 * Signal Complete Tool
 *
 * Signals that the turn processing is complete.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

const inputSchema = z.object({});

export const signalCompleteTool = tool<typeof inputSchema, { complete: boolean }, ToolContext>({
  name: 'signal_complete',
  description:
    'Signal that the turn is complete. Call this as the final step after run_extraction.',
  inputSchema,
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute() {
    return { complete: true };
  },
});
