/**
 * Weapon Assigner
 *
 * Assigns a default weapon to a character based on the universe's active ruleset
 * and the character's purpose. Returns null when no ruleset is active.
 *
 * Follows the same pattern as stat-generator.ts.
 *
 * FEAT-188: Equipment Foundation (Combat & Equipment System — Phase 2)
 */

import type { Universe } from '@dmnpc/types/entity';

/**
 * Purpose-to-weapon-type mapping for NPC weapon assignment.
 *
 * Combat-oriented purposes get combat weapons, civilian purposes stay unarmed.
 * Player characters get null (weapon chosen in creation wizard).
 */
const PURPOSE_WEAPON_MAP: Record<string, string> = {
  guard: 'iron_sword',
  captain: 'iron_sword',
  quest_giver: 'wooden_staff',
};

/**
 * Assign a default weapon for a new character based on the universe's active ruleset
 * and the character's purpose.
 *
 * Returns null when:
 * - No ruleset active (rulesetId is null)
 * - Purpose is 'player' (player chooses weapon in creation wizard)
 * - Purpose has no weapon mapping (defaults to unarmed)
 *
 * Returns 'unarmed' for civilian purposes (bartender, merchant, npc, helmsman, etc.)
 * when a ruleset is active, because every character should have a weapon entry.
 */
export function assignDefaultWeapon(universe: Universe, purpose: string | null): string | null {
  if (!universe.rulesetId) return null;
  if (!purpose || purpose === 'player') return null;

  return PURPOSE_WEAPON_MAP[purpose] ?? 'unarmed';
}
