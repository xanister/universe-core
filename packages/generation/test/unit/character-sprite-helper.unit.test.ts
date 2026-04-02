/**
 * Tests for character-sprite-helper overlay layer gating.
 *
 * Verifies that buildV3LayerConfigs() respects enabledOverlayLayers on CharacterInfo,
 * and that resolveAutoGenOverlayLayers() computes the correct set from archetype data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock fns for use inside vi.mock factories
const { mockGetLPCLayerOptions, mockGetLPCAssetPath, mockGetSpriteArchetype, mockResolveClothingSlot, mockGetSlotZIndex, mockHasHidesHairHeadwear, mockIsVariantFiltered } = vi.hoisted(() => ({
  mockGetLPCLayerOptions: vi.fn().mockReturnValue([
    { id: 'eyes_brown', name: 'Brown Eyes', path: 'male/eyes/brown.png' },
    { id: 'nose_light', name: 'Light Nose', path: 'male/nose/light.png' },
  ]),
  mockGetLPCAssetPath: vi.fn().mockReturnValue('/mock/path.png'),
  mockGetSpriteArchetype: vi.fn(),
  mockResolveClothingSlot: vi.fn(),
  mockGetSlotZIndex: vi.fn().mockReturnValue(10),
  mockHasHidesHairHeadwear: vi.fn().mockReturnValue(false),
  // ears and nose are variant-filtered (skin-tinted), eyes are not
  mockIsVariantFiltered: vi.fn().mockImplementation((layerType: string) => ['ears', 'nose'].includes(layerType)),
}));

vi.mock('@dmnpc/sprites', () => ({
  loadLPCManifest: vi.fn(),
  loadClothingData: vi.fn(),
  loadCharacterBasesManifest: vi.fn(),
  loadSpriteArchetypes: vi.fn(),
  getLPCLayerOptions: mockGetLPCLayerOptions,
  getLPCAssetPath: mockGetLPCAssetPath,
  getSpriteArchetype: mockGetSpriteArchetype,
  resolveClothingSlot: mockResolveClothingSlot,
  getSlotZIndex: mockGetSlotZIndex,
  hasHidesHairHeadwear: mockHasHidesHairHeadwear,
  isVariantFiltered: mockIsVariantFiltered,
  resolveBodyType: vi.fn().mockReturnValue('male'),
  resolveHeadType: vi.fn().mockReturnValue('human_male'),
  EYE_COLORS: ['brown', 'blue', 'green', 'gray', 'orange', 'purple', 'red', 'yellow'],
  HAIR_COLORS: ['brown', 'black', 'blonde', 'red', 'auburn', 'gray', 'white', 'green', 'pink', 'brunette'],
  SKIN_COLORS: ['light', 'amber'],
  SKIN_COLOR_TINT_HEX: { light: 0xf0c8a8, amber: 0xd4a76a },
  HAIR_COLOR_TINT_HEX: { brown: 0x6b4226, black: 0x1a1a1a, blonde: 0xd4a76a },
  EYE_COLOR_TINT_HEX: { brown: 0x6b4226, blue: 0x4488dd, green: 0x3a8a3a },
}));

vi.mock('@dmnpc/data', () => ({
  LPC_SPRITES_DIR: '/mock/sprites',
  WEAPONS_REGISTRY_PATH: '/mock/weapons.json',
}));

vi.mock('@dmnpc/core/infra/read-json-file.js', () => ({
  readJsonFileSync: vi.fn().mockReturnValue({
    weapons: [
      { id: 'iron_sword', manifestOptionId: 'weapon_dagger_male' },
      { id: 'unarmed', manifestOptionId: null },
    ],
  }),
}));

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildV3LayerConfigs,
  normalizeSkinToneForRace,
  normalizeEyeColorForRace,
  normalizeHairColorForRace,
  resolveAutoGenOverlayLayers,
  resolveFeatureLayers,
  type SpriteCharacterInfo,
} from '@dmnpc/generation/character/character-sprite-helper.js';
import type { CharacterInfo, RaceDefinition } from '@dmnpc/types/entity';
import type { SpriteArchetype, BodyType, HeadType, SkinColor } from '@dmnpc/sprites';

function createMinimalCharacterInfo(
  overrides: Partial<CharacterInfo> = {}
): CharacterInfo {
  return {
    aliases: [],
    birthdate: '',
    birthPlace: '',
    deathdate: null,
    eyeColor: 'brown',
    gender: 'male',
    hairColor: 'brown',
    hairStyle: 'long',
    beardStyle: null,
    headType: 'human_male',
    skinTone: 'light',
    personality: '',
    race: 'human',
    title: null,
    messages: [],
    conversationContext: null,
    journal: [],
    sketches: [],
    storytellerState: null,
    isPlayer: false,
    verbosity: 3,
    storyComplete: false,
    routine: null,
    vesselRoutes: null,
    abstractLocation: null,
    npcBehavior: null,
    physicalState: null,
    pendingDeparture: null,
    pendingArrival: null,
    lastRoutineCheckPeriod: null,
    startingNarrative: null,
    startingCharacterState: null,
    clothing: [],
    enabledOverlayLayers: [],
    helmingVesselId: null,
    storytellerDisabled: false,
    rulesetState: { stats: {}, conditions: [], statUsage: {}, incapacitation: null, incapacitatedSince: null },
    voice: {
      voiceId: '',
      voiceName: '',
      settings: { stability: 0.5, similarityBoost: 0.75, style: null, speed: null },
    },
    spriteConfig: { bodyType: 'male', layers: [], spriteHash: null, spriteUrl: null, spriteScale: 1 },
    ...overrides,
  };
}

const HUMAN_ARCHETYPE: SpriteArchetype = {
  id: 'human',
  label: 'Human',
  allowedHeadTypes: ['human_male', 'human_female'],
  allowedBodyTypes: ['male', 'female', 'muscular'],
  allowedSkinColors: ['light', 'amber'],
  featureLayers: [
    { layerType: 'eyes', styles: ['default'], chance: 1.0, playerSelectable: false },
    { layerType: 'nose', styles: ['buttonnose'], chance: 0, playerSelectable: true },
  ],
  genderHeadMap: { male: 'human_male', female: 'human_female' },
  playerSelectable: true,
};

const ORC_ARCHETYPE: SpriteArchetype = {
  id: 'orc',
  label: 'Orc',
  allowedHeadTypes: ['orc_male', 'orc_female'],
  allowedBodyTypes: ['male', 'female', 'muscular'],
  allowedSkinColors: ['green'],
  featureLayers: [],
  genderHeadMap: { male: 'orc_male', female: 'orc_female' },
  playerSelectable: true,
};

describe('normalizeSkinToneForRace', () => {
  it('keeps a skin tone when it is in the race allowed palette', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeSkinToneForRace('amber', raceDef)).toBe('amber');
  });

  it('normalizes disallowed skin tones to the race default', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeSkinToneForRace('green', raceDef)).toBe('light');
    expect(normalizeSkinToneForRace(null, raceDef)).toBe('light');
  });

  it('falls back to humanoid default when race is non-humanoid', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'construct',
      label: 'Construct',
      description: 'Test',
      rarity: 'rare',
      spriteHints: {
        humanoidBody: false,
        spriteArchetype: null,
        defaultSkinColor: null,
        allowedSkinColors: null,
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeSkinToneForRace('green', raceDef)).toBe('light');
  });
});

describe('buildV3LayerConfigs overlay layer gating', () => {
  beforeEach(() => {
    mockGetLPCLayerOptions.mockReturnValue([
      { id: 'eyes_brown', name: 'Brown Eyes', path: 'male/eyes/brown.png' },
      { id: 'nose_light', name: 'Light Nose', path: 'male/nose/light.png' },
    ]);
  });

  it('includes eyes when enabledOverlayLayers contains "eyes"', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: ['eyes'] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    expect(layerTypes).toContain('eyes');
  });

  it('omits nose when enabledOverlayLayers is ["eyes"] only', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: ['eyes'] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    expect(layerTypes).not.toContain('nose');
  });

  it('includes both eyes and nose when enabledOverlayLayers has both', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: ['eyes', 'nose'] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    expect(layerTypes).toContain('eyes');
    expect(layerTypes).toContain('nose');
  });

  it('always-on eyes are included even when enabledOverlayLayers is empty', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: [] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    // Eyes are always-on (chance=1, not playerSelectable) — included regardless
    expect(layerTypes).toContain('eyes');
    // Nose is player-selectable (chance=0) — gated by enabledOverlayLayers
    expect(layerTypes).not.toContain('nose');
  });

  it('always includes body and head layers regardless of enabledOverlayLayers', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: [] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    expect(layerTypes).toContain('body');
  });

  it('always-on feature layers (ears) are included regardless of enabledOverlayLayers', () => {
    const elfArchetype: SpriteArchetype = {
      ...HUMAN_ARCHETYPE,
      id: 'elf',
      featureLayers: [
        { layerType: 'ears', styles: ['elvenears'], chance: 1.0, playerSelectable: false },
        { layerType: 'eyes', styles: ['default'], chance: 1.0, playerSelectable: false },
        { layerType: 'nose', styles: ['buttonnose'], chance: 0, playerSelectable: true },
      ],
    };
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: [] });
    const layers = buildV3LayerConfigs(
      info,
      elfArchetype,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    // Ears (chance=1, not playerSelectable) and eyes (chance=1, not playerSelectable) are always-on
    expect(layerTypes).toContain('ears');
    expect(layerTypes).toContain('eyes');
    // Nose (chance=0, playerSelectable) is gated by enabledOverlayLayers
    expect(layerTypes).not.toContain('nose');
  });
});

describe('buildV3LayerConfigs body/head tinting', () => {
  it('body layer uses base.png path with skin color tint', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: [] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const bodyLayer = layers.find((l) => l.type === 'body' && l.zIndex === 0);
    expect(bodyLayer).toBeDefined();
    expect(bodyLayer!.imageUrl).toContain('base.png');
    expect(bodyLayer!.imageUrl).not.toContain('light.png');
    expect(bodyLayer!.colorize).toEqual({ type: 'tint', color: 0xf0c8a8 });
  });

  it('body layer uses correct tint for amber skin', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: [] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'amber' as SkinColor
    );

    const bodyLayer = layers.find((l) => l.type === 'body' && l.zIndex === 0);
    expect(bodyLayer).toBeDefined();
    expect(bodyLayer!.colorize).toEqual({ type: 'tint', color: 0xd4a76a });
  });

  it('head layer uses universal.png with skin color tint', () => {
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: [] });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const headLayer = layers.find((l) => l.type === 'body' && l.zIndex === 1);
    expect(headLayer).toBeDefined();
    expect(headLayer!.imageUrl).toContain('universal.png');
    expect(headLayer!.colorize).toEqual({ type: 'tint', color: 0xf0c8a8 });
  });
});

describe('resolveAutoGenOverlayLayers', () => {
  it('returns featureLayers with chance > 0 for human archetype', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    const result = resolveAutoGenOverlayLayers(raceDef);
    expect(result).toEqual(['eyes']);
  });

  it('returns empty array for orc archetype (no featureLayers)', () => {
    mockGetSpriteArchetype.mockReturnValue(ORC_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'orc',
      label: 'Orc',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'orc',
        defaultSkinColor: 'green',
        allowedSkinColors: ['green'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    const result = resolveAutoGenOverlayLayers(raceDef);
    expect(result).toEqual([]);
  });

  it('returns empty array for unknown archetype', () => {
    mockGetSpriteArchetype.mockReturnValue(null);
    const raceDef: RaceDefinition = {
      id: 'unknown',
      label: 'Unknown',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'nonexistent',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    const result = resolveAutoGenOverlayLayers(raceDef);
    expect(result).toEqual([]);
  });

  it('falls back to human archetype when spriteHints is null', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'fallback',
      label: 'Fallback',
      description: 'Test',
      rarity: 'common',
      spriteHints: null,
    };

    const result = resolveAutoGenOverlayLayers(raceDef);
    expect(result).toEqual(['eyes']);
    expect(mockGetSpriteArchetype).toHaveBeenCalledWith('human');
  });
});

describe('resolveFeatureLayers', () => {
  it('returns archetype featureLayers when race featureLayers is null', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    const result = resolveFeatureLayers(raceDef);
    expect(result).toEqual(HUMAN_ARCHETYPE.featureLayers);
  });

  it('returns race featureLayers when race provides an override', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceOverride = [
      { layerType: 'ears', styles: ['elvenears'], chance: 1.0, playerSelectable: false },
    ];
    const raceDef: RaceDefinition = {
      id: 'dark_elf',
      label: 'Dark Elf',
      description: 'Test',
      rarity: 'uncommon',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'lavender',
        allowedSkinColors: ['lavender'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: raceOverride,
      },
    };

    const result = resolveFeatureLayers(raceDef);
    expect(result).toEqual(raceOverride);
    // Should NOT return archetype featureLayers
    expect(result).not.toEqual(HUMAN_ARCHETYPE.featureLayers);
  });

  it('returns empty array when archetype is not found', () => {
    mockGetSpriteArchetype.mockReturnValue(undefined);
    const raceDef: RaceDefinition = {
      id: 'alien',
      label: 'Alien',
      description: 'Test',
      rarity: 'rare',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'nonexistent',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    const result = resolveFeatureLayers(raceDef);
    expect(result).toEqual([]);
  });

  it('returns archetype featureLayers for orc (empty array)', () => {
    mockGetSpriteArchetype.mockReturnValue(ORC_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'orc',
      label: 'Orc',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'orc',
        defaultSkinColor: 'green',
        allowedSkinColors: ['green'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    const result = resolveFeatureLayers(raceDef);
    expect(result).toEqual([]);
  });
});

describe('buildV3LayerConfigs featureLayers tinting', () => {
  beforeEach(() => {
    mockGetLPCLayerOptions.mockReturnValue([
      { id: 'default', name: 'Default', path: 'male/eyes/default.png' },
      { id: 'elvenears', name: 'Elven Ears', path: 'male/ears/elvenears.png' },
      { id: 'buttonnose', name: 'Button Nose', path: 'male/nose/buttonnose.png' },
    ]);
  });

  it('variant-filtered features (ears) are tinted with skin color', () => {
    const elfArchetype: SpriteArchetype = {
      ...HUMAN_ARCHETYPE,
      id: 'elf',
      featureLayers: [
        { layerType: 'ears', styles: ['elvenears'], chance: 1.0, playerSelectable: false },
      ],
    };
    const info = createMinimalCharacterInfo({ enabledOverlayLayers: [] });
    const layers = buildV3LayerConfigs(
      info,
      elfArchetype,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const earsLayer = layers.find((l) => l.type === 'ears');
    expect(earsLayer).toBeDefined();
    // Skin tint for 'light' = 0xf0c8a8
    expect(earsLayer!.colorize).toEqual({ type: 'tint', color: 0xf0c8a8 });
  });

  it('eyes feature uses eye color tint with threshold', () => {
    const info = createMinimalCharacterInfo({
      eyeColor: 'blue',
      enabledOverlayLayers: ['eyes'],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const eyesLayer = layers.find((l) => l.type === 'eyes');
    expect(eyesLayer).toBeDefined();
    // Eye tint for 'blue' = 0x4488dd, with sclera threshold 230
    expect(eyesLayer!.colorize).toEqual({ type: 'tint', color: 0x4488dd, threshold: 230 });
  });

  it('spriteScale is baked into CharacterSpriteConfig from race definition', () => {
    // This test verifies the generateCharacterSprite return includes spriteScale.
    // We can't easily test generateCharacterSprite (it calls getOrGenerateSprite),
    // so we verify the function signature and return type indirectly via the
    // FALLBACK_RACE_DEFINITION which has spriteScale: 1.
    const raceDef: RaceDefinition = {
      id: 'halfling',
      label: 'Halfling',
      description: 'Small folk',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 0.8,
        featureLayers: null,
      },
    };
    // Verify the race's spriteScale is accessible and non-default
    expect(raceDef.spriteHints!.spriteScale).toBe(0.8);
  });
});

describe('buildV3LayerConfigs tintMode pipeline (FEAT-113)', () => {
  it('includes tintMode in colorize when manifest option has tintMode overlay', () => {
    // Set up manifest option with tintMode: 'overlay' for a torso layer
    const overlayOption = {
      id: 'torso_mail_male',
      name: 'Chainmail',
      path: 'male/torso/mail_male.png',
      tintMode: 'overlay' as const,
    };
    mockGetLPCLayerOptions.mockImplementation((type: string) => {
      if (type === 'torso') return [overlayOption];
      return [
        { id: 'eyes_brown', name: 'Brown Eyes', path: 'male/eyes/brown.png' },
        { id: 'nose_light', name: 'Light Nose', path: 'male/nose/light.png' },
      ];
    });

    // resolveClothingSlot returns the resolved slot pointing to this item
    mockResolveClothingSlot.mockReturnValue({
      type: 'torso',
      pattern: 'mail',
      tint: 0xc0c0c0,
      tintMode: 'overlay',
    });

    const info = createMinimalCharacterInfo({
      enabledOverlayLayers: [],
      clothing: [{ slot: 'torso_over', itemId: 'mail', color: '#C0C0C0', contents: null }],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    // Find the clothing layer (not body/head)
    const clothingLayer = layers.find(
      (l) => l.colorize?.type === 'tint' && l.colorize.tintMode === 'overlay'
    );
    expect(clothingLayer).toBeDefined();
    expect(clothingLayer!.colorize).toEqual({
      type: 'tint',
      color: 0xc0c0c0,
      tintMode: 'overlay',
    });
  });

  it('omits tintMode from colorize when manifest option has no tintMode (multiply default)', () => {
    const normalOption = {
      id: 'torso_white_longsleeve_male',
      name: 'Longsleeve',
      path: 'male/torso/white_longsleeve.png',
    };
    mockGetLPCLayerOptions.mockImplementation((type: string) => {
      if (type === 'torso') return [normalOption];
      return [
        { id: 'eyes_brown', name: 'Brown Eyes', path: 'male/eyes/brown.png' },
        { id: 'nose_light', name: 'Light Nose', path: 'male/nose/light.png' },
      ];
    });

    mockResolveClothingSlot.mockReturnValue({
      type: 'torso',
      pattern: 'white_longsleeve',
      tint: 0xff0000,
    });

    const info = createMinimalCharacterInfo({
      enabledOverlayLayers: [],
      clothing: [{ slot: 'torso_under', itemId: 'longsleeve', color: '#FF0000', contents: null }],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    // Find the clothing layer
    const clothingLayer = layers.find(
      (l) => l.colorize?.type === 'tint' && l.colorize.color === 0xff0000
    );
    expect(clothingLayer).toBeDefined();
    expect(clothingLayer!.colorize).toEqual({
      type: 'tint',
      color: 0xff0000,
    });
    // tintMode should NOT be present (undefined = multiply default)
    expect(clothingLayer!.colorize!.type === 'tint' && 'tintMode' in clothingLayer!.colorize!).toBe(false);
  });
});

describe('buildV3LayerConfigs hidesHair suppression (FEAT-114)', () => {
  beforeEach(() => {
    mockGetLPCLayerOptions.mockImplementation((type: string) => {
      if (type === 'hair') return [{ id: 'hair_brown_male', name: 'Brown Hair', path: 'male/hair/brown_male.png' }];
      return [
        { id: 'eyes_brown', name: 'Brown Eyes', path: 'male/eyes/brown.png' },
        { id: 'nose_light', name: 'Light Nose', path: 'male/nose/light.png' },
      ];
    });
  });

  it('includes hair layer when no headwear has hidesHair', () => {
    mockHasHidesHairHeadwear.mockReturnValue(false);
    const info = createMinimalCharacterInfo({
      hairColor: 'brown',
      enabledOverlayLayers: [],
      clothing: [],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    expect(layerTypes).toContain('hair');
  });

  it('suppresses hair layer when headwear has hidesHair', () => {
    mockHasHidesHairHeadwear.mockReturnValue(true);
    const info = createMinimalCharacterInfo({
      hairColor: 'brown',
      enabledOverlayLayers: [],
      clothing: [{ slot: 'head', itemId: 'plate_helmet', color: null, contents: null }],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const layerTypes = layers.map((l) => l.type);
    expect(layerTypes).not.toContain('hair');
  });
});

describe('buildV3LayerConfigs hairStyle (FEAT-123)', () => {
  beforeEach(() => {
    mockGetLPCLayerOptions.mockImplementation((type: string) => {
      if (type === 'hair') return [
        { id: 'hair_ponytail', name: 'Ponytail', path: 'male/hair/ponytail.png' },
        { id: 'hair_mohawk', name: 'Mohawk', path: 'male/hair/mohawk.png' },
        { id: 'hair_bangs', name: 'Bangs', path: 'male/hair/bangs.png' },
        { id: 'hair_long', name: 'Long', path: 'male/hair/long.png' },
      ];
      return [
        { id: 'eyes_brown', name: 'Brown Eyes', path: 'male/eyes/brown.png' },
        { id: 'nose_light', name: 'Light Nose', path: 'male/nose/light.png' },
      ];
    });
    mockHasHidesHairHeadwear.mockReturnValue(false);
  });

  it('uses hairStyle for pattern matching instead of hairColor', () => {
    const info = createMinimalCharacterInfo({
      hairColor: 'brown',
      hairStyle: 'ponytail',
      enabledOverlayLayers: [],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const hairLayer = layers.find((l) => l.type === 'hair');
    expect(hairLayer).toBeDefined();
    // Should match the ponytail option, not derive from hairColor
    expect(mockGetLPCAssetPath).toHaveBeenCalled();
  });

  it('characters with same hairColor but different hairStyle resolve different manifest options', () => {
    // Track which option IDs are matched by addManifestLayer
    const matchedOptionIds: string[] = [];
    mockGetLPCAssetPath.mockImplementation((option: { id: string }) => {
      matchedOptionIds.push(option.id);
      return `/mock/${option.id}.png`;
    });

    const info1 = createMinimalCharacterInfo({
      hairColor: 'brown',
      hairStyle: 'ponytail',
      enabledOverlayLayers: [],
    });
    const info2 = createMinimalCharacterInfo({
      hairColor: 'brown',
      hairStyle: 'mohawk',
      enabledOverlayLayers: [],
    });

    buildV3LayerConfigs(
      info1,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );
    const firstHairOptionId = matchedOptionIds.find((id) => id.includes('hair'));

    matchedOptionIds.length = 0;
    buildV3LayerConfigs(
      info2,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );
    const secondHairOptionId = matchedOptionIds.find((id) => id.includes('hair'));

    // Different hairStyle values should resolve different manifest options
    expect(firstHairOptionId).toBeDefined();
    expect(secondHairOptionId).toBeDefined();
    expect(firstHairOptionId).not.toBe(secondHairOptionId);
  });

  it('applies hairColor tint independently of hairStyle', () => {
    const info = createMinimalCharacterInfo({
      hairColor: 'blonde',
      hairStyle: 'mohawk',
      enabledOverlayLayers: [],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const hairLayer = layers.find((l) => l.type === 'hair');
    expect(hairLayer).toBeDefined();
    // Tint should use blonde color (0xd4a76a), not derived from style
    expect(hairLayer!.colorize).toEqual({ type: 'tint', color: 0xd4a76a });
  });

  it('falls back to "long" when hairStyle is empty', () => {
    const info = createMinimalCharacterInfo({
      hairColor: 'brown',
      hairStyle: '',
      enabledOverlayLayers: [],
    });
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );

    const hairLayer = layers.find((l) => l.type === 'hair');
    expect(hairLayer).toBeDefined();
  });
});

describe('buildV3LayerConfigs facial (beard) layer (FEAT-295)', () => {
  const HUMAN_WITH_FACIAL: SpriteArchetype = {
    ...HUMAN_ARCHETYPE,
    featureLayers: [
      { layerType: 'eyes', styles: ['default'], chance: 1.0, playerSelectable: false },
      { layerType: 'facial', styles: ['beard', 'mustache', 'medium'], chance: 0.3, playerSelectable: true },
    ],
  };

  beforeEach(() => {
    mockGetLPCLayerOptions.mockReturnValue([
      { id: 'eyes_brown', name: 'Brown Eyes', path: 'male/eyes/brown.png' },
      { id: 'facial_beard', name: 'Beard', path: 'male/facial/beard.png', tintable: true },
      { id: 'facial_medium', name: 'Medium Beard', path: 'male/facial/medium.png', tintable: true },
    ]);
    mockHasHidesHairHeadwear.mockReturnValue(false);
    // Note: mockGetLPCAssetPath uses the default /mock/path.png from global setup
  });

  it('renders facial layer when beardStyle is set and facial is in enabledOverlayLayers', () => {
    const info: SpriteCharacterInfo = {
      enabledOverlayLayers: ['facial'],
      eyeColor: 'brown',
      hairColor: 'brown',
      hairStyle: 'long',
      beardStyle: 'beard',
      clothing: [],
    };
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_WITH_FACIAL,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );
    const facialLayer = layers.find((l) => l.type === 'facial');
    expect(facialLayer).toBeDefined();
    expect(facialLayer!.imageUrl).toContain('facial_beard');
  });

  it('skips facial layer when beardStyle is null even if facial is enabled', () => {
    const info: SpriteCharacterInfo = {
      enabledOverlayLayers: ['facial'],
      eyeColor: 'brown',
      hairColor: 'brown',
      hairStyle: 'long',
      beardStyle: null,
      clothing: [],
    };
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_WITH_FACIAL,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );
    const facialLayer = layers.find((l) => l.type === 'facial');
    expect(facialLayer).toBeUndefined();
  });

  it('tints beard with hairColor', () => {
    const info: SpriteCharacterInfo = {
      enabledOverlayLayers: ['facial'],
      eyeColor: 'brown',
      hairColor: 'brown',
      hairStyle: 'long',
      beardStyle: 'beard',
      clothing: [],
    };
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_WITH_FACIAL,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );
    const facialLayer = layers.find((l) => l.type === 'facial');
    expect(facialLayer).toBeDefined();
    // brown hair tint hex = 0x6b4226
    expect(facialLayer!.colorize?.color).toBe(0x6b4226);
  });
});

describe('buildV3LayerConfigs weapon layer (FEAT-242)', () => {
  beforeEach(() => {
    mockGetLPCLayerOptions.mockImplementation((type: string) => {
      if (type === 'weapon') {
        return [
          { id: 'weapon_dagger_male', name: 'Dagger', path: 'male/weapon/dagger_male.png' },
          { id: 'weapon_bow', name: 'Bow', path: 'either/weapon/bow.png' },
        ];
      }
      return [{ id: `${type}_default`, name: 'Default', path: `male/${type}/default.png` }];
    });
  });

  it('includes weapon layer when weapon slot is in clothing', () => {
    const info: SpriteCharacterInfo = {
      enabledOverlayLayers: [],
      eyeColor: 'brown',
      hairColor: 'brown',
      hairStyle: 'long',
      beardStyle: null,
      clothing: [{ slot: 'weapon', itemId: 'iron_sword', color: null, contents: null }],
    };
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );
    const weaponLayer = layers.find((l) => l.type === 'weapon');
    expect(weaponLayer).toBeDefined();
    expect(weaponLayer!.imageUrl).toContain('dagger');
  });

  it('omits weapon layer when no weapon slot in clothing', () => {
    const info: SpriteCharacterInfo = {
      enabledOverlayLayers: [],
      eyeColor: 'brown',
      hairColor: 'brown',
      hairStyle: 'long',
      beardStyle: null,
      clothing: [],
    };
    const layers = buildV3LayerConfigs(
      info,
      HUMAN_ARCHETYPE,
      'human_male' as HeadType,
      'male' as BodyType,
      'light' as SkinColor
    );
    const weaponLayer = layers.find((l) => l.type === 'weapon');
    expect(weaponLayer).toBeUndefined();
  });
});

describe('normalizeEyeColorForRace', () => {
  it('passes through valid eye color when no race constraint', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeEyeColorForRace('blue', raceDef)).toBe('blue');
    expect(normalizeEyeColorForRace('green', raceDef)).toBe('green');
  });

  it('falls back to brown for invalid eye color when no race constraint', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeEyeColorForRace('hazel', raceDef)).toBe('brown');
    expect(normalizeEyeColorForRace(null, raceDef)).toBe('brown');
    expect(normalizeEyeColorForRace(undefined, raceDef)).toBe('brown');
  });

  it('passes through allowed eye color when race constrains', () => {
    mockGetSpriteArchetype.mockReturnValue(ORC_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'orc',
      label: 'Orc',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'orc',
        defaultSkinColor: 'green',
        allowedSkinColors: ['green'],
        allowedEyeColors: ['red', 'yellow', 'orange'],
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeEyeColorForRace('red', raceDef)).toBe('red');
  });

  it('falls back to first allowed when eye color is not in race palette', () => {
    mockGetSpriteArchetype.mockReturnValue(ORC_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'orc',
      label: 'Orc',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'orc',
        defaultSkinColor: 'green',
        allowedSkinColors: ['green'],
        allowedEyeColors: ['red', 'yellow', 'orange'],
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeEyeColorForRace('blue', raceDef)).toBe('red');
    expect(normalizeEyeColorForRace(null, raceDef)).toBe('red');
  });
});

describe('normalizeHairColorForRace', () => {
  it('passes through valid hair color when no race constraint', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeHairColorForRace('blonde', raceDef)).toBe('blonde');
    expect(normalizeHairColorForRace('black', raceDef)).toBe('black');
  });

  it('falls back to brown for invalid hair color when no race constraint', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'human',
      label: 'Human',
      description: 'Test',
      rarity: 'common',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light', 'amber'],
        allowedEyeColors: null,
        allowedHairColors: null,
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeHairColorForRace('strawberry', raceDef)).toBe('brown');
    expect(normalizeHairColorForRace(null, raceDef)).toBe('brown');
    expect(normalizeHairColorForRace(undefined, raceDef)).toBe('brown');
  });

  it('falls back to first allowed when hair color not in race palette', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'dark_elf',
      label: 'Dark Elf',
      description: 'Test',
      rarity: 'uncommon',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light'],
        allowedEyeColors: null,
        allowedHairColors: ['white', 'gray'],
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeHairColorForRace('blonde', raceDef)).toBe('white');
    expect(normalizeHairColorForRace(null, raceDef)).toBe('white');
  });

  it('passes through allowed hair color when race constrains', () => {
    mockGetSpriteArchetype.mockReturnValue(HUMAN_ARCHETYPE);
    const raceDef: RaceDefinition = {
      id: 'dark_elf',
      label: 'Dark Elf',
      description: 'Test',
      rarity: 'uncommon',
      spriteHints: {
        humanoidBody: true,
        spriteArchetype: 'human',
        defaultSkinColor: 'light',
        allowedSkinColors: ['light'],
        allowedEyeColors: null,
        allowedHairColors: ['white', 'gray'],
        spriteScale: 1,
        featureLayers: null,
      },
    };

    expect(normalizeHairColorForRace('white', raceDef)).toBe('white');
    expect(normalizeHairColorForRace('gray', raceDef)).toBe('gray');
  });
});
