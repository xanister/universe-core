/**
 * Cave Network Generator
 *
 * Generates a branching tunnel network through solid rock.
 * Inverse of the road generator: every tile starts blocked; the generator
 * carves passable passages through it.
 *
 * Algorithm:
 * 1. Fill 2D mask with false (all rock — blocking)
 * 2. Pick 2 interior points → connect with L-shaped cardinal path (spine)
 * 3. Pick random points along spine → extend perpendicular branches
 * 4. Expand tunnel width if > 1
 * 5. Flood-fill to validate connectivity
 */

import type { CaveGraph, CaveNode, CaveEdge } from '@dmnpc/types/world';
import { randomIntWithRng } from '@dmnpc/core/infra/random-utils.js';

export interface CaveNetworkResult {
  /** Cave network graph for Phase 2 placement algorithms. */
  graph: CaveGraph;
  /** 2D mask: true = carved tunnel tile (passable). */
  mask: boolean[][];
}

interface Point {
  x: number;
  y: number;
}

/**
 * Generate a cave tunnel network on a tile grid.
 *
 * @param width Grid width in tiles
 * @param height Grid height in tiles
 * @param tunnelWidth Tunnel width in tiles (1-3)
 * @param branchCount Number of branches off the main spine (0-6)
 * @param curvature Noise-based curvature (0-1). 0 = straight L-paths, 1 = maximum winding
 * @param rng Seeded RNG function
 * @param edgeBuffer Minimum distance in tiles from grid edges for tunnel placement.
 *   Defaults to ~10% of the smaller dimension (min 3). Set 0 to disable.
 */
export function generateCaveNetwork(
  width: number,
  height: number,
  tunnelWidth: number,
  branchCount: number,
  curvature: number,
  rng: () => number,
  edgeBuffer?: number,
): CaveNetworkResult {
  const minDim = Math.min(width, height);
  const rawBuffer = edgeBuffer ?? Math.max(3, Math.floor(minDim * 0.1));
  // Safety: if buffer is too large for the grid, shrink it
  const buffer = rawBuffer * 2 >= minDim ? Math.max(1, Math.floor(minDim / 4)) : rawBuffer;

  // Start with all rock (false = impassable)
  const mask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );
  const nodes: CaveNode[] = [];
  const edges: CaveEdge[] = [];

  // --- Spine: connect two random interior points ---
  const spineStart = pickInteriorPoint(width, height, rng, undefined, buffer);
  const spineEnd = pickInteriorPoint(width, height, rng, spineStart, buffer);

  const startIdx = addNode(nodes, spineStart.x, spineStart.y, 'endpoint');
  const endIdx = addNode(nodes, spineEnd.x, spineEnd.y, 'endpoint');
  edges.push({ from: startIdx, to: endIdx });

  const spineTiles = rasterizeLPath(spineStart, spineEnd, width, height, curvature, rng, buffer);
  paintTiles(mask, spineTiles);

  // --- Branches: extend perpendicular from random spine points ---
  const actualBranchCount = Math.min(branchCount, Math.max(0, spineTiles.length - 2));

  for (let i = 0; i < actualBranchCount; i++) {
    // Pick a random point along the spine (avoid the very ends)
    const spineIdx = randomIntWithRng(rng, 1, spineTiles.length - 2);
    const branchStart = spineTiles[spineIdx];

    const branchDir = pickBranchDirection(spineTiles, spineIdx, width, height, rng, buffer);
    if (!branchDir) continue;

    // Branch length: 20-50% of the smaller dimension
    const branchLen = randomIntWithRng(
      rng,
      Math.max(3, Math.floor(minDim * 0.2)),
      Math.floor(minDim * 0.5),
    );

    const branchEnd: Point = {
      x: clamp(branchStart.x + branchDir.dx * branchLen, buffer, width - 1 - buffer),
      y: clamp(branchStart.y + branchDir.dy * branchLen, buffer, height - 1 - buffer),
    };

    const junctionIdx = addNode(nodes, branchStart.x, branchStart.y, 'junction');
    const branchEndIdx = addNode(nodes, branchEnd.x, branchEnd.y, 'endpoint');
    edges.push({ from: junctionIdx, to: branchEndIdx });

    const branchTiles = rasterizeLPath(
      branchStart,
      branchEnd,
      width,
      height,
      curvature,
      rng,
      buffer,
    );
    paintTiles(mask, branchTiles);
  }

  // --- Width expansion ---
  if (tunnelWidth > 1) {
    expandTunnelWidth(mask, width, height, tunnelWidth);
  }

  // --- Connectivity validation ---
  ensureConnectivity(mask, width, height);

  return { graph: { nodes, edges }, mask };
}

// ============================================================================
// Interior Point Selection
// ============================================================================

/** Pick a random interior point (not on grid edge), optionally far from an existing point. */
function pickInteriorPoint(
  width: number,
  height: number,
  rng: () => number,
  awayFrom: Point | undefined,
  edgeBuffer: number,
): Point {
  let best: Point = { x: edgeBuffer, y: edgeBuffer };
  let bestDist = -1;

  const attempts = awayFrom ? 10 : 1;
  for (let i = 0; i < attempts; i++) {
    const p: Point = {
      x: randomIntWithRng(rng, edgeBuffer, width - 1 - edgeBuffer),
      y: randomIntWithRng(rng, edgeBuffer, height - 1 - edgeBuffer),
    };

    if (!awayFrom) return p;

    const dist = Math.abs(p.x - awayFrom.x) + Math.abs(p.y - awayFrom.y);
    if (dist > bestDist) {
      bestDist = dist;
      best = p;
    }
  }

  return best;
}

// ============================================================================
// L-Path Rasterization
// ============================================================================

/**
 * Rasterize a path from start to end using L-shaped cardinal movement.
 * Goes horizontal first, then vertical (or vice versa, coin flip).
 * Curvature applies small perpendicular noise offsets during traversal.
 */
function rasterizeLPath(
  start: Point,
  end: Point,
  gridWidth: number,
  gridHeight: number,
  curvature: number,
  rng: () => number,
  edgeBuffer: number,
): Point[] {
  const tiles: Point[] = [];
  const horizontalFirst = rng() < 0.5;

  let x = start.x;
  let y = start.y;

  if (horizontalFirst) {
    walkCardinal(x, y, end.x, y, true, curvature, gridWidth, gridHeight, rng, tiles, edgeBuffer);
    if (tiles.length > 0) {
      const last = tiles[tiles.length - 1];
      x = last.x;
      y = last.y;
    }
    walkCardinal(x, y, x, end.y, false, curvature, gridWidth, gridHeight, rng, tiles, edgeBuffer);
  } else {
    walkCardinal(x, y, x, end.y, false, curvature, gridWidth, gridHeight, rng, tiles, edgeBuffer);
    if (tiles.length > 0) {
      const last = tiles[tiles.length - 1];
      x = last.x;
      y = last.y;
    }
    walkCardinal(x, y, end.x, y, true, curvature, gridWidth, gridHeight, rng, tiles, edgeBuffer);
  }

  return tiles;
}

/**
 * Walk in a cardinal direction from (x,y) toward target, applying perpendicular
 * noise offset for curvature.
 */
function walkCardinal(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  isHorizontal: boolean,
  curvature: number,
  gridWidth: number,
  gridHeight: number,
  rng: () => number,
  out: Point[],
  edgeBuffer: number,
): void {
  let x = startX;
  let y = startY;

  if (isHorizontal) {
    const dx = endX > x ? 1 : endX < x ? -1 : 0;
    if (dx === 0) {
      addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
      return;
    }
    while (x !== endX) {
      addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
      if (curvature > 0 && rng() < curvature * 0.3) {
        const dy = rng() < 0.5 ? -1 : 1;
        const ny = clamp(y + dy, edgeBuffer, gridHeight - 1 - edgeBuffer);
        if (ny !== y) {
          y = ny;
          addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
        }
      }
      x += dx;
    }
    addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
  } else {
    const dy = endY > y ? 1 : endY < y ? -1 : 0;
    if (dy === 0) {
      addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
      return;
    }
    while (y !== endY) {
      addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
      if (curvature > 0 && rng() < curvature * 0.3) {
        const dxOff = rng() < 0.5 ? -1 : 1;
        const nx = clamp(x + dxOff, edgeBuffer, gridWidth - 1 - edgeBuffer);
        if (nx !== x) {
          x = nx;
          addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
        }
      }
      y += dy;
    }
    addPoint(out, x, y, gridWidth, gridHeight, edgeBuffer);
  }
}

// ============================================================================
// Branch Direction
// ============================================================================

/** Determine a perpendicular branch direction from the spine at a given index. */
function pickBranchDirection(
  spineTiles: Point[],
  idx: number,
  width: number,
  height: number,
  rng: () => number,
  edgeBuffer: number,
): { dx: number; dy: number } | null {
  const prev = spineTiles[Math.max(0, idx - 1)];
  const next = spineTiles[Math.min(spineTiles.length - 1, idx + 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;

  const candidates: Array<{ dx: number; dy: number }> = [];
  if (dx !== 0) {
    candidates.push({ dx: 0, dy: 1 }, { dx: 0, dy: -1 });
  }
  if (dy !== 0) {
    candidates.push({ dx: 1, dy: 0 }, { dx: -1, dy: 0 });
  }
  if (candidates.length === 0) {
    candidates.push({ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 });
  }

  const current = spineTiles[idx];
  const valid = candidates.filter((d) => {
    const nx = current.x + d.dx * 3;
    const ny = current.y + d.dy * 3;
    return (
      nx >= edgeBuffer && nx < width - edgeBuffer && ny >= edgeBuffer && ny < height - edgeBuffer
    );
  });

  if (valid.length === 0) return null;
  return valid[Math.floor(rng() * valid.length)];
}

// ============================================================================
// Width Expansion
// ============================================================================

/** Expand tunnel tiles to the target width by marking adjacent tiles. */
function expandTunnelWidth(
  mask: boolean[][],
  width: number,
  height: number,
  tunnelWidth: number,
): void {
  const original = mask.map((row) => [...row]);
  const expand = Math.floor(tunnelWidth / 2); // 1 for width 2, 1 for width 3

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!original[y][x]) continue;
      for (let dy = -expand; dy <= expand; dy++) {
        for (let dx = -expand; dx <= expand; dx++) {
          if (tunnelWidth === 2 && (dx < 0 || dy < 0)) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            mask[ny][nx] = true;
          }
        }
      }
    }
  }
}

// ============================================================================
// Connectivity Validation
// ============================================================================

/** Ensure all tunnel tiles are connected. If not, connect components with shortest paths. */
function ensureConnectivity(mask: boolean[][], width: number, height: number): void {
  const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));

  let startX = -1;
  let startY = -1;
  for (let y = 0; y < height && startX === -1; y++) {
    for (let x = 0; x < width && startX === -1; x++) {
      if (mask[y][x]) {
        startX = x;
        startY = y;
      }
    }
  }
  if (startX === -1) return;

  floodFill(mask, visited, startX, startY, width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y][x] && !visited[y][x]) {
        connectToNearest(mask, visited, x, y, width, height);
        floodFill(mask, visited, x, y, width, height);
      }
    }
  }
}

function floodFill(
  mask: boolean[][],
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number,
): void {
  const queue: Array<[number, number]> = [[startX, startY]];
  visited[startY][startX] = true;

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny][nx] && !visited[ny][nx]) {
        visited[ny][nx] = true;
        queue.push([nx, ny]);
      }
    }
  }
}

function connectToNearest(
  mask: boolean[][],
  visited: boolean[][],
  fromX: number,
  fromY: number,
  width: number,
  height: number,
): void {
  let bestDist = Infinity;
  let bestX = fromX;
  let bestY = fromY;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x]) {
        const dist = Math.abs(x - fromX) + Math.abs(y - fromY);
        if (dist < bestDist) {
          bestDist = dist;
          bestX = x;
          bestY = y;
        }
      }
    }
  }

  let x = fromX;
  let y = fromY;
  while (x !== bestX) {
    mask[y][x] = true;
    visited[y][x] = true;
    x += x < bestX ? 1 : -1;
  }
  while (y !== bestY) {
    mask[y][x] = true;
    visited[y][x] = true;
    y += y < bestY ? 1 : -1;
  }
  mask[y][x] = true;
  visited[y][x] = true;
}

// ============================================================================
// Helpers
// ============================================================================

function addNode(nodes: CaveNode[], x: number, y: number, type: CaveNode['type']): number {
  nodes.push({ x, y, type });
  return nodes.length - 1;
}

function addPoint(
  out: Point[],
  x: number,
  y: number,
  gridWidth: number,
  gridHeight: number,
  edgeBuffer: number,
): void {
  const cx = clamp(x, edgeBuffer, gridWidth - 1 - edgeBuffer);
  const cy = clamp(y, edgeBuffer, gridHeight - 1 - edgeBuffer);
  if (out.length > 0) {
    const last = out[out.length - 1];
    if (last.x === cx && last.y === cy) return;
  }
  out.push({ x: cx, y: cy });
}

function paintTiles(mask: boolean[][], tiles: Point[]): void {
  for (const { x, y } of tiles) {
    mask[y][x] = true;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
