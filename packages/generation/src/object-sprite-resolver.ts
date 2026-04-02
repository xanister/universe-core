/**
 * Object Sprite Resolver
 *
 * Unified sprite resolution for all object types.
 * Works alongside character-sprite-helper.ts (for characters) and
 * map image generation (for places).
 *
 * Resolution order:
 * 1. info.spriteConfig.spriteId (explicit override — always set during creation)
 * 2. Fallback to 'door_wooden' for exits without a sprite
 */

import type { ObjectEntity } from '@dmnpc/types/entity';
import { getEntityDefinition } from './place-layout/object-catalog.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve the sprite ID for any object.
 * Returns undefined if no sprite can be resolved.
 *
 * Sprites are set during entity creation (object-factory, object-generator).
 * This resolver is a safety net for objects that somehow lack a sprite.
 */
export function resolveObjectSprite(obj: ObjectEntity): string | undefined {
  // 1. Explicit sprite (always set during creation)
  if (obj.info.spriteConfig.spriteId) {
    return obj.info.spriteConfig.spriteId;
  }

  // 2. Fallback for exits
  if (obj.info.purpose === 'exit') {
    const entityDef = getEntityDefinition('door_wooden');
    return entityDef?.sprite ?? undefined;
  }

  return undefined;
}

/**
 * Check if an object has a resolvable sprite.
 */
export function hasResolvableSprite(obj: ObjectEntity): boolean {
  return resolveObjectSprite(obj) !== undefined;
}
