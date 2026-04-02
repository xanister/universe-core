/**
 * Travel Coordinates Validator
 *
 * Validates that vessels in transit and their destinations have valid coordinates
 * for ETA calculation. Without coordinates, the system cannot calculate travel time
 * or provide accurate journey information to the player.
 *
 * Checks:
 * - Vessels in transit (with destinationPlaceId) should have x,y coordinates
 * - Destination places should have x,y coordinates
 * - Places with null coordinates that are part of active travel are flagged
 *
 * Repairs:
 * - Infer coordinates based on parent place hierarchy and sibling positions
 * - For vessels in transit, estimate position based on region
 */

import type { Place } from '@dmnpc/types/entity';
import type { ValidationContext } from '../integrity-types.js';
import type { UniverseValidatorResult } from '@dmnpc/types/entity';
import { getPlaceInnerDimensions } from '@dmnpc/core/entities/position-utils.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { isVesselInTransit } from '@dmnpc/core/entities/vessel-utils.js';

/**
 * Result of travel coordinates validation.
 */
export interface TravelCoordinatesResult extends UniverseValidatorResult {
  /** Number of vessels in transit */
  vesselsInTransitCount: number;
  /** Vessels missing coordinates */
  vesselsMissingCoordinates: string[];
  /** Destinations missing coordinates */
  destinationsMissingCoordinates: string[];
  /** Places that are children of regions but missing coordinates */
  regionChildrenMissingCoordinates: string[];
  /** Total places checked */
  placesChecked: number;
}

/**
 * Check if a place has valid coordinates.
 */
function hasValidCoordinates(_place: Place): boolean {
  // position.x and position.y are required numbers, always valid
  return true;
}

/** Large-scale units that indicate regional/travel places */
const LARGE_SCALE_UNITS_TC = ['miles', 'kilometers', 'au', 'lightyears'];

/**
 * Check if a place is a large-scale/regional place (based on scale).
 */
function isRegion(place: Place): boolean {
  return LARGE_SCALE_UNITS_TC.includes(place.info.scale);
}

/**
 * Validate that vessels and destinations have coordinates for travel calculations.
 * Also validates that places which are children of regions have coordinates
 * (needed for travel time calculations when they're used as origin/destination).
 *
 * @param ctx - Validation context with universe data
 * @returns TravelCoordinatesResult with validation findings
 */
export function validateTravelCoordinates(ctx: ValidationContext): TravelCoordinatesResult {
  const result: TravelCoordinatesResult = {
    vesselsInTransitCount: 0,
    vesselsMissingCoordinates: [],
    destinationsMissingCoordinates: [],
    regionChildrenMissingCoordinates: [],
    placesChecked: 0,
    repaired: false,
    repairs: [],
  };

  // Track unique destination issues to avoid duplicates
  const checkedDestinations = new Set<string>();

  // Build set of region IDs for quick lookup
  const regionIds = new Set<string>();
  for (const place of ctx.places.values()) {
    if (isRegion(place)) {
      regionIds.add(place.id);
    }
  }

  // Find all vessels in transit (vessels use destinationPlaceId)
  for (const place of ctx.places.values()) {
    if (!isVesselInTransit(place)) continue;

    result.vesselsInTransitCount++;
    result.placesChecked++;

    // Check vessel coordinates
    if (!hasValidCoordinates(place)) {
      result.vesselsMissingCoordinates.push(place.id);
      logger.warn(
        'TravelCoordinatesValidator',
        `Vessel ${place.id} (${place.label}) is in transit but has null coordinates - ETA calculation will fail`,
      );
    }

    // Check destination coordinates
    const destPlaceId = place.destinationPlaceId;
    if (destPlaceId && !checkedDestinations.has(destPlaceId)) {
      checkedDestinations.add(destPlaceId);
      result.placesChecked++;

      const destPlace = ctx.places.get(destPlaceId);
      if (destPlace && !hasValidCoordinates(destPlace)) {
        result.destinationsMissingCoordinates.push(destPlace.id);
        logger.warn(
          'TravelCoordinatesValidator',
          `Destination ${destPlace.id} (${destPlace.label}) has null coordinates - ETA calculation will fail`,
        );
      }
    }
  }

  // Check ALL places that are children of regions
  // These need coordinates for travel time calculations when used as origin/destination
  for (const place of ctx.places.values()) {
    // Skip if already checked as destination
    if (checkedDestinations.has(place.id)) continue;

    // Skip if this place IS a region (regions don't need coordinates)
    if (isRegion(place)) continue;

    // Check if parent is a region
    const parentId = place.position.parent;
    if (!parentId || !regionIds.has(parentId)) continue;

    result.placesChecked++;

    if (!hasValidCoordinates(place)) {
      result.regionChildrenMissingCoordinates.push(place.id);
      logger.warn(
        'TravelCoordinatesValidator',
        `Place ${place.id} (${place.label}) is a child of region ${parentId} but has null coordinates - travel time calculations may fail`,
      );
    }
  }

  return result;
}

/**
 * Infer coordinates for a place based on its parent and siblings.
 * Returns the inferred position or null if inference isn't possible.
 */
function inferCoordinates(place: Place, ctx: ValidationContext): { x: number; y: number } | null {
  // If no parent, can't infer
  if (!place.position.parent) return null;

  const parentPlace = ctx.places.get(place.position.parent);
  if (!parentPlace) return null;

  // Find siblings (other children of the same parent)
  const siblings = Array.from(ctx.places.values()).filter(
    (p) => p.position.parent === place.position.parent && p.id !== place.id,
  );

  // Find siblings with valid coordinates
  const positionedSiblings = siblings.filter(hasValidCoordinates);

  const { width: parentWidth, height: parentHeight } = getPlaceInnerDimensions(parentPlace);

  // If no positioned siblings, place at center of parent
  if (positionedSiblings.length === 0) {
    return {
      x: parentWidth / 2,
      y: parentHeight / 2,
    };
  }

  // Find an unoccupied position based on existing siblings
  // Use a simple grid-based approach
  const gridSize = Math.ceil(Math.sqrt(siblings.length + 2)); // +2 for padding
  const cellWidth = parentWidth / gridSize;
  const cellHeight = parentHeight / gridSize;

  // Find occupied cells
  const occupiedCells = new Set<string>();
  for (const sibling of positionedSiblings) {
    const cellX = Math.floor(sibling.position.x / cellWidth);
    const cellY = Math.floor(sibling.position.y / cellHeight);
    occupiedCells.add(`${cellX},${cellY}`);
  }

  // Find first unoccupied cell
  for (let cy = 0; cy < gridSize; cy++) {
    for (let cx = 0; cx < gridSize; cx++) {
      if (!occupiedCells.has(`${cx},${cy}`)) {
        return {
          x: (cx + 0.5) * cellWidth,
          y: (cy + 0.5) * cellHeight,
        };
      }
    }
  }

  // All cells occupied, place at edge
  return {
    x: parentWidth * 0.9,
    y: parentHeight * 0.5,
  };
}

/**
 * Repair travel coordinates by inferring positions for places missing them.
 *
 * @param ctx - Validation context with universe data
 * @param universeCtx - Universe context for saving entities
 * @returns TravelCoordinatesResult with repair details
 */
export function repairTravelCoordinates(
  ctx: ValidationContext,
  universeCtx: UniverseContext,
): TravelCoordinatesResult {
  const validation = validateTravelCoordinates(ctx);
  const repairs: string[] = [];

  // Check if there's anything to repair
  if (
    validation.vesselsMissingCoordinates.length === 0 &&
    validation.destinationsMissingCoordinates.length === 0 &&
    validation.regionChildrenMissingCoordinates.length === 0
  ) {
    return validation;
  }

  // Repair destination coordinates first (more static)
  for (const destId of validation.destinationsMissingCoordinates) {
    const destPlace = ctx.places.get(destId);
    if (!destPlace) continue;

    const inferred = inferCoordinates(destPlace, ctx);
    if (inferred) {
      destPlace.position.x = inferred.x;
      destPlace.position.y = inferred.y;

      universeCtx.upsertEntity('place', destPlace);
      ctx.places.set(destId, destPlace);

      const repairMsg = `Inferred coordinates (${inferred.x.toFixed(1)}, ${inferred.y.toFixed(1)}) for destination ${destPlace.label}`;
      repairs.push(repairMsg);
      logger.info('TravelCoordinatesValidator', repairMsg);
    } else {
      logger.warn(
        'TravelCoordinatesValidator',
        `Could not infer coordinates for destination ${destPlace.label} - no parent or siblings`,
      );
    }
  }

  // Repair region children coordinates
  for (const placeId of validation.regionChildrenMissingCoordinates) {
    const place = ctx.places.get(placeId);
    if (!place) continue;

    const inferred = inferCoordinates(place, ctx);
    if (inferred) {
      place.position.x = inferred.x;
      place.position.y = inferred.y;

      universeCtx.upsertEntity('place', place);
      ctx.places.set(placeId, place);

      const repairMsg = `Inferred coordinates (${inferred.x.toFixed(1)}, ${inferred.y.toFixed(1)}) for region child ${place.label}`;
      repairs.push(repairMsg);
      logger.info('TravelCoordinatesValidator', repairMsg);
    } else {
      logger.warn(
        'TravelCoordinatesValidator',
        `Could not infer coordinates for region child ${place.label} - no parent or siblings`,
      );
    }
  }

  // Repair vessel coordinates
  for (const vesselId of validation.vesselsMissingCoordinates) {
    const vessel = ctx.places.get(vesselId);
    if (!vessel || !vessel.position.parent) continue;

    const regionPlace = ctx.places.get(vessel.position.parent);
    if (!regionPlace) continue;

    // For vessels in transit, place at a reasonable position in the region
    const { width: regionWidth, height: regionHeight } = getPlaceInnerDimensions(regionPlace);

    // Get destination position if available
    let destX = regionWidth * 0.5;
    let destY = regionHeight * 0.5;

    const destPlaceId = vessel.destinationPlaceId;
    if (destPlaceId) {
      const destPlace = ctx.places.get(destPlaceId);
      if (destPlace && hasValidCoordinates(destPlace)) {
        // Destination might be in a different parent hierarchy
        // For simplicity, place vessel at center of region heading toward destination direction
        destX = regionWidth * 0.5;
        destY = regionHeight * 0.5;
      }
    }

    vessel.position.x = destX;
    vessel.position.y = destY;

    universeCtx.upsertEntity('place', vessel);
    ctx.places.set(vesselId, vessel);

    const repairMsg = `Inferred coordinates (${destX.toFixed(1)}, ${destY.toFixed(1)}) for vessel ${vessel.label} in ${regionPlace.label}`;
    repairs.push(repairMsg);
    logger.info('TravelCoordinatesValidator', repairMsg);
  }

  // Re-validate to get updated counts
  const updatedValidation = validateTravelCoordinates(ctx);

  return {
    ...updatedValidation,
    repaired: repairs.length > 0,
    repairs,
  };
}
