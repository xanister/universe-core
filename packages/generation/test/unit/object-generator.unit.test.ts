/**
 * Unit tests for the object generator.
 *
 * Tests the exit object creation logic including:
 * - Duplicate detection
 * - Exit object entity creation with target derived from hierarchy
 * - One-way exits from child to parent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Place, ObjectEntity, Universe } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

// Mock place and exit data for tests
// Hierarchy: tavern (parent) <- cellar (child)
const mockTavern: Place = {
  id: 'PLACE_tavern',
  label: 'The Rusty Mug',
  description: 'A cozy tavern',
  short_description: 'cozy tavern',
  entityType: 'place',
  tags: [],
  info: { environment: ENVIRONMENT_PRESETS.interior(), scale: 'feet' },
  position: { x: 0, y: 0, parent: null, width: 100, height: 100, innerWidth: 800, innerHeight: 600 },
  relationships: [],
};

const mockCellar: Place = {
  id: 'PLACE_cellar',
  label: 'The Wine Cellar',
  description: 'A dark cellar',
  short_description: 'dark cellar',
  entityType: 'place',
  tags: [],
  info: { environment: ENVIRONMENT_PRESETS.interior(), scale: 'feet' },
  position: { x: 0, y: 0, parent: 'PLACE_tavern', width: 60, height: 60, innerWidth: 400, innerHeight: 400 },
  relationships: [],
};

const mockUniverse: Universe = {
  id: 'test_universe',
  name: 'Test Universe',
  description: 'Test universe',
  version: '1.0.0',
  custom: {},
  rules: 'Test rules',
  tone: 'Neutral',
  style: 'Test style',
  date: '1.1.1',
  races: [],
  rootPlaceId: 'PLACE_root',
};

// Track mock state
const mockPlaces = new Map<string, Place>([
  ['PLACE_tavern', mockTavern],
  ['PLACE_cellar', mockCellar],
]);
let mockExits: ObjectEntity[] = [];
const upsertedEntities: { type: string; entity: unknown }[] = [];
let ctx: UniverseContext;

// Mock LLM for position estimation
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn().mockResolvedValue({
    content: {
      x: 0.5,
      y: 0.9,
      reasoning: 'Placed at bottom center for cellar stairs',
    },
  }),
}));

// Mock position utilities
vi.mock('@dmnpc/core/entities/position-utils.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dmnpc/core/entities/position-utils.js')>();
  return {
    ...original,
    mapPositionToWorld: vi.fn((x: number, y: number, size: { width: number; height: number }) => ({
      x: x * size.width,
      y: y * size.height,
    })),
  };
});

import { generateExitObject } from '@dmnpc/generation/object-generator.js';

type MockUniverseContext = {
  universeId: string;
  universe: Universe;
  objects: ObjectEntity[];
  getPlace: (id: string) => Place;
  findPlace: (id: string) => Place | null;
  getExitsFromPlace: (placeId: string) => ObjectEntity[];
  findExitByTarget: (sourcePlaceId: string, targetPlaceId: string) => ObjectEntity | undefined;
  upsertEntity: (type: string, entity: unknown) => void;
};

function createMockCtx(): MockUniverseContext {
  return {
    universeId: 'test_universe',
    universe: mockUniverse,
    get objects() {
      return mockExits;
    },
    getPlace: (id: string) => {
      const place = mockPlaces.get(id);
      if (!place) throw new Error(`Place ${id} not found`);
      return place;
    },
    findPlace: (id: string) => mockPlaces.get(id) ?? null,
    getExitsFromPlace: (placeId: string) =>
      mockExits.filter((e) => e.position.parent === placeId),
    findExitByTarget: (sourcePlaceId: string, targetPlaceId: string) => {
      // In hierarchical model, target is derived from source place's parent
      const sourcePlace = mockPlaces.get(sourcePlaceId);
      if (!sourcePlace || sourcePlace.position.parent !== targetPlaceId) {
        return undefined;
      }
      // Find any exit in source place
      return mockExits.find(
        (e) => e.position.parent === sourcePlaceId && e.info.purpose === 'exit'
      );
    },
    upsertEntity: (type: string, entity: unknown) => {
      upsertedEntities.push({ type, entity });
    },
  };
}

describe('generateExitObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExits = [];
    upsertedEntities.length = 0;
    ctx = createMockCtx() as unknown as UniverseContext;
  });

  it('creates an exit object with target derived from hierarchy', async () => {
    // Create exit in cellar (child) - target will be tavern (parent)
    const exit = await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      label: 'The Tavern',
      exitType: 'stairs',
    });

    expect(exit.id).toBe('OBJ_exit_cellar_the_tavern');
    expect(exit.label).toBe('The Tavern');
    expect(exit.entityType).toBe('object');
    expect(exit.info.purpose).toBe('exit');
    expect(exit.interaction?.typeId).toBe('enter');
    expect(exit.position.parent).toBe('PLACE_cellar');
    expect(upsertedEntities.length).toBeGreaterThan(0);
  });

  it('throws error when place not found', async () => {
    await expect(
      generateExitObject(ctx, {
        placeId: 'PLACE_nonexistent',
        label: 'The Door',
        exitType: 'door',
      })
    ).rejects.toThrow('not found');
  });

  it('throws error when place has no parent (cannot derive target)', async () => {
    // Tavern has no parent, so exits cannot be created for it
    await expect(
      generateExitObject(ctx, {
        placeId: 'PLACE_tavern',
        label: 'Outside',
        exitType: 'door',
      })
    ).rejects.toThrow('has no parent');
  });

  it('returns existing exit if duplicate found by label', async () => {
    const existingExit = {
      id: 'OBJ_exit_cellar_the_rusty_mug',
      label: 'The Rusty Mug',
      description: 'Stairs to tavern',
      short_description: 'stairs',
      entityType: 'object',
      tags: [],
      info: {
        purpose: 'exit',
        solid: true,
        layer: 'default',
        spriteConfig: { spriteId: 'stairs_up' },

      },
      interaction: { typeId: 'enter' },
      position: { x: 0, y: 0, parent: 'PLACE_cellar', width: 32, height: 32 },
      relationships: [],
    } as unknown as ObjectEntity;
    mockExits = [existingExit];

    const exit = await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      label: 'The Rusty Mug',
      exitType: 'door',
    });

    // Should return existing exit since label matches
    expect(exit.id).toBe('OBJ_exit_cellar_the_rusty_mug');
  });

  it('includes direction hint when provided', async () => {
    const exit = await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      label: 'The Tavern',
      exitType: 'stairs',
      direction: 'up',
    });

    // Direction is no longer stored on entity data (FEAT-071)
    expect(exit.interaction?.typeId).toBe('enter');
  });

  it('creates exit with estimated position from LLM', async () => {
    const exit = await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      label: 'The Tavern',
      exitType: 'stairs',
    });

    // Exits are created with estimated position coordinates
    // Default mock returns x=0.5, y=0.9, converted to world coords using inner dimensions (400x400 for cellar)
    expect(exit.position.x).toBe(200); // 0.5 * 400 (innerWidth)
    expect(exit.position.y).toBe(360); // 0.9 * 400 (innerHeight)
    expect(exit.position.parent).toBe('PLACE_cellar');
  });

  it('does not create reverse exit (exits are one-way)', async () => {
    // Exits only go from child to parent.
    // Entry to child places is via the slot/position system.
    await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      label: 'The Tavern',
      exitType: 'stairs',
    });

    // Should NOT have created a reverse exit - only the main exit from cellar
    const reverseExit = upsertedEntities.find(
      (e) =>
        e.type === 'object' &&
        (e.entity as ObjectEntity).position.parent === 'PLACE_tavern' &&
        (e.entity as ObjectEntity).info.purpose === 'exit'
    );
    expect(reverseExit).toBeUndefined();

    // Main exit should exist
    const mainExit = upsertedEntities.find(
      (e) =>
        e.type === 'object' &&
        (e.entity as ObjectEntity).position.parent === 'PLACE_cellar' &&
        (e.entity as ObjectEntity).info.purpose === 'exit'
    );
    expect(mainExit).toBeDefined();
  });

  it('defaults label to parent place label when not provided', async () => {
    const exit = await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      exitType: 'stairs',
    });

    // Label should default to parent place's label
    expect(exit.label).toBe('The Rusty Mug');
  });

  it('resolves sprite from exitType map', async () => {
    const exit = await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      label: 'The Stairs',
      exitType: 'stairs',
    });

    // Should use the exitType map: 'stairs' → 'stairs_up'
    expect(exit.info.spriteConfig.spriteId).toBe('stairs_up');
  });

  it('resolves each exitType to its expected sprite', async () => {
    const expectations: Record<string, string> = {
      door: 'door_wooden',
      archway: 'archway',
      gate: 'gate',
      ladder: 'ladder',
      trapdoor: 'trapdoor',
      teleporter: 'teleporter',
      passage: 'secret_passage',
    };

    for (const [exitType, expectedSprite] of Object.entries(expectations)) {
      // Reset state for each iteration
      mockExits = [];
      upsertedEntities.length = 0;

      const exit = await generateExitObject(ctx, {
        placeId: 'PLACE_cellar',
        label: `Exit ${exitType}`,
        exitType,
      });

      expect(exit.info.spriteConfig.spriteId).toBe(expectedSprite);
    }
  });

  it('defaults to door_wooden for unknown exitType', async () => {
    const exit = await generateExitObject(ctx, {
      placeId: 'PLACE_cellar',
      label: 'The Gangway',
      exitType: 'gangway',
    });

    // Unknown exitType falls back to door_wooden
    expect(exit.info.spriteConfig.spriteId).toBe('door_wooden');
  });
});
