/**
 * Place Generator Clarification Provider
 *
 * Implements ClarificationProvider for place-related questions:
 * - Place identity (are these the same place?)
 * - Place classification (environment)
 * - Place hierarchy (parent relationships)
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
import type { Place } from '@dmnpc/types/entity';
import { environmentFromPreset, isEnvironmentPresetName } from '@dmnpc/types/world';

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * Clarification provider for place-related questions.
 */
export const placeGeneratorClarificationProvider: ClarificationProvider = {
  providerId: 'place-generator',
  providerName: 'Place Generator',
  categories: ['classification', 'hierarchy', 'identity', 'attribute'],

  resolveAnswer(ctx: ClarificationResolutionContext): string[] {
    const { universeCtx, question, answer } = ctx;
    const modifiedEntityIds: string[] = [];

    switch (question.category) {
      case 'classification': {
        // Update environment based on user's answer (preset name string → EnvironmentConfig)
        const rawPlaceId = question.resolutionContext.placeId;
        if (typeof rawPlaceId !== 'string') throw new Error('Expected placeId to be string');
        const place = universeCtx.findPlace(rawPlaceId);
        if (place) {
          const presetName = answer.selectedOptionId ?? answer.freeformText;
          if (typeof presetName === 'string' && isEnvironmentPresetName(presetName)) {
            place.info.environment = environmentFromPreset(presetName);
            universeCtx.upsertEntity('place', place);
            modifiedEntityIds.push(rawPlaceId);
            logger.info(
              'PlaceClarificationProvider',
              `Updated environment for ${rawPlaceId} to ${presetName}`,
            );
          }
        }
        break;
      }

      case 'identity': {
        // Handle place identity resolution
        const rawNewPlaceId = question.resolutionContext.newPlaceId;
        if (typeof rawNewPlaceId !== 'string') throw new Error('Expected newPlaceId to be string');
        const rawExistingPlaceId = question.resolutionContext.existingPlaceId;
        if (typeof rawExistingPlaceId !== 'string')
          throw new Error('Expected existingPlaceId to be string');

        if (answer.selectedOptionId === 'same') {
          // Add alias to existing place
          const existingPlace = universeCtx.findPlace(rawExistingPlaceId);
          const rawNewLabel = question.resolutionContext.newLabel;
          if (typeof rawNewLabel !== 'string') throw new Error('Expected newLabel to be string');
          if (existingPlace && rawNewLabel) {
            universeCtx.addPlaceAlias(rawExistingPlaceId, rawNewLabel);
            modifiedEntityIds.push(rawExistingPlaceId);
            logger.info(
              'PlaceClarificationProvider',
              `Added alias "${rawNewLabel}" to ${rawExistingPlaceId}`,
            );
          }
        } else if (answer.selectedOptionId === 'child') {
          // Update new place to be child of existing place
          const newPlace = universeCtx.findPlace(rawNewPlaceId);
          if (newPlace) {
            newPlace.position.parent = rawExistingPlaceId;
            universeCtx.upsertEntity('place', newPlace);
            modifiedEntityIds.push(rawNewPlaceId);
            logger.info(
              'PlaceClarificationProvider',
              `Set ${rawNewPlaceId} as child of ${rawExistingPlaceId}`,
            );
          }
        }
        // If 'different', no action needed - places remain separate
        break;
      }

      case 'hierarchy': {
        // Update parent relationship
        const rawHierPlaceId = question.resolutionContext.placeId;
        if (typeof rawHierPlaceId !== 'string') throw new Error('Expected placeId to be string');
        const newParentId = answer.selectedOptionId ?? answer.freeformText;
        const place = universeCtx.findPlace(rawHierPlaceId);
        if (place && typeof newParentId === 'string') {
          place.position.parent = newParentId;
          universeCtx.upsertEntity('place', place);
          modifiedEntityIds.push(rawHierPlaceId);
          logger.info(
            'PlaceClarificationProvider',
            `Updated parent of ${rawHierPlaceId} to ${newParentId}`,
          );
        }
        break;
      }

      case 'attribute': {
        // Handle place label rename (from naming pattern issues)
        const rawAttrPlaceId = question.resolutionContext.placeId;
        if (typeof rawAttrPlaceId !== 'string') throw new Error('Expected placeId to be string');
        const place = universeCtx.findPlace(rawAttrPlaceId);
        const newLabel = answer.freeformText;
        if (place && newLabel) {
          const oldLabel = place.label;
          const rawExtracted = question.resolutionContext.extractedContent;
          const extractedContent = typeof rawExtracted === 'string' ? rawExtracted : null;

          place.label = newLabel;

          // Move extracted content to description if it's not already there
          if (extractedContent && !place.description.includes(extractedContent)) {
            place.description = `${extractedContent}. ${place.description}`;
          }

          universeCtx.upsertEntity('place', place);
          modifiedEntityIds.push(rawAttrPlaceId);
          logger.info(
            'PlaceClarificationProvider',
            `Renamed ${rawAttrPlaceId}: "${oldLabel}" -> "${newLabel}"`,
          );
        }
        break;
      }
    }

    return modifiedEntityIds;
  },
};

// Register provider on module load
clarificationRegistry.register(placeGeneratorClarificationProvider);

// ============================================================================
// Question Factory Functions
// ============================================================================

/**
 * Create a question about whether two places are the same.
 *
 * @param newLabel - Label of the new place
 * @param newDescription - Description of the new place
 * @param existingPlace - The existing place that might be the same
 * @param newPlaceId - ID of the new place (if already created)
 * @returns Clarification question
 */
export function createPlaceIdentityQuestion(
  newLabel: string,
  newDescription: string,
  existingPlace: Place,
  newPlaceId?: string,
): ClarificationQuestion {
  return createClarificationQuestion({
    id: generateClarificationId('place-generator', `identity_${newLabel}_${existingPlace.id}`),
    providerId: 'place-generator',
    category: 'identity',
    question: `Do "${newLabel}" and "${existingPlace.label}" refer to the same location?`,
    context: `A new place "${newLabel}" was mentioned that shares similarities with existing place "${existingPlace.label}". If they're the same location, the new name will be added as an alias. If one is inside the other, the hierarchy will be updated.`,
    options: [
      {
        id: 'same',
        label: 'Same place',
        description: `"${newLabel}" is just another name for "${existingPlace.label}"`,
      },
      {
        id: 'different',
        label: 'Different places',
        description: 'These are distinct, separate locations',
      },
      {
        id: 'child',
        label: `"${newLabel}" is inside "${existingPlace.label}"`,
        description: 'The new place is a sub-location within the existing place',
      },
    ],
    freeformAllowed: false,
    confidence: 0.5,
    currentGuess: 'different',
    affectedEntityIds: newPlaceId ? [newPlaceId, existingPlace.id] : [existingPlace.id],
    resolutionContext: {
      newLabel,
      newDescription,
      newPlaceId,
      existingPlaceId: existingPlace.id,
      existingLabel: existingPlace.label,
    },
  });
}

/**
 * Create a question about a place's parent/hierarchy.
 *
 * @param place - The place needing parent clarification
 * @param candidateParents - Possible parent places
 * @param currentGuess - Current parent ID guess
 * @returns Clarification question
 */
export function createPlaceHierarchyQuestion(
  place: Place,
  candidateParents: Place[],
  currentGuess?: string,
): ClarificationQuestion {
  const options = candidateParents.map((p) => ({
    id: p.id,
    label: p.label,
    description: `${p.info.environment.type} - ${p.short_description || p.description.slice(0, 50)}`,
  }));

  return createClarificationQuestion({
    id: generateClarificationId('place-generator', `hierarchy_${place.id}`),
    providerId: 'place-generator',
    category: 'hierarchy',
    question: `Where is "${place.label}" located?`,
    context: `The system needs to determine the parent location of "${place.label}" to build the correct geographic hierarchy.`,
    options,
    freeformAllowed: true, // Allow entering a place ID not in the list
    confidence: currentGuess ? 0.6 : 0.3,
    currentGuess: currentGuess
      ? candidateParents.find((p) => p.id === currentGuess)?.label
      : undefined,
    affectedEntityIds: [place.id],
    resolutionContext: {
      placeId: place.id,
      placeLabel: place.label,
      currentParentId: place.position.parent,
      candidateParentIds: candidateParents.map((p) => p.id),
    },
  });
}

/**
 * Create a question about a place's label that has parenthetical details.
 * Details like "(Fish Stalls)" should be in description, not the name.
 *
 * @param place - The place with the naming issue
 * @param issueType - Type of naming issue detected (parenthetical_detail)
 * @param currentLabel - The current (problematic) label
 * @returns Clarification question asking for the correct name
 */
export function createPlaceNamingQuestion(
  place: Place,
  issueType: 'parenthetical_detail',
  currentLabel: string,
): ClarificationQuestion {
  // Extract the parenthetical content
  const parenMatch = currentLabel.match(/\(([^)]+)\)/);
  const parenContent = parenMatch ? parenMatch[1] : undefined;

  return createClarificationQuestion({
    id: generateClarificationId('place-generator', `naming_${place.id}`),
    providerId: 'place-generator',
    category: 'attribute',
    question: `What should "${place.label}" be called?`,
    context: `The label contains parenthetical details "${parenContent ?? ''}". This additional info should be in the description, not the name. Or if "${parenContent ?? ''}" is the actual name, enter it below.`,
    freeformAllowed: true,
    confidence: 0.3,
    currentGuess: parenContent,
    affectedEntityIds: [place.id],
    resolutionContext: {
      placeId: place.id,
      currentLabel,
      issueType,
      extractedContent: parenContent,
    },
  });
}
