/**
 * Create Place Tool
 *
 * Creates a place in the universe, wrapping existing generator functions.
 * Layout templates handle child generation (rooms, objects, NPCs) automatically.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { Place } from '@dmnpc/types/entity';
import type { GeneratorToolContext } from '../types.js';
import { createRootPlace, generatePlace, type GeneratePlaceParams } from '../../place-generator.js';
import { selectLayoutVariant, loadAllTemplates } from '../../place-layout/layout-templates.js';

const inputSchema = z.object({
  label: z.string().describe('Place name'),
  description: z.string().describe('Place description (2-3 sentences)'),
  purpose: z.string().describe('Purpose ID from catalog'),
  parentPlaceId: z.string().nullable().describe('Parent place ID. Null for root place.'),
  templateId: z.string().describe('Layout template ID from the catalog'),
  isRoot: z
    .boolean()
    .describe(
      'True for the first/root place (uses the pre-determined root template), false otherwise',
    ),
});

export const generatorCreatePlaceTool = tool({
  name: 'create_place',
  description:
    'Create a place in the universe. ' +
    'The layout template auto-generates child places, objects, and NPCs from its slots. ' +
    'Use isRoot=true for the first/root place (must be created first).',
  inputSchema,
  async execute(
    input: z.infer<typeof inputSchema>,
    { context }: { context: GeneratorToolContext },
  ) {
    const { universeContext: ctx, rootInfo } = context;

    if (input.isRoot) {
      const creationHint = buildCreationHint(context);
      const place = await createRootPlace(ctx, rootInfo.templateId, creationHint, {
        label: rootInfo.label,
        description: rootInfo.description,
        purpose: rootInfo.purpose,
      });

      await ctx.persistAll();

      logger.info('GeneratorAgent', `Created root place: ${place.id} "${place.label}"`);

      return buildResponse(ctx, place, input.purpose);
    }

    const parentId = input.parentPlaceId;
    if (!parentId) {
      throw new Error('Non-root places require parentPlaceId.');
    }

    ctx.getPlace(parentId);

    const allTemplates = loadAllTemplates();
    const match = allTemplates.find((t) => t.id === input.templateId);
    const template = match?.template;
    if (!template) {
      throw new Error(buildTemplateNotFoundError(input.purpose, input.templateId));
    }
    const variant = selectLayoutVariant(template);

    const placeParams: GeneratePlaceParams = {
      description: input.description,
      creationHint: buildCreationHint(context),
      parentId,
      label: input.label,
      environment: variant.environment,
      purpose: input.purpose,
      important: true,
      worldBible: context.worldBible ?? null,
    };

    const place = await generatePlace(ctx, placeParams);
    await ctx.persistAll();

    logger.info(
      'GeneratorAgent',
      `Created place: ${place.id} "${place.label}" (parent: ${parentId})`,
    );

    return buildResponse(ctx, place, input.purpose);
  },
});

/** Build a rich response including the full generation tree. */
function buildResponse(
  ctx: GeneratorToolContext['universeContext'],
  place: Place,
  purpose: string,
) {
  const childPlaces = ctx.getChildPlaces(place.id);
  const objects = ctx.getObjectsByPlace(place.id);

  // Collect grandchildren (children of children)
  const allDescendants: Array<{
    id: string;
    label: string;
    purpose: string;
    parentId: string | null;
    depth: number;
  }> = [];

  for (const child of childPlaces) {
    allDescendants.push({
      id: child.id,
      label: child.label,
      purpose: child.info.purpose,
      parentId: child.position.parent,
      depth: 1,
    });

    const grandchildren = ctx.getChildPlaces(child.id);
    for (const gc of grandchildren) {
      allDescendants.push({
        id: gc.id,
        label: gc.label,
        purpose: gc.info.purpose,
        parentId: gc.position.parent,
        depth: 2,
      });
    }
  }

  // Summarize what was auto-generated
  const noteParts: string[] = [];
  if (allDescendants.length > 0) {
    noteParts.push(`${allDescendants.length} child place${allDescendants.length !== 1 ? 's' : ''}`);
  }
  if (objects.length > 0) {
    noteParts.push(`${objects.length} object${objects.length !== 1 ? 's' : ''}`);
  }
  const note =
    noteParts.length > 0
      ? `Auto-generated: ${noteParts.join(', ')}. Characters will be populated after all places are created.`
      : 'No children auto-generated from this template.';

  return {
    created: true,
    id: place.id,
    label: place.label,
    purpose,
    childrenCreated: allDescendants,
    objectCount: objects.length,
    note,
  };
}

/** Build an error message with template suggestions when lookup fails. */
function buildTemplateNotFoundError(purpose: string, templateId: string): string {
  const allTemplates = loadAllTemplates();
  const suggestions = allTemplates
    .filter((t) => {
      // Suggest templates with matching or related purposes
      return (
        t.template.purposes.some((p) => p.includes(purpose) || purpose.includes(p)) ||
        t.id.includes(purpose) ||
        purpose.includes(t.id)
      );
    })
    .map((t) => `"${t.id}" (${t.template.name})`)
    .slice(0, 5);

  let msg = `No layout template found for purpose "${purpose}" with id "${templateId}".`;

  if (suggestions.length > 0) {
    msg += ` Similar templates: ${suggestions.join(', ')}.`;
  } else {
    msg += ' Use create_layout_template to create one, or try a different purpose.';
    const available = allTemplates
      .slice(0, 8)
      .map((t) => `"${t.id}"`)
      .join(', ');
    if (available) {
      msg += ` Available templates include: ${available}.`;
    }
  }

  return msg;
}

function buildCreationHint(context: GeneratorToolContext): string {
  const parts: string[] = [];
  if (context.hints.genre) parts.push(`Genre: ${context.hints.genre}`);
  if (context.hints.era) parts.push(`Era: ${context.hints.era}`);
  if (context.hints.tone) parts.push(`Tone: ${context.hints.tone}`);
  if (context.hints.artStyle) parts.push(`Art Style: ${context.hints.artStyle}`);
  if (context.hints.keyElements?.length)
    parts.push(`Key Elements: ${context.hints.keyElements.join(', ')}`);
  if (context.worldBible?.themes.length)
    parts.push(`Themes: ${context.worldBible.themes.join(', ')}`);
  return parts.length > 0 ? parts.join('\n') : 'Create something unique and imaginative.';
}
