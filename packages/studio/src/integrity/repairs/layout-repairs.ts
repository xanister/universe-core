/**
 * Layout Repairs
 *
 * Handles generating layouts for places that are missing them.
 * Layout generation creates both the tilemap and object entities.
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { ValidationIssue, ValidationContext } from '../integrity-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { getOrGenerateLayout } from '@dmnpc/generation/place/place-layout-service.js';

/**
 * Apply a layout repair by generating the layout and objects for a place.
 * Returns true if the repair was successful.
 */
export async function applyLayoutRepair(
  entity: BaseEntity,
  issue: ValidationIssue,
  _ctx: ValidationContext,
  universeCtx: UniverseContext,
): Promise<boolean> {
  if (!issue.suggestedFix || issue.suggestedFix.method !== 'layout') {
    return false;
  }

  // Only applies to places
  if (!entity.id.startsWith('PLACE_')) {
    logger.warn('LayoutRepair', `Cannot apply layout repair to non-place entity: ${entity.id}`);
    return false;
  }

  if (!isPlace(entity)) return false;

  const place = entity;

  // Skip the abstract cosmos root
  if (place.id === 'PLACE_the_cosmos') {
    logger.warn('LayoutRepair', `Cannot apply layout repair to abstract cosmos root`);
    return false;
  }

  try {
    logger.info('LayoutRepair', `Generating layout for place: ${place.id}`);

    // Force regenerate if we're repairing (existing layout might be stale)
    const forceRegenerate = issue.field === 'objects'; // Regenerate if objects issue

    const layout = await getOrGenerateLayout(universeCtx, place.id, {
      forceRegenerate,
      skipAugmentation: true, // Skip AI descriptions for faster repair
    });

    if (!layout) {
      logger.error('LayoutRepair', `Failed to generate layout for ${place.id}: no layout returned`);
      return false;
    }

    logger.info('LayoutRepair', `Successfully generated layout for ${place.id}`);

    return true;
  } catch (error) {
    logger.error('LayoutRepair', `Failed to generate layout for ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
