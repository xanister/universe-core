/**
 * Slot Character Populator
 *
 * Phase 2 of the two-phase generation architecture.
 * Walks a place hierarchy, reads layouts, and generates characters
 * for character-category slots.
 *
 * Called AFTER the full place subtree is generated so that home
 * resolution has the complete hierarchy available.
 */

import { logger } from '@dmnpc/core/infra/logger.js';
import { runWithConcurrency } from '@dmnpc/core/infra/concurrency.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { loadPlaceLayout } from '@dmnpc/core/universe/universe-store.js';
import { findNearestPassablePosition } from '@dmnpc/types/world';
import type { Character } from '@dmnpc/types/entity';
import type { CharacterRoutine } from '@dmnpc/types/npc';
import type {
  GeneratedSlot,
  PlaceLayout,
  PlaceNeed,
  PurposeDefinition,
  UnfilledSlotInfo,
} from '@dmnpc/types/world';

import { generateCharacter } from '../character-generator.js';
import { loadPurposeDefinition } from '../purpose-loader.js';
import { buildSlotRoutine } from './slot-routine-builder.js';
import { buildVesselRoutes } from '../place/vessel-route-builder.js';

// ============================================================================
// Home Resolution
// ============================================================================

/**
 * Resolve the home place for a slot-spawned character.
 *
 * Resolution order when preferOnSiteQuarters=true:
 * 1. Work place's bedroom children (depth 1): children with sleeping objects
 * 2. Work place's bedroom grandchildren (depth 2): children's children with sleeping objects
 * 3. Sibling residences' bedroom children (depth 2): siblings' children with sleeping objects
 * 4. Any sibling with sleeping objects
 * 5. Return null
 *
 * Resolution order when preferOnSiteQuarters=false:
 * 1. Sibling residences' bedroom children (depth 2): siblings' children with sleeping objects
 * 2. Any sibling with sleeping objects
 * 3. Return null
 *
 * Returns null when no valid home is found — never silently assigns a place without beds.
 */
export function resolveHome(
  ctx: UniverseContext,
  spawnPlaceId: string,
  preferOnSiteQuarters: boolean,
): string | null {
  if (preferOnSiteQuarters) {
    // 1. Work place's bedroom children (depth 1): children with sleeping objects
    const children = ctx.getChildPlaces(spawnPlaceId);
    for (const child of children) {
      const childObjects = ctx.getObjectsByPlace(child.id);
      if (childObjects.some((o) => o.info.purpose === 'sleeping')) {
        return child.id;
      }
    }

    // 2. Work place's bedroom grandchildren (depth 2): children's children with sleeping objects
    for (const child of children) {
      const grandchildren = ctx.getChildPlaces(child.id);
      for (const grandchild of grandchildren) {
        const gcObjects = ctx.getObjectsByPlace(grandchild.id);
        if (gcObjects.some((o) => o.info.purpose === 'sleeping')) {
          return grandchild.id;
        }
      }
    }
  }

  // 3 (preferOnSiteQuarters=true) / 1 (preferOnSiteQuarters=false):
  // Sibling residences' bedroom children (depth 2): siblings' children with sleeping objects
  const spawnPlace = ctx.findPlace(spawnPlaceId);
  if (spawnPlace?.position.parent) {
    const siblings = ctx.getChildPlaces(spawnPlace.position.parent);

    for (const sibling of siblings) {
      if (sibling.id === spawnPlaceId) continue;
      const sibChildren = ctx.getChildPlaces(sibling.id);
      for (const sibChild of sibChildren) {
        const sibChildObjects = ctx.getObjectsByPlace(sibChild.id);
        if (sibChildObjects.some((o) => o.info.purpose === 'sleeping')) {
          return sibChild.id;
        }
      }
    }

    // 4 (preferOnSiteQuarters=true) / 2 (preferOnSiteQuarters=false):
    // Any sibling with sleeping objects
    for (const sibling of siblings) {
      if (sibling.id === spawnPlaceId) continue;
      const sibObjects = ctx.getObjectsByPlace(sibling.id);
      if (sibObjects.some((o) => o.info.purpose === 'sleeping')) {
        return sibling.id;
      }
    }
  }

  // No valid home found
  return null;
}

// ============================================================================
// Leisure Resolution
// ============================================================================

/**
 * Resolve the leisure venue for a slot-spawned character.
 *
 * Reads `purposeDef.defaultLeisureTagIds` and scans sibling places for
 * a venue matching those tags. Only runs for characters whose schedule
 * contains a 'leisure' period.
 *
 * @returns Leisure config to patch onto the routine, or null if not applicable
 */
export function resolveLeisure(
  ctx: UniverseContext,
  schedule: CharacterRoutine['schedule'],
  purposeDef: PurposeDefinition,
  spawnPlaceId: string,
): CharacterRoutine['leisure'] {
  // Only resolve for characters with a leisure period in their schedule
  const hasLeisurePeriod = Object.values(schedule).includes('leisure');
  if (!hasLeisurePeriod) return null;

  const defaultLeisureTagIds = purposeDef.defaultLeisureTagIds;
  if (!defaultLeisureTagIds || defaultLeisureTagIds.length === 0) return null;

  // Get sibling places (other children of the same parent)
  const spawnPlace = ctx.findPlace(spawnPlaceId);
  if (!spawnPlace?.position.parent) {
    return { favoriteSpot: null, preferredTagIds: defaultLeisureTagIds };
  }

  const siblings = ctx.getChildPlaces(spawnPlace.position.parent);
  const matches = siblings.filter((sibling) => {
    if (sibling.id === spawnPlaceId) return false;
    return sibling.tags.some((tag) => defaultLeisureTagIds.includes(tag));
  });

  if (matches.length === 0) {
    return { favoriteSpot: null, preferredTagIds: defaultLeisureTagIds };
  }

  // If multiple matches, prefer the venue with the most seating objects
  let bestMatch = matches[0];
  if (matches.length > 1) {
    let maxSeating = -1;
    for (const match of matches) {
      const objects = ctx.getObjectsByPlace(match.id);
      const seatingCount = objects.filter((o) => o.info.purpose === 'seating').length;
      if (seatingCount > maxSeating) {
        maxSeating = seatingCount;
        bestMatch = match;
      }
    }
  }

  return {
    favoriteSpot: {
      placeId: bestMatch.id,
      description: bestMatch.label,
      areaHint: null,
    },
    preferredTagIds: defaultLeisureTagIds,
  };
}

// ============================================================================
// Bed and Workspace Assignment (FEAT-444)
// ============================================================================

/**
 * Assign beds to a batch of newly generated characters.
 *
 * For each character with a resolved home place, finds the first unclaimed
 * sleeping object in that place and sets `character.info.assignedBedId`.
 * Pre-seeds the claimed set from existing characters to avoid stealing
 * already-assigned beds during refill passes.
 *
 * Must run after `runWithConcurrency` resolves — never inside per-slot
 * task lambdas — so the claim set is not raced by concurrent tasks.
 */
export function assignBeds(ctx: UniverseContext, characters: Character[]): void {
  const claimedBedIds = new Set<string>();

  // Pre-seed from existing characters so refill passes don't steal assigned beds
  for (const existing of ctx.characters) {
    if (existing.info.assignedBedId) {
      claimedBedIds.add(existing.info.assignedBedId);
    }
  }

  for (const character of characters) {
    const homePlaceId = character.info.routine?.home.placeId;
    if (!homePlaceId) continue;

    const sleepingObjects = ctx
      .getObjectsByPlace(homePlaceId)
      .filter((o) => o.info.purpose === 'sleeping');

    const unclaimed = sleepingObjects.find((o) => !claimedBedIds.has(o.id));
    if (unclaimed) {
      character.info.assignedBedId = unclaimed.id;
      claimedBedIds.add(unclaimed.id);
      ctx.upsertEntity('character', character);
    }
  }
}

/**
 * Assign workspaces to a batch of newly generated characters.
 *
 * For each character with a resolved work place and a `defaultWorkspacePurpose`
 * on their purpose definition, finds the first unclaimed object of that purpose
 * in the work place and sets `character.info.assignedWorkspaceId`.
 * Pre-seeds the claimed set from existing characters for refill safety.
 *
 * Must run after `runWithConcurrency` resolves — never inside per-slot
 * task lambdas — so the claim set is not raced by concurrent tasks.
 */
export function assignWorkspaces(ctx: UniverseContext, characters: Character[]): void {
  const claimedWorkspaceIds = new Set<string>();

  // Pre-seed from existing characters so refill passes don't steal assigned workspaces
  for (const existing of ctx.characters) {
    if (existing.info.assignedWorkspaceId) {
      claimedWorkspaceIds.add(existing.info.assignedWorkspaceId);
    }
  }

  for (const character of characters) {
    const workPlaceId = character.info.routine?.work?.placeId;
    if (!workPlaceId) continue;

    const purposeDef = loadPurposeDefinition(character.info.purpose);
    if (!purposeDef?.defaultWorkspacePurpose) continue;

    const workspacePurpose = purposeDef.defaultWorkspacePurpose;
    const workObjects = ctx
      .getObjectsByPlace(workPlaceId)
      .filter((o) => o.info.purpose === workspacePurpose);

    const unclaimed = workObjects.find((o) => !claimedWorkspaceIds.has(o.id));
    if (unclaimed) {
      character.info.assignedWorkspaceId = unclaimed.id;
      character.info.assignedWorkspacePurpose = workspacePurpose;
      claimedWorkspaceIds.add(unclaimed.id);
      ctx.upsertEntity('character', character);
    }
  }
}

// ============================================================================
// Character Slot Filter
// ============================================================================

/**
 * Extract character-category slots from a layout.
 */
export function getCharacterSlots(layout: PlaceLayout): GeneratedSlot[] {
  return layout.slots.filter((s) => s.category === 'character');
}

// ============================================================================
// Unfilled Slot Detection
// ============================================================================

/**
 * Detect character slots that have no matching character at a place.
 *
 * Compares the layout's character slots against existing non-player characters
 * at the place, matching by purpose. Returns only slots that need new characters.
 *
 * @param ctx Universe context for data access
 * @param placeId Place to check for unfilled slots
 * @returns Unfilled slots with their place ID, or empty array if all filled / no layout
 */
export async function detectUnfilledSlots(
  ctx: UniverseContext,
  placeId: string,
): Promise<UnfilledSlotInfo[]> {
  const layout = await loadPlaceLayout(ctx.universeId, placeId);
  if (!layout) return [];

  const characterSlots = getCharacterSlots(layout);
  if (characterSlots.length === 0) return [];

  const existingChars = ctx.characters.filter(
    (c) => c.position.parent === placeId && !c.info.isPlayer,
  );

  // Build pool of existing characters keyed by purpose
  const charPool = new Map<string, number>();
  for (const ch of existingChars) {
    charPool.set(ch.info.purpose, (charPool.get(ch.info.purpose) ?? 0) + 1);
  }

  const unfilled: UnfilledSlotInfo[] = [];

  for (const slot of characterSlots) {
    const available = charPool.get(slot.purpose) ?? 0;
    if (available > 0) {
      charPool.set(slot.purpose, available - 1);
    } else {
      unfilled.push({ slot, placeId });
    }
  }

  return unfilled;
}

// ============================================================================
// Main Populator
// ============================================================================

/**
 * Generate characters for specific slots at a single place.
 *
 * Unlike `populateSlotCharacters`, this does NOT walk the subtree or
 * discover slots from the layout — it fills exactly the slots you pass in.
 * Use this when you already know which slots are unfilled (e.g. during
 * layout regeneration after matching existing characters).
 */
export async function populateSpecificSlots(
  ctx: UniverseContext,
  placeId: string,
  slots: GeneratedSlot[],
  stats?: Record<string, number>,
  weaponAssigner?: (purpose: string) => string | null,
): Promise<void> {
  if (slots.length === 0) return;

  const place = ctx.findPlace(placeId);
  if (!place) return;

  // Load layout once for passable-tile validation (BUG-215)
  const layout = await loadPlaceLayout(ctx.universeId, placeId);
  const terrainGrid = layout?.terrainGrid ?? null;
  const tileSize = layout?.tilemap.tileSize ?? 32;
  const gridHeight = terrainGrid?.length ?? 0;
  const gridWidth = terrainGrid?.[0]?.length ?? 0;

  logger.info(
    'SlotCharacterPopulator',
    `${placeId}: generating ${slots.length} character(s) for specific slots`,
  );

  const tasks = slots.map((slot) => async () => {
    const purposeDef = loadPurposeDefinition(slot.purpose);
    const roleLabel = slot.purpose.replace(/_/g, ' ');

    const character = await generateCharacter({
      ctx,
      description: `A ${roleLabel} at ${place.label}`,
      placeId,
      role: slot.purpose,
      slotPosition: { x: slot.x, y: slot.y },
      stats,
      weapon: weaponAssigner ? weaponAssigner(slot.purpose) : null,
    });

    // Snap to nearest passable tile if spawned on a blocked tile (BUG-215)
    if (terrainGrid) {
      const { x, y } = character.position;
      const adjusted = findNearestPassablePosition(
        x,
        y,
        terrainGrid,
        tileSize,
        gridWidth,
        gridHeight,
      );
      if (adjusted.x !== x || adjusted.y !== y) {
        character.position.x = adjusted.x;
        character.position.y = adjusted.y;
        ctx.upsertEntity('character', character);
        logger.info(
          'SlotCharacterPopulator',
          `Snapped ${character.label} to passable tile: (${x},${y}) → (${adjusted.x},${adjusted.y})`,
        );
      }
    }

    if (purposeDef?.defaultSchedule) {
      const preferOnSiteQuarters = purposeDef.preferOnSiteQuarters ?? false;
      const homePlaceId = resolveHome(ctx, placeId, preferOnSiteQuarters);
      const parentPlace = place.position.parent ? ctx.findPlace(place.position.parent) : null;
      const homeAreaHint = parentPlace ? `${parentPlace.label} area` : `${place.label} area`;
      const routine = buildSlotRoutine(purposeDef, place, homePlaceId, homeAreaHint);

      // Resolve leisure venue from sibling places (FEAT-443)
      const leisure = resolveLeisure(ctx, routine.schedule, purposeDef, placeId);
      if (leisure) {
        routine.leisure = leisure;
      }

      character.info.routine = routine;

      // Generate vessel routes for captains
      if (slot.purpose === 'captain') {
        character.info.vesselRoutes = buildVesselRoutes(ctx, placeId);
      }

      ctx.upsertEntity('character', character);
    }

    logger.info(
      'SlotCharacterPopulator',
      `Generated ${character.label} (${slot.purpose}) at ${placeId} (${slot.x}, ${slot.y})`,
    );

    return character;
  });

  const results = await runWithConcurrency(tasks, 3, `Slot Characters [${place.label}]`);

  const fulfilledResults = results.filter(
    (r): r is PromiseFulfilledResult<Character> => r.status === 'fulfilled',
  );
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const r of rejected) {
    const reason: unknown = r.reason;
    logger.error(
      'SlotCharacterPopulator',
      `Failed to generate slot character at ${placeId}: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  }

  // Assign beds and workspaces after all characters are generated (FEAT-444).
  // Must run sequentially after concurrency resolves — not inside the task lambdas —
  // so the claim sets are not raced by concurrent slot generation.
  const newCharacters = fulfilledResults.map((r) => r.value);
  assignBeds(ctx, newCharacters);
  assignWorkspaces(ctx, newCharacters);

  // Generation-time validation pass (FEAT-442): attempt to resolve null homes with
  // the now-complete place context. Emit a structured warning for any still-null homes.
  for (const character of newCharacters) {
    if (!character.info.routine) continue;
    if (character.info.routine.home.placeId !== null) continue;

    const charPurposeDef = loadPurposeDefinition(character.info.purpose);
    const resolvedId = resolveHome(
      ctx,
      character.position.parent ?? placeId,
      charPurposeDef?.preferOnSiteQuarters ?? false,
    );

    if (resolvedId !== null) {
      character.info.routine.home.placeId = resolvedId;
      ctx.upsertEntity('character', character);
    } else {
      logger.warn(
        'SlotCharacterPopulator',
        `Character exits generation with no home: characterId=${character.id}, role=${character.info.purpose}, parentPlaceId=${character.position.parent ?? placeId}`,
      );
    }
  }

  logger.info(
    'SlotCharacterPopulator',
    `Specific-slot population complete: ${fulfilledResults.length} character(s) generated at ${placeId}`,
  );
}

// ============================================================================
// Unfilled Slot Population (with double-check guard)
// ============================================================================

/**
 * Populate unfilled character slots with a double-check guard.
 *
 * Re-runs `detectUnfilledSlots()` at generation time before creating
 * characters. This prevents duplicates when two sessions trigger
 * population for the same slot simultaneously.
 *
 * @param ctx Universe context for data access and mutations
 * @param unfilledSlots Pre-detected unfilled slots (from `detectUnfilledSlots`)
 */
export async function populateUnfilledSlots(
  ctx: UniverseContext,
  unfilledSlots: UnfilledSlotInfo[],
  stats?: Record<string, number>,
  weaponAssigner?: (purpose: string) => string | null,
): Promise<void> {
  if (unfilledSlots.length === 0) return;

  // Group by placeId for efficient re-detection
  const byPlace = new Map<string, UnfilledSlotInfo[]>();
  for (const info of unfilledSlots) {
    const list = byPlace.get(info.placeId);
    if (list) {
      list.push(info);
    } else {
      byPlace.set(info.placeId, [info]);
    }
  }

  for (const [placeId, slotInfos] of byPlace) {
    // Double-check guard: re-detect at generation time
    const stillUnfilled = await detectUnfilledSlots(ctx, placeId);
    if (stillUnfilled.length === 0) {
      logger.info(
        'SlotCharacterPopulator',
        `Double-check: all slots at ${placeId} are now filled, skipping`,
      );
      continue;
    }

    // Only populate slots that are still unfilled
    // Match by purpose + position to identify which pre-detected slots are still valid
    const slotKey = (s: GeneratedSlot): string => `${s.purpose}:${s.x}:${s.y}`;
    const stillUnfilledSet = new Set(stillUnfilled.map((u) => slotKey(u.slot)));

    const confirmedSlots = slotInfos
      .filter((info) => stillUnfilledSet.has(slotKey(info.slot)))
      .map((info) => info.slot);

    if (confirmedSlots.length === 0) {
      logger.info(
        'SlotCharacterPopulator',
        `Double-check: pre-detected slots at ${placeId} are now filled, skipping`,
      );
      continue;
    }

    await populateSpecificSlots(ctx, placeId, confirmedSlots, stats, weaponAssigner);
  }
}

/**
 * Populate character-category slots in a place hierarchy.
 *
 * Walks the subtree rooted at `rootPlaceId` and generates characters
 * only for unfilled character-category slots. Safe to re-run — already
 * filled slots are detected and skipped (no duplicates).
 *
 * Each generated character gets:
 * - purpose from the slot
 * - position at the slot's tile coordinates
 * - interaction type from the purpose registry
 * - a deterministic routine from the purpose's defaultSchedule/defaultActivityId
 *
 * @param ctx Universe context for data access and mutations
 * @param rootPlaceId Root of the subtree to populate
 */
export async function populateSlotCharacters(
  ctx: UniverseContext,
  rootPlaceId: string,
  stats?: Record<string, number>,
  weaponAssigner?: (purpose: string) => string | null,
): Promise<void> {
  // Collect all places in the subtree (BFS)
  const queue: string[] = [rootPlaceId];
  const allPlaceIds: string[] = [];

  while (queue.length > 0) {
    const placeId = queue.shift()!;
    allPlaceIds.push(placeId);
    const children = ctx.getChildPlaces(placeId);
    for (const child of children) {
      queue.push(child.id);
    }
  }

  logger.info(
    'SlotCharacterPopulator',
    `Walking ${allPlaceIds.length} place(s) in subtree of ${rootPlaceId}`,
  );

  for (const placeId of allPlaceIds) {
    const unfilled = await detectUnfilledSlots(ctx, placeId);
    if (unfilled.length === 0) continue;

    await populateSpecificSlots(
      ctx,
      placeId,
      unfilled.map((u) => u.slot),
      stats,
      weaponAssigner,
    );
  }

  logger.info('SlotCharacterPopulator', `Population complete for subtree of ${rootPlaceId}`);
}

// ============================================================================
// Universe-Wide Scanner
// ============================================================================

/**
 * Scan the entire universe for unfilled character slots.
 *
 * Iterates all places, loads layouts, and calls `detectUnfilledSlots()` per place.
 * Returns aggregated unfilled slot info across all places.
 *
 * This is a read-only scan (no mutations). The actual population is handled
 * separately by the background queue via `populateUnfilledSlots()`.
 *
 * @param ctx Universe context with all places
 * @returns Aggregated unfilled slots across all places
 */
export async function scanUniverseForUnfilledSlots(
  ctx: UniverseContext,
): Promise<UnfilledSlotInfo[]> {
  const allUnfilled: UnfilledSlotInfo[] = [];

  for (const place of ctx.places) {
    const unfilled = await detectUnfilledSlots(ctx, place.id);
    if (unfilled.length > 0) {
      allUnfilled.push(...unfilled);
    }
  }

  if (allUnfilled.length > 0) {
    logger.info(
      'SlotCharacterPopulator',
      `Universe scan: ${allUnfilled.length} unfilled slot(s) across ${new Set(allUnfilled.map((u) => u.placeId)).size} place(s)`,
    );
  }

  return allUnfilled;
}

// ============================================================================
// Character Needs Detection (FEAT-131)
// ============================================================================

/**
 * Check whether a resolved home place actually has sleeping objects.
 */
export function characterHasProperHome(ctx: UniverseContext, homePlaceId: string): boolean {
  const objects = ctx.getObjectsByPlace(homePlaceId);
  return objects.some((o) => o.info.purpose === 'sleeping');
}

/**
 * Detect characters who are missing essential places (home, workplace, leisure).
 *
 * Runs during the periodic universe scan alongside unfilled slot detection.
 * Returns a list of PlaceNeed objects that can be used to enqueue place generation.
 *
 * Currently detects:
 * - **Home**: character's resolved home has no sleeping objects
 *
 * Skips player characters and characters without routines (they don't have
 * scheduled home/work/leisure activities).
 */
export function detectCharacterNeeds(ctx: UniverseContext): PlaceNeed[] {
  const needs: PlaceNeed[] = [];

  for (const character of ctx.characters) {
    // Skip players — they manage their own housing
    if (character.info.isPlayer) continue;

    // Skip characters without routines — they don't have scheduled activities
    if (!character.info.routine) continue;

    // Home detection: does the character have a place with sleeping objects?
    const homePlaceId = character.info.routine.home.placeId;
    if (homePlaceId) {
      if (!characterHasProperHome(ctx, homePlaceId)) {
        needs.push({
          characterId: character.id,
          needType: 'home',
          nearPlaceId: character.position.parent ?? homePlaceId,
        });
      }
    }
  }

  if (needs.length > 0) {
    logger.info(
      'SlotCharacterPopulator',
      `Character needs scan: ${needs.length} character(s) missing essential places`,
    );
  }

  return needs;
}
