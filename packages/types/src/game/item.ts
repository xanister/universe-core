/**
 * Unified item definition types for the item registry.
 *
 * ItemDefinition provides a common view across all item types (weapons,
 * clothing, consumables, generics). Source-specific properties (baseDamage,
 * equipSlot, pattern) are available via source-specific registries.
 *
 * FEAT-301: Items Catalog + Unified Registry (Unified Items System — Phase 1)
 */

import type { LightSourceConfig } from '../world/object-types.js';

/** Item category matching ContainedItem.type. */
export type ItemType = 'weapon' | 'clothing' | 'consumable' | 'generic';

/**
 * A game effect declared by an item in the catalog.
 *
 * These are stored in items.json without `characterId` (filled at use time)
 * and without `reason` (generated from the item name at use time).
 *
 * FEAT-339: Consumable Item Effects
 */
export type ItemEffectDefinition =
  | { type: 'modify_stat'; stat: string; delta: number }
  | { type: 'remove_condition'; conditionId: string }
  | { type: 'apply_condition'; conditionId: string; severity: number };

/**
 * Common item definition returned by getItemDef().
 *
 * Every item in the game — weapon, clothing, potion, key — has one of these.
 * The `type` field routes to source-specific metadata when needed.
 */
export interface ItemDefinition {
  /** Unique item identifier (e.g. "iron_sword", "longsleeve", "health_potion"). */
  id: string;
  /** Display name (e.g. "Iron Sword", "Long-sleeved shirt", "Health Potion"). */
  name: string;
  /** Brief description for tooltips/menus. */
  description: string;
  /** Item category. */
  type: ItemType;
  /**
   * Item-specific action IDs (e.g. ["thrust", "riposte"] for weapons, ["drink"] for potions).
   * Shared actions (drop, pickup, examine) are implicit and not listed here.
   */
  actions: string[];
  /** Equipment slot when equippable (e.g. "torso_under", "weapon"). Null for non-equippable items. */
  equipSlot: string | null;
  /** Whether multiple instances can stack into one ContainedItem with quantity > 1. */
  stackable: boolean;
  /**
   * Game effects applied when the item is used (drink, read, use actions).
   * Empty for weapons, clothing, and generic items with no mechanical effect.
   */
  effects: ItemEffectDefinition[];
  /**
   * Light source config for items that emit light when carried (e.g. torches).
   * When present, the player emits this light centered on their position.
   */
  lightSource?: LightSourceConfig;
}

/**
 * Display labels for known item action IDs.
 * Used by the inventory UI to render action buttons.
 */
export const ITEM_ACTION_LABELS: Record<string, string> = {
  drink: 'Drink',
  read: 'Read',
  use: 'Use',
  equip: 'Equip',
};
