/**
 * Autotile Preset Loader
 *
 * Provides access to built-in autotile configurations by name.
 * Supports blob-47, wang-16, and wang-2corner formats.
 */

import type { AutotileConfig, AutotilePreset } from '@dmnpc/types/world';

import { canonicalConfig } from './canonical.js';
import { gamemakerConfig } from './gamemaker.js';
import { wang16LpcConfig } from './wang16.js';
import { wang2CornerCleanConfig } from './wang2corner.js';
import { autotile47TemplateConfig } from './autotile47.js';
import { autotile47LpcGrassConfig } from './autotile47-lpc.js';
const PRESETS: Record<AutotilePreset, AutotileConfig> = {
  canonical: canonicalConfig,
  gamemaker: gamemakerConfig,
  'wang16-lpc': wang16LpcConfig,
  'wang2corner-clean': wang2CornerCleanConfig,
  'autotile47-template': autotile47TemplateConfig,
  'autotile47-lpc-grass': autotile47LpcGrassConfig,
};

/**
 * Load an autotile configuration by preset name.
 * Throws if the preset is not found.
 *
 * @param preset - The preset name to load
 * @returns The autotile configuration
 * @throws Error if preset is not found
 */
export function loadAutotileConfig(preset: AutotilePreset): AutotileConfig {
  return PRESETS[preset];
}

/**
 * Check if a preset exists.
 *
 * @param preset - The preset name to check
 * @returns true if the preset exists
 */
export function hasAutotilePreset(preset: string): preset is AutotilePreset {
  return preset in PRESETS;
}

export { canonicalConfig } from './canonical.js';
export { gamemakerConfig } from './gamemaker.js';
export { wang16LpcConfig } from './wang16.js';
export { wang2CornerCleanConfig } from './wang2corner.js';
export { autotile47TemplateConfig } from './autotile47.js';
export { autotile47LpcGrassConfig } from './autotile47-lpc.js';
