/**
 * Autotile-47 Template Preset Configuration
 *
 * Configuration for the tileset from tlhunter/node-autotile.
 * Tileset: node-autotile-tileset.png (8 columns x 6 rows, 16px tiles)
 * Source: https://github.com/tlhunter/node-autotile
 */

import type { Autotile47Config } from '@dmnpc/types/world';

export const autotile47TemplateConfig: Autotile47Config = {
  format: 'autotile-47',
  name: 'autotile47-template',
  tileCount: 48, // 0-47 indices
  gridSize: { cols: 8, rows: 6 },
  tileSize: 32, // scaled up from 16px to 32px
};
