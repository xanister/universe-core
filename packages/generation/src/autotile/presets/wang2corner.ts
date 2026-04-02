/**
 * Wang 2-Corner Preset Configuration
 *
 * Configuration for the standard Wang 2-corner (16-tile) autotile format.
 * Uses the "Clean 2-Corner Wang Tileset" from OpenGameArt.
 *
 * Tileset layout: 4x4 grid (128x128 pixels for 32px tiles)
 * Tile indices 0-15 arranged left-to-right, top-to-bottom.
 *
 * Corner weightings (standard):
 *   NW=8  NE=1
 *   SW=4  SE=2
 *
 * License: CC-BY 3.0 (Joe Strout)
 * Source: https://opengameart.org/content/clean-2-corner-wang-tileset
 */

import type { Wang2CornerConfig } from '@dmnpc/types/world';

/**
 * Configuration for the Clean 2-Corner Wang tileset.
 */
export const wang2CornerCleanConfig: Wang2CornerConfig = {
  format: 'wang-2corner',
  name: 'wang2corner-clean',
  tileCount: 16,
  gridSize: { cols: 16, rows: 4 }, // 16 tiles per row, 4 rows (512x128 image, 32px tiles)
  tileSize: 32,
};
