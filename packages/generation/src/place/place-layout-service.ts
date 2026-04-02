/**
 * Place Layout Service
 *
 * Manages place layout generation and persistence.
 * Layouts are stored as JSON files on disk and only generated once per place.
 */

import type {
  PlaceLayout,
  PlaceContext,
  GenerationResult,
  GeneratedSlot,
} from '@dmnpc/types/world';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import {
  loadPlaceLayout,
  savePlaceLayout,
  deletePlaceLayout,
} from '@dmnpc/core/universe/universe-store.js';
import { generatePlaceLayout } from '../place-layout/index.js';
import { getLayoutTemplate } from '../place-layout/layout-templates.js';
import { getSpriteDimensions } from '../sprite-dimensions.js';
import {
  generateBattleBackground,
  extractTerrainHints,
} from '../media/battle-background-generator.js';

// ============================================================================
// Layout Access
// ============================================================================

/**
 * Check if a place should have a layout generated.
 * All places get layouts (for exits and tile rendering).
 */
export function shouldHaveLayout(ctx: UniverseContext, placeId: string): boolean {
  const place = ctx.findPlace(placeId);
  if (!place) return false;

  // All places get layouts
  return true;
}

/**
 * Load an existing layout for a place.
 * Does NOT generate a layout if one doesn't exist.
 * Use this for runtime access (e.g., location-builder).
 *
 * @param ctx - Universe context for data access
 * @param placeId - The place to load layout for
 * @returns The layout if it exists, null otherwise
 */
export async function loadLayout(
  ctx: UniverseContext,
  placeId: string,
): Promise<PlaceLayout | null> {
  // Check if this place should have a layout
  if (!shouldHaveLayout(ctx, placeId)) {
    return null;
  }

  const layout = await loadPlaceLayout(ctx.universeId, placeId);
  if (layout) {
    logger.info('PlaceLayoutService', `Loaded layout for ${placeId}`);
  }
  return layout;
}

export interface GetOrGenerateLayoutOptions {
  forceRegenerate?: boolean;
  skipAugmentation?: boolean;
  seed?: number;
}

/**
 * Get or generate the layout for a place.
 *
 * This function:
 * 1. Checks if the place exists
 * 2. Loads existing layout from disk if available
 * 3. Generates a new layout if not on disk
 * 4. Saves the generated layout to disk
 *
 * Layouts are permanent - once generated, they persist until explicitly deleted.
 *
 * @param ctx - Universe context for data access and generation
 * @param placeId - The place to get/generate layout for
 * @param options - Generation options
 * @returns The layout, or null if place doesn't exist
 */
export async function getOrGenerateLayout(
  ctx: UniverseContext,
  placeId: string,
  options?: GetOrGenerateLayoutOptions,
): Promise<PlaceLayout | null> {
  const result = await getOrGenerateLayoutInternal(ctx, placeId, options);
  return result ?? null;
}

/**
 * Post-process a generated layout: save to disk, sync place fields, generate
 * battle background if needed, update dimensions, and persist.
 */
async function postProcessLayout(
  ctx: UniverseContext,
  placeId: string,
  result: GenerationResult,
): Promise<void> {
  const universeId = ctx.universeId;

  savePlaceLayout(universeId, placeId, result.layout);

  const place = ctx.findPlace(placeId);
  if (place) {
    const layoutTemplate = getLayoutTemplate(place.info.purpose);
    if (layoutTemplate) {
      place.info.spriteConfig.spriteId = layoutTemplate.spriteId;
      place.info.timeScale = layoutTemplate.timeScale;
      place.info.environment = layoutTemplate.variants[0].environment;
    }

    if (!place.info.battleBackgroundUrl) {
      const terrainHints = extractTerrainHints(result.layout.terrainGrid);
      const battleBgUrl = await generateBattleBackground(ctx, placeId, place, terrainHints);
      place.info.battleBackgroundUrl = battleBgUrl;
    }

    place.position.innerWidth = result.layout.bounds.width;
    place.position.innerHeight = result.layout.bounds.height;

    const spriteId = place.info.spriteConfig.spriteId;
    if (spriteId) {
      try {
        const { width, height } = await getSpriteDimensions(spriteId);
        place.position.width = width;
        place.position.height = height;
      } catch (err) {
        logger.warn(
          'PlaceLayoutService',
          `Could not set place ${placeId} width/height from sprite "${spriteId}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    ctx.upsertEntity('place', place);
    await ctx.persistAll();
  }
}

async function getOrGenerateLayoutInternal(
  ctx: UniverseContext,
  placeId: string,
  options?: GetOrGenerateLayoutOptions,
): Promise<PlaceLayout | null> {
  if (!shouldHaveLayout(ctx, placeId)) {
    return null;
  }

  const universeId = ctx.universeId;

  // When force-regenerating, load existing objects and context before deleting the layout
  let existingObjects: ReturnType<typeof ctx.getObjectsByPlace> | undefined;
  let existingContext: PlaceContext | undefined;

  if (options?.forceRegenerate) {
    existingObjects = ctx.getObjectsByPlace(placeId);

    const existingLayout = await loadPlaceLayout(universeId, placeId);
    existingContext = existingLayout?.context ?? undefined;

    await deletePlaceLayout(universeId, placeId);
  }

  // Try to load existing layout from disk
  if (!options?.forceRegenerate) {
    const existingLayout = await loadPlaceLayout(universeId, placeId);
    if (existingLayout) {
      logger.info('PlaceLayoutService', `Loaded existing layout for ${placeId}`);
      return existingLayout;
    }
  }

  // When generating (no layout on disk), always pass existing objects so we reuse them.
  existingObjects = existingObjects ?? ctx.getObjectsByPlace(placeId);

  logger.info('PlaceLayoutService', `Generating layout for ${placeId}`);

  // BUG-121: Generate seed before calling generatePlaceLayout so it can be
  // logged in the error path for deterministic reproduction of failures.
  const actualSeed = options?.seed ?? Date.now();

  try {
    const startTime = Date.now();
    const result = await generatePlaceLayout(ctx, {
      placeId,
      seed: actualSeed,
      skipAugmentation: options?.skipAugmentation ?? true,
      existingObjects,
      existingContext,
    });

    const duration = Date.now() - startTime;
    logger.info(
      'PlaceLayoutService',
      `Layout generated for ${placeId}: ${result.objectEntities.length} objects in ${duration}ms`,
    );

    await postProcessLayout(ctx, placeId, result);

    return result.layout;
  } catch (error) {
    logger.error(
      'PlaceLayoutService',
      `Failed to generate layout for ${placeId} (seed: ${actualSeed}): ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

// ============================================================================
// Regeneration
// ============================================================================

/** Result returned by regenerateLayout with matching metadata for the caller. */
export interface RegenerationResult {
  layout: PlaceLayout;
  matchedObjectIds: string[];
  matchedPlaceIds: string[];
  orphanedObjectIds: string[];
  orphanedPlaceIds: string[];
  unfilledPlaceSlots: GeneratedSlot[];
}

/**
 * Regenerate a place's layout, reusing existing objects and child places.
 *
 * Unlike getOrGenerateLayout (which is get-or-create), this function always
 * regenerates and returns matching metadata so the caller can handle orphans
 * and unfilled slots.
 *
 * Does NOT delete existing objects — the generator matches them to new slots.
 */
export async function regenerateLayout(
  ctx: UniverseContext,
  placeId: string,
  options?: { seed?: number; skipAugmentation?: boolean },
): Promise<RegenerationResult> {
  const universeId = ctx.universeId;

  const existingObjects = ctx.getObjectsByPlace(placeId);

  const existingLayout = await loadPlaceLayout(universeId, placeId);
  const existingContext = existingLayout?.context ?? undefined;

  await deletePlaceLayout(universeId, placeId);

  logger.info('PlaceLayoutService', `Regenerating layout for ${placeId}`);

  // BUG-121: Capture seed before calling generatePlaceLayout so it can be
  // logged in the error path for deterministic reproduction of failures.
  const actualSeed = options?.seed ?? Date.now();

  const startTime = Date.now();
  let result: GenerationResult;
  try {
    result = await generatePlaceLayout(ctx, {
      placeId,
      seed: actualSeed,
      skipAugmentation: options?.skipAugmentation ?? true,
      existingObjects,
      existingContext,
    });
  } catch (error) {
    logger.error(
      'PlaceLayoutService',
      `Failed to regenerate layout for ${placeId} (seed: ${actualSeed}): ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }

  const duration = Date.now() - startTime;
  logger.info(
    'PlaceLayoutService',
    `Layout regenerated for ${placeId}: ${result.objectEntities.length} objects in ${duration}ms`,
  );

  await postProcessLayout(ctx, placeId, result);

  const reuse = result.reuse;
  return {
    layout: result.layout,
    matchedObjectIds: reuse?.matchedObjectIds ?? [],
    matchedPlaceIds: reuse?.matchedPlaceIds ?? [],
    orphanedObjectIds: reuse?.orphanedObjectIds ?? [],
    orphanedPlaceIds: reuse?.orphanedPlaceIds ?? [],
    unfilledPlaceSlots: reuse?.unfilledPlaceSlots ?? [],
  };
}
