/**
 * Missing Sprite Validator
 *
 * Detects objects that are missing sprite configuration.
 * Objects should have info.spriteConfig.spriteId for rendering.
 *
 * Repair method: deterministic (simple field assignment).
 */

import type { BaseEntity, ObjectEntity } from '@dmnpc/types/entity';
import { isObjectEntity } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';
import { hasResolvableSprite } from '@dmnpc/generation/object-sprite-resolver.js';

/**
 * Validate that an object has required fields for rendering.
 */
function validateObjectSprite(obj: ObjectEntity): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Object already has a resolvable sprite
  if (hasResolvableSprite(obj)) {
    return issues;
  }

  // Can't resolve sprite - report as info
  // For exits, provide more context
  if (obj.info.purpose === 'exit') {
    issues.push({
      entityId: obj.id,
      entityType: 'object',
      validatorId: 'missing-sprite',
      severity: 'info',
      field: 'info.spriteConfig',
      message: `Exit (${obj.short_description || 'unknown'}) has no sprite configuration`,
    });
  } else {
    issues.push({
      entityId: obj.id,
      entityType: 'object',
      validatorId: 'missing-sprite',
      severity: 'info',
      field: 'info.spriteConfig',
      message: `Object (${obj.info.purpose}) has no sprite configuration`,
    });
  }

  return issues;
}

/**
 * Missing Sprite Validator
 *
 * Checks that objects have resolvable sprites.
 */
export const missingSpriteValidator: Validator = {
  id: 'missing-sprite',
  name: 'Missing Sprite Validator',

  validate(entity: BaseEntity, _ctx: ValidationContext): ValidationIssue[] {
    // Only validate objects
    if (!entity.id.startsWith('OBJ_') || !isObjectEntity(entity)) {
      return [];
    }

    return validateObjectSprite(entity);
  },
};
