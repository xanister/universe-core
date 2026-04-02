/**
 * Battle Background Generator
 *
 * Generates AI battle backgrounds for places via gpt-image-1.5.
 * Produced during layout generation and stored on S3.
 * Uses universe art style for consistent aesthetics.
 *
 * FEAT-192: Battle Backgrounds (Combat & Equipment System — Phase 6)
 */

import { generateImage } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Place } from '@dmnpc/types/entity';
import { isEnclosed } from '@dmnpc/types/world';

/**
 * S3 key for a place's battle background image.
 */
export function getBattleBackgroundKey(universeId: string, placeId: string): string {
  return `universes/${universeId}/images/battles/${placeId}.png`;
}

/**
 * Build the image generation prompt for a battle background.
 *
 * Combines universe art style, place description, environment, and terrain
 * into a landscape-oriented prompt for a 2D side-view RPG battle scene.
 */
export function buildBattleBackgroundPrompt(
  universeStyle: string,
  place: Place,
  terrainHints: string[],
): string {
  const env = place.info.environment;
  const interiorLabel = isEnclosed(env) ? 'interior' : 'exterior';
  const terrainLine = terrainHints.length > 0 ? `Terrain: ${terrainHints.join(', ')}.` : '';

  const styleHint = universeStyle ? `Color palette and mood inspired by: ${universeStyle}.` : '';

  const parts = [
    'A background illustration for a 2D side-scrolling fighting game. Image size is 1536x1024 pixels.',
    'Camera: straight-on eye-level wide shot. Horizon line placed in the upper third of the frame.',
    'The ground surface must begin at or above pixel row 700 (measured from the top). Everything below row 700 should be solid, flat, walkable ground extending edge to edge with no gaps, railings, or barriers. Characters will be composited onto the ground with their feet at approximately y=717.',
    styleHint,
    place.description ? `Setting: ${place.description}` : '',
    `Environment: ${env.type}, ${interiorLabel}.`,
    terrainLine,
    'Lighting: neutral ambient, no strong time-of-day cues.',
    'No characters, no people, no UI elements, no text.',
  ];

  return parts.filter(Boolean).join('\n');
}

/**
 * Extract unique terrain hints from a terrain grid.
 *
 * Filters out non-descriptive tags (void, wall) and returns unique
 * human-readable terrain type names.
 */
export function extractTerrainHints(terrainGrid: string[][] | null): string[] {
  if (!terrainGrid) return [];

  const skip = new Set(['void', 'wall']);
  const tags = new Set<string>();

  for (const row of terrainGrid) {
    for (const tag of row) {
      if (tag && !skip.has(tag)) {
        tags.add(tag);
      }
    }
  }

  return [...tags].sort();
}

/**
 * Generate a battle background image for a place and upload to S3.
 *
 * @returns The public URL of the uploaded background image (with cache-bust).
 */
export async function generateBattleBackground(
  ctx: UniverseContext,
  placeId: string,
  place: Place,
  terrainHints: string[],
): Promise<string> {
  const prompt = buildBattleBackgroundPrompt(ctx.universe.style, place, terrainHints);

  logger.info('BattleBackgroundGenerator', `Generating battle background for ${placeId}`);

  const result = await generateImage({
    prompt,
    size: '1536x1024',
    context: 'Battle Background Generation',
  });

  const imageBuffer = Buffer.from(result.base64, 'base64');

  const key = getBattleBackgroundKey(ctx.universeId, placeId);
  const imageUrl = await storageService.uploadFile(key, imageBuffer, 'image/png');

  const imageUrlWithCacheBust = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;

  logger.info(
    'BattleBackgroundGenerator',
    `Battle background generated for ${placeId} in ${result.durationMs}ms`,
  );

  return imageUrlWithCacheBust;
}
