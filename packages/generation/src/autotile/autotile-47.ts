/**
 * Autotile-47 Algorithm
 *
 * EXACT copy from: https://github.com/tlhunter/node-autotile
 * Tileset: node-autotile-tileset.png (8 cols x 6 rows, indices 0-47)
 *
 * Bitmask Convention:
 *   NW=1    N=2    NE=4
 *   W=8     [X]    E=16
 *   SW=32   S=64   SE=128
 */

import type { Autotile47Config } from '@dmnpc/types/world';

// Exact bitmask values from node-autotile
const NW = Math.pow(2, 0); // 1
const N = Math.pow(2, 1); // 2
const NE = Math.pow(2, 2); // 4
const W = Math.pow(2, 3); // 8
const E = Math.pow(2, 4); // 16
const SW = Math.pow(2, 5); // 32
const S = Math.pow(2, 6); // 64
const SE = Math.pow(2, 7); // 128

// Exact BITMASK lookup table from node-autotile
const BITMASK: Record<number, number> = {
  2: 1,
  8: 2,
  10: 3,
  11: 4,
  16: 5,
  18: 6,
  22: 7,
  24: 8,
  26: 9,
  27: 10,
  30: 11,
  31: 12,
  64: 13,
  66: 14,
  72: 15,
  74: 16,
  75: 17,
  80: 18,
  82: 19,
  86: 20,
  88: 21,
  90: 22,
  91: 23,
  94: 24,
  95: 25,
  104: 26,
  106: 27,
  107: 28,
  120: 29,
  122: 30,
  123: 31,
  126: 32,
  127: 33,
  208: 34,
  210: 35,
  214: 36,
  216: 37,
  218: 38,
  219: 39,
  222: 40,
  223: 41,
  248: 42,
  250: 43,
  251: 44,
  254: 45,
  255: 46,
  0: 47,
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
 * Apply autotile-47 to a terrain layer.
 * Returns a 2D array of tile indices (0-47) where 0 = no tile.
 *
 * @param terrainGrid - Full terrain grid with terrain type strings
 * @param matchTerrains - Array of terrain types that belong to this layer
 * @param _config - Configuration (reserved for future use)
 * @returns 2D array of tile indices
 */
export function applyAutotile47Layered(
  terrainGrid: string[][],
  matchTerrains: string[],
  _config: Autotile47Config,
): number[][] {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;
  const terrainSet = new Set(matchTerrains);

  // Convert terrain grid to boolean map (true = floor, false = not floor)
  const boolMap: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    boolMap[y] = [];
    for (let x = 0; x < width; x++) {
      boolMap[y][x] = terrainSet.has(terrainGrid[y][x]);
    }
  }

  // Use exact node-autotile algorithm
  const tiles: number[][] = [];
  const x_boundary = width - 1;
  const y_boundary = height - 1;

  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      const tileIndex = autotileLookup(boolMap, x_boundary, y_boundary, x, y);
      // node-autotile returns 0 for non-floor, we use -1 for transparency
      tiles[y][x] = tileIndex === 0 ? -1 : tileIndex;
    }
  }

  return tiles;
}
