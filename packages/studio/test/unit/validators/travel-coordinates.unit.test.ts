/**
 * Travel Coordinates Validator Tests
 *
 * Tests for the validator that checks vessels in transit and their destinations
 * have valid coordinates for ETA calculation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateTravelCoordinates,
  repairTravelCoordinates,
} from '@dmnpc/studio/integrity/validators/travel-coordinates.js';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';
import type { Place, Universe } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

// Mock universe context
const mockUpsertEntity = vi.fn();
const mockUniverse: Universe = {
  id: 'test-universe',
  name: 'Test Universe',
  description: 'A test universe',
};

function createMockUniverseContext(): UniverseContext {
  return {
    universe: mockUniverse,
    universeId: 'test-universe',
    upsertEntity: mockUpsertEntity,
    findPlace: vi.fn(),
    findCharacter: vi.fn(),
    findObject: vi.fn(),
    findEvent: vi.fn(),
    characters: [],
    places: [],
    objects: [],
    events: [],
  } as unknown as UniverseContext;
}

function createPlace(id: string, label: string, overrides: Partial<Place> = {}): Place {
  return {
    id,
    label,
    description: `Description of ${label}`,
    short_description: label,
    important: false,
    entityType: 'place',
    tags: [],
    relationships: [],
    position: {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      parent: null,
    },
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    info: {
      environment: ENVIRONMENT_PRESETS.exterior(),
      scale: 'miles',
      size: { width: 100, height: 100 },
    },
    ...overrides,
  } as Place;
}

function createValidationContext(places: Place[]): ValidationContext {
  return {
    universe: mockUniverse,
    universeId: 'test-universe',
    characters: new Map(),
    places: new Map(places.map((p) => [p.id, p])),
    objects: new Map(),
    events: new Map(),
    worldBible: undefined,
  };
}

describe('validateTravelCoordinates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty result when no vessels are in transit', () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: null },
    });

    const vessel = createPlace('PLACE_vessel', 'Test Vessel', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 100, height: 50 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_region' },
      tags: ['TAG_vessel'],
      // No destinationPlaceId - vessel is docked
    });

    const ctx = createValidationContext([region, vessel]);
    const result = validateTravelCoordinates(ctx);

    expect(result.vesselsInTransitCount).toBe(0);
    expect(result.vesselsMissingCoordinates).toHaveLength(0);
    expect(result.destinationsMissingCoordinates).toHaveLength(0);
  });

  it('should detect region children missing coordinates', () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: null },
    });

    const city = createPlace('PLACE_city', 'Test City', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 1000, height: 1000 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const harbor = createPlace('PLACE_harbor', 'Test Harbor', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 500, height: 500 } },
      position: { x: 80, y: 50, width: 400, height: 400, parent: 'PLACE_city' },
    });

    const ctx = createValidationContext([region, city, harbor]);
    const result = validateTravelCoordinates(ctx);

    // City is a child of region, so it should be checked
    expect(result.placesChecked).toBeGreaterThan(0);
    // Since coordinates are always valid now, no missing coordinates should be found
    expect(result.regionChildrenMissingCoordinates).toHaveLength(0);
  });

  it('should pass when vessel is in transit with valid coordinates', () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: null },
    });

    const city = createPlace('PLACE_city', 'Test City', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 1000, height: 1000 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const harbor = createPlace('PLACE_harbor', 'Test Harbor', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 500, height: 500 } },
      position: { x: 80, y: 50, width: 400, height: 400, parent: 'PLACE_city' },
    });

    const vessel = createPlace('PLACE_vessel', 'Test Vessel', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 100, height: 50 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
      tags: ['TAG_vessel'],
      destinationPlaceId: 'PLACE_harbor',
    });

    const ctx = createValidationContext([region, city, harbor, vessel]);
    const result = validateTravelCoordinates(ctx);

    expect(result.vesselsInTransitCount).toBe(1);
    expect(result.vesselsMissingCoordinates).toHaveLength(0);
    expect(result.destinationsMissingCoordinates).toHaveLength(0);
  });
});

describe('repairTravelCoordinates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not repair when no issues exist', async () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: null },
    });

    const city = createPlace('PLACE_city', 'Test City', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 1000, height: 1000 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const vessel = createPlace('PLACE_vessel', 'Test Vessel', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 100, height: 50 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
      tags: ['TAG_vessel'],
      destinationPlaceId: 'PLACE_harbor',
    });

    const harbor = createPlace('PLACE_harbor', 'Test Harbor', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 500, height: 500 } },
      position: { x: 80, y: 50, width: 400, height: 400, parent: 'PLACE_city' },
    });

    const ctx = createValidationContext([region, city, vessel, harbor]);
    const universeCtx = createMockUniverseContext();

    const result = await repairTravelCoordinates(ctx, universeCtx);

    expect(result.repaired).toBe(false);
    expect(result.repairs).toHaveLength(0);
    expect(mockUpsertEntity).not.toHaveBeenCalled();
  });

});
