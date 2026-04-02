/**
 * Weapon definition types for the equipment system.
 *
 * Weapons are data-driven definitions in weapons.json. Each weapon provides
 * base damage, stat modifiers, and grants specific combat actions. Every
 * character has a weapon — unarmed is the fallback, not null.
 *
 * FEAT-188: Equipment Foundation (Combat & Equipment System — Phase 2)
 */

// ============================================================================
// Weapon Definition
// ============================================================================

/**
 * A weapon definition from the weapon registry.
 *
 * Static metadata — no per-instance state (durability, enchantments are future).
 * Weapon stat modifiers are additive for MVP. Phase 3 (Modifier Stacking) will
 * formalize StatModifier with sourceType and same-type non-stacking.
 */
export interface WeaponDefinition {
  /** Unique weapon identifier (e.g. "iron_sword", "hunting_bow"). */
  id: string;
  /** Display name (e.g. "Iron Sword"). */
  name: string;
  /** Brief description for tooltips/menus. */
  description: string;
  /** Weapon category (e.g. "sword", "axe", "bow", "mace", "staff", "unarmed"). */
  weaponType: string;
  /** Base damage value for combat. */
  baseDamage: number;
  /** Additive stat bonuses from wielding this weapon (e.g. { physical: 3 }). */
  statModifiers: Record<string, number>;
  /** ActionDefinition IDs this weapon grants access to. */
  grantedActions: string[];
  /** 1 = melee, 2+ = ranged (matters for future FFT grid mode). */
  range: number;
  /** LPC manifest option ID for the weapon sprite layer (e.g. "weapon_longsword_male"). Null for unarmed. */
  manifestOptionId: string | null;
}
