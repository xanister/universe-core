/**
 * Character Generator Clarification Provider
 *
 * Implements ClarificationProvider for character-related questions:
 * - Relationship clarification
 * - Character attributes
 */

import { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';
import type {
  ClarificationProvider,
  ClarificationResolutionContext,
} from '@dmnpc/core/clarification/clarification-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { isRelationshipType } from '@dmnpc/types';

/**
 * Clarification provider for character-related questions.
 */
const characterGeneratorClarificationProvider: ClarificationProvider = {
  providerId: 'character-generator',
  providerName: 'Character Generator',
  categories: ['relationship', 'attribute'],

  resolveAnswer(ctx: ClarificationResolutionContext): string[] {
    const { universeCtx, question, answer } = ctx;
    const modifiedEntityIds: string[] = [];

    switch (question.category) {
      case 'relationship': {
        const rawCharacterId = question.resolutionContext.characterId;
        if (typeof rawCharacterId !== 'string')
          throw new Error('Expected characterId to be string');
        const character = universeCtx.findCharacter(rawCharacterId);
        if (character) {
          const relationshipType = answer.selectedOptionId;
          const rawTargetId = question.resolutionContext.targetId;
          if (typeof rawTargetId !== 'string') throw new Error('Expected targetId to be string');

          if (relationshipType && isRelationshipType(relationshipType)) {
            const existingRelIndex = character.relationships.findIndex(
              (r) => r.targetId === rawTargetId,
            );
            if (existingRelIndex >= 0) {
              character.relationships[existingRelIndex].type = relationshipType;
            } else {
              character.relationships.push({
                targetId: rawTargetId,
                type: relationshipType,
                disposition: null,
                familiarity: 50, // Default familiarity for newly added relationship
                context: null,
                pendingGeneration: false,
              });
            }
            universeCtx.upsertEntity('character', character);
            modifiedEntityIds.push(rawCharacterId);
            logger.info(
              'CharacterClarificationProvider',
              `Updated relationship for ${rawCharacterId}: ${relationshipType} with ${rawTargetId}`,
            );
          }
        }
        break;
      }

      case 'attribute': {
        const rawAttrCharacterId = question.resolutionContext.characterId;
        if (typeof rawAttrCharacterId !== 'string')
          throw new Error('Expected characterId to be string');
        const rawAttributeName = question.resolutionContext.attributeName;
        if (typeof rawAttributeName !== 'string')
          throw new Error('Expected attributeName to be string');
        const character = universeCtx.findCharacter(rawAttrCharacterId);

        if (character) {
          const newValue = answer.selectedOptionId ?? answer.freeformText;
          if (newValue) {
            if (rawAttributeName === 'race') {
              character.info.race = newValue;
            }
            universeCtx.upsertEntity('character', character);
            modifiedEntityIds.push(rawAttrCharacterId);
            logger.info(
              'CharacterClarificationProvider',
              `Updated ${rawAttributeName} for ${rawAttrCharacterId} to ${newValue}`,
            );
          }
        }
        break;
      }
    }

    return modifiedEntityIds;
  },
};

clarificationRegistry.register(characterGeneratorClarificationProvider);

// ============================================================================
// Question Factory Functions
// ============================================================================
