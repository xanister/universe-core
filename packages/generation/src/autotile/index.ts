/**
 * Autotile System
 *
 * Provides algorithms for automatic tile selection based on neighboring terrain.
 * Supports multiple formats:
 * - blob-47: 47-tile 8-neighbor bitmask system with corner masking
 * - wang-16: 16-tile Wang 2-corner system (used by LPC terrains)
 * - wang-2corner: Standard 16-tile Wang 2-corner system
 */

// Core blob-47 functions (all require config parameter)
export {
  applyCornerMasking,
  bitmaskToTileIndex,
  calculateBitmask,
  getTileIndex,
  tileIndexToCoordinates,
  applyAutotile,
  calculateLayerBitmask,
  applyLayeredAutotile,
  generateBitmaskLookupTable,
} from './blob-47.js';

// Boundary autotile (wall/railing tiles against a reference mask)
export { applyBoundaryAutotile } from './boundary-autotile.js';

// Wang-16 functions
export {
  calculateWang16Index,
  applyWang16Autotile,
  applyWang16LayeredAutotile,
  wang16IndexToCoordinates,
  STANDARD_WANG16_CONVENTION,
} from './wang-16.js';

// Wang 2-corner functions (standard implementation)
export {
  calculateWang2CornerIndex,
  applyWang2CornerAutotile,
  applyWang2CornerLayered,
  wang2CornerIndexToCoords,
  WANG_2CORNER_WEIGHTS,
} from './wang-2corner.js';

// Autotile-47 functions (from node-autotile)
export { applyAutotile47Layered } from './autotile-47.js';

// Autotile-47 LPC functions (canonical convention for LPC tilesets)
export { applyAutotile47LpcLayered } from './autotile-47-lpc.js';

// Preset configurations and loader
export {
  loadAutotileConfig,
  hasAutotilePreset,
  canonicalConfig,
  gamemakerConfig,
  wang16LpcConfig,
  wang2CornerCleanConfig,
  autotile47TemplateConfig,
} from './presets/index.js';
