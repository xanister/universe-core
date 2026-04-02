/**
 * Position utilities for entity placement and distance calculation.
 *
 * COORDINATE CONVENTION:
 * All position coordinates (x, y, innerWidth, innerHeight) are stored in PIXELS,
 * regardless of the place's scale label. Tilemaps use 32px tiles.
 *
 * To convert pixel distance to real-world meters, use pixelsToMeters().
 * This bridges the pixel coordinate system to meaningful distance calculations.
 */

import type { Place } from '@dmnpc/types/entity';
import type { Position } from '@dmnpc/types';

/** Size dimensions for position calculations */
type Size = { width: number; height: number };

/** All tilemaps use 32px tiles. */
export const TILE_SIZE_PX = 32;

/**
 * Real-world meters per tile. Convention: 1 tile ≈ 1 meter.
 * A 100-tile room ≈ 100m. A character sprite (1 tile wide) ≈ 1m.
 */
export const METERS_PER_TILE = 1;

/** Default "nearby" threshold in meters (~0.5 miles). Preserves existing behavior. */
export const DEFAULT_NEARBY_METERS = 805;

/**
 * Convert a pixel distance to meters.
 * All positions are stored in pixels regardless of scale label.
 */
export function pixelsToMeters(pixelDistance: number): number {
  return (pixelDistance / TILE_SIZE_PX) * METERS_PER_TILE;
}

/**
 * Euclidean distance in meters between two positions sharing a parent.
 * Returns null if positions have different parents or if coordinates are missing/invalid.
 */
export function calculateDistanceMeters(posA: Position, posB: Position): number | null {
  if (posA.parent !== posB.parent) return null;

  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const pixelDistance = Math.sqrt(dx * dx + dy * dy);

  // Guard against NaN from null/undefined coordinates in data
  if (!Number.isFinite(pixelDistance)) return null;

  return pixelsToMeters(pixelDistance);
}

/**
 * Check if two positions are within a given range (in meters).
 * Returns true if distance cannot be calculated (null coordinates, same parent)
 * to preserve "assume nearby" behavior for entities with missing position data.
 * Returns false if positions have different parents.
 */
export function isWithinRange(posA: Position, posB: Position, rangeMeters: number): boolean {
  if (posA.parent !== posB.parent) return false;

  const distance = calculateDistanceMeters(posA, posB);
  // If distance can't be computed (null coords), assume within range
  if (distance === null) return true;
  return distance <= rangeMeters;
}

/**
 * Normalize world coordinates to map coordinates (0-1 range).
 * Used for displaying any entity on a map - same formula for exits and characters.
 *
 * @param worldX - X coordinate in parent's scale units
 * @param worldY - Y coordinate in parent's scale units
 * @param placeSize - The place's size (width/height in scale units)
 * @returns Normalized position clamped to 0-1 range, or null if inputs invalid
 */
export function normalizeToMapPosition(
  worldX: number | null,
  worldY: number | null,
  placeSize: Size | undefined,
): { x: number; y: number } | null {
  if (worldX === null || worldY === null || !placeSize) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(1, worldX / placeSize.width)),
    y: Math.max(0, Math.min(1, worldY / placeSize.height)),
  };
}

/**
 * Convert normalized map coordinates (0-1) to world coordinates.
 * Used when vision detection returns 0-1 positions that need to be stored as world coords.
 *
 * @param normalizedX - Normalized X coordinate (0-1)
 * @param normalizedY - Normalized Y coordinate (0-1)
 * @param placeSize - The place's size (width/height in scale units)
 * @returns World coordinates in the place's scale units
 */
export function mapPositionToWorld(
  normalizedX: number,
  normalizedY: number,
  placeSize: Size,
): { x: number; y: number } {
  return {
    x: normalizedX * placeSize.width,
    y: normalizedY * placeSize.height,
  };
}

/** Standard dimensions for entity types */
export const ENTITY_DIMENSIONS = {
  character: { width: 32, height: 48 },
  object: { width: 32, height: 32 }, // Default for objects including exits
  cosmos: { width: 1000000, height: 1000000 },
} as const;

/** Padding from edges when placing entities randomly */
const EDGE_PADDING = 50;

/**
 * Get a place's inner dimensions (playable map size from layout).
 * Throws if innerWidth/innerHeight are missing or invalid (contract: generate layout first).
 */
export function getPlaceInnerDimensions(place: Place): { width: number; height: number } {
  const w = place.position.innerWidth;
  const h = place.position.innerHeight;
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) {
    throw new Error(
      `Place ${place.id} is missing inner dimensions (innerWidth/innerHeight). Generate layout for this place.`,
    );
  }
  return { width: w, height: h };
}

/**
 * Get random position within a place's bounds (uses inner/playable dimensions).
 */
export function getRandomPositionInPlace(place: Place): { x: number; y: number } {
  const { width, height } = getPlaceInnerDimensions(place);

  const x = EDGE_PADDING + Math.random() * Math.max(0, width - EDGE_PADDING * 2);
  const y = EDGE_PADDING + Math.random() * Math.max(0, height - EDGE_PADDING * 2);

  return {
    x: Math.round(x * 10) / 10, // Round to 1 decimal
    y: Math.round(y * 10) / 10,
  };
}

/**
 * Create a complete Position object for a character in a place.
 */
export function createCharacterPosition(place: Place, coords?: { x: number; y: number }): Position {
  const { x, y } = coords ?? getRandomPositionInPlace(place);
  return {
    x,
    y,
    width: ENTITY_DIMENSIONS.character.width,
    height: ENTITY_DIMENSIONS.character.height,
    parent: place.id,
  };
}

/**
 * Create a complete Position object for a place within a parent place.
 */
export function createPlacePosition(
  parentPlace: Place,
  dimensions: { width: number; height: number },
  coords?: { x: number; y: number },
): Position {
  const { x, y } = coords ?? getRandomPositionInPlace(parentPlace);
  return {
    x,
    y,
    width: dimensions.width,
    height: dimensions.height,
    parent: parentPlace.id,
  };
}
