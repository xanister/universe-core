/**
 * Terrain Layer Types
 *
 * Layer type registry, terrain tags, noise presets, and all terrain layer
 * config interfaces (discriminated union). Extracted from place-templates.ts
 * to isolate the high-churn layer type system from the stable template/slot
 * definitions.
 *
 * **Adding a new layer type** requires 5 coordinated edits in this file:
 * 1. Add value to `LAYER_TYPES` const array
 * 2. Add entry to `LAYER_TYPE_META` record
 * 3. Add a new `XxxLayerConfig` interface extending `TerrainLayerBase`
 * 4. Add case to `createDefaultLayerConfig()` factory
 * 5. Add to `TerrainLayerConfig` discriminated union
 */

import type { AutotilePreset } from './autotile.js';

// ============================================================================
// Terrain Tags
// ============================================================================

/**
 * Terrain tags classify what a terrain layer IS for movement purposes.
 * Movement profiles reference these tags to determine passability + speed.
 */
export const TERRAIN_TAGS = [
  'land', // walkable ground (grass, dirt, wood floor, stone, sci-fi floor)
  'water', // ocean, rivers, lakes
  'wall', // walls, cliffs, impassable barriers
  'forest', // dense vegetation (slow for walking)
  'dense_forest', // impassable tree cover (ground-level forest walls)
  'lava', // volcanic terrain
  'space', // empty space
  'nebula', // space with nebula effects
  'void', // background fill in rooms (void around room shapes)
  'road', // paved roads and paths (fast for walking)
] as const;

export type TerrainTag = (typeof TERRAIN_TAGS)[number];

// ============================================================================
// Layer Type Registry
// ============================================================================

/**
 * Terrain layer types. Each type drives a different generation strategy:
 * - fill: uniform tile across the whole map (ocean, lava)
 * - starfield: uniform tile for space maps (starfield base)
 * - noise_patch: configurable noise-based terrain shape with named presets + autotile
 * - rectangle: rectangular room interior (inset from canvas edges)
 * - l_shape: L-shaped room interior (inset from canvas edges)
 * - t_shape: T-shaped room interior (inset from canvas edges)
 * - wall: wall edge/trim around the room shape (always 1 tile thick).
 *         Automatically detects north-facing tiles and emits a high-depth overlay for overhead passthrough.
 * - animated_overlay: visual overlay with client-side tile animation (waves, shimmer, flicker)
 */
export const LAYER_TYPES = [
  'fill',
  'noise_fill',
  'starfield',
  'noise_patch',
  'coastline',
  'rectangle',
  'l_shape',
  't_shape',
  'wall',
  'wall_face',
  'sprite_backdrop',
  'animated_overlay',
  'road',
  'path',
  'town_center',
  'cave',
] as const;

export type LayerType = (typeof LAYER_TYPES)[number];

/**
 * UI metadata for a layer type. Contains only display/default information.
 * Config shape metadata is implicit in the TypeScript discriminated union —
 * use runtime `'field' in layer` checks to inspect config capabilities.
 */
export interface LayerTypeMeta {
  /** Human-readable label for UI dropdowns. */
  label: string;
  /** Default terrain tag when this layer type is selected. */
  defaultTerrain: TerrainTag;
  /** Default render order when this layer type is selected. */
  defaultRenderOrder: number;
  /** Default blocking behavior when this layer type is selected. */
  defaultBlocking: 'blocks' | 'unblocks' | null;
  /** UI group for organizing the layer type dropdown. */
  group: 'base' | 'room_shape' | 'wall' | 'overlay';
  /**
   * Field names beyond TerrainLayerBase that this layer type uses.
   * Drives UI control visibility and LLM output cleanup.
   */
  extraFields: readonly string[];
  /**
   * Minimum variant room width (in tiles) required for this layer type to produce a valid shape.
   * UI validation warns and blocks save when variant.width.min is below this value.
   */
  minRoomWidth?: number;
  /**
   * Minimum variant room height (in tiles) required for this layer type to produce a valid shape.
   * UI validation warns and blocks save when variant.height.min is below this value.
   */
  minRoomHeight?: number;
}

/**
 * Per-layer-type metadata: UI labels, defaults, and field applicability.
 * Used by the admin editor (control visibility) and LLM template generator (output cleanup).
 */
export const LAYER_TYPE_META: Record<LayerType, LayerTypeMeta> = {
  fill: {
    label: 'Fill (uniform tile)',
    defaultTerrain: 'land',
    defaultRenderOrder: 0,
    defaultBlocking: null,
    group: 'base',
    extraFields: [],
  },
  noise_fill: {
    label: 'Noise Fill (directional fill with organic edge)',
    defaultTerrain: 'water',
    defaultRenderOrder: 0,
    defaultBlocking: null,
    group: 'base',
    extraFields: [
      'fillDirection',
      'fillPercent',
      'noiseScale',
      'noiseAmplitude',
      'autotilePreset',
      'autotileAgainst',
    ],
  },
  starfield: {
    label: 'Starfield (space base)',
    defaultTerrain: 'space',
    defaultRenderOrder: 0,
    defaultBlocking: null,
    group: 'base',
    extraFields: [],
  },
  noise_patch: {
    label: 'Noise Patch (configurable noise shape)',
    defaultTerrain: 'land',
    defaultRenderOrder: 1,
    defaultBlocking: null,
    group: 'base',
    extraFields: ['shapePreset', 'autotilePreset', 'autotileAgainst', 'withinTerrain'],
  },
  coastline: {
    label: 'Coastline (water-land transition)',
    defaultTerrain: 'land',
    defaultRenderOrder: 1,
    defaultBlocking: 'unblocks',
    group: 'base',
    extraFields: ['sourceLayerId', 'beachWidth', 'autotilePreset', 'autotileAgainst'],
  },
  rectangle: {
    label: 'Rectangle (room interior)',
    defaultTerrain: 'land',
    defaultRenderOrder: 1,
    defaultBlocking: 'unblocks',
    group: 'room_shape',
    extraFields: [],
  },
  l_shape: {
    label: 'L-Shape (room interior)',
    defaultTerrain: 'land',
    defaultRenderOrder: 1,
    defaultBlocking: 'unblocks',
    group: 'room_shape',
    extraFields: ['minArmWidth'],
    minRoomWidth: 14,
    minRoomHeight: 14,
  },
  t_shape: {
    label: 'T-Shape (room interior)',
    defaultTerrain: 'land',
    defaultRenderOrder: 1,
    defaultBlocking: 'unblocks',
    group: 'room_shape',
    extraFields: ['minArmWidth'],
    minRoomWidth: 8,
    minRoomHeight: 8,
  },
  wall: {
    label: 'Wall (edge/trim)',
    defaultTerrain: 'wall',
    defaultRenderOrder: 2000,
    defaultBlocking: 'blocks',
    group: 'wall',
    extraFields: ['wallStyle'],
  },
  wall_face: {
    label: 'Wall Face (wall surface)',
    defaultTerrain: 'wall',
    defaultRenderOrder: 1,
    defaultBlocking: null,
    group: 'wall',
    extraFields: ['wallStyle', 'wallLayerId', 'roomLayerId'],
  },
  sprite_backdrop: {
    label: 'Sprite Backdrop (pre-composed image)',
    defaultTerrain: 'void',
    defaultRenderOrder: 0,
    defaultBlocking: null,
    group: 'overlay',
    extraFields: ['anchorX', 'anchorY', 'gridWidth', 'gridHeight', 'unblockedTiles', 'slots'],
  },
  animated_overlay: {
    label: 'Animated Overlay (tile animation)',
    defaultTerrain: 'void',
    defaultRenderOrder: 5,
    defaultBlocking: null,
    group: 'overlay',
    extraFields: ['frames', 'tickMs', 'density'],
  },
  road: {
    label: 'Road (connected road network)',
    defaultTerrain: 'road',
    defaultRenderOrder: 1,
    defaultBlocking: 'unblocks',
    group: 'base',
    extraFields: [
      'roadWidth',
      'branchCount',
      'curvature',
      'autotilePreset',
      'autotileAgainst',
      'avoidLayerIds',
    ],
  },
  path: {
    label: 'Path (organic winding trail)',
    defaultTerrain: 'road',
    defaultRenderOrder: 1,
    defaultBlocking: 'unblocks',
    group: 'base',
    extraFields: ['curvature', 'autotilePreset', 'autotileAgainst', 'avoidLayerIds'],
  },
  town_center: {
    label: 'Town Center (road intersection clearing)',
    defaultTerrain: 'road',
    defaultRenderOrder: 2,
    defaultBlocking: 'unblocks',
    group: 'base',
    extraFields: ['radius', 'autotilePreset', 'autotileAgainst'],
  },
  cave: {
    label: 'Cave (rock-fill with carved tunnels)',
    defaultTerrain: 'void',
    defaultRenderOrder: 1,
    defaultBlocking: 'blocks',
    group: 'base',
    extraFields: ['tunnelWidth', 'branchCount', 'curvature', 'autotilePreset', 'autotileAgainst'],
  },
};

// ============================================================================
// Noise System
// ============================================================================

/** Edge falloff behavior for noise-based terrain generation. */
export type EdgeBehavior = 'falloff' | 'open_one_edge' | 'none';

/** Named noise preset keys. Use 'custom' to supply all parameters manually. */
export const NOISE_PRESET_NAMES = [
  'continent',
  'island',
  'clearing',
  'patches',
  'scattered',
  'nebula',
  'sub_nebula',
  'custom',
] as const;

export type NoisePreset = (typeof NOISE_PRESET_NAMES)[number];

/** Resolved noise parameters for terrain generation. */
export interface NoiseParams {
  noiseScale: number;
  octaves: number;
  persistence: number;
  threshold: number;
  edgeBehavior: EdgeBehavior;
}

/**
 * Named preset registry. Each preset pre-fills noise parameters for common terrain patterns.
 * 'custom' maps to null — the author must supply all parameters directly.
 */
export const NOISE_PRESETS: Record<NoisePreset, NoiseParams | null> = {
  continent: {
    noiseScale: 0.02,
    octaves: 4,
    persistence: 0.5,
    threshold: 0.1,
    edgeBehavior: 'falloff',
  },
  island: {
    noiseScale: 0.02,
    octaves: 4,
    persistence: 0.5,
    threshold: 0.35,
    edgeBehavior: 'falloff',
  },
  clearing: {
    noiseScale: 0.04,
    octaves: 4,
    persistence: 0.5,
    threshold: 0.0,
    edgeBehavior: 'open_one_edge',
  },
  patches: {
    noiseScale: 0.08,
    octaves: 3,
    persistence: 0.45,
    threshold: 0.25,
    edgeBehavior: 'none',
  },
  scattered: {
    noiseScale: 0.08,
    octaves: 3,
    persistence: 0.4,
    threshold: 0.3,
    edgeBehavior: 'none',
  },
  nebula: {
    noiseScale: 0.015,
    octaves: 4,
    persistence: 0.5,
    threshold: 0.05,
    edgeBehavior: 'falloff',
  },
  sub_nebula: {
    noiseScale: 0.08,
    octaves: 3,
    persistence: 0.4,
    threshold: 0.3,
    edgeBehavior: 'none',
  },
  custom: null,
};

/** Cardinal direction from which the noise fill originates. */
export const NOISE_FILL_DIRECTIONS = ['north', 'south', 'east', 'west'] as const;
export type NoiseFillDirection = (typeof NOISE_FILL_DIRECTIONS)[number];

// ============================================================================
// Layer Config Interfaces
// ============================================================================

/** Shared fields for all terrain layer types. */
interface TerrainLayerBase {
  id: string;
  tilesetId: string;
  /**
   * Rendering depth for this tilemap layer. Lower values render behind higher ones.
   * Used directly as the Phaser depth value at render time.
   *
   * Reserved depth bands (avoid these for tilemap renderOrder):
   * - 10: floor-layer objects
   * - 5000: overhead-layer objects
   * - 5001: wall-layer objects / synthetic wall face overlays
   * - 8999+: lighting, UI, weather
   *
   * Typical tilemap values: 0-3 for terrain, 2000 for wall ceilings.
   * Synthetic wall face overlays are auto-generated at renderOrder + 3001.
   */
  renderOrder: number;
  /** How this layer affects the blocked mask (generation-time object placement). */
  blocking: 'blocks' | 'unblocks' | null;
  /**
   * Semantic terrain classification for runtime movement.
   * Determines passability and speed via movement profiles.
   */
  terrain: TerrainTag;
  /** Tile indices from the tileset. Non-autotile layers pick randomly per-tile for variation. Empty for autotile layers. */
  fill: number[];
  /**
   * When true, the client renders this layer as a procedural effect (based on type)
   * instead of tilemap tiles. The server still generates terrainGrid data for slot placement.
   */
  procedural: boolean;
  /**
   * When true, child places (e.g. vessels) inherit this layer from the parent layout
   * at serve-time. Typically used for base fill layers and animated overlays so vessels
   * show the ocean/starfield/wave effects beneath their deck.
   */
  inheritable: boolean;
  /**
   * Number of alt center tile variants to use for autotile layers.
   * Undefined = use format default (3 for canonical blob-47). Set to 0 to disable.
   * Only meaningful for layers with an autotilePreset.
   */
  altCenterCount?: number;
}

/** Fill: every tile gets the same tile index. No autotile. */
export interface FillLayerConfig extends TerrainLayerBase {
  type: 'fill';
}

/**
 * Noise Fill: fills a configurable percentage of the map from one direction,
 * using 1D simplex noise to create an organic boundary edge.
 * Primary use case: land-to-ocean transitions and similar biome boundaries.
 */
export interface NoiseFillLayerConfig extends TerrainLayerBase {
  type: 'noise_fill';
  /** Cardinal direction from which the fill originates. */
  fillDirection: NoiseFillDirection;
  /** Fraction of the map to fill (0.0–1.0). 0.3 = 30% of map from the specified edge. */
  fillPercent: number;
  /** Frequency of the boundary wobble. Higher = more jagged. Default ~0.05. */
  noiseScale: number;
  /** Magnitude of boundary wobble as fraction of map dimension (0.0–1.0). Default ~0.15. */
  noiseAmplitude: number;
  /** Autotile preset for boundary edge tiles. */
  autotilePreset: AutotilePreset;
  /** Layer IDs to treat as "same terrain" for autotile neighbor checks. */
  autotileAgainst: string[];
}

/** Starfield: uniform base layer for space maps. Same generation as fill. */
export interface StarfieldLayerConfig extends TerrainLayerBase {
  type: 'starfield';
}

/**
 * Noise Patch: configurable noise-based terrain shape.
 * Replaces the old continent/nebula/forest/clearing layer types with a single generic type.
 * Pick a shapePreset for common patterns or use 'custom' to set all parameters directly.
 */
export interface NoisePatchLayerConfig extends TerrainLayerBase {
  type: 'noise_patch';
  autotilePreset: AutotilePreset;
  /** Layer IDs to treat as "same terrain" for autotile neighbor checks. */
  autotileAgainst: string[];
  /** Only generate within tiles matching this layer ID. Null = no constraint. */
  withinTerrain: string | null;
  /** Named noise preset or 'custom'. */
  shapePreset: NoisePreset;
  /** Override: noise frequency scale. */
  noiseScale?: number;
  /** Override: number of FBM octaves. */
  octaves?: number;
  /** Override: FBM persistence (amplitude decay per octave). */
  persistence?: number;
  /** Override: noise threshold for tile inclusion. */
  threshold?: number;
  /** Override: edge falloff behavior. */
  edgeBehavior?: EdgeBehavior;
}

/**
 * Coastline: paints a beach/shore transition strip at the boundary between a
 * water layer (sourceLayerId) and adjacent land. Uses the terrain grid to find
 * where the source layer is still the active terrain (so fill layers that were
 * partially overwritten by later layers work correctly). Uses blob-47 autotiling
 * for smooth edge visuals. beachWidth controls how many tiles the strip extends
 * from the water boundary into non-water territory.
 */
export interface CoastlineLayerConfig extends TerrainLayerBase {
  type: 'coastline';
  /** ID of the water layer to trace the boundary of. Must be processed first. */
  sourceLayerId: string;
  /** How many tiles wide the beach strip extends from the water boundary (1-3). Default 1. */
  beachWidth: number;
  /** Autotile preset for beach tile selection. */
  autotilePreset: AutotilePreset;
  /**
   * Layer IDs to treat as "same terrain" for autotile neighbor checks.
   * Include the land/ground layer so the inland edge blends seamlessly —
   * autotile edges will only appear on the water-facing side.
   */
  autotileAgainst: string[];
}

/** Rectangle: rectangular room interior, inset from canvas edges for walls. */
export interface RectangleLayerConfig extends TerrainLayerBase {
  type: 'rectangle';
}

/** L-shape: L-shaped room interior, inset from canvas edges for walls. */
export interface LShapeLayerConfig extends TerrainLayerBase {
  type: 'l_shape';
  /** Minimum width (in tiles) for each arm of the L. Generation clamps cuts to enforce this. Default 2. */
  minArmWidth: number;
}

/** T-shape: T-shaped room interior, inset from canvas edges for walls. */
export interface TShapeLayerConfig extends TerrainLayerBase {
  type: 't_shape';
  /** Minimum width/height (in tiles) for each channel (stem and wings). Generation clamps to enforce this. Default 2. */
  minArmWidth: number;
}

/**
 * Wall edge/trim: traces the boundary of the previous layer. Always 1 tile thick.
 * Uses Wang 2-corner autotile from the `lpc-interior-walls` tilesheet (ceiling trims).
 * Each ceiling trim style is a set of corner tiles selected based on neighboring wall/room context.
 */
export interface WallLayerConfig extends TerrainLayerBase {
  type: 'wall';
  /** Wall style ID referencing an entry in wall-styles-full.json. */
  wallStyle: string;
}

/**
 * Wall Face layer: places 3-tile-tall face strips below wall edges that have floor beneath them.
 * Reads two other layers by ID: the wall layer (for edge positions) and the room/floor layer (for floor positions).
 */
export interface WallFaceLayerConfig extends TerrainLayerBase {
  type: 'wall_face';
  /** ID of the wall layer to read edge positions from. */
  wallLayerId: string;
  /** ID of the room/floor layer to read floor positions from. */
  roomLayerId: string;
  /** Wall style ID referencing an entry in wall-styles-full.json (for faceTiles autotile). */
  wallStyle: string;
}

/**
 * A wall style definition mapping a named style to its base tile in the tilesheet.
 * Each style occupies a 3x3 grid of Wang corner tiles at fixed offsets from baseTile:
 *
 *   +0      +1      +2       (outer-TL, top-edge, outer-TR)
 *   +64     +65     +66      (left-edge, CENTER,  right-edge)
 *   +128    +129    +130     (outer-BL, bot-edge, outer-BR)
 *
 * The center tile (baseTile + 65) is the solid wall fill used for multi-row extension.
 */
export interface WallStyleDef {
  /** Unique style identifier, e.g. "brick_red". */
  id: string;
  /** Human-readable display name, e.g. "Red Brick". */
  name: string;
  /** Top-left tile index of the 3x3 grid in the wall tilesheet (64 columns wide). */
  baseTile: number;
  /** Style category for grouping, e.g. "brick", "stone", "wood". */
  category: string;
}

/**
 * Boolean flags for a backdrop slot. All fields required — default is false.
 */
export interface BackdropSlotFlags {
  /**
   * When true, use LLM to select the object for this slot from purpose-matched candidates.
   * When false, use weighted random.
   */
  useLlmSelection: boolean;
}

/**
 * A slot definition on a sprite backdrop layer.
 * Provides hand-placed candidate positions instead of algorithmic placement.
 */
export interface BackdropSlot {
  /** Which purposes this slot serves. */
  purposes: string[];
  /** Hand-placed candidate positions (tile coordinates). Generator picks N from these. */
  candidates: Array<{ x: number; y: number; facing?: 'north' | 'south' | 'east' | 'west' }>;
  /** Minimum number of slots to place. */
  min: number;
  /** Maximum number of slots to place. */
  max: number;
  /** Probability of placing this slot (0-1). Null = always place. */
  chance: number | null;
  /**
   * Tags that exclude candidate entities from this slot (NOR logic).
   * Same semantics as LayoutSlot.forbiddenTags.
   * Null = no exclusion filtering.
   */
  forbiddenTags: string[] | null;
  /**
   * Tags that cascade to child places created from this slot.
   * Same semantics as LayoutSlot.inheritableTags.
   * Null = no tag inheritance.
   */
  inheritableTags: string[] | null;
  /** Boolean flags for this slot. All fields required — see BackdropSlotFlags. */
  flags: BackdropSlotFlags;
}

/**
 * Sprite Backdrop: renders a pre-composed sprite image at a configured position.
 * The tilesetId points to the tileset entry whose image IS the composed sprite.
 * Anchor (0-1) positions the sprite center relative to the layout bounds.
 *
 * Optionally defines walkable tiles and slot positions for gameplay integration:
 * - `unblockedTiles` marks which tiles within the backdrop are walkable (use with `blocking: 'unblocks'`)
 * - `slots` defines hand-placed object/NPC positions with candidate arrays
 */
export interface SpriteBackdropLayerConfig extends TerrainLayerBase {
  type: 'sprite_backdrop';
  /** Horizontal anchor within layout bounds (0 = left edge, 0.5 = center, 1 = right edge). */
  anchorX: number;
  /** Vertical anchor within layout bounds (0 = top edge, 0.5 = center, 1 = bottom edge). */
  anchorY: number;
  /** Sprite grid width in tiles (derived from tileset image width / tileSize). Null when no gameplay data. */
  gridWidth: number | null;
  /** Sprite grid height in tiles (derived from tileset image height / tileSize). Null when no gameplay data. */
  gridHeight: number | null;
  /** Tile coordinates [col, row] in sprite-local space that are walkable. Null = no walkable tiles (visual-only). */
  unblockedTiles: Array<[number, number]> | null;
  /** Hand-placed slot definitions with candidate positions in sprite-local space. Null = no backdrop slots. */
  slots: BackdropSlot[] | null;
}

/**
 * Animated Overlay: visual-only layer with client-side tile animation.
 * Generates real tile data (like fill) but the client cycles tile indices on a timer
 * to create ambient effects — ocean waves, lava shimmer, torch flicker, etc.
 *
 * Place over another layer (e.g. ocean fill) at a higher renderOrder.
 * Uses `blocking: null` and `terrain: 'void'` because it's purely visual.
 */
export interface AnimatedOverlayLayerConfig extends TerrainLayerBase {
  type: 'animated_overlay';
  /** Tile indices the client cycles through during animation. Same pool as fill. */
  frames: number[];
  /** Milliseconds between animation ticks. Lower = faster animation. */
  tickMs: number;
  /** Number of tile swaps per tick per 1000 matching tiles. Scales with map size. */
  density: number;
}

/**
 * Road: generates a connected road network (spine + branches) rasterized onto the terrain grid.
 * Uses blob-47 autotiling for visual tile selection.
 */
export interface RoadLayerConfig extends TerrainLayerBase {
  type: 'road';
  /** Road width in tiles (2-5). Default 2. Width 2+ needed for blob-47 autotile to produce smooth edges. */
  roadWidth: number;
  /** Number of branches off the main spine (0-6). Default 2. */
  branchCount: number;
  /** Noise-based curvature amount (0-1). 0 = straight lines, 1 = maximum winding. Default 0.3. */
  curvature: number;
  /** Autotile preset for road tile selection. */
  autotilePreset: AutotilePreset;
  /** Layer IDs to treat as "same terrain" for autotile neighbor checks. */
  autotileAgainst: string[];
  /** Layer IDs whose tiles the road must not overwrite. Use to prevent roads from rendering over water. */
  avoidLayerIds?: string[];
}

/**
 * Path: generates a single winding trail between two random edge points.
 * Always 1-tile wide. Uses noise offset for organic feel. Blob-47 autotiled.
 */
export interface PathLayerConfig extends TerrainLayerBase {
  type: 'path';
  /** Noise-based curvature amount (0-1). 0 = straight line, 1 = maximum winding. Default 0.5. */
  curvature: number;
  /** Autotile preset for path tile selection. */
  autotilePreset: AutotilePreset;
  /** Layer IDs to treat as "same terrain" for autotile neighbor checks. */
  autotileAgainst: string[];
  /** Layer IDs whose tiles the path must not overwrite. Use to prevent paths from rendering over water. */
  avoidLayerIds?: string[];
}

/**
 * Town Center: generates a circular clearing at the highest-degree road intersection.
 * Requires a road/path layer to exist (reads roadGraph from accumulated state).
 * Autotiled with blob-47 for visual consistency with road layer.
 */
export interface TownCenterLayerConfig extends TerrainLayerBase {
  type: 'town_center';
  /** Clearing radius in tiles from the center intersection. */
  radius: number;
  /** Autotile preset for clearing tile selection. */
  autotilePreset: AutotilePreset;
  /** Layer IDs to treat as "same terrain" for autotile neighbor checks. */
  autotileAgainst: string[];
}

/**
 * Cave: fills the entire grid with blocking rock, then carves passable tunnels
 * using a spine + branch approach (inverse of road layer).
 * Uses blob-47 autotiling on the rock/tunnel boundary (inward-facing edges).
 */
export interface CaveLayerConfig extends TerrainLayerBase {
  type: 'cave';
  /** Tunnel width in tiles (1-3). Default 1. */
  tunnelWidth: number;
  /** Number of perpendicular branches off the spine (2-4). Default 3. */
  branchCount: number;
  /** Noise-based curvature amount (0-1). 0 = straight L-paths, 1 = maximum winding. Default 0.3. */
  curvature: number;
  /** Autotile preset for rock/tunnel boundary tiles. */
  autotilePreset: AutotilePreset;
  /** Layer IDs treated as same terrain for autotile neighbor checks. */
  autotileAgainst: string[];
}

// ============================================================================
// Discriminated Union & Factory
// ============================================================================

/** Discriminated union of all terrain layer types. */
export type TerrainLayerConfig =
  | FillLayerConfig
  | NoiseFillLayerConfig
  | StarfieldLayerConfig
  | NoisePatchLayerConfig
  | CoastlineLayerConfig
  | RectangleLayerConfig
  | LShapeLayerConfig
  | TShapeLayerConfig
  | WallLayerConfig
  | WallFaceLayerConfig
  | SpriteBackdropLayerConfig
  | AnimatedOverlayLayerConfig
  | RoadLayerConfig
  | PathLayerConfig
  | TownCenterLayerConfig
  | CaveLayerConfig;

/**
 * Resolve noise parameters for a noise_patch layer.
 * If shapePreset is a named preset, returns preset defaults merged with any overrides.
 * If shapePreset is 'custom', all noise fields must be provided — throws if missing.
 */
export function resolveNoiseParams(config: NoisePatchLayerConfig): NoiseParams {
  const preset = NOISE_PRESETS[config.shapePreset];

  if (preset === null) {
    // Custom: all fields required
    if (
      config.noiseScale === undefined ||
      config.octaves === undefined ||
      config.persistence === undefined ||
      config.threshold === undefined ||
      config.edgeBehavior === undefined
    ) {
      throw new Error(
        `noise_patch layer "${config.id}" uses 'custom' preset but is missing required noise parameters`,
      );
    }
    return {
      noiseScale: config.noiseScale,
      octaves: config.octaves,
      persistence: config.persistence,
      threshold: config.threshold,
      edgeBehavior: config.edgeBehavior,
    };
  }

  // Named preset: use defaults, allow overrides
  return {
    noiseScale: config.noiseScale ?? preset.noiseScale,
    octaves: config.octaves ?? preset.octaves,
    persistence: config.persistence ?? preset.persistence,
    threshold: config.threshold ?? preset.threshold,
    edgeBehavior: config.edgeBehavior ?? preset.edgeBehavior,
  };
}

/**
 * Create a default `TerrainLayerConfig` for a given layer type.
 * Used by admin UI to construct correct config shape when the user switches types.
 * Derives renderOrder and blocking from LAYER_TYPE_META defaults.
 * TypeScript exhaustive checking ensures every layer type has a case.
 */
export function createDefaultLayerConfig(
  type: LayerType,
  base: {
    id: string;
    tilesetId: string;
  },
): TerrainLayerConfig {
  const meta = LAYER_TYPE_META[type];
  const shared = {
    ...base,
    renderOrder: meta.defaultRenderOrder,
    blocking: meta.defaultBlocking,
    terrain: meta.defaultTerrain,
    procedural: false,
    fill: [0] as number[],
    inheritable: false,
  };

  switch (type) {
    case 'fill':
      return { ...shared, type: 'fill', inheritable: true };
    case 'noise_fill':
      return {
        ...shared,
        type: 'noise_fill',
        fill: [],
        fillDirection: 'south',
        fillPercent: 0.3,
        noiseScale: 0.05,
        noiseAmplitude: 0.15,
        autotilePreset: 'canonical',
        autotileAgainst: [],
      };
    case 'starfield':
      return { ...shared, type: 'starfield', procedural: true, inheritable: true };
    case 'noise_patch':
      return {
        ...shared,
        type: 'noise_patch',
        fill: [],
        autotilePreset: 'canonical',
        autotileAgainst: [],
        withinTerrain: null,
        shapePreset: 'continent',
      };
    case 'coastline':
      return {
        ...shared,
        type: 'coastline',
        fill: [],
        sourceLayerId: '',
        beachWidth: 1,
        autotilePreset: 'canonical',
        autotileAgainst: [],
        altCenterCount: 0,
      };
    case 'rectangle':
      return { ...shared, type: 'rectangle' };
    case 'l_shape':
      return { ...shared, type: 'l_shape', minArmWidth: 6 };
    case 't_shape':
      return { ...shared, type: 't_shape', minArmWidth: 6 };
    case 'wall':
      return { ...shared, type: 'wall', wallStyle: '' };
    case 'wall_face':
      return { ...shared, type: 'wall_face', wallLayerId: '', roomLayerId: '', wallStyle: '' };
    case 'sprite_backdrop':
      return {
        ...shared,
        type: 'sprite_backdrop',
        blocking: null,
        terrain: 'void' as TerrainTag,
        anchorX: 0.5,
        anchorY: 0.5,
        gridWidth: null,
        gridHeight: null,
        unblockedTiles: null,
        slots: null,
      };
    case 'animated_overlay':
      return {
        ...shared,
        type: 'animated_overlay',
        blocking: null,
        terrain: 'void' as TerrainTag,
        frames: [0],
        tickMs: 400,
        density: 8,
      };
    case 'road':
      return {
        ...shared,
        type: 'road',
        fill: [],
        roadWidth: 2,
        branchCount: 2,
        curvature: 0.3,
        autotilePreset: 'canonical',
        autotileAgainst: [],
        altCenterCount: 0,
      };
    case 'path':
      return {
        ...shared,
        type: 'path',
        fill: [],
        curvature: 0.5,
        autotilePreset: 'canonical',
        autotileAgainst: [],
        altCenterCount: 0,
      };
    case 'town_center':
      return {
        ...shared,
        type: 'town_center',
        fill: [],
        radius: 4,
        autotilePreset: 'canonical',
        autotileAgainst: [],
        altCenterCount: 0,
      };
    case 'cave':
      return {
        ...shared,
        type: 'cave',
        fill: [],
        tunnelWidth: 1,
        branchCount: 3,
        curvature: 0.3,
        autotilePreset: 'canonical',
        autotileAgainst: [],
        altCenterCount: 0,
      };
  }
}
