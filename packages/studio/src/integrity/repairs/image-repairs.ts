/**
 * Image-Based Repairs
 *
 * Generate missing entity images using the entity image service.
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import type { ValidationIssue } from '../integrity-types.js';
import { generateEntityImage } from '@dmnpc/generation/media/entity-image-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

type EntityType = 'character' | 'place';

/**
 * Determine the entity type from an entity ID.
 */
function getEntityType(entityId: string): EntityType | null {
  if (entityId.startsWith('CHAR_')) return 'character';
  if (entityId.startsWith('PLACE_')) return 'place';
  return null;
}

/**
 * Apply an image repair to an entity.
 * Generates a new image for the entity.
 *
 * Returns true if the repair was applied, false otherwise.
 */
export async function applyImageRepair(
  entity: BaseEntity,
  issue: ValidationIssue,
  ctx: UniverseContext,
): Promise<boolean> {
  if (!issue.suggestedFix || issue.suggestedFix.method !== 'image') {
    return false;
  }

  const entityType = getEntityType(entity.id);
  if (!entityType) {
    logger.warn('IntegrityRepair', `Cannot generate image for unknown entity type: ${entity.id}`);
    return false;
  }

  try {
    logger.info('IntegrityRepair', `Generating image for ${entityType}: ${entity.id}`);

    const imageUrl = await generateEntityImage(ctx, entity.id, entityType);

    if (imageUrl) {
      entity.image = imageUrl;
      // Note: Manual persistence removed - relying on async handler from route context
      logger.info('IntegrityRepair', `Generated image for ${entity.id}: ${imageUrl}`);
      return true;
    }

    logger.warn('IntegrityRepair', `Image generation returned null for ${entity.id}`);
    return false;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to generate image for ${entity.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
