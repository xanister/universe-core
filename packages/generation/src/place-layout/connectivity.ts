/**
 * Floor Connectivity Validation
 *
 * BFS flood-fill to verify all walkable floor tiles form a single connected
 * component. Used after slot placement to detect rooms where objects partition
 * the floor into unreachable regions.
 */

export interface ConnectivityResult {
  /** True when all walkable tiles are reachable from each other. */
  connected: boolean;
  /** Number of disconnected walkable regions. 0 = no walkable tiles, 1 = fully connected. */
  componentCount: number;
  /** Size (tile count) of the largest connected region. */
  largestComponentSize: number;
  /** Total number of walkable tiles across all components. */
  totalWalkable: number;
}

/**
 * Validate that all walkable floor tiles form a single connected component.
 *
 * A tile is "walkable" if it is not blocked (`blockedMask[y][x] === false`)
 * and not occupied (`occupiedTiles` does not contain `"x,y"`).
 *
 * Uses 4-directional BFS (cardinal neighbors only — no diagonals).
 */
export function validateFloorConnectivity(
  blockedMask: boolean[][],
  occupiedTiles: Set<string>,
  width: number,
  height: number,
): ConnectivityResult {
  const visited: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false),
  );

  let componentCount = 0;
  let largestComponentSize = 0;
  let totalWalkable = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x]) continue;
      if (blockedMask[y]?.[x]) continue;
      if (occupiedTiles.has(`${x},${y}`)) continue;

      // BFS from this unvisited walkable tile
      const queue: number[] = [x, y]; // flat pairs: [x0, y0, x1, y1, ...]
      visited[y][x] = true;
      let size = 0;
      let head = 0;

      while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        size++;

        // Cardinal neighbors
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (visited[ny][nx]) continue;
          if (blockedMask[ny]?.[nx]) continue;
          if (occupiedTiles.has(`${nx},${ny}`)) continue;
          visited[ny][nx] = true;
          queue.push(nx, ny);
        }
      }

      componentCount++;
      totalWalkable += size;
      if (size > largestComponentSize) largestComponentSize = size;
    }
  }

  return {
    connected: componentCount <= 1,
    componentCount,
    largestComponentSize,
    totalWalkable,
  };
}

const DIRS: ReadonlyArray<[number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];
