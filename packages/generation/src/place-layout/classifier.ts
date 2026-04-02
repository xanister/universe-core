/**
 * Place Classifier
 *
 * Uses AI to detect the context (wealth, cleanliness, etc.) of a place
 * from its description and tags. LLM-first approach for accuracy.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { Place } from '@dmnpc/types/entity';
import type { PlaceContext } from '@dmnpc/types/world';

// ============================================================================
// Context Detection
// ============================================================================

/** Default context when LLM fails */
const DEFAULT_CONTEXT: PlaceContext = {
  wealth: 'moderate',
  cleanliness: 'worn',
  crowding: 'normal',
  atmosphere: 'casual',
};

/**
 * Detect the context (wealth, cleanliness, etc.) of a place using AI.
 *
 * @param place The place to analyze
 * @returns Detected context
 */
export async function detectContext(place: Place): Promise<PlaceContext> {
  try {
    const result = await queryLlm<PlaceContext>({
      system: `You analyze RPG locations to detect their atmosphere and context.

Based on the description, determine:
- wealth: high (wealthy, prestigious, ornate) | moderate (typical, ordinary) | low (poor, rundown, cheap)
- cleanliness: clean (well-kept, tidy) | worn (used, lived-in) | dirty (grimy, neglected, filthy)
- crowding: sparse (empty, quiet) | normal (typical) | packed (crowded, busy)
- atmosphere: formal (proper, dignified) | casual (relaxed, friendly) | rowdy (loud, chaotic, dangerous)

Default to moderate/worn/normal/casual if no clear indicators.`,
      prompt: `Analyze this place's context:

Name: ${place.label}
Description: ${place.description}
Tags: ${place.tags.join(', ') || 'none'}`,
      complexity: 'simple',
      context: 'PlaceContextDetector',
      schema: {
        name: 'place_context',
        schema: {
          type: 'object',
          properties: {
            wealth: {
              type: 'string',
              enum: ['high', 'moderate', 'low'],
            },
            cleanliness: {
              type: 'string',
              enum: ['clean', 'worn', 'dirty'],
            },
            crowding: {
              type: 'string',
              enum: ['sparse', 'normal', 'packed'],
            },
            atmosphere: {
              type: 'string',
              enum: ['formal', 'casual', 'rowdy'],
            },
          },
          required: ['wealth', 'cleanliness', 'crowding', 'atmosphere'],
          additionalProperties: false,
        },
      },
    });

    logger.info(
      'PlaceClassifier',
      `Detected context for ${place.id}: ${JSON.stringify(result.content)}`,
    );
    return result.content;
  } catch (error) {
    logger.error('PlaceClassifier', `Context detection failed for ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_CONTEXT;
  }
}
