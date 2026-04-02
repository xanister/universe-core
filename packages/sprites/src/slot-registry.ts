/**
 * Slot Registry
 *
 * Game-level clothing slot definitions. Uses region + subOrder for render order.
 * No asset-format leakage — region-to-asset mapping is internal to this package.
 */

import type { ContainerConfig } from '@dmnpc/types/entity';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { LPCLayerType } from './types.js';
import { getLayerZIndex, getLayerOrder } from './lpc-assets.js';

export interface ClothingSlotDefinition {
  id: string;
  region: string;
  subOrder: number;
  container?: ContainerConfig;
}

export interface SlotRegistry {
  version: number;
  slots: ClothingSlotDefinition[];
}

let registry: SlotRegistry | null = null;
let registryInjected = false;

// Region to asset layer type (internal — no leakage of asset format to game layer)
const REGION_TO_ASSET_LAYER: Record<string, LPCLayerType> = {
  back: 'behind_body',
  feet: 'feet',
  legs: 'legs',
  torso: 'torso',
  waist: 'belt',
  hands: 'hands',
  head: 'head',
  neck: 'neck',
  face: 'accessories',
  weapon: 'weapon',
};

/**
 * Load slot registry from packages/data/sprites/slot-registry.json.
 */
export function loadSlotRegistry(): SlotRegistry {
  if (registry && (registryInjected || process.env.NODE_ENV === 'production')) return registry;

  const thisDir = dirname(fileURLToPath(import.meta.url));
  const registryPath = join(thisDir, '..', '..', 'data', 'sprites', 'slot-registry.json');
  registry = readJsonFileSync<SlotRegistry>(registryPath);
  registryInjected = false;
  return registry;
}

/**
 * Set slot registry directly (for testing).
 */
export function setSlotRegistry(data: SlotRegistry | null): void {
  registry = data;
  registryInjected = data !== null;
}

/**
 * Get slot ids in render order (back to front).
 */
export function getSlotOrder(): string[] {
  const data = loadSlotRegistry();
  return data.slots.map((s) => s.id);
}

/**
 * Get the asset layer type for a slot. Internal to sprites — maps region to asset type.
 */
export function getSlotAssetLayer(slotId: string): LPCLayerType {
  const data = loadSlotRegistry();
  const slot = data.slots.find((s) => s.id === slotId);
  if (!slot) {
    throw new Error(`Unknown slot ID "${slotId}" — not found in slot registry`);
  }
  const assetLayer = REGION_TO_ASSET_LAYER[slot.region];
  return assetLayer;
}

/**
 * Get z-index for a slot. Used when adding LayerConfig so multiple slots
 * in the same region (e.g. torso_under, torso_mid, torso_over, torso_top)
 * render in correct order.
 */
export function getSlotZIndex(slotId: string): number {
  const data = loadSlotRegistry();
  const slot = data.slots.find((s) => s.id === slotId);
  if (!slot) {
    const layerOrder = getLayerOrder();
    const idx = layerOrder.indexOf(slotId);
    return idx >= 0 ? idx : layerOrder.length;
  }
  const assetLayer = REGION_TO_ASSET_LAYER[slot.region];
  const base = getLayerZIndex(assetLayer);
  return base + slot.subOrder / 10;
}

/**
 * Check if a slot id exists in the registry.
 */
export function isValidSlot(slotId: string): boolean {
  const data = loadSlotRegistry();
  return data.slots.some((s) => s.id === slotId);
}
