/**
 * Path Generator
 *
 * Generates a single winding trail between two random edge points.
 * Always 1-tile wide. Uses noise offset for organic feel.
 * Suitable for village trails and forest paths.
 */

import { randomIntWithRng } from '@dmnpc/core/infra/random-utils.js';

export interface PathResult {
  /** 2D mask: true = path tile. */
  mask: boolean[][];
}

/**
 * Generate a winding path between two random edge points.
 *
 * @param width Grid width in tiles
 * @param height Grid height in tiles
 * @param curvature Winding amount (0-1). 0 = straight, 1 = very winding
 * @param rng Seeded RNG function
 */
export function generatePath(
  width: number,
  height: number,
  curvature: number,
  rng: () => number,
): PathResult {
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );

  // Pick two random edge points
  const start = pickEdgePoint(width, height, rng);
  const end = pickEdgePoint(width, height, rng, start);

  // Walk from start to end with noise offset
  walkWithNoise(mask, start.x, start.y, end.x, end.y, curvature, width, height, rng);

  return { mask };
}

interface Point {
  x: number;
  y: number;
}

/** Pick a random point on the grid border, far from an optional existing point. */
function pickEdgePoint(width: number, height: number, rng: () => number, awayFrom?: Point): Point {
  let best: Point = { x: 0, y: 0 };
  let bestDist = -1;

  const attempts = awayFrom ? 10 : 1;
  for (let i = 0; i < attempts; i++) {
    const edge = Math.floor(rng() * 4);
    let p: Point;
    switch (edge) {
      case 0:
        p = { x: randomIntWithRng(rng, 2, width - 3), y: 0 };
        break;
      case 1:
        p = { x: width - 1, y: randomIntWithRng(rng, 2, height - 3) };
        break;
      case 2:
        p = { x: randomIntWithRng(rng, 2, width - 3), y: height - 1 };
        break;
      default:
        p = { x: 0, y: randomIntWithRng(rng, 2, height - 3) };
        break;
    }

    if (!awayFrom) return p;

    const dist = Math.abs(p.x - awayFrom.x) + Math.abs(p.y - awayFrom.y);
    if (dist > bestDist) {
      bestDist = dist;
      best = p;
    }
  }

  return best;
}

/**
 * Walk from start to end with perpendicular noise offset for organic feel.
 * Alternates between primary (toward target) and noise (perpendicular) steps.
 */
function walkWithNoise(
  mask: boolean[][],
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  curvature: number,
  gridWidth: number,
  gridHeight: number,
  rng: () => number,
): void {
  let x = startX;
  let y = startY;

  // Safety limit to prevent infinite loops
  const maxSteps = (gridWidth + gridHeight) * 3;
  let steps = 0;

  while ((x !== endX || y !== endY) && steps < maxSteps) {
    mask[y][x] = true;
    steps++;

    const dx = endX - x;
    const dy = endY - y;

    // Apply noise offset perpendicular to travel direction
    if (curvature > 0 && rng() < curvature * 0.4) {
      // Perpendicular step
      if (Math.abs(dx) > Math.abs(dy)) {
        // Primarily horizontal → noise is vertical
        const noiseY = rng() < 0.5 ? -1 : 1;
        const ny = clamp(y + noiseY, 0, gridHeight - 1);
        if (ny !== y) {
          y = ny;
          mask[y][x] = true;
          steps++;
        }
      } else {
        // Primarily vertical → noise is horizontal
        const noiseX = rng() < 0.5 ? -1 : 1;
        const nx = clamp(x + noiseX, 0, gridWidth - 1);
        if (nx !== x) {
          x = nx;
          mask[y][x] = true;
          steps++;
        }
      }
    }

    // Primary step toward target
    if (x !== endX || y !== endY) {
      // Prefer the axis with greater remaining distance
      if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
        x += dx > 0 ? 1 : -1;
      } else if (dy !== 0) {
        y += dy > 0 ? 1 : -1;
      } else if (dx !== 0) {
        x += dx > 0 ? 1 : -1;
      }
    }
  }

  // Mark final tile
  mask[y][x] = true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
