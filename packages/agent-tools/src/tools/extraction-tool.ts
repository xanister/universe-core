/**
 * Run Extraction Tool
 *
 * Wraps runTurnExtraction to extract name/place reveals from the DM's response.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const runExtractionTool = tool({
  name: 'run_extraction',
  description:
    "Extract name/place reveals from the DM's response. " +
    'Updates player knowledge about characters and locations. ' +
    'Call after describe_narrative.',
  inputSchema: z.object({}),
  async execute(_input: Record<string, never>, { context }: { context: ToolContext }) {
    const { services } = context;
    await services.extraction.runTurnExtraction(context);
    return { extracted: true };
  },
});
