/**
 * Generation Context
 *
 * Provides context about available entities (storytellers, template characters)
 * for use in generation prompts. This allows generators to:
 * - Recommend appropriate storytellers based on pacing requirements
 * - Reference template characters by name when mentioned in prompts
 * - Avoid creating duplicates of existing entities
 */

import { logger } from '@dmnpc/core/infra/logger.js';
import { listStorytellers } from '@dmnpc/core/stores/storyteller-store.js';
import { listTemplateCharacters } from '@dmnpc/core/stores/template-character-store.js';
import type { StorytellerDefinition, TemplateCharacterDefinition } from '@dmnpc/types/npc';

/**
 * Options for building generation context.
 */
export interface GenerationContextOptions {
  /** Include available storytellers with pacing info */
  includeStorytellers?: boolean;
  /** Include available template characters */
  includeTemplateCharacters?: boolean;
  /** Maximum number of storytellers to include (default: 10) */
  maxStorytellers?: number;
  /** Maximum number of template characters to include (default: 10) */
  maxTemplates?: number;
}

/**
 * Format a single storyteller for prompt context.
 * Includes id, label, pacing, and a brief description.
 */
function formatStoryteller(storyteller: StorytellerDefinition): string {
  const tonePart = storyteller.tone ? ` [${storyteller.tone}]` : '';
  // Truncate description to keep context concise
  const desc =
    storyteller.description.length > 80
      ? storyteller.description.substring(0, 77) + '...'
      : storyteller.description;
  return `- ${storyteller.id}: "${storyteller.label}" (pacing: ${storyteller.pacing})${tonePart} - ${desc}`;
}

/**
 * Format a single template character for prompt context.
 * Includes id, label, short description, and backstory themes.
 */
function formatTemplateCharacter(template: TemplateCharacterDefinition): string {
  const themes = template.backstoryThemes.slice(0, 3).join(', ') || '';
  const themePart = themes ? ` (themes: ${themes})` : '';
  return `- ${template.id}: "${template.label}" - ${template.short_description || template.label}${themePart}`;
}

/**
 * Build context string for available storytellers.
 * Useful for scenario generation to recommend appropriate pacing.
 */
export async function buildStorytellerContext(maxCount: number = 10): Promise<string> {
  try {
    const storytellers = await listStorytellers();

    if (storytellers.length === 0) {
      return '';
    }

    // Sort by pacing for easier scanning (very-fast, fast, moderate, slow)
    const pacingOrder: Record<string, number> = {
      'very-fast': 0,
      fast: 1,
      moderate: 2,
      slow: 3,
    };
    const sorted = [...storytellers].sort(
      (a, b) => (pacingOrder[a.pacing] ?? 2) - (pacingOrder[b.pacing] ?? 2),
    );

    const limited = sorted.slice(0, maxCount);
    const formatted = limited.map(formatStoryteller).join('\n');

    return `AVAILABLE STORYTELLERS (recommend based on desired pacing):
${formatted}

PACING GUIDANCE:
- "very-fast" or "fast": For quick/short stories, immediate action, minimal buildup
- "moderate": For balanced stories with exploration and character development
- "slow": For deep narratives, complex plots, extensive world-building`;
  } catch (error) {
    logger.error('GenerationContext', 'Failed to build storyteller context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Build context string for available template characters.
 * Useful for scenario/plot generation when user mentions a character by name.
 */
export async function buildTemplateCharacterContext(maxCount: number = 10): Promise<string> {
  try {
    const templates = await listTemplateCharacters();

    if (templates.length === 0) {
      return '';
    }

    const limited = templates.slice(0, maxCount);
    const formatted = limited.map(formatTemplateCharacter).join('\n');

    return `AVAILABLE TEMPLATE CHARACTERS (use templateCharacterId if prompt mentions one):
${formatted}

TEMPLATE CHARACTER GUIDANCE:
- If the user's prompt mentions a character by name (e.g., "a story about Pipras Pennyroyal"), use their templateCharacterId
- Template characters have pre-defined personalities, appearances, and backstory themes
- When using a template, the scenario should build on their established themes`;
  } catch (error) {
    logger.error('GenerationContext', 'Failed to build template character context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Build context string for existing storytellers (for avoiding duplicates).
 * Used by the storyteller generator to create distinct new storytellers.
 */
export async function buildExistingStorytellersContext(maxCount: number = 10): Promise<string> {
  try {
    const storytellers = await listStorytellers();

    if (storytellers.length === 0) {
      return '';
    }

    const limited = storytellers.slice(0, maxCount);
    const formatted = limited.map(formatStoryteller).join('\n');

    return `EXISTING STORYTELLERS (create something distinct from these):
${formatted}

Avoid duplicating names, themes, or pacing combinations that already exist.`;
  } catch (error) {
    logger.error('GenerationContext', 'Failed to build existing storytellers context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Build context string for existing template characters (for avoiding duplicates).
 * Used by the template generator to create distinct new characters.
 */
export async function buildExistingTemplatesContext(maxCount: number = 10): Promise<string> {
  try {
    const templates = await listTemplateCharacters();

    if (templates.length === 0) {
      return '';
    }

    const limited = templates.slice(0, maxCount);
    const formatted = limited.map(formatTemplateCharacter).join('\n');

    return `EXISTING TEMPLATE CHARACTERS (create something distinct from these):
${formatted}

Avoid duplicating names, archetypes, or personality combinations that already exist.`;
  } catch (error) {
    logger.error('GenerationContext', 'Failed to build existing templates context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Build combined generation context with multiple entity types.
 * Useful for generators that need awareness of multiple entity types.
 */
export async function buildGenerationContext(options: GenerationContextOptions): Promise<string> {
  const sections: string[] = [];

  if (options.includeStorytellers) {
    const storytellerContext = await buildStorytellerContext(options.maxStorytellers);
    if (storytellerContext) {
      sections.push(storytellerContext);
    }
  }

  if (options.includeTemplateCharacters) {
    const templateContext = await buildTemplateCharacterContext(options.maxTemplates);
    if (templateContext) {
      sections.push(templateContext);
    }
  }

  return sections.join('\n\n');
}

/**
 * Get a simple list of template character names and IDs for quick reference.
 * Useful for plot generation where full context isn't needed.
 */
export async function getTemplateCharacterList(): Promise<
  Array<{ id: string; label: string; shortDescription: string }>
> {
  try {
    const templates = await listTemplateCharacters();
    return templates.map((t) => ({
      id: t.id,
      label: t.label,
      shortDescription: t.short_description || t.label,
    }));
  } catch (error) {
    logger.error('GenerationContext', 'Failed to get template character list', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get a simple list of storyteller IDs and pacing for quick reference.
 */
export async function getStorytellerList(): Promise<
  Array<{ id: string; label: string; pacing: string }>
> {
  try {
    const storytellers = await listStorytellers();
    return storytellers.map((s) => ({
      id: s.id,
      label: s.label,
      pacing: s.pacing,
    }));
  } catch (error) {
    logger.error('GenerationContext', 'Failed to get storyteller list', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
