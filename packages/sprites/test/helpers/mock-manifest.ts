/**
 * Mock LPC manifest for testing.
 */

import type { LPCAssetManifest, LPCLayerManifest, LPCAssetOption } from '../../src/types';

/**
 * Creates a mock asset option.
 */
export function createMockOption(overrides: Partial<LPCAssetOption> = {}): LPCAssetOption {
  return {
    id: 'test_option',
    name: 'Test Option',
    path: 'either/test/option.png',
    ...overrides,
  };
}

/**
 * Creates a mock layer manifest.
 */
export function createMockLayer(overrides: Partial<LPCLayerManifest> = {}): LPCLayerManifest {
  const type = overrides.type ?? 'body';
  return {
    type,
    displayName: 'Body',
    optional: false,
    zIndex: 0,
    variantFiltered: false,
    bodyTypeSpecific: false,
    slotKind: 'body',
    options: [createMockOption()],
    ...overrides,
  };
}

/**
 * Creates a full 16-layer manifest matching the production layer set.
 * zIndex/variantFiltered/bodyTypeSpecific/slotKind values match the real manifest exactly.
 * Use when tests need the complete layer catalog (e.g. accessor tests, z-index ordering).
 */
export function createFullManifest(): LPCAssetManifest {
  return {
    version: '1.0.0',
    basePath: '/sprites/lpc',
    bodyTypes: ['male', 'female'],
    layers: [
      createMockLayer({
        type: 'behind_body',
        zIndex: 0,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'body',
        zIndex: 1,
        variantFiltered: false,
        bodyTypeSpecific: true,
        slotKind: 'body',
      }),
      createMockLayer({
        type: 'ears',
        zIndex: 2,
        variantFiltered: true,
        bodyTypeSpecific: true,
        slotKind: 'feature',
      }),
      createMockLayer({
        type: 'eyes',
        zIndex: 3,
        variantFiltered: true,
        bodyTypeSpecific: true,
        slotKind: 'body',
      }),
      createMockLayer({
        type: 'nose',
        zIndex: 4,
        variantFiltered: true,
        bodyTypeSpecific: true,
        slotKind: 'feature',
      }),
      createMockLayer({
        type: 'feet',
        zIndex: 5,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'legs',
        zIndex: 6,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'torso',
        zIndex: 7,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'belt',
        zIndex: 8,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'hands',
        zIndex: 9,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'facial',
        zIndex: 10,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'feature',
      }),
      createMockLayer({
        type: 'hair',
        zIndex: 11,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'body',
      }),
      createMockLayer({
        type: 'head',
        zIndex: 12,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'neck',
        zIndex: 13,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'accessories',
        zIndex: 14,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
      createMockLayer({
        type: 'weapon',
        zIndex: 15,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
      }),
    ],
  };
}

/**
 * Creates a complete mock manifest for testing.
 */
export function createMockManifest(overrides: Partial<LPCAssetManifest> = {}): LPCAssetManifest {
  return {
    version: '1.0.0',
    basePath: '/sprites/lpc',
    bodyTypes: ['male', 'female'],
    layers: [
      createMockLayer({
        type: 'body',
        displayName: 'Body',
        optional: false,
        zIndex: 1,
        variantFiltered: false,
        bodyTypeSpecific: true,
        slotKind: 'body',
        options: [
          createMockOption({
            id: 'light',
            name: 'Light',
            path: 'body/male/light.png',
            bodyType: 'male',
          }),
          createMockOption({
            id: 'light',
            name: 'Light',
            path: 'body/female/light.png',
            bodyType: 'female',
          }),
          createMockOption({
            id: 'dark',
            name: 'Dark',
            path: 'body/male/dark.png',
            bodyType: 'male',
          }),
          createMockOption({
            id: 'dark',
            name: 'Dark',
            path: 'body/female/dark.png',
            bodyType: 'female',
          }),
        ],
      }),
      createMockLayer({
        type: 'hair',
        displayName: 'Hair',
        optional: true,
        zIndex: 11,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'body',
        options: [
          createMockOption({
            id: 'messy_brown',
            name: 'Messy Brown',
            path: 'hair/either/messy_brown.png',
            tintable: true,
          }),
          createMockOption({
            id: 'long_blonde',
            name: 'Long Blonde',
            path: 'hair/either/long_blonde.png',
            tintable: true,
          }),
          createMockOption({
            id: 'short_black',
            name: 'Short Black',
            path: 'hair/male/short_black.png',
          }),
        ],
      }),
      createMockLayer({
        type: 'torso',
        displayName: 'Torso',
        optional: false,
        zIndex: 7,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
        options: [
          createMockOption({
            id: 'shirt_white',
            name: 'White Shirt',
            path: 'torso/either/shirt_white.png',
          }),
          createMockOption({
            id: 'armor',
            name: 'Armor',
            path: 'torso/male/armor.png',
            bodyTypeOverrides: { female: 'torso/female/armor.png' },
          }),
        ],
      }),
      createMockLayer({
        type: 'legs',
        displayName: 'Legs',
        optional: false,
        zIndex: 6,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
        options: [
          createMockOption({
            id: 'pants_white',
            name: 'White Pants',
            path: 'legs/either/pants_white.png',
          }),
          createMockOption({
            id: 'pants_brown',
            name: 'Brown Pants',
            path: 'legs/either/pants_brown.png',
          }),
        ],
      }),
      createMockLayer({
        type: 'feet',
        displayName: 'Feet',
        optional: true,
        zIndex: 5,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
        options: [
          createMockOption({
            id: 'shoes_brown',
            name: 'Brown Shoes',
            path: 'feet/either/shoes_brown.png',
          }),
          createMockOption({ id: 'boots', name: 'Boots', path: 'feet/either/boots.png' }),
        ],
      }),
      createMockLayer({
        type: 'eyes',
        displayName: 'Eyes',
        optional: true,
        zIndex: 3,
        variantFiltered: true,
        bodyTypeSpecific: true,
        slotKind: 'body',
        options: [
          createMockOption({
            id: 'blue',
            name: 'Blue',
            path: 'eyes/either/blue.png',
            variant: 'human',
          }),
          createMockOption({
            id: 'green',
            name: 'Green',
            path: 'eyes/either/green.png',
            variant: 'human',
          }),
          createMockOption({
            id: 'red',
            name: 'Red',
            path: 'eyes/either/red.png',
            variant: 'demon',
          }),
          createMockOption({ id: 'default', name: 'Default', path: 'eyes/either/default.png' }),
        ],
      }),
      createMockLayer({
        type: 'weapon',
        displayName: 'Weapon',
        optional: true,
        zIndex: 15,
        variantFiltered: false,
        bodyTypeSpecific: false,
        slotKind: 'wearable',
        options: [
          createMockOption({ id: 'sword', name: 'Sword', path: 'weapon/either/sword.png' }),
          createMockOption({ id: 'bow', name: 'Bow', path: 'weapon/either/bow.png' }),
        ],
      }),
    ],
    ...overrides,
  };
}
