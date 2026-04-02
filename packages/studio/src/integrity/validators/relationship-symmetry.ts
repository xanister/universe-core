/**
 * Relationship Symmetry Validator
 *
 * Detects one-way relationships that might need to be bidirectional.
 * Repair: Add missing reciprocal relationship to this character.
 */

import type { BaseEntity, Character, CharacterRelationship } from '@dmnpc/types/entity';
import type { RelationshipType } from '@dmnpc/types';
import { isCharacter } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';

/**
 * Relationship types that are typically bidirectional.
 * If A has this relationship to B, B might reasonably have it back.
 */
const BIDIRECTIONAL_RELATIONSHIPS = new Set<RelationshipType>([
  'friend',
  'colleague',
  'acquaintance',
  'family',
  'romantic',
]);

/**
 * Check for missing reciprocal relationships in a character.
 * This finds cases where OTHER characters have a relationship TO this character,
 * but this character doesn't have the reciprocal relationship back.
 */
function checkMissingReciprocals(character: Character, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, relationships } = character;
  const myRelationships = relationships;

  // Check all other characters to see if they have relationships to us
  for (const [otherId, otherChar] of ctx.characters) {
    if (otherId === id) continue;

    const otherRels = otherChar.relationships;
    for (const rel of otherRels) {
      // Only check relationships that point to us
      if (rel.targetId !== id) continue;

      // Only check bidirectional relationship types
      if (!rel.type || !BIDIRECTIONAL_RELATIONSHIPS.has(rel.type)) continue;

      // Check if we have the reciprocal relationship back
      const hasReciprocal = myRelationships.some(
        (myRel) => myRel.targetId === otherId && myRel.type === rel.type,
      );

      if (!hasReciprocal) {
        // Build the reciprocal relationship to add
        const reciprocalRelationship: CharacterRelationship = {
          targetId: otherId,
          type: rel.type,
          disposition: rel.disposition,
          familiarity: rel.familiarity,
          context: `Reciprocal ${rel.type} relationship with ${otherChar.label}`,
          pendingGeneration: false,
        };

        issues.push({
          entityId: id,
          entityType: 'character',
          validatorId: 'relationship-symmetry',
          severity: 'warning',
          field: 'relationships',
          message: `Missing reciprocal: ${otherChar.label} considers ${character.label} a ${rel.type}, but not vice versa`,
          suggestedFix: {
            field: 'relationships',
            value: reciprocalRelationship, // The relationship to ADD
            confidence: 'high',
            method: 'deterministic',
          },
        });
      }
    }
  }

  return issues;
}

/**
 * Relationship Symmetry Validator
 *
 * Checks for missing reciprocal relationships and auto-fixes by adding them.
 */
export const relationshipSymmetryValidator: Validator = {
  id: 'relationship-symmetry',
  name: 'Relationship Symmetry Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    // Only check characters - places and exits don't have the same relationship semantics
    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return checkMissingReciprocals(entity, ctx);
    }

    return [];
  },
};
