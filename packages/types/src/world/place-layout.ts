/**
 * Place Layout System types.
 *
 * Defines the visual layout of a place including tilemaps and object placements.
 * Used by the procedural generation system (4-layer approach) and Phaser rendering.
 */

import type { Purpose } from './entity-registry.js';
import type { EntityInteraction } from '../entity/entities.js';
import type { LightSourceConfig } from './object-types.js';

/** 2D point in tile coordinates */
export interface Point {
  x: number;
  y: number;
}

/** Polygon defined by ordered vertices */
export interface Polygon {
  vertices: Point[];
}

/** Axis-aligned bounding box */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Individual tilemap layer (floor, walls, decoration) */
export interface TilemapLayer {
  /** Layer name for identification */
  name: string;
  /** Terrain layer type (fill, starfield, noise_patch, rectangle, sprite_backdrop, etc.) */
  type: string;
  /** When true, rendered as procedural effect instead of tilemap tiles */
  procedural: boolean;
  /** Rendering depth (lower = behind) */
  depth: number;
  /** 2D array of tile indices (-1 = empty) */
  data: number[][];
  /** Tileset ID for this layer's tile indices */
  tilesetId: string;
  /**
   * Optional offset into tileset for this layer (e.g., 49 for grass section of combined sheet).
   * This offset is added to all tile indices when rendering.
   */
  tilesetOffset: number | null;
  /**
   * Horizontal anchor for sprite_backdrop layers (0 = left, 0.5 = center, 1 = right).
   * Null for non-backdrop layers.
   */
  anchorX: number | null;
  /**
   * Vertical anchor for sprite_backdrop layers (0 = top, 0.5 = center, 1 = bottom).
   * Null for non-backdrop layers.
   */
  anchorY: number | null;
  /**
   * Tile indices the client cycles through for animated_overlay layers.
   * Null for non-animated layers.
   */
  animationFrames: number[] | null;
  /**
   * Milliseconds between animation ticks for animated_overlay layers.
   * Null for non-animated layers.
   */
  animationTickMs: number | null;
  /**
   * Tile swaps per tick per 1000 matching tiles for animated_overlay layers.
   * Null for non-animated layers.
   */
  animationDensity: number | null;
  /**
   * When true, child places (e.g. vessels) inherit this layer from the parent layout.
   * Propagated from the template's TerrainLayerConfig.inheritable during generation.
   */
  inheritable: boolean;
}

/** Complete tilemap data for a place */
export interface TilemapData {
  /** Size of each tile in pixels */
  tileSize: number;
  /** Width in tiles */
  width: number;
  /** Height in tiles */
  height: number;
  /** Ordered layers (bottom to top) */
  layers: TilemapLayer[];
}

/**
 * A generated terrain layer ready for rendering.
 * Contains autotiled tile indices for a single terrain type.
 */
export interface TerrainLayer {
  /** Layer identifier (e.g., 'water', 'grass', 'forest') */
  id: string;
  /** Tileset ID for sprite lookup */
  tilesetId: string;
  /** Offset into combined tileset (e.g., 49 for grass section) */
  tilesetOffset: number;
  /** 2D array of autotile indices (0-46) or -1 for empty/transparent */
  tiles: number[][];
  /** Render depth (lower = rendered first/behind) */
  depth: number;
}

/** A node in the road network graph. */
export interface RoadNode {
  /** Tile X coordinate. */
  x: number;
  /** Tile Y coordinate. */
  y: number;
  /** Node type: endpoint (map edge), intersection (spine-branch junction), or branch (branch terminus). */
  type: 'endpoint' | 'intersection' | 'branch';
}

/** An edge in the road network graph connecting two nodes. */
export interface RoadEdge {
  /** Index into the nodes array for the start of this edge. */
  from: number;
  /** Index into the nodes array for the end of this edge. */
  to: number;
}

/** Road network graph produced by road layer generation. */
export interface RoadGraph {
  /** Network nodes (intersections, endpoints, branch termini). */
  nodes: RoadNode[];
  /** Edges connecting nodes. */
  edges: RoadEdge[];
}

/** A node in the cave network graph. */
export interface CaveNode {
  /** Tile X coordinate. */
  x: number;
  /** Tile Y coordinate. */
  y: number;
  /**
   * Node type:
   * - endpoint: where the spine reaches the map boundary (tunnel entry/exit)
   * - junction: where a branch meets the spine
   */
  type: 'endpoint' | 'junction';
}

/** An edge in the cave network graph connecting two nodes. */
export interface CaveEdge {
  /** Index into the nodes array for the start of this edge. */
  from: number;
  /** Index into the nodes array for the end of this edge. */
  to: number;
}

/** Cave network graph produced by cave layer generation. */
export interface CaveGraph {
  /** Network nodes (spine endpoints and branch junctions). */
  nodes: CaveNode[];
  /** Edges connecting nodes. */
  edges: CaveEdge[];
}

/** A district zone with its center resolved from road topology. */
export interface ResolvedDistrict {
  /** District ID (matches DistrictConfig.id). */
  id: string;
  /** Auto-identified center position in tile coordinates. */
  center: { x: number; y: number };
  /** Influence radius in tiles. */
  influenceRadius: number;
  /** Placement bias strength (0-1). */
  weight: number;
}

/** Output of Layer 1: Shape Generation */
export interface GeneratedShape {
  /** 2D blocked mask: true = impassable (default false = passable) */
  blockedMask: boolean[][];
  /** Total bounds in tiles */
  bounds: Bounds;
  /**
   * Terrain type grid. Each cell holds the layer id that painted it.
   * Null when the template has no terrain layers. When present, every cell
   * has a value because templates must start with a fill layer.
   * Used by layer-aware slot placement algorithms to find valid positions.
   */
  terrainGrid: string[][] | null;
  /** Rendering layers produced by terrain layer processing */
  layers: TerrainLayer[];
  /** Per-layer masks for layer-aware placement (keyed by layer id) */
  layerMasks: Record<string, boolean[][]>;
  /**
   * Road network graph from road/path layer generation.
   * Null when no road/path layers exist. Used by Phase 2 placement
   * algorithms (along_road, road_intersection, road_end) to find
   * road-adjacent positions without parsing the terrain grid.
   */
  roadGraph: RoadGraph | null;
  /**
   * Cave network graph from cave layer generation.
   * Null when no cave layers exist. Used by the along_cave placement
   * algorithm to find alcove positions (passable tiles adjacent to cave walls)
   * near junction and endpoint nodes.
   */
  caveGraph: CaveGraph | null;
  /**
   * Resolved district zones from layout variant's district configs.
   * Null when no districts are configured. Used by placement algorithms
   * to bias slot positions toward district centers.
   */
  districts: ResolvedDistrict[] | null;
}

/** How a feature should be placed */
export type FeaturePlacementType = 'wall' | 'corner' | 'center' | 'near_entrance' | 'away_from';

/** Feature placement configuration */
export type FeaturePlacement =
  | { type: 'wall'; sides: ('north' | 'south' | 'east' | 'west')[] }
  | { type: 'corner' }
  | { type: 'center' }
  | { type: 'near_entrance'; maxDistance: number }
  | { type: 'away_from'; featureId: string; minDistance: number };

/** Zone shape type */
export type ZoneShape = 'radial' | 'rectangular' | 'facing';

/** Zone created around a feature */
export interface ZoneDefinition {
  /** Zone identifier */
  id: string;
  /** How the zone expands from feature */
  shape: ZoneShape;
  /** Radius for radial zones (in tiles) */
  radius: number | null;
  /** Which side of feature the zone faces */
  direction: 'front' | 'all' | null;
}

/** Definition of an anchor feature (hearth, bar, altar, etc.) */
export interface FeatureDefinition {
  /** Unique feature identifier */
  id: string;
  /** Reference to object type catalog */
  objectTypeId: string;
  /** Size in tiles */
  size: { width: number; height: number };
  /** How to place this feature */
  placement: FeaturePlacement;
  /** Zone this feature creates */
  createsZone: ZoneDefinition | null;
  /** Whether this feature must be present */
  required: boolean;
}

/** A feature that has been placed in the layout */
export interface PlacedFeature {
  /** Feature definition id */
  featureId: string;
  /** Object type id */
  objectTypeId: string;
  /** Position in tiles */
  position: Point;
  /** Size in tiles */
  size: { width: number; height: number };
  /** Direction the feature faces */
  facing: 'north' | 'south' | 'east' | 'west' | null;
}

/** A zone with computed boundaries */
export interface PlacedZone {
  /** Zone definition id */
  zoneId: string;
  /** Feature that created this zone */
  featureId: string;
  /** Zone boundary */
  bounds: Bounds;
  /** Alternative: polygon boundary for irregular zones */
  polygon: Polygon | null;
}

/** Output of Layer 2: Feature Placement */
export interface PlacedFeatures {
  /** Features with actual positions */
  features: PlacedFeature[];
  /** Zones with boundaries */
  zones: PlacedZone[];
  /** Space not claimed by zones */
  remainingSpace: Polygon[];
}

/**
 * Slot purpose type - purposes are managed dynamically via the purpose registry.
 * Objects declare which purposes they can fulfill; slots declare what purpose they need.
 * An object is a candidate for a slot if its purposes array includes the slot's purpose.
 */
export type SlotPurpose = string;

/** Types of furniture slots (spatial classification) */
export type SlotType =
  | 'wall_slot' // Against a wall
  | 'corner_slot' // In a corner
  | 'center_slot' // Open floor area
  | 'near_feature' // Adjacent to a feature
  | 'in_zone' // Within a defined zone
  | 'path_edge'; // Along a walkway

/** Cardinal/ordinal direction */
export type Direction =
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'northeast'
  | 'northwest'
  | 'southeast'
  | 'southwest';

/** A position where furniture can be placed */
export interface Slot {
  /** Unique slot identifier */
  id: string;
  /** What purpose this slot serves (determines eligible objects) */
  purpose: SlotPurpose;
  /** Spatial classification of the slot */
  type: SlotType;
  /** Position in tiles */
  position: Point;
  /** Size constraints for objects that can fit */
  size: {
    /** Minimum width in pixels */
    minWidth: number;
    /** Minimum height in pixels */
    minHeight: number;
    /** Maximum width in pixels */
    maxWidth: number;
    /** Maximum height in pixels */
    maxHeight: number;
  };
  /** For wall slots, which way objects face */
  facing: Direction | null;
  /** If in a zone, which one */
  zoneId: string | null;
  /** If near a feature, which one */
  featureId: string | null;
  /** Higher priority slots are filled first */
  priority: number;
  /** Whether this slot must be filled */
  required: boolean;
}

/** Output of Layer 3: Slot Analysis */
export interface AnalyzedSpace {
  /** The generated shape */
  shape: GeneratedShape;
  /** Placed features and zones */
  features: PlacedFeatures;
  /** Available furniture slots */
  slots: Slot[];
  /** Areas that should stay clear for movement */
  pathways: Polygon[];
}

/** Context conditions for population rules */
export interface ContextCondition {
  wealth: 'high' | 'moderate' | 'low' | null;
  cleanliness: 'clean' | 'worn' | 'dirty' | null;
  crowding: 'sparse' | 'normal' | 'packed' | null;
  atmosphere: 'formal' | 'casual' | 'rowdy' | null;
}

/** Detected context for a place */
export interface PlaceContext {
  wealth: 'high' | 'moderate' | 'low';
  cleanliness: 'clean' | 'worn' | 'dirty';
  crowding: 'sparse' | 'normal' | 'packed';
  atmosphere: 'formal' | 'casual' | 'rowdy';
}

/** Modifier based on context */
export interface ContextModifier {
  /** When this modifier applies */
  condition: ContextCondition;
  /** Multiply selection weight */
  weightMultiplier: number | null;
  /** Use this type instead */
  replacementTypeId: string | null;
}

/** An object that can be placed in a slot */
export interface ObjectOption {
  /** Reference to object type catalog */
  objectTypeId: string;
  /** Selection probability weight */
  weight: number;
  /** Context-based modifications */
  contextModifiers: ContextModifier[] | null;
}

/** Rule for populating a specific slot type */
export interface SlotPopulationRule {
  /** Which slot type this applies to */
  slotType: SlotType;
  /** Only for slots in this zone */
  zoneId: string | null;
  /** Only for slots near this feature pattern (e.g., "table_*") */
  featureId: string | null;
  /** Probability of filling matching slots (0-1) */
  fillProbability: number;
  /** Maximum count for this object type */
  maxCount: number | null;
  /** Objects that can fill this slot */
  objectOptions: ObjectOption[];
}

/** Population rules for a place purpose */
export interface PopulationRules {
  /** Purpose of the place (tavern, shop, wilderness, etc.) */
  purpose: Purpose;
  /** Rules for each slot type */
  slotRules: SlotPopulationRule[];
}

/** An object to be placed in the layout */
export interface PlacedObject {
  /** Object type id from catalog */
  objectTypeId: string;
  /** Slot this object occupies */
  slotId: string;
  /** Position in tiles */
  position: Point;
  /** Direction the object faces */
  facing: Direction | null;
  /** Selected material override */
  material: string | null;
  /** Color tint override */
  tint: number | null;
}

/** Reference to a placed object entity with rendering data */
export interface ObjectPlacement {
  /** Object entity ID (links to ObjectEntity in universe data) */
  objectId: string;
  /** Object type ID for sprite lookup */
  objectTypeId: string;
  /** World position in pixels */
  x: number;
  y: number;
  /** Whether object blocks movement */
  solid: boolean;
  /** Rendering layer */
  layer: 'floor' | 'default' | 'overhead' | 'wall';
  /** Sprite tint */
  tint: number | null;
  /** Sprite ID for loading - dimensions are looked up from sprite registry */
  spriteId: string | null;
  /** Direction for directional sprites (north/south/east/west). Used to pick frame from sprite.directions. */
  facing: 'north' | 'south' | 'east' | 'west' | null;
  /** Display label for tooltips */
  label: string | null;
  /** Description for tooltips */
  description: string | null;
  /** Unified interaction model. Data-driven from entity.interaction. */
  interaction: EntityInteraction | null;
  /** Light source configuration. Null = object does not emit light. */
  lightSource: LightSourceConfig | null;
  /** Item IDs inside this container. Null for non-container objects. */
  contents: string[] | null;
  /**
   * Override position for interaction proximity detection, in world pixels.
   * When set, the interaction manager uses this instead of x/y to compute
   * distance to the player. Used for multi-tile buildings where the entry
   * point differs from the sprite origin.
   */
  interactionAnchor: { x: number; y: number } | null;
}

/**
 * A generated slot with its selected purpose and position.
 * Created during layout generation by running slots through placement algorithms.
 */
export interface GeneratedSlot {
  /** The selected purpose (chosen from the slot's purposes array) */
  purpose: Purpose;
  /** Purpose category from the purpose registry. */
  category: 'object' | 'place' | 'character';
  /** X position in tiles */
  x: number;
  /** Y position in tiles */
  y: number;
  /** Width in tiles */
  width: number;
  /** Height in tiles */
  height: number;
  /** Direction the placed object faces. Set by the placement algorithm. */
  facing: 'north' | 'south' | 'east' | 'west';
  /** Render layer set by the placement algorithm. */
  layer: 'floor' | 'default' | 'overhead' | 'wall';
  /** Whether objects generated from this slot are system-only (hidden from players). Defaults to false. */
  isStructural?: boolean;
  /**
   * Tags that candidate entities must ALL have to fill this slot (AND logic).
   * Carried through from the LayoutSlot definition, merged with any inherited tags
   * from the place's inheritedRequiredTags.
   * Null = no tag filtering.
   */
  requiredTags?: string[] | null;
  /**
   * Tags that exclude candidate entities from this slot (NOR logic).
   * Carried through from the LayoutSlot definition.
   */
  forbiddenTags?: string[] | null;
  /**
   * Tags that cascade to child places created from this slot.
   * Carried through from the LayoutSlot definition. Only meaningful for place-category slots.
   * Used during child place creation to compute the child's inheritedRequiredTags.
   */
  inheritableTags?: string[] | null;
  /**
   * When true, use LLM to select the object for this slot. When false or omitted, use
   * weighted random. Defaults to false. Carried from LayoutSlot / BackdropSlot.
   */
  useLlmSelection?: boolean;
  /**
   * When true, the object selector must only pick objects whose sprite supports this
   * slot's facing. Set by against_wall placement where different walls produce different
   * facings and not all candidate objects support all facings.
   */
  facingConstrained?: boolean;
}

/**
 * An unfilled slot detected at a specific place.
 * Used by the slot population system to track which slots need new entities.
 */
export interface UnfilledSlotInfo {
  /** The slot that needs an entity (character or place) */
  slot: GeneratedSlot;
  /** The place where the slot exists */
  placeId: string;
}

/**
 * A place that a character needs but doesn't have.
 * Detected by the periodic scan and used to enqueue place generation.
 */
export interface PlaceNeed {
  /** The character who needs the place */
  characterId: string;
  /** What the character is missing */
  needType: 'home';
  /** The place near which to create the missing place (typically the character's workplace) */
  nearPlaceId: string;
}

/** Complete layout for a place */
export interface PlaceLayout {
  /** Place this layout belongs to */
  placeId: string;
  /** Tilemap data */
  tilemap: TilemapData;
  /** Bounds in world pixels */
  bounds: Bounds;
  /**
   * Generated slots with positions.
   * Each slot has a selected purpose and tile coordinates.
   * Used by entity generation to create objects and child places.
   */
  slots: GeneratedSlot[];
  /**
   * Terrain tag grid for runtime movement.
   * Each cell holds the semantic terrain classification (e.g., 'land', 'water', 'wall').
   * Null when the layout has no terrain layers (movement unconstrained).
   * Used with movement profiles to determine passability + speed per tile.
   */
  terrainGrid: string[][] | null;
  /** Purpose used for generation */
  purpose: string | null;
  /** Detected context */
  context: PlaceContext | null;
  /** Generation seed for reproducibility */
  seed: number | null;
  /** Generation timestamp */
  generatedAt: string | null;
  /** Multiplier for character sprite size (0.5 = half, 1 = normal, 2 = double). */
  characterScale: number;
}

/** Matching metadata from regeneration (only present when existingObjects were provided). */
export interface GenerationReuseInfo {
  /** IDs of existing objects that were matched to a slot and repositioned. */
  matchedObjectIds: string[];
  /** IDs of existing child places that were matched to a slot and repositioned. */
  matchedPlaceIds: string[];
  /** IDs of existing objects that had no matching slot in the new layout. */
  orphanedObjectIds: string[];
  /** IDs of existing child places that had no matching slot in the new layout. */
  orphanedPlaceIds: string[];
  /** Place-category slots that had no existing child to fill them. */
  unfilledPlaceSlots: GeneratedSlot[];
}

/** Result of layout generation */
export interface GenerationResult {
  /** The generated layout */
  layout: PlaceLayout;
  /** Created object entities (to be saved to universe data) */
  objectEntities: Array<{
    id: string;
    objectTypeId: string;
    position: Point;
    material: string | null;
    tint: number | null;
    description: string | null;
  }>;
  /** Matching metadata (only present during regeneration when existing entities were provided). */
  reuse?: GenerationReuseInfo;
}
