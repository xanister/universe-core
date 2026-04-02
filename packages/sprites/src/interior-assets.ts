/**
 * LPC Interior Asset Utilities
 *
 * Functions for working with LPC interior tilesets and object sprites.
 * Used for rendering place layouts (floors, walls, furniture, etc.).
 */

import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { join } from 'path';

export interface TileDefinition {
  col: number;
  row: number;
}

export interface TilesetConfig {
  path: string;
  tileSize: number;
  columns: number;
  rows: number;
  description: string;
  tiles: Record<string, TileDefinition | undefined>;
}

export interface SpritesheetConfig {
  path: string;
  tileSize: number;
  description: string;
}

export interface SpritesheetObjectConfig {
  spritesheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
  animated?: boolean;
  frames?: number;
  frameRate?: number;
  variants?: Record<string, { spritesheet: string }>;
  states?: Record<string, { x: number; y: number }>;
}

export interface InteriorManifest {
  version: string;
  basePath: string;
  description: string;
  tilesets: Record<string, TilesetConfig | undefined>;
  spritesheets: Record<string, SpritesheetConfig | undefined>;
  objects: Record<string, SpritesheetObjectConfig>;
  floorTileMapping: Record<string, string>;
  wallTileMapping: Record<string, string>;
}

let interiorManifest: InteriorManifest | null = null;
let interiorBasePath: string | null = null;
let interiorManifestInjected = false;

/**
 * Load the interior asset manifest from the file system.
 * Call this once at app startup.
 *
 * @param basePath - Absolute path to the lpc-interior directory (containing manifest.json)
 */
export function loadInteriorManifest(basePath: string): InteriorManifest {
  if (
    interiorManifest &&
    interiorBasePath === basePath &&
    (interiorManifestInjected || process.env.NODE_ENV === 'production')
  ) {
    return interiorManifest;
  }

  const manifestPath = join(basePath, 'manifest.json');
  interiorManifest = readJsonFileSync<InteriorManifest>(manifestPath);
  interiorBasePath = basePath;
  interiorManifestInjected = false;

  return interiorManifest;
}

/**
 * Get the current interior manifest (must call loadInteriorManifest first).
 */
export function getInteriorManifest(): InteriorManifest {
  if (!interiorManifest) {
    throw new Error('Interior manifest not loaded. Call loadInteriorManifest() first.');
  }
  return interiorManifest;
}

/**
 * Set a custom manifest (for testing).
 */
export function setInteriorManifest(manifest: InteriorManifest): void {
  interiorManifest = manifest;
  interiorManifestInjected = true;
}

/**
 * Get the floor tileset configuration.
 */
export function getFloorTileset(): TilesetConfig | undefined {
  const manifest = getInteriorManifest();
  return manifest.tilesets.floors;
}

/**
 * Get the full path to the floor tileset image.
 */
export function getFloorTilesetPath(): string {
  if (!interiorBasePath) {
    throw new Error('Interior manifest not loaded. Call loadInteriorManifest() first.');
  }
  const tileset = getFloorTileset();
  if (!tileset) {
    throw new Error('Floor tileset not found in manifest');
  }
  return join(interiorBasePath, tileset.path);
}

/**
 * Get tile coordinates for a specific tile by name.
 */
export function getTileCoordinates(
  tilesetKey: string,
  tileName: string,
): { x: number; y: number; size: number } | undefined {
  const manifest = getInteriorManifest();
  const tileset = manifest.tilesets[tilesetKey];
  if (!tileset) return undefined;

  const tile = tileset.tiles[tileName];
  if (!tile) return undefined;

  return {
    x: tile.col * tileset.tileSize,
    y: tile.row * tileset.tileSize,
    size: tileset.tileSize,
  };
}

/**
 * Get the tile name for a floor tile index.
 */
export function getFloorTileName(tileIndex: number): string | undefined {
  const manifest = getInteriorManifest();
  return manifest.floorTileMapping[tileIndex.toString()];
}

/**
 * Get the tile name for a wall tile index.
 */
export function getWallTileName(tileIndex: number): string | undefined {
  const manifest = getInteriorManifest();
  return manifest.wallTileMapping[tileIndex.toString()];
}

/**
 * Get the sprite configuration for an object type.
 */
export function getObjectSpriteConfig(objectTypeId: string): SpritesheetObjectConfig | undefined {
  const manifest = getInteriorManifest();
  return manifest.objects[objectTypeId];
}

/**
 * Get the full path to a spritesheet image.
 */
export function getSpritesheetPath(spritesheetKey: string): string {
  if (!interiorBasePath) {
    throw new Error('Interior manifest not loaded. Call loadInteriorManifest() first.');
  }
  const manifest = getInteriorManifest();
  const spritesheet = manifest.spritesheets[spritesheetKey];
  if (!spritesheet) {
    throw new Error(`Spritesheet not found: ${spritesheetKey}`);
  }
  return join(interiorBasePath, spritesheet.path);
}

/**
 * Get all available spritesheet keys.
 */
export function getSpritesheetKeys(): string[] {
  const manifest = getInteriorManifest();
  return Object.keys(manifest.spritesheets);
}

/**
 * Get the sprite frame for an object, optionally with a specific variant or state.
 */
export function getObjectSpriteFrame(
  objectTypeId: string,
  options?: { variant?: string; state?: string },
): { spritesheetPath: string; x: number; y: number; width: number; height: number } | undefined {
  const config = getObjectSpriteConfig(objectTypeId);
  if (!config) return undefined;

  let spritesheetKey = config.spritesheet;
  let x = config.x;
  let y = config.y;

  if (options?.variant && config.variants?.[options.variant]) {
    spritesheetKey = config.variants[options.variant].spritesheet;
  }

  if (options?.state && config.states?.[options.state]) {
    x = config.states[options.state].x;
    y = config.states[options.state].y;
  }

  return {
    spritesheetPath: getSpritesheetPath(spritesheetKey),
    x,
    y,
    width: config.width,
    height: config.height,
  };
}

/**
 * Check if an object type has sprites available.
 */
export function hasObjectSprite(objectTypeId: string): boolean {
  const manifest = getInteriorManifest();
  return objectTypeId in manifest.objects;
}

/**
 * Get all object type IDs that have sprites defined.
 */
export function getObjectTypesWithSprites(): string[] {
  const manifest = getInteriorManifest();
  return Object.keys(manifest.objects);
}

/**
 * Get the base URL path for interior assets.
 * Assumes assets are served from /sprites/lpc-interior/
 */
export function getInteriorAssetsBaseUrl(): string {
  const manifest = getInteriorManifest();
  return manifest.basePath;
}

/**
 * Get the URL for a spritesheet (for browser loading).
 */
export function getSpritesheetUrl(spritesheetKey: string): string {
  const manifest = getInteriorManifest();
  const spritesheet = manifest.spritesheets[spritesheetKey];
  if (!spritesheet) {
    throw new Error(`Spritesheet not found: ${spritesheetKey}`);
  }
  return `${manifest.basePath}/${spritesheet.path}`;
}

/**
 * Get the URL for the floor tileset (for browser loading).
 */
export function getFloorTilesetUrl(): string {
  const manifest = getInteriorManifest();
  const tileset = manifest.tilesets.floors;
  if (!tileset) {
    throw new Error('Floor tileset not found in manifest');
  }
  return `${manifest.basePath}/${tileset.path}`;
}
