/**
 * Template Document Merger
 *
 * LLM-powered service for intelligently merging template character definitions
 * with character information extracted from documents. Preserves template identity
 * (physical traits, voice, core personality) while incorporating document-specific
 * context (world-specific lore, relationships, era-appropriate details).
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';
import type { Fact, Universe } from '@dmnpc/types/entity';
import type { TemporalStatus } from '@dmnpc/types/world';
import type { CharacterRef, TemplateMatch } from '../template-matcher.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Context from documents to be merged into the character.
 */
export interface DocumentContext {
  /** Description from the document extraction */
  documentDescription: string;
  /** Whether the character is alive at the narrative present */
  temporalStatus: TemporalStatus;
  /** The era or time period when the character was active */
  activeEra?: string;
}

/**
 * Result of merging template + document data.
 * Contains the enhanced character definition ready for generation.
 */
export interface MergedCharacterDefinition {
  /** The original template (preserved) */
  template: TemplateCharacterDefinition;
  /** Enhanced description incorporating document context */
  enhancedDescription: string;
  /** Enhanced short description */
  enhancedShortDescription: string;
  /** Additional backstory events from document context */
  additionalEvents: Fact[];
  /** Era-specific context for the character */
  eraContext?: string;
  /** Document context used in merge */
  documentContext: DocumentContext;
}

// ============================================================================
// Merge Schema
// ============================================================================

interface MergeResponse {
  enhancedDescription: string;
  enhancedShortDescription: string;
  additionalEvents: Array<{
    fact: string;
    category: 'world' | 'relationship' | 'knowledge' | 'constraint';
    significance: 'minor' | 'moderate' | 'major';
  }>;
  eraContext: string;
}

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    enhancedDescription: {
      type: 'string',
      description:
        'Enhanced character description that incorporates document context while preserving template physical traits. Should feel native to the universe.',
    },
    enhancedShortDescription: {
      type: 'string',
      description:
        'Brief 3-5 word description for when the character is not recognized (e.g., "mysterious elven jester")',
    },
    additionalEvents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description: 'A backstory event derived from the document context',
          },
          category: {
            type: 'string',
            enum: ['world', 'relationship', 'knowledge', 'constraint'],
            description: 'Category of the fact',
          },
          significance: {
            type: 'string',
            enum: ['minor', 'moderate', 'major'],
            description: 'How significant this fact is to the character',
          },
        },
        required: ['fact', 'category', 'significance'],
        additionalProperties: false,
      },
      description:
        'Additional backstory events derived from document context (0-3 events). Only include if the document provides meaningful lore.',
    },
    eraContext: {
      type: 'string',
      description:
        'Brief context about how this character fits into the era/time period mentioned in the documents. Empty string if not applicable.',
    },
  },
  required: ['enhancedDescription', 'enhancedShortDescription', 'additionalEvents', 'eraContext'],
  additionalProperties: false,
};

// ============================================================================
// Merge Function
// ============================================================================

/**
 * Merge a template character definition with document-extracted information.
 *
 * Uses LLM to intelligently combine:
 * - Template's physical traits, voice, core personality (preserved)
 * - Document's context, relationships, era-specific details (incorporated)
 *
 * @param template - The template character definition
 * @param characterRef - The character reference from the WorldBible
 * @param universe - The target universe (for tone/style context)
 */
export async function mergeCharacterSources(
  template: TemplateCharacterDefinition,
  characterRef: CharacterRef,
  universe: Omit<Universe, 'characters' | 'places'>,
): Promise<MergedCharacterDefinition> {
  logger.info(
    'TemplateMerger',
    `Merging template "${template.label}" with document context for universe "${universe.name}"`,
  );

  const documentContext: DocumentContext = {
    documentDescription: characterRef.description,
    temporalStatus: characterRef.temporalStatus,
    activeEra: characterRef.activeEra ?? undefined,
  };

  const systemPrompt = `You are merging two sources of information about the same character for a role-playing game universe.

## Source 1: Template (PRESERVE these traits)
The template defines the character's core identity that persists across universes:
- Physical appearance (MUST be preserved exactly)
- Core personality traits (MUST be preserved)
- Voice and mannerisms (MUST be preserved)

## Source 2: Document Context (INCORPORATE these details)
The document provides universe-specific context:
- Role in this particular world/story
- Relationships and connections
- Era-specific circumstances

## Target Universe
Name: ${universe.name}
Tone: ${universe.tone || 'neutral'}
Rules: ${universe.rules || 'none specified'}

## Your Task
Create an enhanced character description that:
1. Preserves ALL physical traits from the template (appearance, clothing, distinctive features)
2. Preserves the core personality from the template
3. Weaves in the document context naturally (role, relationships, circumstances)
4. Feels native to the target universe's tone and style
5. Does NOT contradict either source

The enhanced description should read as a single, cohesive character description.`;

  const userPrompt = `## Template Character
Name: ${template.label}
Description: ${template.description}
Personality: ${template.personality}
Physical Traits: ${JSON.stringify(template.physicalTraits)}

## Document Context
Description from documents: ${characterRef.description}
Temporal Status: ${characterRef.temporalStatus}
${characterRef.activeEra ? `Active Era: ${characterRef.activeEra}` : ''}

Merge these sources into an enhanced character description.`;

  try {
    const result = await queryLlm<MergeResponse>({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'reasoning',
      context: 'Character Merge',
      maxTokensOverride: 2048,
      schema: {
        name: 'merged_character',
        schema: MERGE_SCHEMA,
      },
    });

    const merged: MergedCharacterDefinition = {
      template,
      enhancedDescription: result.content.enhancedDescription,
      enhancedShortDescription: result.content.enhancedShortDescription,
      additionalEvents: result.content.additionalEvents.map((e) => ({
        fact: e.fact,
        category: e.category,
        significance: e.significance,
        subject: template.label,
        placeId: null,
        subjectId: null,
        important: false,
      })),
      eraContext: result.content.eraContext || undefined,
      documentContext,
    };

    logger.info(
      'TemplateMerger',
      `Merged "${template.label}": ${merged.additionalEvents.length} additional events`,
    );

    return merged;
  } catch (error) {
    logger.error('TemplateMerger', `Failed to merge "${template.label}", using template as-is`, {
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback: return template with document context attached but no LLM enhancement
    return {
      template,
      enhancedDescription: template.description,
      enhancedShortDescription: template.short_description,
      additionalEvents: [],
      documentContext,
    };
  }
}

/**
 * Merge multiple template matches with their document contexts.
 *
 * @param matches - Array of template matches from the matcher
 * @param universe - The target universe
 */
export async function mergeAllMatches(
  matches: TemplateMatch[],
  universe: Omit<Universe, 'characters' | 'places'>,
): Promise<MergedCharacterDefinition[]> {
  const results: MergedCharacterDefinition[] = [];

  for (const match of matches) {
    try {
      const merged = await mergeCharacterSources(match.template, match.characterRef, universe);
      results.push(merged);
    } catch (error) {
      logger.error(
        'TemplateMerger',
        `Failed to merge "${match.template.label}": ${error instanceof Error ? error.message : String(error)}`,
      );
      // Continue with other matches
    }
  }

  logger.info('TemplateMerger', `Merged ${results.length}/${matches.length} template matches`);

  return results;
}
