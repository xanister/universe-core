/**
 * Vessel Route Builder
 *
 * Generates VesselRoutes for captain characters during slot population.
 * Discovers ports in the vessel's region by looking for dock infrastructure
 * (gangplank/airlock objects) and builds a circular route.
 *
 * Deterministic — no LLM calls. Route is derived from universe state.
 */

import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Place } from '@dmnpc/types/entity';
import type { VesselRoute } from '@dmnpc/types/npc';
import { logger } from '@dmnpc/core/infra/logger.js';

/** Object purposes that qualify as dock infrastructure. */
const DOCK_OBJECT_PURPOSES = ['gangplank', 'airlock'];

/**
 * Default departure hour — dawn period (approx 20-27% of a 24-hour day = hours 5-6).
 * Captain's work schedule starts at dawn, so this aligns departures with the work period.
 */
const DEFAULT_DEPARTURE_HOUR = 6;

/**
 * Find the top-level vessel that contains a place.
 * Walks up the place hierarchy until a place with vessel_helm objects is found.
 */
function findContainingVessel(ctx: UniverseContext, placeId: string): Place | null {
  let current = ctx.findPlace(placeId);
  while (current) {
    const hasHelm = ctx.getObjectsByPlace(current.id).some((o) => o.info.purpose === 'vessel_helm');
    if (hasHelm) return current;
    current = current.position.parent ? ctx.findPlace(current.position.parent) : undefined;
  }
  return null;
}

/**
 * Check if a place has dock infrastructure (gangplank or airlock objects).
 * Checks the place itself and all its descendants (child places).
 */
function hasDockInfrastructure(ctx: UniverseContext, placeId: string): boolean {
  // Check the place itself
  if (ctx.getObjectsByPlace(placeId).some((o) => DOCK_OBJECT_PURPOSES.includes(o.info.purpose))) {
    return true;
  }

  // Check child places (one level deep — dock objects are typically on the vessel or its immediate children)
  const children = ctx.getChildPlaces(placeId);
  for (const child of children) {
    if (
      ctx.getObjectsByPlace(child.id).some((o) => DOCK_OBJECT_PURPOSES.includes(o.info.purpose))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Discover ports in a region that have dock infrastructure.
 *
 * A "port" is any non-vessel place that has dock objects (gangplank/airlock).
 * Scans the region's direct children (one level) since ports are typically
 * direct children of the region (e.g., planet → harbor).
 *
 * @param ctx Universe context
 * @param regionId The region to scan (parent of the vessel's dock)
 * @param excludeVesselId Exclude this vessel from results (the vessel itself has dock objects)
 * @returns Places that qualify as ports
 */
export function discoverPorts(
  ctx: UniverseContext,
  regionId: string,
  excludeVesselId: string,
): Place[] {
  const regionChildren = ctx.getChildPlaces(regionId);
  const ports: Place[] = [];

  for (const child of regionChildren) {
    // Skip the vessel itself
    if (child.id === excludeVesselId) continue;

    // Skip other vessels (they have vessel_helm objects)
    const isVessel = ctx.getObjectsByPlace(child.id).some((o) => o.info.purpose === 'vessel_helm');
    if (isVessel) continue;

    // Check for dock infrastructure
    if (hasDockInfrastructure(ctx, child.id)) {
      ports.push(child);
    }
  }

  return ports;
}

/**
 * Build a route name from port labels.
 * e.g., ["Blackwater Harbor", "Driftmoor"] → "Blackwater Harbor — Driftmoor"
 */
function buildRouteName(ports: Place[]): string {
  if (ports.length <= 3) {
    return ports.map((p) => p.label).join(' — ');
  }
  return `${ports[0].label} — ${ports[ports.length - 1].label} (${ports.length} ports)`;
}

/**
 * Build vessel routes for a captain character.
 *
 * Discovers ports in the vessel's region and builds a circular route.
 * Returns null if fewer than 2 ports are found (vessel has nowhere to sail to).
 *
 * @param ctx Universe context for place and object lookups
 * @param vesselWorkPlaceId The place where the captain works (the vessel or a child place)
 * @returns VesselRoute array with one circular route, or null if no route possible
 */
export function buildVesselRoutes(
  ctx: UniverseContext,
  vesselWorkPlaceId: string,
): VesselRoute[] | null {
  // Find the top-level vessel
  const vessel = findContainingVessel(ctx, vesselWorkPlaceId);
  if (!vessel) {
    logger.warn(
      'VesselRouteBuilder',
      `No containing vessel found for work place ${vesselWorkPlaceId}`,
    );
    return null;
  }

  // The vessel must be docked somewhere
  const dockedAtId = vessel.info.dockedAtPlaceId;
  if (!dockedAtId) {
    logger.warn(
      'VesselRouteBuilder',
      `Vessel ${vessel.label} (${vessel.id}) is not docked — cannot discover ports`,
    );
    return null;
  }

  // Find the region (parent of the dock)
  const dockPlace = ctx.findPlace(dockedAtId);
  if (!dockPlace) {
    logger.warn(
      'VesselRouteBuilder',
      `Dock place ${dockedAtId} not found for vessel ${vessel.label}`,
    );
    return null;
  }

  const regionId = dockPlace.position.parent;
  if (!regionId) {
    logger.warn(
      'VesselRouteBuilder',
      `Dock place ${dockPlace.label} has no parent region — cannot discover ports`,
    );
    return null;
  }

  // Discover ports in the region
  const ports = discoverPorts(ctx, regionId, vessel.id);

  // Include the current dock as a port
  const allPorts: Place[] = [dockPlace];
  for (const port of ports) {
    if (port.id !== dockedAtId) {
      allPorts.push(port);
    }
  }

  // Need at least 2 ports for a route
  if (allPorts.length < 2) {
    logger.info(
      'VesselRouteBuilder',
      `Only ${allPorts.length} port(s) in region for vessel ${vessel.label} — no route generated`,
    );
    return null;
  }

  // Build route ID from vessel ID
  const routeId = `route_${vessel.id.replace(/^PLACE_/, '').toLowerCase()}`;

  const route: VesselRoute = {
    id: routeId,
    name: buildRouteName(allPorts),
    ports: allPorts.map((p) => p.id),
    departures: [{ hour: DEFAULT_DEPARTURE_HOUR }],
    farePerLeg: null,
  };

  logger.info(
    'VesselRouteBuilder',
    `Generated route "${route.name}" for vessel ${vessel.label}: ${allPorts.length} ports, daily departure at hour ${DEFAULT_DEPARTURE_HOUR}`,
  );

  return [route];
}
