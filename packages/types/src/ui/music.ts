/**
 * Music and audio types.
 */

import type { Purpose } from '../world/entity-registry.js';

/**
 * Dramatic states for music generation.
 * Determines the emotional tone of the music.
 */
export type DramaticState =
  | 'exploration'
  | 'calm'
  | 'progress'
  | 'combat'
  | 'victory'
  | 'mystery'
  | 'melancholy';

/**
 * Music pacing/tempo.
 * Determines the speed and energy of the background music.
 */
export type MusicPace = 'fast' | 'medium' | 'slow';

/**
 * Universe-level music configuration.
 * Allows universes to customize instrumentation for place subtypes.
 */
export interface UniverseMusicConfig {
  /** Override instrumentation for purposes (optional; LLM infers from type name if not set) */
  instrumentationOverrides: Partial<Record<Purpose, string>> | null;
}

/**
 * Place-specific music hints.
 * Provides free-form hints to the LLM for music selection.
 */
export interface PlaceMusicHints {
  /** Free-form hints for the music generator (e.g., "warm fireplace ambience") */
  hints: string | null;
}

/**
 * Context for music selection.
 * Provides scene information for LLM-based music requirement determination.
 * Note: activityLevel uses the ActivityLevel type from audio-generator.ts
 */
export interface MusicContext {
  /** Place purpose for location context (e.g., 'tavern', 'shop', 'forest') */
  purpose: Purpose;
  /** Place tags for location context */
  placeTags: string[];
  /** Place label */
  placeLabel: string;
  /** Place description */
  placeDescription: string;
  /** Whether the place is interior */
  isInterior: boolean;
  /** Time of day (dawn, morning, midday, afternoon, evening, dusk, night) */
  timeOfDay: string;
  /** Current weather condition, null when environment has no atmospheric weather */
  weather: string | null;
  /** Event type if triggered by a storyteller event */
  eventType: string;
  /** Inferred activity level based on time ('quiet' | 'moderate' | 'crowded') */
  activityLevel: 'quiet' | 'moderate' | 'crowded';
  /** Recent transcript of player/DM exchanges for situational awareness */
  recentTranscript: string;
}
