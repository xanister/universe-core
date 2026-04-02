/**
 * Template character types.
 */

import type { Fact } from '../entity/events.js';

/**
 * Physical traits for a template character.
 * These traits persist across universe instantiation.
 */
export interface TemplatePhysicalTraits {
  /** Character's gender */
  gender: string;
  /** Character's eye color */
  eyeColor: string;
  /** Character's hair color */
  hairColor: string;
  /** Character's hair style pattern (e.g., 'ponytail', 'bangs'). */
  hairStyle: string;
  /** Beard/facial hair shape (e.g., 'beard', 'medium'). Null = clean-shaven. */
  beardStyle?: string | null;
  /** Character's skin tone (for sprite generation) */
  skinTone: string;
  /** Preferred race (if universe has this race) */
  race: string | null;
  /** Race adaptation hint for cross-universe mapping (e.g., "human-like", "elvish", "robotic") */
  raceAdaptation: string | null;
}

/**
 * A template character definition.
 * Templates exist independently of universes and can be instantiated
 * as player characters when a new universe is created.
 *
 * Stored in templates/characters/ with ID format TEMPLATE_{snake_case_label}
 */
export interface TemplateCharacterDefinition {
  /** Unique identifier, e.g., "TEMPLATE_aldric_blackwood" */
  id: string;
  /** Display name for the character */
  label: string;
  /** Full physical description (persists across universes) */
  description: string;
  /** Brief description when name unknown, e.g., "grizzled veteran warrior" */
  short_description: string;
  /** Core personality traits */
  personality: string;
  /** Thematic elements of the character's backstory, e.g., ["redemption", "loss", "duty"] */
  backstoryThemes: string[];
  /** Physical traits that persist across universes */
  physicalTraits: TemplatePhysicalTraits;
  /** Core backstory events (will be adapted to universe style) */
  keyEvents: Fact[] | null;
  /** Template portrait image path */
  image: string | null;
  /** Response verbosity level 1-5. Controls narration length. */
  verbosity: number;
  /** Voice registry ID for TTS */
  voiceId: string;
}

/**
 * Request body for POST /api/creator/universes/:universeId/characters/from-template
 */
export interface TemplateCharacterInstanceRequest {
  /** Template character ID to instantiate */
  templateId: string;
  /** Optional universe-specific guidance for generation */
  guidance: string | null;
}

/**
 * Response from POST /api/creator/universes/:universeId/characters/from-template
 */
export interface TemplateCharacterInstanceResponse {
  character: import('../entity/entities.js').Character;
}
