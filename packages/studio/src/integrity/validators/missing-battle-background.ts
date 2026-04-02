/**
 * Missing Battle Background Validator
 *
 * Detects places that are missing their battle background image.
 * Repair: Generate new background via battle background generator.
 *
 * FEAT-192: Battle Backgrounds (Combat & Equipment System — Phase 6)
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

export const missingBattleBackgroundValidator: Validator = {
  id: 'missing-battle-background',
  name: 'Missing Battle Background Validator',

  validate(entity: BaseEntity, _ctx: ValidationContext): ValidationIssue[] {
    if (!entity.id.startsWith('PLACE_') || !isPlace(entity)) {
      return [];
    }

    const place = entity;

    if (place.info.battleBackgroundUrl) {
      return [];
    }

    return [
      {
        entityId: place.id,
        entityType: 'place',
        validatorId: 'missing-battle-background',
        severity: 'warning',
        field: 'info.battleBackgroundUrl',
        message: 'Place is missing battle background image',
        suggestedFix: {
          field: 'info.battleBackgroundUrl',
          value: null,
          confidence: 'high',
          method: 'battle-background',
        },
      },
    ];
  },
};
