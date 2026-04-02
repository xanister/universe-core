/**
 * Occupancy Module
 *
 * Shared logic for calculating place occupancy (homes and workplaces).
 * Used by routine generator to check capacity before assigning locations.
 */

import type { Place, Character } from '@dmnpc/types/entity';
import { CAPACITY_RULES, type CapacityConfig } from './capacity-rules.js';

// ============================================================================
// Types
// ============================================================================

export interface OccupancySlot {
  /** Role tag (e.g., TAG_bartender). Undefined means any role. */
  roleTag?: string;
  /** Minimum required for this role */
  min: number;
  /** Maximum allowed for this role */
  max: number;
  /** Current count in this role */
  current: number;
}

export interface PlaceOccupancy {
  placeId: string;
  slots: OccupancySlot[];
  totalCurrent: number;
  totalCapacity: number;
  openings: Array<{ roleTag?: string; count: number }>;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Finds the capacity config for a place based on its tags.
 */
export function findCapacityConfig(place: Place): CapacityConfig | null {
  for (const config of CAPACITY_RULES) {
    if (place.tags.includes(config.capacityTag)) {
      return config;
    }
  }
  return null;
}

/**
 * Calculates occupancy for a single place.
 *
 * @param place - The place to check
 * @param occupants - Characters currently assigned to this place (with their role tags)
 * @param config - Capacity configuration for this place type
 */
export function getOccupancy(
  place: Place,
  occupants: Array<{ roleTag?: string }>,
  config: CapacityConfig,
): PlaceOccupancy {
  const slots: OccupancySlot[] = [];
  const openings: Array<{ roleTag?: string; count: number }> = [];

  // Count occupants by role
  const roleCounts = new Map<string | undefined, number>();
  for (const occupant of occupants) {
    const role = occupant.roleTag;
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }

  // If config has role slots, create slots for each role
  if (config.roleSlots) {
    for (const [roleTag, { min, max }] of Object.entries(config.roleSlots)) {
      const current = roleCounts.get(roleTag) ?? 0;
      slots.push({ roleTag, min, max, current });

      const available = max - current;
      if (available > 0) {
        openings.push({ roleTag, count: available });
      }
    }
  }

  // Calculate totals
  const totalCurrent = occupants.length;
  const totalCapacity = config.totalCapacity;

  // If no role slots defined, any opening is generic
  if (!config.roleSlots && totalCurrent < totalCapacity) {
    openings.push({ roleTag: undefined, count: totalCapacity - totalCurrent });
  }

  return {
    placeId: place.id,
    slots,
    totalCurrent,
    totalCapacity,
    openings,
  };
}

/**
 * Calculates home occupancy for all residences.
 * Excludes lodging (temporary accommodation) from permanent home assignment.
 */
export function getHomeOccupancy(allCharacters: Character[], places: Place[]): PlaceOccupancy[] {
  const results: PlaceOccupancy[] = [];

  // Filter to places that have home capacity tags, excluding lodging
  const residences = places.filter((p) => {
    const config = findCapacityConfig(p);
    const isHome = config?.capacityTag.startsWith('TAG_home_');
    const isLodging = p.tags.includes('TAG_lodging');
    return isHome && !isLodging;
  });

  // Count occupants per residence
  const occupantsByPlace = new Map<string, Array<{ roleTag?: string }>>();
  for (const char of allCharacters) {
    const homePlaceId = char.info.routine?.home.placeId;
    if (homePlaceId) {
      const occupants = occupantsByPlace.get(homePlaceId) ?? [];
      // Homes don't have roles, so roleTag is undefined
      occupants.push({ roleTag: undefined });
      occupantsByPlace.set(homePlaceId, occupants);
    }
  }

  // Calculate occupancy for each residence
  for (const place of residences) {
    const config = findCapacityConfig(place);
    if (!config) continue;

    const occupants = occupantsByPlace.get(place.id) ?? [];
    results.push(getOccupancy(place, occupants, config));
  }

  return results;
}

/**
 * Calculates workplace occupancy for all workplaces.
 */
export function getWorkplaceOccupancy(
  allCharacters: Character[],
  places: Place[],
): PlaceOccupancy[] {
  const results: PlaceOccupancy[] = [];

  // Filter to places that have workplace capacity tags
  const workplaces = places.filter((p) => {
    const config = findCapacityConfig(p);
    return config?.capacityTag.startsWith('TAG_workplace_');
  });

  // Count staff per workplace with their roles
  const staffByPlace = new Map<string, Array<{ roleTag?: string }>>();
  for (const char of allCharacters) {
    const workPlaceId = char.info.routine?.work?.placeId;
    if (workPlaceId) {
      const staff = staffByPlace.get(workPlaceId) ?? [];
      // Find occupation tag from character tags
      const occupationTag = char.tags.find((t) => isOccupationTag(t));
      staff.push({ roleTag: occupationTag });
      staffByPlace.set(workPlaceId, staff);
    }
  }

  // Calculate occupancy for each workplace
  for (const place of workplaces) {
    const config = findCapacityConfig(place);
    if (!config) continue;

    const staff = staffByPlace.get(place.id) ?? [];
    results.push(getOccupancy(place, staff, config));
  }

  return results;
}

/**
 * Checks if a tag is an occupation tag.
 */
function isOccupationTag(tag: string): boolean {
  const occupationTags = [
    'TAG_bartender',
    'TAG_server',
    'TAG_innkeeper',
    'TAG_cook',
    'TAG_bouncer',
    'TAG_guard',
    'TAG_soldier',
    'TAG_watchman',
    'TAG_priest',
    'TAG_acolyte',
    'TAG_healer',
    'TAG_fisher',
    'TAG_sailor',
    'TAG_merchant',
    'TAG_clerk',
    'TAG_shopkeeper',
    'TAG_laborer',
  ];
  return occupationTags.includes(tag);
}
