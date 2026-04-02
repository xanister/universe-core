/**
 * Layer 3: Context Populator
 *
 * Populates slots with objects using LLM-guided selection.
 * Objects are selected from the catalog based on slot purpose and place context.
 */

import { logger } from '@dmnpc/core/infra/logger.js';
import type { PlaceContext, Purpose, GeneratedSlot } from '@dmnpc/types/world';
import type { Place } from '@dmnpc/types/entity';
import { selectObjectForSlot, selectObjectWithoutLlm } from '../object-selector.js';

// ============================================================================
// Placed Object Result
// ============================================================================

export interface StagedPlacedObject {
  objectTypeId: string;
  position: { x: number; y: number };
  facing: 'north' | 'south' | 'east' | 'west';
  layer: 'floor' | 'default' | 'overhead' | 'wall';
  material?: string;
  tint?: number;
  /** Whether the generated object is system-only (hidden from players). From slot definition. */
  isStructural?: boolean;
  /** Slot footprint in tiles from placement algorithm. Used for world position
   *  computation so tall sprites (e.g. 2-tile doors) anchor at the slot tile,
   *  not offset by their sprite height. */
  footprint: { w: number; h: number };
}

// ============================================================================
// Main Populator
// ============================================================================

export interface PopulateOptions {
  /** Random seed for deterministic generation */
  seed?: number;
}

/**
 * Populate slots with objects using LLM-guided selection.
 * All slots are treated uniformly — the catalog determines which purposes
 * have matching objects. Slots with no catalog match (e.g. child-place
 * purposes like storage_room) are gracefully skipped.
 *
 * @param slots Generated slots from placement algorithms
 * @param place The place being populated
 * @param context Place context (wealth, cleanliness, etc.)
 * @param purpose Purpose of the place
 * @param options Population options
 * @returns List of placed objects
 */
export async function populateSlots(
  slots: GeneratedSlot[],
  place: Place,
  context: PlaceContext,
  purpose: Purpose,
  options: PopulateOptions = {},
): Promise<StagedPlacedObject[]> {
  const { seed } = options;
  const placedObjects: StagedPlacedObject[] = [];
  const alreadyPlaced: string[] = [];

  const llmSlotCount = slots.filter((s) => s.useLlmSelection === true).length;
  logger.info(
    'ContextPopulator',
    `Populating ${slots.length} slots for ${purpose} (${llmSlotCount} with LLM selection)`,
  );

  for (const slot of slots) {
    try {
      const selectionCtx = {
        slot,
        place,
        placeContext: context,
        purpose,
        alreadyPlaced,
      };

      const result =
        slot.useLlmSelection === true
          ? await selectObjectForSlot(selectionCtx, seed)
          : selectObjectWithoutLlm(selectionCtx, seed);

      if (result.objectTypeId) {
        placedObjects.push({
          objectTypeId: result.objectTypeId,
          position: { x: slot.x, y: slot.y },
          facing: slot.facing,
          layer: slot.layer,
          isStructural: slot.isStructural ?? false,
          footprint: { w: slot.width, h: slot.height },
        });

        alreadyPlaced.push(result.objectTypeId);

        logger.debug(
          'ContextPopulator',
          `Placed ${result.objectTypeId} at (${slot.x}, ${slot.y}) (purpose: ${slot.purpose})`,
        );
      } else {
        logger.debug(
          'ContextPopulator',
          `No object for slot at (${slot.x}, ${slot.y}) (purpose: ${slot.purpose})`,
        );
      }
    } catch (error) {
      throw new Error(
        `Error populating slot at (${slot.x}, ${slot.y}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  logger.info('ContextPopulator', `Populated ${placedObjects.length}/${slots.length} slots`);

  return placedObjects;
}
