/**
 * @dmnpc/data - Data Directory Paths
 *
 * Provides paths to all data directories in the monorepo.
 * This package exists so other packages can import paths without
 * calculating relative paths or relying on process.cwd().
 */

import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Root directory of the data package.
 * Points to the package root (containing universes, plots, etc.)
 * regardless of whether running from src/ or dist/
 */
export const DATA_ROOT =
  __dirname.endsWith('dist') || __dirname.endsWith('src') ? resolve(__dirname, '..') : __dirname;

/**
 * Universes data directory.
 * Contains universe definitions with entities, media, etc.
 *
 * Can be overridden with TEST_UNIVERSES_DIR for testing.
 */
export const UNIVERSES_DIR = process.env.TEST_UNIVERSES_DIR
  ? resolve(process.cwd(), process.env.TEST_UNIVERSES_DIR)
  : join(DATA_ROOT, 'universes', 'definitions');

/**
 * Plots data directory.
 * Contains plot definition JSON files.
 */
export const PLOTS_DIR = join(DATA_ROOT, 'plots', 'definitions');

/**
 * Plots media directory.
 * Contains plot images.
 */
export const PLOTS_MEDIA_DIR = join(DATA_ROOT, 'plots', 'media');

/**
 * Scenarios data directory.
 * Contains scenario definitions.
 */
export const SCENARIOS_DIR = join(DATA_ROOT, 'scenarios', 'definitions');

/**
 * Storytellers data directory.
 * Contains storyteller definition JSON files.
 *
 * Can be overridden with TEST_STORYTELLERS_DIR for testing.
 */
export const STORYTELLERS_DIR = process.env.TEST_STORYTELLERS_DIR
  ? resolve(process.cwd(), process.env.TEST_STORYTELLERS_DIR)
  : join(DATA_ROOT, 'storytellers', 'definitions');

/**
 * Storyteller images directory.
 * Contains storyteller images.
 */
export const STORYTELLER_IMAGES_DIR = join(DATA_ROOT, 'storytellers', 'images');

/**
 * Templates data directory.
 * Contains character template JSON files.
 */
export const TEMPLATES_DIR = join(DATA_ROOT, 'templates', 'characters');

/**
 * Template images directory.
 * Contains template character images.
 */
export const TEMPLATE_IMAGES_DIR = join(DATA_ROOT, 'templates', 'images');

/**
 * Sprites data directory.
 * Contains LPC sprite assets and other game sprites.
 */
export const SPRITES_DIR = join(DATA_ROOT, 'sprites');

/**
 * LPC sprites directory.
 * Contains Liberated Pixel Cup sprite assets.
 */
export const LPC_SPRITES_DIR = join(DATA_ROOT, 'sprites', 'lpc');

/**
 * Entity definitions directory.
 * Contains object definitions (objects/*.json) and layout templates (layouts/*.json).
 */
export const ENTITIES_DIR = join(DATA_ROOT, 'entities');

/**
 * Plot clarifications file path.
 * Global clarification state for plots (not universe-specific).
 */
export const PLOT_CLARIFICATIONS_PATH = join(DATA_ROOT, 'plots', 'clarifications.json');

/**
 * Purpose registry file path.
 * Single source of truth for all purpose definitions.
 */
export const PURPOSES_REGISTRY_PATH = join(DATA_ROOT, 'entities', 'purposes.json');

/**
 * Layout templates directory.
 * Individual JSON files defining place layout structure (slots, terrain, etc.).
 */
export const LAYOUTS_DIR = join(DATA_ROOT, 'entities', 'layouts');

/**
 * NPC activities registry file path.
 * Defines activity definitions for NPC intra-location movement (FEAT-034).
 */
export const ACTIVITIES_REGISTRY_PATH = join(DATA_ROOT, 'entities', 'npc-activities.json');

/**
 * Action registry file path.
 * Defines action definitions for the unified combat/exploration action system (FEAT-187).
 */
export const ACTIONS_REGISTRY_PATH = join(DATA_ROOT, 'entities', 'actions.json');

/**
 * Weapon registry file path.
 * Defines weapon definitions for the equipment system (FEAT-188).
 */
export const WEAPONS_REGISTRY_PATH = join(DATA_ROOT, 'entities', 'weapons.json');

/**
 * Items catalog file path.
 * Non-weapon, non-clothing item definitions (potions, keys, scrolls, gems, etc.).
 * FEAT-301: Unified Items System — Phase 1.
 */
export const ITEMS_CATALOG_PATH = join(DATA_ROOT, 'entities', 'items.json');

/**
 * Sound effects registry file path.
 * Data-driven sound effects with ElevenLabs generation prompts.
 */
export const SOUND_REGISTRY_PATH = join(DATA_ROOT, 'audio', 'sound-registry.json');

/**
 * Sound effects output directory.
 * Generated MP3 files are written here and served statically.
 */
export const SOUNDS_OUTPUT_DIR = join(DATA_ROOT, 'audio', 'sounds');

/**
 * Sprite registry file path.
 * Single source of truth for all sprite definitions.
 */
export const SPRITE_REGISTRY_PATH = join(DATA_ROOT, 'sprites', 'sprite-registry.json');

/**
 * Slot registry file path.
 * Game-level clothing slot definitions (region + subOrder). No asset-format leakage.
 */
export const SLOT_REGISTRY_PATH = join(DATA_ROOT, 'sprites', 'slot-registry.json');

/**
 * Clothing catalog file path.
 * Clothing item definitions with display names (FEAT-230).
 */
export const CLOTHING_DATA_PATH = join(DATA_ROOT, 'sprites', 'lpc', 'clothing-data.json');

/**
 * Voice registry file path.
 * Single source of truth for all voice definitions (provider-agnostic IDs + metadata).
 */
export const VOICE_REGISTRY_PATH = join(DATA_ROOT, 'entities', 'voice-registry.json');

/**
 * Full wall styles registry file path (overhead + face tiles from Tiled Wang mapping).
 * Each style has 13 overhead tiles (ceiling overlay) and 9 face tiles (south-facing wall).
 */
export const WALL_STYLES_FULL_PATH = join(
  DATA_ROOT,
  'sprites',
  'lpc-interior',
  'walls',
  'wall-styles-full.json',
);

// ============================================================================
// Path Helper Functions
// ============================================================================

/**
 * Get the path to a specific universe's directory.
 */
export function getUniversePath(universeId: string): string {
  return join(UNIVERSES_DIR, universeId);
}

/**
 * Get the path to a universe's entities directory.
 */
export function getUniverseEntitiesPath(
  universeId: string,
  entityType: 'characters' | 'places' | 'objects' | 'events',
): string {
  return join(UNIVERSES_DIR, universeId, 'entities', entityType);
}

/**
 * Get the path to a universe's media directory.
 */
export function getUniverseMediaPath(universeId: string, mediaType: 'images' | 'audio'): string {
  return join(UNIVERSES_DIR, universeId, 'media', mediaType);
}

/**
 * Get the path to a plot's JSON file.
 */
export function getPlotPath(plotId: string): string {
  return join(PLOTS_DIR, `${plotId}.json`);
}

/**
 * Get the path to a scenario's directory.
 */
export function getScenarioPath(scenarioId: string): string {
  return join(SCENARIOS_DIR, scenarioId);
}

/**
 * Get the path to a storyteller's JSON file.
 */
export function getStorytellerPath(storytellerId: string): string {
  return join(STORYTELLERS_DIR, `${storytellerId}.json`);
}
