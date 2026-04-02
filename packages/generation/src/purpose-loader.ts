/**
 * Purpose Loader
 *
 * Loads purpose IDs from the purpose registry file (purposes.json).
 * Used by generation code that needs the list of valid purposes at runtime.
 */

import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { PURPOSES_REGISTRY_PATH } from '@dmnpc/data';
import type { PurposeDefinition } from '@dmnpc/types/world';

interface PurposesRegistry {
  version: string;
  purposes: PurposeDefinition[];
}

let cachedPurposeIds: string[] | null = null;
let cachedPlacePurposeIds: string[] | null = null;

/**
 * Load the raw purposes registry from disk (always fresh read).
 */
function loadRegistry(): PurposesRegistry {
  return readJsonFileSync<PurposesRegistry>(PURPOSES_REGISTRY_PATH);
}

/**
 * Load all purpose IDs from the registry. Result is cached after first load.
 */
export function loadPurposeIds(): string[] {
  if (process.env.NODE_ENV === 'production' && cachedPurposeIds) return cachedPurposeIds;

  const registry = loadRegistry();
  cachedPurposeIds = registry.purposes.map((p) => p.id);
  return cachedPurposeIds;
}

/**
 * Load only place-category purpose IDs.
 * Used to constrain LLM schemas so only valid place purposes are offered.
 */
export function loadPlacePurposeIds(): string[] {
  if (process.env.NODE_ENV === 'production' && cachedPlacePurposeIds) return cachedPlacePurposeIds;

  const registry = loadRegistry();
  cachedPlacePurposeIds = registry.purposes.filter((p) => p.category === 'place').map((p) => p.id);
  return cachedPlacePurposeIds;
}

const cachedInteractionTypeIds = new Map<string, string | null>();

/**
 * Load the interaction type ID for a given purpose.
 * Used by object-factory to derive EntityInteraction from purpose.
 * Result is cached per purpose.
 */
export function loadInteractionTypeIdForPurpose(purpose: string): string | null {
  if (process.env.NODE_ENV === 'production' && cachedInteractionTypeIds.has(purpose))
    return cachedInteractionTypeIds.get(purpose)!;

  const registry = loadRegistry();
  const def = registry.purposes.find((p) => p.id === purpose);
  const interactionTypeId = def?.interactionTypeId ?? null;
  cachedInteractionTypeIds.set(purpose, interactionTypeId);
  return interactionTypeId;
}

const cachedPurposeCategories = new Map<string, 'object' | 'place' | 'character' | null>();

/**
 * Load the category for a given purpose.
 * Used to distinguish object/place/character-category purposes.
 * Result is cached per purpose.
 */
export function loadPurposeCategory(purpose: string): 'object' | 'place' | 'character' | null {
  if (process.env.NODE_ENV === 'production' && cachedPurposeCategories.has(purpose))
    return cachedPurposeCategories.get(purpose)!;

  const registry = loadRegistry();
  const def = registry.purposes.find((p) => p.id === purpose);
  const category = def?.category ?? null;
  cachedPurposeCategories.set(purpose, category);
  return category;
}

/**
 * Load the full PurposeDefinition for a given purpose.
 * Used by slot-character-populator and slot-routine-builder for defaultActivityId/defaultSchedule.
 * Returns null if purpose not found.
 */
export function loadPurposeDefinition(purpose: string): PurposeDefinition | null {
  const registry = loadRegistry();
  return registry.purposes.find((p) => p.id === purpose) ?? null;
}

/**
 * Clear the cached purpose IDs (e.g., after purposes are modified via API).
 */
export function clearPurposeIdsCache(): void {
  cachedPurposeIds = null;
  cachedPlacePurposeIds = null;
  cachedInteractionTypeIds.clear();
  cachedPurposeCategories.clear();
}
