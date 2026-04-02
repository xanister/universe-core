/**
 * Sprite Archetype Registry
 *
 * Loads and provides access to sprite archetypes that bind game races
 * to valid v3 sprite parts (head types, body types, skin colors, overlay layers).
 */

import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { join } from 'path';
import type { SpriteArchetype, HeadType } from './types.js';

let archetypes: SpriteArchetype[] | null = null;
let archetypeMap: Map<string, SpriteArchetype> | null = null;
let archetypesInjected = false;

/**
 * Load sprite archetypes from the JSON data file.
 * Call once at app startup.
 *
 * @param dataBasePath - Absolute path to the LPC data directory (containing sprite-archetypes.json)
 */
export function loadSpriteArchetypes(dataBasePath: string): SpriteArchetype[] {
  if (archetypes && (archetypesInjected || process.env.NODE_ENV === 'production'))
    return archetypes;

  const filePath = join(dataBasePath, 'sprite-archetypes.json');
  archetypes = readJsonFileSync<SpriteArchetype[]>(filePath);
  archetypeMap = new Map(archetypes.map((a) => [a.id, a]));
  archetypesInjected = false;

  return archetypes;
}

/**
 * Set archetypes directly (for testing or client-side use).
 */
export function setSpriteArchetypes(data: SpriteArchetype[]): void {
  archetypes = data;
  archetypeMap = new Map(data.map((a) => [a.id, a]));
  archetypesInjected = true;
}

/**
 * Get all loaded archetypes.
 */
export function getSpriteArchetypes(): SpriteArchetype[] {
  if (!archetypes) {
    throw new Error('Sprite archetypes not loaded. Call loadSpriteArchetypes() first.');
  }
  return archetypes;
}

/**
 * Get a specific archetype by ID.
 */
export function getSpriteArchetype(id: string): SpriteArchetype | undefined {
  if (!archetypeMap) {
    throw new Error('Sprite archetypes not loaded. Call loadSpriteArchetypes() first.');
  }
  return archetypeMap.get(id);
}

/**
 * Get all player-selectable archetypes (for character creator).
 */
export function getPlayerSelectableArchetypes(): SpriteArchetype[] {
  return getSpriteArchetypes().filter((a) => a.playerSelectable);
}

/**
 * Resolve the head type for an archetype given a gender.
 * Uses genderHeadMap if available, otherwise returns the first allowed head type.
 */
export function resolveHeadType(archetype: SpriteArchetype, gender: string): HeadType {
  if (archetype.genderHeadMap) {
    const mapped = archetype.genderHeadMap[gender] as HeadType | undefined;
    if (mapped) return mapped;
  }
  return archetype.allowedHeadTypes[0];
}

/**
 * Get the default body type for an archetype given a gender.
 */
export function resolveBodyType(
  archetype: SpriteArchetype,
  gender: string,
): SpriteArchetype['allowedBodyTypes'][number] {
  if (gender === 'male' && archetype.allowedBodyTypes.includes('male')) return 'male';
  if (gender === 'female' && archetype.allowedBodyTypes.includes('female')) return 'female';
  return archetype.allowedBodyTypes[0];
}

/**
 * Return layer types for feature layers with chance > 0 (for preview/API use).
 * Keeps this logic in sprites so callers don't need to touch featureLayers across package boundaries.
 */
export function getEnabledOverlayLayerTypes(archetype: SpriteArchetype): string[] {
  return archetype.featureLayers.filter((f) => f.chance > 0).map((f) => f.layerType);
}
