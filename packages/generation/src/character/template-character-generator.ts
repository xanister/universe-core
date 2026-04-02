/**
 * Template Character Generator
 *
 * Thin wrapper around generateCharacter for the template flow.
 * Delegates to character-generator; ensures portrait and in-world sprite via common tail.
 */

import { runWithConcurrency } from '@dmnpc/core/infra/concurrency.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Character, Universe } from '@dmnpc/types/entity';
import { generateCharacter } from '../character-generator.js';
import type { MergedCharacterDefinition } from '../document/template-document-merger.js';

/**
 * Maximum number of concurrent character generation tasks.
 * Each character involves 2-3 LLM calls + image generation, so 3 concurrent
 * characters means ~9-12 concurrent API calls. Conservative for rate limits.
 */
const CHARACTER_GEN_CONCURRENCY = 3;

// ============================================================================
// Types
// ============================================================================

export interface GenerateFromTemplateParams {
  /** Template ID to generate from */
  templateId: string;
  /** The universe to generate the character for */
  universe: Universe;
  /** Optional merged definition with enhanced description from document context */
  mergedDef?: MergedCharacterDefinition;
  /** Optional universe-specific guidance for generation */
  guidance?: string;
  /** Pre-computed stats from the universe's active ruleset */
  stats?: Record<string, number>;
  /** Weapon ID from the universe's active ruleset */
  weapon?: string | null;
}

export interface GenerateFromTemplateResult {
  /** The generated character */
  character: Character;
  /** Whether generation was successful */
  success: boolean;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Generates a character from a template for a specific universe.
 * Delegates to generateCharacter with templateId/guidance/mergedDef; portrait and sprite
 * are ensured by the common tail. Persists to disk when used outside route context.
 */
export async function generateCharacterFromTemplate(
  ctx: UniverseContext,
  { templateId, mergedDef, guidance, stats, weapon }: Omit<GenerateFromTemplateParams, 'universe'>,
): Promise<GenerateFromTemplateResult> {
  logger.info(
    'Template Generator',
    `Generating character from template: templateId=${templateId} universeId=${ctx.universe.id}${mergedDef ? ' (with merged document context)' : ''}`,
  );

  const character = await generateCharacter({
    ctx,
    templateId,
    guidance,
    mergedDef,
    stats,
    weapon: weapon ?? undefined,
  });

  await ctx.persistAll();

  logger.info(
    'Template Generator',
    `Generated character from template: ${character.label} (${character.id})`,
  );

  return {
    character,
    success: true,
  };
}

/**
 * Generates multiple characters from templates for a universe.
 * Runs up to CHARACTER_GEN_CONCURRENCY generations in parallel.
 * Returns all successfully generated characters; individual failures are logged but do not abort the batch.
 */
export async function generateCharactersFromTemplates(
  ctx: UniverseContext,
  templateIds: string[],
): Promise<Character[]> {
  if (templateIds.length === 0) return [];

  const tasks = templateIds.map(
    (templateId) => () => generateCharacterFromTemplate(ctx, { templateId }),
  );

  const results = await runWithConcurrency(tasks, CHARACTER_GEN_CONCURRENCY, 'Template Characters');

  const characters: Character[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value.success) {
      characters.push(result.value.character);
    } else if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      logger.error(
        'Template Generator',
        `Failed to generate from template ${templateIds[i]}: ${reason}`,
      );
    }
  }

  return characters;
}

/**
 * Generates characters from merged definitions (template + document context).
 * Runs up to CHARACTER_GEN_CONCURRENCY generations in parallel.
 * Returns all successfully generated characters; individual failures are logged but do not abort the batch.
 */
export async function generateCharactersFromMergedDefinitions(
  ctx: UniverseContext,
  mergedDefs: MergedCharacterDefinition[],
): Promise<Character[]> {
  if (mergedDefs.length === 0) return [];

  const tasks = mergedDefs.map(
    (mergedDef) => () =>
      generateCharacterFromTemplate(ctx, {
        templateId: mergedDef.template.id,
        mergedDef,
      }),
  );

  const results = await runWithConcurrency(tasks, CHARACTER_GEN_CONCURRENCY, 'Merged Characters');

  const characters: Character[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value.success) {
      characters.push(result.value.character);
    } else if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      logger.error(
        'Template Generator',
        `Failed to generate from merged template ${mergedDefs[i].template.id}: ${reason}`,
      );
    }
  }

  logger.info(
    'Template Generator',
    `Generated ${characters.length}/${mergedDefs.length} characters from merged definitions`,
  );

  return characters;
}
