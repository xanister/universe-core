/**
 * Unit tests for post-generation validation.
 */

import { describe, it, expect, vi } from 'vitest';

const { mockLoadPurposeIds } = vi.hoisted(() => ({
  mockLoadPurposeIds: vi.fn().mockReturnValue(['cosmos', 'city', 'tavern', 'village']),
}));

vi.mock('@dmnpc/generation/purpose-loader.js', () => ({
  loadPurposeIds: mockLoadPurposeIds,
}));

import { validateGeneratedUniverse } from '@dmnpc/generation/agent/validation.js';

function makePlace(
  id: string,
  label: string,
  purpose: string,
  parent: string | null
) {
  return { id, label, info: { purpose }, position: { parent } };
}

function makeCtx(
  places: ReturnType<typeof makePlace>[],
  rootPlaceId: string | null = null
) {
  return {
    universe: { rootPlaceId: rootPlaceId ?? '' },
    getAllPlaces: () => places,
    findPlace: (id: string) => places.find((p) => p.id === id) ?? null,
    getChildPlaces: (parentId: string) =>
      places.filter((p) => p.position.parent === parentId),
  } as any;
}

describe('validateGeneratedUniverse', () => {
  it('passes for a valid universe with connected hierarchy', () => {
    const places = [
      makePlace('root', 'Cosmos', 'cosmos', null),
      makePlace('city1', 'City One', 'city', 'root'),
      makePlace('tavern1', 'The Rusty Mug', 'tavern', 'city1'),
    ];
    const ctx = makeCtx(places, 'root');

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('errors when no places created', () => {
    const ctx = makeCtx([], 'root');

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Only 0 place(s)'));
  });

  it('errors when root place ID is not set', () => {
    const places = [makePlace('p1', 'Place', 'cosmos', null)];
    const ctx = makeCtx(places, null);

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('No root place ID'));
  });

  it('errors when root place ID does not resolve', () => {
    const places = [makePlace('p1', 'Place', 'cosmos', null)];
    const ctx = makeCtx(places, 'nonexistent');

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('does not resolve'));
  });

  it('warns on orphaned places not reachable from root', () => {
    const places = [
      makePlace('root', 'Cosmos', 'cosmos', null),
      makePlace('orphan', 'Lost Island', 'village', 'deleted_parent'),
    ];
    const ctx = makeCtx(places, 'root');

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('orphaned'));
    expect(result.warnings).toContainEqual(expect.stringContaining('Lost Island'));
  });

  it('warns on duplicate sibling names', () => {
    const places = [
      makePlace('root', 'Cosmos', 'cosmos', null),
      makePlace('c1', 'The Tavern', 'tavern', 'root'),
      makePlace('c2', 'the tavern', 'tavern', 'root'),
    ];
    const ctx = makeCtx(places, 'root');

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('Duplicate sibling'));
  });

  it('warns on unknown purposes', () => {
    const places = [
      makePlace('root', 'Cosmos', 'cosmos', null),
      makePlace('p1', 'Mystery', 'unknown_purpose', 'root'),
    ];
    const ctx = makeCtx(places, 'root');

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('unknown purpose'));
  });

  it('allows duplicate names under different parents', () => {
    const places = [
      makePlace('root', 'Cosmos', 'cosmos', null),
      makePlace('c1', 'Inn', 'tavern', 'root'),
      makePlace('c2', 'Town', 'city', 'root'),
      makePlace('c3', 'Inn', 'tavern', 'c2'),
    ];
    const ctx = makeCtx(places, 'root');

    const result = validateGeneratedUniverse(ctx);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
