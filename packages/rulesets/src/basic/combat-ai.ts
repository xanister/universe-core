/**
 * NPC Combat AI — behavior-based action selection for turn-based combat.
 *
 * Pure functions. No LLM calls, no I/O, no randomness beyond the jitter
 * parameter. Same AI system for allies and enemies — only the behavior
 * pattern differs.
 *
 * FEAT-194: NPC Combat AI (Combat & Equipment System — Phase 8)
 */

import type {
  CombatParticipant,
  CombatBehaviorPattern,
  BattleEvent,
  ActionDefinition,
} from '@dmnpc/types/combat';

// ============================================================================
// Public Interface
// ============================================================================

/** Everything the AI needs to make a decision. */
export interface CombatAIContext {
  /** The NPC whose turn it is. */
  actor: CombatParticipant;
  /** All allies (same side, including actor). */
  allies: CombatParticipant[];
  /** All enemies (opposite side). */
  enemies: CombatParticipant[];
  /** Actions the actor can currently afford (already filtered by AP, poise, weapon). */
  availableActions: ActionDefinition[];
  /** For each action ID, the valid targets. */
  validTargets: Record<string, CombatParticipant[]>;
  /** Battle events so far (used by Protector to find last attacker). */
  events: BattleEvent[];
  /** Random jitter function returning a value in [0, 1). Defaults to Math.random. */
  randomFn?: () => number;
}

/** What the AI decides to do. */
export interface CombatAIDecision {
  actionId: string;
  targetId: string | null;
}

// ============================================================================
// Behavior Pattern Resolution
// ============================================================================

/** Purpose-to-behavior mapping for ally-side NPCs. */
const ALLY_BEHAVIOR_MAP: Record<string, CombatBehaviorPattern> = {
  guard: 'protector',
  captain: 'protector',
  bartender: 'cautious',
  merchant: 'cautious',
  helmsman: 'cautious',
  quest_giver: 'supporter',
};

/** Purpose-to-behavior mapping for enemy-side NPCs. */
const ENEMY_BEHAVIOR_MAP: Record<string, CombatBehaviorPattern> = {
  guard: 'protector',
  captain: 'tactical',
};

/**
 * Derive combat behavior pattern from character purpose and battle side.
 *
 * Ally default: cautious. Enemy default: aggressive.
 */
export function resolveBehaviorPattern(
  purpose: string,
  side: 'player' | 'enemy',
): CombatBehaviorPattern {
  if (side === 'player') {
    return ALLY_BEHAVIOR_MAP[purpose] ?? 'cautious';
  }
  return ENEMY_BEHAVIOR_MAP[purpose] ?? 'aggressive';
}

// ============================================================================
// Behavior Thresholds
// ============================================================================

interface BehaviorConfig {
  /** Poise ratio below which this pattern considers fleeing. 0 = never flee. */
  fleeThreshold: number;
  /** Poise ratio below which this pattern considers defending. */
  defendThreshold: number;
  /** Weight multiplier for damage actions. */
  damageWeight: number;
  /** Weight multiplier for defend action. */
  defendWeight: number;
  /** Weight multiplier for flee action. */
  fleeWeight: number;
}

const BEHAVIOR_CONFIGS: Record<CombatBehaviorPattern, BehaviorConfig> = {
  protector: {
    fleeThreshold: 0,
    defendThreshold: 0.35,
    damageWeight: 1.0,
    defendWeight: 1.2,
    fleeWeight: 0,
  },
  cautious: {
    fleeThreshold: 0.3,
    defendThreshold: 0.4,
    damageWeight: 0.8,
    defendWeight: 1.0,
    fleeWeight: 1.5,
  },
  supporter: {
    fleeThreshold: 0.5,
    defendThreshold: 0.5,
    damageWeight: 0.5,
    defendWeight: 1.0,
    fleeWeight: 2.0,
  },
  aggressive: {
    fleeThreshold: 0,
    defendThreshold: 0.15,
    damageWeight: 1.5,
    defendWeight: 0.3,
    fleeWeight: 0,
  },
  tactical: {
    fleeThreshold: 0.2,
    defendThreshold: 0.3,
    damageWeight: 1.2,
    defendWeight: 0.8,
    fleeWeight: 1.0,
  },
};

// ============================================================================
// Core AI
// ============================================================================

/**
 * Select an action and target for an NPC combatant.
 *
 * Scores every valid (action, target) pair using behavior-weighted priorities,
 * action efficiency, and ±15% random jitter. Returns the highest-scoring pair.
 */
export function selectCombatAction(ctx: CombatAIContext): CombatAIDecision {
  const { actor, availableActions, validTargets, randomFn } = ctx;
  const random = randomFn ?? Math.random;
  const config = BEHAVIOR_CONFIGS[actor.behaviorPattern];
  const poiseRatio = actor.maxPoise > 0 ? actor.currentPoise / actor.maxPoise : 1;

  // Collect all (action, target) candidates with scores
  const candidates: Array<{ actionId: string; targetId: string | null; score: number }> = [];

  for (const action of availableActions) {
    const targets = validTargets[action.id] ?? [];

    if (isSelfTargetAction(action)) {
      const score = scoreSelfAction(action, config, poiseRatio, ctx);
      if (score > 0) {
        candidates.push({ actionId: action.id, targetId: actor.participantId, score });
      }
    } else if (targets.length > 0) {
      for (const target of targets) {
        const score = scoreTargetedAction(action, target, config, poiseRatio, ctx);
        if (score > 0) {
          candidates.push({ actionId: action.id, targetId: target.participantId, score });
        }
      }
    }
  }

  // Apply ±15% random jitter to each score
  for (const c of candidates) {
    const jitter = 1 + (random() * 0.3 - 0.15);
    c.score *= jitter;
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  // Return best candidate, or fallback to end turn
  if (candidates.length > 0) {
    return { actionId: candidates[0].actionId, targetId: candidates[0].targetId };
  }

  // No valid candidates — end turn (caller handles this)
  return { actionId: 'end_turn', targetId: null };
}

// ============================================================================
// Scoring Functions
// ============================================================================

function isSelfTargetAction(action: ActionDefinition): boolean {
  return action.combat?.targeting === 'self';
}

function isFleeAction(action: ActionDefinition): boolean {
  return action.id === 'flee';
}

function isDefendAction(action: ActionDefinition): boolean {
  return action.id === 'defend';
}

/**
 * Score a self-target action (defend, flee, riposte, use_item).
 */
function scoreSelfAction(
  action: ActionDefinition,
  config: BehaviorConfig,
  poiseRatio: number,
  ctx: CombatAIContext,
): number {
  if (isFleeAction(action)) {
    return scoreFleeAction(config, poiseRatio);
  }

  if (isDefendAction(action)) {
    return scoreDefendAction(config, poiseRatio, ctx);
  }

  // Riposte and other self-target actions get a moderate base score
  if (action.id === 'riposte') {
    return scoreRiposteAction(config, ctx);
  }

  // Generic self-target (use_item, etc.) — low base score
  return 5;
}

/**
 * Score a flee action based on behavior config and poise ratio.
 */
function scoreFleeAction(config: BehaviorConfig, poiseRatio: number): number {
  if (config.fleeThreshold <= 0) return 0;
  if (poiseRatio >= config.fleeThreshold) return 0;

  // Once below threshold, urgency is at least 0.5 (flee is a decisive action).
  // Scales from 0.5 (at threshold) to 1.0 (at 0 poise).
  const rawUrgency = 1 - poiseRatio / config.fleeThreshold;
  const urgency = 0.5 + rawUrgency * 0.5;
  return 50 * urgency * config.fleeWeight;
}

/**
 * Score defend based on behavior config and poise ratio.
 */
function scoreDefendAction(
  config: BehaviorConfig,
  poiseRatio: number,
  ctx: CombatAIContext,
): number {
  // Minimum base — defending is always a valid tactical choice (but low priority when healthy)
  let score = 1;

  // Higher defend score when poise is low
  if (poiseRatio < config.defendThreshold) {
    const urgency = 1 - poiseRatio / config.defendThreshold;
    score = Math.max(score, 30 * urgency);
  }

  // Protectors get bonus for defending when an ally is wounded
  if (ctx.actor.behaviorPattern === 'protector') {
    const woundedAllies = ctx.allies.filter(
      (a) =>
        a.participantId !== ctx.actor.participantId &&
        !a.incapacitated &&
        a.maxPoise > 0 &&
        a.currentPoise / a.maxPoise < 0.4,
    );
    if (woundedAllies.length > 0) {
      score += 10;
    }
  }

  return score * config.defendWeight;
}

/**
 * Score riposte (counter-attack stance). Good when expecting incoming attacks.
 */
function scoreRiposteAction(config: BehaviorConfig, ctx: CombatAIContext): number {
  const activeEnemies = ctx.enemies.filter((e) => !e.incapacitated);
  if (activeEnemies.length === 0) return 0;

  // More valuable when multiple enemies are alive (more likely to be attacked)
  const enemyPressure = Math.min(activeEnemies.length / 3, 1);
  return 15 * enemyPressure * config.defendWeight;
}

/**
 * Score a targeted damage/utility action against a specific target.
 */
function scoreTargetedAction(
  action: ActionDefinition,
  target: CombatParticipant,
  config: BehaviorConfig,
  poiseRatio: number,
  ctx: CombatAIContext,
): number {
  const baseDamage = action.combat?.baseDamage ?? ctx.actor.weapon?.baseDamage ?? 3;
  const apCost = action.combat?.apCost ?? 1;

  // Efficiency: damage per AP (higher = more efficient)
  const efficiency = baseDamage > 0 ? baseDamage / apCost : 5 / apCost;

  // Target priority based on behavior pattern
  const targetPriority = scoreTargetPriority(target, config, poiseRatio, ctx);

  // AoE bonus: actions that hit multiple targets are more valuable
  const aoeMult = isAoEAction(action) ? 1.3 : 1.0;

  return efficiency * targetPriority * config.damageWeight * aoeMult;
}

function isAoEAction(action: ActionDefinition): boolean {
  const targeting = action.combat?.targeting;
  return targeting === 'all_enemies' || targeting === 'all_allies' || targeting === 'all';
}

/**
 * Score how desirable a target is based on behavior pattern.
 */
function scoreTargetPriority(
  target: CombatParticipant,
  _config: BehaviorConfig,
  _poiseRatio: number,
  ctx: CombatAIContext,
): number {
  const pattern = ctx.actor.behaviorPattern;
  const targetPoiseRatio = target.maxPoise > 0 ? target.currentPoise / target.maxPoise : 1;

  switch (pattern) {
    case 'aggressive':
      return scoreAggressiveTarget(target, ctx);

    case 'protector':
      return scoreProtectorTarget(target, ctx);

    case 'cautious':
      return scoreCautiousTarget(targetPoiseRatio);

    case 'supporter':
      return scoreSupporterTarget(targetPoiseRatio);

    case 'tactical':
      return scoreTacticalTarget(target, ctx);

    default:
      return 1.0;
  }
}

/**
 * Aggressive: target player first, then lowest-poise enemy.
 */
function scoreAggressiveTarget(target: CombatParticipant, ctx: CombatAIContext): number {
  // Strongly prefer the player character
  const isPlayer = ctx.enemies.find(
    (e) => e.participantId === target.participantId && e.side === 'player',
  );
  if (isPlayer) return 2.0;

  // Otherwise prefer lowest-poise targets (finish them off)
  const poiseRatio = target.maxPoise > 0 ? target.currentPoise / target.maxPoise : 1;
  return 1.0 + (1 - poiseRatio) * 0.5;
}

/**
 * Protector: target whoever last attacked an ally.
 */
function scoreProtectorTarget(target: CombatParticipant, ctx: CombatAIContext): number {
  const lastAttackerId = findLastAttackerOfAllies(ctx);

  if (lastAttackerId === target.participantId) {
    return 2.5;
  }

  // Default: spread damage evenly
  return 1.0;
}

/**
 * Cautious: target weakest enemy (easiest to finish off).
 */
function scoreCautiousTarget(targetPoiseRatio: number): number {
  // Strongly prefer low-poise targets
  return 1.0 + (1 - targetPoiseRatio) * 1.5;
}

/**
 * Supporter: weak preference for any enemy (supporter prefers non-combat).
 */
function scoreSupporterTarget(targetPoiseRatio: number): number {
  // Mild preference for weakest
  return 0.5 + (1 - targetPoiseRatio) * 0.5;
}

/**
 * Tactical: target highest-threat character (most damage dealt, or highest stats).
 */
function scoreTacticalTarget(target: CombatParticipant, ctx: CombatAIContext): number {
  const threat = computeThreatScore(target, ctx);
  return 1.0 + threat;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find the character who last attacked one of the actor's allies.
 * Scans battle events in reverse for the most recent damage event targeting an ally.
 */
function findLastAttackerOfAllies(ctx: CombatAIContext): string | null {
  const allyIds = new Set(ctx.allies.map((a) => a.participantId));

  for (let i = ctx.events.length - 1; i >= 0; i--) {
    const event = ctx.events[i];
    if (
      event.type === 'action_resolved' &&
      event.targetId !== null &&
      allyIds.has(event.targetId) &&
      event.damage !== null &&
      event.damage > 0
    ) {
      return event.actorId;
    }
  }

  return null;
}

/**
 * Compute a threat score for a target.
 * Based on total damage dealt during the battle + base stat strength.
 */
function computeThreatScore(target: CombatParticipant, ctx: CombatAIContext): number {
  // Sum damage dealt by this target
  let totalDamage = 0;
  for (const event of ctx.events) {
    if (
      event.type === 'action_resolved' &&
      event.actorId === target.participantId &&
      event.damage !== null
    ) {
      totalDamage += event.damage;
    }
  }

  // Normalize: damage component (0-1 range, assuming max ~50 damage in a battle)
  const damageComponent = Math.min(totalDamage / 50, 1);

  // Stat component: average of physical and mental, normalized to 0-1
  const physical = target.stats['physical'] || 50;
  const mental = target.stats['mental'] || 50;
  const statComponent = (physical + mental) / 200;

  return damageComponent * 0.7 + statComponent * 0.3;
}
