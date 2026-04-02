/**
 * Unit tests for the minimum-hierarchy validator.
 *
 * Tests detection and repair of insufficient hierarchy levels in a universe.
 * The validator now just checks for cosmos and world existence - template-based
 * validation handles deeper hierarchy via slot definitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateMinimumHierarchy,
  repairMinimumHierarchy,
} from '@dmnpc/studio/integrity/validators/minimum-hierarchy.js';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';
import type { Place, Universe } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

const ROOT_PLACE_ID = 'PLACE_the_cosmos';

// Mock universe-validator for repair operations
vi.mock('@dmnpc/generation/universe-validator.js', () => ({
  validateAndComplete: vi.fn().mockResolvedValue({
    valid: true,
    placesChecked: 5,
    placesGenerated: 2,
    errors: [],
  }),
  findCosmos: vi.fn().mockImplementation((ctx: { places: Place[] }) => {
    return ctx.places.find((p: Place) => p.id === 'PLACE_the_cosmos');
  }),
}));

// Mock place generator
vi.mock('@dmnpc/generation/place-generator.js', () => ({
  generatePlace: vi.fn().mockImplementation(async (_ctx, opts) => ({
    id: `PLACE_${opts.label.toLowerCase().replace(/\s+/g, '_')}`,
    label: opts.label,
    description: opts.description,
    entityType: 'place',
    tags: [],
    position: { x: 0, y: 0, width: 400, height: 400, parent: opts.parentId },
    info: {
      purpose: opts.purpose || 'wilderness',
      environment: ENVIRONMENT_PRESETS.exterior(),
      scale: 'feet',
      spriteConfig: { spriteId: 'test' },
    },
    relationships: [],
    important: true,
  })),
}));

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('validateMinimumHierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockPlace(overrides: Partial<Place> & { id: string; label: string }): Place {
    return {
      id: overrides.id,
      label: overrides.label,
      entityType: 'place',
      description: overrides.description || 'Test place',
      short_description: 'test',
      tags: [],
      position: { x: 0, y: 0, width: 400, height: 400, parent: null, ...overrides.position },
      info: {
        purpose: 'wilderness',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        spriteConfig: { spriteId: 'test' },
        ...overrides.info,
      },
      relationships: [],
      ...overrides,
    };
  }

  function createMockValidationContext(places: Place[]): ValidationContext {
    const universe: Universe = {
      id: 'test_universe',
      name: 'Test Universe',
      description: 'A test universe',
      places,
    };

    return {
      universe,
      places: new Map(places.map((p) => [p.id, p])),
      characters: new Map(),
      objects: new Map(),
      events: new Map(),
      validRaceIds: new Set(),
      rootPlaceId: places[0]?.id || '',
    };
  }

  it('detects missing cosmos', () => {
    const places: Place[] = [];
    const ctx = createMockValidationContext(places);

    const result = validateMinimumHierarchy(ctx);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].purpose).toBe('cosmos');
    expect(result.issues[0].description).toContain('cosmos');
  });

  it('detects missing world under cosmos', () => {
    const cosmos = createMockPlace({
      id: ROOT_PLACE_ID,
      label: 'The Cosmos',
      info: { purpose: 'cosmos', environment: ENVIRONMENT_PRESETS.space(), scale: 'lightyears', spriteConfig: { spriteId: 'cosmos' } },
    });

    const places = [cosmos];
    const ctx = createMockValidationContext(places);

    const result = validateMinimumHierarchy(ctx);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].purpose).toBe('planet');
    expect(result.issues[0].description).toMatch(/planet/);
  });

  it('passes when cosmos and world exist', () => {
    const cosmos = createMockPlace({
      id: ROOT_PLACE_ID,
      label: 'The Cosmos',
      info: { purpose: 'cosmos', environment: ENVIRONMENT_PRESETS.space(), scale: 'lightyears', spriteConfig: { spriteId: 'cosmos' } },
    });

    const world = createMockPlace({
      id: 'PLACE_world',
      label: 'Test World',
      position: { x: 0, y: 0, width: 400, height: 400, parent: ROOT_PLACE_ID },
      info: { purpose: 'planet', environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', spriteConfig: { spriteId: 'planet_terran' } },
    });

    const places = [cosmos, world];
    const ctx = createMockValidationContext(places);

    const result = validateMinimumHierarchy(ctx);

    expect(result.issues).toHaveLength(0);
  });

  it('passes when cosmos and planet exist (cosmos template generates planets)', () => {
    const cosmos = createMockPlace({
      id: ROOT_PLACE_ID,
      label: 'The Cosmos',
      info: { purpose: 'cosmos', environment: ENVIRONMENT_PRESETS.space(), scale: 'lightyears', spriteConfig: { spriteId: 'cosmos' } },
    });

    const planet = createMockPlace({
      id: 'PLACE_planet',
      label: 'Test Planet',
      position: { x: 0, y: 0, width: 400, height: 400, parent: ROOT_PLACE_ID },
      info: { purpose: 'planet', environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', spriteConfig: { spriteId: 'planet' } },
    });

    const places = [cosmos, planet];
    const ctx = createMockValidationContext(places);

    const result = validateMinimumHierarchy(ctx);

    expect(result.issues).toHaveLength(0);
  });
});

describe('repairMinimumHierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockPlace(overrides: Partial<Place> & { id: string; label: string }): Place {
    return {
      id: overrides.id,
      label: overrides.label,
      entityType: 'place',
      description: overrides.description || 'Test place',
      short_description: 'test',
      tags: [],
      position: { x: 0, y: 0, width: 400, height: 400, parent: null, ...overrides.position },
      info: {
        purpose: 'wilderness',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        spriteConfig: { spriteId: 'test' },
        ...overrides.info,
      },
      relationships: [],
      ...overrides,
    };
  }

  function createMockValidationContext(places: Place[]): ValidationContext {
    const universe: Universe = {
      id: 'test_universe',
      name: 'Test Universe',
      description: 'A test universe',
      places,
    };

    return {
      universe,
      places: new Map(places.map((p) => [p.id, p])),
      characters: new Map(),
      objects: new Map(),
      events: new Map(),
      validRaceIds: new Set(),
      rootPlaceId: places[0]?.id || '',
    };
  }

  function createMockUniverseContext(places: Place[]) {
    return {
      universeId: 'test_universe',
      universe: { id: 'test_universe', name: 'Test Universe' },
      places,
      upsertEntity: vi.fn(),
    };
  }

  it('does not repair when no cosmos found', async () => {
    const places: Place[] = [];
    const ctx = createMockValidationContext(places);
    const universeCtx = createMockUniverseContext(places);

    const result = await repairMinimumHierarchy(ctx, universeCtx as any);

    expect(result.repaired).toBe(false);
    expect(result.repairs).toContain('Cannot repair: no cosmos found');
  });

  it('calls validateAndComplete for repairs', async () => {
    const { validateAndComplete } = await import('@dmnpc/generation/universe-validator.js');

    const cosmos = createMockPlace({
      id: ROOT_PLACE_ID,
      label: 'The Cosmos',
      info: { purpose: 'cosmos', environment: ENVIRONMENT_PRESETS.space(), scale: 'lightyears', spriteConfig: { spriteId: 'cosmos' } },
    });

    const places = [cosmos];
    const ctx = createMockValidationContext(places);
    const universeCtx = createMockUniverseContext(places);

    await repairMinimumHierarchy(ctx, universeCtx as any);

    expect(vi.mocked(validateAndComplete)).toHaveBeenCalledWith(
      universeCtx,
      ROOT_PLACE_ID,
      expect.objectContaining({ generate: true })
    );
  });

  it('reports generated places in result', async () => {
    const cosmos = createMockPlace({
      id: ROOT_PLACE_ID,
      label: 'The Cosmos',
      info: { purpose: 'cosmos', environment: ENVIRONMENT_PRESETS.space(), scale: 'lightyears', spriteConfig: { spriteId: 'cosmos' } },
    });

    const places = [cosmos];
    const ctx = createMockValidationContext(places);
    const universeCtx = createMockUniverseContext(places);

    const result = await repairMinimumHierarchy(ctx, universeCtx as any);

    expect(result.placesGenerated).toBe(2); // From mock
    expect(result.repaired).toBe(true);
  });
});
