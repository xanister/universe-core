/**
 * Search Entities - Generic Search Implementation
 *
 * Provides shared search and distance calculation logic for entity search tools.
 * Used by search_places and search_characters wrapper tools.
 */

import type { Character } from '@dmnpc/types/entity';
import type { ToolContext, UniverseContextInterface } from '../types.js';

type SortBy = 'distance' | 'name';

interface SearchPlaceOptions {
  entityType: 'place';
  query?: string;
  parentId?: string;
  sortBy?: SortBy;
  limit?: number;
}

interface SearchCharacterOptions {
  entityType: 'character';
  query?: string;
  atPlaceId?: string;
  sortBy?: SortBy;
  limit?: number;
}

/** @public knip: exported for TypeScript declaration emit (TS4023) — knip cannot trace types used in exported function signatures */
export type SearchOptions = SearchPlaceOptions | SearchCharacterOptions;

interface PlaceSearchResult {
  index: number;
  id: string;
  label: string;
  parentId: string | null;
  environment?: string;
  purpose?: string;
}

interface CharacterSearchResult {
  index: number;
  id: string;
  label: string;
  locationId: string | null;
  shortDescription?: string;
}

type SearchResult = PlaceSearchResult | CharacterSearchResult;

/** @public knip: exported for TypeScript declaration emit (TS4023) — knip cannot trace types used in exported function signatures */
export interface SearchResponse {
  results: SearchResult[];
  totalMatches: number;
  hint: string;
}

/**
 * Generic entity search with sorting support.
 * Returns results with IDs that must be used verbatim in other tools.
 */
export function searchEntities(context: ToolContext, options: SearchOptions): SearchResponse {
  const { universe, character: playerChar } = context;
  const playerPlaceId = playerChar.position.parent;
  const limit = options.limit ?? 10;

  if (options.entityType === 'place') {
    return searchPlaces(universe, playerPlaceId, options, limit);
  } else {
    return searchCharacters(universe, playerChar, playerPlaceId, options, limit);
  }
}

function searchPlaces(
  universe: UniverseContextInterface,
  playerPlaceId: string | null,
  options: SearchPlaceOptions,
  limit: number,
): SearchResponse {
  let matches = [...universe.places];

  if (options.parentId) {
    matches = matches.filter((p) => p.position.parent === options.parentId);
  } else if (options.query) {
    const q = options.query.toLowerCase();
    matches = matches.filter((p) => p.label.toLowerCase().includes(q));
  } else {
    // Default: top-level regions (direct children of cosmos)
    matches = matches.filter((p) => p.position.parent === 'PLACE_cosmos');
  }

  if (options.sortBy === 'distance' && playerPlaceId) {
    matches = matches.sort(
      (a, b) =>
        calculateHierarchyDistance(universe, playerPlaceId, a.id) -
        calculateHierarchyDistance(universe, playerPlaceId, b.id),
    );
  } else if (options.sortBy === 'name') {
    matches = matches.sort((a, b) => a.label.localeCompare(b.label));
  }

  const totalMatches = matches.length;
  const results: PlaceSearchResult[] = matches.slice(0, limit).map((p, idx) => ({
    index: idx,
    id: p.id,
    label: p.label,
    parentId: p.position.parent,
    environment: p.info.environment.type,
    purpose: p.info.purpose,
  }));

  return {
    results,
    totalMatches,
    hint: 'Use the "id" field verbatim in create_place, move_character, create_exit, etc. Do NOT invent IDs.',
  };
}

function searchCharacters(
  universe: UniverseContextInterface,
  playerChar: Character,
  playerPlaceId: string | null,
  options: SearchCharacterOptions,
  limit: number,
): SearchResponse {
  let matches = universe.characters.filter((c) => c.id !== playerChar.id);

  if (options.atPlaceId) {
    matches = matches.filter((c) => c.position.parent === options.atPlaceId);
  } else if (options.query) {
    const q = options.query.toLowerCase();
    matches = matches.filter(
      (c) => c.label.toLowerCase().includes(q) || c.short_description.toLowerCase().includes(q),
    );
  } else {
    throw new Error('Provide either query or atPlaceId');
  }

  if (options.sortBy === 'distance' && playerPlaceId) {
    matches = [...matches].sort((a, b) => {
      const distA = a.position.parent
        ? calculateHierarchyDistance(universe, playerPlaceId, a.position.parent)
        : Infinity;
      const distB = b.position.parent
        ? calculateHierarchyDistance(universe, playerPlaceId, b.position.parent)
        : Infinity;
      return distA - distB;
    });
  } else if (options.sortBy === 'name') {
    matches = [...matches].sort((a, b) => a.label.localeCompare(b.label));
  }

  const totalMatches = matches.length;
  const results: CharacterSearchResult[] = matches.slice(0, limit).map((c, idx) => ({
    index: idx,
    id: c.id,
    label: c.label,
    locationId: c.position.parent,
    shortDescription: c.short_description,
  }));

  return {
    results,
    totalMatches,
    hint: 'Use the "id" field verbatim in move_character, update_disposition, etc. Do NOT invent IDs.',
  };
}

/**
 * Calculate hierarchy distance between two places.
 * Distance = number of hops up to common ancestor + hops down to target.
 * Returns Infinity if no common ancestor exists.
 */
function calculateHierarchyDistance(
  universe: UniverseContextInterface,
  fromId: string,
  toId: string,
): number {
  if (fromId === toId) return 0;

  const fromChain = getAncestorChain(universe, fromId);
  const toChain = getAncestorChain(universe, toId);

  for (let i = 0; i < fromChain.length; i++) {
    const j = toChain.indexOf(fromChain[i]);
    if (j >= 0) {
      return i + j; // Hops up + hops down
    }
  }

  return Infinity;
}

/**
 * Get the chain of ancestor place IDs from a place up to the root.
 */
function getAncestorChain(universe: UniverseContextInterface, placeId: string): string[] {
  const chain: string[] = [placeId];
  let current = universe.findPlace(placeId);

  while (current?.position.parent) {
    chain.push(current.position.parent);
    current = universe.findPlace(current.position.parent);
  }

  return chain;
}
