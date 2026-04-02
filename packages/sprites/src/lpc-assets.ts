/**
 * LPC Asset Utilities
 *
 * Functions for working with LPC sprite assets.
 * Supports both file system paths (Node.js) and URLs (browser).
 */

import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { pickRandomElement, randomInt } from '@dmnpc/core/infra/random-utils.js';
import { join } from 'path';
import type {
  LPCAssetManifest,
  LPCLayerManifest,
  LPCAssetOption,
  LPCLayerType,
  LayerConfig,
  BodyType,
  CharacterBasesManifest,
} from './types.js';

let currentManifest: LPCAssetManifest | null = null;
let currentBasePath: string | null = null;
let currentCharacterBasesManifest: CharacterBasesManifest | null = null;
let manifestInjected = false;
let characterBasesManifestInjected = false;

/**
 * Load the LPC asset manifest from the file system.
 * Call this once at app startup.
 *
 * @param basePath - Absolute path to the LPC assets directory (containing manifest.json)
 */
export function loadLPCManifest(basePath: string): LPCAssetManifest {
  if (
    currentManifest &&
    currentBasePath === basePath &&
    (manifestInjected || process.env.NODE_ENV === 'production')
  ) {
    return currentManifest;
  }

  const manifestPath = join(basePath, 'manifest.json');
  currentManifest = readJsonFileSync<LPCAssetManifest>(manifestPath);
  currentBasePath = basePath;
  manifestInjected = false;

  return currentManifest;
}

/**
 * Get the current manifest (must call loadLPCManifest first).
 */
export function getLPCAssetManifest(): LPCAssetManifest {
  if (!currentManifest) {
    throw new Error('LPC manifest not loaded. Call loadLPCManifest() first.');
  }
  return currentManifest;
}

/**
 * Set a custom manifest (for testing or custom assets).
 */
export function setLPCAssetManifest(manifest: LPCAssetManifest): void {
  currentManifest = manifest;
  manifestInjected = true;
}

/**
 * Get the z-index for a layer type from the manifest.
 * Returns the total layer count (renders on top) for unknown types.
 */
export function getLayerZIndex(layerType: string): number {
  const manifest = getLPCAssetManifest();
  const layer = manifest.layers.find((l) => l.type === layerType);
  return layer?.zIndex ?? manifest.layers.length;
}

/**
 * Get all layer types sorted by z-index (back to front).
 */
export function getLayerOrder(): string[] {
  const manifest = getLPCAssetManifest();
  return [...manifest.layers].sort((a, b) => a.zIndex - b.zIndex).map((l) => l.type);
}

/**
 * Check whether a layer type is variant-filtered (options filtered by species variant).
 */
export function isVariantFiltered(layerType: string): boolean {
  const manifest = getLPCAssetManifest();
  const layer = manifest.layers.find((l) => l.type === layerType);
  return layer?.variantFiltered ?? false;
}

/**
 * Check whether a layer type requires body-type-specific assets.
 */
export function isBodyTypeSpecific(layerType: string): boolean {
  const manifest = getLPCAssetManifest();
  const layer = manifest.layers.find((l) => l.type === layerType);
  return layer?.bodyTypeSpecific ?? false;
}

/**
 * Get all layer types matching a given slotKind ('body', 'feature', 'wearable').
 */
export function getLayersBySlotKind(kind: string): string[] {
  const manifest = getLPCAssetManifest();
  return manifest.layers.filter((l) => l.slotKind === kind).map((l) => l.type);
}

/**
 * Get the layer manifest for a specific layer type.
 */
export function getLPCLayerManifest(layerType: LPCLayerType): LPCLayerManifest | undefined {
  const manifest = getLPCAssetManifest();
  return manifest.layers.find((l: LPCLayerManifest) => l.type === layerType);
}

/**
 * Get all available body types from the manifest.
 */
export function getAvailableBodyTypes(): BodyType[] {
  const manifest = getLPCAssetManifest();
  return manifest.bodyTypes ?? ['male', 'female'];
}

/**
 * Check if an asset option has a sprite for the given body type.
 */
function hasBodyTypeSprite(option: LPCAssetOption, bodyType: BodyType): boolean {
  if (option.bodyTypeOverrides?.[bodyType]) {
    return true;
  }

  const path = option.path.toLowerCase();
  if (path.includes('/either/') || path.startsWith('either/')) {
    return true;
  }
  if (bodyType === 'male' && (path.includes('/male/') || path.startsWith('male/'))) {
    return true;
  }
  if (bodyType === 'female' && (path.includes('/female/') || path.startsWith('female/'))) {
    return true;
  }

  return false;
}

/**
 * Get available options for a layer type, optionally filtered by body type.
 */
export function getLPCLayerOptions(layerType: LPCLayerType, bodyType?: BodyType): LPCAssetOption[] {
  const layer = getLPCLayerManifest(layerType);
  if (!layer) return [];

  if (!bodyType) {
    return layer.options;
  }

  if (isBodyTypeSpecific(layerType)) {
    return layer.options.filter((option: LPCAssetOption) => {
      if (!option.bodyType) {
        return true;
      }
      return option.bodyType === bodyType;
    });
  }

  return layer.options.filter((option: LPCAssetOption) => hasBodyTypeSprite(option, bodyType));
}

/**
 * Get options with full filtering (body type and variant).
 */
export function getLPCLayerOptionsFiltered(
  layerType: LPCLayerType,
  bodyType?: BodyType,
  bodyVariant?: string,
): LPCAssetOption[] {
  let options = getLPCLayerOptions(layerType, bodyType);

  if (isVariantFiltered(layerType)) {
    if (bodyVariant) {
      const variantOptions = options.filter((o) => o.variant === bodyVariant);
      if (variantOptions.length > 0) {
        options = variantOptions;
      } else {
        options = options.filter((o) => !o.variant);
      }
    } else {
      options = options.filter((o) => !o.variant);
    }
  }

  return options;
}

/**
 * Get a specific asset option by ID.
 */
export function getLPCAssetOption(
  layerType: LPCLayerType,
  optionId: string,
  bodyType?: BodyType,
): LPCAssetOption | undefined {
  const options = getLPCLayerOptions(layerType, bodyType);
  return options.find((o) => o.id === optionId);
}

/**
 * Build the full file path for an asset option.
 *
 * @param option - The asset option
 * @param bodyType - Optional body type for body-specific overrides
 * @returns Absolute file path to the asset image
 */
export function getLPCAssetPath(option: LPCAssetOption, bodyType?: BodyType): string {
  if (!currentBasePath) {
    throw new Error('LPC manifest not loaded. Call loadLPCManifest() first.');
  }

  let assetPath = option.path;

  if (bodyType && option.bodyTypeOverrides?.[bodyType]) {
    assetPath = option.bodyTypeOverrides[bodyType];
  }

  return join(currentBasePath, assetPath);
}

/**
 * Get a default character configuration.
 */
export function getLPCDefaultCharacter(bodyType?: BodyType): LayerConfig[] {
  const defaultSelections: [LPCLayerType, string][] = [
    ['body', 'light'],
    ['legs', 'pants_white'],
    ['torso', 'shirt_white'],
    ['hair', 'messy_brown'],
    ['feet', 'shoes_brown'],
  ];

  const layers: LayerConfig[] = [];

  for (const [layerType, optionId] of defaultSelections) {
    let option = getLPCAssetOption(layerType, optionId, bodyType);

    if (!option && bodyType) {
      const availableOptions = getLPCLayerOptions(layerType, bodyType);
      option = availableOptions[0];
    }

    if (option) {
      layers.push({
        type: layerType,
        imageUrl: getLPCAssetPath(option, bodyType),
      });
    }
  }

  return layers;
}

/**
 * Create a LayerConfig from a layer type and option ID.
 */
export function createLayerConfig(
  layerType: LPCLayerType,
  optionId: string,
  options?: { tint?: number; bodyType?: BodyType },
): LayerConfig | null {
  const assetOption = getLPCAssetOption(layerType, optionId, options?.bodyType);
  if (!assetOption) return null;

  const config: LayerConfig = {
    type: layerType,
    imageUrl: getLPCAssetPath(assetOption, options?.bodyType),
  };

  if (options?.tint !== undefined && assetOption.tintable) {
    config.colorize = { type: 'tint', color: options.tint };
  }

  return config;
}

/**
 * Load the v3 character bases manifest.
 * Call once at app startup.
 *
 * @param basePath - Absolute path to the LPC assets directory (containing character-bases-manifest.json)
 */
export function loadCharacterBasesManifest(basePath: string): CharacterBasesManifest {
  if (
    currentCharacterBasesManifest &&
    (characterBasesManifestInjected || process.env.NODE_ENV === 'production')
  )
    return currentCharacterBasesManifest;

  const manifestPath = join(basePath, 'character-bases-manifest.json');
  currentCharacterBasesManifest = readJsonFileSync<CharacterBasesManifest>(manifestPath);
  characterBasesManifestInjected = false;
  return currentCharacterBasesManifest;
}

/**
 * Get the current character bases manifest (must call loadCharacterBasesManifest first).
 */
export function getCharacterBasesManifest(): CharacterBasesManifest {
  if (!currentCharacterBasesManifest) {
    throw new Error(
      'Character bases manifest not loaded. Call loadCharacterBasesManifest() first.',
    );
  }
  return currentCharacterBasesManifest;
}

/**
 * Set a custom character bases manifest (for testing).
 */
export function setCharacterBasesManifest(manifest: CharacterBasesManifest): void {
  currentCharacterBasesManifest = manifest;
  characterBasesManifestInjected = true;
}

/**
 * Get a random character configuration.
 */
export function getRandomCharacter(bodyType?: BodyType): LayerConfig[] {
  const manifest = getLPCAssetManifest();
  const layers: LayerConfig[] = [];

  for (const layerManifest of manifest.layers) {
    const availableOptions = getLPCLayerOptions(layerManifest.type, bodyType);

    if (availableOptions.length === 0) {
      continue;
    }

    if (!layerManifest.optional) {
      const randomOption = pickRandomElement(availableOptions);
      layers.push({
        type: layerManifest.type,
        imageUrl: getLPCAssetPath(randomOption, bodyType),
      });
      continue;
    }

    if (Math.random() > 0.5) {
      const randomOption = pickRandomElement(availableOptions);

      const config: LayerConfig = {
        type: layerManifest.type,
        imageUrl: getLPCAssetPath(randomOption, bodyType),
      };

      if (randomOption.tintable && Math.random() > 0.7) {
        config.colorize = {
          type: 'tint',
          color: randomInt(0, 0xffffff),
        };
      }

      layers.push(config);
    }
  }

  return layers;
}

/**
 * Get available hair styles from the manifest.
 * Returns deduplicated style pattern names by stripping the `hair_` prefix and
 * body-type suffixes (`_male`, `_female`). Only includes entries that have
 * a base (non-suffixed) manifest entry.
 *
 * Returns `{ id, label }[]` sorted by label.
 */
export function getAvailableHairStyles(): Array<{ id: string; label: string }> {
  if (!currentManifest) return [];

  const hairLayer = currentManifest.layers.find((l: LPCLayerManifest) => l.type === 'hair');
  if (!hairLayer) return [];

  const seen = new Set<string>();
  const styles: Array<{ id: string; label: string }> = [];

  for (const option of hairLayer.options) {
    // Skip body-type-specific variants (e.g., hair_bangs_female) — the base entry covers both
    if (option.id.endsWith('_female') || option.id.endsWith('_male')) continue;
    // Skip shadow/scrunchie utility entries
    if (option.id.includes('shadow')) continue;
    if (option.id.includes('scrunchie')) continue;
    const patternName = option.id.replace(/^hair_/, '');
    if (seen.has(patternName)) continue;
    seen.add(patternName);

    const label = patternName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c: string) => c.toUpperCase())
      .replace(/(\d)/g, ' $1')
      .trim();

    styles.push({ id: patternName, label });
  }

  return styles.sort((a, b) => a.label.localeCompare(b.label));
}
