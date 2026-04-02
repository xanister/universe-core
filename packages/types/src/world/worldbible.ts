/**
 * WorldBible types for document extraction.
 */

import type { EnvironmentConfig } from './weather.js';
import type { Purpose } from './entity-registry.js';

// ============================================================================
// WorldBible Character Types
// ============================================================================

/** Temporal status of a character relative to the narrative present */
export type TemporalStatus = 'contemporary' | 'historical' | 'uncertain';

/**
 * Reference to a character extracted from documents.
 * Used in WorldBible to track characters mentioned in source material.
 */
export interface WorldBibleCharacterRef {
  /** Character's proper name only - no titles or nicknames (e.g., "Meiloria" not "Queen Meiloria") */
  name: string;
  /** Rank or honorific title (e.g., "Queen", "Lord", "Captain") */
  title: string | null;
  /** Alternative names: nicknames, informal names, previous titles (e.g., ["Mel", "The Iron Queen"]) */
  aliases: string[] | null;
  /** Brief objective description of the character */
  description: string;
  /** Whether the character is alive at the narrative present */
  temporalStatus: TemporalStatus;
  /** The era or time period when the character was active (e.g., "Third Age", "2nd Century") */
  activeEra: string | null;
}

// ============================================================================
// WorldBible Place Types
// ============================================================================

/**
 * Reference to a place extracted from documents.
 * Used in WorldBible to track locations mentioned in source material.
 */
export interface WorldBiblePlaceRef {
  /** Place name as it appears in documents */
  name: string;
  /** Brief description of the location */
  description: string;
  /** True if this is a suitable location for players to start their adventure */
  isSuitableStart: boolean;
  /**
   * Environment type for categorization.
   * - 'interior': Enclosed space (buildings, caves, ship interiors)
   * - 'exterior': Open space (towns, clearings, wilderness)
   * - 'space': Vacuum environment (cosmos, space stations)
   * - 'underwater': Submerged environment (ocean floor, underwater caves)
   */
  environment: EnvironmentConfig;
  /**
   * Type of place for template-based generation.
   * Inferred during document extraction to guide place generation.
   * Examples: 'cosmos', 'world', 'tavern', 'forest'
   */
  purpose: Purpose;
  /**
   * Exact label of the parent place for hierarchy (e.g. "Guardia Castle", "Zenan Continent").
   * For worlds use the cosmos place label (e.g. "Cosmos"). Required for hierarchy-aware creation.
   */
  parentName: string;
}

// ============================================================================
// Historical Event Types
// ============================================================================

export type HistoricalEventType =
  | 'founding'
  | 'war'
  | 'treaty'
  | 'catastrophe'
  | 'ruler_change'
  | 'discovery'
  | 'historical';

/**
 * Historical event extracted from documents for the WorldBible.
 * Represents common knowledge that people in the world would know about.
 */
export interface WorldBibleHistoricalEvent {
  /** What happened (1-2 sentences, objective description) */
  fact: string;
  /** Type of historical event */
  eventType: HistoricalEventType;
  /** Scope of common knowledge: global (everyone knows), regional (area), local (specific place) */
  scope: 'global' | 'regional' | 'local';
  /** How significant this event is */
  significance: 'minor' | 'moderate' | 'major';
  /** When it happened (relative or absolute, e.g., "500 years ago", "Third Age") */
  approximateDate: string | null;
  /** Place names where this event is relevant */
  relevantPlaces: string[] | null;
}

// ============================================================================
// WorldBible
// ============================================================================

/**
 * Consolidated world-building information from all documents.
 * The WorldBible serves as the authoritative source of extracted lore
 * and is used to inform dynamic entity generation for continuity.
 */
export interface WorldBible {
  /** Major themes and motifs from the source material */
  themes: string[];
  /** Contemporary characters who are alive at the narrative present */
  characters: WorldBibleCharacterRef[];
  /** Key locations mentioned in source material */
  places: WorldBiblePlaceRef[];
  /** Synthesized lore narrative from all documents */
  lore: string;
  /** World rules and constraints */
  rules: string[];
  /** Narrative tone/mood */
  tone: string;
  /** High-level overview of the world/setting */
  overview: string;
  /** Major tensions, conflicts, or plot hooks */
  keyConflicts: string[];
  /** Overall atmosphere and feel of the world */
  atmosphere: string;
  /** The consolidated "current time" based on narrative present from documents */
  narrativePresent: string;
  /** Synthesized lore about historical figures who are not alive at narrative present */
  historicalLore: string;
  /** Historical events extracted from documents - common knowledge in the world */
  historicalEvents: WorldBibleHistoricalEvent[];
}
