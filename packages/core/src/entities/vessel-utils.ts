/**
 * Vessel Utilities
 *
 * Pure utility functions for vessel operations.
 * Extracted to break circular dependencies between vessel-movement, vessel-crew, and vessel-setup.
 * These functions have minimal dependencies and don't import from the vessel modules.
 */

import type { UniverseContext } from '../universe/universe-context.js';
import type { Place } from '@dmnpc/types/entity';

// ============================================================================
// Vessel Identification
// ============================================================================

/**
 * Check if a place is a vessel (spaceship, sailing ship, car, etc.).
 * Derived from whether the place has a vessel_helm object.
 */
export function isVessel(ctx: UniverseContext, place: Place): boolean {
  return ctx.getObjectsByPlace(place.id).some((o) => o.info.purpose === 'vessel_helm');
}

/**
 * Check if a vessel is currently in transit.
 * Vessel is in transit if it has a destinationPlaceId set.
 */
export function isVesselInTransit(place: Place): boolean {
  return place.destinationPlaceId !== null;
}

// ============================================================================
// Hierarchy Utilities
// ============================================================================

/**
 * Check if a place is a descendant (child, grandchild, etc.) of an ancestor place.
 * Uses cycle detection to prevent infinite loops.
 */
export function isDescendantOf(ctx: UniverseContext, placeId: string, ancestorId: string): boolean {
  let currentId: string | null = placeId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) return false; // Cycle detection
    visited.add(currentId);

    const place = ctx.findPlace(currentId);
    if (!place) return false;

    if (place.position.parent === ancestorId) return true;
    currentId = place.position.parent;
  }

  return false;
}

/**
 * Find the vessel that contains the given place (including the place itself).
 * Walks up the place hierarchy until a vessel is found.
 */
export function findContainingVessel(ctx: UniverseContext, placeId: string): Place | undefined {
  let current = ctx.findPlace(placeId);

  while (current) {
    if (isVessel(ctx, current)) {
      return current;
    }
    current = current.position.parent ? ctx.findPlace(current.position.parent) : undefined;
  }

  return undefined;
}
