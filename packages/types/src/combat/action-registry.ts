/**
 * Action registry types for the unified action system.
 *
 * Actions span combat and exploration — the same registry serves both contexts.
 * "Slash" works in a battle scene and in a bar fight via chat. "Persuade" works
 * in a surrender negotiation and in a shop haggling scene.
 *
 * FEAT-187: Action Registry + Types (Combat & Equipment System — Phase 1)
 */

/**
 * Where an action comes from.
 * - innate: every character has it (attack, defend, flee)
 * - weapon: granted by the equipped weapon (thrust, cleave)
 * - learned: acquired through progression or training
 * - story: granted by story events or unique abilities
 */
export type ActionSource = 'innate' | 'learned' | 'weapon' | 'story';

/**
 * Where an action is available.
 * - combat: only usable in the battle scene
 * - exploration: only usable outside combat (via chat/classifier)
 * - both: usable in either context
 */
export type ActionContext = 'combat' | 'exploration' | 'both';

/**
 * Who can be targeted by a combat action.
 * For FF6 side-view, these select from participant lists.
 * For future FFT grid mode, these map to tile-range filters.
 */
export type TargetingType =
  | 'single_enemy'
  | 'single_ally'
  | 'self'
  | 'all_enemies'
  | 'all_allies'
  | 'all';

/**
 * Configuration for the timing mechanic on an action.
 *
 * Timing rewards, never punishes — missing the window gives the normal
 * (stat-dictated) result. Hitting it gives a bonus.
 */
export interface TimingConfig {
  /** Base window width in ms. Modified by stats/conditions at runtime. */
  baseWindowMs: number;
  /** Bonus multiplier on successful timing (e.g. 1.3 = 30% more damage). */
  successMultiplier: number;
  /** Which stat widens the window. Higher stat = more forgiving timing. Null = fixed window. */
  scalingStat: string | null;
}

/**
 * Additional effects applied on action success.
 *
 * Uses the same pattern as RulesetEffect where applicable, plus
 * combat-specific effect types.
 */
export type ActionEffect =
  | { type: 'apply_condition'; conditionId: string; severity: number }
  | { type: 'modify_poise'; delta: number }
  | { type: 'flee_attempt' };

/**
 * A registered action in the action registry.
 *
 * The action registry is the single source of truth for what characters can do.
 * It serves both combat (battle engine selects from menu) and exploration
 * (classifier matches freeform text to actionId).
 */
export interface ActionDefinition {
  /** Unique action identifier (e.g. "slash", "defend", "persuade"). */
  id: string;
  /** Display name (e.g. "Slash"). */
  name: string;
  /** Brief description for tooltips/menus. */
  description: string;

  /** Where this action comes from. */
  source: ActionSource;
  /** Where this action is available. */
  context: ActionContext;

  /**
   * Primary stat used for resolution in any context.
   * Null for actions that auto-succeed (defend) or have no stat check.
   */
  stat: string | null;

  /**
   * Combat-specific properties. Null for exploration-only actions.
   */
  combat: {
    /** Action points to use (1-3). */
    apCost: number;
    /** Poise cost to perform the action (0 = free, >0 = costs poise as a resource). */
    poiseCost: number;
    /** Who can be targeted. */
    targeting: TargetingType;
    /** 1 = melee, 2+ = ranged (matters for future FFT grid mode). */
    range: number;
    /** Base damage value. Null for non-damage actions (Defend, Persuade). */
    baseDamage: number | null;
    /** Additional effects applied on success. */
    effects: ActionEffect[];
    /** Timing mechanic config. Null = no timing window. */
    timing: TimingConfig | null;
  } | null;

  /** Requirements to have this action available. */
  requirements: {
    /** Required weapon type (e.g. "sword", "bow"). Null if no weapon needed. */
    weaponType: string | null;
    /** Minimum stat values required (e.g. { physical: 40 }). Empty if none. */
    minStat: Record<string, number>;
    /** Special condition requirement (e.g. "not_incapacitated"). Null if none. */
    condition: string | null;
  };
}
