/**
 * Autotile Configuration Types
 *
 * Defines the configuration for pluggable autotile algorithms.
 * Each tileset can specify which autotile preset/convention it uses.
 *
 * Supported formats:
 * - blob-47: 47-tile 8-neighbor bitmask system with corner masking
 * - wang-16: 16-tile Wang 2-corner system (used by LPC terrains)
 */

/**
 * Bitmask bit assignments for each neighbor direction (used by blob-47).
 * Different conventions assign different bit values.
 *
 * Standard/Canonical (cr31.co.uk, this project):
 *   NW=128  N=1   NE=2
 *   W=64    [X]   E=4
 *   SW=32   S=16  SE=8
 *
 * GameMaker/BorisTheBrave:
 *   NW=1   N=2   NE=4
 *   W=8    [X]   E=16
 *   SW=32  S=64  SE=128
 */
export interface BitmaskConvention {
  N: number;
  NE: number;
  E: number;
  SE: number;
  S: number;
  SW: number;
  W: number;
  NW: number;
}

/**
 * Maps masked bitmask values to tile positions (0-46) in the tileset.
 * The key is the bitmask value after corner masking.
 * The value is the tile index in the 7x7 tileset grid.
 */
export type PositionMapping = Record<number, number>;

/**
 * Wang 2-corner tile corner bit assignments.
 * For tile at (x,y), corners are determined by surrounding cells:
 *   NW=cell(x,y), NE=cell(x+1,y), SW=cell(x,y+1), SE=cell(x+1,y+1)
 *
 * Standard convention (used by LPC):
 *   NW=8  NE=1
 *   SW=4  SE=2
 *
 * Index = NE(1) + SE(2) + SW(4) + NW(8) → gives 0-15
 */
export interface Wang16Convention {
  NE: number;
  SE: number;
  SW: number;
  NW: number;
}

/** Autotile format types */
export type AutotileFormat = 'blob-47' | 'wang-16' | 'wang-2corner' | 'autotile-47';

/**
 * Configuration for blob-47 format (47-tile 8-neighbor system).
 */
export interface Blob47Config {
  format: 'blob-47';
  name: string;
  bitmaskConvention: BitmaskConvention;
  bitmaskValues: readonly number[];
  positionMapping: PositionMapping;
  /** Number of alt center tile variants available (at positions 47..46+N). Default: 3 for canonical. */
  altCenterCount: number;
}

/**
 * Configuration for wang-16 format (16-tile 4-corner system).
 */
export interface Wang16Config {
  format: 'wang-16';
  name: string;
  cornerConvention: Wang16Convention;
  /** Number of tiles in the tileset (always 16 for wang-16) */
  tileCount: 16;
  /** Grid dimensions for the tileset layout */
  gridSize: { cols: number; rows: number };
}

/**
 * Configuration for wang-2corner format (standard 16-tile 4-corner system).
 * Uses the standard corner weights: NE=1, SE=2, SW=4, NW=8.
 */
export interface Wang2CornerConfig {
  format: 'wang-2corner';
  name: string;
  /** Number of tiles (always 16) */
  tileCount: 16;
  /** Tileset grid dimensions (typically 4x4) */
  gridSize: { cols: number; rows: number };
  /** Tile size in pixels */
  tileSize: number;
}

/**
 * Configuration for autotile-47 format.
 * Fresh implementation from Game-Development-Resources/Autotile-47.
 * Uses GameMaker bitmask convention with built-in hash table.
 */
export interface Autotile47Config {
  format: 'autotile-47';
  name: string;
  /** Number of tiles (47 unique + 1 for 48 total in 8x6 grid) */
  tileCount: number;
  /** Tileset grid dimensions (8 columns x 6 rows) */
  gridSize: { cols: number; rows: number };
  /** Tile size in pixels */
  tileSize: number;
}

/**
 * Union type for all autotile configurations.
 */
export type AutotileConfig = Blob47Config | Wang16Config | Wang2CornerConfig | Autotile47Config;

/** Built-in preset names */
export type AutotilePreset =
  | 'canonical'
  | 'gamemaker'
  | 'wang16-lpc'
  | 'wang2corner-clean'
  | 'autotile47-template'
  | 'autotile47-lpc-grass';
