/**
 * Character Sprite Repairs
 *
 * Generate missing in-world character sprites (spriteConfig.spriteUrl) via
 * the character sprite helper (LPC layer config + sprite generation).
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import { isCharacter } from '@dmnpc/core/entities/type-guards.js';
import type { ValidationIssue } from '../integrity-types.js';
import {
  generateCharacterSprite,
  findRaceOrFallback,
} from '@dmnpc/generation/character/character-sprite-helper.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

/**
 * Apply a character-sprite repair to an entity.
 * Generates an in-world sprite (spriteConfig.spriteUrl) for the character.
 *
 * Returns true if the repair was applied, false otherwise.
 */
export async function applyCharacterSpriteRepair(
  entity: BaseEntity,
  issue: ValidationIssue,
  _ctx: UniverseContext,
): Promise<boolean> {
  if (!issue.suggestedFix || issue.suggestedFix.method !== 'character-sprite') {
    return false;
  }

  if (!entity.id.startsWith('CHAR_')) {
    logger.warn('IntegrityRepair', `Cannot generate sprite for non-character entity: ${entity.id}`);
    return false;
  }

  if (!isCharacter(entity)) return false;

  const character = entity;

  try {
    logger.info('IntegrityRepair', `Generating in-world sprite for character: ${character.id}`);

    const raceDef = findRaceOrFallback(_ctx.universe.races, character.info.race);
    const spriteConfig = await generateCharacterSprite(character.info, raceDef);

    character.info.spriteConfig = spriteConfig;

    logger.info(
      'IntegrityRepair',
      `Generated sprite for ${character.id}: ${spriteConfig.spriteUrl}`,
    );
    return true;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to generate sprite for ${character.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
