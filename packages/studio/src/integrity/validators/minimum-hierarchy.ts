/**
 * Minimum Hierarchy Validator
 *
 * Universe-level validator that ensures universes have the minimum required
 * place hierarchy scaffold for gameplay to work correctly.
 *
 * Uses the template-based validateAndComplete system to check and repair
 * missing places based on template slot definitions.
 */

import type { Purpose } from '@dmnpc/types/world';
import type { ValidationContext } from '../integrity-types.js';
import type { UniverseValidatorResult } from '@dmnpc/types/entity';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { validateAndComplete, findCosmos } from '@dmnpc/generation/universe-validator.js';

/**
 * Issue describing an insufficient hierarchy at a specific level.
 */
export interface HierarchyIssue {
  /** The purpose with insufficient children */
  purpose: Purpose;
  /** The parent place ID that needs more children */
  parentId: string;
  /** The parent place label */
  parentLabel: string;
  /** Description of the issue */
  description: string;
}

/**
 * Result of minimum hierarchy validation.
 */
export interface MinimumHierarchyResult extends UniverseValidatorResult {
  /** List of hierarchy insufficiencies found */
  issues: HierarchyIssue[];
  /** Total places generated during repair */
  placesGenerated: number;
}

/**
 * Validate that a universe meets minimum hierarchy requirements.
 *
 * This is a lightweight check - it just ensures cosmos exists and has at least
 * one world. Template-based validation handles the rest via slot definitions.
 */
export function validateMinimumHierarchy(ctx: ValidationContext): MinimumHierarchyResult {
  const issues: HierarchyIssue[] = [];
  const places = ctx.places;

  // Check cosmos exists
  const cosmos = places.get(ctx.rootPlaceId);
  if (!cosmos) {
    issues.push({
      purpose: 'cosmos',
      parentId: '',
      parentLabel: '',
      description: 'No cosmos place found - universe root is missing',
    });
    return {
      issues,
      placesGenerated: 0,
      repaired: false,
      repairs: [],
    };
  }

  // Check at least one world or planet exists under cosmos (cosmos template generates planets)
  let hasWorldOrPlanet = false;
  for (const place of places.values()) {
    if (place.position.parent === ctx.rootPlaceId && place.info.purpose === 'planet') {
      hasWorldOrPlanet = true;
      break;
    }
  }

  if (!hasWorldOrPlanet) {
    issues.push({
      purpose: 'planet',
      parentId: ctx.rootPlaceId,
      parentLabel: cosmos.label,
      description: 'No planet found under cosmos',
    });
  }

  return {
    issues,
    placesGenerated: 0,
    repaired: false,
    repairs: [],
  };
}

/**
 * Repair a universe's minimum hierarchy by generating missing places.
 *
 * Uses the template-based validateAndComplete system to generate
 * places according to template slot definitions.
 *
 * @param ctx - Validation context with universe data
 * @param universeCtx - Required UniverseContext for place generation
 */
export async function repairMinimumHierarchy(
  ctx: ValidationContext,
  universeCtx: UniverseContext,
): Promise<MinimumHierarchyResult> {
  const validation = validateMinimumHierarchy(ctx);

  // Find cosmos to start validation from
  const cosmos = findCosmos(universeCtx);
  if (!cosmos) {
    logger.warn('MinimumHierarchyValidator', 'No cosmos found - cannot repair hierarchy');
    return {
      issues: validation.issues,
      placesGenerated: 0,
      repaired: false,
      repairs: ['Cannot repair: no cosmos found'],
    };
  }

  logger.info(
    'MinimumHierarchyValidator',
    `Running template-based validation from cosmos ${cosmos.id}`,
  );

  // Use template-based validation and completion
  const result = await validateAndComplete(universeCtx, cosmos.id, {
    generate: true,
    maxDepth: 5,
  });

  const repairs: string[] = [];
  if (result.placesGenerated > 0) {
    repairs.push(`Generated ${result.placesGenerated} places using templates`);
  }
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      repairs.push(`Error: ${error}`);
    }
  }

  logger.info(
    'MinimumHierarchyValidator',
    `Validation complete: ${result.placesChecked} checked, ${result.placesGenerated} generated`,
  );

  return {
    issues: validation.issues,
    placesGenerated: result.placesGenerated,
    repaired: result.placesGenerated > 0,
    repairs,
  };
}
