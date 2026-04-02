/**
 * Wang 2-Corner (16-Tile) LPC Configuration
 *
 * Standard Wang 2-corner convention used by LPC terrain tilesets.
 * The 16 tiles represent all combinations of filled/empty corners.
 *
 * Corner bit assignments:
 *   NW=8  NE=1
 *   SW=4  SE=2
 *
 * Index = NE(1) + SE(2) + SW(4) + NW(8) → gives 0-15
 *
 * Visual meaning of each index:
 *   0: No corners filled (empty/background only)
 *   1: NE only (small corner)
 *   2: SE only (small corner)
 *   3: NE+SE (right edge)
 *   4: SW only (small corner)
 *   5: NE+SW (diagonal - NE/SW)
 *   6: SE+SW (bottom edge)
 *   7: NE+SE+SW (no NW corner)
 *   8: NW only (small corner)
 *   9: NW+NE (top edge)
 *   10: NW+SE (diagonal - NW/SE)
 *   11: NW+NE+SE (no SW corner)
 *   12: NW+SW (left edge)
 *   13: NW+NE+SW (no SE corner)
 *   14: NW+SE+SW (no NE corner)
 *   15: All corners (center/solid)
 *
 * LPC terrains typically arrange these in a 4x4 grid in the tileset.
 */

import type { Wang16Config, Wang16Convention } from '@dmnpc/types/world';

/**
 * Standard Wang 2-corner convention.
 * This matches the convention used by LPC terrain tilesets.
 */
export const LPC_WANG16_CONVENTION: Wang16Convention = {
  NE: 1,
  SE: 2,
  SW: 4,
  NW: 8,
};

/**
 * Wang-16 LPC configuration.
 *
 * The 16 tiles are arranged in a 4x4 grid in LPC tilesets.
 * The tile index (0-15) directly maps to the position in this grid.
 */
export const wang16LpcConfig: Wang16Config = {
  format: 'wang-16',
  name: 'wang16-lpc',
  cornerConvention: LPC_WANG16_CONVENTION,
  tileCount: 16,
  gridSize: { cols: 4, rows: 4 },
};
