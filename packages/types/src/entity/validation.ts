/**
 * Validation and generation preview types.
 */

import type { ClothingSlot } from './entities.js';

/**
 * Result type for universe-level validators.
 */
export interface UniverseValidatorResult {
  /** Whether repairs were applied */
  repaired: boolean;
  /** Description of repairs applied */
  repairs: string[];
  /** Additional validator-specific data */
  [key: string]: unknown;
}

/**
 * Preview data for character generation.
 * Note: info is optional for API input validation - callers may not provide it.
 */
export interface CharacterPreviewData {
  label: string;
  description: string;
  short_description: string;
  info?: {
    race?: string;
    birthdate?: string;
    birthPlace?: string;
    gender?: string;
    eyeColor?: string;
    hairColor?: string;
    hairStyle?: string;
    beardStyle?: string | null;
    headType?: string;
    skinTone?: string;
    personality?: string;
    title?: string;
    aliases?: string[];
    voiceId?: string;
    clothing?: ClothingSlot[];
    enabledOverlayLayers?: string[];
    /** Ruleset-defined stat values (from point-buy wizard or generateStats()). */
    stats?: Record<string, number>;
  };
}
