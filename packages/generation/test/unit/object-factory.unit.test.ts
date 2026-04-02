/**
 * Object Factory Unit Tests
 *
 * Regression tests for BUG-105: isStructural must come from the placed object
 * (slot-level), not a blanket template flag.
 */

import { describe, it, expect, vi } from 'vitest';
import { createObjectEntity } from '../../src/place-layout/object-factory.js';
import type { StagedPlacedObject } from '../../src/place-layout/layers/context-populator.js';
import { createTestPlace } from '@dmnpc/core/test-helpers/index.js';

// Mock dependencies
const { mockGetSpriteDimensions, mockGetEntityProperties, mockGetSpriteDefaultLayer, mockGetEntityWallVerticalOffsetPx, mockGetEntityDefaultTint } = vi.hoisted(() => {
  const mockGetSpriteDimensions = (spriteId: string) =>
    spriteId === 'ship_mast_small' ? { width: 96, height: 416 } : { width: 32, height: 32 };

  const mockGetEntityProperties = (entityId: string) => ({
    solid: true,
    layer: entityId === 'floor_grate' ? ('floor' as const) : ('default' as const),
    materials: [] as string[],
    tintable: false,
    lightSource: null,
  });

  const mockGetSpriteDefaultLayer = (spriteId: string) =>
    spriteId === 'hatch_sprite' ? ('floor' as const) : null;

  // wall_torch has wallVerticalOffset: -1 (= -32px); all others have 0
  const mockGetEntityWallVerticalOffsetPx = (entityId: string) =>
    entityId === 'wall_torch' ? -32 : 0;

  // golden_key has defaultTint 0xFFD700 (16766720); all others have null
  const mockGetEntityDefaultTint = (entityId: string) =>
    entityId === 'golden_key' ? 16766720 : null;

  return { mockGetSpriteDimensions, mockGetEntityProperties, mockGetSpriteDefaultLayer, mockGetEntityWallVerticalOffsetPx, mockGetEntityDefaultTint };
});

vi.mock('../../src/place-layout/object-catalog.js', () => ({
  getEntityDefinition: (entityId: string) => {
    const sprites: Record<string, string | null> = {
      ship_mast: 'ship_mast_small',
      hatch_object: 'hatch_sprite',
      golden_key: 'golden_key',
      invisible_marker: null,
    };
    const names: Record<string, string> = {
      exit_door: 'Exit Door',
      ship_mast: 'Ship Mast',
      floor_grate: 'Floor Grate',
      hatch_object: 'Deck Hatch',
      golden_key: 'Golden Key',
      invisible_marker: 'Invisible Marker',
    };
    const purposes: Record<string, string> = {
      exit_door: 'exit',
      ship_mast: 'ship_mast',
      floor_grate: 'decoration',
      hatch_object: 'decoration',
      golden_key: 'item',
      invisible_marker: 'player_start',
    };
    return {
      id: entityId,
      name: names[entityId] ?? 'Ship Wheel',
      description: 'A test object',
      purpose: purposes[entityId] ?? 'vessel_helm',
      sprite: entityId in sprites ? sprites[entityId] : 'test_sprite',
      tags: [],
    };
  },
  getSpriteDimensions: mockGetSpriteDimensions,
  computeWorldPosition: (tileX: number, tileY: number, footprintW = 1, footprintH = 1) => {
    const tileSize = 32;
    return { x: tileX * tileSize + (footprintW * tileSize) / 2, y: (tileY + footprintH) * tileSize };
  },
  getEntityProperties: mockGetEntityProperties,
  getSpriteDefaultLayer: mockGetSpriteDefaultLayer,
  getEntityWallVerticalOffsetPx: mockGetEntityWallVerticalOffsetPx,
  getEntityDefaultTint: mockGetEntityDefaultTint,
}));

vi.mock('../../src/purpose-loader.js', () => ({
  loadInteractionTypeIdForPurpose: (purpose: string) => {
    if (purpose === 'vessel_helm') return 'helm';
    if (purpose === 'item') return 'pickup';
    return null;
  },
}));

function createMockContext() {
  const entities: Array<{ id: string }> = [];
  return {
    objects: entities,
    upsertEntity: vi.fn((_type: string, entity: { id: string }) => {
      entities.push(entity);
    }),
  } as unknown as Parameters<typeof createObjectEntity>[2];
}

describe('createObjectEntity', () => {
  it('sets isStructural=true when placed object has isStructural=true', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'exit_door',
      position: { x: 5, y: 5 },
      facing: 'south',
      layer: 'default',
      isStructural: true,
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.isStructural).toBe(true);
  });

  it('sets isStructural=false when placed object has isStructural=false', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 10, y: 10 },
      facing: 'south',
      layer: 'default',
      isStructural: false,
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.isStructural).toBe(false);
  });

  it('defaults isStructural to false when omitted from placed object', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 10, y: 10 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.isStructural).toBe(false);
  });

  it('uses facing from placedObject directly', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 10, y: 10 },
      facing: 'east',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.spriteConfig.facing).toBe('east');
  });

  it('positions object using bounding box dimensions when available', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_mast',
      position: { x: 15, y: 20 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 2, h: 2 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    // ship_mast bbox is 59x59 → footprint 2x2
    // x = 15 * 32 + (2 * 32) / 2 = 480 + 32 = 512
    // y = (20 + 2) * 32 = 704
    expect(entity.position.x).toBe(15 * 32 + 32);
    expect(entity.position.y).toBe((20 + 2) * 32);
  });

  it('positions object using full sprite dimensions when no bounding box', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 10, y: 10 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    // Always center on tile, bottom-aligned
    expect(entity.position.x).toBe(10 * 32 + 16);
    expect(entity.position.y).toBe((10 + 1) * 32);
  });

  it('allows structural exit and non-structural helm from the same template', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const exitObj: StagedPlacedObject = {
      objectTypeId: 'exit_door',
      position: { x: 5, y: 5 },
      facing: 'south',
      layer: 'default',
      isStructural: true,
      footprint: { w: 1, h: 1 },
    };

    const helmObj: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 10, y: 10 },
      facing: 'south',
      layer: 'default',
      isStructural: false,
      footprint: { w: 1, h: 1 },
    };

    const exitEntity = createObjectEntity(place, exitObj, ctx);
    const helm = createObjectEntity(place, helmObj, ctx);

    expect(exitEntity.info.isStructural).toBe(true);
    expect(helm.info.isStructural).toBe(false);
  });

  // BUG-135: In-wall objects must be centered on their slot tile and
  // bottom-aligned at the tile's bottom edge.

  it('centers in-wall object on slot tile for north facing', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 5, y: 3 },
      facing: 'north',
      layer: 'wall',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.position.x).toBe(5 * 32 + 16); // center of tile
    expect(entity.position.y).toBe((3 + 1) * 32); // bottom of tile
  });

  it('centers in-wall object on slot tile for south facing', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 8, y: 10 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.position.x).toBe(8 * 32 + 16); // center of tile
    expect(entity.position.y).toBe((10 + 1) * 32); // bottom of tile
  });

  it('centers in-wall object on slot tile for east facing', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 2, y: 5 },
      facing: 'east',
      layer: 'wall',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.position.x).toBe(2 * 32 + 16); // center of tile
    expect(entity.position.y).toBe((5 + 1) * 32); // bottom of tile
  });

  it('centers in-wall object on slot tile for west facing', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 15, y: 7 },
      facing: 'west',
      layer: 'wall',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.position.x).toBe(15 * 32 + 16); // center of tile
    expect(entity.position.y).toBe((7 + 1) * 32); // bottom of tile
  });

  it('uses standard positioning for south-facing objects', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 10, y: 10 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.position.x).toBe(10 * 32 + 16);
    expect(entity.position.y).toBe((10 + 1) * 32);
  });

  it('uses wall positioning with bounding box sprite when facing is set', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_mast',
      position: { x: 4, y: 6 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 2, h: 2 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    // ship_mast bbox is 59x59 → footprint 2x2
    // x = 4 * 32 + (2 * 32) / 2 = 128 + 32 = 160
    // y = (6 + 2) * 32 = 256
    expect(entity.position.x).toBe(4 * 32 + 32);
    expect(entity.position.y).toBe((6 + 2) * 32);
  });

  it('uses placedObject.layer for entity layer (FEAT-260)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'exit_door',
      position: { x: 5, y: 19 },
      facing: 'north',
      layer: 'wall',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.layer).toBe('wall');
  });

  it('uses default layer from placedObject (FEAT-260)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'exit_door',
      position: { x: 5, y: 0 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.layer).toBe('default');
  });

  it('uses catalog entity layer when explicitly non-default (FEAT-267)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'floor_grate',
      position: { x: 5, y: 5 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.layer).toBe('floor');
  });

  it('catalog entity layer overrides slot layer even when slot is non-default (FEAT-267)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'floor_grate',
      position: { x: 5, y: 5 },
      facing: 'south',
      layer: 'wall',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.layer).toBe('floor');
  });

  it('falls back to slot layer when catalog entity has default layer (FEAT-267)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 5, y: 5 },
      facing: 'east',
      layer: 'wall',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.layer).toBe('wall');
  });

  // FEAT-284: wallVerticalOffset shifts the world Y position so wall-mounted
  // objects (torches, trophies) render at head height rather than floor level.
  it('applies wallVerticalOffset to world Y position (FEAT-284)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'wall_torch',
      position: { x: 5, y: 8 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    // Base Y without offset: (8 + 1) * 32 = 288
    // wallVerticalOffset = -1 tile → -32px applied to Y
    expect(entity.position.y).toBe((8 + 1) * 32 + (-32));
    // X is unaffected
    expect(entity.position.x).toBe(5 * 32 + 16);
  });

  it('does not shift Y for objects with no wallVerticalOffset (FEAT-284)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 5, y: 8 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.position.y).toBe((8 + 1) * 32);
  });

  it('uses sprite defaultLayer when catalog has no explicit layer (FEAT-267)', () => {
    const place = createTestPlace({ id: 'PLACE_test_ship' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'hatch_object',
      position: { x: 5, y: 5 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.layer).toBe('floor');
  });

  // FEAT-305: item purpose sets itemId and pickup interaction
  it('sets itemId to entityId when purpose is "item" (FEAT-305)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'golden_key',
      position: { x: 3, y: 4 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.itemId).toBe('golden_key');
  });

  it('sets itemId to null when purpose is not "item" (FEAT-305)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 3, y: 4 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.itemId).toBeNull();
  });

  it('sets interaction to pickup for item purpose (FEAT-305)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'golden_key',
      position: { x: 3, y: 4 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.interaction).toEqual({ typeId: 'pickup' });
  });

  it('uses defaultTint from catalog when no explicit tint on placed object (FEAT-305)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'golden_key',
      position: { x: 3, y: 4 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.tint).toBe(16766720);
  });

  it('uses explicit tint over defaultTint when provided (FEAT-305)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'golden_key',
      position: { x: 3, y: 4 },
      facing: 'south',
      layer: 'default',
      tint: 0xC0C0C0,
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.tint).toBe(0xC0C0C0);
  });

  it('tint is null when no explicit tint and no catalog defaultTint (FEAT-305)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_wheel',
      position: { x: 3, y: 4 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.tint).toBeNull();
  });

  // BUG-263: slot footprint overrides sprite bounding box for world position.
  // A 2-tile-tall door on a 1x1 in_wall slot must anchor at the slot tile,
  // not be pushed down by the sprite height.
  it('uses slot footprint for world position when provided (BUG-263)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    // ship_mast has a bbox that yields footprintH=2, but slot footprint is 1x1
    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_mast',
      position: { x: 5, y: 10 },
      facing: 'south',
      layer: 'wall',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    // With slot footprint 1x1: y = (10 + 1) * 32 = 352
    expect(entity.position.y).toBe((10 + 1) * 32);
    expect(entity.position.x).toBe(5 * 32 + 16);
  });

  it('uses large footprint for multi-tile objects (BUG-263)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    // ship_mast on a 2x2 slot — footprint drives position, not sprite bbox
    const placedObject: StagedPlacedObject = {
      objectTypeId: 'ship_mast',
      position: { x: 5, y: 10 },
      facing: 'south',
      layer: 'default',
      footprint: { w: 2, h: 2 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    // With footprint 2x2: y = (10 + 2) * 32 = 384
    expect(entity.position.y).toBe((10 + 2) * 32);
    expect(entity.position.x).toBe(5 * 32 + 32);
  });

  it('creates valid entity when sprite is null (FEAT-367)', () => {
    const place = createTestPlace({ id: 'PLACE_test_room' });
    const ctx = createMockContext();

    const placedObject: StagedPlacedObject = {
      objectTypeId: 'invisible_marker',
      position: { x: 7, y: 9 },
      facing: 'south',
      layer: 'floor',
      footprint: { w: 1, h: 1 },
    };

    const entity = createObjectEntity(place, placedObject, ctx);
    expect(entity.info.spriteConfig.spriteId).toBeNull();
    expect(entity.position.width).toBe(32);
    expect(entity.position.height).toBe(32);
    expect(entity.position.x).toBe(7 * 32 + 16);
    expect(entity.position.y).toBe((9 + 1) * 32);
  });
});
