/**
 * Pluggable ruleset system types.
 *
 * Defines the GameRuleset interface and supporting types for stat-based
 * resolution, conditions, effects, and lifecycle hooks.
 */

import type { Character, Place } from '../entity/entities.js';
import type { ClassifiedAction } from '../game/action.js';

/**
 * Ruleset-owned state stored on each character.
 *
 * Groups all mechanical state into a single object so CharacterInfo has one
 * touch point for ruleset data instead of three. Future rulesets can add new
 * tracking fields here without touching CharacterInfo's top-level shape.
 */
export interface RulesetState {
  /** Ruleset-defined stat values. Keys are stat IDs. Empty when no ruleset. */
  stats: Record<string, number>;
  /** Active condition instances from the ruleset. Empty when no conditions. */
  conditions: ConditionInstance[];
  /** Cumulative stat usage counters for progression tracking. Keys are stat IDs. */
  statUsage: Record<string, number>;
  /** Active incapacitation vital ID (e.g. 'bloodloss'), or null when not incapacitated. */
  incapacitation: string | null;
  /** ISO date when incapacitation began (for death timer), or null. */
  incapacitatedSince: string | null;
}

/**
 * An active condition instance on a character.
 *
 * Generic enough for any ruleset: simple boolean conditions use severity=1,
 * stacking conditions increase severity, metadata carries ruleset-specific
 * context (e.g. body location for wounds).
 */
export interface ConditionInstance {
  /** References a ConditionDefinition.id from the active ruleset. */
  typeId: string;
  /** Severity level. 1 = base; higher values for stacking. */
  severity: number;
  /** Ruleset-specific metadata (e.g. { location: "left_arm" }). */
  metadata?: Record<string, string>;
}

/**
 * Configuration for what happens when a vital stat reaches 100.
 * Only set on vital-category stats. Null on all other stats.
 */
export interface IncapacitationConfig {
  /** Display name for the incapacitated state (e.g. "Unconscious", "Panicking"). */
  name: string;
  /** Description of the incapacitated state for LLM narration guidance. */
  description: string;
  /** Action types the character can still perform while incapacitated. Empty = fully incapacitated. */
  allowedActionTypes: string[];
  /** Priority for determining which vital wins when multiple are at 100. Lower = higher priority. */
  priority: number;
  /** Minutes of sustained incapacitation before death. Null = never fatal. */
  deathAfterMinutes: number | null;
}

export interface StatDefinition {
  id: string;
  name: string;
  description: string;
  min: number;
  max: number;
  default: number;
  /** Whether this stat is directly allocatable by the player during creation. */
  allocatable: boolean;
  /** For derived stats: IDs of the two base stats that are averaged. Undefined for base stats. */
  derivedFrom?: [string, string];
  /**
   * Display category for UI grouping. The character panel uses this to decide
   * which stats appear in the main stat list vs. the HUD or internal tracking.
   *
   * - 'base': Allocatable base stats (shown in stat panel + creator)
   * - 'derived': Computed stats (shown in stat panel, read-only)
   * - 'resource': Dynamic buffers like poise (shown in HUD, Phase 6)
   * - 'vital': Long-term accumulation tracks (shown in HUD, Phase 6)
   * - 'internal': Hidden from UI (e.g. max_poise, internal tracking)
   *
   * Defaults to base-like display when omitted.
   */
  category?: 'base' | 'derived' | 'resource' | 'vital' | 'internal';
  /** Incapacitation behavior when this vital reaches 100. Null for non-vital stats. */
  incapacitationConfig: IncapacitationConfig | null;
}

export interface ConditionDefinition {
  id: string;
  name: string;
  description: string;
  /** Category for UI color coding (e.g. physical → red, mental → purple, social → amber). */
  category: string;
  statModifiers: Record<string, number>;
}

/**
 * Difficulty tiers for action resolution.
 *
 * These 5 tiers are shared with the LLM classifier (it outputs one per action).
 * If a future ruleset needs finer granularity, widen this to `string` and let
 * each ruleset interpret the value — but that also means changing the classifier
 * prompt/schema, so prefer keeping the enum stable unless there's a clear need.
 */
export type DifficultyClass = 'trivial' | 'easy' | 'moderate' | 'hard' | 'extreme';

/**
 * Source type for stat modifiers. Used for same-type non-stacking on bonuses:
 * multiple bonuses from the same sourceType → only the highest applies.
 * Penalties from all sources accumulate (preserves existing ailment balance).
 *
 * - 'condition': from ailment/condition statModifiers scaled by severity
 * - 'equipment': from weapon statModifiers (future: armor, accessories)
 * - 'vital_threshold': from vital threshold penalties (bloodloss ≥50, etc.)
 *
 * Extensible to 'buff' | 'environment' in future phases.
 */
export type StatModifierSourceType = 'condition' | 'equipment' | 'vital_threshold';

/**
 * A typed stat modifier from a specific source.
 *
 * Used by collectStatModifiers() to gather all active modifiers, then by
 * applyModifierStacking() to compute the effective delta per stat.
 */
export interface StatModifier {
  /** Human-readable source label (e.g. "Wound ×2", "Iron Sword", "Blood Loss ≥50"). */
  source: string;
  /** Category for stacking rules. Bonuses don't stack within the same sourceType. */
  sourceType: StatModifierSourceType;
  /** Which stat this modifier affects. */
  stat: string;
  /** The delta value (positive = bonus, negative = penalty). */
  value: number;
}

/**
 * Context passed to GameRuleset.resolve().
 *
 * Difficulty and suggested stat live on each ClassifiedAction directly
 * (action.suggestedDifficulty, action.suggestedStat) — single source of truth,
 * no parallel arrays to keep in sync.
 */
export interface ResolutionContext {
  actions: ClassifiedAction[];
  character: Character;
  place: Place;
  nearbyCharacters: Character[];
  /**
   * Stat modifiers from the character's equipped weapon.
   * Populated by the action resolver from the weapon registry before calling resolve().
   * Empty object when no weapon or unarmed.
   */
  weaponStatModifiers: Record<string, number>;
}

/**
 * Core fields for a single participant's roll in a resolution check.
 *
 * Used directly in standard (one-sided) checks and as the per-participant
 * detail in contested (two-sided) checks.
 */
export interface StandardCheckDetail {
  stat: string;
  statValue: number;
  roll: number;
  modifier: number;
  target: number;
}

/**
 * Structured detail of a resolution check.
 *
 * Discriminated union on `type`:
 * - `'standard'`: one-sided check (character vs DC)
 * - `'contested'`: two-sided check (character vs character)
 *
 * `mechanicalSummary` on ResolutionResult remains the stable string contract
 * for downstream consumers that don't need structured check data.
 */
export type CheckDetail =
  | (StandardCheckDetail & { type: 'standard' })
  | {
      type: 'contested';
      initiator: StandardCheckDetail;
      opponent: StandardCheckDetail;
      opponentId: string;
      opponentName: string;
    };

export interface ResolutionResult {
  actionIndex: number;
  checkRequired: boolean;
  outcome: 'success' | 'partial' | 'failure';
  margin: number;
  check: CheckDetail | null;
  mechanicalSummary: string;
}

export type RulesetEffect =
  | { type: 'modify_stat'; characterId: string; stat: string; delta: number; reason: string }
  | {
      /** Add a new condition or stack severity on an existing one with the same conditionId. */
      type: 'apply_condition';
      characterId: string;
      conditionId: string;
      severity: number;
      metadata?: Record<string, string>;
      reason: string;
    }
  | {
      /** Change severity of an existing condition. Negative = healing. Auto-removes at severity <= 0. */
      type: 'modify_condition';
      characterId: string;
      conditionId: string;
      severityDelta: number;
      reason: string;
    }
  | {
      /** Force-remove a condition regardless of severity. */
      type: 'remove_condition';
      characterId: string;
      conditionId: string;
      reason: string;
    }
  | {
      type: 'increment_stat_usage';
      characterId: string;
      stat: string;
      delta: number;
      reason: string;
    }
  | {
      /** Set or clear incapacitation. vitalId null = clear. */
      type: 'set_incapacitation';
      characterId: string;
      vitalId: string | null;
      gameDate: string;
      reason: string;
    }
  | {
      /** Set character death. Permanent — sets deathdate, clears incapacitation. */
      type: 'set_death';
      characterId: string;
      gameDate: string;
      reason: string;
    };

export interface TimeTickHookContext {
  character: Character;
  minutesElapsed: number;
  previousDate: string;
  newDate: string;
  /** Vital IDs to skip during this tick (e.g. hunger/fatigue when disabled by universe setting or NPC guard). Empty when omitted. */
  disabledVitals?: string[];
}

export interface ActionCompleteHookContext {
  character: Character;
  action: ClassifiedAction;
  resolution: ResolutionResult;
  /** Opponent character for contested checks. Null for standard checks. */
  opponent: Character | null;
}

/**
 * Context for generating initial stats for a new character.
 *
 * Narrower than Character — used pre-creation when the full entity doesn't exist yet.
 * The purpose field drives NPC stat biases (e.g. guard → physical, merchant → social).
 */
export interface StatGenerationContext {
  /** Character purpose (e.g., 'player', 'guard', 'merchant'). Null for unspecified. */
  purpose: string | null;
}

/**
 * Configuration for how character stats are allocated during creation.
 *
 * Currently only 'point_buy'. When adding 'roll' or 'fixed', this becomes a
 * discriminated union on `method` (e.g. `{ method: 'roll'; diceExpression: string }`)
 * — existing rulesets stay on 'point_buy' and don't break.
 */
export interface StatAllocationConfig {
  method: 'point_buy';
  /** Total points to distribute above starting values. */
  budget: number;
  /** Per-stat floor before allocation. */
  startingValues: Record<string, number>;
}

export interface GameRuleset {
  id: string;
  name: string;
  description: string;

  statDefinitions: StatDefinition[];
  conditionDefinitions: ConditionDefinition[];
  statAllocationConfig: StatAllocationConfig;

  resolve(context: ResolutionContext): ResolutionResult[];
  generateStats(context: StatGenerationContext): Record<string, number>;

  onTimeTick(context: TimeTickHookContext): RulesetEffect[];
  onActionComplete(context: ActionCompleteHookContext): RulesetEffect[];
}
