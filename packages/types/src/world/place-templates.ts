/**
 * Place & Layout Template Types
 *
 * Template/slot/variant definitions for layout generation. These types define
 * the structure of layout templates — what slots to place, how variants are
 * configured, and how templates map to place purposes.
 *
 * Terrain layer types (layer configs, terrain tags, noise presets) live in
 * `terrain-layers.ts` — that file changes when new layer types are added,
 * while this file changes when the template/slot schema evolves.
 *
 * Extension rule for LayoutSlot:
 *   - New boolean flags → add to LayoutSlotFlags, NOT as top-level optional fields.
 *   - New nullable spatial hints → add as `field: T | null` (required-with-null).
 *   - All required-with-null fields must be present in every JSON slot object.
 *     Do NOT add a normalization fallback in the loader; fix the data instead.
 *
 * Import constraint for admin-ui: use the `@dmnpc/types/place-templates` subpath
 * instead of the barrel when importing runtime values in Next.js code.
 */

import type { EnvironmentConfig } from './weather.js';
import type { TerrainLayerConfig } from './terrain-layers.js';

// Re-export terrain layer runtime constants so the ./place-templates subpath
// gives admin-ui access to everything it needs without the barrel graph.
export * from './terrain-layers.js';

/**
 * Valid scale values. Derive PlaceScale from this for runtime validation.
 */
export const PLACE_SCALES = ['feet', 'miles', 'au', 'lightyears'] as const;

/**
 * Scale units for place dimensions.
 */
export type PlaceScale = (typeof PLACE_SCALES)[number];

// EnvironmentConfig is defined in weather.ts (FEAT-044: replaces PlaceEnvironment string)

/**
 * Range specification for dimensions.
 */
export interface DimensionRange {
  min: number;
  max: number;
}

/**
 * Slot distribution modes controlling how placement algorithms distribute objects spatially.
 * Each algorithm interprets the mode in its own way:
 * - 'even': weighted random preferring tiles farther from already-placed objects
 * - 'random': uniform random from available candidates (no spatial bias)
 * - 'clumped': weighted random preferring tiles closer to already-placed objects
 */
export const SLOT_DISTRIBUTIONS = ['even', 'random', 'clumped'] as const;

/**
 * Spatial distribution mode for slot placement.
 */
export type SlotDistribution = (typeof SLOT_DISTRIBUTIONS)[number];

/**
 * Strategy for auto-identifying a district's center from road topology.
 * - highest_degree: intersection node with most edges (natural civic/market hub)
 * - branch_terminus: branch/endpoint node farthest from claimed centers (residential edge)
 */
export const DISTRICT_SEED_STRATEGIES = ['highest_degree', 'branch_terminus'] as const;
export type DistrictSeedStrategy = (typeof DISTRICT_SEED_STRATEGIES)[number];

/**
 * Valid placement algorithm values. Derive PlacementAlgorithm from this for runtime validation.
 */
export const PLACEMENT_ALGORITHMS = [
  'in_wall',
  'random_valid',
  'random',
  'clustered',
  'open_space',
  'on_land',
  'on_water',
  'on_coast',
  'against_wall',
  'near_slot',
  'center_floor',
  'under',
  'on_surface',
  'along_road',
  'road_intersection',
  'road_end',
  'pier_end',
  'along_cave',
] as const;

/**
 * Slot placement algorithm types - extensible via PLACEMENT_ALGORITHMS registry.
 */
export type PlacementAlgorithm = (typeof PLACEMENT_ALGORITHMS)[number];

// ============================================================================
// Slot & Variant Definitions
// ============================================================================

/**
 * Boolean flags for a layout slot. All fields required — default is false.
 * Add new boolean flags here instead of as top-level optional fields on LayoutSlot.
 */
export interface LayoutSlotFlags {
  /**
   * Whether objects generated from this slot are system-only (hidden from players).
   * Typically true for exit slots on overworld-scale layouts (cosmos, star_system, planet).
   */
  isStructural: boolean;
  /**
   * When true, the `near_slot` algorithm orients placed objects toward
   * the anchor slot instead of picking a random facing.
   * Only meaningful when positionAlgorithm is `near_slot` and nearPurpose is set.
   */
  facesAnchor: boolean;
  /**
   * When true, use LLM to select the object for this slot from purpose-matched candidates
   * (place context: wealth, cleanliness, atmosphere). When false, use weighted random.
   */
  useLlmSelection: boolean;
}

/**
 * A slot definition from a layout template.
 *
 * Optionality rules:
 * - Required-with-null fields (requiredTags, slotSize, visualClearanceAbove, etc.):
 *   always present in JSON. null means "not set / use default".
 * - Boolean flags: in LayoutSlotFlags. Always present via the required `flags` field.
 */
export interface LayoutSlot {
  /** The purpose this slot serves (e.g. "exit", "table", "bartender"). */
  purpose: string;
  positionAlgorithm: PlacementAlgorithm;
  /**
   * Spatial distribution mode for this slot.
   * Controls how the placement algorithm distributes objects relative to already-placed objects:
   * - 'even': weighted random preferring tiles farther from placed objects (best default)
   * - 'random': uniform random, no spatial bias beyond occupancy
   * - 'clumped': weighted random preferring tiles closer to placed objects (storage crates, etc.)
   */
  distribution: SlotDistribution;
  /**
   * Tags that candidate entities must ALL have to fill this slot (AND logic).
   * When non-null, only entities whose `tags` array contains every listed tag are eligible.
   *
   * Interaction with algorithm defaults (PlacementAlgorithmMeta):
   * - `null` = "no opinion" — algorithm defaults apply (e.g. in_wall adds ["wall"])
   * - `[]` = "explicitly none" — opts out of algorithm defaults
   * - `["tag", ...]` = "use these" — slot takes control, algorithm defaults skipped
   */
  requiredTags: string[] | null;
  /**
   * Tags that exclude candidate entities from filling this slot (NOR logic).
   * When non-null, entities whose `tags` array contains ANY of these tags are rejected.
   *
   * Interaction with algorithm defaults (PlacementAlgorithmMeta):
   * - `null` = "no opinion" — algorithm defaults apply (e.g. against_wall adds ["wall"])
   * - `[]` = "explicitly none" — opts out of algorithm defaults
   * - `["tag", ...]` = "use these" — slot takes control, algorithm defaults skipped
   */
  forbiddenTags: string[] | null;
  /**
   * Tags that cascade to all descendant layout slots when this slot produces a child place.
   * When a place-category slot has inheritableTags, the child place's `inheritedRequiredTags`
   * is set to the union of the parent place's inherited tags and this slot's inheritableTags.
   * During layout generation, every slot in a place with inheritedRequiredTags gets those
   * tags merged into its requiredTags.
   * Null = no tag inheritance.
   */
  inheritableTags: string[] | null;
  min: number | null;
  max: number | null;
  /**
   * Purpose of a previously-placed slot that this slot should be placed near.
   * Only meaningful for the `near_slot` placement algorithm.
   * The referenced purpose must appear earlier in the variant's slot list.
   */
  nearPurpose: string | null;
  /**
   * Multi-tile footprint for this slot in tiles. When set, the placement algorithm
   * reserves a contiguous area of this size instead of the default 2×2 occupancy block.
   * Primarily used for place-category slots (buildings on city maps).
   * Null = use the algorithm's default occupancy (2×2 for floor algorithms).
   */
  slotSize: { width: number; height: number } | null;
  /**
   * Upward sprite clearance in tiles above the footprint anchor row.
   * Null = no extra clearance (sprite fits within its footprint).
   */
  visualClearanceAbove: number | null;
  /**
   * District ID to bias placement toward. When set, placement algorithms
   * weight candidates by proximity to this district's center.
   * Null = no district bias.
   */
  preferDistrict: string | null;
  /**
   * Distribution group identifier. Slots sharing the same distributionGroup
   * are placed via interleaved round-robin (one instance per slot per round).
   * Null = ungrouped (placed sequentially as before).
   */
  distributionGroup: string | null;
  /** Boolean flags for this slot. All fields required — see LayoutSlotFlags. */
  flags: LayoutSlotFlags;
}

/**
 * Configuration for a district zone within a layout variant.
 * Districts auto-identify their centers from road topology and bias
 * slot placement within their influence radius. No hard boundaries —
 * keeps layouts organic.
 */
export interface DistrictConfig {
  /** Unique ID within this variant (e.g. 'market', 'residential'). */
  id: string;
  /** How to auto-identify this district's center from road topology. */
  seedStrategy: DistrictSeedStrategy;
  /** Influence radius in tiles — how far the district's weight reaches. */
  influenceRadius: number;
  /** Placement bias strength (0-1). Higher = stronger attraction toward center. */
  weight: number;
}

/**
 * A layout template variant.
 */
export interface LayoutVariant {
  id: string;
  scale: PlaceScale;
  environment: EnvironmentConfig;
  width: DimensionRange;
  height: DimensionRange;
  terrainLayers: TerrainLayerConfig[];
  slots: LayoutSlot[];
  /**
   * District zone definitions for spatial organization.
   * Each district auto-identifies its center from road topology
   * and biases slot placement within its influence radius.
   * Optional — omit for layouts without district organization.
   */
  districts?: DistrictConfig[];
  description: string;
  weight: number;
  /**
   * Initial state of the blocked mask before any layers process.
   * When true, all tiles start blocked and floor layers must unblock them.
   * When false, all tiles start unblocked (original behavior).
   */
  defaultBlocked: boolean;
  /**
   * Minimum distance in tiles from the map edge for slot placement.
   * Shrinks the placement bounds inward by this amount on all sides.
   * Default 0 (slots can be placed up to the shape boundary).
   */
  padding?: number;
}

/**
 * Layout template for a place type.
 */
export interface LayoutTemplate {
  name: string;
  description: string;
  purposes: string[];
  spriteId: string;
  variants: LayoutVariant[];
  /** Multiplier for character sprite size in this layout (0.5 = half, 1 = normal, 2 = double). */
  characterScale: number;
  /** Game-minutes per real second of time passage for places generated from this template. */
  timeScale: number;
  /**
   * Pixel region on the exterior sprite that represents the door/entry point.
   * Used to position the interaction anchor when this place appears as a building
   * on a parent map (city, planet). Coordinates relative to sprite top-left.
   * Null = interaction anchor at sprite center-bottom (default).
   */
  interactionZone: { x: number; y: number; width: number; height: number } | null;
}

// ============================================================================
// Connectivity Simulation (FEAT-438)
// ============================================================================

/** A single advisory or blocking finding from a connectivity simulation run. */
export interface ConnectivityWarning {
  code: 'disconnected_components' | 'low_walkable_ratio' | 'no_walkable_tiles';
  severity: 'error' | 'warning';
  message: string;
  detail?: Record<string, number>;
}

/** Aggregated result of a Monte Carlo connectivity simulation for a layout variant. */
export interface ConnectivitySimResult {
  variantId: string;
  /** True when zero 'error'-severity warnings were found across all runs. */
  connected: boolean;
  /** Fraction of runs where componentCount > 1 (0–1). */
  failureRate: number;
  warnings: ConnectivityWarning[];
  /**
   * Number of runs that completed the full slot-placement + connectivity check.
   * Baseline-fragmented runs (see skippedRunCount) do not increment this.
   */
  runsCompleted: number;
  /**
   * Number of runs where the raw terrain was already fragmented before slot
   * placement. Those runs are exempt from the failure count, matching the
   * generator's own exemption for outdoor layouts (forests, caves, ruins).
   * Zero means every run went through full connectivity checking.
   */
  skippedRunCount: number;
}

/** Response from POST /api/layout/variants/connectivity-check */
export interface ConnectivityCheckResponse {
  result: ConnectivitySimResult;
}
