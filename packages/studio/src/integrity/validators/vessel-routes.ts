/**
 * Vessel Routes Validator
 *
 * Validates that vessels in transit have valid destinationPlaceId.
 *
 * Checks:
 * - Vessels with destinationPlaceId should reference a valid place
 *
 * Repairs:
 * - Clear invalid destinationPlaceId references
 */

import type { ValidationContext } from '../integrity-types.js';
import type { UniverseValidatorResult } from '@dmnpc/types/entity';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

/**
 * Check if a place is a vessel by looking for a vessel_helm object in that place.
 * Uses ValidationContext (not UniverseContext) for object lookup.
 */
function isVesselPlace(placeId: string, ctx: ValidationContext): boolean {
  for (const [, obj] of ctx.objects) {
    if (obj.position.parent === placeId && obj.info.purpose === 'vessel_helm') return true;
  }
  return false;
}
/**
 * Result of vessel routes validation.
 */
export interface VesselRoutesResult extends UniverseValidatorResult {
  /** Number of vessels found (identified by vessel_helm object) */
  vesselCount: number;
  /** Vessels in transit (have destinationPlaceId) */
  inTransitCount: number;
  /** Vessels with invalid destinationPlaceId (place not found) */
  invalidDestinationCount: number;
  invalidDestinationVessels: string[];
}

/**
 * Validate that vessel routes are properly configured.
 *
 * @param ctx - Validation context with universe data
 * @returns VesselRoutesResult with validation findings
 */
export function validateVesselRoutes(ctx: ValidationContext): VesselRoutesResult {
  const result: VesselRoutesResult = {
    vesselCount: 0,
    inTransitCount: 0,
    invalidDestinationCount: 0,
    invalidDestinationVessels: [],
    repaired: false,
    repairs: [],
  };

  for (const place of ctx.places.values()) {
    // Identify vessels by vessel_helm object
    if (!isVesselPlace(place.id, ctx)) continue;

    result.vesselCount++;

    // Check destinationPlaceId validity
    if (place.destinationPlaceId) {
      result.inTransitCount++;

      if (!ctx.places.has(place.destinationPlaceId)) {
        result.invalidDestinationCount++;
        result.invalidDestinationVessels.push(place.id);
        logger.warn(
          'VesselRoutesValidator',
          `Vessel ${place.id} (${place.label}) has destinationPlaceId pointing to non-existent place: ${place.destinationPlaceId}`,
        );
      }
    }
  }

  return result;
}

/**
 * Repair vessel routes by clearing invalid destinationPlaceId references.
 *
 * @param ctx - Validation context with universe data
 * @param universeCtx - Universe context for saving entities
 * @returns VesselRoutesResult with repair details
 */
export function repairVesselRoutes(
  ctx: ValidationContext,
  universeCtx: UniverseContext,
): VesselRoutesResult {
  const validation = validateVesselRoutes(ctx);
  const repairs: string[] = [];

  // Check if there's anything to repair
  if (validation.invalidDestinationCount === 0) {
    return validation;
  }

  // Clear invalid destinationPlaceId references
  for (const vesselId of validation.invalidDestinationVessels) {
    const vessel = ctx.places.get(vesselId);
    if (!vessel) continue;

    // Clear invalid destinationPlaceId - vessel becomes stationary
    vessel.destinationPlaceId = null;
    universeCtx.upsertEntity('place', vessel);
    ctx.places.set(vesselId, vessel);

    const repairMsg = `Cleared invalid destinationPlaceId from vessel ${vessel.label}`;
    repairs.push(repairMsg);
    logger.info('VesselRoutesValidator', repairMsg);
  }

  // Re-validate to get updated counts
  const updatedValidation = validateVesselRoutes(ctx);

  return {
    ...updatedValidation,
    repaired: repairs.length > 0,
    repairs,
  };
}
