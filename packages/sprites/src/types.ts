/**
 * LPC Sprite Types
 *
 * Types for the Liberated Pixel Cup (LPC) sprite format.
 */

import type { RaceFeatureLayer } from '@dmnpc/types/entity';
import type { FacingDirection } from '@dmnpc/types/game';

export type { FacingDirection };

// Canonical color constants live in @dmnpc/types (browser-safe).
// Re-exported here so server-side consumers can import from @dmnpc/sprites.
export {
  SKIN_COLOR_TINT_HEX,
  HAIR_COLOR_TINT_HEX,
  EYE_COLOR_TINT_HEX,
  CLOTHING_COLOR_HEX,
} from '@dmnpc/types';

// Imported locally (needed for ClothingColor type derivation) and re-exported.
import { CLOTHING_COLORS } from '@dmnpc/types/ui';
export { CLOTHING_COLORS };
export type AnimationState =
  | 'idle'
  | 'walk'
  | 'attack'
  | 'hurt'
  | 'cast'
  | 'spellcast'
  | 'thrust'
  | 'slash'
  | 'shoot';
export type BodyType = 'male' | 'female' | 'muscular' | 'skeleton' | 'zombie';

/**
 * Head types from the LPC Character Bases v3 modular system.
 * Each head type provides species-specific facial features.
 */
export const HEAD_TYPES = [
  'human_male',
  'human_female',
  'human_male_elderly',
  'human_female_elderly',
  'human_child',
  'human_zombie',
  'orc_male',
  'orc_female',
  'orc_child',
  'wolf_male',
  'wolf_female',
  'wolf_child',
  'lizard_male',
  'lizard_female',
  'lizard_child',
  'minotaur',
  'minotaur_child',
  'boarman',
  'boarman_child',
  'skeleton',
  'zombie',
] as const;
export type HeadType = (typeof HEAD_TYPES)[number];

// ============================================================================
// Character Appearance Enums
// ============================================================================

/**
 * Skin tone variants available in the LPC clothing manifest.
 * Used for body, ears, and nose layers that need to match skin tone.
 * These are internal variant IDs in manifest.json — not the same as SkinColor.
 */
export const SKIN_TONES = [
  'light',
  'tanned',
  'tanned2',
  'dark',
  'dark2',
  'darkelf',
  'darkelf2',
  'orc',
  'skeleton',
] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

/**
 * Skin/fur colors from LPC Character Bases v3.
 * These are the user-facing skin color values used in character creation and generation.
 * Map to v3 asset file names (e.g., bodies/male/universal/amber.png).
 */
export const SKIN_COLORS = [
  'amber',
  'black',
  'blue',
  'bright_green',
  'bronze',
  'brown',
  'dark_green',
  'fur_black',
  'fur_brown',
  'fur_copper',
  'fur_gold',
  'fur_grey',
  'fur_tan',
  'fur_white',
  'green',
  'lavender',
  'light',
  'olive',
  'pale_green',
  'taupe',
  'zombie',
  'zombie_green',
] as const;
export type SkinColor = (typeof SKIN_COLORS)[number];

/**
 * Maps old SkinTone values to the closest v3 SkinColor.
 * Used for migrating existing characters.
 */
export const SKIN_TONE_TO_COLOR: Record<SkinTone, SkinColor> = {
  light: 'light',
  tanned: 'amber',
  tanned2: 'taupe',
  dark: 'bronze',
  dark2: 'brown',
  darkelf: 'lavender',
  darkelf2: 'pale_green',
  orc: 'green',
  skeleton: 'light', // skeleton body type, skin color irrelevant
};

/**
 * Eye colors available in LPC assets.
 */
export const EYE_COLORS = [
  'blue',
  'brown',
  'gray',
  'green',
  'orange',
  'purple',
  'red',
  'yellow',
] as const;
export type EyeColor = (typeof EYE_COLORS)[number];

/**
 * Hair colors for character generation.
 * Maps to tintable hair assets in the manifest.
 */
export const HAIR_COLORS = [
  'black',
  'brown',
  'brunette',
  'blonde',
  'red',
  'auburn',
  'gray',
  'white',
  'blue',
  'green',
  'pink',
] as const;
export type HairColor = (typeof HAIR_COLORS)[number];

/**
 * Hair style pattern names for LLM generation and data storage.
 * Each entry corresponds to a hair layer in the LPC manifest (prefixed with `hair_`).
 * All styles are white-base tintable sprites — color is independent.
 *
 * Curated to ~20 visually distinct styles. The manifest has more (color-named variants
 * like `raven`, `blonde` etc. that are valid shapes), but for LLM generation we limit
 * to shape-named styles for clarity.
 */
export const HAIR_STYLES = [
  'bangs',
  'bangslong',
  'bangsshort',
  'bedhead',
  'bunches',
  'jewfro',
  'long',
  'longhawk',
  'longknot',
  'loose',
  'messy1',
  'messy2',
  'mohawk',
  'page',
  'parted',
  'pixie',
  'plain',
  'ponytail',
  'ponytail2',
  'princess',
  'shorthawk',
  'shortknot',
  'shoulderl',
  'shoulderr',
  'swoop',
  'unkempt',
  'xlong',
  'xlongknot',
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/**
 * All available beard/facial hair shape IDs for the facial layer.
 * These correspond to tintable PNG files in male/facial/ and female/facial/.
 * The `null` value (clean-shaven) is not in this list — omit beardStyle or set to null.
 */
export const BEARD_STYLES = [
  'beard',
  'bigstache',
  'mustache',
  'fiveoclock',
  'frenchstache',
  'stubble',
  'winter',
  'medium',
  'trimmed',
  'horseshoe',
  'lampshade',
  'handlebar',
  'chevron',
  'walrus',
] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];

/**
 * LPC layer type — any string. The manifest is the single source of truth for
 * which layer types exist. Adding a new layer type = adding it to manifest.json.
 */
export type LPCLayerType = string;

/**
 * Colorization options for sprite layers.
 *
 * `threshold` (tint only): pixels with max(R,G,B) >= threshold are skipped (pass through untinted).
 * Used for eye sprites where the sclera (white) must stay white while the iris gets tinted.
 */
export type ColorizeOptions =
  | { type: 'tint'; color: number; tintMode?: 'multiply' | 'overlay'; threshold?: number }
  | { type: 'palette'; colorMap: Record<number, number> };

/**
 * Configuration for a single sprite layer.
 */
export interface LayerConfig {
  type: LPCLayerType;
  imageUrl: string;
  zIndex?: number;
  colorize?: ColorizeOptions;
  visible?: boolean;
}

/**
 * Describes a single asset option within a layer category.
 */
export interface LPCAssetOption {
  id: string;
  name: string;
  path: string;
  tintable?: boolean;
  bodyType?: BodyType;
  bodyTypeOverrides?: Partial<Record<BodyType, string>>;
  variant?: string;
  /**
   * How tint color is blended onto the sprite.
   * - 'multiply' (default): output = base * tint / 255. Best for fabric, cloth, leather.
   * - 'overlay' (future): preserves specular highlights for metallic items.
   */
  tintMode?: 'multiply' | 'overlay';
}

// ============================================================================
// Clothing Color System
// ============================================================================

// CLOTHING_COLORS and CLOTHING_COLOR_HEX are re-exported from @dmnpc/types above.

export type ClothingColor = (typeof CLOTHING_COLORS)[number];

/**
 * Describes all available options for a layer type.
 * Metadata fields (zIndex, variantFiltered, bodyTypeSpecific, slotKind) are the
 * single source of truth — code derives behavior from these, never hardcoded.
 */
export interface LPCLayerManifest {
  type: LPCLayerType;
  displayName: string;
  optional: boolean;
  /** Render stacking order. Lower values render behind higher values. */
  zIndex: number;
  /** When true, options are filtered by variant (e.g., ears by species). */
  variantFiltered: boolean;
  /** When true, options have per-body-type assets (filtered by bodyType field). */
  bodyTypeSpecific: boolean;
  /** Classification: 'body' | 'feature' | 'wearable'. */
  slotKind: string;
  options: LPCAssetOption[];
}

/**
 * Complete manifest of all available LPC assets.
 */
export interface LPCAssetManifest {
  version: string;
  basePath: string;
  description?: string;
  license?: string;
  source?: string;
  bodyTypes?: BodyType[];
  layers: LPCLayerManifest[];
}

/**
 * Output from composite sprite generation.
 */
export interface CompositeSpriteData {
  /** PNG image as a Node.js Buffer */
  image: Buffer;
  /** Frame metadata for each animation frame */
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; index: number }>;
  /** Animation sequences mapping animation keys to frame names */
  animations: Record<string, string[]>;
  /** Total spritesheet dimensions */
  size: { width: number; height: number };
  /** Individual frame dimensions */
  frameSize: { width: number; height: number };
}

/**
 * Options for sprite generation.
 */
export interface GenerateOptions {
  /** Which animations to include (default: all) */
  animations?: AnimationState[];
  /** Which directions to include (default: all) */
  directions?: FacingDirection[];
  /** Frame width in pixels (default: 64) */
  frameWidth?: number;
  /** Frame height in pixels (default: 64) */
  frameHeight?: number;
}

// ============================================================================
// V3 Character Bases Manifest
// ============================================================================

/**
 * Describes animation availability for a body or head type.
 */
export interface CharacterBaseAnimationInfo {
  /** Animation name (e.g., 'universal', 'run', 'idle', 'sit', 'jump') */
  name: string;
  /** Whether per-skin-color variants exist (e.g., run/{skin}.png) */
  hasPerSkinVariants: boolean;
  /** Image dimensions */
  width: number;
  height: number;
  /** Number of frames per direction */
  frames: number;
}

/**
 * Describes a single body or head type in the v3 character bases.
 */
export interface CharacterBaseTypeInfo {
  /** Type ID (e.g., 'male', 'human_male') */
  id: string;
  /** Available skin/fur colors for this type */
  availableSkinColors: SkinColor[];
  /** Available animations with metadata */
  animations: CharacterBaseAnimationInfo[];
}

/**
 * Manifest for the v3 character bases assets.
 * Generated by the build script from the file system.
 */
export interface CharacterBasesManifest {
  /** All available body types with their metadata */
  bodies: CharacterBaseTypeInfo[];
  /** All available head types with their metadata */
  heads: CharacterBaseTypeInfo[];
  /** All skin colors found across all body/head types */
  allSkinColors: SkinColor[];
}

// ============================================================================
// Sprite Archetypes
// ============================================================================

/**
 * A sprite archetype binds a game race to valid v3 sprite parts.
 * Defines which body types, head types, skin colors, and feature layers are valid for a species.
 */
export interface SpriteArchetype {
  /** Unique archetype ID (e.g., 'human', 'orc', 'wolf') */
  id: string;
  /** Display label (e.g., 'Human', 'Orc', 'Wolf') */
  label: string;
  /** Which v3 head types this archetype can use */
  allowedHeadTypes: HeadType[];
  /** Which v3 body types this archetype can use */
  allowedBodyTypes: BodyType[];
  /** Which v3 skin/fur colors this archetype can use */
  allowedSkinColors: SkinColor[];
  /** Feature layers available for this archetype (ears, eyes, nose, facial hair, etc.). */
  featureLayers: RaceFeatureLayer[];
  /** Auto-map gender to head type (e.g., { male: 'orc_male', female: 'orc_female' }) */
  genderHeadMap: Record<string, HeadType> | null;
  /** Whether players can select this archetype in the character creator */
  playerSelectable: boolean;
}
