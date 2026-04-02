import { describe, it, expect } from 'vitest';
import type { ClothingSlot, ContainedItem, ContainerConfig } from '../../src/entity/entities.js';
import {
  isContainerSlot,
  getContainedItemCount,
  getAllContainedItems,
  removeItemFromContainers,
  decrementOrRemoveItem,
  findFirstContainerWithCapacity,
  getAvailableWeapons,
  getCharacterWeaponId,
  getEquippedWeaponId,
  normalizeWeaponToBelt,
  generateContainedItemId,
} from '../../src/entity/entities.js';

function makeWeapon(overrides: Partial<ContainedItem> = {}): ContainedItem {
  return {
    id: 'ci_test_w1',
    itemId: 'iron_sword',
    name: 'Iron Sword',
    description: null,
    type: 'weapon',
    quantity: 1,
    color: null,
    equipSlot: 'weapon',
    plotId: null,
    ...overrides,
  };
}

function makeClothing(overrides: Partial<ContainedItem> = {}): ContainedItem {
  return {
    id: 'ci_test_c1',
    itemId: 'longsleeve',
    name: 'Long Sleeve Shirt',
    description: null,
    type: 'clothing',
    quantity: 1,
    color: '#ff0000',
    equipSlot: 'torso_under',
    plotId: null,
    ...overrides,
  };
}

function makeGenericItem(overrides: Partial<ContainedItem> = {}): ContainedItem {
  return {
    id: 'ci_test_g1',
    itemId: 'mysterious_key',
    name: 'A Mysterious Key',
    description: 'An ornate golden key',
    type: 'generic',
    quantity: 1,
    color: null,
    equipSlot: null,
    plotId: null,
    ...overrides,
  };
}

const CONTAINER_CONFIGS: Record<string, ContainerConfig> = {
  belt: { capacity: 3, allowedTypes: ['weapon', 'consumable', 'generic'] },
  behind_body: { capacity: 1, allowedTypes: ['weapon'] },
};

describe('generateContainedItemId', () => {
  it('generates unique IDs with ci_ prefix', () => {
    const id1 = generateContainedItemId();
    const id2 = generateContainedItemId();
    expect(id1).toMatch(/^ci_\d+_[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });
});

describe('isContainerSlot', () => {
  it('returns true for slots with contents array', () => {
    const slot: ClothingSlot = { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] };
    expect(isContainerSlot(slot)).toBe(true);
  });

  it('returns true for non-empty contents', () => {
    const slot: ClothingSlot = { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeWeapon()] };
    expect(isContainerSlot(slot)).toBe(true);
  });

  it('returns false for slots with null contents', () => {
    const slot: ClothingSlot = { slot: 'torso_under', itemId: 'longsleeve', color: null, contents: null };
    expect(isContainerSlot(slot)).toBe(false);
  });
});

describe('getContainedItemCount', () => {
  it('returns 0 for non-container slots', () => {
    const slot: ClothingSlot = { slot: 'legs', itemId: 'pants', color: null, contents: null };
    expect(getContainedItemCount(slot)).toBe(0);
  });

  it('returns 0 for empty container', () => {
    const slot: ClothingSlot = { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] };
    expect(getContainedItemCount(slot)).toBe(0);
  });

  it('returns correct count for populated container', () => {
    const slot: ClothingSlot = {
      slot: 'belt', itemId: 'leather_belt', color: null,
      contents: [makeWeapon(), makeGenericItem()],
    };
    expect(getContainedItemCount(slot)).toBe(2);
  });
});

describe('getAllContainedItems', () => {
  it('returns empty array when no containers', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'torso_under', itemId: 'shirt', color: null, contents: null },
      { slot: 'legs', itemId: 'pants', color: null, contents: null },
    ];
    expect(getAllContainedItems(clothing)).toEqual([]);
  });

  it('collects items from all container slots', () => {
    const weapon = makeWeapon();
    const item = makeGenericItem({ id: 'ci_back_bow' });
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [weapon] },
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [item] },
      { slot: 'torso_under', itemId: 'shirt', color: null, contents: null },
    ];
    const result = getAllContainedItems(clothing);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(weapon);
    expect(result).toContainEqual(item);
  });
});

describe('removeItemFromContainers', () => {
  it('removes item by instance ID and returns it', () => {
    const weapon = makeWeapon({ id: 'ci_to_remove' });
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [weapon] },
    ];
    const removed = removeItemFromContainers(clothing, 'ci_to_remove');
    expect(removed).toEqual(weapon);
    expect(clothing[0].contents).toHaveLength(0);
  });

  it('returns null when item not found', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeWeapon()] },
    ];
    const removed = removeItemFromContainers(clothing, 'nonexistent');
    expect(removed).toBeNull();
    expect(clothing[0].contents).toHaveLength(1);
  });

  it('searches across multiple container slots', () => {
    const bow = makeWeapon({ id: 'ci_back_bow', itemId: 'hunting_bow' });
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeWeapon()] },
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [bow] },
    ];
    const removed = removeItemFromContainers(clothing, 'ci_back_bow');
    expect(removed).toEqual(bow);
    expect(clothing[1].contents).toHaveLength(0);
    expect(clothing[0].contents).toHaveLength(1);
  });

  it('skips non-container slots', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'torso_under', itemId: 'shirt', color: null, contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    expect(removeItemFromContainers(clothing, 'ci_any')).toBeNull();
  });
});

describe('decrementOrRemoveItem', () => {
  it('decrements quantity when > 1 and returns the item', () => {
    const potion: ContainedItem = {
      id: 'ci_potion_1', itemId: 'health_potion', name: 'Health Potion',
      description: null, type: 'consumable', quantity: 3, color: null, equipSlot: null, plotId: null,
    };
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [potion] },
    ];

    const result = decrementOrRemoveItem(clothing, 'ci_potion_1');
    expect(result).toBe(potion);
    expect(potion.quantity).toBe(2);
    expect(clothing[0].contents).toHaveLength(1); // still in container
  });

  it('removes item entirely when quantity is 1 and returns it', () => {
    const potion: ContainedItem = {
      id: 'ci_potion_1', itemId: 'health_potion', name: 'Health Potion',
      description: null, type: 'consumable', quantity: 1, color: null, equipSlot: null, plotId: null,
    };
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [potion] },
    ];

    const result = decrementOrRemoveItem(clothing, 'ci_potion_1');
    expect(result).toEqual(potion);
    expect(clothing[0].contents).toHaveLength(0); // removed from container
  });

  it('returns null when item not found', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeWeapon()] },
    ];
    expect(decrementOrRemoveItem(clothing, 'ci_nonexistent')).toBeNull();
    expect(clothing[0].contents).toHaveLength(1); // unchanged
  });

  it('skips non-container slots', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'torso_under', itemId: 'shirt', color: null, contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    expect(decrementOrRemoveItem(clothing, 'ci_any')).toBeNull();
  });

  it('searches across multiple containers', () => {
    const potion: ContainedItem = {
      id: 'ci_potion_back', itemId: 'health_potion', name: 'Health Potion',
      description: null, type: 'consumable', quantity: 2, color: null, equipSlot: null, plotId: null,
    };
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeWeapon()] },
      { slot: 'backpack', itemId: 'backpack', color: null, contents: [potion] },
    ];

    const result = decrementOrRemoveItem(clothing, 'ci_potion_back');
    expect(result).toBe(potion);
    expect(potion.quantity).toBe(1);
    expect(clothing[0].contents).toHaveLength(1); // belt untouched
    expect(clothing[1].contents).toHaveLength(1); // potion still in backpack (decremented, not removed)
  });
});

describe('findFirstContainerWithCapacity', () => {
  it('finds belt for weapon when belt has space', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    const result = findFirstContainerWithCapacity(clothing, 'weapon', CONTAINER_CONFIGS);
    expect(result?.slot).toBe('belt');
  });

  it('finds behind_body for weapon when belt is full', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [
        makeWeapon(), makeGenericItem({ id: 'ci_g2' }), makeGenericItem({ id: 'ci_g3' }),
      ] },
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [] },
    ];
    const result = findFirstContainerWithCapacity(clothing, 'weapon', CONTAINER_CONFIGS);
    expect(result?.slot).toBe('behind_body');
  });

  it('returns null when no container accepts the type', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [] },
    ];
    const result = findFirstContainerWithCapacity(clothing, 'clothing', CONTAINER_CONFIGS);
    expect(result).toBeNull();
  });

  it('returns null when all containers are full', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [
        makeWeapon(), makeGenericItem({ id: 'ci_g2' }), makeGenericItem({ id: 'ci_g3' }),
      ] },
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [
        makeWeapon({ id: 'ci_bow', itemId: 'hunting_bow' }),
      ] },
    ];
    const result = findFirstContainerWithCapacity(clothing, 'weapon', CONTAINER_CONFIGS);
    expect(result).toBeNull();
  });

  it('skips non-container slots', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'torso_under', itemId: 'shirt', color: null, contents: null },
    ];
    const result = findFirstContainerWithCapacity(clothing, 'generic', CONTAINER_CONFIGS);
    expect(result).toBeNull();
  });

  it('respects allowedTypes — behind_body rejects generic items', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [] },
    ];
    const result = findFirstContainerWithCapacity(clothing, 'generic', CONTAINER_CONFIGS);
    expect(result).toBeNull();
  });
});

describe('getAvailableWeapons', () => {
  it('returns empty for no containers', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'torso_under', itemId: 'shirt', color: null, contents: null },
    ];
    expect(getAvailableWeapons(clothing)).toEqual([]);
  });

  it('returns weapons from all containers', () => {
    const sword = makeWeapon({ id: 'ci_sword' });
    const bow = makeWeapon({ id: 'ci_bow', itemId: 'hunting_bow', name: 'Hunting Bow' });
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [sword, makeGenericItem()] },
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [bow] },
    ];
    const weapons = getAvailableWeapons(clothing);
    expect(weapons).toHaveLength(2);
    expect(weapons.map((w) => w.itemId)).toEqual(['iron_sword', 'hunting_bow']);
  });

  it('excludes non-weapon items', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeGenericItem()] },
    ];
    expect(getAvailableWeapons(clothing)).toEqual([]);
  });
});

describe('getCharacterWeaponId', () => {
  it('returns drawn weapon when in weapon slot', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'iron_sword', color: null, contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    expect(getCharacterWeaponId(clothing)).toBe('iron_sword');
  });

  it('returns sheathed weapon from belt', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeWeapon()] },
    ];
    expect(getCharacterWeaponId(clothing)).toBe('iron_sword');
  });

  it('searches all container slots, not just belt', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
      { slot: 'behind_body', itemId: 'cape', color: null, contents: [
        makeWeapon({ itemId: 'hunting_bow' }),
      ] },
    ];
    expect(getCharacterWeaponId(clothing)).toBe('hunting_bow');
  });

  it('prefers drawn weapon over sheathed', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'battle_axe', color: null, contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [makeWeapon()] },
    ];
    expect(getCharacterWeaponId(clothing)).toBe('battle_axe');
  });

  it('returns null when no weapon anywhere', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
      { slot: 'torso_under', itemId: 'shirt', color: null, contents: null },
    ];
    expect(getCharacterWeaponId(clothing)).toBeNull();
  });
});

describe('getEquippedWeaponId', () => {
  it('returns weapon from weapon slot', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'iron_sword', color: null, contents: null },
    ];
    expect(getEquippedWeaponId(clothing)).toBe('iron_sword');
  });

  it('returns null when no weapon slot', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    expect(getEquippedWeaponId(clothing)).toBeNull();
  });
});

describe('normalizeWeaponToBelt', () => {
  it('moves weapon slot to belt contents', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'iron_sword', color: null, contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    normalizeWeaponToBelt(clothing);
    expect(clothing.find((c) => c.slot === 'weapon')).toBeUndefined();
    const belt = clothing.find((c) => c.slot === 'belt');
    expect(belt?.contents).toHaveLength(1);
    expect(belt?.contents?.[0].itemId).toBe('iron_sword');
    expect(belt?.contents?.[0].type).toBe('weapon');
    expect(belt?.contents?.[0].id).toMatch(/^ci_/);
    expect(belt?.contents?.[0].quantity).toBe(1);
  });

  it('creates default belt if missing', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'battle_axe', color: null, contents: null },
    ];
    normalizeWeaponToBelt(clothing);
    const belt = clothing.find((c) => c.slot === 'belt');
    expect(belt).toBeDefined();
    expect(belt?.itemId).toBe('leather_belt');
    expect(belt?.contents).toHaveLength(1);
  });

  it('uses name resolver when provided', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'iron_sword', color: null, contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    normalizeWeaponToBelt(clothing, (id) => id === 'iron_sword' ? 'Iron Sword' : id);
    const belt = clothing.find((c) => c.slot === 'belt');
    expect(belt?.contents?.[0].name).toBe('Iron Sword');
  });

  it('falls back to itemId as name without resolver', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'iron_sword', color: null, contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    normalizeWeaponToBelt(clothing);
    const belt = clothing.find((c) => c.slot === 'belt');
    expect(belt?.contents?.[0].name).toBe('iron_sword');
  });

  it('preserves weapon color in contained item', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'weapon', itemId: 'iron_sword', color: '#silver', contents: null },
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    normalizeWeaponToBelt(clothing);
    const belt = clothing.find((c) => c.slot === 'belt');
    expect(belt?.contents?.[0].color).toBe('#silver');
  });

  it('no-ops when no weapon slot', () => {
    const clothing: ClothingSlot[] = [
      { slot: 'belt', itemId: 'leather_belt', color: null, contents: [] },
    ];
    const result = normalizeWeaponToBelt(clothing);
    expect(result).toBe(clothing);
    expect(clothing[0].contents).toHaveLength(0);
  });
});
