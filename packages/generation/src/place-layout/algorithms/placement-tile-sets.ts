/**
 * Shared tile-set builders
 *
 * Functions that compute sets of tile coordinates from layer masks.
 * Used by multiple placement algorithm modules.
 */

import { type LayoutVariant } from '@dmnpc/types/world';
import type { GeneratedShape } from './algorithm-types.js';

export type WallSide = 'north' | 'south' | 'east' | 'west';

/**
 * Wall face height in tiles (must match WALL_FACE_HEIGHT in shape-algorithms.ts).
 */
export const IN_WALL_FACE_HEIGHT = 3;

/**
 * Build a set of room tile coordinates from layers that unblock.
 * Includes wall boundary tiles where room and wall masks overlap (Wang
 * 2-corner autotiling places wall tiles ON room edge positions).
 *
 * Used by getWallBoundaryTiles() to detect wall-floor boundaries for in_wall
 * placement — doors and wall decorations must sit on the wall boundary itself.
 */
export function getRoomTileSet(shape: GeneratedShape, variant: LayoutVariant): Set<string> {
  const roomTiles = new Set<string>();
  const bounds = shape.bounds;

  for (const layerConfig of variant.terrainLayers) {
    if (layerConfig.type === 'wall') continue;
    if (layerConfig.blocking !== 'unblocks') continue;

    const mask = shape.layerMasks[layerConfig.id] as boolean[][] | undefined;
    if (!mask) continue;

    for (let ly = 0; ly < bounds.height; ly++) {
      for (let lx = 0; lx < bounds.width; lx++) {
        if (mask[ly]?.[lx]) {
          roomTiles.add(`${bounds.x + lx},${bounds.y + ly}`);
        }
      }
    }
  }

  return roomTiles;
}

/**
 * Resolve the wall layer mask from the shape by finding the wall layer config by type.
 * Returns undefined if the variant has no wall layer.
 */
export function resolveWallMask(
  shape: GeneratedShape,
  variant: LayoutVariant,
): boolean[][] | undefined {
  const wallLayerConfig = variant.terrainLayers.find((l) => l.type === 'wall');
  if (!wallLayerConfig) return undefined;
  return shape.layerMasks[wallLayerConfig.id] as boolean[][] | undefined;
}

/**
 * Resolve the wall_face layer mask from the shape.
 * Returns undefined if the variant has no wall_face layer.
 */
export function resolveWallFaceMask(
  shape: GeneratedShape,
  variant: LayoutVariant,
): boolean[][] | undefined {
  const config = variant.terrainLayers.find((l) => l.type === 'wall_face');
  if (!config) return undefined;
  return shape.layerMasks[config.id] as boolean[][] | undefined;
}

/**
 * Build a set of floor tile coordinates safe for object placement.
 * Starts from getRoomTileSet() then subtracts wall and wall_face overlay tiles.
 *
 * BUG-174: Uses the cleaned tile set (wall-subtracted). Use
 * getRoomTileSet() directly to preserve wall boundary positions.
 */
export function getFloorTileSet(shape: GeneratedShape, variant: LayoutVariant): Set<string> {
  const floorTiles = getRoomTileSet(shape, variant);
  const bounds = shape.bounds;

  // BUG-174: Subtract wall and wall_face overlay tiles. Room boundary tiles
  // have both room mask=true and wall mask=true; they must not count as floor.
  const wallMask = resolveWallMask(shape, variant);
  if (wallMask) {
    for (let ly = 0; ly < bounds.height; ly++) {
      for (let lx = 0; lx < bounds.width; lx++) {
        if (wallMask[ly]?.[lx]) {
          floorTiles.delete(`${bounds.x + lx},${bounds.y + ly}`);
        }
      }
    }
  }

  const wallFaceMask = resolveWallFaceMask(shape, variant);
  if (wallFaceMask) {
    for (let ly = 0; ly < bounds.height; ly++) {
      for (let lx = 0; lx < bounds.width; lx++) {
        if (wallFaceMask[ly]?.[lx]) {
          floorTiles.delete(`${bounds.x + lx},${bounds.y + ly}`);
        }
      }
    }
  }

  return floorTiles;
}

/**
 * Find wall tiles that have at least one floor tile as a N/S/E/W neighbor.
 * These are inner-facing wall boundary positions suitable for doors.
 * Uses floor layer masks to distinguish room interior from void (outside room).
 *
 * Resolves the wall layer by scanning variant.terrainLayers for type === 'wall'
 * and looking up that layer's id in shape.layerMasks. Throws if no wall layer
 * exists (per "no silent fallbacks" rule).
 */
export function getWallBoundaryTiles(
  shape: GeneratedShape,
  variant: LayoutVariant,
): { x: number; y: number; wall: WallSide }[] {
  const bounds = shape.bounds;

  // Find wall layer by type, not hardcoded id
  const wallLayerConfig = variant.terrainLayers.find((l) => l.type === 'wall');
  if (!wallLayerConfig) {
    throw new Error(
      'in_wall placement requires a terrain layer with type: "wall" in the layout variant. ' +
        `Available layers: [${variant.terrainLayers.map((l) => `${l.id} (${l.type})`).join(', ')}]`,
    );
  }

  const wallMask = shape.layerMasks[wallLayerConfig.id] as boolean[][] | undefined;
  if (!wallMask) {
    throw new Error(
      `Wall layer "${wallLayerConfig.id}" declared in variant but has no generated layer mask in shape. ` +
        `Available masks: [${Object.keys(shape.layerMasks).join(', ')}]`,
    );
  }

  // FEAT-270: Use wall_face mask for north wall placement when available.
  // The wall layer is 1-tile thick at the perimeter, but north wall doors
  // should be placed on face tiles (3-tile strips rendered below the edge).
  const wallFaceLayerConfig = variant.terrainLayers.find((l) => l.type === 'wall_face');
  const wallFaceMask = wallFaceLayerConfig
    ? (shape.layerMasks[wallFaceLayerConfig.id] as boolean[][] | undefined)
    : undefined;

  // BUG-174: Use the uncleaned room tile set (includes wall boundary tiles)
  // so in_wall placement positions sit ON the wall boundary, not 1 tile inward.
  // Floor-placement algorithms use getFloorTileSet() (wall-subtracted) instead.
  const roomTileSet = getRoomTileSet(shape, variant);
  const wallBoundary: { x: number; y: number; wall: WallSide }[] = [];

  // Per-side placement: each wall side has a specific row/column for slot
  // placement that aligns with the visual wall boundary.
  //
  // North wall (south-facing, has face tiles): place at the bottom row of
  // the face tiles — the last face row before walkable floor begins.
  //
  // South wall (north-facing): place at the last walkable floor row — the
  // character walks "behind" the south wall, so the slot sits at floor level.
  //
  // East/West walls: place at the grid edge column on walkable rows.

  let firstRoomRow = -1;
  let lastRoomRow = -1;
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      if (roomTileSet.has(`${bounds.x + x},${bounds.y + y}`)) {
        if (firstRoomRow === -1) firstRoomRow = y;
        lastRoomRow = y;
        break;
      }
    }
  }
  if (firstRoomRow === -1) return wallBoundary;

  // North wall: place on the first floor row below the face tiles, mirroring
  // how south-wall doors sit on the last floor row. The face is the visual
  // wall surface; the door sprite anchors at floor level so it doesn't float.
  // Use wall_face mask when available (face tiles live on that layer, not the
  // wall edge layer). Fall back to wall mask for layouts without wall_face.
  const northMask = wallFaceMask ?? wallMask;
  const northFaceBottomRow = firstRoomRow + IN_WALL_FACE_HEIGHT - 1;
  const northPlacementRow = northFaceBottomRow + 1;
  if (northPlacementRow < bounds.height && northMask[northFaceBottomRow]) {
    for (let x = 0; x < bounds.width; x++) {
      if (
        northMask[northFaceBottomRow][x] &&
        northMask[northFaceBottomRow]?.[x - 1] &&
        northMask[northFaceBottomRow]?.[x + 1] &&
        roomTileSet.has(`${bounds.x + x},${bounds.y + northPlacementRow}`)
      ) {
        wallBoundary.push({ x: bounds.x + x, y: bounds.y + northPlacementRow, wall: 'north' });
      }
    }
  }

  // --- Floor-based boundary detection (FEAT-270) ---
  // Derive wall boundaries from room geometry, not the wallMask.
  // The wallMask is a rendering artifact (Wang autotile output) with gaps
  // where the style lacks tiles for certain corner keys and where cells are
  // fully non-room ("0,0,0,0"). Room boundaries are purely geometric.

  const leftRoomCol = new Map<number, number>();
  const rightRoomCol = new Map<number, number>();
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      if (roomTileSet.has(`${bounds.x + x},${bounds.y + y}`)) {
        if (!leftRoomCol.has(y)) leftRoomCol.set(y, x);
        rightRoomCol.set(y, x);
      }
    }
  }

  const bottomRoomRow = new Map<number, number>();
  for (let x = 0; x < bounds.width; x++) {
    for (let y = bounds.height - 1; y >= 0; y--) {
      if (roomTileSet.has(`${bounds.x + x},${bounds.y + y}`)) {
        bottomRoomRow.set(x, y);
        break;
      }
    }
  }

  // South wall: per-column bottommost room tile.
  for (let x = 0; x < bounds.width; x++) {
    const row = bottomRoomRow.get(x);
    if (row === undefined) continue;
    const rowLeft = bottomRoomRow.get(x - 1);
    const rowRight = bottomRoomRow.get(x + 1);
    if (rowLeft !== row || rowRight !== row) continue;
    wallBoundary.push({ x: bounds.x + x, y: bounds.y + row, wall: 'south' });
  }

  // Rows used by north/south walls — east/west skip these to avoid corners.
  // Exclude the face zone plus a 1-row buffer below so side-wall doors
  // don't land right at the face/floor transition.
  const northSouthRows = new Set<number>();
  const northExcludeEnd = Math.min(northPlacementRow + 1, bounds.height - 1);
  for (let r = firstRoomRow; r <= northExcludeEnd; r++) {
    northSouthRows.add(r);
  }
  const southRows = new Set(
    wallBoundary.filter((t) => t.wall === 'south').map((t) => t.y - bounds.y),
  );
  for (const r of southRows) northSouthRows.add(r);

  // West wall: leftmost room tile per row (left edge = west wall).
  // BUG-175: Was mislabeled 'east' — the leftmost room column is adjacent
  // to the west wall, so objects here should face east (into the room).
  // Straight check: leftmost column must be the same at y-1, y, and y+1.
  for (let y = firstRoomRow; y <= lastRoomRow; y++) {
    if (northSouthRows.has(y)) continue;
    const col = leftRoomCol.get(y);
    if (col === undefined) continue;
    const colAbove = leftRoomCol.get(y - 1);
    const colBelow = leftRoomCol.get(y + 1);
    if (colAbove !== col || colBelow !== col) continue;
    wallBoundary.push({ x: bounds.x + col, y: bounds.y + y, wall: 'west' });
  }

  // East wall: rightmost room tile per row (right edge = east wall).
  // BUG-175: Was mislabeled 'west' — the rightmost room column is adjacent
  // to the east wall, so objects here should face west (into the room).
  // Straight check: rightmost column must be the same at y-1, y, and y+1.
  for (let y = firstRoomRow; y <= lastRoomRow; y++) {
    if (northSouthRows.has(y)) continue;
    const col = rightRoomCol.get(y);
    if (col === undefined) continue;
    const colAbove = rightRoomCol.get(y - 1);
    const colBelow = rightRoomCol.get(y + 1);
    if (colAbove !== col || colBelow !== col) continue;
    wallBoundary.push({ x: bounds.x + col, y: bounds.y + y, wall: 'east' });
  }

  return wallBoundary;
}

/**
 * Find floor tiles that have at least one cardinal neighbor on a wall tile.
 * Inverse of getWallBoundaryTiles (which finds wall tiles adjacent to floor).
 * Uses world coordinates matching getFloorTileSet / getWallBoundaryTiles.
 *
 * FEAT-276: Excludes tiles covered by the wall_face mask (furniture placed
 * there appears inside the visual face strip). For north walls, the tile
 * immediately below the face strip bottom is added as an alternative candidate
 * so south-facing furniture still has a valid position in front of the face.
 */
export function getWallAdjacentFloorTiles(
  shape: GeneratedShape,
  variant: LayoutVariant,
): { x: number; y: number }[] {
  const floorTileSet = getFloorTileSet(shape, variant);
  const wallMask = resolveWallMask(shape, variant);
  if (!wallMask) return [];

  const wallFaceMask = resolveWallFaceMask(shape, variant);
  const bounds = shape.bounds;
  const result: { x: number; y: number }[] = [];

  for (const key of floorTileSet) {
    const [wxStr, wyStr] = key.split(',');
    const wx = Number(wxStr);
    const wy = Number(wyStr);
    const lx = wx - bounds.x;
    const ly = wy - bounds.y;

    // BUG-149: Skip tiles on the wall layer itself — corridor_floor (inset=1) includes
    // tiles at the same row as the horizontal wall, which must not be used for placement.
    if (wallMask[ly]?.[lx] === true) continue;
    // Skip tiles inside the wall face — furniture placed here appears inside the wall.
    if (wallFaceMask?.[ly]?.[lx] === true) continue;

    // Standard check: tile is adjacent to a wall tile on any cardinal side.
    const hasWallNeighbor =
      (ly > 0 && wallMask[ly - 1]?.[lx] === true) ||
      (ly < bounds.height - 1 && wallMask[ly + 1]?.[lx] === true) ||
      (lx > 0 && wallMask[ly]?.[lx - 1] === true) ||
      (lx < bounds.width - 1 && wallMask[ly]?.[lx + 1] === true);

    // FEAT-276: tile immediately below the face strip bottom is a valid north-wall
    // candidate — furniture sits in front of the face rather than inside it.
    const isBelowFace = wallFaceMask !== undefined && ly > 0 && wallFaceMask[ly - 1]?.[lx] === true;

    if (hasWallNeighbor || isBelowFace) {
      result.push({ x: wx, y: wy });
    }
  }

  return result;
}
