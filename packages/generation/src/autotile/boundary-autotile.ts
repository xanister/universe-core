/**
 * Boundary Autotile
 *
 * Applies blob47-style autotiling to boundary/wall tiles by checking their
 * neighbors against a reference mask (typically the deck/room layer below).
 *
 * Unlike standard blob47 which autotiles terrain against itself (same-terrain
 * neighbors), this checks wall tiles against a *different* layer's mask to
 * determine the correct tile configuration. This enables angle-aware railings,
 * terrain-following walls, etc.
 *
 * Example: ship railings trace the hull boundary. Each railing tile's shape
 * depends on where the deck is relative to that wall tile. A tile with deck
 * to the South gets a straight railing along its north edge. A tile with deck
 * to the South and East gets an inner corner railing.
 */

import type { Blob47Config } from '@dmnpc/types/world';
import { bitmaskToTileIndex } from './blob-47.js';

/** The tile index for the fully-surrounded center tile (bitmask 255) in blob-47. */
const CENTER_TILE_INDEX = 46;

/**
 * Compute the 8-bit bitmask for a wall tile by checking which of its
 * 8 neighbors are present in the reference mask (e.g., the deck mask).
 *
 * @param referenceMask - The mask to check neighbors against (true = "matching")
 * @param x - X coordinate of the wall tile
 * @param y - Y coordinate of the wall tile
 * @param convention - Bitmask bit assignments for each direction
 * @returns Raw 8-bit bitmask
 */
function calculateBoundaryBitmask(
  referenceMask: boolean[][],
  x: number,
  y: number,
  convention: Blob47Config['bitmaskConvention'],
): number {
  const height = referenceMask.length;
  const width = referenceMask[0]?.length ?? 0;
  const { N, NE, E, SE, S, SW, W, NW } = convention;

  let mask = 0;

  const check = (dx: number, dy: number, bit: number): void => {
    const nx = x + dx;
    const ny = y + dy;
    // Out of bounds = not matching (no deck outside the map)
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
    if (referenceMask[ny][nx]) mask |= bit;
  };

  check(-1, -1, NW);
  check(0, -1, N);
  check(1, -1, NE);
  check(-1, 0, W);
  check(1, 0, E);
  check(-1, 1, SW);
  check(0, 1, S);
  check(1, 1, SE);

  return mask;
}

/**
 * Apply blob47 autotiling to wall/boundary tiles using a reference mask.
 *
 * For each wall tile (wallMask[y][x] === true), computes a bitmask based on
 * which of its 8 neighbors are true in the referenceMask, then maps that
 * bitmask to a blob47 tile index. Non-wall tiles get -1 (transparent).
 *
 * @param wallMask - Which tiles are wall (true = wall tile to autotile)
 * @param referenceMask - Which tiles are the reference terrain (e.g. deck)
 * @param config - Blob47 autotile configuration (bitmask convention + position mapping)
 * @param rng - Seeded RNG for alt center tile randomization
 * @param altCenterCount - Number of alt center variants (0 = disabled)
 * @returns 2D array of tile indices (0-46 standard, 47+ alt centers, -1 for non-wall)
 */
export function applyBoundaryAutotile(
  wallMask: boolean[][],
  referenceMask: boolean[][],
  config: Blob47Config,
  rng: () => number,
  altCenterCount: number,
): number[][] {
  const height = wallMask.length;
  const width = wallMask[0]?.length ?? 0;
  const resolvedAltCount = altCenterCount;

  const result: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      if (!wallMask[y][x]) {
        row.push(-1);
        continue;
      }

      const rawMask = calculateBoundaryBitmask(referenceMask, x, y, config.bitmaskConvention);
      let tileIndex = bitmaskToTileIndex(rawMask, config);

      // Randomize center tiles when alt variants are available
      if (tileIndex === CENTER_TILE_INDEX && resolvedAltCount > 0) {
        const variant = Math.floor(rng() * (1 + resolvedAltCount));
        tileIndex = CENTER_TILE_INDEX + variant;
      }

      row.push(tileIndex);
    }
    result.push(row);
  }

  return result;
}
