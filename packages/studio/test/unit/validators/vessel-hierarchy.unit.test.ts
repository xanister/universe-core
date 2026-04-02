/**
 * Vessel Hierarchy Validator Tests
 *
 * Tests for the validator that checks vessel interior places
 * are properly parented under the vessel container.
 *
 * NOTE: This validator only detects places connected to vessel interiors
 * via exits. All detected issues generate clarification questions -
 * there is no automatic repair based on naming patterns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateVesselHierarchy,
  repairVesselHierarchy,
} from '@dmnpc/studio/integrity/validators/vessel-hierarchy.js';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';
import type { Place, Universe, ObjectEntity } from '@dmnpc/types/entity';
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
    info: {
      environment: ENVIRONMENT_PRESETS.exterior(),
      scale: 'miles',
      size: { width: 100, height: 100 },
    },
    ...overrides,
  } as Place;
}

function createVesselHelm(vesselPlaceId: string): ObjectEntity {
  return {
    id: `OBJ_helm_${vesselPlaceId}`,
    label: 'Helm',
    description: 'Ship wheel',
    short_description: 'helm',
    entityType: 'object',
    tags: [],
    relationships: [],
    position: { x: 50, y: 50, width: 32, height: 32, parent: vesselPlaceId },
    info: { purpose: 'vessel_helm', solid: true, layer: 'default', spriteConfig: { spriteId: 'helm' } },
  } as ObjectEntity;
}

function createExit(id: string, sourcePlaceId: string, targetPlaceId: string): ObjectEntity {
  return {
    id,
    label: `Exit ${id}`,
    description: 'An exit',
    short_description: 'exit',
    entityType: 'object',
    tags: [],
    relationships: [],
    position: { x: 50, y: 50, width: 32, height: 32, parent: sourcePlaceId },
    info: {
      purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' },
      options: {
        exitType: 'door',
        targetPlaceId,
      },
    },
  } as ObjectEntity;
}

function createValidationContext(places: Place[], exits: ObjectEntity[] = []): ValidationContext {
  return {
    universe: mockUniverse,
    universeId: 'test-universe',
    characters: new Map(),
    places: new Map(places.map((p) => [p.id, p])),
    objects: new Map(exits.map((e) => [e.id, e])),
    events: new Map(),
    worldBible: undefined,
  };
}

describe('validateVesselHierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty result when no vessels exist', () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
    });

    const ctx = createValidationContext([region]);
    const result = validateVesselHierarchy(ctx);

    expect(result.vesselCount).toBe(0);
    expect(result.misparentedPlaces).toHaveLength(0);
  });

  it('should return empty result when vessel hierarchy is correct', () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
    });

    const vessel = createPlace('PLACE_the_ledgerwake', 'The Ledgerwake', {
      destinationPlaceId: 'PLACE_harbor', // Vessel in transit
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const deck = createPlace('PLACE_ledgerwake_deck', 'Ledgerwake Deck', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 50, height: 50 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_the_ledgerwake' }, // Correct parent
    });

    const hold = createPlace('PLACE_ledgerwake_hold', 'Ledgerwake Hold', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 50, height: 50 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_the_ledgerwake' }, // Correct parent
    });

    const helmLedgerwake = createVesselHelm('PLACE_the_ledgerwake');

    const ctx = createValidationContext([region, vessel, deck, hold], [helmLedgerwake]);
    const result = validateVesselHierarchy(ctx);

    expect(result.vesselCount).toBe(1);
    expect(result.misparentedPlaces).toHaveLength(0);
  });

  // NOTE: Tests for exit-based connection detection have been removed.
  // The vessel hierarchy validator now uses hierarchy-based detection (position.parent),
  // not exit targetPlaceId. Connections are determined by the place hierarchy, not exits.

  it('should detect place whose parent is a vessel interior', () => {
    // In hierarchy model, if a place's parent is a vessel interior (but not the vessel root),
    // it might indicate a misparented place that should be directly under the vessel.
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
    });

    const vessel = createPlace('PLACE_the_ledgerwake', 'The Ledgerwake', {
      destinationPlaceId: 'PLACE_harbor', // Vessel in transit
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    // Correct child of vessel
    const deck = createPlace('PLACE_ledgerwake_deck', 'Ledgerwake Deck', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 50, height: 50 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_the_ledgerwake' },
    });

    const helmLedgerwake = createVesselHelm('PLACE_the_ledgerwake');

    const ctx = createValidationContext([region, vessel, deck], [helmLedgerwake]);
    const result = validateVesselHierarchy(ctx);

    expect(result.vesselCount).toBe(1);
    // Deck is properly parented under the vessel, so no issues
    expect(result.misparentedPlaces).toHaveLength(0);
    expect(result.clarificationQuestions).toHaveLength(0);
    expect(result.pendingClarification).toBe(0);
  });

  it('should NOT flag place that is an ancestor of a vessel even if naming matches', () => {
    // This tests the bug fix: a port city named "Straitwarden Kholm" should NOT be
    // flagged for reparenting under "Straitwarden Kholm Chainpoint Packet Ship"
    // because the city is the PARENT of the ship, not the other way around.

    const region = createPlace('PLACE_duras_straits', 'Duras Straits', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 1000, height: 1000 } },
    });

    // City is child of region
    const city = createPlace('PLACE_straitwarden_kholm', 'Straitwarden Kholm', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_duras_straits' },
    });

    // Ship is child of city (docked at the port)
    // Note: Vessel label is proper ship name, not location-prefixed descriptor
    const vessel = createPlace('PLACE_the_marchwatch', 'The Marchwatch', {
      destinationPlaceId: 'PLACE_other_port', // Vessel marked for transit
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_straitwarden_kholm' }, // Ship docked at city
    });

    // Exit connecting city to vessel (gangway)
    const exit = createExit(
      'OBJ_exit_city_to_ship',
      'PLACE_straitwarden_kholm',
      'PLACE_the_marchwatch'
    );

    const helmMarchwatch = createVesselHelm('PLACE_the_marchwatch');

    const ctx = createValidationContext([region, city, vessel], [exit, helmMarchwatch]);
    const result = validateVesselHierarchy(ctx);

    // The city matches vessel naming ("straitwarden" and "kholm") but it's the PARENT
    // of the vessel, so it should NOT be flagged for reparenting
    expect(result.vesselCount).toBe(1);
    expect(result.misparentedPlaces).toHaveLength(0); // City should NOT be flagged!
  });

  it('should NOT flag ancestor place connected to vessel interior via exit', () => {
    // This tests the bug fix: a place that is an ancestor of the vessel (vessel docked there)
    // connected to a vessel interior (cabin) should NOT be flagged.
    // e.g., Farbound Reliquary (parent of vessel) → Bonded Purser Cabin (child of vessel)

    const region = createPlace('PLACE_duras_straits', 'Duras Straits', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 1000, height: 1000 } },
    });

    // Reliquary is child of region, will be parent of vessel
    const reliquary = createPlace('PLACE_farbound_reliquary', 'Farbound Reliquary', {
      tags: ['sanctuary', 'destination'],
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_duras_straits' },
    });

    // Vessel is docked at the reliquary (reliquary is the vessel's parent)
    const vessel = createPlace('PLACE_the_ledgerwake', 'The Ledgerwake', {
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_farbound_reliquary' },
    });

    // Cabin is inside the vessel
    const cabin = createPlace('PLACE_bonded_purser_cabin', 'Bonded Purser Cabin', {
      info: { environment: ENVIRONMENT_PRESETS.interior(), scale: 'feet', size: { width: 100, height: 100 } },
      position: { x: 5, y: 5, width: 400, height: 400, parent: 'PLACE_the_ledgerwake' },
    });

    // Exit from cabin back to reliquary (exit gangway)
    // This is normal architecture - you exit the cabin to the dock where vessel is moored
    const exitCabinToReliquary = createExit(
      'OBJ_exit_cabin_to_reliquary',
      'PLACE_bonded_purser_cabin',
      'PLACE_farbound_reliquary'
    );

    const helmLedgerwake = createVesselHelm('PLACE_the_ledgerwake');

    const ctx = createValidationContext(
      [region, reliquary, vessel, cabin],
      [exitCabinToReliquary, helmLedgerwake]
    );
    const result = validateVesselHierarchy(ctx);

    // Reliquary should NOT be flagged - it's an ancestor of the vessel
    // and the cabin is a descendant of the reliquary (through the vessel)
    expect(result.vesselCount).toBe(1);
    expect(result.misparentedPlaces).toHaveLength(0);
    expect(result.clarificationQuestions).toHaveLength(0);
  });

  it('should NOT flag dock connected directly to vessel root via boarding exit', () => {
    // This tests the bug fix: a dock with a gangplank exit directly to the vessel
    // (not to a vessel interior like deck/cabin) should NOT be flagged.
    // The validator should only flag connections to vessel *children*, not the vessel root itself.

    const region = createPlace('PLACE_the_duras_crown_march', 'The Duras Crown March', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 1000, height: 1000 } },
    });

    // Dock is child of region
    const dock = createPlace(
      'PLACE_crownchain_haven_dockside_piers',
      'Crownchain Haven Dockside Piers',
      {
        tags: ['TAG_dock'],
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 500, height: 500 } },
        position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_the_duras_crown_march' },
      }
    );

    // Vessel is docked at a harbor (different parent from dock for realism)
    const vessel = createPlace('PLACE_the_ledgerwake', 'The Ledgerwake', {
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_farbound_reliquary' },
    });

    // Exit from dock directly to the vessel ROOT (not to a vessel interior)
    // This is a normal boarding gangplank - NOT a hierarchy problem
    const exitDockToVessel = createExit(
      'OBJ_exit_dock_to_vessel',
      'PLACE_crownchain_haven_dockside_piers',
      'PLACE_the_ledgerwake' // Direct to vessel root, not a child
    );

    const helmLedgerwake = createVesselHelm('PLACE_the_ledgerwake');

    const ctx = createValidationContext([region, dock, vessel], [exitDockToVessel, helmLedgerwake]);
    const result = validateVesselHierarchy(ctx);

    // Dock should NOT be flagged - it's connected to the vessel root, not a vessel interior
    // A gangplank from dock to vessel is normal architecture
    expect(result.vesselCount).toBe(1);
    expect(result.misparentedPlaces).toHaveLength(0);
    expect(result.clarificationQuestions).toHaveLength(0);
  });

  it('should NOT flag grandparent region of vessel even with exit connection', () => {
    // Test that even with exit connections, we don't flag places that are
    // ancestors (grandparents, great-grandparents, etc.) of the vessel

    const region = createPlace('PLACE_harbor_district', 'Harbor District', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 500, height: 500 } },
    });

    // Dock is child of region
    const dock = createPlace('PLACE_harbor_dock', 'Harbor Dock', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 200, height: 100 } },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_harbor_district' },
    });

    // Vessel is child of dock (moored at the dock)
    const vessel = createPlace('PLACE_harbor_ferry', 'Harbor Ferry', {
      destinationPlaceId: 'PLACE_other_dock',
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 80, height: 30 },
      },
      position: { x: 100, y: 50, width: 400, height: 400, parent: 'PLACE_harbor_dock' },
    });

    // Ferry deck
    const deck = createPlace('PLACE_harbor_ferry_deck', 'Harbor Ferry Deck', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 80, height: 30 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_harbor_ferry' },
    });

    // Exit from grandparent region directly to vessel deck (harbor district has a path to ferry)
    const exitRegionToDeck = createExit(
      'OBJ_exit_district_to_ferry',
      'PLACE_harbor_district',
      'PLACE_harbor_ferry_deck'
    );

    const helmFerry = createVesselHelm('PLACE_harbor_ferry');

    const ctx = createValidationContext([region, dock, vessel, deck], [exitRegionToDeck, helmFerry]);
    const result = validateVesselHierarchy(ctx);

    // Region is grandparent of vessel, should NOT be flagged even with exit connection
    expect(result.vesselCount).toBe(1);
    expect(result.misparentedPlaces).toHaveLength(0);
  });
});

describe('repairVesselHierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not repair when no issues exist', async () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
    });

    const vessel = createPlace('PLACE_the_ledgerwake', 'The Ledgerwake', {
      destinationPlaceId: 'PLACE_harbor', // Vessel in transit
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const deck = createPlace('PLACE_ledgerwake_deck', 'Ledgerwake Deck', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 50, height: 50 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_the_ledgerwake' },
    });

    const helmLedgerwake = createVesselHelm('PLACE_the_ledgerwake');

    const ctx = createValidationContext([region, vessel, deck], [helmLedgerwake]);
    const universeCtx = createMockUniverseContext();

    const result = await repairVesselHierarchy(ctx, universeCtx);

    expect(result.repaired).toBe(false);
    expect(result.repairs).toHaveLength(0);
    expect(mockUpsertEntity).not.toHaveBeenCalled();
  });

  it('should NOT auto-repair - repair function only calls validation', async () => {
    // In hierarchy model, repair function simply calls validateVesselHierarchy
    // and returns its results without making any automatic changes
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
    });

    const vessel = createPlace('PLACE_the_ledgerwake', 'The Ledgerwake', {
      destinationPlaceId: 'PLACE_harbor',
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const deck = createPlace('PLACE_ledgerwake_deck', 'Ledgerwake Deck', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 50, height: 50 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_the_ledgerwake' },
    });

    const helmLedgerwake = createVesselHelm('PLACE_the_ledgerwake');

    const ctx = createValidationContext([region, vessel, deck], [helmLedgerwake]);
    const universeCtx = createMockUniverseContext();

    const result = await repairVesselHierarchy(ctx, universeCtx);

    // Should NOT auto-repair
    expect(result.repaired).toBe(false);
    expect(result.repairs).toHaveLength(0);
    expect(mockUpsertEntity).not.toHaveBeenCalled();
  });

  it('should skip suppressed places and not generate clarification questions for them', async () => {
    const region = createPlace('PLACE_region', 'Test Region', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles', size: { width: 100, height: 100 } },
    });

    const vessel = createPlace('PLACE_the_ledgerwake', 'The Ledgerwake', {
      destinationPlaceId: 'PLACE_harbor', // Vessel in transit
      tags: ['TAG_vessel'],
      info: {
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        size: { width: 100, height: 50 },
      },
      position: { x: 50, y: 50, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const deck = createPlace('PLACE_ledgerwake_deck', 'Ledgerwake Deck', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 50, height: 50 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_the_ledgerwake' },
    });

    // Place connected via exit
    const gangway = createPlace('PLACE_dock_gangway', 'Dock Gangway', {
      info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 20, height: 20 } },
      position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_region' },
    });

    const exitGangwayToDeck = createExit(
      'OBJ_exit_gangway_deck',
      'PLACE_dock_gangway',
      'PLACE_ledgerwake_deck'
    );

    const helmLedgerwake = createVesselHelm('PLACE_the_ledgerwake');

    const ctx = createValidationContext([region, vessel, deck, gangway], [exitGangwayToDeck, helmLedgerwake]);
    const universeCtx = createMockUniverseContext();

    // Mark the gangway as suppressed (user previously answered "keep")
    const suppressedPlaceIds = new Set(['PLACE_dock_gangway']);

    const result = await repairVesselHierarchy(ctx, universeCtx, { suppressedPlaceIds });

    // Should NOT report any issues for the suppressed place
    expect(result.misparentedPlaces).toHaveLength(0);
    expect(result.clarificationQuestions).toHaveLength(0);
    expect(result.pendingClarification).toBe(0);

    // Should report that one issue was suppressed
    expect(result.suppressed).toBe(1);
  });
});
