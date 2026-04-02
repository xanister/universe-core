/**
 * Autotile-47 LPC Grass Preset Configuration
 *
 * Configuration for LPC grass_blob47.png tileset.
 * Uses canonical bitmask convention (7x7 grid, 32px tiles)
 */

import type { Autotile47Config } from '@dmnpc/types/world';

export const autotile47LpcGrassConfig: Autotile47Config = {
  format: 'autotile-47',
  name: 'autotile47-lpc-grass',
  tileCount: 47,
  gridSize: { cols: 7, rows: 7 },
  tileSize: 32,
};
