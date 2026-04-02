/**
 * Unit tests for sprite direction lookup, purpose-level facing constraints (BUG-128),
 * and supportedOrientations-based facing (FEAT-238).
 *
 * Tests that getSpriteDirections reads supportedOrientations first, falls back to
 * directions keys, and that getRandomSupportedFacing picks orientations correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs and data paths before importing
vi.mock('fs', () => ({
  readdirSync: vi.fn().mockReturnValue([
    'barrel.json',
    'chair.json',
    'bed.json',
    'stool.json',
    'crate.json',
    'wardrobe.json',
  ]),
}));

vi.mock('@dmnpc/core/infra/read-json-file.js', () => ({
  readJsonFileSync: vi.fn((path: string) => {
    if (path.includes('sprite-registry')) {
      return {
        sprites: {
          barrel_sprite: {
            id: 'barrel_sprite',
            width: 32,
            height: 32,
            boundingBox: null,
            directions: null,
            supportedOrientations: ['north', 'south', 'east', 'west'],
          },
          chair_sprite: {
            id: 'chair_sprite',
            width: 32,
            height: 32,
            boundingBox: null,
            directions: {
              north: { x: 0, y: 0 },
              south: { x: 32, y: 0 },
              east: { x: 64, y: 0 },
              west: { x: 96, y: 0 },
            },
            supportedOrientations: ['north', 'south', 'east', 'west'],
          },
          bed_sprite: {
            id: 'bed_sprite',
            width: 64,
            height: 64,
            boundingBox: null,
            directions: null,
            supportedOrientations: ['south'],
          },
          stool_sprite: {
            id: 'stool_sprite',
            width: 32,
            height: 32,
            boundingBox: null,
            directions: {
              north: { x: 0, y: 0 },
              south: { x: 32, y: 0 },
            },
            supportedOrientations: ['north', 'south'],
          },
          crate_sprite: {
            id: 'crate_sprite',
            width: 32,
            height: 32,
            boundingBox: null,
            directions: null,
            supportedOrientations: ['north', 'south', 'east', 'west'],
          },
          legacy_sprite: {
            id: 'legacy_sprite',
            width: 32,
            height: 32,
            boundingBox: null,
            directions: {
              north: { x: 0, y: 0 },
              south: { x: 32, y: 0 },
              east: { x: 64, y: 0 },
            },
            supportedOrientations: ['north', 'south', 'east'],
          },
          wardrobe_sprite: {
            id: 'wardrobe_sprite',
            width: 64,
            height: 64,
            boundingBox: null,
            directions: null,
            supportedOrientations: ['south'],
          },
        },
      };
    }
    // Object catalog files
    if (path.includes('barrel.json')) {
      return {
        id: 'barrel',
        name: 'Barrel',
        purposes: ['storage', 'decoration'],
        spriteId: 'barrel_sprite',
        tags: ['common'],
      };
    }
    if (path.includes('chair.json')) {
      return {
        id: 'chair',
        name: 'Chair',
        purposes: ['seating', 'decoration'],
        spriteId: 'chair_sprite',
        tags: ['common', 'furniture'],
      };
    }
    if (path.includes('bed.json')) {
      return {
        id: 'bed',
        name: 'Bed',
        purposes: ['sleeping'],
        spriteId: 'bed_sprite',
        tags: ['common', 'furniture'],
      };
    }
    if (path.includes('stool.json')) {
      return {
        id: 'stool',
        name: 'Stool',
        purposes: ['seating', 'decoration'],
        spriteId: 'stool_sprite',
        tags: ['common'],
      };
    }
    if (path.includes('crate.json')) {
      return {
        id: 'crate',
        name: 'Crate',
        purposes: ['storage'],
        spriteId: 'crate_sprite',
        tags: ['common'],
      };
    }
    if (path.includes('wardrobe.json')) {
      return {
        id: 'wardrobe',
        name: 'Wardrobe',
        purposes: ['storage'],
        spriteId: 'wardrobe_sprite',
        tags: ['furniture'],
      };
    }
    return {};
  }),
}));

vi.mock('@dmnpc/data', () => ({
  ENTITIES_DIR: '/mock/entities',
  SPRITE_REGISTRY_PATH: '/mock/sprite-registry.json',
}));

// Import after mocks
const {
  getSpriteDirections,
  getAllowedFacingsForPurpose,
  getAnyAllowedFacingsForPurpose,
  getEntitiesByPurpose,
  getRandomSupportedFacing,
} = await import('../../src/place-layout/object-catalog.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSpriteDirections', () => {
  it('returns direction keys for a sprite with directions and supportedOrientations', () => {
    const dirs = getSpriteDirections('chair_sprite');
    expect(dirs).toEqual(expect.arrayContaining(['north', 'south', 'east', 'west']));
    expect(dirs).toHaveLength(4);
  });

  it('reads supportedOrientations from a sprite with no directions (symmetric object)', () => {
    // barrel_sprite has supportedOrientations but no directions
    const dirs = getSpriteDirections('barrel_sprite');
    expect(dirs).toEqual(expect.arrayContaining(['north', 'south', 'east', 'west']));
    expect(dirs).toHaveLength(4);
  });

  it('returns south-only for a south-only sprite', () => {
    expect(getSpriteDirections('bed_sprite')).toEqual(['south']);
  });

  it('throws for a non-existent sprite', () => {
    expect(() => getSpriteDirections('nonexistent')).toThrow('not found in sprite registry');
  });

  it('returns partial directions for a sprite with subset', () => {
    const dirs = getSpriteDirections('stool_sprite');
    expect(dirs).toEqual(expect.arrayContaining(['north', 'south']));
    expect(dirs).toHaveLength(2);
  });

  it('reads supportedOrientations regardless of directions field', () => {
    // legacy_sprite has both supportedOrientations and directions — reads supportedOrientations
    const dirs = getSpriteDirections('legacy_sprite');
    expect(dirs).toEqual(expect.arrayContaining(['north', 'south', 'east']));
    expect(dirs).toHaveLength(3);
  });

  it('reads supportedOrientations from a directionless sprite', () => {
    // crate_sprite has supportedOrientations but no directions
    const dirs = getSpriteDirections('crate_sprite');
    expect(dirs).toEqual(expect.arrayContaining(['north', 'south', 'east', 'west']));
    expect(dirs).toHaveLength(4);
  });
});

describe('getAllowedFacingsForPurpose', () => {
  it('returns intersection: south-only when storage includes south-only wardrobe', () => {
    // storage: barrel (4 dirs) + crate (4 dirs) + wardrobe (south only) → intersection = south
    const facings = getAllowedFacingsForPurpose('storage');
    expect(facings).toEqual(['south']);
  });

  it('returns intersection of facings for seating purpose', () => {
    // seating purpose: chair (4 dirs) + stool (2 dirs) → intersection = north, south
    const facings = getAllowedFacingsForPurpose('seating');
    expect(facings).toEqual(expect.arrayContaining(['north', 'south']));
    expect(facings).not.toContain('east');
    expect(facings).not.toContain('west');
  });

  it('returns intersection of facings for mixed-direction candidates', () => {
    // decoration purpose: barrel (4 dirs), chair (4 dirs), stool (2 dirs)
    // intersection = north, south (stool limits to these two)
    const facings = getAllowedFacingsForPurpose('decoration');
    expect(facings).toEqual(expect.arrayContaining(['north', 'south']));
    expect(facings).toHaveLength(2);
  });

  it('returns south-only for purpose with no matching candidates', () => {
    const facings = getAllowedFacingsForPurpose('nonexistent_purpose');
    expect(facings).toEqual(['south']);
  });

  it('returns south-only for sleeping purpose (single non-directional candidate)', () => {
    const facings = getAllowedFacingsForPurpose('sleeping');
    expect(facings).toEqual(['south']);
  });

  it('respects requiredTags filtering', () => {
    // seating with tag 'furniture': only chair matches (4 dirs)
    const facings = getAllowedFacingsForPurpose('seating', ['furniture']);
    expect(facings).toEqual(expect.arrayContaining(['north', 'south', 'east', 'west']));
    expect(facings).toHaveLength(4);
  });
});

describe('getAnyAllowedFacingsForPurpose (BUG-156)', () => {
  it('returns union: all four facings for storage (barrel/crate support all, wardrobe south-only)', () => {
    // Union: barrel (4 dirs) ∪ crate (4 dirs) ∪ wardrobe (south) → all four
    const facings = getAnyAllowedFacingsForPurpose('storage');
    expect(facings).toEqual(expect.arrayContaining(['north', 'south', 'east', 'west']));
    expect(facings).toHaveLength(4);
  });

  it('returns union of facings for seating purpose', () => {
    // seating: chair (4 dirs) ∪ stool (north, south) → all four
    const facings = getAnyAllowedFacingsForPurpose('seating');
    expect(facings).toEqual(expect.arrayContaining(['north', 'south', 'east', 'west']));
    expect(facings).toHaveLength(4);
  });

  it('returns south-only for sleeping purpose (single south-only candidate)', () => {
    const facings = getAnyAllowedFacingsForPurpose('sleeping');
    expect(facings).toEqual(['south']);
  });

  it('returns south-only for purpose with no matching candidates', () => {
    const facings = getAnyAllowedFacingsForPurpose('nonexistent_purpose');
    expect(facings).toEqual(['south']);
  });

  it('respects requiredTags filtering', () => {
    // storage with tag 'furniture': only wardrobe matches (south only)
    const facings = getAnyAllowedFacingsForPurpose('storage', ['furniture']);
    expect(facings).toEqual(['south']);
  });
});

describe('getEntitiesByPurpose supportedFacing filter (BUG-156)', () => {
  it('returns all storage entities when no facing filter', () => {
    const entities = getEntitiesByPurpose('storage');
    expect(entities.map((e: { id: string }) => e.id).sort()).toEqual(['barrel', 'crate', 'wardrobe']);
  });

  it('filters to only entities supporting north facing', () => {
    const entities = getEntitiesByPurpose('storage', undefined, undefined, 'north');
    const ids = entities.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(['barrel', 'crate']);
    expect(ids).not.toContain('wardrobe');
  });

  it('filters to all entities supporting south facing', () => {
    const entities = getEntitiesByPurpose('storage', undefined, undefined, 'south');
    const ids = entities.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(['barrel', 'crate', 'wardrobe']);
  });

  it('combines tag and facing filters', () => {
    // storage + tag 'furniture' + facing 'south' → only wardrobe
    const entities = getEntitiesByPurpose('storage', ['furniture'], undefined, 'south');
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe('wardrobe');
  });

  it('returns empty when no entities support the requested facing', () => {
    // sleeping + facing 'north' → bed only supports south
    const entities = getEntitiesByPurpose('sleeping', undefined, undefined, 'north');
    expect(entities).toHaveLength(0);
  });
});

describe('getRandomSupportedFacing', () => {
  it('returns south for south-only purpose (sleeping)', () => {
    const facing = getRandomSupportedFacing('sleeping', Math.random);
    expect(facing).toBe('south');
  });

  it('returns south for non-existent purpose', () => {
    const facing = getRandomSupportedFacing('nonexistent_purpose', Math.random);
    expect(facing).toBe('south');
  });

  it('returns a valid facing for multi-direction purpose', () => {
    // storage: barrel + crate both support all 4 directions
    const facing = getRandomSupportedFacing('storage', () => 0.5);
    expect(facing).not.toBeNull();
    expect(['north', 'south', 'east', 'west']).toContain(facing);
  });

  it('respects requiredTags when picking facing', () => {
    // seating with tag 'furniture': only chair (4 dirs) → valid facing
    const facing = getRandomSupportedFacing('seating', () => 0.25, ['furniture']);
    expect(facing).not.toBeNull();
    expect(['north', 'south', 'east', 'west']).toContain(facing);
  });

  it('returns deterministic facing based on rng', () => {
    // storage has 4 directions; rng=0 should always pick the first
    const facing1 = getRandomSupportedFacing('storage', () => 0);
    const facing2 = getRandomSupportedFacing('storage', () => 0);
    expect(facing1).toBe(facing2);
  });
});
