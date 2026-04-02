/**
 * AI Augmentation
 *
 * Uses AI (gpt-5.2) to generate unique descriptions for placed objects.
 * Each object gets a description that fits the place's atmosphere.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { Place } from '@dmnpc/types/entity';
import type { PlaceContext } from '@dmnpc/types/world';

// ============================================================================
// Types
// ============================================================================

interface ObjectForDescription {
  id: string;
  objectTypeId: string;
  position: { x: number; y: number };
  material?: string;
  tint?: number;
}

// ============================================================================
// Description Generation
// ============================================================================

/**
 * Generate unique descriptions for placed objects.
 *
 * @param place The place containing the objects
 * @param objects Objects to generate descriptions for
 * @param context Place context (wealth, cleanliness, etc.)
 * @returns Array of descriptions (same order as input objects)
 */
export async function generateObjectDescriptions(
  place: Place,
  objects: ObjectForDescription[],
  context: PlaceContext,
): Promise<(string | undefined)[]> {
  // Batch objects into groups to reduce API calls
  const batchSize = 10;
  const descriptions: (string | undefined)[] = new Array<string | undefined>(objects.length).fill(
    undefined,
  );

  for (let i = 0; i < objects.length; i += batchSize) {
    const batch = objects.slice(i, i + batchSize);
    const batchDescriptions = await generateBatchDescriptions(place, batch, context);

    for (let j = 0; j < batchDescriptions.length; j++) {
      descriptions[i + j] = batchDescriptions[j];
    }
  }

  return descriptions;
}

async function generateBatchDescriptions(
  place: Place,
  objects: ObjectForDescription[],
  context: PlaceContext,
): Promise<(string | undefined)[]> {
  if (objects.length === 0) {
    return [];
  }

  try {
    // Build object list for prompt
    const objectList = objects
      .map((obj, idx) => {
        const material = obj.material ? ` (${obj.material})` : '';
        return `${idx + 1}. ${obj.objectTypeId}${material}`;
      })
      .join('\n');

    const atmosphereDesc = getAtmosphereDescription(context);

    const result = await queryLlm<{ descriptions: string[] }>({
      system: `You are a creative writer generating short, evocative descriptions for objects in a ${place.info.purpose}.
Each description should:
- Be 1-2 sentences
- Fit the atmosphere: ${atmosphereDesc}
- Include sensory details when appropriate (worn wood, polished surface, faded colors)
- Vary in style - not all descriptions should start the same way
- For damaged/worn items in dirty/poor places, describe wear and tear
- For fancy items in wealthy/clean places, describe quality and craftsmanship`,

      prompt: `Generate descriptions for these objects in "${place.label}":

Place description: ${place.description}
Atmosphere: ${atmosphereDesc}

Objects:
${objectList}

Generate exactly ${objects.length} descriptions, one per line. Each description should be unique and fit the place's atmosphere.`,

      complexity: 'reasoning', // gpt-5.2 for quality descriptions
      context: 'ObjectDescriptionGenerator',
      schema: {
        name: 'object_descriptions',
        schema: {
          type: 'object',
          properties: {
            descriptions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of descriptions, one per object',
              minItems: objects.length,
              maxItems: objects.length,
            },
          },
          required: ['descriptions'],
          additionalProperties: false,
        },
      },
    });

    logger.info(
      'AIAugment',
      `Generated ${result.content.descriptions.length} descriptions for ${place.id}`,
    );

    return result.content.descriptions;
  } catch (error) {
    logger.error('AIAugment', `Failed to generate descriptions for ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });

    // Return undefined for all objects - they'll use default descriptions
    return objects.map(() => undefined);
  }
}

/**
 * Build an atmosphere description from context.
 */
function getAtmosphereDescription(context: PlaceContext): string {
  const parts: string[] = [];

  switch (context.wealth) {
    case 'high':
      parts.push('wealthy and well-appointed');
      break;
    case 'low':
      parts.push('poor and modest');
      break;
    default:
      parts.push('ordinary');
  }

  switch (context.cleanliness) {
    case 'clean':
      parts.push('clean and well-maintained');
      break;
    case 'dirty':
      parts.push('dirty and neglected');
      break;
    default:
      parts.push('showing normal wear');
  }

  switch (context.atmosphere) {
    case 'formal':
      parts.push('with a formal, dignified air');
      break;
    case 'rowdy':
      parts.push('with a rough, chaotic energy');
      break;
    default:
      parts.push('with a relaxed, casual atmosphere');
  }

  return parts.join(', ');
}
