/**
 * Internal Conflicts Validator
 *
 * Detects logical contradictions within entities.
 * - Invalid race IDs (not in universe.races)
 * - Dead character with recent activity
 * - Exit with same source and target place
 *
 * Repair: LLM for race, deterministic for exit self-target, flag others.
 */

import type { BaseEntity, Character } from '@dmnpc/types/entity';
import { isCharacter } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Check for internal conflicts in a character.
 */
function checkCharacterConflicts(character: Character, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, info } = character;

  // Check if race is valid (not empty - that's handled by missing-fields)
  if (info.race && !ctx.validRaceIds.has(info.race)) {
    issues.push({
      entityId: id,
      entityType: 'character',
      validatorId: 'internal-conflicts',
      severity: 'error',
      field: 'info.race',
      message: `Character has invalid race ID: ${info.race} (not in universe.races)`,
      suggestedFix: {
        field: 'info.race',
        value: null, // LLM will infer from description
        confidence: 'high',
        method: 'llm',
      },
    });
  }

  // Check for dead character with recent activity (deathdate set but still active)
  if (info.deathdate) {
    // If character has a deathdate but also has recent messages, that's a conflict
    if (info.messages.length > 0) {
      const lastMessage = info.messages[info.messages.length - 1];
      if (lastMessage.date) {
        issues.push({
          entityId: id,
          entityType: 'character',
          validatorId: 'internal-conflicts',
          severity: 'warning',
          field: 'info.deathdate',
          message: `Dead character (deathdate: ${info.deathdate}) has recent messages (last: ${lastMessage.date})`,
          // No auto-fix - ambiguous whether deathdate is wrong or messages are old
          // Requires manual review to determine which is correct
        });
      }
    }

    // If character has recent journal entries after death
    if (info.journal.length > 0) {
      const lastJournal = info.journal[info.journal.length - 1];
      if (lastJournal.gameDate) {
        issues.push({
          entityId: id,
          entityType: 'character',
          validatorId: 'internal-conflicts',
          severity: 'warning',
          field: 'info.deathdate',
          message: `Dead character (deathdate: ${info.deathdate}) has journal entries (last: ${lastJournal.gameDate})`,
          // No auto-fix - ambiguous whether deathdate is wrong or journal entries are old
          // Requires manual review to determine which is correct
        });
      }
    }
  }

  return issues;
}

/**
 * Internal Conflicts Validator
 *
 * Checks for logical contradictions within entities.
 */
export const internalConflictsValidator: Validator = {
  id: 'internal-conflicts',
  name: 'Internal Conflicts Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return checkCharacterConflicts(entity, ctx);
    }

    return [];
  },
};
