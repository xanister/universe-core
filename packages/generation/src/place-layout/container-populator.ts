/**
 * Container Populator
 *
 * Populates storage containers (chests, barrels, crates) with contextually
 * appropriate items during layout generation. Uses the unified item registry —
 * weapons, clothing, consumables, and generic items.
 *
 * Item selection is driven by CONTAINER_ITEM_POOLS which maps place purposes
 * to curated item ID lists. Count scales with PlaceContext.wealth.
 *
 * FEAT-326: Populate Containers With Appropriate Items
 */

import type { PlaceContext } from '@dmnpc/types/world';

// ============================================================================
// Item Pools
// ============================================================================

/**
 * Maps place purpose to arrays of item IDs from the unified registry.
 * Each pool is a curated subset appropriate for that room type.
 * To add items to a context: edit the relevant array below.
 */
export const CONTAINER_ITEM_POOLS: Record<string, string[]> = {
  weapon_shop: [
    'iron_sword',
    'battle_axe',
    'hunting_bow',
    'mace',
    'wooden_staff',
    'leather_bracers',
    'metal_gloves',
    'leather_cap',
  ],
  bedroom: [
    'longsleeve',
    'tunic',
    'cloth_pants',
    'shoes',
    'boots',
    'leather_belt',
    'sealed_letter',
    'coin_pouch',
    'silver_ring',
  ],
  cabin: ['tunic', 'cloth_pants', 'boots', 'rope_belt', 'cape', 'coin_pouch', 'health_potion'],
  residence: [
    'longsleeve',
    'formal_shirt',
    'formal_pants',
    'shoes',
    'formal_belt',
    'coin_pouch',
    'silver_ring',
    'sealed_letter',
  ],
  shop: [
    'longsleeve',
    'tunic',
    'cloth_pants',
    'shoes',
    'leather_belt',
    'coin_pouch',
    'ruby_gem',
    'bronze_medallion',
    'silver_ring',
  ],
  workshop: [
    'iron_sword',
    'battle_axe',
    'mace',
    'leather_bracers',
    'metal_gloves',
    'leather_cap',
    'iron_amulet',
    'coin_pouch',
  ],
  storage_room: [
    'health_potion',
    'antidote_vial',
    'coin_pouch',
    'iron_amulet',
    'bronze_medallion',
    'cloth_pants',
    'longsleeve',
    'rope_belt',
    'boots',
  ],
  warehouse: [
    'cloth_pants',
    'longsleeve',
    'tunic',
    'shoes',
    'boots',
    'leather_belt',
    'coin_pouch',
    'iron_amulet',
    'health_potion',
  ],
  cargo_hold: [
    'cloth_pants',
    'tunic',
    'rope_belt',
    'boots',
    'coin_pouch',
    'health_potion',
    'antidote_vial',
    'iron_amulet',
  ],
  ruins: [
    'ruby_gem',
    'golden_key',
    'health_potion',
    'scroll_of_identify',
    'bronze_medallion',
    'iron_amulet',
    'silver_ring',
  ],
  kitchen: ['health_potion', 'antidote_vial', 'coin_pouch', 'iron_amulet'],
  station: [
    'health_potion',
    'antidote_vial',
    'coin_pouch',
    'sealed_letter',
    'iron_amulet',
    'scroll_of_identify',
  ],
  sailing_ship_corridor_below_deck: [
    'rope_belt',
    'tunic',
    'cloth_pants',
    'boots',
    'health_potion',
    'antidote_vial',
    'coin_pouch',
  ],
};

/** Fallback pool when no purpose-specific pool exists. */
const DEFAULT_POOL: string[] = [
  'health_potion',
  'antidote_vial',
  'coin_pouch',
  'silver_ring',
  'iron_amulet',
  'sealed_letter',
];

// ============================================================================
// Count Scaling
// ============================================================================

/** Item count range per wealth level (matches PlaceContext.wealth). */
const WEALTH_COUNT_RANGE: Record<string, [min: number, max: number]> = {
  low: [0, 1],
  moderate: [1, 3],
  high: [2, 5],
};

const DEFAULT_COUNT_RANGE: [number, number] = [1, 2];

// ============================================================================
// Population Logic
// ============================================================================

/**
 * Select items for a container based on place purpose and wealth.
 *
 * @param placePurpose The purpose of the place containing this container
 * @param context Place context with wealth information
 * @param rng Seeded random function (0-1 range) for deterministic selection
 * @returns Array of item IDs to place in the container, or empty array
 */
export function populateContainerContents(
  placePurpose: string,
  context: PlaceContext | null,
  rng: () => number,
): string[] {
  const pool = CONTAINER_ITEM_POOLS[placePurpose] ?? DEFAULT_POOL;
  if (pool.length === 0) return [];

  const wealth = context?.wealth ?? 'moderate';
  const [min, max] = WEALTH_COUNT_RANGE[wealth] ?? DEFAULT_COUNT_RANGE;

  // Determine count within range using rng
  const count = min + Math.floor(rng() * (max - min + 1));
  if (count <= 0) return [];

  // Select items without replacement (each item appears at most once per container)
  const available = [...pool];
  const selected: string[] = [];

  for (let i = 0; i < count && available.length > 0; i++) {
    const index = Math.floor(rng() * available.length);
    selected.push(available[index]);
    available.splice(index, 1);
  }

  return selected;
}
