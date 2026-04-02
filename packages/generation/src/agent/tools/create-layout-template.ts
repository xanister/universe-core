/**
 * Create Layout Template Tool
 *
 * Creates a new layout template via the existing 2-pass LLM pipeline.
 * Only needed when no existing template fits a desired place type.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { GeneratorToolContext } from '../types.js';
import { generateLayoutTemplate } from '../../place/layout-template-generator.js';

const inputSchema = z.object({
  prompt: z
    .string()
    .describe(
      'Description of the desired layout template. Be specific about the place type, ' +
        'expected rooms/areas, atmosphere, and scale.',
    ),
  environmentType: z
    .enum(['interior', 'exterior', 'space', 'underwater'])
    .describe('Environment type'),
  size: z.enum(['small', 'medium', 'large']).describe('Size of the template'),
});

export const createLayoutTemplateTool = tool({
  name: 'create_layout_template',
  description:
    'Create a new layout template when no existing template fits. ' +
    'This is EXPENSIVE (two LLM calls). Only use when the catalog has nothing suitable. ' +
    'Provide a detailed prompt describing the desired place type.',
  inputSchema,
  async execute(input: z.infer<typeof inputSchema>, _opts: { context: GeneratorToolContext }) {
    logger.info('GeneratorAgent', `Creating layout template: "${input.prompt.slice(0, 80)}..."`);

    const result = await generateLayoutTemplate({
      prompt: input.prompt,
      environmentType: input.environmentType,
      size: input.size,
    });

    logger.info(
      'GeneratorAgent',
      `Created template: "${result.suggestedId}" with ${result.template.variants.length} variants`,
    );

    return {
      created: true,
      templateId: result.suggestedId,
      name: result.template.name,
      purposes: result.template.purposes,
      variantCount: result.template.variants.length,
    };
  },
});
