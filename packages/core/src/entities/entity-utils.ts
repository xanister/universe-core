/**
 * Entity Utilities
 *
 * Generic utility functions for working with entities.
 */

import type { BaseEntity, Character } from '@dmnpc/types/entity';
import type { UniverseContext } from '../universe/universe-context.js';

/**
 * Entity with a computed displayName field based on player's knowledge.
 */
export type EntityWithDisplayName<T extends BaseEntity = BaseEntity> = T & {
  displayName: string;
};

/**
 * Computes the display name for an entity based on player's knowledge.
 * Uses event-based name knowledge via ctx.isKnown().
 *
 * Exits always use their label (destination name) since they're not "known" like characters.
 */
export function computeDisplayName(
  entity: BaseEntity,
  player: Character,
  ctx?: UniverseContext,
): string {
  // Player always knows themselves
  if (entity.id === player.id) {
    return entity.label;
  }

  // Exits always show destination name (label), not exit type (short_description)
  if (entity.entityType === 'object') {
    return entity.label;
  }

  // Use context-based check if available (queries events via witnessIds)
  if (ctx) {
    const isKnown = ctx.isKnown(player.id, entity.id);
    return isKnown ? entity.label : entity.short_description || entity.description;
  }

  // Without context, use short_description or description. Never return empty — label is required on BaseEntity.
  return entity.short_description || entity.description || entity.label;
}

/**
 * Add displayName to entities based on player's knowledge.
 * Returns new entities array with displayName field added.
 *
 * @param entities - Array of entities to enrich
 * @param player - The player character whose knowledge determines display names
 * @param ctx - Optional universe context for memory-based lookups
 * @returns New array with displayName added to each entity
 */
export function addDisplayNames<T extends BaseEntity>(
  entities: T[],
  player: Character,
  ctx?: UniverseContext,
): EntityWithDisplayName<T>[] {
  return entities.map((entity) => ({
    ...entity,
    displayName: computeDisplayName(entity, player, ctx),
  }));
}

/**
 * Checks if a search term matches an entity's label or any of its aliases.
 * Case-insensitive comparison.
 *
 * @param searchTerm - The term to search for
 * @param entity - The entity to match against
 * @returns true if the search term matches the entity's label or any alias
 */
export function matchesEntityByName(searchTerm: string, entity: BaseEntity): boolean {
  const normalized = searchTerm.toLowerCase().trim();
  if (!normalized) return false;

  const names = [entity.label, ...(entity.aliases ?? [])];
  return names.some((name) => name.toLowerCase().trim() === normalized);
}

/**
 * Checks if a search term partially matches an entity's label or any of its aliases.
 * Case-insensitive substring matching.
 *
 * @param searchTerm - The term to search for
 * @param entity - The entity to match against
 * @returns true if the search term is contained in the entity's label or any alias
 */
export function partialMatchEntityByName(searchTerm: string, entity: BaseEntity): boolean {
  const normalized = searchTerm.toLowerCase().trim();
  if (!normalized) return false;

  const names = [entity.label, ...(entity.aliases ?? [])];
  return names.some((name) => name.toLowerCase().includes(normalized));
}

/**
 * Finds an entity by name from a list of entities.
 * First tries exact match, then falls back to partial match.
 *
 * @param searchTerm - The term to search for
 * @param entities - List of entities to search through
 * @returns The matching entity, or undefined if not found
 */
export function findEntityByName<T extends BaseEntity>(
  searchTerm: string,
  entities: T[],
): T | undefined {
  const exactMatch = entities.find((e) => matchesEntityByName(searchTerm, e));
  if (exactMatch) return exactMatch;

  return entities.find((e) => partialMatchEntityByName(searchTerm, e));
}

/**
 * Normalize a name for matching (lowercase, trim, remove extra spaces).
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}
