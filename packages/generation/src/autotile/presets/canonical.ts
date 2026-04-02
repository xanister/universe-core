/**
 * Canonical Blob-47 Autotile Configuration
 *
 * Standard blob-47 convention used by cr31.co.uk, Godot, RPG Maker VX/Ace, and Tiled.
 *
 * Bitmask layout (clockwise from North):
 *   NW=128  N=1   NE=2
 *   W=64    [X]   E=4
 *   SW=32   S=16  SE=8
 */

import type { AutotileConfig, BitmaskConvention, PositionMapping } from '@dmnpc/types/world';

export const CANONICAL_BITMASK_CONVENTION: BitmaskConvention = {
  N: 1,
  NE: 2,
  E: 4,
  SE: 8,
  S: 16,
  SW: 32,
  W: 64,
  NW: 128,
};

/**
 * The 47 unique bitmask values in tileset position order.
 * These are the values AFTER corner masking is applied.
 *
 * Arranged in the standard 7x7 blob spritesheet order:
 * - Row 0: Isolated, edges, basic corners
 * - Row 1-2: T-junctions, strips
 * - Row 3-4: Center variants with corner combinations
 * - Row 5-6: Complex corner combinations, full interior
 */
export const CANONICAL_BITMASK_VALUES = [
  // Row 0: tiles 0-6
  0, // Position 0: Isolated (no neighbors)
  1, // Position 1: N only
  4, // Position 2: E only
  5, // Position 3: N+E (no corner)
  7, // Position 4: N+E+NE (with corner)
  16, // Position 5: S only
  17, // Position 6: N+S (vertical strip)
  // Row 1: tiles 7-13
  20, // Position 7: E+S (no corner)
  21, // Position 8: N+E+S (T open to W)
  23, // Position 9: N+E+S+NE
  28, // Position 10: E+S+SE (with corner)
  29, // Position 11: N+E+S+SE
  31, // Position 12: N+E+S+NE+SE
  64, // Position 13: W only
  // Row 2: tiles 14-20
  65, // Position 14: N+W (no corner)
  68, // Position 15: E+W (horizontal strip)
  69, // Position 16: N+E+W (T open to S)
  71, // Position 17: N+E+W+NE
  80, // Position 18: S+W (no corner)
  81, // Position 19: N+S+W (T open to E)
  84, // Position 20: E+S+W (T open to N)
  // Row 3: tiles 21-27
  85, // Position 21: N+E+S+W (no corners - center)
  87, // Position 22: N+E+S+W+NE
  92, // Position 23: E+S+W+SE
  93, // Position 24: N+E+S+W+SE
  95, // Position 25: N+E+S+W+NE+SE
  112, // Position 26: S+W+SW (with corner)
  113, // Position 27: N+S+W+SW
  // Row 4: tiles 28-34
  116, // Position 28: E+S+W+SW
  117, // Position 29: N+E+S+W+SW
  119, // Position 30: N+E+S+W+NE+SW
  124, // Position 31: E+S+W+SE+SW
  125, // Position 32: N+E+S+W+SE+SW
  127, // Position 33: N+E+S+W+NE+SE+SW
  193, // Position 34: N+W+NW (with corner)
  // Row 5: tiles 35-41
  197, // Position 35: N+E+W+NW
  199, // Position 36: N+E+W+NE+NW
  209, // Position 37: N+S+W+NW
  213, // Position 38: N+E+S+W+NW
  215, // Position 39: N+E+S+W+NE+NW
  221, // Position 40: N+E+S+W+NW+SW
  223, // Position 41: N+E+S+W+NE+NW+SW
  // Row 6: tiles 42-46
  241, // Position 42: N+S+W+NW+SW
  245, // Position 43: N+E+S+W+NW+SE
  247, // Position 44: N+E+S+W+NE+NW+SE
  253, // Position 45: N+E+S+W+NW+SE+SW
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

export const CANONICAL_POSITION_MAPPING = buildPositionMapping(CANONICAL_BITMASK_VALUES);

export const canonicalConfig: AutotileConfig = {
  format: 'blob-47',
  name: 'canonical',
  bitmaskConvention: CANONICAL_BITMASK_CONVENTION,
  bitmaskValues: CANONICAL_BITMASK_VALUES,
  positionMapping: CANONICAL_POSITION_MAPPING,
  altCenterCount: 3,
};
