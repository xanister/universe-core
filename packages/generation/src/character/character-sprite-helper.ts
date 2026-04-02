/**
 * Character Sprite Helper
 *
 * Maps character info (gender, hair color, etc.) to LPC layer configurations
 * and generates sprites via the sprite generation service.
 */

import { basename, join } from 'path';
import {
  loadLPCManifest,
  getLPCLayerOptions,
  getLPCAssetPath,
  EYE_COLORS,
  HAIR_COLORS,
  HEAD_TYPES,
  SKIN_COLORS,
  SKIN_COLOR_TINT_HEX,
  HAIR_COLOR_TINT_HEX,
  EYE_COLOR_TINT_HEX,
  loadClothingData,
  resolveClothingSlot,
  hasHidesHairHeadwear,
  getSlotZIndex,
  loadCharacterBasesManifest,
  loadSpriteArchetypes,
  getSpriteArchetype,
  resolveBodyType,
  isVariantFiltered,
  type LayerConfig,
  type BodyType,
  type HeadType,
  type SkinColor,
  type LPCLayerType,
  type LPCAssetOption,
  type EyeColor,
  type HairColor,
  type SpriteArchetype,
} from '@dmnpc/sprites';
import { LPC_SPRITES_DIR, WEAPONS_REGISTRY_PATH } from '@dmnpc/data';
import { getOrGenerateSprite } from '../media/sprite-generation-service.js';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type {
  CharacterInfo,
  CharacterSpriteConfig,
  ClothingSlot,
  SpriteLayerConfig,
  RaceDefinition,
} from '@dmnpc/types/entity';
import type { WeaponDefinition } from '@dmnpc/types/combat';

function isHairColor(val: string): val is HairColor {
  return (HAIR_COLORS as readonly string[]).includes(val);
}

function isEyeColor(val: string): val is EyeColor {
  return (EYE_COLORS as readonly string[]).includes(val);
}

function isHeadType(val: string): val is HeadType {
  return (HEAD_TYPES as readonly string[]).includes(val);
}

function isSkinColor(val: string): val is SkinColor {
  return (SKIN_COLORS as readonly string[]).includes(val);
}

let cachedWeaponManifestMap: Map<string, string | null> | null = null;

/** Resolve a weapon ID (e.g. "iron_sword") to its LPC manifest option ID. */
function resolveWeaponManifestOptionId(weaponId: string | null): string | null {
  if (!weaponId || weaponId === 'unarmed') return null;
  if (!cachedWeaponManifestMap) {
    const data = readJsonFileSync<{ weapons: WeaponDefinition[] }>(WEAPONS_REGISTRY_PATH);
    cachedWeaponManifestMap = new Map(data.weapons.map((w) => [w.id, w.manifestOptionId]));
  }
  return cachedWeaponManifestMap.get(weaponId) ?? null;
}

/** Subset of CharacterInfo fields used by buildV3LayerConfigs for sprite layer assembly. */
export interface SpriteCharacterInfo {
  enabledOverlayLayers: string[];
  eyeColor: string;
  hairColor: string;
  hairStyle: string;
  beardStyle: string | null;
  clothing: ClothingSlot[];
}

/** Fallback race definition for characters whose race isn't found in the universe. */
const FALLBACK_RACE_DEFINITION: RaceDefinition = {
  id: '_fallback',
  label: 'Unknown',
  description: 'Fallback race for sprite generation',
  rarity: 'common',
  spriteHints: {
    humanoidBody: true,
    spriteArchetype: 'human',
    defaultSkinColor: 'light',
    allowedSkinColors: ['light'],
    allowedEyeColors: null,
    allowedHairColors: null,
    spriteScale: 1,
    featureLayers: null,
  },
};

/**
 * Find a race definition by character race ID, or return a human fallback.
 * Exported for use by call sites that need to resolve race before calling generateCharacterSprite.
 */
export function findRaceOrFallback(races: RaceDefinition[], raceId: string): RaceDefinition {
  return races.find((r) => r.id === raceId) ?? FALLBACK_RACE_DEFINITION;
}

/**
 * Resolve and validate the skin palette configured for a race against its archetype.
 * Throws on invalid data contract; callers should only normalize user/LLM values, not contract errors.
 */
function getValidatedRaceSkinPalette(
  raceDefinition: RaceDefinition,
  archetype: SpriteArchetype,
): SkinColor[] {
  const hints = raceDefinition.spriteHints;
  if (!hints?.humanoidBody) {
    throw new Error(`Race "${raceDefinition.id}" is non-humanoid and has no skin palette`);
  }

  const invalidColors = hints.allowedSkinColors.filter((color) => !isSkinColor(color));
  if (invalidColors.length > 0) {
    throw new Error(
      `Race "${raceDefinition.id}" has invalid skin colors: ${invalidColors.join(', ')}`,
    );
  }

  const validatedSkinColors = hints.allowedSkinColors.filter((color): color is SkinColor =>
    isSkinColor(color),
  );
  const disallowedByArchetype = validatedSkinColors.filter(
    (color) => !archetype.allowedSkinColors.includes(color),
  );
  if (disallowedByArchetype.length > 0) {
    throw new Error(
      `Race "${raceDefinition.id}" declares colors not supported by archetype "${archetype.id}": ${disallowedByArchetype.join(', ')}`,
    );
  }

  return validatedSkinColors;
}

/**
 * Resolve the race's default skin color and assert it belongs to the race palette.
 */
function getValidatedRaceDefaultSkinColor(
  raceDefinition: RaceDefinition,
  allowedSkinColors: SkinColor[],
): SkinColor {
  const hints = raceDefinition.spriteHints;
  if (!hints?.humanoidBody || !isSkinColor(hints.defaultSkinColor)) {
    throw new Error(`Race "${raceDefinition.id}" has invalid default skin color`);
  }
  if (!allowedSkinColors.includes(hints.defaultSkinColor)) {
    throw new Error(
      `Race "${raceDefinition.id}" default skin color "${hints.defaultSkinColor}" is not in allowedSkinColors`,
    );
  }
  return hints.defaultSkinColor;
}

/**
 * Normalize a requested skin tone to the race-declared palette.
 * This intentionally coerces invalid user/LLM values to race defaults.
 */
export function normalizeSkinToneForRace(
  skinTone: string | null | undefined,
  raceDefinition: RaceDefinition,
): SkinColor {
  ensureManifest();
  const effectiveRaceDefinition = raceDefinition.spriteHints?.humanoidBody
    ? raceDefinition
    : FALLBACK_RACE_DEFINITION;
  const hints = effectiveRaceDefinition.spriteHints;
  if (!hints?.humanoidBody) {
    throw new Error(`Fallback race must be humanoid`);
  }

  const archetype = getSpriteArchetype(hints.spriteArchetype);
  if (!archetype) {
    throw new Error(
      `Unknown sprite archetype "${hints.spriteArchetype}" for race "${effectiveRaceDefinition.id}"`,
    );
  }

  const allowedSkinColors = getValidatedRaceSkinPalette(effectiveRaceDefinition, archetype);
  const defaultSkinColor = getValidatedRaceDefaultSkinColor(
    effectiveRaceDefinition,
    allowedSkinColors,
  );

  if (skinTone && isSkinColor(skinTone) && allowedSkinColors.includes(skinTone)) {
    return skinTone;
  }
  return defaultSkinColor;
}

/**
 * Normalize a requested eye color to the race-declared palette.
 * If the race has allowedEyeColors, coerce invalid values to the first allowed.
 * If the race has no constraints (null/empty), pass through if valid EyeColor, else default to 'brown'.
 */
export function normalizeEyeColorForRace(
  eyeColor: string | null | undefined,
  raceDefinition: RaceDefinition,
): EyeColor {
  const hints = raceDefinition.spriteHints;
  const allowedEyeColors = hints?.allowedEyeColors;

  if (allowedEyeColors && allowedEyeColors.length > 0) {
    // Race constrains eye colors
    if (eyeColor && isEyeColor(eyeColor) && allowedEyeColors.includes(eyeColor)) {
      return eyeColor;
    }
    // Fall back to first allowed value
    const fallback = allowedEyeColors[0];
    return isEyeColor(fallback) ? fallback : 'brown';
  }

  // No race constraint — pass through if valid
  if (eyeColor && isEyeColor(eyeColor)) {
    return eyeColor;
  }
  return 'brown';
}

/**
 * Normalize a requested hair color to the race-declared palette.
 * If the race has allowedHairColors, coerce invalid values to the first allowed.
 * If the race has no constraints (null/empty), pass through if valid HairColor, else default to 'brown'.
 */
export function normalizeHairColorForRace(
  hairColor: string | null | undefined,
  raceDefinition: RaceDefinition,
): HairColor {
  const hints = raceDefinition.spriteHints;
  const allowedHairColors = hints?.allowedHairColors;

  if (allowedHairColors && allowedHairColors.length > 0) {
    // Race constrains hair colors
    if (hairColor && isHairColor(hairColor) && allowedHairColors.includes(hairColor)) {
      return hairColor;
    }
    // Fall back to first allowed value
    const fallback = allowedHairColors[0];
    return isHairColor(fallback) ? fallback : 'brown';
  }

  // No race constraint — pass through if valid
  if (hairColor && isHairColor(hairColor)) {
    return hairColor;
  }
  return 'brown';
}

/**
 * Resolve the effective featureLayers for a race.
 * Uses race override if provided, otherwise falls back to the archetype's featureLayers.
 */
export function resolveFeatureLayers(
  raceDefinition: RaceDefinition,
): import('@dmnpc/types/entity').RaceFeatureLayer[] {
  ensureManifest();
  const archetypeId = raceDefinition.spriteHints?.spriteArchetype ?? 'human';
  const archetype = getSpriteArchetype(archetypeId);
  if (!archetype) return [];
  // Race featureLayers override takes precedence over archetype defaults
  return raceDefinition.spriteHints?.featureLayers ?? archetype.featureLayers;
}

/**
 * Compute overlay layers for auto-generated characters.
 * Returns layer types from featureLayers that have chance > 0.
 */
export function resolveAutoGenOverlayLayers(raceDefinition: RaceDefinition): string[] {
  const features = resolveFeatureLayers(raceDefinition);
  return features.filter((f) => f.chance > 0).map((f) => f.layerType);
}

/** Ensure manifest and clothing data are loaded */
let manifestLoaded = false;
function ensureManifest(): void {
  if (!manifestLoaded) {
    loadLPCManifest(LPC_SPRITES_DIR);
    loadClothingData();
    loadCharacterBasesManifest(LPC_SPRITES_DIR);
    loadSpriteArchetypes(LPC_SPRITES_DIR);
    manifestLoaded = true;
  }
}

/** Get the path to the character-bases v3 assets (lazy to avoid module-scope eval in tests) */
function getCharacterBasesDir(): string {
  return join(LPC_SPRITES_DIR, 'character-bases');
}

/**
 * Build LPC layer configs for a v3 character (separated body + head).
 *
 * Uses v3 character-bases assets for body and head, with existing clothing manifest
 * for overlay layers (eyes, nose, hair, clothing). The head's universal.png is tinted
 * to match the body's skin color since it has no per-skin variants.
 *
 * @param info - Character info with appearance details
 * @param archetype - Sprite archetype defining valid overlay layers
 * @param headType - V3 head type
 * @param bodyType - V3 body type (widened: male/female/muscular/skeleton/zombie)
 * @param skinColor - V3 skin color
 */
export function buildV3LayerConfigs(
  info: SpriteCharacterInfo,
  archetype: SpriteArchetype,
  headType: HeadType,
  bodyType: BodyType,
  skinColor: SkinColor,
): LayerConfig[] {
  ensureManifest();

  const layers: LayerConfig[] = [];

  // 1. Body layer from character-bases (white base, tinted to skin color)
  const basesDir = getCharacterBasesDir();
  const bodyPath = join(basesDir, 'bodies', bodyType, 'universal', 'base.png');
  const bodyTintHex = SKIN_COLOR_TINT_HEX[skinColor];
  layers.push({
    type: 'body',
    imageUrl: bodyPath,
    zIndex: 0,
    colorize: { type: 'tint', color: bodyTintHex },
  });

  // 2. Species head layer (single universal.png, tinted to match skin color)
  const headPath = join(basesDir, 'heads', headType, 'universal.png');
  const tintHex = SKIN_COLOR_TINT_HEX[skinColor];
  layers.push({
    type: 'body', // Uses body type for z-index sorting compatibility
    imageUrl: headPath,
    zIndex: 1, // Between body (0) and ears (2)
    colorize: { type: 'tint', color: tintHex },
  });

  // Map to male/female for manifest lookups (clothing/eyes/nose only exist for male/female)
  const manifestBodyType: 'male' | 'female' = bodyType === 'female' ? 'female' : 'male';

  // 3. Feature layers (ears, eyes, nose, etc.) — driven by archetype featureLayers
  //    Always-on features (chance > 0, not playerSelectable) are included automatically.
  //    Optional/player-selectable features use enabledOverlayLayers as the gate.
  for (const feature of archetype.featureLayers) {
    const isAlwaysOn = feature.chance > 0 && !feature.playerSelectable;
    if (!isAlwaysOn && !info.enabledOverlayLayers.includes(feature.layerType)) continue;

    const style = feature.styles[0];
    if (!style) continue;

    if (feature.layerType === 'eyes') {
      // Eyes: tinted by eye color with sclera threshold
      const eyeTintHex =
        info.eyeColor && isEyeColor(info.eyeColor)
          ? EYE_COLOR_TINT_HEX[info.eyeColor]
          : EYE_COLOR_TINT_HEX.brown;
      addManifestLayer(
        layers,
        'eyes',
        style,
        manifestBodyType,
        undefined,
        eyeTintHex,
        undefined,
        230,
      );
    } else if (isVariantFiltered(feature.layerType)) {
      // Variant-filtered layers (ears, nose) use skin tint
      const skinTintHex = SKIN_COLOR_TINT_HEX[skinColor];
      addManifestLayer(layers, feature.layerType, style, manifestBodyType, undefined, skinTintHex);
    } else if (feature.layerType === 'facial') {
      // Facial hair: use beardStyle from character info (null = clean-shaven, skip layer).
      // Always tint with hairColor.
      if (!info.beardStyle) continue;
      const beardTintHex =
        info.hairColor && isHairColor(info.hairColor)
          ? HAIR_COLOR_TINT_HEX[info.hairColor]
          : HAIR_COLOR_TINT_HEX.brown;
      addManifestLayer(
        layers,
        'facial',
        info.beardStyle,
        manifestBodyType,
        undefined,
        beardTintHex,
      );
    } else {
      // Non-variant layers (scars, markings, etc.) use hair tint
      const hairTintHex =
        info.hairColor && isHairColor(info.hairColor)
          ? HAIR_COLOR_TINT_HEX[info.hairColor]
          : HAIR_COLOR_TINT_HEX.brown;
      addManifestLayer(layers, feature.layerType, style, manifestBodyType, undefined, hairTintHex);
    }
  }

  // 5. Hair (available for all archetypes — hair assets sit on top of any head)
  //    Suppressed when equipped headwear has hidesHair flag (full helmets, enclosed hoods).
  //    Uses hairStyle directly for pattern matching; hairColor only determines tint.
  if (!hasHidesHairHeadwear(info.clothing)) {
    const hairTintHex =
      info.hairColor && isHairColor(info.hairColor)
        ? HAIR_COLOR_TINT_HEX[info.hairColor]
        : HAIR_COLOR_TINT_HEX.brown;
    const hairPattern = info.hairStyle;
    addManifestLayer(layers, 'hair', hairPattern, manifestBodyType, undefined, hairTintHex);
  }

  // 6. Equipment (clothing + weapon — all slots resolved through unified pipeline)
  const clothingBodyType: 'male' | 'female' = bodyType === 'female' ? 'female' : 'male';
  for (const slot of info.clothing) {
    if (slot.slot === 'weapon') {
      const manifestOptionId = resolveWeaponManifestOptionId(slot.itemId);
      if (manifestOptionId) {
        addManifestLayer(
          layers,
          'weapon',
          manifestOptionId,
          clothingBodyType,
          undefined,
          null,
          getSlotZIndex('weapon'),
        );
      }
    } else {
      const resolved = resolveClothingSlot(slot.slot, slot.itemId, slot.color, clothingBodyType);
      if (resolved) {
        addManifestLayer(
          layers,
          resolved.type,
          resolved.pattern,
          clothingBodyType,
          undefined,
          resolved.tint,
          getSlotZIndex(slot.slot),
        );
      }
    }
  }

  logger.info(
    'CharacterSprite',
    `Built ${layers.length} v3 layers: body=${bodyType} head=${headType} skin=${skinColor} archetype=${archetype.id} equipment=${info.clothing.length} slots`,
  );
  return layers;
}

/**
 * Helper: add a layer from the manifest by pattern matching.
 */
function addManifestLayer(
  layers: LayerConfig[],
  type: LPCLayerType,
  optionIdPattern: string,
  bodyType: 'male' | 'female',
  variant?: string,
  tint?: number | null,
  zIndex?: number,
  tintThreshold?: number,
): void {
  const options = variant
    ? getLPCLayerOptions(type, bodyType).filter((o) => o.variant === variant || !o.variant)
    : getLPCLayerOptions(type, bodyType);

  let option = options.find((o: LPCAssetOption) => o.id === optionIdPattern);

  if (!option) {
    const patternWithBodyType = `${type}_${optionIdPattern}_${bodyType}`;
    option = options.find((o: LPCAssetOption) => o.id === patternWithBodyType);
  }

  if (!option) {
    const patternSimple = `${type}_${optionIdPattern}`;
    option = options.find((o: LPCAssetOption) => o.id.startsWith(patternSimple));
  }

  if (!option && options.length > 0) {
    option = options[0];
  }

  if (option) {
    const config: LayerConfig = {
      type,
      imageUrl: getLPCAssetPath(option, bodyType),
    };
    if (tint != null) {
      config.colorize = {
        type: 'tint',
        color: tint,
        ...(option.tintMode && { tintMode: option.tintMode }),
        ...(tintThreshold !== undefined && { threshold: tintThreshold }),
      };
    }
    if (zIndex !== undefined) {
      config.zIndex = zIndex;
    }
    layers.push(config);
  }
}

/**
 * Convert LayerConfig[] to SpriteLayerConfig[] for storage.
 *
 * The optionId format is `{layerType}_{filename}` to match manifest IDs.
 * e.g., for type="hair" and path="male/hair/bangs.png" -> "hair_bangs"
 */
function toSpriteLayerConfigs(layers: LayerConfig[]): SpriteLayerConfig[] {
  return layers.map((layer) => {
    const filename = basename(layer.imageUrl, '.png');
    const normalizedFilename = filename.replace(/-/g, '_').toLowerCase();
    const optionId = `${layer.type}_${normalizedFilename}`;

    const tint = layer.colorize && layer.colorize.type === 'tint' ? layer.colorize.color : null;
    const config: SpriteLayerConfig = {
      type: layer.type,
      optionId,
      tint,
    };
    return config;
  });
}

/**
 * Generate a sprite for a character and return the config to store.
 *
 * Uses the v3 character-bases pipeline with separated body + head.
 * Resolves head type, body type, and skin color from the character's race archetype.
 *
 * @param info - Character info with appearance details (must have headType set)
 * @param raceDefinition - Race definition with spriteArchetype for archetype resolution
 * @returns CharacterSpriteConfig with spriteUrl and spriteHash
 */
export async function generateCharacterSprite(
  info: CharacterInfo,
  raceDefinition: RaceDefinition,
): Promise<CharacterSpriteConfig> {
  ensureManifest();

  const effectiveRaceDefinition = raceDefinition.spriteHints?.humanoidBody
    ? raceDefinition
    : FALLBACK_RACE_DEFINITION;
  const hints = effectiveRaceDefinition.spriteHints;
  if (!hints?.humanoidBody) {
    throw new Error(`Fallback race must be humanoid`);
  }

  const archetypeId = hints.spriteArchetype;
  const archetype = getSpriteArchetype(archetypeId);
  if (!archetype) {
    throw new Error(
      `Unknown sprite archetype "${archetypeId}" for race "${effectiveRaceDefinition.id}"`,
    );
  }

  const rawHeadType = info.headType;
  if (!isHeadType(rawHeadType)) {
    throw new Error(`Invalid head type "${rawHeadType}" for character`);
  }
  const headType = rawHeadType;
  const bodyType = resolveBodyType(archetype, info.gender);
  const skinColor = normalizeSkinToneForRace(info.skinTone, effectiveRaceDefinition);

  const spriteInfo: SpriteCharacterInfo = {
    enabledOverlayLayers: info.enabledOverlayLayers,
    eyeColor: info.eyeColor,
    hairColor: info.hairColor,
    hairStyle: info.hairStyle,
    beardStyle: info.beardStyle,
    clothing: info.clothing,
  };

  const layers = buildV3LayerConfigs(spriteInfo, archetype, headType, bodyType, skinColor);

  logger.info(
    'CharacterSprite',
    `Generating v3 sprite: body=${bodyType} head=${headType} skin=${skinColor} archetype=${archetypeId} layers=${layers.length}`,
  );

  const result = await getOrGenerateSprite(layers);

  logger.info(
    'CharacterSprite',
    `Sprite generated=${result.generated} hash=${result.hash} url=${result.url}`,
  );

  return {
    bodyType,
    layers: toSpriteLayerConfigs(layers),
    spriteHash: result.hash,
    spriteUrl: result.url,
    spriteScale: hints.spriteScale,
  };
}
