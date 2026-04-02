/**
 * Date Format Validator
 *
 * Validates that all date strings in entities can be parsed by the universe's calendar.
 * Catches malformed dates like "1472 4A 08:00" (missing day.month prefix).
 */

import type { BaseEntity, Character } from '@dmnpc/types/entity';
import { isCharacter } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';
import { GameDate } from '@dmnpc/core/game-time/game-date.js';

/**
 * Try to parse a date string and return an error message if it fails.
 */
function validateDateFormat(dateStr: string, ctx: ValidationContext): string | null {
  const { calendar } = ctx.universe;
  if (!calendar) {
    // No calendar defined, can't validate date format
    return null;
  }

  try {
    GameDate.parse(calendar, dateStr);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Validate date formats in character entities.
 */
function validateCharacterDates(character: Character, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, info } = character;

  // Check message dates
  if (info.messages.length > 0) {
    for (let i = 0; i < info.messages.length; i++) {
      const message = info.messages[i];
      if (message.date) {
        const error = validateDateFormat(message.date, ctx);
        if (error) {
          issues.push({
            entityId: id,
            entityType: 'character',
            validatorId: 'date-format',
            severity: 'error',
            field: `info.messages[${i}].date`,
            message: `Invalid date format in message: "${message.date}". ${error}`,
          });
        }
      }
    }
  }

  // Check storyteller state dates
  const storytellerState = info.storytellerState;
  if (storytellerState) {
    // Check storytellerSelectedAt
    if (storytellerState.storytellerSelectedAt) {
      const error = validateDateFormat(storytellerState.storytellerSelectedAt, ctx);
      if (error) {
        issues.push({
          entityId: id,
          entityType: 'character',
          validatorId: 'date-format',
          severity: 'error',
          field: 'info.storytellerState.storytellerSelectedAt',
          message: `Invalid date format in storytellerSelectedAt: "${storytellerState.storytellerSelectedAt}". ${error}`,
        });
      }
    }

    // Check activePlots nextEventAtGameDate dates
    if (storytellerState.activePlots.length > 0) {
      for (let i = 0; i < storytellerState.activePlots.length; i++) {
        const plot = storytellerState.activePlots[i];
        if (plot.nextEventAtGameDate) {
          const error = validateDateFormat(plot.nextEventAtGameDate, ctx);
          if (error) {
            issues.push({
              entityId: id,
              entityType: 'character',
              validatorId: 'date-format',
              severity: 'error',
              field: `info.storytellerState.activePlots[${i}].nextEventAtGameDate`,
              message: `Invalid date format in plot nextEventAtGameDate: "${plot.nextEventAtGameDate}". ${error}`,
            });
          }
        }

        // Check nextEventAtGameDate if present
        if (plot.nextEventAtGameDate) {
          const error = validateDateFormat(plot.nextEventAtGameDate, ctx);
          if (error) {
            issues.push({
              entityId: id,
              entityType: 'character',
              validatorId: 'date-format',
              severity: 'error',
              field: `info.storytellerState.activePlots[${i}].nextEventAtGameDate`,
              message: `Invalid date format in plot nextEventAtGameDate: "${plot.nextEventAtGameDate}". ${error}`,
            });
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Date Format Validator
 *
 * Validates that all date strings can be parsed by the universe's calendar.
 * Skips validation if no calendar is defined.
 */
export const dateFormatValidator: Validator = {
  id: 'date-format',
  name: 'Date Format Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    // Skip if no calendar is defined
    if (!ctx.universe.calendar) {
      return [];
    }

    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return validateCharacterDates(entity, ctx);
    }

    // Other entity types don't currently have date fields that need validation
    return [];
  },
};
