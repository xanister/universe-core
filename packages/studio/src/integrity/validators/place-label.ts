/**
 * Place Label Validator
 *
 * Unified validator for all place label issues. Handles:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ ISSUE CATEGORY         │ DETECTION                  │ RESOLUTION           │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Parenthetical details  │ hasParentheticalDetail()   │ clarificationQuestion│
 * │ (details in parens)    │ "Market (Fish Stalls)"     │ User picks new name  │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │ Generic region names   │ validateRegionLabel()      │ suggestedFix (LLM)   │
 * │ (lacks context)        │ "Harbor District"          │ Auto-add context     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Detection is mutually exclusive - each label is checked in order and stops
 * at the first match. This prevents duplicate issues for the same label.
 *
 * Resolution methods:
 * - clarificationQuestion: Requires user input (naming patterns are subjective)
 * - suggestedFix (LLM): Can be auto-fixed (adding geographic context is objective)
 */

import { getEnvironmentLabel } from '@dmnpc/types/world';
import { type Place, type BaseEntity } from '@dmnpc/types/entity';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';
import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import {
  hasParentheticalDetail,
  validateRegionLabel,
} from '@dmnpc/core/entities/place-validation.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { REGION_NAMING_RULES } from '@dmnpc/core/prompts/prompt-constants.js';
import { createPlaceNamingQuestion } from '@dmnpc/generation/place/place-clarification-provider.js';

/**
 * Categories of place label issues.
 * Used for logging and debugging to understand which detection path was taken.
 */
type PlaceLabelIssueType =
  | 'parenthetical_detail' // Parenthetical like "Name (Details)"
  | 'generic_region'; // Generic like "Harbor District"

/**
 * Validate a place's label for all known issues.
 *
 * Detection order is important - we stop at the first match to avoid
 * duplicate issues for the same problematic label.
 */
function validatePlaceLabel(place: Place, ctx: ValidationContext): ValidationIssue[] {
  const { label } = place;
  const issues: ValidationIssue[] = [];

  if (hasParentheticalDetail(label)) {
    const question = createPlaceNamingQuestion(place, 'parenthetical_detail', label);
    issues.push({
      entityId: place.id,
      entityType: 'place',
      validatorId: 'place-label',
      severity: 'error',
      field: 'label',
      message: `Label "${label}" has parenthetical details - move to description`,
      clarificationQuestion: question,
    });

    logIssue(place.id, 'parenthetical_detail', label);
    // Return early - don't stack multiple naming issues
    return issues;
  }

  const regionValidation = validateRegionLabel(label);
  if (!regionValidation.valid) {
    const parentPlace = place.position.parent ? ctx.places.get(place.position.parent) : null;
    const parentLabel = parentPlace?.label || 'unknown region';

    issues.push({
      entityId: place.id,
      entityType: 'place',
      validatorId: 'place-label',
      severity: 'warning',
      field: 'label',
      message: `${regionValidation.reason} Parent place: "${parentLabel}"`,
      suggestedFix: {
        field: 'label',
        value: {
          currentLabel: label,
          genericType: regionValidation.genericType,
          parentLabel,
        },
        confidence: 'medium',
        method: 'llm',
      },
    });

    logIssue(place.id, 'generic_region', label);
  }

  return issues;
}

/**
 * Log issue detection for debugging.
 */
function logIssue(placeId: string, issueType: PlaceLabelIssueType, label: string): void {
  const typeDescriptions: Record<PlaceLabelIssueType, string> = {
    parenthetical_detail: 'parenthetical details (needs clarification)',
    generic_region: 'generic region name (LLM auto-fix)',
  };

  logger.info(
    'PlaceLabelValidator',
    `Detected ${typeDescriptions[issueType]}: ${placeId} label="${label}"`,
  );
}

/**
 * Place Label Validator
 *
 * Validates that place labels follow naming conventions:
 * - No parenthetical details ("Name (Details)")
 * - Region names include geographic context
 *
 * @see The file header for the full issue/resolution matrix
 */
export const placeLabelValidator: Validator = {
  id: 'place-label',
  name: 'Place Label Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    // Only validate places
    if (!entity.id.startsWith('PLACE_')) {
      return [];
    }

    if (!isPlace(entity)) return [];
    return validatePlaceLabel(entity, ctx);
  },
};

/**
 * Repair a place's label to be more specific using LLM.
 * Only called for 'generic_region' issues (not naming pattern issues).
 *
 * @param place - The place to repair
 * @param ctx - Validation context
 * @param universeCtx - Universe context for persistence
 * @returns true if repair was successful
 */
export async function repairPlaceLabel(
  place: Place,
  ctx: ValidationContext,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  // Get hierarchy context
  const getAncestors = (placeId: string): Place[] => {
    const ancestors: Place[] = [];
    let current = ctx.places.get(placeId);
    while (current && current.position.parent && ancestors.length < 5) {
      const parent = ctx.places.get(current.position.parent);
      if (parent) {
        ancestors.push(parent);
        current = parent;
      } else {
        break;
      }
    }
    return ancestors;
  };

  const ancestors = getAncestors(place.id);
  const hierarchyContext = ancestors
    .reverse()
    .map(
      (p) =>
        `- ${p.label}: ${p.short_description || p.description.substring(0, 80) || 'No description'}`,
    )
    .join('\n');

  // Get sibling places for context (places with same parent)
  const siblings = Array.from(ctx.places.values())
    .filter((p) => p.position.parent === place.position.parent && p.id !== place.id)
    .slice(0, 5);
  const siblingsContext = siblings.map((p) => `- ${p.label}`).join('\n');

  const schema = {
    type: 'object' as const,
    properties: {
      newLabel: {
        type: 'string' as const,
        description: 'New specific label with geographic context',
      },
      reasoning: {
        type: 'string' as const,
        description: 'Brief explanation of the naming choice',
      },
    },
    required: ['newLabel', 'reasoning'] as const,
    additionalProperties: false as const,
  };

  try {
    const result = await queryLlm<{
      newLabel: string;
      reasoning: string;
    }>({
      system: `You are a world-building assistant. Improve place names to be globally unique and specific.

${REGION_NAMING_RULES}

CRITICAL RULES:
- The new label must be recognizable even without knowing the current location
- Include the most specific proper noun from the hierarchy (city/region name)
- Keep the original place type word (district, ward, docks, etc.)
- Do NOT just add "The" - add an actual proper noun context`,
      prompt: `Improve this place's label to be more specific and globally unique.

CURRENT LABEL: "${place.label}"
DESCRIPTION: ${place.description.substring(0, 200)}
ENVIRONMENT: ${getEnvironmentLabel(place.info.environment)}
SCALE: ${place.info.scale}

LOCATION HIERARCHY (from root to parent):
${hierarchyContext || 'No hierarchy available'}

SIBLING PLACES (same parent):
${siblingsContext || 'None'}

Generate a new label that includes geographic context from the hierarchy.
Example: "Harbor District" → "Saltfog Harbor District" (if in Saltfog)
Example: "The Docks" → "Farsreach Docks" (if in Farsreach)`,
      complexity: 'reasoning',
      context: 'PlaceLabelRepair',
      schema: {
        name: 'place_label',
        schema,
      },
    });

    const { newLabel, reasoning } = result.content;

    // Validate the new label is actually better
    const newValidation = validateRegionLabel(newLabel);
    if (!newValidation.valid) {
      logger.warn(
        'PlaceLabelValidator',
        `LLM generated label "${newLabel}" is still generic, keeping original`,
      );
      return false;
    }

    // Store old label as alias so existing references still work
    const oldLabel = place.label;
    place.aliases = place.aliases || [];
    if (!place.aliases.includes(oldLabel)) {
      place.aliases.push(oldLabel);
    }

    place.label = newLabel;
    universeCtx.upsertEntity('place', place);

    logger.info(
      'PlaceLabelValidator',
      `Repaired place ${place.id}: "${oldLabel}" -> "${newLabel}" (${reasoning})`,
    );

    return true;
  } catch (error) {
    logger.error('PlaceLabelValidator', `Failed to repair place ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
