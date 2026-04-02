/**
 * Missing Exit Validator
 *
 * Universe-level validator that detects feet-scale places with a parent but no
 * exit object connecting them back to that parent.
 *
 * In the hierarchical exit model, feet-scale places need exit objects for
 * player-visible navigation. Non-feet-scale places (miles, kilometers, au,
 * lightyears) use the containment hierarchy directly — no exit objects needed.
 *
 * Repair: Generates the missing exit via generateExitObject (feet-scale only).
 */

import type { ValidationContext } from '../integrity-types.js';
import type { UniverseValidatorResult } from '@dmnpc/types/entity';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { generateExitObject } from '@dmnpc/generation/object-generator.js';

/**
 * A place that is missing an exit to its parent.
 */
export interface MissingExitIssue {
  /** The place ID missing an exit */
  placeId: string;
  /** The place's label */
  placeLabel: string;
  /** The parent place ID (exit target) */
  parentId: string;
}

/**
 * Result of missing exit validation.
 */
export interface MissingExitResult extends UniverseValidatorResult {
  /** Places that are missing exits to their parent */
  missingExits: MissingExitIssue[];
}

/**
 * Validate that every non-root place has at least one exit to its parent.
 */
export function validateMissingExits(ctx: ValidationContext): MissingExitResult {
  const missingExits: MissingExitIssue[] = [];

  // Build a set of place IDs that have at least one exit object
  const placesWithExits = new Set<string>();
  for (const obj of ctx.objects.values()) {
    if (obj.info.purpose === 'exit' && obj.position.parent) {
      placesWithExits.add(obj.position.parent);
    }
  }

  // Check every feet-scale place with a parent.
  // Non-feet-scale places (miles, kilometers, au, lightyears) use the containment
  // hierarchy directly — no exit objects needed.
  for (const place of ctx.places.values()) {
    // Skip root places (no parent = no exit needed)
    if (!place.position.parent) continue;

    // Skip cosmos itself
    if (place.id === ctx.rootPlaceId) continue;

    // Skip if parent doesn't exist (orphaned-refs validator handles that)
    if (!ctx.places.has(place.position.parent)) continue;

    // Non-feet-scale places navigate via hierarchy, not exits
    if (place.info.scale !== 'feet') continue;

    // Check if this place has any exit
    if (!placesWithExits.has(place.id)) {
      missingExits.push({
        placeId: place.id,
        placeLabel: place.label,
        parentId: place.position.parent,
      });
    }
  }

  if (missingExits.length > 0) {
    logger.warn(
      'MissingExitValidator',
      `Found ${missingExits.length} place(s) missing exits to parent: ${missingExits.map((p) => p.placeId).join(', ')}`,
    );
  }

  return {
    missingExits,
    repaired: false,
    repairs: [],
  };
}

/**
 * Repair missing exits by generating exit objects.
 * Only feet-scale places get exits (visible doors/archways for player navigation).
 * Non-feet-scale places use the containment hierarchy directly.
 */
export async function repairMissingExits(
  ctx: ValidationContext,
  universeCtx: UniverseContext,
): Promise<MissingExitResult> {
  const validation = validateMissingExits(ctx);

  if (validation.missingExits.length === 0) {
    return validation;
  }

  const repairs: string[] = [];

  for (const issue of validation.missingExits) {
    const place = ctx.places.get(issue.placeId);
    if (!place) continue;

    try {
      const exit = await generateExitObject(universeCtx, {
        placeId: issue.placeId,
      });

      // Update validation context with new exit
      ctx.objects.set(exit.id, exit);

      repairs.push(`Created exit: ${issue.placeId} -> ${issue.parentId}`);
      logger.info(
        'MissingExitValidator',
        `Created exit from ${issue.placeId} to ${issue.parentId}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      repairs.push(`Failed to create exit for ${issue.placeId}: ${message}`);
      logger.error('MissingExitValidator', `Failed to create exit for ${issue.placeId}`, {
        error: message,
      });
    }
  }

  return {
    missingExits: validation.missingExits,
    repaired: repairs.length > 0,
    repairs,
  };
}
