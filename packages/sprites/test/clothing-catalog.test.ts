/**
 * Clothing System Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setLPCAssetManifest } from '../src/lpc-assets';
import {
  setClothingData,
  loadClothingData,
  findClothingByTags,
  hasHidesHairHeadwear,
  resolveClothingSlot,
  resolveClothingOptionIds,
  getClothingCatalogForPrompt,
  getClothingItemKeys,
  type ClothingCatalogData,
} from '../src/clothing-catalog';
import { setSlotRegistry } from '../src/slot-registry';
import { createMockManifest, createMockOption, createMockLayer } from './helpers/mock-manifest';

/** Build test clothing data with catalog */
function createTestClothingData(): ClothingCatalogData {
  return {
    clothing: {
      longsleeve: {
        slot: 'torso_under',
        pattern: 'white_longsleeve',
        tags: ['cloth', 'formal', 'merchant'],
        name: 'Long-sleeved shirt',
        defaultColor: null,
      },
      tunic: {
        slot: 'torso_under',
        pattern: 'white_tunic',
        tags: ['cloth', 'simple', 'civilian'],
        name: 'Simple tunic',
        defaultColor: null,
      },
      mail: {
        slot: 'torso_over',
        pattern: 'mail',
        tags: ['armor', 'military', 'guard'],
        name: 'Chainmail armor',
        defaultColor: null,
      },
      cloth_pants: {
        slot: 'legs',
        pattern: 'white_pants',
        tags: ['cloth', 'common'],
        name: 'Cloth pants',
        defaultColor: null,
      },
      metal_pants: {
        slot: 'legs',
        pattern: 'metal_pants',
        tags: ['armor', 'guard'],
        name: 'Metal leg armor',
        defaultColor: null,
      },
      shoes: {
        slot: 'feet',
        pattern: 'brown_shoes',
        tags: ['common'],
        name: 'Simple shoes',
        defaultColor: 'brown',
      },
      metal_boots: {
        slot: 'feet',
        pattern: 'metal_boots',
        tags: ['armor', 'guard'],
        name: 'Metal boots',
        defaultColor: null,
      },
      leather_belt: {
        slot: 'belt',
        pattern: 'leather',
        tags: ['common'],
        name: 'Leather belt',
        defaultColor: null,
      },
      plate_helmet: {
        slot: 'head',
        pattern: 'plate_helmet',
        tags: ['armor', 'military'],
        name: 'Plate helmet',
        defaultColor: 'silver',
        hidesHair: true,
      },
      tophat: {
        slot: 'head',
        pattern: 'formal_tophat',
        tags: ['cloth', 'formal'],
        name: 'Top hat',
        defaultColor: 'black',
      },
    },
  };
}

/** Build a manifest that matches our test clothing data patterns */
function createClothingTestManifest() {
  return createMockManifest({
    layers: [
      createMockLayer({
        type: 'body',
        displayName: 'Body',
        optional: false,
        options: [
          createMockOption({
            id: 'body_light_male',
            name: 'Light',
            path: 'male/body/light.png',
            bodyType: 'male',
          }),
          createMockOption({
            id: 'body_light_female',
            name: 'Light',
            path: 'female/body/light.png',
            bodyType: 'female',
          }),
        ],
      }),
      createMockLayer({
        type: 'torso',
        displayName: 'Torso',
        optional: true,
        options: [
          createMockOption({
            id: 'torso_white_longsleeve_male',
            name: 'White Longsleeve',
            path: 'male/torso/white_longsleeve.png',
            tintable: true,
          }),
          createMockOption({
            id: 'torso_white_tunic_female',
            name: 'White Tunic',
            path: 'female/torso/white_tunic.png',
            tintable: true,
          }),
          createMockOption({
            id: 'torso_mail_male',
            name: 'Mail',
            path: 'male/torso/mail_male.png',
            bodyTypeOverrides: { female: 'female/torso/mail_female.png' },
          }),
        ],
      }),
      createMockLayer({
        type: 'legs',
        displayName: 'Legs',
        optional: true,
        options: [
          createMockOption({
            id: 'legs_white_pants_male',
            name: 'White Pants',
            path: 'male/legs/white_pants_male.png',
            tintable: true,
            bodyTypeOverrides: { female: 'female/legs/white_pants_female.png' },
          }),
          createMockOption({
            id: 'legs_metal_pants_male',
            name: 'Metal Pants',
            path: 'male/legs/metal_pants_male.png',
            bodyTypeOverrides: { female: 'female/legs/metal_pants_female.png' },
          }),
        ],
      }),
      createMockLayer({
        type: 'feet',
        displayName: 'Feet',
        optional: true,
        options: [
          createMockOption({
            id: 'feet_brown_shoes_male',
            name: 'Brown Shoes',
            path: 'male/feet/brown_shoes_male.png',
            bodyTypeOverrides: { female: 'female/feet/brown_shoes_female.png' },
          }),
          createMockOption({
            id: 'feet_metal_boots_male',
            name: 'Metal Boots',
            path: 'male/feet/metal_boots_male.png',
            bodyTypeOverrides: { female: 'female/feet/metal_boots_female.png' },
          }),
        ],
      }),
      createMockLayer({
        type: 'belt',
        displayName: 'Belt',
        optional: true,
        options: [
          createMockOption({
            id: 'belt_leather_male',
            name: 'Leather',
            path: 'male/belt/leather_male.png',
            bodyTypeOverrides: { female: 'female/belt/leather_female.png' },
          }),
        ],
      }),
    ],
  });
}

const TEST_SLOT_REGISTRY = {
  version: 1,
  slots: [
    { id: 'behind_body', region: 'back', subOrder: 0 },
    { id: 'feet', region: 'feet', subOrder: 0 },
    { id: 'legs', region: 'legs', subOrder: 0 },
    { id: 'torso_under', region: 'torso', subOrder: 0 },
    { id: 'torso_mid', region: 'torso', subOrder: 1 },
    { id: 'torso_over', region: 'torso', subOrder: 2 },
    { id: 'torso_top', region: 'torso', subOrder: 3 },
    { id: 'belt', region: 'waist', subOrder: 0 },
    { id: 'hands', region: 'hands', subOrder: 0 },
    { id: 'head', region: 'head', subOrder: 0 },
    { id: 'neck', region: 'neck', subOrder: 0 },
    { id: 'accessories', region: 'face', subOrder: 0 },
  ],
};

describe('Clothing System', () => {
  beforeEach(() => {
    setSlotRegistry(TEST_SLOT_REGISTRY);
    setClothingData(createTestClothingData());
    setLPCAssetManifest(createClothingTestManifest());
  });

  describe('loadClothingData caching', () => {
    it('preserves injected data in dev mode (does not re-read from disk)', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const injectedData = createTestClothingData();
        setClothingData(injectedData);

        // loadClothingData should return injected data, not attempt disk read
        const result = loadClothingData();
        expect(result).toBe(injectedData);
        expect(Object.keys(result.clothing)).toContain('longsleeve');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('findClothingByTags', () => {
    it('finds items matching any tag (OR semantics)', () => {
      const items = findClothingByTags('torso_under', ['guard', 'merchant']);
      const names = items.map((i) => i.name);
      expect(names).toContain('Long-sleeved shirt'); // tagged merchant
      // Chainmail is in torso_over, not torso_under
      const itemsOver = findClothingByTags('torso_over', ['guard']);
      expect(itemsOver.map((i) => i.name)).toContain('Chainmail armor');
    });

    it('filters by slot', () => {
      const items = findClothingByTags('legs', ['common']);
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('Cloth pants');
    });

    it('returns empty for no matching tags', () => {
      const items = findClothingByTags('torso_under', ['nonexistent']);
      expect(items).toHaveLength(0);
    });
  });

  describe('getClothingItemKeys', () => {
    it('returns all item keys from catalog', () => {
      const keys = getClothingItemKeys();
      expect(keys).toContain('longsleeve');
      expect(keys).toContain('tunic');
      expect(keys).toContain('mail');
      expect(keys).toContain('cloth_pants');
      expect(keys).toContain('shoes');
      expect(keys).toHaveLength(10);
    });
  });

  describe('getClothingCatalogForPrompt', () => {
    it('returns formatted catalog text grouped by slot', () => {
      const catalog = getClothingCatalogForPrompt();
      expect(catalog).toContain('torso_under:');
      expect(catalog).toContain('longsleeve (Long-sleeved shirt)');
      expect(catalog).toContain('tunic (Simple tunic)');
      expect(catalog).toContain('legs:');
      expect(catalog).toContain('cloth_pants (Cloth pants)');
      expect(catalog).toContain('feet:');
      expect(catalog).toContain('Available clothing items by slot:');
    });

    it('covers all items in catalog', () => {
      const catalog = getClothingCatalogForPrompt();
      const keys = getClothingItemKeys();
      for (const key of keys) {
        expect(catalog).toContain(key);
      }
    });
  });

  describe('resolveClothingOptionIds', () => {
    it('returns option IDs per body type for items that resolve', () => {
      const data = loadClothingData();
      const longsleeve = data.clothing.longsleeve;
      const optionIds = resolveClothingOptionIds(longsleeve);
      expect(optionIds.male).toBe('torso_white_longsleeve_male');
      expect(optionIds.female).toBeUndefined(); // manifest only has male for longsleeve in test
    });

    it('returns both body types when manifest has both', () => {
      const data = loadClothingData();
      const mail = data.clothing.mail;
      const optionIds = resolveClothingOptionIds(mail);
      expect(optionIds.male).toBe('torso_mail_male');
      expect(optionIds.female).toBe('torso_mail_male'); // bodyTypeOverrides provides female path
    });

    it('returns empty for item that does not resolve', () => {
      setClothingData({
        clothing: {
          unknown: {
            slot: 'torso_under',
            pattern: 'nonexistent_pattern',
            tags: [],
            name: 'Unknown',
            defaultColor: null,
          },
        },
      });
      const data = loadClothingData();
      const optionIds = resolveClothingOptionIds(data.clothing.unknown);
      expect(optionIds.male).toBeUndefined();
      expect(optionIds.female).toBeUndefined();
    });
  });

  describe('resolveClothingSlot', () => {
    it('resolves mail for torso_over slot (male)', () => {
      const result = resolveClothingSlot('torso_over', 'mail', null, 'male');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('mail');
      expect(result!.tint).toBeNull();
    });

    it('resolves mail for torso_over slot (female)', () => {
      const result = resolveClothingSlot('torso_over', 'mail', null, 'female');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('mail');
    });

    it('resolves longsleeve for torso_under (male) with color', () => {
      const result = resolveClothingSlot('torso_under', 'longsleeve', '#8B4513', 'male');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('white_longsleeve');
      expect(result!.tint).toBe(0x8b4513);
    });

    it('applies hex color with # prefix', () => {
      const result = resolveClothingSlot('torso_under', 'longsleeve', '#FF0000', 'male');
      expect(result).not.toBeNull();
      expect(result!.tint).toBe(0xff0000);
    });

    it('returns null tint when color is null and no defaultColor', () => {
      const result = resolveClothingSlot('torso_under', 'longsleeve', null, 'male');
      expect(result).not.toBeNull();
      expect(result!.tint).toBeNull();
    });

    it('applies defaultColor when color is null and defaultColor is set', () => {
      // shoes has defaultColor: 'brown' (0x8B4513)
      const result = resolveClothingSlot('feet', 'shoes', null, 'male');
      expect(result).not.toBeNull();
      expect(result!.tint).toBe(0x8b4513); // CLOTHING_COLOR_HEX['brown']
    });

    it('explicit color overrides defaultColor', () => {
      // shoes has defaultColor: 'brown', but explicit color takes precedence
      const result = resolveClothingSlot('feet', 'shoes', '#FF0000', 'male');
      expect(result).not.toBeNull();
      expect(result!.tint).toBe(0xff0000);
    });

    it('crashes for unknown item key (contract: schema constrains to valid keys)', () => {
      expect(() => resolveClothingSlot('torso_under', 'nonexistent_item', null, 'male')).toThrow();
    });

    it('resolves cloth_pants for legs slot', () => {
      const result = resolveClothingSlot('legs', 'cloth_pants', null, 'male');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('white_pants');
    });

    it('resolves leather_belt for belt slot', () => {
      const result = resolveClothingSlot('belt', 'leather_belt', null, 'male');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('leather');
    });

    it('resolves shoes for feet slot', () => {
      const result = resolveClothingSlot('feet', 'shoes', null, 'male');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('brown_shoes');
    });

    it('resolves metal_boots for feet slot', () => {
      const result = resolveClothingSlot('feet', 'metal_boots', null, 'male');
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('metal_boots');
    });

    it('returns tintMode: overlay when manifest option has tintMode', () => {
      // Set up manifest where metal_boots has tintMode: 'overlay'
      setLPCAssetManifest(
        createMockManifest({
          layers: [
            createMockLayer({
              type: 'feet',
              displayName: 'Feet',
              optional: true,
              options: [
                createMockOption({
                  id: 'feet_metal_boots_male',
                  name: 'Metal Boots',
                  path: 'male/feet/metal_boots_male.png',
                  tintMode: 'overlay',
                }),
              ],
            }),
          ],
        }),
      );
      const result = resolveClothingSlot('feet', 'metal_boots', '#C0C0C0', 'male');
      expect(result).not.toBeNull();
      expect(result!.tintMode).toBe('overlay');
    });

    it('omits tintMode when manifest option has no tintMode (multiply default)', () => {
      const result = resolveClothingSlot('feet', 'metal_boots', '#C0C0C0', 'male');
      expect(result).not.toBeNull();
      expect(result!.tintMode).toBeUndefined();
    });
  });

  describe('hasHidesHairHeadwear', () => {
    it('returns true when clothing includes an item with hidesHair', () => {
      const result = hasHidesHairHeadwear([
        { slot: 'torso_under', itemId: 'longsleeve' },
        { slot: 'head', itemId: 'plate_helmet' },
      ]);
      expect(result).toBe(true);
    });

    it('returns false when headwear does not hide hair', () => {
      const result = hasHidesHairHeadwear([
        { slot: 'torso_under', itemId: 'longsleeve' },
        { slot: 'head', itemId: 'tophat' },
      ]);
      expect(result).toBe(false);
    });

    it('returns false when no headwear is equipped', () => {
      const result = hasHidesHairHeadwear([
        { slot: 'torso_under', itemId: 'longsleeve' },
        { slot: 'feet', itemId: 'shoes' },
      ]);
      expect(result).toBe(false);
    });

    it('returns false for empty clothing array', () => {
      const result = hasHidesHairHeadwear([]);
      expect(result).toBe(false);
    });

    it('returns false when item ID is not in catalog', () => {
      const result = hasHidesHairHeadwear([{ slot: 'head', itemId: 'nonexistent' }]);
      expect(result).toBe(false);
    });
  });
});
