/**
 * Wang 2-Corner (16-Tile) Autotile System
 *
 * Implements the Wang 2-corner tile format used by LPC terrain tilesets.
 * This system uses 16 tiles based on which of 4 corners contain terrain.
 *
 * Unlike blob-47 which checks 8 neighbors of each cell, wang-16 determines
 * the tile based on the terrain types in 4 surrounding cells that form the
 * "corners" of the tile.
 *
 * For a tile at position (x, y) in the output grid:
 *   - NW corner = cell at (x, y)
 *   - NE corner = cell at (x+1, y)
 *   - SW corner = cell at (x, y+1)
 *   - SE corner = cell at (x+1, y+1)
 *
 * The tile index is calculated as:
 *   Index = NE(1) + SE(2) + SW(4) + NW(8)
 *
 * This gives values 0-15, where:
 *   - 0 = no corners filled (empty/background)
 *   - 15 = all corners filled (solid center)
 */

import type { Wang16Config, Wang16Convention } from '@dmnpc/types/world';

/**
 * Standard Wang 2-corner convention used by LPC terrains.
 * Corner bits: NE=1, SE=2, SW=4, NW=8
 */
export const STANDARD_WANG16_CONVENTION: Wang16Convention = {
  NE: 1,
  SE: 2,
  SW: 4,
  NW: 8,
};

/**
 * Calculate the Wang-16 tile index for a position in the terrain grid.
 *
 * For a tile at output position (x, y), we look at the 4 surrounding cells
 * in the terrain grid to determine which corners should be filled.
 *
 * @param grid - 2D array of terrain type strings
 * @param x - X coordinate in the output tile grid
 * @param y - Y coordinate in the output tile grid
 * @param matchTerrains - Array of terrain types that count as "filled"
 * @param convention - The corner bit convention to use
 * @returns The tile index (0-15)
 */
export function calculateWang16Index(
  grid: string[][],
  x: number,
  y: number,
  matchTerrains: string[],
  convention: Wang16Convention = STANDARD_WANG16_CONVENTION,
): number {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const terrainSet = new Set(matchTerrains);

  let index = 0;

  // Check NW corner (cell at x, y)
  if (y >= 0 && y < height && x >= 0 && x < width && terrainSet.has(grid[y][x])) {
    index |= convention.NW;
  }

  // Check NE corner (cell at x+1, y)
  if (y >= 0 && y < height && x + 1 >= 0 && x + 1 < width && terrainSet.has(grid[y][x + 1])) {
    index |= convention.NE;
  }

  // Check SW corner (cell at x, y+1)
  if (y + 1 >= 0 && y + 1 < height && x >= 0 && x < width && terrainSet.has(grid[y + 1][x])) {
    index |= convention.SW;
  }

  // Check SE corner (cell at x+1, y+1)
  if (
    y + 1 >= 0 &&
    y + 1 < height &&
    x + 1 >= 0 &&
    x + 1 < width &&
    terrainSet.has(grid[y + 1][x + 1])
  ) {
    index |= convention.SE;
  }

  return index;
}

/**
 * Apply Wang-16 autotile to a terrain grid.
 *
 * Note: The output grid is (width-1) x (height-1) compared to the input grid,
 * because each output tile sits between 4 input cells.
 *
 * Returns -1 for tiles where no corners match (completely transparent).
 *
 * @param terrainGrid - 2D array of terrain type strings
 * @param matchTerrains - Array of terrain types that belong to this layer
 * @param convention - The corner bit convention to use
 * @returns 2D array of tile indices (0-15) or -1 for transparent tiles
 */
export function applyWang16Autotile(
  terrainGrid: string[][],
  matchTerrains: string[],
  convention: Wang16Convention = STANDARD_WANG16_CONVENTION,
): number[][] {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;

  // Output grid is (width-1) x (height-1)
  const outputWidth = Math.max(0, width - 1);
  const outputHeight = Math.max(0, height - 1);

  const result: number[][] = [];

  for (let y = 0; y < outputHeight; y++) {
    const row: number[] = [];
    for (let x = 0; x < outputWidth; x++) {
      const index = calculateWang16Index(terrainGrid, x, y, matchTerrains, convention);
      // Index 0 means no corners filled - could be transparent
      // But we'll let the caller decide how to handle 0
      row.push(index);
    }
    result.push(row);
  }

  return result;
}

/**
 * Apply Wang-16 autotile with same output dimensions as input.
 *
 * This version pads the output to match input dimensions by treating
 * out-of-bounds cells as non-matching (empty corners).
 *
 * Returns -1 for cells that don't contain any of the match terrains.
 *
 * @param terrainGrid - 2D array of terrain type strings
 * @param matchTerrains - Array of terrain types that belong to this layer
 * @param config - The Wang-16 configuration
 * @returns 2D array of tile indices (0-15) or -1 for transparent cells
 */
export function applyWang16LayeredAutotile(
  terrainGrid: string[][],
  matchTerrains: string[],
  config: Wang16Config,
): number[][] {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;
  const terrainSet = new Set(matchTerrains);
  const convention = config.cornerConvention;

  const result: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const cellTerrain = terrainGrid[y][x];

      // If this cell doesn't belong to this layer, it's transparent
      if (!terrainSet.has(cellTerrain)) {
        row.push(-1);
        continue;
      }

      // For wang-16, we need to think about the tile position differently.
      // Each rendered tile at grid position (x, y) should show transitions
      // based on what's around it.
      //
      // We'll use a modified approach: for cell (x, y), determine what tile
      // to show based on the 4 cells that would overlap this position:
      // The tile index is determined by checking if the cells at
      // (x, y), (x-1, y), (x, y-1), (x-1, y-1) are all the same terrain.
      //
      // Actually, for LPC-style rendering, we want to show the appropriate
      // edge/corner tile based on which adjacent cells match.

      let index = 0;

      // Check each corner of this cell's position
      // NW corner: does cell (x-1, y-1) have matching terrain? → affects our NW visual
      // But for LPC tiles, the convention is about which corners of THIS tile are filled.
      //
      // Let's use a simpler approach: check the 4 quadrants around this cell.
      // If a neighbor in a direction exists and matches, that corner is "filled".

      // For a cell-based approach, we check if the cell and its neighbors form filled corners
      // NW quadrant: cells at (x-1, y-1), (x, y-1), (x-1, y), and (x, y)
      // We simplify: NW corner is filled if NW, N, and W neighbors all match

      // Actually, the cleanest approach for cell-per-tile rendering:
      // Just check the 4 diagonal neighbors to determine corner fills.
      // NW filled if cells (x, y), (x-1, y), (x, y-1), and (x-1, y-1) all match
      // But this gets complex...

      // Simpler approach for visual correctness:
      // Fill corner bits based on whether adjacent cells in that direction match.
      // NW = if cells to NW, N, and W are same terrain (or out of bounds counts as match)
      // This creates the typical terrain "blob" appearance.

      const matches = (cx: number, cy: number): boolean => {
        if (cy < 0 || cy >= height || cx < 0 || cx >= width) {
          // Out of bounds - treat as non-matching for edge cases
          return false;
        }
        return terrainSet.has(terrainGrid[cy][cx]);
      };

      // For cell at (x, y), check corners:
      // NW corner: requires N and W neighbors to both match (and ideally NW too)
      const hasN = matches(x, y - 1);
      const hasS = matches(x, y + 1);
      const hasW = matches(x - 1, y);
      const hasE = matches(x + 1, y);
      const hasNW = matches(x - 1, y - 1);
      const hasNE = matches(x + 1, y - 1);
      const hasSW = matches(x - 1, y + 1);
      const hasSE = matches(x + 1, y + 1);

      // Set corner bits based on whether there's continuity in that direction
      // A corner is "filled" if both adjacent cardinal directions have matching terrain
      if (hasN && hasW && hasNW) index |= convention.NW;
      if (hasN && hasE && hasNE) index |= convention.NE;
      if (hasS && hasW && hasSW) index |= convention.SW;
      if (hasS && hasE && hasSE) index |= convention.SE;

      row.push(index);
    }
    result.push(row);
  }

  return result;
}

/**
 * Convert a Wang-16 tile index to coordinates in the tileset.
 *
 * LPC terrains typically use a 4x4 grid layout for the 16 tiles.
 *
 * @param tileIndex - The tile index (0-15)
 * @param tileSize - Size of each tile in pixels
 * @param gridCols - Number of columns in the tileset grid (default 4)
 * @returns The x,y coordinates in the tileset
 */
export function wang16IndexToCoordinates(
  tileIndex: number,
  tileSize: number = 32,
  gridCols: number = 4,
): { x: number; y: number } {
  const col = tileIndex % gridCols;
  const row = Math.floor(tileIndex / gridCols);
  return {
    x: col * tileSize,
    y: row * tileSize,
  };
}
