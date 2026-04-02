/**
 * Shared test fixture factories for creating entities with sensible defaults.
 */

// // import { vi } from 'vitest';
import type OpenAI from 'openai';
import type {
  Character,
  Place,
  ObjectEntity,
  ObjectInfo,
  RaceDefinition,
  CharacterInfo,
  PlaceInfo,
} from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

/**
 * Create a test race definition with defaults.
 */
export function createTestRace(overrides?: Partial<RaceDefinition>): RaceDefinition {
  return {
    id: 'RACE_human',
    label: 'Human',
    description: 'A typical human being.',
    rarity: 'common',
    spriteHints: null,
    ...overrides,
  };
}

/**
 * Create a test voice ID (registry slug).
 */
export function createTestVoiceId(): string {
  return 'test-voice';
}

/**
 * Create a test place with defaults.
 */
export function createTestPlace(overrides?: Partial<Place> & { info?: Partial<PlaceInfo> }): Place {
  const { info: infoOverrides, ...rest } = overrides ?? {};
  const width = rest.position?.width ?? 100;
  const height = rest.position?.height ?? 100;
  const innerWidth = rest.position?.innerWidth ?? 800;
  const innerHeight = rest.position?.innerHeight ?? 600;
  const basePosition = { x: 0, y: 0, width, height, innerWidth, innerHeight, parent: null };
  return {
    id: 'PLACE_test',
    label: 'Test Place',
    entityType: 'place',
    description: 'A test place',
    short_description: 'test place',
    important: false,
    tags: [],
    relationships: [],
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction: { typeId: 'enter' },
    ...rest,
    position: { ...basePosition, ...rest.position },
    info: {
      environment: ENVIRONMENT_PRESETS.exterior(),
      scale: 'feet',
      purpose: 'leisure',
      spriteConfig: { spriteId: '', facing: 'south', layer: 'default' },
      music: null,
      musicHints: null,
      commonKnowledge: null,
      secrets: null,
      isTemporary: false,
      dockedAtPlaceId: null,
      timeScale: 1,
      battleBackgroundUrl: '',
      inheritedRequiredTags: null,
      ...infoOverrides,
    },
  };
}

/**
 * Create a test character with defaults.
 */
export function createTestCharacter(
  overrides?: Partial<Character> & { info?: Partial<CharacterInfo> },
): Character {
  const { info: infoOverrides, ...rest } = overrides ?? {};
  const parentPlaceId = rest.position?.parent ?? 'PLACE_test';
  return {
    id: 'CHAR_test',
    label: 'Test Character',
    entityType: 'character',
    description: 'A test character',
    short_description: 'test character',
    important: false,
    tags: [],
    relationships: [],
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction: { typeId: 'talk' },
    position: { x: 50, y: 50, width: 32, height: 48, parent: parentPlaceId },
    ...rest,
    info: {
      purpose: infoOverrides?.isPlayer ? 'player' : 'guard',
      aliases: [],
      birthdate: '',
      birthPlace: '',
      deathdate: null,
      gender: '',
      eyeColor: '',
      hairColor: '',
      hairStyle: 'long',
      beardStyle: null,
      headType: 'human_male',
      skinTone: '',
      personality: '',
      race: 'Human',
      title: null,
      messages: [],
      conversationContext: null,
      journal: [],
      sketches: [],
      storytellerState: null,
      isPlayer: false,
      verbosity: 3,
      storyComplete: false,
      voiceId: createTestVoiceId(),
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
      rulesetState: {
        stats: {},
        conditions: [],
        statUsage: {},
        incapacitation: null,
        incapacitatedSince: null,
      },
      spriteConfig: {
        bodyType: 'male',
        layers: [],
        spriteHash: null,
        spriteUrl: null,
        spriteScale: 1,
      },
      storytellerDisabled: false,
      ...infoOverrides,
    },
  };
}

/**
 * Create a test non-exit object with defaults (furniture, container, interactive item, etc.).
 */
export function createTestObjectEntity(
  overrides?: Partial<ObjectEntity> & { info?: Partial<ObjectInfo> },
): ObjectEntity {
  const { info: infoOverrides, ...rest } = overrides ?? {};
  const parentPlaceId = rest.position?.parent ?? 'PLACE_test';
  return {
    id: 'OBJ_test',
    label: 'Test Object',
    entityType: 'object',
    description: 'A test object',
    short_description: 'object',
    important: false,
    tags: [],
    relationships: [],
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction: { typeId: 'examine' },
    position: { x: 50, y: 50, width: 32, height: 32, parent: parentPlaceId },
    ...rest,
    info: {
      purpose: 'furniture',
      isStructural: false,
      solid: true,
      layer: 'default',
      spriteConfig: { spriteId: 'chair_wooden', frame: null, animationKey: null, animated: false },
      material: null,
      hp: null,
      maxHp: null,
      tint: null,
      state: null,
      contents: null,
      lightSource: null,
      itemId: null,
      plotId: null,
      ...infoOverrides,
    },
  };
}

/**
 * Create a test exit object with defaults.
 * In the hierarchical exit model, target is derived from the place hierarchy
 * (exit's place's parent), not stored in options.
 */
export function createTestExit(overrides?: Partial<ObjectEntity>): ObjectEntity {
  const sourcePlaceId = overrides?.position?.parent ?? 'PLACE_test';
  return {
    id: 'OBJ_exit_test',
    label: 'Test Exit',
    entityType: 'object',
    description: 'A test exit',
    short_description: 'door',
    important: false,
    tags: [],
    relationships: [],
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction: { typeId: 'enter' },
    position: { x: 50, y: 50, width: 32, height: 32, parent: sourcePlaceId },
    ...overrides,
    info: {
      purpose: 'exit',
      solid: true,
      layer: 'default',
      spriteConfig: { spriteId: 'door_wooden', frame: null, animationKey: null, animated: false },
      material: null,
      hp: null,
      maxHp: null,
      tint: null,
      state: null,
      contents: null,
      isStructural: false,
      lightSource: null,
      itemId: null,
      plotId: null,
    },
  };
}

/**
 * Create a minimal OpenAI mock instance for tests
 */
export function createOpenAIMock(): OpenAI {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {} as unknown as OpenAI;
}
