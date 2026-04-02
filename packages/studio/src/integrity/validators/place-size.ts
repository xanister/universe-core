/**
 * Place Size Validator
 *
 * Validates that places have the size field set with the correct format.
 * The size field must be an object with { width: number, height: number }
 * for the map coordinate system to work properly.
 *
 * Key validation rules:
 * 1. Size must be present for places with map images
 * 2. Size must be an object, not a string
 * 3. Size must have numeric width and height properties
 *
 * Common issues:
 * - Size is a descriptive string like "small", "100 sq ft", "sprawling"
 * - Size is missing entirely
 * - Size has non-numeric width/height values
 *
 * Repair: Uses LLM to determine appropriate dimensions based on place
 * description, environment, and scale. No heuristic inference.
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Place Size Validator
 *
 * Validates that places have properly formatted size fields.
 */
export const placeSizeValidator: Validator = {
  id: 'place-size',
  name: 'Place Size Validator',

  validate(entity: BaseEntity, _ctx: ValidationContext): ValidationIssue[] {
    // Only validate places
    if (!entity.id.startsWith('PLACE_')) {
      return [];
    }

    if (!isPlace(entity)) return [];
    const place = entity;
    const issues: ValidationIssue[] = [];
    const width = place.position.innerWidth;
    const height = place.position.innerHeight;

    // Skip the abstract cosmos root - it doesn't need a size
    if (place.id === 'PLACE_the_cosmos') {
      return [];
    }

    const widthValid = typeof width === 'number' && width > 0;
    const heightValid = typeof height === 'number' && height > 0;

    if (!widthValid) {
      issues.push({
        entityId: place.id,
        entityType: 'place',
        validatorId: 'place-size',
        severity: 'warning',
        field: 'position.innerWidth',
        message:
          width === undefined
            ? 'Place is missing inner dimensions (set when layout is generated)'
            : `Place has invalid inner width: ${width} - must be a positive number`,
        suggestedFix: {
          field: 'position.innerWidth',
          value: null,
          confidence: 'high',
          method: 'layout',
        },
      });
    }

    if (!heightValid) {
      issues.push({
        entityId: place.id,
        entityType: 'place',
        validatorId: 'place-size',
        severity: 'warning',
        field: 'position.innerHeight',
        message:
          height === undefined
            ? 'Place is missing inner dimensions (set when layout is generated)'
            : `Place has invalid inner height: ${height} - must be a positive number`,
        suggestedFix: {
          field: 'position.innerHeight',
          value: null,
          confidence: 'high',
          method: 'layout',
        },
      });
    }

    return issues;
  },
};
