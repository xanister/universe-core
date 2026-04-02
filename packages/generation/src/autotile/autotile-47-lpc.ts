/**
 * Autotile-47 LPC Algorithm
 *
 * Uses the proven node-autotile algorithm, then remaps the output
 * to match the LPC grass_blob47.png tileset layout.
 *
 * Node-autotile Bitmask Convention:
 *   NW=1    N=2    NE=4
 *   W=8     [X]    E=16
 *   SW=32   S=64   SE=128
 *
 * The grass tileset has a different arrangement than the node-autotile tileset,
 * so we apply a remapping after computing the tile index.
 */

import type { Autotile47Config } from '@dmnpc/types/world';

// Exact bitmask values from node-autotile
const NW = 1;
const N = 2;
const NE = 4;
const W = 8;
const E = 16;
const SW = 32;
const S = 64;
const SE = 128;

// Exact BITMASK lookup table from node-autotile (proven to work)
const BITMASK: Record<number, number> = {
  2: 1, // N only
  8: 2, // W only
  10: 3, // N+W
  11: 4, // N+W+NW
  16: 5, // E only
  18: 6, // N+E
  22: 7, // N+E+NE
  24: 8, // E+W
  26: 9, // N+E+W
  27: 10, // N+E+W+NW
  30: 11, // N+E+W+NE
  31: 12, // N+E+W+NE+NW
  64: 13, // S only
  66: 14, // N+S
  72: 15, // S+W
  74: 16, // N+S+W
  75: 17, // N+S+W+NW
  80: 18, // S+E
  82: 19, // N+S+E
  86: 20, // N+S+E+NE
  88: 21, // S+E+W
  90: 22, // N+S+E+W (center)
  91: 23, // N+S+E+W+NW
  94: 24, // N+S+E+W+NE
  95: 25, // N+S+E+W+NE+NW
  104: 26, // S+W+SW
  106: 27, // N+S+W+SW
  107: 28, // N+S+W+NW+SW
  120: 29, // S+E+W+SW
  122: 30, // N+S+E+W+SW
  123: 31, // N+S+E+W+NW+SW
  126: 32, // N+S+E+W+NE+SW
  127: 33, // N+S+E+W+NE+NW+SW
  208: 34, // S+E+SE
  210: 35, // N+S+E+SE
  214: 36, // N+S+E+NE+SE
  216: 37, // S+E+W+SE
  218: 38, // N+S+E+W+SE
  219: 39, // N+S+E+W+NW+SE
  222: 40, // N+S+E+W+NE+SE
  223: 41, // N+S+E+W+NE+NW+SE
  248: 42, // S+E+W+SW+SE
  250: 43, // N+S+E+W+SW+SE
  251: 44, // N+S+E+W+NW+SW+SE
  254: 45, // N+S+E+W+NE+SW+SE
  255: 46, // All neighbors
  0: 47, // Isolated
};

/**
 * Maps node-autotile tile index (1-47) to grass_blob47 tile index (0-46).
 *
 * Built by visually comparing node-autotile-tileset with grass_blob47.png:
 * - Both show the same 47 tile patterns, just arranged differently
 * - Node tile 0 is empty (returns -1)
 * - Node tile 47 (isolated) maps to Grass tile 22
 * - Node tile 46 (all neighbors) maps to Grass tile 0
 *
 * Mapping derived by matching tile shapes between the two tilesets.
 */
const NODE_TO_GRASS: Record<number, number> = {
  // Node 0 is empty/non-floor - handled specially as -1
  1: 5, // N edge → G5 (swapped with S)
  2: 2, // W edge → G2
  3: 3, // N+W outer corner → G3
  4: 4, // N+W+NW filled corner → G4
  5: 13, // E edge → G13
  6: 14, // N+E outer corner → G14
  7: 34, // N+E+NE filled corner → G34
  8: 6, // E+W horizontal strip → G6
  9: 8, // N+E+W T-junction → G8
  10: 9, // N+E+W+NW → G9
  11: 11, // N+E+W+NE → G11
  12: 12, // N+E+W+NE+NW → G12
  13: 1, // S edge → G1 (swapped with N)
  14: 15, // N+S vertical strip → G15
  15: 7, // S+W outer corner → G7
  16: 19, // N+S+W T-junction → G19
  17: 35, // N+S+W+NW → G35
  18: 18, // S+E outer corner → G18
  19: 10, // N+S+E T-junction → G10
  20: 17, // N+S+E+NE → G17
  21: 16, // S+E+W T-junction → G16
  22: 20, // N+S+E+W center → G20
  23: 37, // N+S+E+W+NW → G37
  24: 23, // N+S+E+W+NE → G23
  25: 42, // N+S+E+W+NE+NW → G42
  26: 26, // S+W+SW filled corner → G26
  27: 27, // N+S+W+SW → G27
  28: 40, // N+S+W+NW+SW → G40
  29: 28, // S+E+W+SW → G28
  30: 21, // N+S+E+W+SW → G21
  31: 41, // N+S+E+W+NW+SW → G41
  32: 30, // N+S+E+W+NE+SW → G30
  33: 46, // N+S+E+W+NE+NW+SW → G46
  34: 24, // S+E+SE filled corner → G24
  35: 29, // N+S+E+SE → G29
  36: 39, // N+S+E+NE+SE → G39 (if exists, else nearest)
  37: 36, // S+E+W+SE → G36
  38: 25, // N+S+E+W+SE → G25
  39: 43, // N+S+E+W+NW+SE → G43
  40: 38, // N+S+E+W+NE+SE → G38
  41: 44, // N+S+E+W+NE+NW+SE → G44
  42: 31, // S+E+W+SW+SE → G31
  43: 32, // N+S+E+W+SW+SE → G32
  44: 45, // N+S+E+W+NW+SW+SE → G45
  45: 33, // N+S+E+W+NE+SW+SE → G33
  46: 0, // All neighbors → G0 (full interior)
  47: 22, // Isolated → G22
};

/**
 * Exact copy of autotileLookup from node-autotile
 */
function autotileLookup(
  map: boolean[][],
  x_boundary: number,
  y_boundary: number,
  x: number,
  y: number,
): number {
  let sum = 0;
  let n = false,
    e = false,
    s = false,
    w = false;

  if (!map[y][x]) return 0;

  if (y > 0 && map[y - 1][x]) {
    n = true;
    sum += N;
  }
  if (x > 0 && map[y][x - 1]) {
    w = true;
    sum += W;
  }
  if (x < x_boundary && map[y][x + 1]) {
    e = true;
    sum += E;
  }
  if (y < y_boundary && map[y + 1][x]) {
    s = true;
    sum += S;
  }

  if (n && w && y > 0 && x > 0 && map[y - 1][x - 1]) sum += NW;
  if (n && e && y > 0 && x < x_boundary && map[y - 1][x + 1]) sum += NE;
  if (s && w && y < y_boundary && x > 0 && map[y + 1][x - 1]) sum += SW;
  if (s && e && x < x_boundary && y < y_boundary && map[y + 1][x + 1]) sum += SE;

  return BITMASK[sum];
}

/**
 * Apply autotile-47 LPC to a terrain layer.
 * Uses the proven node-autotile algorithm, then remaps to grass tileset positions.
 *
 * @param terrainGrid - Full terrain grid with terrain type strings
 * @param matchTerrains - Array of terrain types that belong to this layer
 * @param _config - Configuration (reserved for future use)
 * @returns 2D array of tile indices (grass tileset positions, or -1 for transparent)
 */
export function applyAutotile47LpcLayered(
  terrainGrid: string[][],
  matchTerrains: string[],
  _config: Autotile47Config,
): number[][] {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;
  const terrainSet = new Set(matchTerrains);

  // Convert terrain grid to boolean map
  const boolMap: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    boolMap[y] = [];
    for (let x = 0; x < width; x++) {
      boolMap[y][x] = terrainSet.has(terrainGrid[y][x]);
    }
  }

  // Apply node-autotile algorithm, then remap to grass tileset
  const tiles: number[][] = [];
  const x_boundary = width - 1;
  const y_boundary = height - 1;

  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      const nodeTileIndex = autotileLookup(boolMap, x_boundary, y_boundary, x, y);

      if (nodeTileIndex === 0) {
        // Non-floor cell → transparent
        tiles[y][x] = -1;
      } else {
        // Remap node tile index to grass tile index
        tiles[y][x] = NODE_TO_GRASS[nodeTileIndex] ?? 22; // Default to isolated if unmapped
      }
    }
  }

  return tiles;
}
