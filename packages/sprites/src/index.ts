/**
 * @dmnpc/sprites
 *
 * LPC sprite generation utilities for the DMNPC game engine.
 */

// Types
export type {
  FacingDirection,
  AnimationState,
  BodyType,
  HeadType,
  LPCLayerType,
  ColorizeOptions,
  LayerConfig,
  LPCAssetOption,
  LPCLayerManifest,
  LPCAssetManifest,
  CompositeSpriteData,
  GenerateOptions,
  SkinTone,
  SkinColor,
  EyeColor,
  HairColor,
  HairStyle,
  BeardStyle,
  ClothingColor,
  CharacterBaseAnimationInfo,
  CharacterBaseTypeInfo,
  CharacterBasesManifest,
  SpriteArchetype,
} from './types.js';

export {
  HEAD_TYPES,
  SKIN_TONES,
  SKIN_COLORS,
  SKIN_COLOR_TINT_HEX,
  SKIN_TONE_TO_COLOR,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  BEARD_STYLES,
  HAIR_COLOR_TINT_HEX,
  EYE_COLOR_TINT_HEX,
  CLOTHING_COLORS,
  CLOTHING_COLOR_HEX,
} from './types.js';

// LPC Asset utilities
export {
  loadLPCManifest,
  getLPCAssetManifest,
  setLPCAssetManifest,
  getLPCLayerManifest,
  getAvailableBodyTypes,
  getLPCLayerOptions,
  getLPCLayerOptionsFiltered,
  getLPCAssetOption,
  getLPCAssetPath,
  getLPCDefaultCharacter,
  createLayerConfig,
  getRandomCharacter,
  loadCharacterBasesManifest,
  getCharacterBasesManifest,
  setCharacterBasesManifest,
  getLayerZIndex,
  getLayerOrder,
  isVariantFiltered,
  isBodyTypeSpecific,
  getLayersBySlotKind,
  getAvailableHairStyles,
} from './lpc-assets.js';

// Sprite archetype registry
export {
  loadSpriteArchetypes,
  setSpriteArchetypes,
  getSpriteArchetypes,
  getSpriteArchetype,
  getPlayerSelectableArchetypes,
  resolveHeadType,
  resolveBodyType,
  getEnabledOverlayLayerTypes,
} from './sprite-archetypes.js';

// Composite sprite generation
export { generateCompositeSprite, computeLayerConfigHash } from './composite.js';

// Slot registry
export type { ClothingSlotDefinition, SlotRegistry } from './slot-registry.js';
export {
  loadSlotRegistry,
  setSlotRegistry,
  getSlotOrder,
  getSlotAssetLayer,
  getSlotZIndex,
  isValidSlot,
} from './slot-registry.js';

// Clothing system
export type { ClothingItem, ClothingCatalogData, ResolvedSlot } from './clothing-catalog.js';

export {
  loadClothingData,
  setClothingData,
  findClothingByTags,
  hasHidesHairHeadwear,
  resolveClothingSlot,
  resolveClothingOptionIds,
  getClothingCatalogForPrompt,
  getClothingItemKeys,
} from './clothing-catalog.js';

// Interior asset utilities
export type {
  TileDefinition,
  TilesetConfig,
  SpritesheetConfig,
  SpritesheetObjectConfig,
  InteriorManifest,
} from './interior-assets.js';

export {
  loadInteriorManifest,
  getInteriorManifest,
  setInteriorManifest,
  getFloorTileset,
  getFloorTilesetPath,
  getTileCoordinates,
  getFloorTileName,
  getWallTileName,
  getObjectSpriteConfig,
  getSpritesheetPath,
  getSpritesheetKeys,
  getObjectSpriteFrame,
  hasObjectSprite,
  getObjectTypesWithSprites,
  getInteriorAssetsBaseUrl,
  getSpritesheetUrl,
  getFloorTilesetUrl,
} from './interior-assets.js';
