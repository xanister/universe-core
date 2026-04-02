/**
 * World Bible Merger
 *
 * Service for intelligently merging two WorldBibles.
 * Used when re-parsing documents to update an existing WorldBible
 * without losing established lore.
 *
 * Merge strategy:
 * - Documents are the source of truth (new extractions preferred)
 * - Characters/Places: Merge by name, prefer document descriptions
 * - Arrays (themes, rules, keyConflicts): Union with deduplication
 * - String fields: Synthesize using LLM, preferring document content
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { WorldBible, WorldBibleCharacterRef, WorldBiblePlaceRef } from '@dmnpc/types/world';

// ============================================================================
// Types
// ============================================================================

export interface MergeResult {
  worldBible: WorldBible;
  stats: {
    newCharacters: number;
    updatedCharacters: number;
    newPlaces: number;
    updatedPlaces: number;
    newThemes: number;
    newRules: number;
    newConflicts: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize a name for comparison (lowercase, trim, remove extra spaces).
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Deduplicate an array of strings (case-insensitive).
 */
function deduplicateStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of arr) {
    const normalized = normalizeName(item);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(item);
    }
  }

  return result;
}

// ============================================================================
// Entity Merging
// ============================================================================

/**
 * Merge characters from two WorldBibles.
 * - Characters are matched by name or aliases
 * - Document character descriptions are preferred
 * - Aliases are unioned
 */
function mergeCharacters(
  existing: WorldBibleCharacterRef[],
  fromDocuments: WorldBibleCharacterRef[],
): {
  merged: WorldBibleCharacterRef[];
  newCount: number;
  updatedCount: number;
} {
  const merged: WorldBibleCharacterRef[] = [];
  const existingByName = new Map<string, WorldBibleCharacterRef>();
  let newCount = 0;
  let updatedCount = 0;

  // Index existing characters by normalized name and aliases
  for (const char of existing) {
    existingByName.set(normalizeName(char.name), char);
    for (const alias of char.aliases || []) {
      existingByName.set(normalizeName(alias), char);
    }
  }

  // Track which existing characters have been matched
  const matchedExisting = new Set<WorldBibleCharacterRef>();

  // Process document characters
  for (const docChar of fromDocuments) {
    // Find matching existing character
    let match: WorldBibleCharacterRef | undefined;

    // Check by name
    match = existingByName.get(normalizeName(docChar.name));

    // Check by aliases
    if (!match && docChar.aliases) {
      for (const alias of docChar.aliases) {
        match = existingByName.get(normalizeName(alias));
        if (match) break;
      }
    }

    if (match && !matchedExisting.has(match)) {
      // Merge with existing - prefer document data, union aliases
      matchedExisting.add(match);
      const mergedAliases = deduplicateStrings([
        ...(match.aliases || []),
        ...(docChar.aliases || []),
      ]);

      merged.push({
        name: docChar.name, // Prefer document name
        title: docChar.title || match.title,
        aliases: mergedAliases,
        description: docChar.description, // Prefer document description
        temporalStatus: docChar.temporalStatus,
        activeEra: docChar.activeEra || match.activeEra,
      });
      updatedCount++;
    } else if (!match) {
      // New character from documents
      merged.push(docChar);
      newCount++;
    }
  }

  // Add remaining unmatched existing characters
  for (const char of existing) {
    if (!matchedExisting.has(char)) {
      merged.push(char);
    }
  }

  return { merged, newCount, updatedCount };
}

/**
 * Merge places from two WorldBibles.
 * - Places are matched by name
 * - Document place descriptions and environment are preferred
 */
function mergePlaces(
  existing: WorldBiblePlaceRef[],
  fromDocuments: WorldBiblePlaceRef[],
): { merged: WorldBiblePlaceRef[]; newCount: number; updatedCount: number } {
  const merged: WorldBiblePlaceRef[] = [];
  const existingByName = new Map<string, WorldBiblePlaceRef>();
  let newCount = 0;
  let updatedCount = 0;

  // Index existing places by normalized name
  for (const place of existing) {
    existingByName.set(normalizeName(place.name), place);
  }

  // Track which existing places have been matched
  const matchedExisting = new Set<string>();

  // Process document places
  for (const docPlace of fromDocuments) {
    const normalizedName = normalizeName(docPlace.name);
    const match = existingByName.get(normalizedName);

    if (match) {
      // Merge with existing - prefer document data; preserve hierarchy (purpose, parentName)
      matchedExisting.add(normalizedName);
      merged.push({
        name: docPlace.name,
        description: docPlace.description, // Prefer document description
        isSuitableStart: docPlace.isSuitableStart,
        environment: docPlace.environment,
        purpose: docPlace.purpose,
        parentName: docPlace.parentName,
      });
      updatedCount++;
    } else {
      // New place from documents
      merged.push(docPlace);
      newCount++;
    }
  }

  // Add remaining unmatched existing places
  for (const place of existing) {
    if (!matchedExisting.has(normalizeName(place.name))) {
      merged.push(place);
    }
  }

  return { merged, newCount, updatedCount };
}

// ============================================================================
// LLM-based Text Synthesis
// ============================================================================

const TEXT_MERGE_SCHEMA = {
  type: 'object',
  properties: {
    merged: {
      type: 'string',
      description: 'The merged/synthesized text combining both sources',
    },
  },
  required: ['merged'],
  additionalProperties: false,
};

/**
 * Synthesize two text fields using LLM.
 * Prefers document content but incorporates unique details from existing.
 */
async function synthesizeText(
  fieldName: string,
  existing: string,
  fromDocuments: string,
): Promise<string> {
  // If document version is empty, keep existing
  if (!fromDocuments.trim()) {
    return existing;
  }

  // If existing is empty, use document version
  if (!existing.trim()) {
    return fromDocuments;
  }

  // If they're essentially the same (ignoring whitespace), return document version
  if (normalizeName(existing) === normalizeName(fromDocuments)) {
    return fromDocuments;
  }

  // Use LLM to synthesize
  // Lore and historicalLore can be very long, so use higher token limits
  const isLongField = fieldName === 'lore' || fieldName === 'historicalLore';
  const maxTokens = isLongField ? 8192 : 2048;

  const result = await queryLlm<{ merged: string }>({
    system: `You are merging two versions of world-building text (${fieldName}).
The "document" version is from recent document extraction and should be preferred.
The "existing" version contains established lore that should be preserved if not contradicted.

Rules:
- Prefer the document version's facts and phrasing
- Incorporate unique details from the existing version that don't contradict documents
- Keep the tone and style consistent with the document version
- Don't add new information not present in either source
- Be concise but comprehensive`,
    prompt: `Merge these two versions of "${fieldName}":

DOCUMENT VERSION (preferred):
${fromDocuments}

EXISTING VERSION (preserve unique details):
${existing}

Provide the merged text.`,
    complexity: 'simple',
    context: `WorldBible Merge: ${fieldName}`,
    maxTokensOverride: maxTokens,
    schema: {
      name: 'text_merge',
      schema: TEXT_MERGE_SCHEMA,
    },
  });

  return result.content.merged;
}

// ============================================================================
// Main Merge Function
// ============================================================================

/**
 * Merge two WorldBibles, preferring document-extracted content.
 *
 * @param existing - The existing WorldBible (may be null if none exists)
 * @param fromDocuments - The newly extracted WorldBible from documents
 * @returns The merged WorldBible and statistics about what changed
 */
export async function mergeWorldBibles(
  existing: WorldBible | null,
  fromDocuments: WorldBible,
): Promise<MergeResult> {
  // If no existing WorldBible, just return the document version
  if (!existing) {
    return {
      worldBible: fromDocuments,
      stats: {
        newCharacters: fromDocuments.characters.length,
        updatedCharacters: 0,
        newPlaces: fromDocuments.places.length,
        updatedPlaces: 0,
        newThemes: fromDocuments.themes.length,
        newRules: fromDocuments.rules.length,
        newConflicts: fromDocuments.keyConflicts.length,
      },
    };
  }

  logger.info('WorldBibleMerger', 'Merging WorldBibles');

  // Merge entities
  const charResult = mergeCharacters(existing.characters, fromDocuments.characters);
  const placeResult = mergePlaces(existing.places, fromDocuments.places);

  // Merge arrays (union with deduplication)
  const mergedThemes = deduplicateStrings([...existing.themes, ...fromDocuments.themes]);
  const mergedRules = deduplicateStrings([...existing.rules, ...fromDocuments.rules]);
  const mergedConflicts = deduplicateStrings([
    ...existing.keyConflicts,
    ...fromDocuments.keyConflicts,
  ]);

  // Synthesize text fields using LLM (in parallel for performance)
  const [lore, tone, overview, atmosphere, narrativePresent, historicalLore] = await Promise.all([
    synthesizeText('lore', existing.lore, fromDocuments.lore),
    synthesizeText('tone', existing.tone, fromDocuments.tone),
    synthesizeText('overview', existing.overview, fromDocuments.overview),
    synthesizeText('atmosphere', existing.atmosphere, fromDocuments.atmosphere),
    synthesizeText('narrativePresent', existing.narrativePresent, fromDocuments.narrativePresent),
    synthesizeText('historicalLore', existing.historicalLore, fromDocuments.historicalLore),
  ]);

  const worldBible: WorldBible = {
    themes: mergedThemes,
    characters: charResult.merged,
    places: placeResult.merged,
    lore,
    rules: mergedRules,
    tone,
    overview,
    keyConflicts: mergedConflicts,
    atmosphere,
    narrativePresent,
    historicalLore,
    historicalEvents: existing.historicalEvents,
  };

  const stats = {
    newCharacters: charResult.newCount,
    updatedCharacters: charResult.updatedCount,
    newPlaces: placeResult.newCount,
    updatedPlaces: placeResult.updatedCount,
    newThemes: mergedThemes.length - existing.themes.length,
    newRules: mergedRules.length - existing.rules.length,
    newConflicts: mergedConflicts.length - existing.keyConflicts.length,
  };

  logger.info(
    'WorldBibleMerger',
    `Merge complete: ${stats.newCharacters} new chars, ${stats.updatedCharacters} updated chars, ` +
      `${stats.newPlaces} new places, ${stats.updatedPlaces} updated places`,
  );

  return { worldBible, stats };
}
