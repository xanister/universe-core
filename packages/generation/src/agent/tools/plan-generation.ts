/**
 * Plan Generation Tool
 *
 * Agent declares its generation plan before creating places.
 * Aids debuggability — we can see what the agent intended.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { GeneratorToolContext, GenerationPlan } from '../types.js';

const inputSchema = z.object({
  overview: z.string().describe('Brief summary of the universe structure you plan to create'),
  places: z
    .array(
      z.object({
        label: z.string().describe('Place name'),
        purpose: z
          .string()
          .describe('Purpose ID from the catalog (e.g., "cosmos", "planet", "tavern")'),
        parentLabel: z
          .string()
          .nullable()
          .describe('Label of the parent place, or null for the root'),
        templateId: z.string().describe('Layout template ID from the catalog'),
        description: z.string().describe('Brief description of this place'),
      }),
    )
    .describe('Planned place hierarchy (root first, then children in creation order)'),
  customTemplatesNeeded: z.boolean().describe('Whether you need to create new layout templates'),
});

export const planGenerationTool = tool({
  name: 'plan_generation',
  description:
    'Declare your generation plan before creating places. ' +
    'List the place hierarchy you intend to build (root first) ' +
    'and whether custom layout templates are needed. Call this FIRST.',
  inputSchema,
  async execute(
    input: z.infer<typeof inputSchema>,
    { context }: { context: GeneratorToolContext },
  ) {
    await Promise.resolve();
    const plan: GenerationPlan = {
      overview: input.overview,
      places: input.places,
      customTemplatesNeeded: input.customTemplatesNeeded,
    };

    if (plan.places.length === 0) {
      throw new Error('Plan must include at least one place (the root).');
    }

    const rootPlaces = plan.places.filter((p) => p.parentLabel === null);
    if (rootPlaces.length !== 1) {
      throw new Error(
        `Plan must have exactly one root place (parentLabel: null). Found ${rootPlaces.length}.`,
      );
    }

    context.session.plan = plan;

    logger.info(
      'GeneratorAgent',
      `Plan declared: ${plan.places.length} places, customTemplates=${plan.customTemplatesNeeded}`,
    );

    return {
      accepted: true,
      summary: `Plan accepted: ${plan.places.length} places.`,
    };
  },
});
