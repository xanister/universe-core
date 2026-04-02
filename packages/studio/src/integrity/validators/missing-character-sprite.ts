/**
 * Missing Character Sprite Validator
 *
 * Detects characters that are missing their in-world sprite (info.spriteConfig.spriteUrl).
 * Characters need a sprite URL for rendering in the game scene.
 * Repair: Generate sprite via character-sprite-helper (LPC layer config + sprite generation).
 */

import type { BaseEntity, Character } from '@dmnpc/types/entity';
import { isCharacter } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Validate that a character has an in-world sprite (spriteConfig.spriteUrl).
 */
function validateCharacterSprite(character: Character): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (character.info.spriteConfig.spriteUrl) {
    return issues;
  }

  issues.push({
    entityId: character.id,
    entityType: 'character',
    validatorId: 'missing-character-sprite',
    severity: 'warning',
    field: 'info.spriteConfig.spriteUrl',
    message: `Character is missing in-world sprite`,
    suggestedFix: {
      field: 'info.spriteConfig',
      value: null,
      confidence: 'high',
      method: 'character-sprite',
    },
  });

  return issues;
}

/**
 * Missing Character Sprite Validator
 *
 * Checks that characters have info.spriteConfig.spriteUrl for in-world rendering.
 */
export const missingCharacterSpriteValidator: Validator = {
  id: 'missing-character-sprite',
  name: 'Missing Character Sprite Validator',

  validate(entity: BaseEntity, _ctx: ValidationContext): ValidationIssue[] {
    if (!entity.id.startsWith('CHAR_')) {
      return [];
    }

    if (!isCharacter(entity)) return [];
    return validateCharacterSprite(entity);
  },
};
