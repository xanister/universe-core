/**
 * Object Type Catalog types.
 *
 * Defines object types (templates) that can be instantiated as ObjectEntities.
 * Types provide default values; instances can override them.
 */

import type { SlotPurpose } from './place-layout.js';

/** Variant sprite configuration (e.g., different wood colors) */
export interface SpriteVariant {
  tileset: string;
}

/** Directional sprite override */
export interface SpriteDirection {
  x: number;
  y: number;
}

/** State-based sprite position override */
export interface SpriteState {
  x: number;
  y: number;
}

/** Collision bounding box relative to sprite origin */
export interface SpriteBoundingBox {
  /** Width of collision area in pixels */
  width: number;
  /** Height of collision area in pixels */
  height: number;
  /** X offset from sprite's left edge */
  offsetX: number;
  /** Y offset from sprite's top edge */
  offsetY: number;
}

/** Per-direction offset override for the collision bounding box */
export interface DirectionOffsetOverride {
  offsetX: number;
  offsetY: number;
}

export type DirectionKey = 'north' | 'south' | 'east' | 'west';

/** Tileset: one image containing tiles */
export interface TilesetInfo {
  name: string;
  /** Path to the image file relative to sprites dir (e.g., 'lpc-interior/floors.png') */
  path: string;
  tileSize: number;
  description: string | null;
}

/** Definition of a single sprite in the registry */
export interface SpriteDefinition {
  id: string;
  name: string | null;
  description: string | null;
  /** Tileset containing this sprite (each tileset is one image) */
  tileset: string;
  /** X position in tileset image (pixels) */
  x: number;
  /** Y position in tileset image (pixels) */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Tags for filtering */
  tags: string[] | null;
  /** Whether this sprite is animated */
  animated: boolean;
  /** Number of animation frames (only when animated) */
  frames?: number;
  /** Animation frame rate (only when animated) */
  frameRate?: number;
  /** Variant configurations (e.g., dark/blonde wood) */
  variants: Record<string, SpriteVariant> | null;
  /** Directional overrides (north/south/east/west) */
  directions: Record<string, SpriteDirection> | null;
  /** Which orientations this sprite visually supports. Always non-empty; ["south"] for single-direction sprites. */
  supportedOrientations: string[];
  /** State-based position overrides (open/closed) */
  states: Record<string, SpriteState> | null;
  /** Collision bounding box for physics/collision detection */
  boundingBox: SpriteBoundingBox | null;
  /** Per-direction offset overrides. Width/height come from base boundingBox; only offsets vary per direction. */
  directionBoundingBoxOverrides: Partial<Record<DirectionKey, DirectionOffsetOverride>> | null;
  /**
   * Mirror mappings: render a direction by horizontally flipping another direction's frame.
   * Key = direction to render, value = source direction to flip.
   * Example: `{ east: "west" }` means "render east by flipping west's frame".
   */
  mirrorMappings: Partial<Record<DirectionKey, DirectionKey>> | null;
  /**
   * Intrinsic render layer for this sprite. When set, overrides algorithm-assigned
   * layer during layout generation. Use 'floor' for sprites that represent surface
   * features (holes, grates, rugs) that characters should walk over, not behind.
   * Null = defer to the placement algorithm or catalog entity layer.
   */
  defaultLayer: 'floor' | 'default' | 'overhead' | 'wall' | null;
  /** True for custom composite sprites (authored via CustomSpriteEditor). */
  composite?: boolean;
}

/** Central sprite registry - single source of truth for all object sprites */
export interface SpriteRegistry {
  version: string;
  description: string;
  /** Tileset definitions */
  tilesets: Record<string, TilesetInfo>;
  /** Sprite definitions by ID */
  sprites: Record<string, SpriteDefinition>;
}

/** Sprite configuration for an object type */
export interface ObjectTypeSpriteConfig {
  /** Sprite sheet/atlas ID - dimensions are looked up from sprite registry */
  spriteId: string;
  /** Frame name or index within sprite sheet (conditional on sprite type) */
  frame?: string | number;
  /** Animation key if animated (conditional on sprite type) */
  animationKey?: string;
  /** Origin point (0-1 normalized, default 0.5, 1.0 for bottom-center) */
  originX: number | null;
  originY: number | null;
}

/** Material options for an object type */
export interface MaterialOption {
  /** Material identifier (oak, iron, cloth) */
  id: string;
  name: string;
  /** Default tint for this material */
  tint: number | null;
  /** Selection weight (higher = more common) */
  weight: number;
}

/** State an object can be in */
export interface ObjectState {
  /** State identifier (open, closed, lit, broken) */
  id: string;
  name: string;
  /** Sprite frame for this state (conditional on sprite type) */
  frame?: string | number;
  /** Whether this state blocks movement differently */
  solid: boolean;
}

/** Configuration for objects that emit light (torches, campfires, lanterns, etc.) */
export interface LightSourceConfig {
  /** Light radius in pixels (e.g., 96 for a torch, 160 for a campfire) */
  radius: number;
  /** Hex color (e.g., 0xffaa44 for warm firelight) */
  color: number;
  /** How strongly the light cuts through darkness (0-1) */
  intensity: number;
  /** Whether to animate intensity (torches, candles) */
  flicker: boolean;
  /** Tween duration in ms for flicker animation (default 200) */
  flickerSpeed: number;
  /** Intensity variance for flicker (default 0.15) */
  flickerRange: number;
  /** Horizontal pixel offset from object anchor for light origin (default 0) */
  offsetX: number;
  /** Vertical pixel offset from object anchor for light origin (default 0) */
  offsetY: number;
}

/** Definition of an object type (template for instances) */
export interface ObjectTypeDefinition {
  /** Unique type identifier (table_round, fireplace, barrel) */
  id: string;
  name: string;
  /** Description template (can use {material} placeholder) */
  descriptionTemplate: string;
  /**
   * Purposes this object can fulfill in procedural generation.
   * Objects are selected for slots when their purposes include the slot's purpose.
   * Empty array means the object won't be selected during procedural generation.
   */
  purposes: SlotPurpose[];
  /** Sprite configuration */
  sprite: ObjectTypeSpriteConfig;
  /** Collision dimensions in tiles */
  collision: {
    width: number;
    height: number;
    /** Offset from sprite origin */
    offsetX: number | null;
    offsetY: number | null;
  };
  /** Whether this type blocks movement by default */
  solid: boolean;
  /** Rendering layer */
  layer: 'floor' | 'default' | 'overhead' | 'wall';
  /** Available materials */
  materials: MaterialOption[] | null;
  /** Default material if not specified (conditional on materials) */
  defaultMaterial?: string;
  /** Available states */
  states: ObjectState[] | null;
  /** Default state if not specified (conditional on states) */
  defaultState?: string;
  /** Default max HP (0 = indestructible) */
  maxHp: number | null;
  /** Can this object contain items? */
  isContainer: boolean;
  /** Interaction types this object supports */
  interactions: string[] | null;
  /** Tags for filtering/categorization */
  tags: string[] | null;
}

/** Collection of object type definitions */
export interface ObjectTypeCatalog {
  /** Catalog version for migrations */
  version: string;
  /** Object type definitions indexed by ID */
  types: Record<string, ObjectTypeDefinition>;
}

/**
 * Extended attributes for ObjectEntity instances.
 * These override or extend the type defaults.
 *
 * Note: These attributes are now part of ObjectInfo in entities.ts.
 * This interface is provided for reference and documentation.
 */
export interface ExtendedObjectAttributes {
  /** Reference to type catalog entry */
  objectTypeId: string | null;
  /** Specific material for this instance */
  material: string | null;
  /** Current HP (for destructible objects) */
  hp: number | null;
  /** Max HP (copied from type or overridden) */
  maxHp: number | null;
  /** Color tint override (hex, e.g., 0x8B4513) */
  tint: number | null;
  /** Current state (open, closed, broken, lit) */
  state: string | null;
  /** For containers: item IDs inside */
  contents: string[] | null;
}

// Note: ObjectSpriteConfig is defined in entities.ts to avoid duplication
