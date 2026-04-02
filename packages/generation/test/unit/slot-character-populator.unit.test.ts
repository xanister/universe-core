/**
 * Unit tests for slot-character-populator:
 * resolveHome, resolveLeisure, populateSpecificSlots, getCharacterSlots,
 * detectUnfilledSlots, populateUnfilledSlots, populateSlotCharacters.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createTestPlace,
  createTestObjectEntity,
  createTestCharacter,
  createMockUniverseContext,
  defaultMockUniverse,
} from '@dmnpc/core/test-helpers/index.js';
import type { GeneratedSlot, PlaceLayout, PurposeDefinition } from '@dmnpc/types/world';
import type { TimePeriod, LocationType } from '@dmnpc/types/npc';
import {
  resolveHome,
  resolveLeisure,
  populateSpecificSlots,
  getCharacterSlots,
  detectUnfilledSlots,
  populateUnfilledSlots,
  populateSlotCharacters,
  scanUniverseForUnfilledSlots,
  characterHasProperHome,
  detectCharacterNeeds,
  assignBeds,
  assignWorkspaces,
} from '../../src/character/slot-character-populator.js';
import type { PurposeDefinition } from '@dmnpc/types/world';

const { mockGenerateCharacter, mockLoadPurposeDefinition, mockLoadPlaceLayout } = vi.hoisted(
  () => ({
    mockGenerateCharacter: vi.fn(),
    mockLoadPurposeDefinition: vi.fn(),
    mockLoadPlaceLayout: vi.fn(),
  })
);

vi.mock('../../src/character-generator.js', () => ({
  generateCharacter: mockGenerateCharacter,
}));
vi.mock('../../src/purpose-loader.js', () => ({
  loadPurposeDefinition: mockLoadPurposeDefinition,
}));
vi.mock('../../src/character/slot-routine-builder.js', () => ({
  buildSlotRoutine: vi.fn(),
}));
vi.mock('@dmnpc/core/universe/universe-store.js', () => ({
  loadPlaceLayout: mockLoadPlaceLayout,
}));

describe('resolveHome', () => {
  it('returns null when spawn place has sleeping objects directly but no child rooms', () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_tavern' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [bed],
    });

    expect(resolveHome(ctx, 'PLACE_tavern', true)).toBeNull();
  });

  it('returns child place when child has sleeping objects (preferOnSiteQuarters=true)', () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bedroom = createTestPlace({
      id: 'PLACE_bedroom',
      position: { parent: 'PLACE_tavern' },
    });
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_bedroom' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern, bedroom],
      objects: [bed],
    });

    expect(resolveHome(ctx, 'PLACE_tavern', true)).toBe('PLACE_bedroom');
  });

  it('returns sibling place when sibling has sleeping objects directly', () => {
    const parent = createTestPlace({ id: 'PLACE_building' });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      position: { parent: 'PLACE_building' },
    });
    const guestRoom = createTestPlace({
      id: 'PLACE_guest_room',
      position: { parent: 'PLACE_building' },
    });
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_guest_room' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [parent, tavern, guestRoom],
      objects: [bed],
    });

    expect(resolveHome(ctx, 'PLACE_tavern', false)).toBe('PLACE_guest_room');
  });

  it('returns null when no sleeping objects exist anywhere', () => {
    const parent = createTestPlace({ id: 'PLACE_building' });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      position: { parent: 'PLACE_building' },
    });
    const table = createTestObjectEntity({
      id: 'OBJ_table',
      info: { purpose: 'table' },
      position: { parent: 'PLACE_tavern' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [parent, tavern],
      objects: [table],
    });

    expect(resolveHome(ctx, 'PLACE_tavern', false)).toBeNull();
  });

  it('prefers work place bedroom child over sibling when preferOnSiteQuarters=true', () => {
    const building = createTestPlace({ id: 'PLACE_building' });
    const shop = createTestPlace({
      id: 'PLACE_shop',
      position: { parent: 'PLACE_building' },
    });
    const shopBedroom = createTestPlace({
      id: 'PLACE_shop_bedroom',
      position: { parent: 'PLACE_shop' },
    });
    const siblingResidence = createTestPlace({
      id: 'PLACE_residence',
      position: { parent: 'PLACE_building' },
    });
    const shopBed = createTestObjectEntity({
      id: 'OBJ_shop_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_shop_bedroom' },
    });
    const sibBed = createTestObjectEntity({
      id: 'OBJ_sib_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_residence' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [building, shop, shopBedroom, siblingResidence],
      objects: [shopBed, sibBed],
    });

    expect(resolveHome(ctx, 'PLACE_shop', true)).toBe('PLACE_shop_bedroom');
  });

  it('returns sibling bedroom child when sibling residence has a bedroom child with sleeping objects', () => {
    const building = createTestPlace({ id: 'PLACE_building' });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      position: { parent: 'PLACE_building' },
    });
    const residence = createTestPlace({
      id: 'PLACE_residence',
      position: { parent: 'PLACE_building' },
    });
    const bedroom = createTestPlace({
      id: 'PLACE_bedroom',
      position: { parent: 'PLACE_residence' },
    });
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_bedroom' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [building, tavern, residence, bedroom],
      objects: [bed],
    });

    expect(resolveHome(ctx, 'PLACE_tavern', false)).toBe('PLACE_bedroom');
  });

  it('prefers child place over sibling place (preferOnSiteQuarters=true)', () => {
    const parent = createTestPlace({ id: 'PLACE_building' });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      position: { parent: 'PLACE_building' },
    });
    const tavernBedroom = createTestPlace({
      id: 'PLACE_tavern_bedroom',
      position: { parent: 'PLACE_tavern' },
    });
    const siblingRoom = createTestPlace({
      id: 'PLACE_sibling_room',
      position: { parent: 'PLACE_building' },
    });
    const childBed = createTestObjectEntity({
      id: 'OBJ_child_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_tavern_bedroom' },
    });
    const sibBed = createTestObjectEntity({
      id: 'OBJ_sib_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_sibling_room' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [parent, tavern, tavernBedroom, siblingRoom],
      objects: [childBed, sibBed],
    });

    expect(resolveHome(ctx, 'PLACE_tavern', true)).toBe('PLACE_tavern_bedroom');
  });
});

// ============================================================================
// resolveLeisure (FEAT-443)
// ============================================================================

function makeSchedule(
  overrides?: Partial<Record<TimePeriod, LocationType>>
): Record<TimePeriod, LocationType> {
  return {
    dawn: 'home',
    morning: 'work',
    afternoon: 'work',
    evening: 'work',
    night: 'home',
    ...overrides,
  };
}

function makePurposeDef(overrides?: Partial<PurposeDefinition>): PurposeDefinition {
  return {
    id: 'guard',
    label: 'Guard',
    description: 'Patrols and protects an area',
    category: 'character',
    interactionTypeId: 'talk',
    defaultActivityId: 'guard_duty',
    defaultSchedule: {
      dawn: 'work',
      morning: 'work',
      afternoon: 'work',
      evening: 'leisure',
      night: 'home',
    },
    system: false,
    defaultLeisureTagIds: ['TAG_workplace_tavern'],
    ...overrides,
  };
}

describe('resolveLeisure', () => {
  it('returns leisure with favoriteSpot when a sibling tavern exists', () => {
    const town = createTestPlace({ id: 'PLACE_town' });
    const guardhouse = createTestPlace({
      id: 'PLACE_guardhouse',
      position: { parent: 'PLACE_town' },
    });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      label: 'The Rusty Flagon',
      tags: ['TAG_workplace_tavern'],
      position: { parent: 'PLACE_town' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [town, guardhouse, tavern],
    });

    const result = resolveLeisure(
      ctx,
      makeSchedule({ evening: 'leisure' }),
      makePurposeDef(),
      'PLACE_guardhouse'
    );

    expect(result).not.toBeNull();
    expect(result!.favoriteSpot).not.toBeNull();
    expect(result!.favoriteSpot!.placeId).toBe('PLACE_tavern');
    expect(result!.favoriteSpot!.description).toBe('The Rusty Flagon');
    expect(result!.preferredTagIds).toEqual(['TAG_workplace_tavern']);
  });

  it('returns leisure with favoriteSpot for a priest with a temple sibling', () => {
    const town = createTestPlace({ id: 'PLACE_town' });
    const temple = createTestPlace({
      id: 'PLACE_temple',
      position: { parent: 'PLACE_town' },
    });
    const shrine = createTestPlace({
      id: 'PLACE_shrine',
      label: 'Quiet Shrine',
      tags: ['TAG_workplace_temple'],
      position: { parent: 'PLACE_town' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [town, temple, shrine],
    });

    const result = resolveLeisure(
      ctx,
      makeSchedule({ evening: 'leisure' }),
      makePurposeDef({ defaultLeisureTagIds: ['TAG_workplace_temple'] }),
      'PLACE_temple'
    );

    expect(result).not.toBeNull();
    expect(result!.favoriteSpot!.placeId).toBe('PLACE_shrine');
  });

  it('returns null preferredTagIds when no matching sibling exists', () => {
    const town = createTestPlace({ id: 'PLACE_town' });
    const guardhouse = createTestPlace({
      id: 'PLACE_guardhouse',
      position: { parent: 'PLACE_town' },
    });
    const blacksmith = createTestPlace({
      id: 'PLACE_blacksmith',
      tags: ['TAG_workplace_weapon_shop'],
      position: { parent: 'PLACE_town' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [town, guardhouse, blacksmith],
    });

    const result = resolveLeisure(
      ctx,
      makeSchedule({ evening: 'leisure' }),
      makePurposeDef(),
      'PLACE_guardhouse'
    );

    expect(result).not.toBeNull();
    expect(result!.favoriteSpot).toBeNull();
    expect(result!.preferredTagIds).toEqual(['TAG_workplace_tavern']);
  });

  it('returns null when schedule has no leisure period', () => {
    const town = createTestPlace({ id: 'PLACE_town' });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      tags: ['TAG_workplace_tavern'],
      position: { parent: 'PLACE_town' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [town, tavern],
    });

    // Bartender schedule: no leisure period
    const result = resolveLeisure(
      ctx,
      makeSchedule(), // all work/home, no leisure
      makePurposeDef(),
      'PLACE_tavern'
    );

    expect(result).toBeNull();
  });

  it('returns null when purposeDef has no defaultLeisureTagIds', () => {
    const town = createTestPlace({ id: 'PLACE_town' });
    const guardhouse = createTestPlace({
      id: 'PLACE_guardhouse',
      position: { parent: 'PLACE_town' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [town, guardhouse],
    });

    const result = resolveLeisure(
      ctx,
      makeSchedule({ evening: 'leisure' }),
      makePurposeDef({ defaultLeisureTagIds: undefined }),
      'PLACE_guardhouse'
    );

    expect(result).toBeNull();
  });

  it('prefers the sibling with more seating objects when multiple match', () => {
    const town = createTestPlace({ id: 'PLACE_town' });
    const guardhouse = createTestPlace({
      id: 'PLACE_guardhouse',
      position: { parent: 'PLACE_town' },
    });
    const tavernSmall = createTestPlace({
      id: 'PLACE_tavern_small',
      label: 'Small Tavern',
      tags: ['TAG_workplace_tavern'],
      position: { parent: 'PLACE_town' },
    });
    const tavernBig = createTestPlace({
      id: 'PLACE_tavern_big',
      label: 'Big Tavern',
      tags: ['TAG_workplace_tavern'],
      position: { parent: 'PLACE_town' },
    });

    // Small tavern: 1 seat; Big tavern: 3 seats
    const smallSeat = createTestObjectEntity({
      id: 'OBJ_seat_1',
      info: { purpose: 'seating' },
      position: { parent: 'PLACE_tavern_small' },
    });
    const bigSeat1 = createTestObjectEntity({
      id: 'OBJ_seat_2',
      info: { purpose: 'seating' },
      position: { parent: 'PLACE_tavern_big' },
    });
    const bigSeat2 = createTestObjectEntity({
      id: 'OBJ_seat_3',
      info: { purpose: 'seating' },
      position: { parent: 'PLACE_tavern_big' },
    });
    const bigSeat3 = createTestObjectEntity({
      id: 'OBJ_seat_4',
      info: { purpose: 'seating' },
      position: { parent: 'PLACE_tavern_big' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [town, guardhouse, tavernSmall, tavernBig],
      objects: [smallSeat, bigSeat1, bigSeat2, bigSeat3],
    });

    const result = resolveLeisure(
      ctx,
      makeSchedule({ evening: 'leisure' }),
      makePurposeDef(),
      'PLACE_guardhouse'
    );

    expect(result).not.toBeNull();
    expect(result!.favoriteSpot!.placeId).toBe('PLACE_tavern_big');
  });

  it('returns fallback with preferredTagIds when spawn place has no parent', () => {
    const orphan = createTestPlace({
      id: 'PLACE_orphan',
      position: { parent: null },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [orphan],
    });

    const result = resolveLeisure(
      ctx,
      makeSchedule({ evening: 'leisure' }),
      makePurposeDef(),
      'PLACE_orphan'
    );

    expect(result).not.toBeNull();
    expect(result!.favoriteSpot).toBeNull();
    expect(result!.preferredTagIds).toEqual(['TAG_workplace_tavern']);
  });

  it('does not match the spawn place itself as a leisure venue', () => {
    const town = createTestPlace({ id: 'PLACE_town' });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      tags: ['TAG_workplace_tavern'],
      position: { parent: 'PLACE_town' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [town, tavern],
    });

    // Bartender spawns in the tavern — should not get tavern as leisure venue
    const result = resolveLeisure(
      ctx,
      makeSchedule({ evening: 'leisure' }),
      makePurposeDef(),
      'PLACE_tavern'
    );

    expect(result).not.toBeNull();
    expect(result!.favoriteSpot).toBeNull();
  });
});

describe('populateSpecificSlots', () => {
  it('generates characters only for the slots passed in (BUG-082 regression)', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [],
    });

    // Mock generateCharacter to return a distinguishable character per call
    let callCount = 0;
    mockGenerateCharacter.mockImplementation(async () => {
      callCount++;
      return createTestCharacter({
        id: `CHAR_gen_${callCount}`,
        label: `Generated ${callCount}`,
      });
    });

    // No purpose definitions (skips routine assignment)
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    // Only pass the guard slot — bartender and npc are already filled
    const unfilledSlots: GeneratedSlot[] = [
      { purpose: 'guard', x: 5, y: 5, width: 1, height: 1, category: 'character' },
    ];

    await populateSpecificSlots(ctx, 'PLACE_tavern', unfilledSlots);

    // Should have generated exactly 1 character (the guard), not 3
    expect(mockGenerateCharacter).toHaveBeenCalledTimes(1);
    expect(mockGenerateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'guard',
        placeId: 'PLACE_tavern',
        slotPosition: { x: 5, y: 5 },
      })
    );
  });

  it('skips generation when passed an empty slots array', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [],
    });

    await populateSpecificSlots(ctx, 'PLACE_tavern', []);

    expect(mockGenerateCharacter).not.toHaveBeenCalled();
  });

  it('generates multiple characters when multiple unfilled slots are passed', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [],
    });

    let callCount = 0;
    mockGenerateCharacter.mockImplementation(async () => {
      callCount++;
      return createTestCharacter({
        id: `CHAR_gen_${callCount}`,
        label: `Generated ${callCount}`,
      });
    });
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    const unfilledSlots: GeneratedSlot[] = [
      { purpose: 'guard', x: 5, y: 5, width: 1, height: 1, category: 'character' },
      { purpose: 'merchant', x: 10, y: 3, width: 1, height: 1, category: 'character' },
    ];

    await populateSpecificSlots(ctx, 'PLACE_tavern', unfilledSlots);

    expect(mockGenerateCharacter).toHaveBeenCalledTimes(2);
    expect(mockGenerateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'guard' })
    );
    expect(mockGenerateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'merchant' })
    );
  });

  it('snaps character to nearest passable tile when slot is on a blocked tile (BUG-215)', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [],
    });

    // Slot at (1, 1) which is a wall tile. Tile (2, 1) is passable (land).
    const tileSize = 32;
    const terrainGrid = [
      ['wall', 'wall', 'wall', 'wall'],
      ['wall', 'wall', 'land', 'wall'],
      ['wall', 'land', 'land', 'wall'],
      ['wall', 'wall', 'wall', 'wall'],
    ];

    mockLoadPlaceLayout.mockResolvedValue({
      terrainGrid,
      tilemap: { tileSize },
      bounds: { width: 128, height: 128 },
      slots: [],
    } as unknown as PlaceLayout);

    // generateCharacter returns a character positioned at the blocked slot (1,1)
    // The slot position (1,1) becomes pixel position (1*32+16, 1*32+16) = (48, 48)
    const blockedPixelX = 1 * tileSize + tileSize / 2; // 48
    const blockedPixelY = 1 * tileSize + tileSize / 2; // 48
    const character = createTestCharacter({
      id: 'CHAR_guard',
      label: 'Guard',
      position: { x: blockedPixelX, y: blockedPixelY, width: 32, height: 48, parent: 'PLACE_tavern' },
    });
    mockGenerateCharacter.mockResolvedValue(character);
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    const slots: GeneratedSlot[] = [
      { purpose: 'guard', x: 1, y: 1, width: 1, height: 1, category: 'character' },
    ];

    await populateSpecificSlots(ctx, 'PLACE_tavern', slots);

    // Character should have been snapped to (1, 2) — the nearest passable tile
    // BFS checks direction [0,1] (down) before [1,0] (right), so it finds (1,2) first
    const expectedX = 1 * tileSize + tileSize / 2; // 48
    const expectedY = 2 * tileSize + tileSize / 2; // 80
    expect(character.position.x).toBe(expectedX);
    expect(character.position.y).toBe(expectedY);
  });

  it('does not adjust character position when slot is already on a passable tile', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [],
    });

    const tileSize = 32;
    const terrainGrid = [
      ['wall', 'wall', 'wall'],
      ['wall', 'land', 'wall'],
      ['wall', 'wall', 'wall'],
    ];

    mockLoadPlaceLayout.mockResolvedValue({
      terrainGrid,
      tilemap: { tileSize },
      bounds: { width: 96, height: 96 },
      slots: [],
    } as unknown as PlaceLayout);

    // Slot at (1,1) which is passable (land)
    const passablePixelX = 1 * tileSize + tileSize / 2; // 48
    const passablePixelY = 1 * tileSize + tileSize / 2; // 48
    const character = createTestCharacter({
      id: 'CHAR_guard',
      label: 'Guard',
      position: { x: passablePixelX, y: passablePixelY, width: 32, height: 48, parent: 'PLACE_tavern' },
    });
    mockGenerateCharacter.mockResolvedValue(character);
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    const slots: GeneratedSlot[] = [
      { purpose: 'guard', x: 1, y: 1, width: 1, height: 1, category: 'character' },
    ];

    await populateSpecificSlots(ctx, 'PLACE_tavern', slots);

    // Position should remain unchanged
    expect(character.position.x).toBe(passablePixelX);
    expect(character.position.y).toBe(passablePixelY);
  });
});

// ============================================================================
// getCharacterSlots
// ============================================================================

function createTestLayout(slots: GeneratedSlot[]): PlaceLayout {
  return {
    placeId: 'PLACE_test',
    tilemap: { tileSize: 32, width: 10, height: 10, layers: [] },
    bounds: { x: 0, y: 0, width: 320, height: 320 },
    slots,
    terrainGrid: null,
    purpose: null,
    context: null,
    seed: null,
    generatedAt: null,
    characterScale: 1,
  };
}

function createSlot(
  purpose: string,
  category: 'character' | 'object' | 'place',
  x = 0,
  y = 0
): GeneratedSlot {
  return { purpose, category, x, y, width: 1, height: 1, facing: null };
}

describe('getCharacterSlots', () => {
  it('returns only character-category slots', () => {
    const layout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
      createSlot('seating', 'object', 2, 2),
      createSlot('guard', 'character', 8, 1),
      createSlot('bedroom', 'place', 0, 0),
    ]);

    const result = getCharacterSlots(layout);

    expect(result).toHaveLength(2);
    expect(result[0].purpose).toBe('bartender');
    expect(result[1].purpose).toBe('guard');
  });

  it('returns empty array when no character slots', () => {
    const layout = createTestLayout([
      createSlot('seating', 'object'),
      createSlot('bedroom', 'place'),
    ]);

    expect(getCharacterSlots(layout)).toHaveLength(0);
  });
});

// ============================================================================
// detectUnfilledSlots
// ============================================================================

describe('detectUnfilledSlots', () => {
  it('returns all slots as unfilled when no characters exist', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });

    const layout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
      createSlot('guard', 'character', 8, 1),
    ]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(2);
    expect(result[0].slot.purpose).toBe('bartender');
    expect(result[0].placeId).toBe('PLACE_tavern');
    expect(result[1].slot.purpose).toBe('guard');
  });

  it('returns empty array when all slots are filled', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bartender = createTestCharacter({
      id: 'CHAR_bartender',
      info: { purpose: 'bartender' },
      position: { parent: 'PLACE_tavern' },
    });
    const guard = createTestCharacter({
      id: 'CHAR_guard',
      info: { purpose: 'guard' },
      position: { parent: 'PLACE_tavern' },
    });

    const layout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
      createSlot('guard', 'character', 8, 1),
    ]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [bartender, guard],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(0);
  });

  it('returns only unfilled slots when some are filled', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bartender = createTestCharacter({
      id: 'CHAR_bartender',
      info: { purpose: 'bartender' },
      position: { parent: 'PLACE_tavern' },
    });

    const layout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
      createSlot('guard', 'character', 8, 1),
      createSlot('merchant', 'character', 5, 3),
    ]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [bartender],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(2);
    expect(result[0].slot.purpose).toBe('guard');
    expect(result[1].slot.purpose).toBe('merchant');
  });

  it('matches purpose exactly — different purpose does not fill a slot', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const guard = createTestCharacter({
      id: 'CHAR_guard',
      info: { purpose: 'guard' },
      position: { parent: 'PLACE_tavern' },
    });

    const layout = createTestLayout([createSlot('bartender', 'character', 3, 5)]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [guard],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(1);
    expect(result[0].slot.purpose).toBe('bartender');
  });

  it('excludes player characters from matching', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const player = createTestCharacter({
      id: 'CHAR_player',
      info: { purpose: 'bartender', isPlayer: true },
      position: { parent: 'PLACE_tavern' },
    });

    const layout = createTestLayout([createSlot('bartender', 'character', 3, 5)]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [player],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(1);
  });

  it('returns empty array when place has no layout', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    mockLoadPlaceLayout.mockResolvedValue(null);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(0);
  });

  it('returns empty array when layout has no character slots', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });

    const layout = createTestLayout([
      createSlot('seating', 'object'),
      createSlot('bedroom', 'place'),
    ]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(0);
  });

  it('handles multiple slots with the same purpose correctly', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const guard1 = createTestCharacter({
      id: 'CHAR_guard1',
      info: { purpose: 'guard' },
      position: { parent: 'PLACE_tavern' },
    });

    // Two guard slots but only one guard exists
    const layout = createTestLayout([
      createSlot('guard', 'character', 3, 5),
      createSlot('guard', 'character', 7, 2),
    ]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [guard1],
    });

    const result = await detectUnfilledSlots(ctx, 'PLACE_tavern');

    expect(result).toHaveLength(1);
    expect(result[0].slot.purpose).toBe('guard');
    expect(result[0].slot.x).toBe(7);
    expect(result[0].slot.y).toBe(2);
  });
});

// ============================================================================
// populateUnfilledSlots
// ============================================================================

describe('populateUnfilledSlots', () => {
  it('generates characters for unfilled slots after double-check passes', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    // detectUnfilledSlots will be called for the double-check guard
    const layout = createTestLayout([createSlot('guard', 'character', 5, 5)]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
    });

    let callCount = 0;
    mockGenerateCharacter.mockImplementation(async () => {
      callCount++;
      return createTestCharacter({ id: `CHAR_gen_${callCount}` });
    });
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    await populateUnfilledSlots(ctx, [
      { slot: createSlot('guard', 'character', 5, 5), placeId: 'PLACE_tavern' },
    ]);

    expect(mockGenerateCharacter).toHaveBeenCalledTimes(1);
    expect(mockGenerateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'guard' })
    );
  });

  it('skips generation when double-check finds slot was filled', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });
    // A guard now exists (slot was filled between initial detection and generation)
    const guard = createTestCharacter({
      id: 'CHAR_guard',
      info: { purpose: 'guard' },
      position: { parent: 'PLACE_tavern' },
    });

    const layout = createTestLayout([createSlot('guard', 'character', 5, 5)]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [guard],
    });

    await populateUnfilledSlots(ctx, [
      { slot: createSlot('guard', 'character', 5, 5), placeId: 'PLACE_tavern' },
    ]);

    // Double-check guard should prevent generation
    expect(mockGenerateCharacter).not.toHaveBeenCalled();
  });

  it('does nothing with an empty array', async () => {
    await populateUnfilledSlots(
      createMockUniverseContext(defaultMockUniverse),
      []
    );

    expect(mockGenerateCharacter).not.toHaveBeenCalled();
    expect(mockLoadPlaceLayout).not.toHaveBeenCalled();
  });
});

// ============================================================================
// populateSlotCharacters (idempotency)
// ============================================================================

describe('populateSlotCharacters', () => {
  it('generates zero characters when all slots are already filled', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bartender = createTestCharacter({
      id: 'CHAR_bartender',
      info: { purpose: 'bartender' },
      position: { parent: 'PLACE_tavern' },
    });
    const guard = createTestCharacter({
      id: 'CHAR_guard',
      info: { purpose: 'guard' },
      position: { parent: 'PLACE_tavern' },
    });

    const layout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
      createSlot('guard', 'character', 8, 1),
    ]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [bartender, guard],
    });

    await populateSlotCharacters(ctx, 'PLACE_tavern');

    expect(mockGenerateCharacter).not.toHaveBeenCalled();
  });

  it('generates only unfilled slots in a subtree', async () => {
    const building = createTestPlace({ id: 'PLACE_building' });
    const tavern = createTestPlace({
      id: 'PLACE_tavern',
      position: { parent: 'PLACE_building' },
    });
    // Bartender exists but guard does not
    const bartender = createTestCharacter({
      id: 'CHAR_bartender',
      info: { purpose: 'bartender' },
      position: { parent: 'PLACE_tavern' },
    });

    const buildingLayout = createTestLayout([]);
    buildingLayout.placeId = 'PLACE_building';

    const tavernLayout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
      createSlot('guard', 'character', 8, 1),
    ]);
    tavernLayout.placeId = 'PLACE_tavern';

    mockLoadPlaceLayout.mockImplementation(async (_uid: string, placeId: string) => {
      if (placeId === 'PLACE_building') return buildingLayout;
      if (placeId === 'PLACE_tavern') return tavernLayout;
      return null;
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [building, tavern],
      characters: [bartender],
    });

    let callCount = 0;
    mockGenerateCharacter.mockImplementation(async () => {
      callCount++;
      return createTestCharacter({ id: `CHAR_gen_${callCount}` });
    });
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    await populateSlotCharacters(ctx, 'PLACE_building');

    // Only the guard slot should be generated (bartender already exists)
    expect(mockGenerateCharacter).toHaveBeenCalledTimes(1);
    expect(mockGenerateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'guard' })
    );
  });
});

// ============================================================================
// scanUniverseForUnfilledSlots (FEAT-109)
// ============================================================================

describe('scanUniverseForUnfilledSlots', () => {
  it('aggregates unfilled slots across multiple places', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const gate = createTestPlace({ id: 'PLACE_gate' });

    const tavernLayout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
    ]);
    tavernLayout.placeId = 'PLACE_tavern';

    const gateLayout = createTestLayout([
      createSlot('guard', 'character', 8, 1),
    ]);
    gateLayout.placeId = 'PLACE_gate';

    mockLoadPlaceLayout.mockImplementation(async (_uid: string, placeId: string) => {
      if (placeId === 'PLACE_tavern') return tavernLayout;
      if (placeId === 'PLACE_gate') return gateLayout;
      return null;
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern, gate],
    });

    const result = await scanUniverseForUnfilledSlots(ctx);

    expect(result).toHaveLength(2);
    expect(result[0].placeId).toBe('PLACE_tavern');
    expect(result[0].slot.purpose).toBe('bartender');
    expect(result[1].placeId).toBe('PLACE_gate');
    expect(result[1].slot.purpose).toBe('guard');
  });

  it('returns empty array when all slots are filled', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bartender = createTestCharacter({
      id: 'CHAR_bartender',
      info: { purpose: 'bartender' },
      position: { parent: 'PLACE_tavern' },
    });

    const layout = createTestLayout([createSlot('bartender', 'character', 3, 5)]);
    layout.placeId = 'PLACE_tavern';
    mockLoadPlaceLayout.mockResolvedValue(layout);

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [bartender],
    });

    const result = await scanUniverseForUnfilledSlots(ctx);

    expect(result).toHaveLength(0);
  });

  it('skips places with no layout', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const wilderness = createTestPlace({ id: 'PLACE_wilderness' });

    const tavernLayout = createTestLayout([
      createSlot('bartender', 'character', 3, 5),
    ]);
    tavernLayout.placeId = 'PLACE_tavern';

    mockLoadPlaceLayout.mockImplementation(async (_uid: string, placeId: string) => {
      if (placeId === 'PLACE_tavern') return tavernLayout;
      return null; // wilderness has no layout
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern, wilderness],
    });

    const result = await scanUniverseForUnfilledSlots(ctx);

    expect(result).toHaveLength(1);
    expect(result[0].placeId).toBe('PLACE_tavern');
  });

  it('returns empty array when universe has no places', async () => {
    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [],
    });

    const result = await scanUniverseForUnfilledSlots(ctx);

    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// characterHasProperHome (FEAT-131)
// ============================================================================

describe('characterHasProperHome', () => {
  it('returns true when home place has sleeping objects', () => {
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { x: 0, y: 0, width: 32, height: 32, parent: 'PLACE_bedroom' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      objects: [bed],
    });

    expect(characterHasProperHome(ctx, 'PLACE_bedroom')).toBe(true);
  });

  it('returns false when home place has no sleeping objects', () => {
    const chair = createTestObjectEntity({
      id: 'OBJ_chair',
      info: { purpose: 'seating' },
      position: { x: 0, y: 0, width: 32, height: 32, parent: 'PLACE_tavern' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      objects: [chair],
    });

    expect(characterHasProperHome(ctx, 'PLACE_tavern')).toBe(false);
  });

  it('returns false when home place has no objects at all', () => {
    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      objects: [],
    });

    expect(characterHasProperHome(ctx, 'PLACE_empty')).toBe(false);
  });
});

// ============================================================================
// detectCharacterNeeds (FEAT-131)
// ============================================================================

describe('detectCharacterNeeds', () => {
  it('detects a character whose home has no sleeping objects', () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bartender = createTestCharacter({
      id: 'CHAR_bartender',
      position: { x: 0, y: 0, width: 32, height: 32, parent: 'PLACE_tavern' },
      info: {
        isPlayer: false,
        purpose: 'bartender',
        routine: {
          schedule: { morning: 'work', afternoon: 'work', evening: 'work', night: 'home' },
          home: { placeId: 'PLACE_tavern', description: 'Tavern', areaHint: null },
          work: { placeId: 'PLACE_tavern', description: 'Tavern', areaHint: null },
          leisure: null,
          variance: 0.2,
        },
      },
    });

    // No sleeping objects anywhere
    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [bartender],
      objects: [],
    });

    const needs = detectCharacterNeeds(ctx);

    expect(needs).toHaveLength(1);
    expect(needs[0].characterId).toBe('CHAR_bartender');
    expect(needs[0].needType).toBe('home');
    expect(needs[0].nearPlaceId).toBe('PLACE_tavern');
  });

  it('returns empty when character has a proper home with sleeping objects', () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const bedroom = createTestPlace({
      id: 'PLACE_bedroom',
      position: { x: 0, y: 0, width: 32, height: 32, parent: 'PLACE_tavern' },
    });
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { x: 0, y: 0, width: 32, height: 32, parent: 'PLACE_bedroom' },
    });
    const bartender = createTestCharacter({
      id: 'CHAR_bartender',
      position: { x: 0, y: 0, width: 32, height: 32, parent: 'PLACE_tavern' },
      info: {
        isPlayer: false,
        purpose: 'bartender',
        routine: {
          schedule: { morning: 'work', afternoon: 'work', evening: 'work', night: 'home' },
          home: { placeId: 'PLACE_bedroom', description: 'Bedroom', areaHint: null },
          work: { placeId: 'PLACE_tavern', description: 'Tavern', areaHint: null },
          leisure: null,
          variance: 0.2,
        },
      },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern, bedroom],
      characters: [bartender],
      objects: [bed],
    });

    const needs = detectCharacterNeeds(ctx);

    expect(needs).toHaveLength(0);
  });

  it('skips player characters', () => {
    const player = createTestCharacter({
      id: 'CHAR_player',
      info: {
        isPlayer: true,
        purpose: 'player',
        routine: {
          schedule: { morning: 'work', afternoon: 'work', evening: 'work', night: 'home' },
          home: { placeId: 'PLACE_nowhere', description: 'Nowhere', areaHint: null },
          work: { placeId: 'PLACE_nowhere', description: 'Nowhere', areaHint: null },
          leisure: null,
          variance: 0.2,
        },
      },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      characters: [player],
      objects: [],
    });

    const needs = detectCharacterNeeds(ctx);

    expect(needs).toHaveLength(0);
  });

  it('skips characters without routines', () => {
    const npc = createTestCharacter({
      id: 'CHAR_wanderer',
      info: { isPlayer: false, purpose: 'quest_giver', routine: null },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      characters: [npc],
    });

    const needs = detectCharacterNeeds(ctx);

    expect(needs).toHaveLength(0);
  });

  it('detects multiple characters with missing homes', () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern' });
    const makeNpc = (id: string, purpose: string) =>
      createTestCharacter({
        id,
        position: { x: 0, y: 0, width: 32, height: 32, parent: 'PLACE_tavern' },
        info: {
          isPlayer: false,
          purpose,
          routine: {
            schedule: { morning: 'work', afternoon: 'work', evening: 'work', night: 'home' },
            home: { placeId: 'PLACE_tavern', description: 'Tavern', areaHint: null },
            work: { placeId: 'PLACE_tavern', description: 'Tavern', areaHint: null },
            leisure: null,
            variance: 0.2,
          },
        },
      });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      characters: [makeNpc('CHAR_bartender', 'bartender'), makeNpc('CHAR_guard', 'guard')],
      objects: [],
    });

    const needs = detectCharacterNeeds(ctx);

    expect(needs).toHaveLength(2);
  });
});

// ============================================================================
// Parallel slot population (FEAT-358)
// ============================================================================

// ============================================================================
// assignBeds (FEAT-444)
// ============================================================================

describe('assignBeds', () => {
  const makeNpcWithHome = (id: string, homePlaceId: string | null) =>
    createTestCharacter({
      id,
      info: {
        isPlayer: false,
        purpose: 'bartender',
        routine: {
          schedule: { dawn: 'home', morning: 'work', afternoon: 'work', evening: 'work', night: 'home' },
          home: { placeId: homePlaceId, description: 'Quarters', areaHint: null },
          leisure: null,
          variance: 0.2,
        },
      },
    });

  it('assigns bed to first character when one bed exists', () => {
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_home' },
    });
    const char = makeNpcWithHome('CHAR_1', 'PLACE_home');

    const ctx = createMockUniverseContext({ ...defaultMockUniverse, objects: [bed] });

    assignBeds(ctx, [char]);

    expect(char.info.assignedBedId).toBe('OBJ_bed');
  });

  it('second character gets no bed when only one bed exists', () => {
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_home' },
    });
    const char1 = makeNpcWithHome('CHAR_1', 'PLACE_home');
    const char2 = makeNpcWithHome('CHAR_2', 'PLACE_home');

    const ctx = createMockUniverseContext({ ...defaultMockUniverse, objects: [bed] });

    assignBeds(ctx, [char1, char2]);

    expect(char1.info.assignedBedId).toBe('OBJ_bed');
    expect(char2.info.assignedBedId).toBeUndefined();
  });

  it('assigns distinct beds when two beds exist', () => {
    const bed1 = createTestObjectEntity({
      id: 'OBJ_bed1',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_home' },
    });
    const bed2 = createTestObjectEntity({
      id: 'OBJ_bed2',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_home' },
    });
    const char1 = makeNpcWithHome('CHAR_1', 'PLACE_home');
    const char2 = makeNpcWithHome('CHAR_2', 'PLACE_home');

    const ctx = createMockUniverseContext({ ...defaultMockUniverse, objects: [bed1, bed2] });

    assignBeds(ctx, [char1, char2]);

    expect(char1.info.assignedBedId).toBeDefined();
    expect(char2.info.assignedBedId).toBeDefined();
    expect(char1.info.assignedBedId).not.toBe(char2.info.assignedBedId);
  });

  it('skips characters with null homePlaceId', () => {
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_home' },
    });
    const char = makeNpcWithHome('CHAR_1', null);

    const ctx = createMockUniverseContext({ ...defaultMockUniverse, objects: [bed] });

    assignBeds(ctx, [char]);

    expect(char.info.assignedBedId).toBeUndefined();
  });

  it('pre-seeds claimed set from existing characters so refill does not steal assigned beds', () => {
    const bed = createTestObjectEntity({
      id: 'OBJ_bed',
      info: { purpose: 'sleeping' },
      position: { parent: 'PLACE_home' },
    });
    // Existing character already claims the bed
    const existing = makeNpcWithHome('CHAR_existing', 'PLACE_home');
    existing.info.assignedBedId = 'OBJ_bed';

    // Refill character should not steal the bed
    const refill = makeNpcWithHome('CHAR_refill', 'PLACE_home');

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      characters: [existing],
      objects: [bed],
    });

    assignBeds(ctx, [refill]);

    expect(refill.info.assignedBedId).toBeUndefined();
  });
});

// ============================================================================
// assignWorkspaces (FEAT-444)
// ============================================================================

describe('assignWorkspaces', () => {
  const makeNpcWithWork = (id: string, purpose: string, workPlaceId: string | null) =>
    createTestCharacter({
      id,
      info: {
        isPlayer: false,
        purpose,
        routine: {
          schedule: { dawn: 'home', morning: 'work', afternoon: 'work', evening: 'leisure', night: 'home' },
          home: { placeId: null, description: 'Home', areaHint: null },
          work: workPlaceId ? { placeId: workPlaceId, description: 'Work', areaHint: null } : undefined,
          leisure: null,
          variance: 0.2,
        },
      },
    });

  it('assigns workspace to character when purpose has defaultWorkspacePurpose', () => {
    const counter = createTestObjectEntity({
      id: 'OBJ_counter',
      info: { purpose: 'workspace' },
      position: { parent: 'PLACE_tavern' },
    });
    const char = makeNpcWithWork('CHAR_bartender', 'bartender', 'PLACE_tavern');

    const ctx = createMockUniverseContext({ ...defaultMockUniverse, objects: [counter] });
    mockLoadPurposeDefinition.mockReturnValue({ defaultWorkspacePurpose: 'workspace' });

    assignWorkspaces(ctx, [char]);

    expect(char.info.assignedWorkspaceId).toBe('OBJ_counter');
    expect(char.info.assignedWorkspacePurpose).toBe('workspace');
  });

  it('second character gets no workspace when only one exists', () => {
    const counter = createTestObjectEntity({
      id: 'OBJ_counter',
      info: { purpose: 'workspace' },
      position: { parent: 'PLACE_tavern' },
    });
    const char1 = makeNpcWithWork('CHAR_1', 'bartender', 'PLACE_tavern');
    const char2 = makeNpcWithWork('CHAR_2', 'bartender', 'PLACE_tavern');

    const ctx = createMockUniverseContext({ ...defaultMockUniverse, objects: [counter] });
    mockLoadPurposeDefinition.mockReturnValue({ defaultWorkspacePurpose: 'workspace' });

    assignWorkspaces(ctx, [char1, char2]);

    expect(char1.info.assignedWorkspaceId).toBe('OBJ_counter');
    expect(char2.info.assignedWorkspaceId).toBeUndefined();
  });

  it('skips characters whose purpose has no defaultWorkspacePurpose', () => {
    const counter = createTestObjectEntity({
      id: 'OBJ_counter',
      info: { purpose: 'workspace' },
      position: { parent: 'PLACE_tavern' },
    });
    const char = makeNpcWithWork('CHAR_guest', 'guest', 'PLACE_tavern');

    const ctx = createMockUniverseContext({ ...defaultMockUniverse, objects: [counter] });
    mockLoadPurposeDefinition.mockReturnValue({ defaultWorkspacePurpose: undefined });

    assignWorkspaces(ctx, [char]);

    expect(char.info.assignedWorkspaceId).toBeUndefined();
  });
});

describe('populateSpecificSlots parallel execution', () => {
  it('runs slot generation concurrently (not sequentially)', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [],
    });

    // Track concurrent execution via overlap detection
    let activeCalls = 0;
    let maxConcurrent = 0;
    let callCount = 0;

    mockGenerateCharacter.mockImplementation(async () => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      // Small delay to allow concurrent calls to overlap
      await new Promise((resolve) => setTimeout(resolve, 20));
      callCount++;
      activeCalls--;
      return createTestCharacter({
        id: `CHAR_gen_${callCount}`,
        label: `Generated ${callCount}`,
      });
    });
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    const slots: GeneratedSlot[] = [
      { purpose: 'guard', x: 5, y: 5, width: 1, height: 1, category: 'character' },
      { purpose: 'merchant', x: 10, y: 3, width: 1, height: 1, category: 'character' },
      { purpose: 'bartender', x: 2, y: 2, width: 1, height: 1, category: 'character' },
    ];

    await populateSpecificSlots(ctx, 'PLACE_tavern', slots);

    expect(mockGenerateCharacter).toHaveBeenCalledTimes(3);
    // With concurrency limit 3 and 3 slots, all should run concurrently
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('logs failures for rejected slot generation without aborting batch', async () => {
    const tavern = createTestPlace({ id: 'PLACE_tavern', label: 'The Tavern' });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [tavern],
      objects: [],
    });

    let callCount = 0;
    mockGenerateCharacter.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error('LLM timeout');
      return createTestCharacter({
        id: `CHAR_gen_${callCount}`,
        label: `Generated ${callCount}`,
      });
    });
    mockLoadPurposeDefinition.mockReturnValue(undefined);

    const slots: GeneratedSlot[] = [
      { purpose: 'guard', x: 5, y: 5, width: 1, height: 1, category: 'character' },
      { purpose: 'merchant', x: 10, y: 3, width: 1, height: 1, category: 'character' },
    ];

    // Should not throw — failures are logged, not propagated
    await populateSpecificSlots(ctx, 'PLACE_tavern', slots);

    // Both slots were attempted
    expect(mockGenerateCharacter).toHaveBeenCalledTimes(2);
  });
});
