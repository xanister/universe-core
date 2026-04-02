/**
 * GameMaker Blob-47 Autotile Configuration
 *
 * GameMaker/BorisTheBrave convention used by some tileset tools.
 *
 * Bitmask layout (row-by-row):
 *   NW=1    N=2   NE=4
 *   W=8     [X]   E=16
 *   SW=32   S=64  SE=128
 *
 * Note: This uses the same visual tile arrangement as canonical,
 * just different bit assignments for neighbor directions.
 */

import type { AutotileConfig, BitmaskConvention, PositionMapping } from '@dmnpc/types/world';

export const GAMEMAKER_BITMASK_CONVENTION: BitmaskConvention = {
  N: 2,
  NE: 4,
  E: 16,
  SE: 128,
  S: 64,
  SW: 32,
  W: 8,
  NW: 1,
};

/**
 * The 47 unique bitmask values in tileset position order.
 * Same tile positions as canonical, but with GameMaker bit assignments.
 *
 * Each position represents the same neighbor pattern, just calculated
 * with the GameMaker convention bits.
 */
export const GAMEMAKER_BITMASK_VALUES = [
  // Row 0: tiles 0-6
  0, // Position 0: Isolated (no neighbors)
  2, // Position 1: N only
  16, // Position 2: E only
  18, // Position 3: N+E (no corner)
  22, // Position 4: N+E+NE (with corner)
  64, // Position 5: S only
  66, // Position 6: N+S (vertical strip)
  // Row 1: tiles 7-13
  80, // Position 7: E+S (no corner)
  82, // Position 8: N+E+S (T open to W)
  86, // Position 9: N+E+S+NE
  208, // Position 10: E+S+SE (with corner)
  210, // Position 11: N+E+S+SE
  214, // Position 12: N+E+S+NE+SE
  8, // Position 13: W only
  // Row 2: tiles 14-20
  10, // Position 14: N+W (no corner)
  24, // Position 15: E+W (horizontal strip)
  26, // Position 16: N+E+W (T open to S)
  30, // Position 17: N+E+W+NE
  72, // Position 18: S+W (no corner)
  74, // Position 19: N+S+W (T open to E)
  88, // Position 20: E+S+W (T open to N)
  // Row 3: tiles 21-27
  90, // Position 21: N+E+S+W (no corners - center)
  94, // Position 22: N+E+S+W+NE
  216, // Position 23: E+S+W+SE
  218, // Position 24: N+E+S+W+SE
  222, // Position 25: N+E+S+W+NE+SE
  104, // Position 26: S+W+SW (with corner)
  106, // Position 27: N+S+W+SW
  // Row 4: tiles 28-34
  120, // Position 28: E+S+W+SW
  122, // Position 29: N+E+S+W+SW
  126, // Position 30: N+E+S+W+NE+SW
  248, // Position 31: E+S+W+SE+SW
  250, // Position 32: N+E+S+W+SE+SW
  254, // Position 33: N+E+S+W+NE+SE+SW
  11, // Position 34: N+W+NW (with corner)
  // Row 5: tiles 35-41
  27, // Position 35: N+E+W+NW
  31, // Position 36: N+E+W+NE+NW
  75, // Position 37: N+S+W+NW
  91, // Position 38: N+E+S+W+NW
  95, // Position 39: N+E+S+W+NE+NW
  123, // Position 40: N+E+S+W+NW+SW
  127, // Position 41: N+E+S+W+NE+NW+SW
  // Row 6: tiles 42-46
  107, // Position 42: N+S+W+NW+SW
  219, // Position 43: N+E+S+W+NW+SE
  223, // Position 44: N+E+S+W+NE+NW+SE
  251, // Position 45: N+E+S+W+NW+SE+SW
  255, // Position 46: All neighbors (full interior)
] as const;

/**
 * Derived mapping from bitmask value to tileset position.
 */
function buildPositionMapping(bitmaskValues: readonly number[]): PositionMapping {
  const map: PositionMapping = {};
  bitmaskValues.forEach((bitmask, position) => {
    map[bitmask] = position;
  });
  return map;
}

export const GAMEMAKER_POSITION_MAPPING = buildPositionMapping(GAMEMAKER_BITMASK_VALUES);

export const gamemakerConfig: AutotileConfig = {
  format: 'blob-47',
  name: 'gamemaker',
  bitmaskConvention: GAMEMAKER_BITMASK_CONVENTION,
  bitmaskValues: GAMEMAKER_BITMASK_VALUES,
  positionMapping: GAMEMAKER_POSITION_MAPPING,
  altCenterCount: 3,
};
