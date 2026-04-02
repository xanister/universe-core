/**
 * Movement System Types
 *
 * Defines movement profiles and terrain cost resolution.
 * Profiles map terrain tags to passability + speed multipliers.
 * Resolution is a pure function shared by client and server.
 */

import { TERRAIN_TAGS, type TerrainTag } from './terrain-layers.js';

function isTerrainTag(tag: string): tag is TerrainTag {
  return (TERRAIN_TAGS as readonly string[]).includes(tag);
}

/**
 * A movement profile defines how a mover interacts with terrain.
 * Each terrain tag maps to a speed multiplier (null = impassable).
 */
export interface MovementProfile {
  /** Profile identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Terrain tag -> speed multiplier. null = impassable. Unlisted tags use defaultCost. */
  costs: Partial<Record<TerrainTag, number | null>>;
  /** Cost for terrain tags not listed in costs. null = impassable by default. */
  defaultCost: number | null;
}

/**
 * A single terrain cost override from gear, buffs, or abilities.
 * Applied on top of the base movement profile during resolution.
 */
export interface MovementOverride {
  /** Which terrain this override affects */
  terrain: TerrainTag;
  /** Speed multiplier (overrides the profile's cost for this terrain) */
  cost: number;
  /** What granted this override (e.g., "water_walking_boots") */
  source: string;
}

/** Walking movement profile — used for characters on foot. */
export const WALKING_PROFILE: MovementProfile = {
  id: 'walking',
  name: 'Walking',
  costs: {
    land: 1.0,
    forest: 0.6,
    dense_forest: null,
    water: null,
    wall: null,
    lava: null,
    space: null,
    nebula: null,
    void: null,
    road: 0.4,
  },
  defaultCost: 1.0,
};

/** Sailing movement profile — used for water vessels (ships, boats). Water only; land impassable. */
export const SAILING_PROFILE: MovementProfile = {
  id: 'sailing',
  name: 'Sailing',
  costs: {
    land: null,
    forest: null,
    dense_forest: null,
    water: 1.0,
    wall: null,
    lava: null,
    space: null,
    nebula: null,
    void: null,
    road: null,
  },
  defaultCost: null,
};

/**
 * Resolve the effective terrain cost for a mover on a given terrain tag.
 *
 * @param terrainTag - The terrain tag at the tile (from PlaceLayout.terrainGrid)
 * @param profile - The mover's base movement profile
 * @param overrides - Optional character-level overrides (gear, buffs)
 * @returns Speed multiplier (e.g., 1.0 = normal, 0.6 = slow), or null if impassable
 */
export function resolveTerrainCost(
  terrainTag: string,
  profile: MovementProfile,
  overrides?: MovementOverride[],
): number | null {
  // Character overrides take precedence
  if (overrides) {
    const override = overrides.find((o) => o.terrain === terrainTag);
    if (override) return override.cost;
  }

  // Check profile costs
  if (isTerrainTag(terrainTag)) {
    return profile.costs[terrainTag] ?? null;
  }

  // Fall back to default cost
  return profile.defaultCost;
}

/**
 * Find the nearest passable tile position using BFS.
 *
 * Converts the pixel position to tile coordinates, checks if the tile is passable
 * (via WALKING_PROFILE), and if not, searches outward (8-directional BFS) for the
 * nearest passable tile. Returns pixel coordinates at the center of the found tile.
 *
 * When `occupiedTiles` is provided, tiles in the set are treated as blocked even if
 * the terrain is passable. This prevents characters from being placed on tiles
 * already occupied by other characters (BUG-213).
 *
 * Pure function — no I/O, no side effects.
 *
 * @returns Adjusted pixel position (center of nearest passable tile), or original position if already passable.
 */
export function findNearestPassablePosition(
  x: number,
  y: number,
  terrainGrid: string[][],
  tileSize: number,
  gridWidth: number,
  gridHeight: number,
  occupiedTiles?: Set<string>,
): { x: number; y: number } {
  const startTileX = Math.floor(x / tileSize);
  const startTileY = Math.floor(y / tileSize);

  // Out-of-bounds check — treat as passable (no data to reject)
  if (startTileX < 0 || startTileX >= gridWidth || startTileY < 0 || startTileY >= gridHeight) {
    return { x, y };
  }

  const isAvailable = (tileX: number, tileY: number): boolean => {
    const tag = terrainGrid[tileY]?.[tileX];
    if (!tag || resolveTerrainCost(tag, WALKING_PROFILE) === null) return false;
    if (occupiedTiles?.has(`${tileX},${tileY}`)) return false;
    return true;
  };

  if (isAvailable(startTileX, startTileY)) {
    return { x, y };
  }

  // BFS outward (8-directional) to find nearest available tile
  const queue: Array<[number, number]> = [[startTileX, startTileY]];
  const visited = new Set<string>();
  visited.add(`${startTileX},${startTileY}`);

  const directions = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  while (queue.length > 0) {
    const [tx, ty] = queue.shift()!;

    for (const [dx, dy] of directions) {
      const nx = tx + dx;
      const ny = ty + dy;
      const key = `${nx},${ny}`;

      if (visited.has(key)) continue;
      if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;

      visited.add(key);

      if (isAvailable(nx, ny)) {
        return {
          x: nx * tileSize + tileSize / 2,
          y: ny * tileSize + tileSize / 2,
        };
      }

      queue.push([nx, ny]);
    }
  }

  // No available tile found (degenerate case) — return original position
  return { x, y };
}
