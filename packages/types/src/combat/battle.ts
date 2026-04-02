/**
 * Battle system types for turn-based combat.
 *
 * The battle engine is a pure reducer: (state, input) → state.
 * All resolution uses BasicRuleset primitives. No LLM calls during combat.
 *
 * FEAT-190: Battle Engine (Combat & Equipment System — Phase 4)
 */

import type { ActionDefinition } from './action-registry.js';
import type { ConditionInstance } from './ruleset.js';
import type { WeaponDefinition } from './weapon.js';

/**
 * Complete snapshot of an active or resolved battle.
 *
 * The battle engine operates on this immutably — each step returns a new state.
 * Events accumulate as a log for post-combat milestone generation.
 */
export interface BattleState {
  /** Unique battle identifier. */
  id: string;
  /** Whether the battle is still running or has been resolved. */
  status: 'active' | 'resolved';

  /** All participants (player + allies + enemies). Indexed by participantId. */
  participants: CombatParticipant[];

  /** Character IDs in turn order for the current round. */
  turnQueue: string[];
  /** Index into turnQueue for the current actor. */
  currentTurnIndex: number;
  /** Current round number (1-based). */
  roundNumber: number;

  /** Accumulated battle events — serialized to chat milestones post-combat. */
  events: BattleEvent[];

  /** Place where the battle occurs. */
  placeId: string;
  /** Environment type for background selection. */
  environmentType: string;

  /** Battle result. Set when status becomes 'resolved'. */
  outcome: BattleOutcome | null;

  /**
   * All action definitions available in this battle, keyed by action ID.
   * Populated during initBattle() so the engine can look up actions without
   * importing from filesystem-based registries (making it client-importable).
   */
  actionDefs: Record<string, ActionDefinition>;
}

/**
 * Combat AI behavior pattern, derived from purpose + side at battle init.
 *
 * - **protector**: Guard allies, target last attacker, defend when low poise.
 * - **cautious**: Target weakest enemy, flee when poise < 30%.
 * - **supporter**: Prefer non-damage actions, flee early.
 * - **aggressive**: Target player first, never flee.
 * - **tactical**: Target highest-threat, use powerful actions first, flee at 20%.
 *
 * FEAT-194: NPC Combat AI (Combat & Equipment System — Phase 8)
 */
export type CombatBehaviorPattern =
  | 'protector'
  | 'cautious'
  | 'supporter'
  | 'aggressive'
  | 'tactical';

/**
 * Lightweight snapshot of a creature entity used to create a battle participant.
 * Populated by the client from the creature entity's location data before battle starts.
 */
export interface CreatureSnapshot {
  /** Stable creature entity ID (equals the battle participantId). */
  creatureId: string;
  /** Sprite sheet ID for loading the creature's battle texture. */
  spriteId: string;
  /** Display name shown in the HUD. */
  name: string;
  /** Flat stat record ready for the battle engine (stat IDs → values, including poise). */
  combatStats: Record<string, number>;
}

/**
 * A character's combat state snapshot.
 *
 * Stats are snapshotted at battle start (effective values with all modifiers).
 * Poise and conditions change during combat. Available actions are derived
 * from innate + weapon-granted actions filtered by requirements.
 */
export interface CombatParticipant {
  /** Opaque participant ID. Equals the character entity ID for character participants. */
  participantId: string;
  /** Present when this participant is a creature (not a character). Equals participantId. */
  creatureId?: string;
  /** Display name. */
  name: string;
  /** Which side this participant fights on. */
  side: 'player' | 'enemy';

  /** Snapshot of effective stat values at battle start. Keys are stat IDs. */
  stats: Record<string, number>;
  /** Current poise (combat HP). Depletes from damage and action costs. */
  currentPoise: number;
  /** Maximum poise at battle start. */
  maxPoise: number;
  /** Remaining action points for the current turn. */
  currentAp: number;
  /** Maximum AP for this participant (base + modifiers). */
  maxAp: number;

  /** Active conditions affecting this participant. Mutated during combat. */
  conditions: ConditionInstance[];
  /** Action IDs available to this participant (innate + weapon-granted). */
  availableActions: string[];
  /** Equipped weapon definition. Null = unarmed fallback. */
  weapon: WeaponDefinition | null;

  /** Whether this participant is in a defensive stance (set by Defend action). */
  defending: boolean;
  /** Whether this participant has been incapacitated (poise depleted → ailment). */
  incapacitated: boolean;
  /** AP bonus from a successful parry, applied at start of next turn. Capped at 1. */
  parryApBonus: number;
  /** Combat AI behavior pattern. Derived from purpose + side at init. */
  behaviorPattern: CombatBehaviorPattern;
}

/** How the battle ended. Discriminated union on `type`. */
export type BattleOutcome =
  | { type: 'victory' }
  | { type: 'defeat' }
  | { type: 'fled'; fleeingParticipantId: string }
  | { type: 'surrendered'; surrenderingParticipantId: string };

/** Discriminated union of events that occur during a battle. */
export type BattleEvent =
  | BattleRoundStartEvent
  | BattleActionEvent
  | BattlePoiseDepleteEvent
  | BattleIncapacitationEvent
  | BattleEndEvent;

export interface BattleRoundStartEvent {
  type: 'round_start';
  round: number;
  turnOrder: string[];
}

export interface BattleActionEvent {
  type: 'action_resolved';
  round: number;
  actorId: string;
  actorName: string;
  actionId: string;
  actionName: string;
  targetId: string | null;
  targetName: string | null;
  /** The stat used for the check. Null for auto-success actions. */
  stat: string | null;
  /** d100 roll result. Null for auto-success actions. */
  roll: number | null;
  /** Resolution outcome. */
  outcome: 'success' | 'partial' | 'failure' | 'auto';
  /** Damage dealt to the target. Null for non-damage actions. */
  damage: number | null;
  /** Whether the attacker hit the offensive timing window. */
  timingSuccess: boolean;
  /** Whether the target hit the defensive timing window (parried). */
  defenseTimingSuccess: boolean;
  /** Poise cost paid by the actor (from the action's poiseCost). */
  poiseCost: number;
  /** Human-readable effect descriptions (e.g. "Applied Rattled"). */
  effects: string[];
}

export interface BattlePoiseDepleteEvent {
  type: 'poise_depleted';
  round: number;
  participantId: string;
  characterName: string;
  /** The ailment applied on poise depletion. */
  ailmentId: string;
}

export interface BattleIncapacitationEvent {
  type: 'incapacitated';
  round: number;
  participantId: string;
  characterName: string;
}

export interface BattleEndEvent {
  type: 'battle_end';
  round: number;
  outcome: BattleOutcome;
}

/** What the caller submits to advance the battle by one action. */
export interface BattleActionInput {
  /** The action to perform (ActionDefinition ID). */
  actionId: string;
  /** Target participant's participantId. Null for self-target actions. */
  targetId: string | null;
  /** Whether the attacker hit the offensive timing window. Always false for NPCs. */
  timingSuccess: boolean;
  /** Whether the target hit the defensive timing window (parry). Always false for NPCs. */
  defenseTimingSuccess: boolean;
}

/** Data needed to start a battle. */
export interface BattleInitConfig {
  /** Characters on the player's side (player + following allies). */
  playerSide: BattleParticipantConfig[];
  /** Characters on the enemy side. */
  enemySide: BattleParticipantConfig[];
  /** Place where the battle occurs. */
  placeId: string;
  /** Environment type for background selection. */
  environmentType: string;
  /** AI-generated battle background image URL. Empty string when not yet generated. */
  battleBackgroundUrl: string;
  /** Creature snapshots for any creature participants, keyed by creatureId. Used by the battle scene to load creature sprites. */
  creatureSnapshots?: Record<string, CreatureSnapshot>;
}

/** Character data needed to create a CombatParticipant. */
export interface BattleParticipantConfig {
  participantId: string;
  /** Present when this participant is a creature (not a character). Equals participantId. */
  creatureId?: string;
  name: string;
  /** Character's purpose (e.g. 'guard', 'merchant'). Used to derive behavior pattern. */
  purpose: string;
  /** Effective stat values (already including all modifiers). */
  stats: Record<string, number>;
  /** Current conditions on the character. */
  conditions: ConditionInstance[];
  /** Equipped weapon definition. Null for unarmed. */
  weapon: WeaponDefinition | null;
}

/** Base action points per turn. */
export const COMBAT_BASE_AP = 2;
/** Dexterity threshold for +1 AP bonus. */
export const COMBAT_DEX_AP_THRESHOLD = 70;
/** Fatigue vital threshold for -1 AP penalty. */
export const COMBAT_FATIGUE_AP_THRESHOLD = 75;
/** Minimum AP per turn (always get at least one action). */
export const COMBAT_MIN_AP = 1;

/** Poise recovered at the start of each turn. */
export const COMBAT_POISE_REGEN = 3;
/** Poise recovered at the start of turn when defending (replaces base regen). */
export const COMBAT_POISE_REGEN_DEFENDING = 6;

/** Outcome multipliers for damage calculation. */
export const COMBAT_OUTCOME_MULTIPLIERS: Record<string, number> = {
  success: 1.0,
  partial: 0.5,
  failure: 0.0,
  auto: 0.0,
};

/** Defender bonus modifier for contested checks when target is defending. */
export const COMBAT_DEFEND_BONUS = 15;
