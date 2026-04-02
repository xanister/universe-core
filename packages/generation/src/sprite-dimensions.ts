/**
 * Look up sprite dimensions from the sprite registry.
 * Used so place width/height (footprint in parent) match the place's sprite size.
 */

import { SPRITE_REGISTRY_PATH } from '@dmnpc/data';
import type { SpriteRegistry } from '@dmnpc/types/world';
import { readJsonFile } from '@dmnpc/core/infra/read-json-file.js';

let cachedRegistry: SpriteRegistry | null = null;

async function loadRegistry(): Promise<SpriteRegistry> {
  if (process.env.NODE_ENV === 'production' && cachedRegistry) return cachedRegistry;
  cachedRegistry = await readJsonFile<SpriteRegistry>(SPRITE_REGISTRY_PATH);
  return cachedRegistry;
}

/**
 * Get width and height for a sprite by ID (from sprite registry).
 * Used to set place.position.width/height to match the place's sprite when rendered in parent.
 */
export async function getSpriteDimensions(
  spriteId: string,
): Promise<{ width: number; height: number }> {
  const registry = await loadRegistry();
  const sprite = registry.sprites[spriteId];
  if (typeof sprite.width !== 'number' || typeof sprite.height !== 'number') {
    throw new Error(`Sprite "${spriteId}" not found or missing dimensions in sprite registry.`);
  }
  return { width: sprite.width, height: sprite.height };
}
