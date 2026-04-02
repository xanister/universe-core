/**
 * Clothing System
 *
 * Tag-driven clothing catalog with direct per-slot item resolution.
 * Clothing items have semantic tags for catalog queries.
 * Slot registry (game-level) defines render order; region-to-asset mapping is internal.
 */

import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLPCLayerOptions, getAvailableBodyTypes } from './lpc-assets.js';
import { getSlotAssetLayer } from './slot-registry.js';
import type { LPCLayerType, BodyType, LPCAssetOption, ClothingColor } from './types.js';
import { CLOTHING_COLOR_HEX } from './types.js';

export interface ClothingItem {
  slot: string;
  pattern: string;
  tags: string[];
  name: string;
  /**
   * Default color for items that had a baked-in color before consolidation.
   * When a character's ClothingSlot.color is null, resolveClothingSlot() uses this
   * to apply the item's natural color (e.g., brown shoes, black formal jacket).
   * Null means "no default" (white-base items like shirts that are meant to be tinted).
   */
  defaultColor: ClothingColor | null;
  /**
   * When true, equipping this headwear suppresses the hair sprite layer.
   * Used for full helmets, enclosed hoods, etc. that fully cover the head.
   * Omitted or false means hair renders normally underneath.
   */
  hidesHair?: boolean;
}

export interface ClothingCatalogData {
  clothing: Record<string, ClothingItem>;
}

export interface ResolvedSlot {
  type: LPCLayerType;
  pattern: string;
  tint: number | null;
  tintMode?: 'multiply' | 'overlay';
}

let clothingData: ClothingCatalogData | null = null;
let clothingDataInjected = false;

/**
 * Load clothing data from the default location (packages/data/sprites/lpc/clothing-data.json).
 */
export function loadClothingData(): ClothingCatalogData {
  if (clothingData && (clothingDataInjected || process.env.NODE_ENV === 'production'))
    return clothingData;

  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Navigate from packages/sprites/src/ to packages/data/sprites/lpc/
  const dataPath = join(thisDir, '..', '..', 'data', 'sprites', 'lpc', 'clothing-data.json');
  clothingData = readJsonFileSync<ClothingCatalogData>(dataPath);
  clothingDataInjected = false;
  return clothingData;
}

/**
 * Set clothing data directly (for testing).
 */
export function setClothingData(data: ClothingCatalogData): void {
  clothingData = data;
  clothingDataInjected = true;
}

/**
 * Get all clothing items matching a slot and any of the given tags (OR semantics).
 */
export function findClothingByTags(slot: string, tags: string[]): ClothingItem[] {
  const data = loadClothingData();
  const tagSet = new Set(tags);

  return Object.values(data.clothing).filter(
    (item) => item.slot === slot && item.tags.some((t) => tagSet.has(t)),
  );
}

/**
 * Check whether any equipped clothing item has hidesHair set.
 * Accepts a list of clothing slot entries (slot + itemId) like CharacterInfo.clothing.
 */
export function hasHidesHairHeadwear(
  clothing: ReadonlyArray<{ slot: string; itemId: string }>,
): boolean {
  const data = loadClothingData();
  return clothing.some((entry) => {
    if (!(entry.itemId in data.clothing)) return false;
    return data.clothing[entry.itemId].hidesHair === true;
  });
}

/**
 * Get all clothing item keys from the catalog.
 * Used as LLM enum constraint so the model can only pick real items.
 */
export function getClothingItemKeys(): string[] {
  const data = loadClothingData();
  return Object.keys(data.clothing);
}

/**
 * Format the clothing catalog for inclusion in LLM prompts.
 * Groups items by slot with compact formatting. Shows defaultColor so the LLM
 * knows what "null color" produces for each item.
 */
export function getClothingCatalogForPrompt(): string {
  const data = loadClothingData();
  const bySlot = new Map<
    string,
    Array<{ key: string; name: string; defaultColor: string | null }>
  >();

  for (const [key, item] of Object.entries(data.clothing)) {
    const list = bySlot.get(item.slot) ?? [];
    list.push({ key, name: item.name, defaultColor: item.defaultColor });
    bySlot.set(item.slot, list);
  }

  const lines: string[] = ['Available clothing items by slot:'];
  for (const [slot, items] of bySlot) {
    const itemList = items
      .map((i) => {
        const colorNote = i.defaultColor ? ` [default: ${i.defaultColor}]` : '';
        return `${i.key} (${i.name}${colorNote})`;
      })
      .join(', ');
    lines.push(`  ${slot}: ${itemList}`);
  }
  lines.push('');
  lines.push(
    'Each clothing entry needs: slot (from above), item (key from that slot), color (a named color or null for default).',
  );
  lines.push(
    'Pick items that match the character role. Not every slot needs to be filled — pick what makes sense.',
  );
  lines.push('Items with a [default: color] will use that color when color is null.');
  return lines.join('\n');
}

/**
 * Resolve a single ClothingSlot to a concrete layer selection.
 *
 * Looks up the item by key in the clothing catalog, resolves its pattern
 * against the manifest for the given body type, and applies the explicit color.
 * When color is null and the item has a defaultColor, applies the default.
 *
 * @param slotId - Slot ID from slot registry (e.g., "torso_under")
 * @param itemId - Clothing item key from clothing-data.json (e.g., "longsleeve")
 * @param color - Hex color string (e.g., "#8B4513") or null for default/no tint
 * @param bodyType - Body type for manifest lookup ("male" or "female")
 * @returns ResolvedSlot or null if item doesn't resolve for this body type
 */
export function resolveClothingSlot(
  slotId: string,
  itemId: string,
  color: string | null,
  bodyType: BodyType,
): ResolvedSlot | null {
  const data = loadClothingData();
  const item = data.clothing[itemId];
  const assetLayer = getSlotAssetLayer(slotId);
  const option = resolvePattern(assetLayer, item.pattern, bodyType);
  if (!option) return null;

  let tint: number | null = null;
  if (color) {
    tint = parseHexColor(color);
  } else if (item.defaultColor) {
    tint = CLOTHING_COLOR_HEX[item.defaultColor];
  }

  return {
    type: assetLayer,
    pattern: item.pattern,
    tint,
    ...(option.tintMode && { tintMode: option.tintMode }),
  };
}

/**
 * Resolve a clothing item's pattern to manifest option IDs per body type.
 * Requires manifest to be loaded (loadLPCManifest) before calling.
 *
 * @param item - Clothing item from catalog
 * @returns Record of body type to option ID (only includes body types that resolve)
 */
export function resolveClothingOptionIds(item: ClothingItem): Partial<Record<BodyType, string>> {
  const result: Partial<Record<BodyType, string>> = {};
  const assetLayer = getSlotAssetLayer(item.slot);
  const bodyTypes = getAvailableBodyTypes();

  for (const bodyType of bodyTypes) {
    const option = resolvePattern(assetLayer, item.pattern, bodyType);
    if (option) {
      result[bodyType] = option.id;
    }
  }
  return result;
}

/**
 * Try to resolve a pattern to a manifest option for the given layer and body type.
 * Uses the same matching logic as addLayer in character-sprite-helper:
 * 1. Exact ID match
 * 2. {type}_{pattern}_{bodyType} match
 * 3. {type}_{pattern} prefix match
 */
function resolvePattern(
  layerType: LPCLayerType,
  pattern: string,
  bodyType: BodyType,
): LPCAssetOption | null {
  const options = getLPCLayerOptions(layerType, bodyType);

  // Try exact match
  let option = options.find((o) => o.id === pattern);
  if (option) return option;

  // Try {type}_{pattern}_{bodyType}
  const withBodyType = `${layerType}_${pattern}_${bodyType}`;
  option = options.find((o) => o.id === withBodyType);
  if (option) return option;

  // Try {type}_{pattern} prefix
  const prefix = `${layerType}_${pattern}`;
  option = options.find((o) => o.id.startsWith(prefix));
  if (option) return option;

  return null;
}

/**
 * Parse a hex color string (e.g., "0x8B4513" or "#8B4513") to a number.
 */
function parseHexColor(hex: string): number {
  return parseInt(hex.replace(/^(0x|#)/, ''), 16);
}
