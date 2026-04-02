/**
 * Tests for NPC Combat AI (FEAT-194).
 *
 * Validates: behavior pattern resolution, per-pattern action selection,
 * target prioritization, flee/defend thresholds, edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  selectCombatAction,
  resolveBehaviorPattern,
  type CombatAIContext,
} from '@dmnpc/rulesets/basic/combat-ai.js';
import type {
  CombatParticipant,
  ActionDefinition,
  BattleEvent,
  CombatBehaviorPattern
} from '@dmnpc/types/combat';

// ============================================================================
// Test Helpers
// ============================================================================

function makeParticipant(overrides: Partial<CombatParticipant> = {}): CombatParticipant {
  return {
    participantId: 'CHAR_npc',
    name: 'NPC',
    side: 'enemy',
    stats: { physical: 50, mental: 50, social: 50, dexterity: 50 },
    currentPoise: 50,
    maxPoise: 50,
    currentAp: 2,
    maxAp: 2,
    conditions: [],
    availableActions: ['attack', 'defend', 'flee'],
    weapon: null,
    defending: false,
    incapacitated: false,
    parryApBonus: 0,
    behaviorPattern: 'aggressive',
    ...overrides,
  };
}

const ATTACK_ACTION: ActionDefinition = {
  id: 'attack',
  name: 'Attack',
  description: 'Strike with equipped weapon',
  source: 'innate',
  context: 'combat',
  stat: 'physical',
  combat: {
    apCost: 1,
    poiseCost: 0,
    targeting: 'single_enemy',
    range: 1,
    baseDamage: null,
    effects: [],
    timing: null,
  },
  requirements: { weaponType: null, minStat: {}, condition: null },
};

const DEFEND_ACTION: ActionDefinition = {
  id: 'defend',
  name: 'Defend',
  description: 'Brace for incoming attacks',
  source: 'innate',
  context: 'combat',
  stat: null,
  combat: {
    apCost: 1,
    poiseCost: 0,
    targeting: 'self',
    range: 0,
    baseDamage: null,
    effects: [],
    timing: null,
  },
  requirements: { weaponType: null, minStat: {}, condition: null },
};

const FLEE_ACTION: ActionDefinition = {
  id: 'flee',
  name: 'Flee',
  description: 'Attempt to escape combat',
  source: 'innate',
  context: 'combat',
  stat: 'dexterity',
  combat: {
    apCost: 2,
    poiseCost: 8,
    targeting: 'self',
    range: 0,
    baseDamage: null,
    effects: [{ type: 'flee_attempt' }],
    timing: null,
  },
  requirements: { weaponType: null, minStat: {}, condition: null },
};

const THRUST_ACTION: ActionDefinition = {
  id: 'thrust',
  name: 'Thrust',
  description: 'A powerful thrust attack',
  source: 'weapon',
  context: 'combat',
  stat: 'physical',
  combat: {
    apCost: 2,
    poiseCost: 5,
    targeting: 'single_enemy',
    range: 1,
    baseDamage: 12,
    effects: [],
    timing: null,
  },
  requirements: { weaponType: 'sword', minStat: {}, condition: null },
};

const CLEAVE_ACTION: ActionDefinition = {
  id: 'cleave',
  name: 'Cleave',
  description: 'Hit all enemies',
  source: 'weapon',
  context: 'combat',
  stat: 'physical',
  combat: {
    apCost: 2,
    poiseCost: 5,
    targeting: 'all_enemies',
    range: 1,
    baseDamage: 7,
    effects: [],
    timing: null,
  },
  requirements: { weaponType: 'axe', minStat: {}, condition: null },
};

const RIPOSTE_ACTION: ActionDefinition = {
  id: 'riposte',
  name: 'Riposte',
  description: 'Counter-attack stance',
  source: 'weapon',
  context: 'combat',
  stat: 'dexterity',
  combat: {
    apCost: 1,
    poiseCost: 0,
    targeting: 'self',
    range: 0,
    baseDamage: null,
    effects: [],
    timing: null,
  },
  requirements: { weaponType: 'sword', minStat: {}, condition: null },
};

/** Deterministic random function seeded by index. */
function makeFixedRandom(value: number): () => number {
  return () => value;
}

function makeContext(overrides: Partial<CombatAIContext> = {}): CombatAIContext {
  const actor = overrides.actor ?? makeParticipant();
  const enemy = makeParticipant({
    participantId: 'CHAR_player',
    name: 'Player',
    side: 'player',
    behaviorPattern: 'aggressive',
  });
  const enemies = overrides.enemies ?? [enemy];
  const allies = overrides.allies ?? [actor];
  const actions = overrides.availableActions ?? [ATTACK_ACTION, DEFEND_ACTION, FLEE_ACTION];
  const validTargets = overrides.validTargets ?? {
    attack: enemies.filter((e) => !e.incapacitated),
    defend: [actor],
    flee: [actor],
  };

  return {
    actor,
    allies,
    enemies,
    availableActions: actions,
    validTargets,
    events: overrides.events ?? [],
    randomFn: overrides.randomFn ?? makeFixedRandom(0.5),
    ...overrides,
  };
}

// ============================================================================
// resolveBehaviorPattern
// ============================================================================

describe('resolveBehaviorPattern', () => {
  it('maps guard on ally side to protector', () => {
    expect(resolveBehaviorPattern('guard', 'player')).toBe('protector');
  });

  it('maps captain on ally side to protector', () => {
    expect(resolveBehaviorPattern('captain', 'player')).toBe('protector');
  });

  it('maps merchant on ally side to cautious', () => {
    expect(resolveBehaviorPattern('merchant', 'player')).toBe('cautious');
  });

  it('maps bartender on ally side to cautious', () => {
    expect(resolveBehaviorPattern('bartender', 'player')).toBe('cautious');
  });

  it('maps helmsman on ally side to cautious', () => {
    expect(resolveBehaviorPattern('helmsman', 'player')).toBe('cautious');
  });

  it('maps quest_giver on ally side to supporter', () => {
    expect(resolveBehaviorPattern('quest_giver', 'player')).toBe('supporter');
  });

  it('defaults unknown ally purpose to cautious', () => {
    expect(resolveBehaviorPattern('unknown_purpose', 'player')).toBe('cautious');
  });

  it('maps guard on enemy side to protector', () => {
    expect(resolveBehaviorPattern('guard', 'enemy')).toBe('protector');
  });

  it('maps captain on enemy side to tactical', () => {
    expect(resolveBehaviorPattern('captain', 'enemy')).toBe('tactical');
  });

  it('defaults unknown enemy purpose to aggressive', () => {
    expect(resolveBehaviorPattern('merchant', 'enemy')).toBe('aggressive');
  });

  it('defaults player purpose on enemy side to aggressive', () => {
    expect(resolveBehaviorPattern('player', 'enemy')).toBe('aggressive');
  });
});

// ============================================================================
// selectCombatAction — Aggressive
// ============================================================================

describe('selectCombatAction — aggressive', () => {
  it('prefers attack over defend when healthy', () => {
    const ctx = makeContext({
      actor: makeParticipant({ behaviorPattern: 'aggressive' }),
    });
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('attack');
    expect(decision.targetId).toBe('CHAR_player');
  });

  it('targets player-side characters preferentially', () => {
    const player = makeParticipant({
      participantId: 'CHAR_player',
      name: 'Player',
      side: 'player',
    });
    const ally = makeParticipant({
      participantId: 'CHAR_ally',
      name: 'Ally',
      side: 'player',
      currentPoise: 10,
      maxPoise: 50,
    });
    const ctx = makeContext({
      actor: makeParticipant({ behaviorPattern: 'aggressive' }),
      enemies: [player, ally],
      validTargets: { attack: [player, ally], defend: [makeParticipant()], flee: [makeParticipant()] },
    });
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('attack');
    // Aggressive should have high preference for the player character
    // (the ally has lower poise, but aggressive prioritizes the player)
    // With fixed random (0.5) the player target should win due to 2.0 weight
    expect(decision.targetId).toBe('CHAR_player');
  });

  it('never chooses flee even at low poise', () => {
    const actor = makeParticipant({
      behaviorPattern: 'aggressive',
      currentPoise: 5,
      maxPoise: 50,
    });
    const ctx = makeContext({ actor });
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).not.toBe('flee');
  });

  it('rarely defends — prefers attack even at moderate poise', () => {
    const actor = makeParticipant({
      behaviorPattern: 'aggressive',
      currentPoise: 20,
      maxPoise: 50,
    });
    const ctx = makeContext({ actor });
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('attack');
  });
});

// ============================================================================
// selectCombatAction — Protector
// ============================================================================

describe('selectCombatAction — protector', () => {
  it('targets whoever last attacked an ally', () => {
    const actor = makeParticipant({
      participantId: 'CHAR_guard',
      behaviorPattern: 'protector',
      side: 'player',
    });
    const protectedAlly = makeParticipant({
      participantId: 'CHAR_merchant',
      side: 'player',
      behaviorPattern: 'cautious',
    });
    const enemy1 = makeParticipant({
      participantId: 'CHAR_enemy1',
      side: 'enemy',
    });
    const enemy2 = makeParticipant({
      participantId: 'CHAR_enemy2',
      side: 'enemy',
    });

    const events: BattleEvent[] = [
      {
        type: 'action_resolved',
        round: 1,
        actorId: 'CHAR_enemy2',
        actorName: 'Enemy 2',
        actionId: 'attack',
        actionName: 'Attack',
        targetId: 'CHAR_merchant',
        targetName: 'Merchant',
        stat: 'physical',
        roll: 42,
        outcome: 'success',
        damage: 8,
        timingSuccess: false,
        defenseTimingSuccess: false,
        poiseCost: 0,
        effects: [],
      },
    ];

    const ctx = makeContext({
      actor,
      allies: [actor, protectedAlly],
      enemies: [enemy1, enemy2],
      validTargets: { attack: [enemy1, enemy2], defend: [actor], flee: [actor] },
      events,
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('attack');
    expect(decision.targetId).toBe('CHAR_enemy2');
  });

  it('defends when poise is low', () => {
    const actor = makeParticipant({
      behaviorPattern: 'protector',
      currentPoise: 10,
      maxPoise: 50,
      side: 'player',
    });
    const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'enemy' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy],
      validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    // Protector has high defend weight and 0.35 threshold — at 20% poise should prefer defend
    expect(decision.actionId).toBe('defend');
  });

  it('never flees', () => {
    const actor = makeParticipant({
      behaviorPattern: 'protector',
      currentPoise: 3,
      maxPoise: 50,
      side: 'player',
    });
    const ctx = makeContext({ actor });
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).not.toBe('flee');
  });
});

// ============================================================================
// selectCombatAction — Cautious
// ============================================================================

describe('selectCombatAction — cautious', () => {
  it('targets weakest enemy (lowest poise ratio)', () => {
    const actor = makeParticipant({ behaviorPattern: 'cautious', side: 'player' });
    const strongEnemy = makeParticipant({
      participantId: 'CHAR_strong',
      side: 'enemy',
      currentPoise: 45,
      maxPoise: 50,
    });
    const weakEnemy = makeParticipant({
      participantId: 'CHAR_weak',
      side: 'enemy',
      currentPoise: 10,
      maxPoise: 50,
    });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [strongEnemy, weakEnemy],
      validTargets: { attack: [strongEnemy, weakEnemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('attack');
    expect(decision.targetId).toBe('CHAR_weak');
  });

  it('flees when poise drops below 30%', () => {
    const actor = makeParticipant({
      behaviorPattern: 'cautious',
      currentPoise: 10,
      maxPoise: 50,
      side: 'player',
    });
    const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'enemy' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy],
      availableActions: [ATTACK_ACTION, DEFEND_ACTION, FLEE_ACTION],
      validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('flee');
  });

  it('attacks when healthy', () => {
    const actor = makeParticipant({
      behaviorPattern: 'cautious',
      currentPoise: 45,
      maxPoise: 50,
      side: 'player',
    });
    const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'enemy' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy],
      validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('attack');
  });
});

// ============================================================================
// selectCombatAction — Supporter
// ============================================================================

describe('selectCombatAction — supporter', () => {
  it('flees earlier than cautious (50% threshold)', () => {
    const actor = makeParticipant({
      behaviorPattern: 'supporter',
      currentPoise: 20,
      maxPoise: 50,
      side: 'player',
    });
    const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'enemy' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy],
      availableActions: [ATTACK_ACTION, DEFEND_ACTION, FLEE_ACTION],
      validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('flee');
  });

  it('does not flee when poise is above threshold', () => {
    const actor = makeParticipant({
      behaviorPattern: 'supporter',
      currentPoise: 30,
      maxPoise: 50,
      side: 'player',
    });
    const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'enemy' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy],
      validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).not.toBe('flee');
  });
});

// ============================================================================
// selectCombatAction — Tactical
// ============================================================================

describe('selectCombatAction — tactical', () => {
  it('targets highest-threat character (most damage dealt)', () => {
    const actor = makeParticipant({ behaviorPattern: 'tactical', side: 'enemy' });
    const lowThreat = makeParticipant({
      participantId: 'CHAR_low',
      side: 'player',
      stats: { physical: 30, mental: 30, dexterity: 30 },
    });
    const highThreat = makeParticipant({
      participantId: 'CHAR_high',
      side: 'player',
      stats: { physical: 70, mental: 70, dexterity: 70 },
    });

    const events: BattleEvent[] = [
      {
        type: 'action_resolved',
        round: 1,
        actorId: 'CHAR_high',
        actorName: 'High Threat',
        actionId: 'attack',
        actionName: 'Attack',
        targetId: actor.participantId,
        targetName: 'NPC',
        stat: 'physical',
        roll: 25,
        outcome: 'success',
        damage: 15,
        timingSuccess: false,
        defenseTimingSuccess: false,
        poiseCost: 0,
        effects: [],
      },
    ];

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [lowThreat, highThreat],
      validTargets: { attack: [lowThreat, highThreat], defend: [actor], flee: [actor] },
      events,
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('attack');
    expect(decision.targetId).toBe('CHAR_high');
  });

  it('flees at 20% poise', () => {
    const actor = makeParticipant({
      behaviorPattern: 'tactical',
      currentPoise: 8,
      maxPoise: 50,
      side: 'enemy',
    });
    const enemy = makeParticipant({ participantId: 'CHAR_player', side: 'player' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy],
      availableActions: [ATTACK_ACTION, DEFEND_ACTION, FLEE_ACTION],
      validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('flee');
  });

  it('prefers powerful actions (higher damage per AP)', () => {
    const actor = makeParticipant({
      behaviorPattern: 'tactical',
      currentPoise: 50,
      maxPoise: 50,
      currentAp: 2,
      side: 'enemy',
    });
    const enemy = makeParticipant({ participantId: 'CHAR_player', side: 'player' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy],
      availableActions: [ATTACK_ACTION, THRUST_ACTION, DEFEND_ACTION],
      validTargets: {
        attack: [enemy],
        thrust: [enemy],
        defend: [actor],
      },
    });

    const decision = selectCombatAction(ctx);
    // Thrust has 12 baseDamage / 2 AP = 6 efficiency
    // Attack uses weapon base (3 unarmed) / 1 AP = 3 efficiency
    // Tactical's damageWeight of 1.2 amplifies both equally
    // Thrust should win on raw efficiency
    expect(decision.actionId).toBe('thrust');
  });
});

// ============================================================================
// selectCombatAction — AoE preference
// ============================================================================

describe('selectCombatAction — AoE actions', () => {
  it('values AoE actions higher when multiple enemies present', () => {
    const actor = makeParticipant({
      behaviorPattern: 'aggressive',
      currentPoise: 50,
      maxPoise: 50,
      currentAp: 2,
    });
    const enemy1 = makeParticipant({ participantId: 'CHAR_e1', side: 'player' });
    const enemy2 = makeParticipant({ participantId: 'CHAR_e2', side: 'player' });
    const enemy3 = makeParticipant({ participantId: 'CHAR_e3', side: 'player' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy1, enemy2, enemy3],
      availableActions: [ATTACK_ACTION, CLEAVE_ACTION, DEFEND_ACTION],
      validTargets: {
        attack: [enemy1, enemy2, enemy3],
        cleave: [enemy1, enemy2, enemy3],
        defend: [actor],
      },
    });

    const decision = selectCombatAction(ctx);
    // Cleave has AoE bonus (1.3x) and hits all 3 enemies — should outscore single-target attack
    expect(decision.actionId).toBe('cleave');
  });
});

// ============================================================================
// selectCombatAction — Riposte
// ============================================================================

describe('selectCombatAction — riposte', () => {
  it('considers riposte as a self-target action', () => {
    const actor = makeParticipant({
      behaviorPattern: 'protector',
      side: 'player',
    });
    const enemy1 = makeParticipant({ participantId: 'CHAR_e1', side: 'enemy' });
    const enemy2 = makeParticipant({ participantId: 'CHAR_e2', side: 'enemy' });

    const ctx = makeContext({
      actor,
      allies: [actor],
      enemies: [enemy1, enemy2],
      availableActions: [ATTACK_ACTION, RIPOSTE_ACTION, DEFEND_ACTION],
      validTargets: {
        attack: [enemy1, enemy2],
        riposte: [actor],
        defend: [actor],
      },
    });

    const decision = selectCombatAction(ctx);
    // Should produce a valid decision (riposte may or may not be chosen)
    expect(decision.actionId).toBeDefined();
    expect(decision.targetId).not.toBeNull();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('selectCombatAction — edge cases', () => {
  it('returns end_turn when no actions available', () => {
    const ctx = makeContext({
      availableActions: [],
      validTargets: {},
    });
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('end_turn');
    expect(decision.targetId).toBeNull();
  });

  it('returns end_turn when no valid targets for any action', () => {
    const ctx = makeContext({
      availableActions: [ATTACK_ACTION],
      validTargets: { attack: [] },
    });
    const decision = selectCombatAction(ctx);
    // Only attack available but no targets — defend/flee not available either
    expect(decision.actionId).toBe('end_turn');
  });

  it('handles single participant battle (only self-target actions)', () => {
    const actor = makeParticipant({ behaviorPattern: 'aggressive' });
    const ctx = makeContext({
      actor,
      enemies: [],
      availableActions: [DEFEND_ACTION],
      validTargets: { defend: [actor] },
    });
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBe('defend');
  });

  it('applies random jitter to scores', () => {
    const actor = makeParticipant({ behaviorPattern: 'aggressive' });
    const enemy1 = makeParticipant({
      participantId: 'CHAR_e1',
      side: 'player',
      currentPoise: 25,
      maxPoise: 50,
    });
    const enemy2 = makeParticipant({
      participantId: 'CHAR_e2',
      side: 'player',
      currentPoise: 25,
      maxPoise: 50,
    });

    // Run with different random seeds and verify we sometimes get different targets
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      let callCount = 0;
      const ctx = makeContext({
        actor,
        enemies: [enemy1, enemy2],
        validTargets: { attack: [enemy1, enemy2], defend: [actor], flee: [actor] },
        randomFn: () => {
          callCount++;
          return (i * 7 + callCount * 13) % 100 / 100;
        },
      });
      const decision = selectCombatAction(ctx);
      if (decision.targetId) results.add(decision.targetId);
    }
    // With varied random seeds and identical targets, jitter should produce different picks
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it('does not select incapacitated targets', () => {
    const actor = makeParticipant({ behaviorPattern: 'aggressive' });
    const aliveEnemy = makeParticipant({
      participantId: 'CHAR_alive',
      side: 'player',
    });
    const deadEnemy = makeParticipant({
      participantId: 'CHAR_dead',
      side: 'player',
      incapacitated: true,
    });

    const ctx = makeContext({
      actor,
      enemies: [aliveEnemy, deadEnemy],
      validTargets: { attack: [aliveEnemy], defend: [actor], flee: [actor] },
    });

    const decision = selectCombatAction(ctx);
    expect(decision.targetId).toBe('CHAR_alive');
  });

  it('handles actor with zero maxPoise (division safety)', () => {
    const actor = makeParticipant({
      behaviorPattern: 'cautious',
      currentPoise: 0,
      maxPoise: 0,
    });
    const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'player' });
    const ctx = makeContext({
      actor,
      enemies: [enemy],
      validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
    });

    // Should not throw — poiseRatio defaults to 1 when maxPoise is 0
    const decision = selectCombatAction(ctx);
    expect(decision.actionId).toBeDefined();
  });
});

// ============================================================================
// Behavior consistency across patterns
// ============================================================================

describe('behavior consistency', () => {
  const patterns: CombatBehaviorPattern[] = [
    'protector',
    'cautious',
    'supporter',
    'aggressive',
    'tactical',
  ];

  for (const pattern of patterns) {
    it(`${pattern} always produces a valid decision with standard actions`, () => {
      const actor = makeParticipant({ behaviorPattern: pattern, side: 'player' });
      const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'enemy' });
      const ctx = makeContext({
        actor,
        allies: [actor],
        enemies: [enemy],
        validTargets: { attack: [enemy], defend: [actor], flee: [actor] },
      });
      const decision = selectCombatAction(ctx);
      expect(decision.actionId).toBeDefined();
      expect(typeof decision.actionId).toBe('string');
    });
  }

  it('aggressive pattern never flees regardless of poise', () => {
    for (const poise of [1, 5, 10, 25]) {
      const actor = makeParticipant({
        behaviorPattern: 'aggressive',
        currentPoise: poise,
        maxPoise: 50,
      });
      const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'player' });
      const ctx = makeContext({
        actor,
        enemies: [enemy],
        availableActions: [ATTACK_ACTION, FLEE_ACTION, DEFEND_ACTION],
        validTargets: { attack: [enemy], flee: [actor], defend: [actor] },
      });
      const decision = selectCombatAction(ctx);
      expect(decision.actionId).not.toBe('flee');
    }
  });

  it('protector pattern never flees regardless of poise', () => {
    for (const poise of [1, 5, 10, 25]) {
      const actor = makeParticipant({
        behaviorPattern: 'protector',
        currentPoise: poise,
        maxPoise: 50,
        side: 'player',
      });
      const enemy = makeParticipant({ participantId: 'CHAR_enemy', side: 'enemy' });
      const ctx = makeContext({
        actor,
        allies: [actor],
        enemies: [enemy],
        availableActions: [ATTACK_ACTION, FLEE_ACTION, DEFEND_ACTION],
        validTargets: { attack: [enemy], flee: [actor], defend: [actor] },
      });
      const decision = selectCombatAction(ctx);
      expect(decision.actionId).not.toBe('flee');
    }
  });
});
