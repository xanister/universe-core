/**
 * Unit tests for the query universe tools (list_places, find_place, get_place_details).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@xanister/reagent', () => ({
  tool: vi.fn().mockImplementation((config) => config),
}));

import {
  listPlacesTool,
  findPlaceTool,
  getPlaceDetailsTool,
} from '@dmnpc/generation/agent/tools/query-universe.js';
import type { GeneratorToolContext } from '@dmnpc/generation/agent/types.js';

function makeMockPlace(overrides: {
  id: string;
  label: string;
  purpose: string;
  parentId: string | null;
  description?: string;
  scale?: string;
}) {
  return {
    id: overrides.id,
    label: overrides.label,
    description: overrides.description ?? `A ${overrides.label}`,
    position: { parent: overrides.parentId, x: 0, y: 0 },
    info: {
      purpose: overrides.purpose,
      scale: overrides.scale ?? 'feet',
    },
  };
}

function makeMockObject(overrides: { id: string; label: string; purpose: string }) {
  return {
    id: overrides.id,
    label: overrides.label,
    info: { purpose: overrides.purpose },
  };
}

function makeMockCharacter(overrides: {
  id: string;
  label: string;
  purpose: string;
  parentId: string;
}) {
  return {
    id: overrides.id,
    label: overrides.label,
    position: { parent: overrides.parentId, x: 0, y: 0 },
    info: { purpose: overrides.purpose },
  };
}

const cosmosPlace = makeMockPlace({
  id: 'place_cosmos',
  label: 'Test Cosmos',
  purpose: 'cosmos',
  parentId: null,
  scale: 'lightyears',
});

const cityPlace = makeMockPlace({
  id: 'place_city',
  label: 'Ironhaven',
  purpose: 'city',
  parentId: 'place_cosmos',
  scale: 'miles',
});

const tavernPlace = makeMockPlace({
  id: 'place_tavern',
  label: 'The Rusty Mug',
  purpose: 'tavern',
  parentId: 'place_city',
});

const allPlaces = [cosmosPlace, cityPlace, tavernPlace] as any[];

function buildContext(overrides?: {
  places?: any[];
  objects?: any[];
  characters?: any[];
}): { context: GeneratorToolContext } {
  const places = overrides?.places ?? allPlaces;
  const objects = overrides?.objects ?? [];
  const characters = overrides?.characters ?? [];

  return {
    context: {
      universeContext: {
        getAllPlaces: vi.fn().mockReturnValue(places),
        getAllCharacters: vi.fn().mockReturnValue(characters),
        getChildPlaces: vi.fn().mockImplementation((placeId: string) =>
          places.filter((p: any) => p.position.parent === placeId)
        ),
        getObjectsByPlace: vi.fn().mockImplementation((placeId: string) =>
          objects.filter((o: any) => o.placeId === placeId || placeId === 'place_tavern')
        ),
        findPlace: vi.fn().mockImplementation((placeId: string) =>
          places.find((p: any) => p.id === placeId) ?? undefined
        ),
      },
    } as unknown as GeneratorToolContext,
  };
}

describe('list_places tool', () => {
  it('returns all places with hierarchy info', async () => {
    const opts = buildContext();
    const result = await listPlacesTool.execute({}, opts);

    expect(result.total).toBe(3);
    expect(result.places).toHaveLength(3);
    expect(result.places[0]).toEqual({
      id: 'place_cosmos',
      label: 'Test Cosmos',
      purpose: 'cosmos',
      parentId: null,
      childCount: 1,
    });
    expect(result.places[1].childCount).toBe(1);
    expect(result.places[2].childCount).toBe(0);
  });

  it('returns empty list when no places exist', async () => {
    const opts = buildContext({ places: [] });
    const result = await listPlacesTool.execute({}, opts);

    expect(result.places).toEqual([]);
    expect(result.message).toBe('No places created yet.');
  });
});

describe('find_place tool', () => {
  it('finds places by label substring (case-insensitive)', async () => {
    const opts = buildContext();
    const result = await findPlaceTool.execute({ query: 'rusty' }, opts);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].id).toBe('place_tavern');
  });

  it('finds places by purpose', async () => {
    const opts = buildContext();
    const result = await findPlaceTool.execute({ query: 'city' }, opts);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].label).toBe('Ironhaven');
  });

  it('returns empty matches when nothing found', async () => {
    const opts = buildContext();
    const result = await findPlaceTool.execute({ query: 'nonexistent' }, opts);

    expect(result.matches).toEqual([]);
    expect(result.message).toContain('No places match');
  });
});

describe('get_place_details tool', () => {
  it('returns full place details with children, objects, and characters', async () => {
    const objects = [
      {
        ...makeMockObject({ id: 'obj_chair', label: 'Chair', purpose: 'seating' }),
        placeId: 'place_tavern',
      },
    ];
    const characters = [
      makeMockCharacter({
        id: 'char_bartender',
        label: 'Grog',
        purpose: 'bartender',
        parentId: 'place_tavern',
      }),
    ];
    const opts = buildContext({ objects, characters });

    const result = await getPlaceDetailsTool.execute({ placeId: 'place_tavern' }, opts);

    expect(result.id).toBe('place_tavern');
    expect(result.label).toBe('The Rusty Mug');
    expect(result.purpose).toBe('tavern');
    expect(result.scale).toBe('feet');
    expect(result.children).toEqual([]);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].label).toBe('Chair');
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].label).toBe('Grog');
  });

  it('throws when place not found', async () => {
    const opts = buildContext();
    await expect(
      getPlaceDetailsTool.execute({ placeId: 'nonexistent' }, opts)
    ).rejects.toThrow('not found');
  });
});
