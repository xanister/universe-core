/**
 * 47-Tile Blob Autotile System
 *
 * Implements the standard 47-tile blob autotile format using pluggable configurations.
 * Each configuration defines its own bitmask convention and position mapping.
 *
 * Corner masking rule: Corner bits (NW/NE/SW/SE) only count when both adjacent
 * cardinal neighbors also match. This reduces 256 possible combinations to 47 unique tiles.
 */

import type { Blob47Config, BitmaskConvention } from '@dmnpc/types/world';

/**
 * Apply corner masking to a raw bitmask.
 * Corners only count when both adjacent cardinal neighbors match.
 *
 * @param rawMask - The raw 8-bit bitmask
 * @param convention - The bitmask convention to use
 * @returns The masked bitmask value
 */
export function applyCornerMasking(rawMask: number, convention: BitmaskConvention): number {
  const { NW, N, NE, W, E, SW, S, SE } = convention;

  // Extract cardinal directions
  const hasN = (rawMask & N) !== 0;
  const hasW = (rawMask & W) !== 0;
  const hasE = (rawMask & E) !== 0;
  const hasS = (rawMask & S) !== 0;

  // Start with cardinals only
  let maskedValue = 0;
  if (hasN) maskedValue |= N;
  if (hasE) maskedValue |= E;
  if (hasS) maskedValue |= S;
  if (hasW) maskedValue |= W;

  // Add corners only if both adjacent cardinals are present
  if ((rawMask & NE) !== 0 && hasN && hasE) maskedValue |= NE;
  if ((rawMask & SE) !== 0 && hasS && hasE) maskedValue |= SE;
  if ((rawMask & SW) !== 0 && hasS && hasW) maskedValue |= SW;
  if ((rawMask & NW) !== 0 && hasN && hasW) maskedValue |= NW;

  return maskedValue;
}

/**
 * Converts a raw 8-bit bitmask to the corresponding tile index.
 * Applies corner masking rules and looks up the position in the config's mapping.
 *
 * @param rawMask - The raw 8-bit bitmask
 * @param config - The blob-47 autotile configuration
 * @returns The tile index (0-46) for rendering
 */
export function bitmaskToTileIndex(rawMask: number, config: Blob47Config): number {
  const maskedValue = applyCornerMasking(rawMask, config.bitmaskConvention);

  // Look up the position in the config's mapping
  const position = config.positionMapping[maskedValue];

  // If not found (shouldn't happen with correct masking), default to isolated
  return position;
}

/**
 * Calculates the bitmask for a tile based on its neighbors in the grid.
 *
 * @param grid - 2D array of terrain type strings
 * @param x - X coordinate of the tile
 * @param y - Y coordinate of the tile
 * @param terrain - The terrain type to match against neighbors
 * @param config - The blob-47 autotile configuration
 * @returns The 8-bit bitmask representing which neighbors match
 */
export function calculateBitmask(
  grid: string[][],
  x: number,
  y: number,
  terrain: string,
  config: Blob47Config,
): number {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const { N, NE, E, SE, S, SW, W, NW } = config.bitmaskConvention;

  let mask = 0;

  const checkNeighbor = (dx: number, dy: number, bit: number): void => {
    const nx = x + dx;
    const ny = y + dy;

    // Out of bounds counts as non-matching
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
      return;
    }

    if (grid[ny][nx] === terrain) {
      mask |= bit;
    }
  };

  // Check all 8 neighbors using config's bit assignments
  checkNeighbor(-1, -1, NW);
  checkNeighbor(0, -1, N);
  checkNeighbor(1, -1, NE);
  checkNeighbor(-1, 0, W);
  checkNeighbor(1, 0, E);
  checkNeighbor(-1, 1, SW);
  checkNeighbor(0, 1, S);
  checkNeighbor(1, 1, SE);

  return mask;
}

/**
 * Gets the tile index for a position in the grid.
 * Combines bitmask calculation and tile index lookup.
 *
 * @param grid - 2D array of terrain type strings
 * @param x - X coordinate of the tile
 * @param y - Y coordinate of the tile
 * @param terrain - The terrain type at this position
 * @param config - The blob-47 autotile configuration
 * @returns The tile index (0-46) for rendering
 */
export function getTileIndex(
  grid: string[][],
  x: number,
  y: number,
  terrain: string,
  config: Blob47Config,
): number {
  const mask = calculateBitmask(grid, x, y, terrain, config);
  return bitmaskToTileIndex(mask, config);
}

/**
 * Converts a tile index to coordinates in a 7-column tileset layout.
 * Standard layout: 7 columns x 8 rows (47 tiles + 3 alt center tiles).
 *
 * @param tileIndex - The tile index (0-49; 0-46 standard, 47-49 alt centers)
 * @param tileSize - Size of each tile in pixels
 * @returns The x,y coordinates in the tileset
 */
export function tileIndexToCoordinates(
  tileIndex: number,
  tileSize: number = 32,
): { x: number; y: number } {
  const col = tileIndex % 7;
  const row = Math.floor(tileIndex / 7);
  return {
    x: col * tileSize,
    y: row * tileSize,
  };
}

/**
 * Applies autotile to an entire grid, returning tile indices for each position.
 *
 * @param grid - 2D array of terrain type strings
 * @param config - The blob-47 autotile configuration
 * @returns 2D array of tile indices
 */
export function applyAutotile(grid: string[][], config: Blob47Config): number[][] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  const result: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const terrain = grid[y][x];
      row.push(getTileIndex(grid, x, y, terrain, config));
    }
    result.push(row);
  }

  return result;
}

/**
 * Calculates the bitmask for a tile based on its neighbors,
 * treating multiple terrain types as "same" for this layer.
 *
 * @param grid - 2D array of terrain type strings
 * @param x - X coordinate of the tile
 * @param y - Y coordinate of the tile
 * @param matchTerrains - Array of terrain types that count as "same" for this layer
 * @param config - The blob-47 autotile configuration
 * @returns The 8-bit bitmask representing which neighbors match
 */
export function calculateLayerBitmask(
  grid: string[][],
  x: number,
  y: number,
  matchTerrains: string[],
  config: Blob47Config,
): number {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const { N, NE, E, SE, S, SW, W, NW } = config.bitmaskConvention;

  let mask = 0;
  const terrainSet = new Set(matchTerrains);

  const checkNeighbor = (dx: number, dy: number, bit: number): void => {
    const nx = x + dx;
    const ny = y + dy;

    // Out of bounds counts as non-matching (transparent edge)
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
      return;
    }

    // Neighbor matches if it's any of the "same" terrain types
    if (terrainSet.has(grid[ny][nx])) {
      mask |= bit;
    }
  };

  // Check all 8 neighbors using config's bit assignments
  checkNeighbor(-1, -1, NW);
  checkNeighbor(0, -1, N);
  checkNeighbor(1, -1, NE);
  checkNeighbor(-1, 0, W);
  checkNeighbor(1, 0, E);
  checkNeighbor(-1, 1, SW);
  checkNeighbor(0, 1, S);
  checkNeighbor(1, 1, SE);

  return mask;
}

/** The tile index for the fully-surrounded center tile (bitmask 255) in blob-47. */
const CENTER_TILE_INDEX = 46;

/**
 * Apply autotile to a terrain layer, considering which terrain types count as "same".
 * Returns -1 for cells that don't match any of the layer's terrains (transparent).
 *
 * This enables layered rendering where each terrain type (water, grass, forest)
 * is rendered on its own layer with proper autotile edges against transparency.
 *
 * When `rng` and `altCenterCount` are provided, fully-surrounded tiles (center,
 * index 46) are randomly replaced with alt center tiles at indices 47..46+altCenterCount.
 * This breaks up visual monotony in large terrain patches.
 *
 * @param terrainGrid - Full terrain grid with all terrain types
 * @param matchTerrains - Array of terrain types that belong to this layer
 * @param config - The blob-47 autotile configuration
 * @param rng - Optional seeded RNG for alt center tile selection
 * @param altCenterCount - Number of alt center variants (0 = disabled). Defaults to config.altCenterCount.
 * @returns 2D array of autotile indices (0-46, or 47-49 for alt centers) or -1 for transparent cells
 */
export function applyLayeredAutotile(
  terrainGrid: string[][],
  matchTerrains: string[],
  config: Blob47Config,
  rng?: (() => number) | null,
  altCenterCount?: number,
): number[][] {
  const height = terrainGrid.length;
  const width = terrainGrid[0]?.length ?? 0;
  const terrainSet = new Set(matchTerrains);

  const resolvedAltCount = altCenterCount ?? config.altCenterCount;

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

      // Calculate bitmask treating all matchTerrains as "same"
      const mask = calculateLayerBitmask(terrainGrid, x, y, matchTerrains, config);
      let tileIndex = bitmaskToTileIndex(mask, config);

      // Randomize center tiles when alt variants are available
      if (tileIndex === CENTER_TILE_INDEX && resolvedAltCount > 0 && rng) {
        // Pick from [46, 47, ..., 46 + altCenterCount] — total of (1 + altCenterCount) options
        const variant = Math.floor(rng() * (1 + resolvedAltCount));
        tileIndex = CENTER_TILE_INDEX + variant;
      }

      row.push(tileIndex);
    }
    result.push(row);
  }

  return result;
}

/**
 * Generate a full 256-entry lookup table mapping raw bitmasks to tile indices.
 * Useful for precomputing all possible mappings for a config.
 *
 * @param config - The blob-47 autotile configuration
 * @returns Record mapping all 256 raw bitmasks to tile indices
 */
export function generateBitmaskLookupTable(config: Blob47Config): Record<number, number> {
  const mapping: Record<number, number> = {};

  for (let mask = 0; mask < 256; mask++) {
    mapping[mask] = bitmaskToTileIndex(mask, config);
  }

  return mapping;
}
