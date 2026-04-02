/**
 * Algorithm Types & Registry
 *
 * Shared types and registry for slot placement algorithms.
 * Extracted from index.ts to break circular dependency with placement-algorithms.ts.
 */

import type { GeneratedShape, LayoutVariant } from '@dmnpc/types/world';
import type { PlacementAlgorithm, LayoutSlot } from '../layout-templates.js';

// Re-export for consumers
export type { GeneratedShape };

// ============================================================================
// Slot Placement Algorithm Types
// ============================================================================

/**
 * Positioned slot - a slot with spatial coordinates.
 */
export interface PositionedSlot {
  slot: LayoutSlot;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Direction the placed object faces. Every algorithm must set this. */
  facing: 'north' | 'south' | 'east' | 'west';
  /** Render layer for this slot. Every algorithm must set this. */
  layer: 'floor' | 'default' | 'overhead' | 'wall';
}

/**
 * Context passed to every placement algorithm.
 *
 * Extensible: new fields can be added without changing existing algorithm signatures.
 * Algorithms destructure only the fields they need.
 */
export interface PlacementContext {
  /** The generated room/map shape with bounds, layer masks, and terrain grid. */
  shape: GeneratedShape;
  /** Slot definitions to place (usually a single slot per call from the generator). */
  slots: LayoutSlot[];
  /** RNG seed for reproducibility. */
  seed: number;
  /** The layout variant, including terrain layer configs for layer-aware decisions. */
  variant: LayoutVariant;
  /**
   * Shared set of "x,y" strings maintained across all algorithm calls within a
   * single `generatePositionedSlots()` invocation. Algorithms MUST filter candidates
   * against this set and add newly placed tile positions to it, preventing cross-slot overlap.
   */
  occupiedTiles: Set<string>;
  /**
   * Slots positioned by previous algorithm calls in this generation pass.
   * Used by `near_slot` to find anchor positions. Grows as each algorithm runs.
   */
  placedSlots: PositionedSlot[];
  /**
   * Bounds for slot placement, shrunk inward by the variant's padding value.
   * Use this (not shape.bounds) for filterTilesForPlacement bounds checks.
   * When padding=0, equals shape.bounds.
   */
  placementBounds: { x: number; y: number; width: number; height: number };
}

/**
 * Slot placement algorithm function signature.
 * All algorithms receive a PlacementContext and return positioned slots.
 */
export type PlacementAlgorithmFn = (ctx: PlacementContext) => PositionedSlot[];

/**
 * Registry of slot placement algorithm implementations.
 * Types has PLACEMENT_ALGORITHMS (string names); this maps names to functions.
 */
export const PLACEMENT_ALGORITHM_REGISTRY: Partial<
  Record<PlacementAlgorithm, PlacementAlgorithmFn>
> = {};

/**
 * Register a placement algorithm.
 */
export function registerPlacementAlgorithm(
  name: PlacementAlgorithm,
  fn: PlacementAlgorithmFn,
): void {
  PLACEMENT_ALGORITHM_REGISTRY[name] = fn;
}

/**
 * Get a placement algorithm by name.
 */
export function getPlacementAlgorithm(name: PlacementAlgorithm): PlacementAlgorithmFn | undefined {
  return PLACEMENT_ALGORITHM_REGISTRY[name];
}

// ============================================================================
// Algorithm Metadata (Default Tag Constraints)
// ============================================================================

/**
 * Static metadata for a placement algorithm.
 * Declares default tag constraints that merge with slot-level tags at generation time.
 * Algorithm functions stay pure geometry — no tag imports or logic.
 */
export interface PlacementAlgorithmMeta {
  /** Default required tags. Applied when slot has requiredTags: null (no opinion). */
  defaultRequiredTags: string[] | null;
  /** Default forbidden tags. Applied when slot has forbiddenTags: null (no opinion). */
  defaultForbiddenTags: string[] | null;
}

/** Registry of algorithm metadata (tag defaults). */
export const PLACEMENT_ALGORITHM_META: Partial<Record<PlacementAlgorithm, PlacementAlgorithmMeta>> =
  {};

/** Register metadata for a placement algorithm. */
export function registerPlacementAlgorithmMeta(
  name: PlacementAlgorithm,
  meta: PlacementAlgorithmMeta,
): void {
  PLACEMENT_ALGORITHM_META[name] = meta;
}

/** Get metadata for a placement algorithm. Undefined = no defaults registered. */
export function getPlacementAlgorithmMeta(
  name: PlacementAlgorithm,
): PlacementAlgorithmMeta | undefined {
  return PLACEMENT_ALGORITHM_META[name];
}
