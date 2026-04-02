/**
 * Battle Background Repairs
 *
 * Generate missing battle background images for places.
 *
 * FEAT-192: Battle Backgrounds (Combat & Equipment System — Phase 6)
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { ValidationIssue } from '../integrity-types.js';
import {
  generateBattleBackground,
  extractTerrainHints,
} from '@dmnpc/generation/media/battle-background-generator.js';
import { loadPlaceLayout } from '@dmnpc/core/universe/universe-store.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

/**
 * Apply a battle background repair to a place entity.
 * Generates a new battle background image and sets the URL on the place.
 *
 * Returns true if the repair was applied, false otherwise.
 */
export async function applyBattleBackgroundRepair(
  entity: BaseEntity,
  issue: ValidationIssue,
  ctx: UniverseContext,
): Promise<boolean> {
  if (!issue.suggestedFix || issue.suggestedFix.method !== 'battle-background') {
    return false;
  }

  if (!isPlace(entity)) {
    logger.warn(
      'IntegrityRepair',
      `Cannot generate battle background for non-place entity: ${entity.id}`,
    );
    return false;
  }

  const place = entity;

  logger.info('IntegrityRepair', `Generating battle background for place: ${entity.id}`);

  const layout = await loadPlaceLayout(ctx.universeId, place.id);
  const terrainHints = extractTerrainHints(layout?.terrainGrid ?? null);

  const imageUrl = await generateBattleBackground(ctx, place.id, place, terrainHints);
  place.info.battleBackgroundUrl = imageUrl;

  logger.info('IntegrityRepair', `Generated battle background for ${entity.id}: ${imageUrl}`);
  return true;
}
