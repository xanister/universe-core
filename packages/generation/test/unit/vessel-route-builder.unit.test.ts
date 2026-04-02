/**
 * Unit tests for vessel-route-builder:
 * discoverPorts, buildVesselRoutes.
 */

import { describe, it, expect } from 'vitest';
import {
  createTestPlace,
  createTestObjectEntity,
  createMockUniverseContext,
  defaultMockUniverse,
} from '@dmnpc/core/test-helpers/index.js';
import {
  discoverPorts,
  buildVesselRoutes,
} from '../../src/place/vessel-route-builder.js';

// ============================================================================
// discoverPorts
// ============================================================================

describe('discoverPorts', () => {
  it('finds ports with gangplank objects', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const harbor = createTestPlace({
      id: 'PLACE_harbor',
      label: 'Harbor',
      position: { parent: 'PLACE_region' },
    });
    const gangplank = createTestObjectEntity({
      id: 'OBJ_gangplank',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, harbor],
      objects: [gangplank],
    });

    const ports = discoverPorts(ctx, 'PLACE_region', 'PLACE_ship');
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('PLACE_harbor');
  });

  it('finds ports with airlock objects', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const station = createTestPlace({
      id: 'PLACE_station',
      label: 'Space Station',
      position: { parent: 'PLACE_region' },
    });
    const airlock = createTestObjectEntity({
      id: 'OBJ_airlock',
      info: { purpose: 'airlock' },
      position: { parent: 'PLACE_station' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, station],
      objects: [airlock],
    });

    const ports = discoverPorts(ctx, 'PLACE_region', 'PLACE_ship');
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('PLACE_station');
  });

  it('excludes the vessel itself from port results', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const ship = createTestPlace({
      id: 'PLACE_ship',
      position: { parent: 'PLACE_region' },
    });
    const helm = createTestObjectEntity({
      id: 'OBJ_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_ship' },
    });
    const gangplank = createTestObjectEntity({
      id: 'OBJ_gangplank_ship',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_ship' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, ship],
      objects: [helm, gangplank],
    });

    const ports = discoverPorts(ctx, 'PLACE_region', 'PLACE_ship');
    expect(ports).toHaveLength(0);
  });

  it('excludes other vessels (places with vessel_helm)', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const otherShip = createTestPlace({
      id: 'PLACE_other_ship',
      position: { parent: 'PLACE_region' },
    });
    const otherHelm = createTestObjectEntity({
      id: 'OBJ_other_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_other_ship' },
    });
    const harbor = createTestPlace({
      id: 'PLACE_harbor',
      position: { parent: 'PLACE_region' },
    });
    const gangplank = createTestObjectEntity({
      id: 'OBJ_gangplank',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, otherShip, harbor],
      objects: [otherHelm, gangplank],
    });

    const ports = discoverPorts(ctx, 'PLACE_region', 'PLACE_myship');
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('PLACE_harbor');
  });

  it('finds dock infrastructure in child places', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const harbor = createTestPlace({
      id: 'PLACE_harbor',
      position: { parent: 'PLACE_region' },
    });
    const dock = createTestPlace({
      id: 'PLACE_dock_area',
      position: { parent: 'PLACE_harbor' },
    });
    const gangplank = createTestObjectEntity({
      id: 'OBJ_gangplank',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_dock_area' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, harbor, dock],
      objects: [gangplank],
    });

    const ports = discoverPorts(ctx, 'PLACE_region', 'PLACE_ship');
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('PLACE_harbor');
  });

  it('returns empty when no ports have dock infrastructure', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const town = createTestPlace({
      id: 'PLACE_town',
      position: { parent: 'PLACE_region' },
    });
    const chair = createTestObjectEntity({
      id: 'OBJ_chair',
      info: { purpose: 'furniture' },
      position: { parent: 'PLACE_town' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, town],
      objects: [chair],
    });

    const ports = discoverPorts(ctx, 'PLACE_region', 'PLACE_ship');
    expect(ports).toHaveLength(0);
  });
});

// ============================================================================
// buildVesselRoutes
// ============================================================================

describe('buildVesselRoutes', () => {
  it('builds a route when vessel has 2+ ports available', () => {
    // Setup: region -> harbor A, harbor B, ship (docked at harbor A)
    const region = createTestPlace({ id: 'PLACE_region' });
    const harborA = createTestPlace({
      id: 'PLACE_harbor_a',
      label: 'Port Alpha',
      position: { parent: 'PLACE_region' },
    });
    const harborB = createTestPlace({
      id: 'PLACE_harbor_b',
      label: 'Port Beta',
      position: { parent: 'PLACE_region' },
    });
    const ship = createTestPlace({
      id: 'PLACE_ship',
      label: 'The Stormchaser',
      position: { parent: 'PLACE_region' },
      info: { dockedAtPlaceId: 'PLACE_harbor_a' },
    });
    const helm = createTestObjectEntity({
      id: 'OBJ_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_ship' },
    });
    const gangplankA = createTestObjectEntity({
      id: 'OBJ_gangplank_a',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_a' },
    });
    const gangplankB = createTestObjectEntity({
      id: 'OBJ_gangplank_b',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_b' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, harborA, harborB, ship],
      objects: [helm, gangplankA, gangplankB],
    });

    const routes = buildVesselRoutes(ctx, 'PLACE_ship');
    expect(routes).not.toBeNull();
    expect(routes).toHaveLength(1);

    const route = routes![0];
    expect(route.ports).toContain('PLACE_harbor_a');
    expect(route.ports).toContain('PLACE_harbor_b');
    expect(route.ports).toHaveLength(2);
    expect(route.departures).toHaveLength(1);
    expect(route.departures[0].hour).toBe(6); // dawn departure
    expect(route.name).toContain('Port Alpha');
    expect(route.name).toContain('Port Beta');
  });

  it('returns null when only one port exists (no route possible)', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const harbor = createTestPlace({
      id: 'PLACE_harbor',
      position: { parent: 'PLACE_region' },
      info: { dockedAtPlaceId: null },
    });
    const ship = createTestPlace({
      id: 'PLACE_ship',
      label: 'Lonely Ship',
      position: { parent: 'PLACE_region' },
      info: { dockedAtPlaceId: 'PLACE_harbor' },
    });
    const helm = createTestObjectEntity({
      id: 'OBJ_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_ship' },
    });
    // Harbor has gangplank but no other port exists
    const gangplank = createTestObjectEntity({
      id: 'OBJ_gangplank',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, harbor, ship],
      objects: [helm, gangplank],
    });

    const routes = buildVesselRoutes(ctx, 'PLACE_ship');
    expect(routes).toBeNull();
  });

  it('returns null when vessel is not docked', () => {
    const ship = createTestPlace({
      id: 'PLACE_ship',
      info: { dockedAtPlaceId: null },
    });
    const helm = createTestObjectEntity({
      id: 'OBJ_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_ship' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [ship],
      objects: [helm],
    });

    const routes = buildVesselRoutes(ctx, 'PLACE_ship');
    expect(routes).toBeNull();
  });

  it('returns null when no containing vessel found', () => {
    const room = createTestPlace({ id: 'PLACE_room' });
    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [room],
      objects: [],
    });

    const routes = buildVesselRoutes(ctx, 'PLACE_room');
    expect(routes).toBeNull();
  });

  it('works when starting from a child room of the vessel', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const harborA = createTestPlace({
      id: 'PLACE_harbor_a',
      label: 'Alpha',
      position: { parent: 'PLACE_region' },
    });
    const harborB = createTestPlace({
      id: 'PLACE_harbor_b',
      label: 'Beta',
      position: { parent: 'PLACE_region' },
    });
    const ship = createTestPlace({
      id: 'PLACE_ship',
      label: 'Ship',
      position: { parent: 'PLACE_region' },
      info: { dockedAtPlaceId: 'PLACE_harbor_a' },
    });
    const bridge = createTestPlace({
      id: 'PLACE_bridge',
      position: { parent: 'PLACE_ship' },
    });
    const helm = createTestObjectEntity({
      id: 'OBJ_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_ship' },
    });
    const gangplankA = createTestObjectEntity({
      id: 'OBJ_gangplank_a',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_a' },
    });
    const gangplankB = createTestObjectEntity({
      id: 'OBJ_gangplank_b',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_b' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, harborA, harborB, ship, bridge],
      objects: [helm, gangplankA, gangplankB],
    });

    // Call with the bridge (child room), not the ship directly
    const routes = buildVesselRoutes(ctx, 'PLACE_bridge');
    expect(routes).not.toBeNull();
    expect(routes).toHaveLength(1);
    expect(routes![0].ports).toHaveLength(2);
  });

  it('includes current dock as first port in route', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const harborA = createTestPlace({
      id: 'PLACE_harbor_a',
      label: 'Home Port',
      position: { parent: 'PLACE_region' },
    });
    const harborB = createTestPlace({
      id: 'PLACE_harbor_b',
      label: 'Destination',
      position: { parent: 'PLACE_region' },
    });
    const ship = createTestPlace({
      id: 'PLACE_ship',
      position: { parent: 'PLACE_region' },
      info: { dockedAtPlaceId: 'PLACE_harbor_a' },
    });
    const helm = createTestObjectEntity({
      id: 'OBJ_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_ship' },
    });
    const gangplankA = createTestObjectEntity({
      id: 'OBJ_gp_a',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_a' },
    });
    const gangplankB = createTestObjectEntity({
      id: 'OBJ_gp_b',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_b' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, harborA, harborB, ship],
      objects: [helm, gangplankA, gangplankB],
    });

    const routes = buildVesselRoutes(ctx, 'PLACE_ship');
    expect(routes![0].ports[0]).toBe('PLACE_harbor_a');
  });

  it('generates route ID from vessel place ID', () => {
    const region = createTestPlace({ id: 'PLACE_region' });
    const harborA = createTestPlace({
      id: 'PLACE_harbor_a',
      position: { parent: 'PLACE_region' },
    });
    const harborB = createTestPlace({
      id: 'PLACE_harbor_b',
      position: { parent: 'PLACE_region' },
    });
    const ship = createTestPlace({
      id: 'PLACE_stormchaser',
      position: { parent: 'PLACE_region' },
      info: { dockedAtPlaceId: 'PLACE_harbor_a' },
    });
    const helm = createTestObjectEntity({
      id: 'OBJ_helm',
      info: { purpose: 'vessel_helm' },
      position: { parent: 'PLACE_stormchaser' },
    });
    const gpA = createTestObjectEntity({
      id: 'OBJ_gp_a',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_a' },
    });
    const gpB = createTestObjectEntity({
      id: 'OBJ_gp_b',
      info: { purpose: 'gangplank' },
      position: { parent: 'PLACE_harbor_b' },
    });

    const ctx = createMockUniverseContext({
      ...defaultMockUniverse,
      places: [region, harborA, harborB, ship],
      objects: [helm, gpA, gpB],
    });

    const routes = buildVesselRoutes(ctx, 'PLACE_stormchaser');
    expect(routes![0].id).toBe('route_stormchaser');
  });
});
