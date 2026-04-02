/**
 * Object Selector
 *
 * Uses LLM to select the most appropriate object for a slot from filtered candidates.
 * The LLM is constrained to only select from valid options via enum in the schema.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { Place } from '@dmnpc/types/entity';
import type { PlaceContext, Purpose, GeneratedSlot } from '@dmnpc/types/world';
import { getEntitiesByPurpose, type EntityWithId } from './object-catalog.js';
import { loadPurposeCategory } from '../purpose-loader.js';

// ============================================================================
// Types
// ============================================================================

export interface SelectionContext {
  /** The slot to fill */
  slot: GeneratedSlot;
  /** The place being populated */
  place: Place;
  /** Detected context (wealth, cleanliness, etc.) */
  placeContext: PlaceContext;
  /** Purpose of the place */
  purpose: Purpose;
  /** Object type IDs already placed (to avoid excessive duplicates) */
  alreadyPlaced: string[];
}

export interface ObjectSelectionResult {
  /** Selected object type ID, or null if no suitable object */
  objectTypeId: string | null;
  /** Candidate objects that were considered */
  candidates: EntityWithId[];
}

// ============================================================================
// Seeded Random (for fallback/testing)
// ============================================================================

function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Object Selection
// ============================================================================

/**
 * Select the most appropriate object for a slot using LLM guidance.
 *
 * Process:
 * 1. Filter catalog to objects matching slot.purpose
 * 2. If 0 candidates, return null (e.g. slot is a child-place purpose with no object match)
 * 3. If 1 candidate, return it directly
 * 4. Otherwise, use LLM to select the best fit based on context
 *
 * @param ctx Selection context including slot, place, and context
 * @param seed Optional seed for deterministic fallback selection
 * @returns Selection result with object type ID and candidates
 */
export async function selectObjectForSlot(
  ctx: SelectionContext,
  seed?: number,
): Promise<ObjectSelectionResult> {
  const { slot } = ctx;

  const candidates = getEntitiesByPurpose(
    slot.purpose,
    slot.requiredTags ?? undefined,
    slot.forbiddenTags ?? undefined,
    slot.facingConstrained ? slot.facing : undefined,
  );

  if (candidates.length === 0) {
    throw new Error(
      `No objects found for purpose "${slot.purpose}"${slot.requiredTags ? ` with required tags [${slot.requiredTags.join(', ')}]` : ''}${slot.forbiddenTags ? ` excluding tags [${slot.forbiddenTags.join(', ')}]` : ''} (category: ${loadPurposeCategory(slot.purpose) ?? 'unknown'}). ` +
        `Object-category purposes need catalog entries. Place-category purposes should be handled by the generator before reaching the object selector.`,
    );
  }

  // Single candidate - no need for LLM
  if (candidates.length === 1) {
    logger.debug(
      'ObjectSelector',
      `Single candidate ${candidates[0].id} for purpose ${slot.purpose}`,
    );
    return { objectTypeId: candidates[0].id, candidates };
  }

  // Multiple candidates - use LLM to select
  try {
    const objectTypeId = await selectWithLlm(candidates, ctx);
    logger.debug(
      'ObjectSelector',
      `LLM selected ${objectTypeId} for purpose ${slot.purpose} from ${candidates.length} candidates`,
    );
    return { objectTypeId, candidates };
  } catch (error) {
    // Fallback to random selection if LLM fails
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn('ObjectSelector', `LLM selection failed, using random fallback: ${errorMsg}`);

    const rng = createRng(seed ?? Date.now());
    const fallbackIndex = Math.floor(rng() * candidates.length);
    return { objectTypeId: candidates[fallbackIndex].id, candidates };
  }
}

/**
 * Use LLM to select the best object from candidates.
 */
async function selectWithLlm(candidates: EntityWithId[], ctx: SelectionContext): Promise<string> {
  const { slot, place, placeContext, purpose, alreadyPlaced } = ctx;

  // Build candidate descriptions for the prompt
  const candidateDescriptions = candidates
    .map((c) => `- ${c.id}: ${c.name} - ${c.description} (${c.width}x${c.height}px)`)
    .join('\n');

  // Count already placed objects
  const placedCounts: Record<string, number> = {};
  for (const id of alreadyPlaced) {
    placedCounts[id] = (placedCounts[id] || 0) + 1;
  }

  const prompt = `Select the most appropriate object for this slot.

PLACE CONTEXT:
- Name: ${place.label}
- Purpose: ${purpose}
- Description: ${place.description}
- Wealth: ${placeContext.wealth}
- Cleanliness: ${placeContext.cleanliness}
- Atmosphere: ${placeContext.atmosphere}

SLOT PURPOSE: ${slot.purpose}

ALREADY PLACED IN THIS ROOM:
${
  Object.entries(placedCounts).length > 0
    ? Object.entries(placedCounts)
        .map(([id, count]) => `- ${id}: ${count}`)
        .join('\n')
    : '(none yet)'
}

AVAILABLE OBJECTS:
${candidateDescriptions}

Select the object that best fits the place's character and context. Consider:
- Wealth level affects quality/materials (wealthy places have finer furniture)
- Cleanliness affects condition
- Avoid placing too many of the same object type
- Match the atmosphere (formal vs casual vs rowdy)`;

  const result = await queryLlm<{ objectTypeId: string; reasoning: string }>({
    system: `You select appropriate furniture and objects for procedural room generation.
Given a slot's purpose and a place's context, choose the best fitting object from the available options.
Always select exactly one object from the provided list.`,
    prompt,
    complexity: 'simple',
    context: 'ObjectSelector',
    schema: {
      name: 'object_selection',
      schema: {
        type: 'object',
        properties: {
          objectTypeId: {
            type: 'string',
            description: 'The ID of the selected object type',
            enum: candidates.map((c) => c.id),
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why this object was selected (max 50 chars)',
          },
        },
        required: ['objectTypeId', 'reasoning'],
        additionalProperties: false,
      },
    },
  });

  return result.content.objectTypeId;
}

/**
 * Select object without LLM (for testing or when LLM is disabled).
 * Uses weighted random selection based on variety (prefers objects not yet placed).
 */
export function selectObjectWithoutLlm(
  ctx: SelectionContext,
  seed?: number,
): ObjectSelectionResult {
  const { slot, alreadyPlaced } = ctx;

  const candidates = getEntitiesByPurpose(
    slot.purpose,
    slot.requiredTags ?? undefined,
    slot.forbiddenTags ?? undefined,
    slot.facingConstrained ? slot.facing : undefined,
  );

  if (candidates.length === 0) {
    throw new Error(
      `No objects found for purpose "${slot.purpose}"${slot.requiredTags ? ` with required tags [${slot.requiredTags.join(', ')}]` : ''}${slot.forbiddenTags ? ` excluding tags [${slot.forbiddenTags.join(', ')}]` : ''} (category: ${loadPurposeCategory(slot.purpose) ?? 'unknown'}). ` +
        `Object-category purposes need catalog entries. Place-category purposes should be handled by the generator before reaching the object selector.`,
    );
  }

  if (candidates.length === 1) {
    return { objectTypeId: candidates[0].id, candidates };
  }

  // Count already placed objects
  const placedCounts: Record<string, number> = {};
  for (const id of alreadyPlaced) {
    placedCounts[id] = (placedCounts[id] || 0) + 1;
  }

  // Weight by inverse of placed count (prefer variety)
  const weights = candidates.map((c) => {
    const count = placedCounts[c.id] || 0;
    return 1 / (count + 1);
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const rng = createRng(seed ?? Date.now());
  let r = rng() * totalWeight;

  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      return { objectTypeId: candidates[i].id, candidates };
    }
  }

  return { objectTypeId: candidates[candidates.length - 1].id, candidates };
}
