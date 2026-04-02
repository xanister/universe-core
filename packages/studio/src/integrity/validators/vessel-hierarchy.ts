/**
 * Vessel Hierarchy Validator
 *
 * Validates that vessel interior places (decks, holds, cabins) are properly
 * parented under the vessel, not as siblings in the parent region.
 *
 * Detection:
 * - Find exits connecting vessel interiors to other places
 * - Check if places are parented directly under a region but connected to vessel interiors
 *
 * Repairs:
 * - ALL detected issues generate clarification questions
 * - No auto-fix based on naming patterns (heuristics removed)
 * - User must confirm before any reparenting
 */

import type { Place } from '@dmnpc/types/entity';
import type { ValidationContext } from '../integrity-types.js';
import type { UniverseValidatorResult } from '@dmnpc/types/entity';
import { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';
import {
  type ClarificationQuestion,
  type ClarificationProvider,
  type ClarificationResolutionContext,
  createClarificationQuestion,
} from '@dmnpc/core/clarification/clarification-types.js';
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

/** A detected potentially misparented vessel interior place */
interface MisparentedPlace {
  placeId: string;
  placeLabel: string;
  currentParent: string;
  suggestedVessel: string;
  vesselLabel: string;
  reason: string;
}

/**
 * Options for vessel hierarchy validation.
 */
export interface VesselHierarchyOptions {
  /**
   * Set of place IDs that have been explicitly kept by user clarification answer.
   * These places won't be flagged as issues or generate new clarification questions.
   */
  suppressedPlaceIds?: Set<string>;
}

/**
 * Result of vessel hierarchy validation.
 */
export interface VesselHierarchyResult extends UniverseValidatorResult {
  /** Number of vessels found */
  vesselCount: number;
  /** Places that may need reparenting to a vessel */
  misparentedPlaces: MisparentedPlace[];
  /** Clarification questions for all detected cases */
  clarificationQuestions: ClarificationQuestion[];
  /** Number of issues pending clarification */
  pendingClarification: number;
  /** Number of issues suppressed due to prior user answer */
  suppressed: number;
}

/**
 * Check if a place is a descendant of another place.
 */
function isDescendantOf(placeId: string, ancestorId: string, places: Map<string, Place>): boolean {
  let currentId: string | null = placeId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);

    if (currentId === ancestorId) return true;

    const place = places.get(currentId);
    if (!place) return false;

    currentId = place.position.parent;
  }

  return false;
}

/**
 * Find all vessels in the universe.
 */
function findVessels(
  ctx: ValidationContext,
): Map<string, { vessel: Place; childIds: Set<string> }> {
  const result = new Map<string, { vessel: Place; childIds: Set<string> }>();

  for (const [placeId, place] of ctx.places) {
    if (!isVesselPlace(placeId, ctx)) continue;

    // Find all children of this vessel
    const childIds = new Set<string>();
    for (const [childId] of ctx.places) {
      if (childId !== placeId && isDescendantOf(childId, placeId, ctx.places)) {
        childIds.add(childId);
      }
    }

    result.set(placeId, { vessel: place, childIds });
  }

  return result;
}

/**
 * Validate that vessel interior places are properly parented.
 * All detected issues generate clarification questions - no auto-fix.
 *
 * @param ctx - Validation context with universe data
 * @param options - Optional validation options (e.g., suppressed place IDs)
 * @returns VesselHierarchyResult with validation findings
 */
export function validateVesselHierarchy(
  ctx: ValidationContext,
  options?: VesselHierarchyOptions,
): VesselHierarchyResult {
  const suppressedPlaceIds = options?.suppressedPlaceIds ?? new Set<string>();

  const result: VesselHierarchyResult = {
    vesselCount: 0,
    misparentedPlaces: [],
    clarificationQuestions: [],
    repaired: false,
    repairs: [],
    pendingClarification: 0,
    suppressed: 0,
  };

  const vessels = findVessels(ctx);
  result.vesselCount = vessels.size;

  if (vessels.size === 0) {
    return result;
  }

  // For each place, check if it's connected to a vessel interior but not a child
  for (const [placeId, place] of ctx.places) {
    // Skip vessels themselves
    if (isVesselPlace(placeId, ctx)) continue;

    // Skip places that are children of a vessel already
    let isChildOfAnyVessel = false;
    for (const [vesselId] of vessels) {
      if (isDescendantOf(placeId, vesselId, ctx.places)) {
        isChildOfAnyVessel = true;
        break;
      }
    }
    if (isChildOfAnyVessel) continue;

    // Skip places that are ancestors of any vessel (vessel is a child of this place)
    // This prevents reparenting a parent location under its own child vessel
    let isAncestorOfAnyVessel = false;
    for (const [vesselId] of vessels) {
      if (isDescendantOf(vesselId, placeId, ctx.places)) {
        isAncestorOfAnyVessel = true;
        break;
      }
    }
    if (isAncestorOfAnyVessel) continue;

    // Skip if user has already answered "keep" for this place
    if (suppressedPlaceIds.has(placeId)) {
      result.suppressed++;
      continue;
    }

    // Check if this place is connected to any vessel interior via hierarchy
    // In hierarchical model, exits go from child to parent
    // So connection check is: this place's parent, or places that have this as parent
    const placeParent = place.position.parent;

    // Find places that are children of this place (for detecting vessel interiors as children)
    const childPlaces = Array.from(ctx.places.values()).filter(
      (p) => p.position.parent === placeId,
    );

    for (const [vesselId, { vessel }] of vessels) {
      // Check connections via hierarchy:
      // 1. Parent of this place (where exits from this place lead)
      // 2. Children of this place (places that have exits leading here)
      const connectedPlaceIds: string[] = [];
      if (placeParent) connectedPlaceIds.push(placeParent);
      childPlaces.forEach((child) => connectedPlaceIds.push(child.id));

      for (const connectedPlaceId of connectedPlaceIds) {
        // Skip if the connected place is a descendant of the current place
        // This handles: dock (ancestor of vessel) connected to cabin (child of vessel)
        // e.g., Farbound Reliquary → Bonded Purser Cabin where vessel is between them
        if (connectedPlaceId && isDescendantOf(connectedPlaceId, placeId, ctx.places)) {
          continue;
        }

        // Skip direct connections to the vessel root - those are normal docking exits
        // We only care about connections to vessel *interiors* (children like deck, cabin, hold)
        if (
          connectedPlaceId &&
          connectedPlaceId !== vesselId &&
          isDescendantOf(connectedPlaceId, vesselId, ctx.places)
        ) {
          // This place is connected to a vessel interior but not a child
          // Generate clarification question - no auto-fix

          const connectedPlace = ctx.places.get(connectedPlaceId);

          logger.info(
            'VesselHierarchyValidator',
            `Place "${place.id}" connected to vessel "${vesselId}" via "${connectedPlaceId}" - generating clarification question`,
          );

          result.misparentedPlaces.push({
            placeId: place.id,
            placeLabel: place.label,
            currentParent: placeParent ?? 'none',
            suggestedVessel: vesselId,
            vesselLabel: vessel.label,
            reason: `Place "${place.label}" is connected to vessel interior "${connectedPlace?.label ?? connectedPlaceId}" via exit`,
          });

          // Generate clarification question
          // Use deterministic ID so duplicate questions are deduplicated
          const deterministicId = `CLARIFY_vessel-hierarchy_${place.id}_${vesselId}`;
          const question = createClarificationQuestion({
            id: deterministicId,
            providerId: 'vessel-hierarchy',
            category: 'hierarchy',
            question: `Should "${place.label}" be part of vessel "${vessel.label}"?`,
            context: `"${place.label}" is connected via exit to "${connectedPlace?.label ?? connectedPlaceId}" which is inside vessel "${vessel.label}", but "${place.label}" is currently parented under "${placeParent ?? 'unknown'}". This might be intentional (e.g., a gangway to the dock) or a data issue.`,
            options: [
              {
                id: 'reparent',
                label: `Yes, move to ${vessel.label}`,
                description: `Re-parent "${place.label}" as a child of vessel "${vessel.label}"`,
              },
              {
                id: 'keep',
                label: 'No, keep current parent',
                description: `Leave "${place.label}" parented under "${placeParent ?? 'unknown'}"`,
              },
            ],
            freeformAllowed: false,
            confidence: 0.5,
            currentGuess: 'keep', // Default to keeping current state
            affectedEntityIds: [place.id, vesselId],
            resolutionContext: {
              placeId: place.id,
              vesselId,
              currentParent: placeParent,
            },
          });
          result.clarificationQuestions.push(question);
          result.pendingClarification++;

          break; // Only generate one question per place
        }
      }
    }
  }

  // Log findings
  for (const issue of result.misparentedPlaces) {
    logger.info(
      'VesselHierarchyValidator',
      `Potential misparent detected: ${issue.placeLabel} may belong to ${issue.vesselLabel} - ${issue.reason}`,
    );
  }

  return result;
}

/**
 * Repair vessel hierarchy - no automatic repairs.
 * All repairs are done through clarification question resolution.
 *
 * @param ctx - Validation context with universe data
 * @param _universeCtx - Universe context for saving entities (unused - repairs via clarification)
 * @param options - Optional validation options (e.g., suppressed place IDs)
 * @returns VesselHierarchyResult with validation findings
 */
export function repairVesselHierarchy(
  ctx: ValidationContext,
  _universeCtx: UniverseContext,
  options?: VesselHierarchyOptions,
): VesselHierarchyResult {
  // No automatic repairs - all repairs go through clarification questions
  const validation = validateVesselHierarchy(ctx, options);

  return {
    ...validation,
    repaired: false,
    repairs: [],
  };
}

/**
 * Clarification provider for vessel hierarchy questions.
 * Handles resolving user answers about whether places should be moved to vessels.
 */
const vesselHierarchyProvider: ClarificationProvider = {
  providerId: 'vessel-hierarchy',
  providerName: 'Vessel Hierarchy Validator',
  categories: ['hierarchy'] as const,

  resolveAnswer(ctx: ClarificationResolutionContext): string[] {
    const { universeCtx, question, answer } = ctx;

    // Extract resolution context with runtime narrowing
    const rc = question.resolutionContext;
    if (typeof rc.placeId !== 'string' || typeof rc.vesselId !== 'string') {
      throw new Error(`Invalid resolutionContext for vessel-hierarchy question: ${question.id}`);
    }
    const placeId = rc.placeId;
    const vesselId = rc.vesselId;
    const currentParent = typeof rc.currentParent === 'string' ? rc.currentParent : null;

    // Check the user's answer
    if (answer.selectedOptionId === 'keep') {
      // User wants to keep the current parent - no changes needed
      logger.info(
        'VesselHierarchyProvider',
        `User chose to keep "${placeId}" under "${currentParent}" (not moving to vessel "${vesselId}")`,
      );
      return [];
    }

    if (answer.selectedOptionId === 'reparent') {
      // User confirmed the place should be moved to the vessel
      const place = universeCtx.findPlace(placeId);

      if (!place) {
        logger.error('VesselHierarchyProvider', `Place not found: ${placeId}`, {
          universeId: universeCtx.universeId,
        });
        throw new Error(`Place not found: ${placeId}`);
      }

      const vessel = universeCtx.findPlace(vesselId);
      if (!vessel) {
        logger.error('VesselHierarchyProvider', `Vessel not found: ${vesselId}`, {
          universeId: universeCtx.universeId,
        });
        throw new Error(`Vessel not found: ${vesselId}`);
      }

      const oldParent = place.position.parent;
      place.position.parent = vesselId;
      universeCtx.upsertEntity('place', place);

      logger.info(
        'VesselHierarchyProvider',
        `Re-parented "${place.label}" from "${oldParent}" to vessel "${vessel.label}" (${vesselId})`,
      );

      return [placeId];
    }

    logger.warn(
      'VesselHierarchyProvider',
      `Unknown answer option: ${answer.selectedOptionId} for question ${question.id}`,
    );
    return [];
  },
};

// Register the provider at module load time
clarificationRegistry.register(vesselHierarchyProvider);
