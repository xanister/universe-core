/**
 * Fact Formatter (Shared)
 *
 * Utilities for formatting facts with entity ID resolution.
 * Extracted for use by generation/ layer (journal-entry-generator).
 */

import type { UniverseContext } from '../universe/universe-context.js';

/**
 * Format a fact string by replacing entity IDs with human-readable labels.
 *
 * Uses character knowledge to decide what name to show:
 * - CHAR_* → character label (if known) or short_description
 * - PLACE_* → place label (places are always "known")
 *
 * @param fact - The raw fact string containing entity IDs
 * @param readerId - The character who will "read" this fact
 * @param ctx - Universe context for entity and knowledge lookups
 * @returns The fact with entity IDs replaced by readable names/descriptions
 */
export function formatFactForReader(fact: string, readerId: string, ctx: UniverseContext): string {
  let result = fact;

  const charMatches = fact.match(/CHAR_[a-z0-9_]+/gi) || [];
  for (const charId of charMatches) {
    const char = ctx.findCharacter(charId);
    if (!char) continue;
    const displayName = ctx.isKnown(readerId, charId)
      ? char.label
      : char.short_description || 'someone';
    result = result.replace(new RegExp(charId, 'g'), displayName);
  }

  const placeMatches = fact.match(/PLACE_[a-z0-9_]+/gi) || [];
  for (const placeId of placeMatches) {
    const place = ctx.findPlace(placeId);
    if (!place) continue;
    result = result.replace(new RegExp(placeId, 'g'), place.label);
  }

  return result;
}
