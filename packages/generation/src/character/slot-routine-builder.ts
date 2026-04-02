/**
 * Slot Routine Builder
 *
 * Builds deterministic CharacterRoutine from a purpose definition's
 * defaultSchedule and defaultActivityId. Used for slot-spawned NPCs
 * so they get predictable routines without LLM calls.
 */

import type { CharacterRoutine, LocationReference } from '@dmnpc/types/npc';
import type { PurposeDefinition } from '@dmnpc/types/world';
import type { Place } from '@dmnpc/types/entity';

/**
 * Build a CharacterRoutine from a purpose definition.
 *
 * @param purposeDef The purpose definition with defaultSchedule and defaultActivityId
 * @param workPlace The place where the character works (their spawning place)
 * @param homePlaceId The resolved home place ID, or null when no home was found
 * @param homeAreaHint Geographic area hint used when homePlaceId is null (e.g. "Market District area")
 * @returns A complete CharacterRoutine
 */
export function buildSlotRoutine(
  purposeDef: PurposeDefinition,
  workPlace: Place,
  homePlaceId: string | null,
  homeAreaHint: string | null = null,
): CharacterRoutine {
  const homeRef: LocationReference =
    homePlaceId !== null
      ? {
          placeId: homePlaceId,
          description:
            homePlaceId === workPlace.id ? workPlace.label : `Quarters near ${workPlace.label}`,
          areaHint: null,
        }
      : {
          placeId: null,
          description: `Quarters near ${workPlace.label}`,
          areaHint: homeAreaHint ?? `${workPlace.label} area`,
        };

  const workRef: LocationReference = {
    placeId: workPlace.id,
    description: workPlace.label,
    areaHint: null,
  };

  if (!purposeDef.defaultSchedule) {
    throw new Error(
      `Purpose "${purposeDef.id}" has no defaultSchedule. Only character purposes with schedules should reach buildSlotRoutine.`,
    );
  }
  const schedule = purposeDef.defaultSchedule;

  // Build activities map from defaultActivityId
  const activities: Partial<Record<'home' | 'work' | 'leisure' | 'away', string>> = {};
  if (purposeDef.defaultActivityId) {
    activities.work = purposeDef.defaultActivityId;
  }

  return {
    schedule,
    home: homeRef,
    work: workRef,
    leisure: null,
    variance: 0.2,
    activities: Object.keys(activities).length > 0 ? activities : undefined,
  };
}
