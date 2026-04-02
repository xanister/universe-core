/**
 * Place Environment Validator
 *
 * Validates that places have a valid EnvironmentConfig object with a recognized type.
 * Environment types: interior, exterior, space, underwater.
 *
 * Key validation rules:
 * 1. All places must have a valid environment.type from ENVIRONMENT_PRESET_NAMES
 * Repair: Uses LLM to infer environment from description. No heuristic inference.
 */

import { ENVIRONMENT_PRESET_NAMES } from '@dmnpc/types/world';
import { type BaseEntity } from '@dmnpc/types/entity';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Place Environment Validator
 *
 * Validates environment field and related consistency rules.
 * Uses LLM for repair when environment is missing or invalid.
 */
export const placeEnvironmentValidator: Validator = {
  id: 'place-environment',
  name: 'Place Environment Validator',

  validate(entity: BaseEntity, _ctx: ValidationContext): ValidationIssue[] {
    // Only validate places
    if (!entity.id.startsWith('PLACE_')) {
      return [];
    }

    if (!isPlace(entity)) return [];
    const place = entity;
    const issues: ValidationIssue[] = [];

    // Skip the abstract cosmos root
    if (place.id === 'PLACE_the_cosmos') {
      return [];
    }

    // Rule 1: Check if environment is valid (must be an object with a recognized type)
    const envType = place.info.environment.type;
    if (!envType || !(ENVIRONMENT_PRESET_NAMES as readonly string[]).includes(envType)) {
      // Invalid environment value
      issues.push({
        entityId: place.id,
        entityType: 'place',
        validatorId: 'place-environment',
        severity: 'error',
        field: 'info.environment',
        message: `Invalid environment type: "${envType || 'missing'}". Must be one of: ${ENVIRONMENT_PRESET_NAMES.join(', ')}`,
        suggestedFix: {
          field: 'info.environment',
          value: null, // LLM will infer from description
          confidence: 'high',
          method: 'llm',
        },
      });
    }

    return issues;
  },
};
