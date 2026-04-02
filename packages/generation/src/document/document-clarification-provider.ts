/**
 * Document Processor Clarification Provider
 *
 * Implements ClarificationProvider for document extraction questions:
 * - Temporal status (is character contemporary or historical?)
 * - Place hierarchy (are these places in the same country/region?)
 * - Entity identity (are these the same person/place mentioned differently?)
 */

import { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';
import {
  type ClarificationProvider,
  type ClarificationResolutionContext,
  type ClarificationQuestion,
  createClarificationQuestion,
  generateClarificationId,
} from '@dmnpc/core/clarification/clarification-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { WorldBibleCharacterRef } from '@dmnpc/types/world';

/**
 * Clarification provider for document extraction questions.
 * Handles uncertainties that arise during WorldBible creation.
 */
const documentProcessorClarificationProvider: ClarificationProvider = {
  providerId: 'document-processor',
  providerName: 'Document Processor',
  categories: ['temporal', 'hierarchy', 'identity'],

  resolveAnswer(ctx: ClarificationResolutionContext): string[] {
    const { question, answer } = ctx;

    logger.info(
      'DocumentClarificationProvider',
      `Recorded answer for ${question.category} question: ${answer.selectedOptionId ?? answer.freeformText}`,
    );

    // Return affected entity IDs from resolution context
    return question.affectedEntityIds;
  },
};

clarificationRegistry.register(documentProcessorClarificationProvider);

// ============================================================================
// Question Factory Functions
// ============================================================================

/**
 * Create a question about a character's temporal status.
 *
 * @param character - Character reference from WorldBible extraction
 * @param sourceDocument - Document filename where character was found
 * @returns Clarification question
 */
export function createTemporalStatusQuestion(
  character: WorldBibleCharacterRef,
  sourceDocument?: string,
): ClarificationQuestion {
  const displayName = character.title ? `${character.title} ${character.name}` : character.name;

  return createClarificationQuestion({
    id: generateClarificationId('document-processor', `temporal_${character.name}`),
    providerId: 'document-processor',
    category: 'temporal',
    question: `Is "${displayName}" alive at the story's present time?`,
    context: `The document mentions "${displayName}" but it's unclear if they are a contemporary character (alive now, can be an NPC) or a historical figure (deceased, part of lore/history). ${character.description}`,
    options: [
      {
        id: 'contemporary',
        label: 'Contemporary (alive)',
        description: 'This character is alive at the narrative present and can appear as an NPC',
      },
      {
        id: 'historical',
        label: 'Historical (deceased)',
        description:
          'This character is from the past - a legendary figure, ancient ruler, or deceased person',
      },
      {
        id: 'uncertain',
        label: 'Keep as uncertain',
        description: 'Not enough information to determine; let the system decide contextually',
      },
    ],
    freeformAllowed: false,
    confidence: 0.4,
    currentGuess: character.temporalStatus,
    affectedEntityIds: [],
    sourceDocument,
    resolutionContext: {
      characterName: character.name,
      characterTitle: character.title,
      characterDescription: character.description,
      currentStatus: character.temporalStatus,
      activeEra: character.activeEra,
    },
  });
}
