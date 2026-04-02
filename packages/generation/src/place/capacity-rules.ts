/**
 * Capacity Rules
 *
 * Defines capacity configurations for homes and workplaces.
 * System tags are required for game mechanics and auto-ensured in any universe.
 */

import type { TagDefinition } from '@dmnpc/types/entity';
import { ensureTags } from '@dmnpc/core/entities/tag-manager.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

/**
 * System tags required for capacity mechanics.
 * These are auto-created in any universe on demand.
 */
const SYSTEM_TAGS: TagDefinition[] = [
  // Home capacity tags
  {
    tagId: 'TAG_home_single',
    label: 'home-single',
    description: 'Single-person permanent dwelling',
  },
  {
    tagId: 'TAG_home_shared',
    label: 'home-shared',
    description: 'Multi-person permanent dwelling',
  },
  // Temporary accommodation (not for permanent assignment)
  {
    tagId: 'TAG_lodging',
    label: 'lodging',
    description: 'Temporary accommodation (inn rooms, guest quarters)',
  },
  // Workplace capacity tags
  {
    tagId: 'TAG_workplace_tavern',
    label: 'workplace-tavern',
    description: 'Tavern or drinking establishment',
  },
  {
    tagId: 'TAG_workplace_temple',
    label: 'workplace-temple',
    description: 'Temple or religious institution',
  },
  {
    tagId: 'TAG_workplace_shop',
    label: 'workplace-shop',
    description: 'Small retail shop or stall',
  },
  {
    tagId: 'TAG_workplace_warehouse',
    label: 'workplace-warehouse',
    description: 'Storage or logistics facility',
  },
  // Vessel controls
  {
    tagId: 'TAG_workplace_vessel_controls',
    label: 'workplace-vessel-controls',
    description: 'Vessel helm, bridge, cockpit, or control room',
  },
];

/**
 * Ensures system tags exist in a universe.
 * Call this before using occupancy functions.
 */
export async function ensureSystemTags(ctx: UniverseContext): Promise<void> {
  await ensureTags(
    SYSTEM_TAGS.map((t) => t.label),
    ctx,
  );
}

export interface CapacityConfig {
  /** Tag that identifies this place type (e.g., TAG_home_single, TAG_workplace_tavern) */
  capacityTag: string;
  /** Total capacity for this place type */
  totalCapacity: number;
  /** Role-based slots (for workplaces). Keys are role tags (e.g., TAG_bartender) */
  roleSlots?: Record<string, { min: number; max: number }>;
}

/**
 * Capacity rules for all place types.
 */
export const CAPACITY_RULES: CapacityConfig[] = [
  // -------------------------------------------------------------------------
  // Homes (no role slots - just total capacity)
  // -------------------------------------------------------------------------
  {
    capacityTag: 'TAG_home_single',
    totalCapacity: 1,
  },
  {
    capacityTag: 'TAG_home_shared',
    totalCapacity: 4,
  },

  // -------------------------------------------------------------------------
  // Workplaces (with role-based slots)
  // -------------------------------------------------------------------------
  {
    capacityTag: 'TAG_workplace_tavern',
    totalCapacity: 6,
    roleSlots: {
      TAG_bartender: { min: 1, max: 2 },
      TAG_server: { min: 0, max: 2 },
      TAG_bouncer: { min: 0, max: 1 },
      TAG_cook: { min: 0, max: 1 },
    },
  },
  {
    capacityTag: 'TAG_workplace_temple',
    totalCapacity: 5,
    roleSlots: {
      TAG_priest: { min: 1, max: 2 },
      TAG_acolyte: { min: 0, max: 3 },
    },
  },
  {
    capacityTag: 'TAG_workplace_shop',
    totalCapacity: 3,
    roleSlots: {
      TAG_merchant: { min: 1, max: 1 },
      TAG_clerk: { min: 0, max: 2 },
    },
  },
  {
    capacityTag: 'TAG_workplace_warehouse',
    totalCapacity: 10,
    roleSlots: {
      TAG_laborer: { min: 2, max: 8 },
      TAG_clerk: { min: 0, max: 2 },
    },
  },
  // Vessel controls (helm, bridge, cockpit)
  {
    capacityTag: 'TAG_workplace_vessel_controls',
    totalCapacity: 2,
    roleSlots: {
      TAG_captain: { min: 0, max: 1 },
      TAG_helmsman: { min: 1, max: 2 },
    },
  },
];
