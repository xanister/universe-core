/**
 * Wang 2-Corner (16-Tile) Autotile System
 *
 * Implements the standard Wang 2-corner tile format as documented at:
 * https://dev.to/joestrout/wang-2-corner-tiles-544k
 *
 * This system uses 16 tiles (4x4 grid) indexed 0-15 based on which corners
 * contain the "foreground" terrain type.
 *
 * Corner weightings:
 *   - NE (Northeast) = 1
 *   - SE (Southeast) = 2
 *   - SW (Southwest) = 4
 *   - NW (Northwest) = 8
 *
 * The tile index is the sum of weights for corners that are "filled".
 *
 * Key concept: The terrain grid represents CORNERS, not cells.
 * Each rendered tile sits between 4 corners in the terrain grid.
 * For a tile at position (x, y) in the output:
 *   - NW corner value = terrain at grid[y][x]
 *   - NE corner value = terrain at grid[y][x+1]
 *   - SW corner value = terrain at grid[y+1][x]
 *   - SE corner value = terrain at grid[y+1][x+1]
 */

import type { Wang2CornerConfig } from '@dmnpc/types/world';

/**
 * Standard Wang 2-corner convention.
 * NE=1, SE=2, SW=4, NW=8
 */
export const WANG_2CORNER_WEIGHTS = {
  NE: 1,
  SE: 2,
  SW: 4,
  NW: 8,
} as const;

/**
 * Calculate the Wang 2-corner tile index for a position.
 *
 * The terrain grid is treated as a "corner grid" where each cell represents
 * the terrain at a corner point. The rendered tile at position (x, y) spans
 * 4 corners: grid[y][x], grid[y][x+1], grid[y+1][x], grid[y+1][x+1].
 *
 * @param terrainGrid - 2D array of terrain types (corner values)
 * @param x - X coordinate in the output tile grid
 * @param y - Y coordinate in the output tile grid
 * @param foregroundTerrains - Terrain types that are "filled" (foreground)
 * @returns Tile index 0-15
 */
export function calculateWang2CornerIndex(
  terrainGrid: string[][],
  x: number,
  y: number,
  foregroundTerrains: string[],
): number {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;
  const fgSet = new Set(foregroundTerrains);

  // Helper to check if a corner is foreground
  const isFilled = (cx: number, cy: number): boolean => {
    if (cy < 0 || cy >= height || cx < 0 || cx >= width) {
      return false; // Out of bounds = background
    }
    return fgSet.has(terrainGrid[cy][cx]);
  };

  let index = 0;

  // Check each corner of the tile at position (x, y)
  // NW corner = grid[y][x]
  if (isFilled(x, y)) index |= WANG_2CORNER_WEIGHTS.NW;

  // NE corner = grid[y][x+1]
  if (isFilled(x + 1, y)) index |= WANG_2CORNER_WEIGHTS.NE;

  // SW corner = grid[y+1][x]
  if (isFilled(x, y + 1)) index |= WANG_2CORNER_WEIGHTS.SW;

  // SE corner = grid[y+1][x+1]
  if (isFilled(x + 1, y + 1)) index |= WANG_2CORNER_WEIGHTS.SE;

  return index;
}

/**
 * Apply Wang 2-corner autotiling to a terrain grid.
 *
 * IMPORTANT: The output grid will be (width-1) x (height-1) because each
 * output tile spans 4 input cells. This is the correct behavior for Wang
 * 2-corner tiles where the input represents corner values.
 *
 * @param terrainGrid - 2D array of terrain types (represents corners)
 * @param foregroundTerrains - Terrain types that are "filled"
 * @returns 2D array of tile indices (0-15)
 */
export function applyWang2CornerAutotile(
  terrainGrid: string[][],
  foregroundTerrains: string[],
): number[][] {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;

  // Output is (width-1) x (height-1) because each tile spans 4 corners
  const outWidth = Math.max(0, width - 1);
  const outHeight = Math.max(0, height - 1);

  const result: number[][] = [];

  for (let y = 0; y < outHeight; y++) {
    const row: number[] = [];
    for (let x = 0; x < outWidth; x++) {
      row.push(calculateWang2CornerIndex(terrainGrid, x, y, foregroundTerrains));
    }
    result.push(row);
  }

  return result;
}

/**
 * Apply Wang 2-corner autotiling with same dimensions as input.
 *
 * EXACT port from Mini Micro's maze.ms pickTile function:
 *   n = 1 * corners[col][row] +
 *       2 * corners[col][row-1] +
 *       4 * corners[col-1][row-1] +
 *       8 * corners[col-1][row]
 *
 * Mini Micro has Y increasing UP. Our system has Y increasing DOWN.
 * So row-1 (south in MM) becomes y+1 (south in ours).
 *
 * Translated to our coordinates:
 *   n = 1 * corners[x][y] +       // NE
 *       2 * corners[x][y+1] +     // SE
 *       4 * corners[x-1][y+1] +   // SW
 *       8 * corners[x-1][y]       // NW
 */
export function applyWang2CornerLayered(
  terrainGrid: string[][],
  foregroundTerrains: string[],
  _config: Wang2CornerConfig,
): number[][] {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;
  const fgSet = new Set(foregroundTerrains);

  // Is the cell at (x, y) a foreground terrain? Returns 1 or 0.
  const corner = (x: number, y: number): number => {
    if (y < 0 || y >= height || x < 0 || x >= width) {
      return 0;
    }
    return fgSet.has(terrainGrid[y][x]) ? 1 : 0;
  };

  const result: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      // If this cell is not foreground, mark as transparent
      if (!fgSet.has(terrainGrid[y][x])) {
        row.push(-1);
        continue;
      }

      // EXACT Mini Micro formula with Y flipped
      const index =
        1 * corner(x, y) + 2 * corner(x, y + 1) + 4 * corner(x - 1, y + 1) + 8 * corner(x - 1, y);

      row.push(index);
    }
    result.push(row);
  }

  return result;
}

/**
 * Convert a Wang 2-corner tile index to tileset coordinates.
 *
 * @param tileIndex - Tile index 0-15
 * @param tileSize - Size of each tile in pixels (default 32)
 * @param cols - Number of columns in tileset (default 4)
 * @returns Pixel coordinates {x, y} in the tileset
 */
export function wang2CornerIndexToCoords(
  tileIndex: number,
  tileSize: number = 32,
  cols: number = 4,
): { x: number; y: number } {
  const col = tileIndex % cols;
  const row = Math.floor(tileIndex / cols);
  return {
    x: col * tileSize,
    y: row * tileSize,
  };
}
