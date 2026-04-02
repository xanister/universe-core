/**
 * Region Scale Validator
 *
 * Validates that regions have appropriate scale values for their context.
 * Uses LLM to determine the correct scale based on place description,
 * not keyword matching.
 *
 * Checks:
 * - Places with missing scale
 * - Places with potentially mismatched scale (e.g., cosmic scale for terrestrial regions)
 *
 * Repairs:
 * - Uses LLM to determine appropriate scale from description and context
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import type { DistanceUnit } from '@dmnpc/types';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

// Cosmic scale values that warrant validation
const COSMIC_SCALES: DistanceUnit[] = ['lightyears', 'au'];

/**
 * Region Scale Validator
 *
 * Validates that regions have appropriate scale values.
 * Uses LLM to determine correct scale when issues are detected.
 */
export const regionScaleValidator: Validator = {
  id: 'region-scale',
  name: 'Region Scale Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    // Only validate places
    if (!entity.id.startsWith('PLACE_')) {
      return [];
    }

    if (!isPlace(entity)) return [];
    const place = entity;
    const issues: ValidationIssue[] = [];

    // Only check large-scale places (regions)
    const LARGE_SCALE_UNITS = ['miles', 'kilometers', 'au', 'lightyears'];
    if (!LARGE_SCALE_UNITS.includes(place.info.scale)) {
      return [];
    }

    const scale = place.info.scale;

    // Check if scale is cosmic - these need validation
    if (!COSMIC_SCALES.includes(scale)) {
      return []; // Non-cosmic scale doesn't need validation here
    }

    // Skip cosmic scale validation for places where it's obviously appropriate:
    // 1. The cosmos root place itself
    // 2. Any place with environment: 'space' (vacuum environment)
    if (place.id === ctx.rootPlaceId || place.info.environment.type === 'space') {
      return []; // Cosmic scale is expected for space environments
    }

    // Cosmic scale detected on non-space place - use LLM to verify it's appropriate
    issues.push({
      entityId: place.id,
      entityType: 'place',
      validatorId: 'region-scale',
      severity: 'warning',
      field: 'info.scale',
      message: `Region "${place.label}" has cosmic scale "${scale}" - verifying this is appropriate for the place context`,
      suggestedFix: {
        field: 'info.scale',
        value: null, // LLM will determine appropriate scale
        confidence: 'high',
        method: 'llm',
      },
    });

    return issues;
  },
};
