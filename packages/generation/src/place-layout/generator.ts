/**
 * Place Layout Generator
 *
 * Entry point for the procedural generation system.
 * Orchestrates shape generation, slot placement, and object population.
 *
 * All slots come from the layout template — placement algorithms position them,
 * then the populator selects objects from the catalog for each slot.
 */

import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import {
  type PlaceLayout,
  type GenerationResult,
  type GenerationReuseInfo,
  type TilemapData,
  type Bounds,
  type GeneratedSlot,
  type BackdropSlot,
} from '@dmnpc/types/world';
import { type ObjectEntity } from '@dmnpc/types/entity';

import { detectContext } from './classifier.js';
import { generateShapeFromTemplate } from './layers/shape-generator.js';
import { populateSlots } from './layers/context-populator.js';
import { createObjectEntity } from './object-factory.js';
import { populateContainerContents } from './container-populator.js';
import {
  computeWorldPosition,
  resolveEntityLayerBySprite,
  getSpriteDefaultLayer,
  getEntityDefinition,
  getSpriteBoundingBox,
  getEntitiesByPurpose,
} from './object-catalog.js';
import { generateObjectDescriptions } from './ai-augment.js';
import { getLayoutTemplate, selectLayoutVariant } from './layout-templates.js';
import {
  getPlacementAlgorithm,
  getPlacementAlgorithmMeta,
  type PositionedSlot,
  type GeneratedShape,
  type PlacementContext,
} from './algorithms/index.js';
import { computeBackdropOffset } from './algorithms/shape-algorithms.js';
import { loadPurposeCategory } from '../purpose-loader.js';
import { validateFloorConnectivity } from './connectivity.js';

const TILE_SIZE_PX = 32;

/**
 * Resolve slot sizes for ALL slot categories.
 *
 * - place-category: derive from layout template sprite bounding box.
 *   Throws if template, sprite, or bbox is missing (no silent fallbacks).
 *   Also computes visualClearanceAbove from the full sprite height vs bbox.
 * - object/character-category: derive from getEntitiesByPurpose catalog sprites.
 *   Defaults to 1x1 when no catalog entries exist.
 *
 * Slots that already have an explicit slotSize are returned unchanged.
 */
export function resolveSlotSizes(
  slots: import('@dmnpc/types/world').LayoutSlot[],
): import('@dmnpc/types/world').LayoutSlot[] {
  return slots.map((slot) => {
    if (slot.slotSize) return slot;

    const category = loadPurposeCategory(slot.purpose);

    if (category === 'place') {
      const targetTemplate = getLayoutTemplate(slot.purpose);
      if (!targetTemplate) {
        throw new Error(
          `resolveSlotSizes: no layout template for place-category purpose "${slot.purpose}". ` +
            `Every place purpose needs a layout template in packages/data/entities/layouts/.`,
        );
      }
      if (!targetTemplate.spriteId) {
        throw new Error(
          `resolveSlotSizes: layout template for purpose "${slot.purpose}" has no spriteId.`,
        );
      }
      const bbox = getSpriteBoundingBox(targetTemplate.spriteId);
      if (!bbox) {
        throw new Error(
          `resolveSlotSizes: sprite "${targetTemplate.spriteId}" (purpose "${slot.purpose}") has no bounding box. ` +
            `Add a boundingBox to the sprite registry entry.`,
        );
      }

      const tileW = Math.ceil(bbox.width / TILE_SIZE_PX);
      const tileH = Math.ceil(bbox.height / TILE_SIZE_PX);

      // Compute visual clearance above the footprint.
      // The sprite may extend above the bounding box (e.g. a tall roof).
      // offsetY is the distance from the sprite top to the bbox top —
      // that's the visual region above the footprint.
      const visualClearanceAbove = bbox.offsetY > 0 ? Math.ceil(bbox.offsetY / TILE_SIZE_PX) : null;

      return {
        ...slot,
        slotSize: { width: tileW, height: tileH },
        visualClearanceAbove,
      };
    }

    try {
      const entities = getEntitiesByPurpose(
        slot.purpose,
        slot.requiredTags ?? undefined,
        slot.forbiddenTags ?? undefined,
      );
      if (entities.length === 0) {
        return { ...slot, slotSize: { width: 1, height: 1 } };
      }
      const maxW = Math.max(...entities.map((e) => e.width));
      const maxH = Math.max(...entities.map((e) => e.height));
      const tileW = Math.max(Math.ceil(maxW / TILE_SIZE_PX), 1);
      const tileH = Math.max(Math.ceil(maxH / TILE_SIZE_PX), 1);
      return { ...slot, slotSize: { width: tileW, height: tileH } };
    } catch {
      return { ...slot, slotSize: { width: 1, height: 1 } };
    }
  });
}

export interface GeneratePlaceLayoutParams {
  /** The place to generate a layout for */
  placeId: string;
  /** Optional seed for reproducibility */
  seed?: number;
  /** Skip AI augmentation (faster, for testing) */
  skipAugmentation?: boolean;
  /**
   * Existing objects in the place to reuse during regeneration.
   * Objects are matched to slots by purpose and repositioned.
   * Only unmatched slots trigger new object creation.
   */
  existingObjects?: ObjectEntity[];
  /**
   * Pre-computed place context (wealth, cleanliness, etc.).
   * When provided, skips the LLM-based context detection.
   * Use during regeneration to avoid unnecessary LLM calls.
   */
  existingContext?: import('@dmnpc/types/world').PlaceContext;
}

/**
 * Create a seeded random number generator.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

import type { LayoutVariant } from '@dmnpc/types/world';

/**
 * Merge two tag arrays into a deduplicated union. Returns null if the result is empty.
 * Used for combining inherited tags with slot-defined tags.
 */
export function mergeTagArrays(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
): string[] | null {
  const aArr = a ?? [];
  const bArr = b ?? [];
  if (aArr.length === 0 && bArr.length === 0) return null;
  const merged = [...new Set([...aArr, ...bArr])];
  return merged.length > 0 ? merged : null;
}

/**
 * Check whether an entity's tags satisfy a slot's requiredTags and forbiddenTags.
 * Same AND/NOR semantics as object-catalog's getEntitiesByPurpose.
 */
export function entityMatchesSlotTags(
  entityTags: string[],
  requiredTags?: string[] | null,
  forbiddenTags?: string[] | null,
): boolean {
  if (requiredTags && requiredTags.length > 0) {
    if (!requiredTags.every((tag) => entityTags.includes(tag))) return false;
  }
  if (forbiddenTags && forbiddenTags.length > 0) {
    if (forbiddenTags.some((tag) => entityTags.includes(tag))) return false;
  }
  return true;
}

/**
 * Convert PositionedSlot results to GeneratedSlot entries.
 * Extracted as a helper so both single-slot and grouped-slot paths share the same logic.
 */
function convertPositionedToGenerated(
  slotDef: import('@dmnpc/types/world').LayoutSlot,
  positioned: PositionedSlot[],
  inheritedRequiredTags: string[] | null | undefined,
  generatedSlots: GeneratedSlot[],
  slotOptional?: boolean[],
): void {
  const isOptional = (slotDef.min ?? 0) === 0;
  const algorithmName = slotDef.positionAlgorithm;
  for (const pos of positioned) {
    const purpose = slotDef.purpose;
    const category = loadPurposeCategory(purpose) ?? 'object';

    const algoMeta = getPlacementAlgorithmMeta(algorithmName);
    const baseRequired =
      slotDef.requiredTags !== null
        ? slotDef.requiredTags
        : (algoMeta?.defaultRequiredTags ?? null);
    const effectiveTags = mergeTagArrays(baseRequired, inheritedRequiredTags);
    const effectiveForbidden =
      slotDef.forbiddenTags !== null
        ? slotDef.forbiddenTags
        : (algoMeta?.defaultForbiddenTags ?? null);

    generatedSlots.push({
      purpose,
      category,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      facing: pos.facing,
      layer: pos.layer,
      ...(slotDef.flags.isStructural ? { isStructural: true } : {}),
      ...(effectiveTags ? { requiredTags: effectiveTags } : {}),
      ...(effectiveForbidden?.length ? { forbiddenTags: effectiveForbidden } : {}),
      ...(slotDef.inheritableTags ? { inheritableTags: slotDef.inheritableTags } : {}),
      ...(slotDef.flags.useLlmSelection ? { useLlmSelection: true } : {}),
      ...(algorithmName === 'against_wall' || algorithmName === 'in_wall'
        ? { facingConstrained: true }
        : {}),
    });
    slotOptional?.push(isOptional);
  }
}

/**
 * Place a group of slots via interleaved round-robin.
 * Each round places one instance per group member, so every placement sees
 * prior placements from ALL group members (not just the current slot type).
 * This produces better spatial coverage than sequential placement.
 *
 * Pure placement function — returns positioned slots tagged with their source
 * slot definition. Does not call loadPurposeCategory or produce GeneratedSlots.
 */
export function placeGroupedSlotsRoundRobin(
  groupSlots: import('@dmnpc/types/world').LayoutSlot[],
  shape: GeneratedShape,
  variant: LayoutVariant,
  seed: number,
  occupiedTiles: Set<string>,
  placedSlots: PositionedSlot[],
  placementBounds: { x: number; y: number; width: number; height: number },
): Array<{ slotDef: import('@dmnpc/types/world').LayoutSlot; positioned: PositionedSlot[] }> {
  const results: Array<{
    slotDef: import('@dmnpc/types/world').LayoutSlot;
    positioned: PositionedSlot[];
  }> = [];

  // requiredRemaining tracks how many of the original min are still needed —
  // once exhausted, subsequent placements use min=0 (optional).
  const members = groupSlots.map((slot) => ({
    slot,
    remaining: slot.max ?? 1,
    requiredRemaining: slot.min ?? 0,
  }));

  // Offset seed per round so each algorithm call gets a unique RNG sequence
  // (algorithms create a fresh RNG from seed on each call).
  let round = 0;
  let anyRemaining = true;
  while (anyRemaining) {
    anyRemaining = false;
    for (const member of members) {
      if (member.remaining <= 0) continue;
      anyRemaining = true;
      member.remaining--;

      const algorithm = getPlacementAlgorithm(member.slot.positionAlgorithm);
      if (!algorithm) {
        throw new Error(
          `Unknown placement algorithm: "${member.slot.positionAlgorithm}". Register it or fix the template.`,
        );
      }

      const isRequired = member.requiredRemaining > 0;
      if (isRequired) member.requiredRemaining--;
      const singleSlot: import('@dmnpc/types/world').LayoutSlot = {
        ...member.slot,
        min: isRequired ? 1 : 0,
        max: 1,
      };
      const ctx: PlacementContext = {
        shape,
        slots: [singleSlot],
        seed: seed + round * 7919,
        variant,
        occupiedTiles,
        placedSlots,
        placementBounds,
      };

      const positioned = algorithm(ctx);
      placedSlots.push(...positioned);
      results.push({ slotDef: member.slot, positioned });
    }
    round++;
  }

  return results;
}

/**
 * Generate positioned slots using placement algorithms.
 * Each slot declares its own positionAlgorithm (required).
 *
 * Slots with a `distributionGroup` are placed via interleaved round-robin
 * for better spatial coverage across all group members.
 */
function generatePositionedSlots(
  shape: GeneratedShape,
  variant: LayoutVariant,
  seed: number,
  occupiedTiles?: Set<string>,
  initialPlacedSlots?: PositionedSlot[],
  inheritedRequiredTags?: string[] | null,
): { slots: GeneratedSlot[]; optionalFlags: boolean[] } {
  // Shape itself stays unchanged so grid-iteration helpers work correctly;
  // only filterTilesForPlacement bounds checks use the padded rect.
  const padding = variant.padding ?? 0;
  const placementBounds = {
    x: shape.bounds.x + padding,
    y: shape.bounds.y + padding,
    width: shape.bounds.width - padding * 2,
    height: shape.bounds.height - padding * 2,
  };

  // Sort slots: in_wall first (doors reserve buffer zones before floor algos run,
  // BUG-064), under/on_surface last (rugs and surface items need to see the full
  // occupiedTiles/placedSlots set from all prior placements).
  const slotDefs = [...variant.slots].sort((a, b) => {
    const priority = (algo: string) => {
      if (algo === 'in_wall') return 0;
      if (algo === 'under' || algo === 'on_surface') return 2;
      return 1;
    };
    return priority(a.positionAlgorithm) - priority(b.positionAlgorithm);
  });
  const generatedSlots: GeneratedSlot[] = [];
  const slotOptional: boolean[] = [];

  // Accept external set so backdrop slots can share occupancy tracking
  if (!occupiedTiles) occupiedTiles = new Set<string>();
  // Seed with backdrop-resolved slots so near_slot can reference them.
  const placedSlots: PositionedSlot[] = initialPlacedSlots ? [...initialPlacedSlots] : [];

  const processedGroups = new Set<string>();

  for (const slotDef of slotDefs) {
    const group = slotDef.distributionGroup;

    if (!group) {
      // Ungrouped slot: process immediately (existing sequential behavior)
      const algorithmName = slotDef.positionAlgorithm;
      const algorithm = getPlacementAlgorithm(algorithmName);

      if (!algorithm) {
        throw new Error(
          `Unknown placement algorithm: "${algorithmName}". Register it or fix the template.`,
        );
      }

      const ctx: PlacementContext = {
        shape,
        slots: [slotDef],
        seed,
        variant,
        occupiedTiles,
        placedSlots,
        placementBounds,
      };

      const positioned: PositionedSlot[] = algorithm(ctx);
      placedSlots.push(...positioned);
      convertPositionedToGenerated(
        slotDef,
        positioned,
        inheritedRequiredTags,
        generatedSlots,
        slotOptional,
      );
      continue;
    }

    if (processedGroups.has(group)) {
      continue;
    }

    processedGroups.add(group);
    const groupMembers = slotDefs.filter((s) => s.distributionGroup === group);
    const groupResults = placeGroupedSlotsRoundRobin(
      groupMembers,
      shape,
      variant,
      seed,
      occupiedTiles,
      placedSlots,
      placementBounds,
    );
    for (const { slotDef, positioned } of groupResults) {
      convertPositionedToGenerated(
        slotDef,
        positioned,
        inheritedRequiredTags,
        generatedSlots,
        slotOptional,
      );
    }
  }

  logger.info('SlotGenerator', `Generated ${generatedSlots.length} positioned slots`);
  return { slots: generatedSlots, optionalFlags: slotOptional };
}

/**
 * Resolve slots defined on sprite_backdrop layers.
 * Picks N candidates from each backdrop slot's candidates array based on min/max/chance.
 * Shares the occupiedTiles set with variant slot resolution to prevent overlap.
 */
export function resolveBackdropSlots(
  backdropSlots: BackdropSlot[],
  seed: number,
  occupiedTiles: Set<string>,
  inheritedRequiredTags?: string[] | null,
): GeneratedSlot[] {
  const rng = createSeededRandom(seed + 7919); // Offset seed to avoid correlation with variant slots
  const generatedSlots: GeneratedSlot[] = [];

  for (const slotDef of backdropSlots) {
    if (slotDef.chance !== null && rng() > slotDef.chance) {
      continue;
    }

    if (slotDef.purposes.length === 0 || slotDef.candidates.length === 0) {
      continue;
    }

    const min = slotDef.min;
    const max = slotDef.max;
    const target = min + Math.floor(rng() * (max - min + 1));

    const shuffled = [...slotDef.candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let placed = 0;
    for (const candidate of shuffled) {
      if (placed >= target) break;

      const tileKeys: string[] = [];
      let occupied = false;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const key = `${candidate.x + dx},${candidate.y + dy}`;
          if (occupiedTiles.has(key)) {
            occupied = true;
            break;
          }
          tileKeys.push(key);
        }
        if (occupied) break;
      }
      if (occupied) continue;

      for (const key of tileKeys) {
        occupiedTiles.add(key);
      }

      const purposeIndex = Math.floor(rng() * slotDef.purposes.length);
      const purpose = slotDef.purposes[purposeIndex];
      const category = loadPurposeCategory(purpose) ?? 'object';

      const effectiveTags = mergeTagArrays(null, inheritedRequiredTags);

      generatedSlots.push({
        purpose,
        category,
        x: candidate.x,
        y: candidate.y,
        width: 1,
        height: 1,
        facing: candidate.facing ?? 'south',
        layer: 'default',
        ...(effectiveTags ? { requiredTags: effectiveTags } : {}),
        ...(slotDef.forbiddenTags ? { forbiddenTags: slotDef.forbiddenTags } : {}),
        ...(slotDef.inheritableTags ? { inheritableTags: slotDef.inheritableTags } : {}),
        ...(slotDef.flags.useLlmSelection ? { useLlmSelection: true } : {}),
      });

      placed++;
    }
  }

  return generatedSlots;
}

/**
 * Compute the footprint tile coordinates for a multi-tile building slot.
 * (slot.x, slot.y) is the top-left tile of the occupancy block — the same
 * convention used by placement algorithms' occupy() and filterTilesForPlacement().
 * The footprint extends right by slot.width and down by slot.height.
 */
function getBuildingFootprint(
  slot: GeneratedSlot,
  boundsWidth: number,
  boundsHeight: number,
): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < slot.height; dy++) {
    for (let dx = 0; dx < slot.width; dx++) {
      const tx = slot.x + dx;
      const ty = slot.y + dy;
      if (tx >= 0 && tx < boundsWidth && ty >= 0 && ty < boundsHeight) {
        tiles.push({ x: tx, y: ty });
      }
    }
  }
  return tiles;
}

/**
 * Stamp multi-tile building footprints into the blocked mask.
 * Only applies to place-category slots with width or height > 1.
 */
function stampBuildingFootprints(generatedSlots: GeneratedSlot[], shape: GeneratedShape): void {
  let count = 0;
  for (const slot of generatedSlots) {
    if (slot.category !== 'place') continue;
    if (slot.width <= 1 && slot.height <= 1) continue;
    for (const { x, y } of getBuildingFootprint(slot, shape.bounds.width, shape.bounds.height)) {
      shape.blockedMask[y][x] = true;
      count++;
    }
  }
  if (count > 0) {
    logger.info('PlaceLayoutGenerator', `Blocked ${count} tiles for building footprints`);
  }
}

/**
 * Compute the occupied tile keys for a slot (matching placement algorithm occupancy).
 * For single-tile slots: the slot's (x, y) tile.
 * For multi-tile building footprints: uses origin-aware mapping.
 */
function getSlotOccupiedKeys(
  slot: GeneratedSlot,
  boundsWidth: number,
  boundsHeight: number,
): string[] {
  if (slot.category === 'place' && (slot.width > 1 || slot.height > 1)) {
    return getBuildingFootprint(slot, boundsWidth, boundsHeight).map((t) => `${t.x},${t.y}`);
  }
  return [`${slot.x},${slot.y}`];
}

/**
 * Validate floor connectivity and prune optional slots if placement created
 * disconnected walkable regions.
 *
 * After all slots are placed and building footprints stamped, runs a flood-fill
 * connectivity check. If the floor is disconnected:
 * 1. Iterates through optional slots in reverse placement order (last placed first)
 * 2. Removes each optional slot, undoing its occupancy and blocked mask entries
 * 3. Re-checks connectivity after each removal
 * 4. Stops as soon as connectivity is restored
 * 5. If still disconnected after removing all optional slots, throws
 *
 * Mutates generatedSlots (splices out pruned entries), slotOptional (splices in parallel),
 * shape.blockedMask (clears unblocked tiles), and occupiedTiles (removes keys).
 */
export function pruneForConnectivity(
  generatedSlots: GeneratedSlot[],
  slotOptional: boolean[],
  shape: GeneratedShape,
  occupiedTiles: Set<string>,
  baselineConnected?: boolean,
): void {
  if (shape.blockedMask.length === 0) return;

  const { width, height } = shape.bounds;

  // Skip when the base terrain (before slot placement and building footprints)
  // is already fragmented. Outdoor layouts (forests, towns with trees/rocks)
  // naturally have disconnected walkable regions from terrain generation.
  // Only enforce connectivity when the terrain itself provides a connected floor.
  if (baselineConnected === false) return;

  let result = validateFloorConnectivity(shape.blockedMask, occupiedTiles, width, height);

  if (result.connected) return;

  logger.info(
    'PlaceLayoutGenerator',
    `Floor disconnected: ${result.componentCount} components. Pruning optional slots...`,
  );

  let pruned = 0;

  for (let i = generatedSlots.length - 1; i >= 0; i--) {
    if (!slotOptional[i]) continue;

    const slot = generatedSlots[i];

    for (const key of getSlotOccupiedKeys(slot, width, height)) {
      occupiedTiles.delete(key);
    }

    if (slot.category === 'place' && (slot.width > 1 || slot.height > 1)) {
      for (const { x, y } of getBuildingFootprint(slot, width, height)) {
        shape.blockedMask[y][x] = false;
      }
    }

    generatedSlots.splice(i, 1);
    slotOptional.splice(i, 1);
    pruned++;

    result = validateFloorConnectivity(shape.blockedMask, occupiedTiles, width, height);
    if (result.connected) {
      logger.info(
        'PlaceLayoutGenerator',
        `Floor connectivity restored after pruning ${pruned} optional slot(s)`,
      );
      return;
    }
  }

  throw new Error(
    `Floor connectivity cannot be restored: ${result.componentCount} disconnected regions ` +
      `remain after removing all ${pruned} optional slot(s). ` +
      `Required slots partition the floor. Fix the layout template.`,
  );
}

/**
 * Generate a complete layout for a place.
 *
 * 1. Shape Generation - Create room outline, walls, floor tiles
 * 2. Slot Placement - Position slots from the layout template using placement algorithms
 * 3. Object Population - Select objects from the catalog for each slot
 *
 * @param ctx Universe context for entity lookups and storage
 * @param params Generation parameters
 * @returns Generated layout and object entities
 */
export async function generatePlaceLayout(
  ctx: UniverseContext,
  params: GeneratePlaceLayoutParams,
): Promise<GenerationResult> {
  const { placeId, seed, skipAugmentation, existingObjects, existingContext } = params;
  // BUG-121: Capture actual seed (including Date.now() fallback) so it is
  // always logged and can be used to reproduce failures deterministically.
  const actualSeed = seed ?? Date.now();

  logger.info(
    'PlaceLayoutGenerator',
    `Starting layout generation for ${placeId} (seed: ${actualSeed})`,
  );

  const place = ctx.getPlace(placeId);

  const purpose = place.info.purpose;
  const context = existingContext ?? (await detectContext(place));

  logger.info(
    'PlaceLayoutGenerator',
    `Using purpose=${purpose} (wealth: ${context.wealth}, cleanliness: ${context.cleanliness})`,
  );

  logger.info('PlaceLayoutGenerator', 'Layer 1: Generating shape...');

  const layoutTemplate = getLayoutTemplate(purpose);
  if (!layoutTemplate) {
    throw new Error(
      `No layout template found for purpose="${purpose}". Add a template to packages/data/entities/layouts/.`,
    );
  }
  const layoutVariant = selectLayoutVariant(layoutTemplate, actualSeed);

  const shape = generateShapeFromTemplate(layoutVariant, 0, 0, actualSeed);

  logger.info(
    'PlaceLayoutGenerator',
    `Shape generated: ${shape.bounds.width}x${shape.bounds.height} tiles`,
  );

  logger.info('PlaceLayoutGenerator', 'Layer 2: Generating positioned slots...');

  const occupiedTiles = new Set<string>();
  const generatedSlots: GeneratedSlot[] = [];

  // Backdrop slot coordinates are in sprite-local space — offset them to layout grid space.
  const backdropSlots: BackdropSlot[] = [];
  let backdropOffsetCol = 0;
  let backdropOffsetRow = 0;
  for (const layerConfig of layoutVariant.terrainLayers) {
    if (layerConfig.type === 'sprite_backdrop') {
      const backdropConfig = layerConfig;
      if (
        backdropConfig.slots &&
        backdropConfig.gridWidth !== null &&
        backdropConfig.gridHeight !== null
      ) {
        const offset = computeBackdropOffset(
          backdropConfig.anchorX,
          backdropConfig.anchorY,
          backdropConfig.gridWidth,
          backdropConfig.gridHeight,
          shape.bounds.width,
          shape.bounds.height,
        );
        backdropOffsetCol = offset.offsetCol;
        backdropOffsetRow = offset.offsetRow;
        for (const slot of backdropConfig.slots) {
          backdropSlots.push({
            ...slot,
            candidates: slot.candidates.map((c) => ({
              ...c,
              x: c.x + backdropOffsetCol,
              y: c.y + backdropOffsetRow,
            })),
          });
        }
      }
    }
  }

  const backdropPlacedSlots: PositionedSlot[] = [];
  if (backdropSlots.length > 0) {
    const backdropResolved = resolveBackdropSlots(
      backdropSlots,
      actualSeed,
      occupiedTiles,
      place.info.inheritedRequiredTags,
    );
    generatedSlots.push(...backdropResolved);
    for (const slot of backdropResolved) {
      backdropPlacedSlots.push({
        slot: {
          purpose: slot.purpose,
          positionAlgorithm: 'random',
          distribution: 'random',
          requiredTags: null,
          forbiddenTags: null,
          inheritableTags: null,
          min: 1,
          max: 1,
          nearPurpose: null,
          slotSize: null,
          visualClearanceAbove: null,
          preferDistrict: null,
          distributionGroup: null,
          flags: { isStructural: false, facesAnchor: false, useLlmSelection: false },
        },
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        facing: slot.facing,
        layer: slot.layer,
      });
    }
    logger.info(
      'PlaceLayoutGenerator',
      `Resolved ${backdropResolved.length} backdrop slots from ${backdropSlots.length} definitions`,
    );
  }

  const resolvedVariant: typeof layoutVariant = {
    ...layoutVariant,
    slots: resolveSlotSizes(layoutVariant.slots),
  };

  // If the terrain is already fragmented (forests, towns with scattered blocking),
  // slot pruning won't help — skip connectivity enforcement for those layouts.
  const baselineConnected =
    shape.blockedMask.length > 0
      ? validateFloorConnectivity(
          shape.blockedMask,
          new Set(),
          shape.bounds.width,
          shape.bounds.height,
        ).connected
      : true;

  const backdropSlotCount = generatedSlots.length;
  const preVariantOccupied = new Set(occupiedTiles);
  const preVariantBlocked = shape.blockedMask.map((row) => [...row]);

  // Retry loop: if slot placement or connectivity fails, re-run with a new seed.
  // BUG-121: generatePositionedSlots is now inside the try-catch so required-slot
  // placement failures (against_wall / in_wall exhaustion) also trigger retry,
  // not just pruneForConnectivity failures.
  const maxPlacementAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxPlacementAttempts; attempt++) {
    // Restore pre-variant state on retry
    if (attempt > 0) {
      generatedSlots.length = backdropSlotCount;
      occupiedTiles.clear();
      for (const key of preVariantOccupied) occupiedTiles.add(key);
      for (let y = 0; y < preVariantBlocked.length; y++) {
        for (let x = 0; x < preVariantBlocked[y].length; x++) {
          shape.blockedMask[y][x] = preVariantBlocked[y][x];
        }
      }
      logger.info(
        'PlaceLayoutGenerator',
        `Placement retry ${attempt}/${maxPlacementAttempts - 1}: re-running slot placement with new seed`,
      );
    }

    try {
      const variantResult = generatePositionedSlots(
        shape,
        resolvedVariant,
        actualSeed + attempt,
        occupiedTiles,
        backdropPlacedSlots,
        place.info.inheritedRequiredTags,
      );
      generatedSlots.push(...variantResult.slots);

      // Backdrop slots are never pruned (fixed position from sprite definitions).
      // Variant slots carry optionality from their source LayoutSlot.min field.
      const slotOptional: boolean[] = [
        ...new Array<boolean>(backdropSlotCount).fill(false),
        ...variantResult.optionalFlags,
      ];

      stampBuildingFootprints(generatedSlots, shape);

      pruneForConnectivity(generatedSlots, slotOptional, shape, occupiedTiles, baselineConnected);
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (lastError) {
    throw new Error(`${lastError.message} (after ${maxPlacementAttempts} placement attempts)`);
  }

  const purposeCounts: Record<string, number> = {};
  for (const slot of generatedSlots) {
    purposeCounts[slot.purpose] = (purposeCounts[slot.purpose] || 0) + 1;
  }
  logger.info(
    'PlaceLayoutGenerator',
    `Generated ${generatedSlots.length} slots: ${JSON.stringify(purposeCounts)}`,
  );

  const tileSize = 32; // All tilesets (interior, blob47) are 32px

  const nonEntitySlots = generatedSlots.filter((s) => s.category !== 'character');
  const reservedSlotCount = generatedSlots.length - nonEntitySlots.length;

  if (reservedSlotCount > 0) {
    logger.info(
      'PlaceLayoutGenerator',
      `${reservedSlotCount} character slot(s) reserved for population`,
    );
  }

  const objectPool = new Map<string, ObjectEntity[]>();
  for (const obj of existingObjects ?? []) {
    const objPurpose = obj.info.purpose;
    if (!objectPool.has(objPurpose)) objectPool.set(objPurpose, []);
    objectPool.get(objPurpose)!.push(obj);
  }

  const childPlacePool = new Map<string, import('@dmnpc/types/entity').Place[]>();
  for (const child of ctx.getChildPlaces(place.id)) {
    const childPurpose = child.info.purpose;
    if (!childPlacePool.has(childPurpose)) childPlacePool.set(childPurpose, []);
    childPlacePool.get(childPurpose)!.push(child);
  }

  const reusedEntities: Array<{
    id: string;
    objectTypeId: string;
    position: { x: number; y: number };
    material: string | null;
    tint: number | null;
    description: string | null;
  }> = [];
  const unmatchedSlots: GeneratedSlot[] = [];

  const matchedObjectIds: string[] = [];
  const matchedPlaceIds: string[] = [];
  const unfilledPlaceSlots: GeneratedSlot[] = [];

  for (const slot of nonEntitySlots) {
    const pool = objectPool.get(slot.purpose);
    const matchIndex = pool
      ? pool.findIndex((obj) =>
          entityMatchesSlotTags(obj.tags, slot.requiredTags, slot.forbiddenTags),
        )
      : -1;
    if (pool && matchIndex >= 0) {
      const reused = pool.splice(matchIndex, 1)[0];
      const spriteId = reused.info.spriteConfig.spriteId;
      const worldPos = computeWorldPosition(slot.x, slot.y, slot.width, slot.height);
      reused.position.x = worldPos.x;
      reused.position.y = worldPos.y;
      reused.info.spriteConfig.facing = slot.facing;
      reused.info.layer = resolveEntityLayerBySprite(reused.info.purpose, spriteId, slot.layer);
      ctx.upsertEntity('object', reused);
      matchedObjectIds.push(reused.id);
      reusedEntities.push({
        id: reused.id,
        objectTypeId: reused.info.spriteConfig.spriteId ?? reused.info.purpose,
        position: { x: slot.x, y: slot.y },
        material: reused.info.material,
        tint: reused.info.tint,
        description: reused.description,
      });
      continue;
    }

    const childPool = childPlacePool.get(slot.purpose);
    if (childPool && childPool.length > 0) {
      const child = childPool.shift()!;
      const childSpriteId = child.info.spriteConfig.spriteId;
      if (!childSpriteId) {
        throw new Error(
          `Child place "${child.id}" (purpose: ${child.info.purpose}) has no spriteId. Every place must have a sprite.`,
        );
      }
      const childPos = computeWorldPosition(slot.x, slot.y, slot.width, slot.height);
      child.position.x = childPos.x;
      child.position.y = childPos.y;
      child.info.spriteConfig.facing = slot.facing;
      child.info.spriteConfig.layer = getSpriteDefaultLayer(childSpriteId) ?? slot.layer;
      ctx.upsertEntity('place', child);
      matchedPlaceIds.push(child.id);
      logger.info(
        'PlaceLayoutGenerator',
        `Repositioned child place ${child.id} to slot (${slot.x}, ${slot.y})`,
      );
      continue;
    }

    if (slot.category === 'place') {
      unfilledPlaceSlots.push(slot);
      continue;
    }

    unmatchedSlots.push(slot);
  }

  if (reusedEntities.length > 0) {
    logger.info(
      'PlaceLayoutGenerator',
      `Reused ${reusedEntities.length} existing objects, ${unmatchedSlots.length} slots need new objects`,
    );
  }

  logger.info('PlaceLayoutGenerator', 'Layer 3: Populating slots...');
  const placedObjects = await populateSlots(unmatchedSlots, place, context, purpose, {
    seed: actualSeed,
  });

  logger.info('PlaceLayoutGenerator', `Populated ${placedObjects.length} new objects`);

  logger.info('PlaceLayoutGenerator', 'Creating object entities...');
  const newObjectEntities: Array<{
    id: string;
    objectTypeId: string;
    position: { x: number; y: number };
    material: string | null;
    tint: number | null;
    description: string | null;
  }> = [];

  const containerRng = createSeededRandom(actualSeed + 31337);
  for (const placedObj of placedObjects) {
    const entity = createObjectEntity(place, placedObj, ctx);

    const entityDef = getEntityDefinition(placedObj.objectTypeId);
    if (entityDef && 'canContain' in entityDef && entityDef.canContain) {
      const contents = populateContainerContents(purpose, context, containerRng);
      if (contents.length > 0) {
        entity.info.contents = contents;
        ctx.upsertEntity('object', entity);
      }
    }

    newObjectEntities.push({
      id: entity.id,
      objectTypeId: placedObj.objectTypeId,
      position: placedObj.position,
      material: placedObj.material ?? null,
      tint: placedObj.tint ?? null,
      description: null,
    });
  }

  // Combine reused + new
  const objectEntities = [...reusedEntities, ...newObjectEntities];

  // Step 5: AI augmentation (generate unique descriptions for NEW objects only)
  if (!skipAugmentation && newObjectEntities.length > 0) {
    logger.info('PlaceLayoutGenerator', 'Generating object descriptions...');
    const objectsForDesc = newObjectEntities.map((e) => ({
      ...e,
      material: e.material ?? undefined,
      tint: e.tint ?? undefined,
      description: e.description ?? undefined,
    }));
    const descriptions = await generateObjectDescriptions(place, objectsForDesc, context);

    // Update descriptions in newObjectEntities (which are also in objectEntities by reference)
    for (let i = 0; i < newObjectEntities.length; i++) {
      if (descriptions[i]) {
        newObjectEntities[i].description = descriptions[i] ?? null;
      }
    }
  }

  // Build tilemap data
  // (tileSize already defined above for object position conversion)

  // Layers come directly from the shape algorithm (sorted by depth)
  // Build layer-id lookups from the variant's terrain layer configs
  const layerTypeMap = new Map<string, string>();
  const layerProceduralMap = new Map<string, boolean>();
  const layerTerrainMap = new Map<string, string>();
  const layerConfigMap = new Map<string, (typeof layoutVariant.terrainLayers)[number]>();
  for (const layerConfig of layoutVariant.terrainLayers) {
    layerTypeMap.set(layerConfig.id, layerConfig.type);
    layerProceduralMap.set(layerConfig.id, layerConfig.procedural);
    layerTerrainMap.set(layerConfig.id, layerConfig.terrain);
    layerConfigMap.set(layerConfig.id, layerConfig);
  }

  // Automatic north-facing wall overhead layers (generated by processLayers)
  // use a synthetic ID convention: `{wallLayerId}__north_overhead`. Map them
  // to 'land' terrain so the tiles are passable at runtime.
  for (const layer of shape.layers) {
    if (!layer.id.endsWith('__north_overhead')) continue;
    layerTypeMap.set(layer.id, 'wall');
    layerProceduralMap.set(layer.id, false);
    layerTerrainMap.set(layer.id, 'land');
  }

  const tilemapLayers: TilemapData['layers'] = [];

  if (shape.layers.length > 0) {
    const sortedLayers = [...shape.layers].sort((a, b) => a.depth - b.depth);
    for (const layer of sortedLayers) {
      const config = layerConfigMap.get(layer.id);
      tilemapLayers.push({
        name: layer.id,
        type: layerTypeMap.get(layer.id) ?? 'fill',
        procedural: layerProceduralMap.get(layer.id) ?? false,
        depth: layer.depth,
        data: layer.tiles,
        tilesetId: layer.tilesetId,
        tilesetOffset: layer.tilesetOffset,
        anchorX: config?.type === 'sprite_backdrop' ? config.anchorX : null,
        anchorY: config?.type === 'sprite_backdrop' ? config.anchorY : null,
        animationFrames: config?.type === 'animated_overlay' ? config.frames : null,
        animationTickMs: config?.type === 'animated_overlay' ? config.tickMs : null,
        animationDensity: config?.type === 'animated_overlay' ? config.density : null,
        inheritable: config?.inheritable ?? false,
      });
    }
    logger.info(
      'PlaceLayoutGenerator',
      `Created ${sortedLayers.length} layers: ${sortedLayers.map((l) => l.id).join(', ')}`,
    );
  }

  const tilemap: TilemapData = {
    tileSize,
    width: shape.bounds.width,
    height: shape.bounds.height,
    layers: tilemapLayers,
  };

  // Build bounds in world pixels
  const bounds: Bounds = {
    x: 0,
    y: 0,
    width: shape.bounds.width * tileSize,
    height: shape.bounds.height * tileSize,
  };

  // Build terrain-tag grid for runtime movement.
  // Maps layer IDs (from shape.terrainGrid) to terrain tags (from layer configs).
  // Null when the layout has no terrain layers.
  let terrainGrid: string[][] | null = null;
  if (shape.terrainGrid && layerTerrainMap.size > 0) {
    terrainGrid = shape.terrainGrid.map((row) =>
      row.map((layerId) => layerTerrainMap.get(layerId) ?? 'void'),
    );
    logger.info(
      'PlaceLayoutGenerator',
      `Built terrainGrid (${terrainGrid.length}x${terrainGrid[0]?.length ?? 0})`,
    );

    // Stamp building footprints into terrainGrid so they are impassable at runtime.
    // blockedMask already marks these tiles, but terrainGrid is the data structure
    // that drives both client and server movement at runtime.
    let terrainBlockedCount = 0;
    for (const slot of generatedSlots) {
      if (slot.category !== 'place') continue;
      if (slot.width <= 1 && slot.height <= 1) continue;
      for (const { x, y } of getBuildingFootprint(slot, shape.bounds.width, shape.bounds.height)) {
        terrainGrid[y][x] = 'wall';
        terrainBlockedCount++;
      }
    }
    if (terrainBlockedCount > 0) {
      logger.info(
        'PlaceLayoutGenerator',
        `Stamped ${terrainBlockedCount} building footprint tiles as 'wall' in terrainGrid`,
      );
    }
  }

  // Build layout (tiles only - objects are loaded from entity files at runtime)
  // Exit objects are created like any other object via context-populator
  const layout: PlaceLayout = {
    placeId,
    tilemap,
    bounds,
    slots: generatedSlots,
    terrainGrid,
    purpose,
    context,
    seed: actualSeed,
    generatedAt: new Date().toISOString(),
    characterScale: layoutTemplate.characterScale,
  };

  logger.info(
    'PlaceLayoutGenerator',
    `Layout generation complete for ${placeId}: purpose=${purpose}, objects=${objectEntities.length}`,
  );

  // Build reuse metadata when existing entities were provided (regeneration path)
  let reuse: GenerationReuseInfo | undefined;
  if (existingObjects) {
    const orphanedObjectIds: string[] = [];
    for (const [, remaining] of objectPool) {
      for (const obj of remaining) orphanedObjectIds.push(obj.id);
    }
    const orphanedPlaceIds: string[] = [];
    for (const [, remaining] of childPlacePool) {
      for (const child of remaining) orphanedPlaceIds.push(child.id);
    }
    reuse = {
      matchedObjectIds,
      matchedPlaceIds,
      orphanedObjectIds,
      orphanedPlaceIds,
      unfilledPlaceSlots,
    };
    logger.info(
      'PlaceLayoutGenerator',
      `Reuse summary: ${matchedObjectIds.length} objects matched, ${matchedPlaceIds.length} places matched, ${orphanedObjectIds.length} orphaned objects, ${orphanedPlaceIds.length} orphaned places, ${unfilledPlaceSlots.length} unfilled place slots`,
    );
  }

  return {
    layout,
    objectEntities,
    reuse,
  };
}

// ============================================================================
// Helpers
// ============================================================================
