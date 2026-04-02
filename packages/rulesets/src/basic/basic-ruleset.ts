/**
 * BasicRuleset: Percentile-based resolution with poise, ailments, and vitals.
 *
 * Phase 5 of the Pluggable Ruleset System epic (FEAT-157).
 *
 * Core mechanics:
 * - 3 base stats (Physical/Mental/Social, 0-100) + 3 derived (Dexterity/Charisma/Wisdom)
 * - Poise: universal buffer absorbing failure consequences. Stored as stats.
 * - Ailments: severity-based conditions (wound, rattled, etc.) that modify effective stats
 * - Vitals: long-term accumulation tracks (bloodloss, anxiety, etc.) fed by ailments
 * - Percentile resolution: effectiveStat + difficultyModifier = successChance, d100 roll
 * - Use-based stat progression with diminishing returns
 *
 * All poise/ailment/vital specifics are INTERNAL to this ruleset. The game engine
 * sees only generic stats, conditions, and effects.
 */

import type {
  GameRuleset,
  ResolutionContext,
  ResolutionResult,
  RulesetEffect,
  TimeTickHookContext,
  ActionCompleteHookContext,
  DifficultyClass,
  StatDefinition,
  ConditionDefinition,
  StatGenerationContext,
  ConditionInstance,
  StandardCheckDetail,
} from '@dmnpc/types/combat';
import type { Character } from '@dmnpc/types/entity';
import { getCharacterWeaponId } from '@dmnpc/types/entity';
import { rollD100 } from '../dice.js';
import { getMinutesBetween } from './date-utils.js';
import {
  collectStatModifiers,
  computeStackedDeltaForStat,
  type VitalThresholdConfig,
} from './modifier-stacking.js';

// ============================================================================
// Constants
// ============================================================================

/** Difficulty modifiers applied to success chance. */
const DIFFICULTY_MODIFIERS: Record<DifficultyClass, number> = {
  trivial: 50,
  easy: 35,
  moderate: 15,
  hard: -10,
  extreme: -35,
};

/** Poise cost by difficulty on failure. */
const POISE_COST_BY_DIFFICULTY: Record<DifficultyClass, number> = {
  trivial: 0,
  easy: 5,
  moderate: 10,
  hard: 20,
  extreme: 30,
};

/** Base stat IDs. */
const BASE_STAT_IDS = ['physical', 'mental', 'social'] as const;

/** Derived stat formulas: id → [base1, base2]. */
const DERIVED_STAT_FORMULAS: Partial<Record<string, [string, string]>> = {
  dexterity: ['physical', 'mental'],
  charisma: ['physical', 'social'],
  wisdom: ['social', 'mental'],
};

/** Default base stat value (population average). */
const DEFAULT_BASE_STAT = 50;

/** Point-buy budget above starting values. */
const ALLOCATION_BUDGET = 15;

/** Poise recovery per game-minute during onTimeTick. */
const POISE_RECOVERY_PER_MINUTE = 2;

/** Use-based progression: threshold multiplier. stat * this = uses needed for +1. */
const PROGRESSION_THRESHOLD_MULTIPLIER = 0.5;

/**
 * Purpose-to-stat biases for NPC generation.
 * Values are deltas from the default (50). Unlisted purposes get 0/0/0.
 */
const PURPOSE_STAT_BIASES: Record<string, Record<string, number>> = {
  guard: { physical: 10, mental: -5, social: -10 },
  merchant: { physical: -10, mental: 5, social: 10 },
  bartender: { physical: -5, mental: -5, social: 10 },
  quest_giver: { physical: -5, mental: 5, social: 5 },
  captain: { physical: 5, mental: 5, social: -5 },
  helmsman: { physical: 10, mental: 5, social: -10 },
};

/** Small random variance for NPC stat generation. */
const NPC_VARIANCE = 5;

// ============================================================================
// Internal Ailment Data (BasicRuleset-specific, not on shared types)
// ============================================================================

/** Category for mapping failed checks to ailment types. */
type AilmentCategory = 'physical' | 'mental' | 'social';

interface AilmentTypeData {
  category: AilmentCategory;
  baseHealingRate: number; // severity reduction per game-minute
  /** Vital contributions per tick, per severity point. */
  vitalContributions: Record<string, number>;
}

/** Internal ailment type metadata. Keys match conditionDefinition IDs. Partial because condition.typeId may not match. */
const AILMENT_DATA: Partial<Record<string, AilmentTypeData>> = {
  wound: { category: 'physical', baseHealingRate: 0.01, vitalContributions: { bloodloss: 3 } },
  bruise: { category: 'physical', baseHealingRate: 0.02, vitalContributions: {} },
  exhaustion: { category: 'physical', baseHealingRate: 0.015, vitalContributions: { fatigue: 2 } },
  rattled: { category: 'mental', baseHealingRate: 0.02, vitalContributions: { anxiety: 2 } },
  sickness: { category: 'physical', baseHealingRate: 0.01, vitalContributions: { fatigue: 1 } },
  depression: { category: 'mental', baseHealingRate: 0.005, vitalContributions: { anxiety: 1 } },
  humiliation: { category: 'social', baseHealingRate: 0.02, vitalContributions: { anxiety: 1 } },
};

/** Maps stat domains to ailment categories for check-to-ailment mapping. */
const STAT_TO_CATEGORY: Record<string, AilmentCategory> = {
  physical: 'physical',
  mental: 'mental',
  social: 'social',
  dexterity: 'physical',
  charisma: 'social',
  wisdom: 'mental',
};

/** Map category → default ailment type when poise depleted. */
const CATEGORY_DEFAULT_AILMENT: Record<AilmentCategory, string> = {
  physical: 'wound',
  mental: 'rattled',
  social: 'humiliation',
};

// ============================================================================
// Internal Vital Data
// ============================================================================

interface VitalThreshold {
  value: number;
  statPenalties: Record<string, number>;
}

interface VitalTypeData {
  naturalRecoveryRate: number; // per game-minute, when no ailments feeding
  /** If true, vital increases naturally (hunger). */
  driftsUpward: boolean;
  driftRate: number; // per game-minute (only when driftsUpward)
  thresholds: VitalThreshold[];
}

const VITAL_DATA: Record<string, VitalTypeData> = {
  bloodloss: {
    naturalRecoveryRate: 1,
    driftsUpward: false,
    driftRate: 0,
    thresholds: [
      { value: 50, statPenalties: { physical: -5 } },
      { value: 75, statPenalties: { physical: -10, dexterity: -10 } },
    ],
  },
  anxiety: {
    naturalRecoveryRate: 0.5,
    driftsUpward: false,
    driftRate: 0,
    thresholds: [
      { value: 50, statPenalties: { mental: -5 } },
      { value: 75, statPenalties: { mental: -10, wisdom: -10 } },
    ],
  },
  fatigue: {
    naturalRecoveryRate: 0.3,
    driftsUpward: false,
    driftRate: 0,
    thresholds: [
      { value: 50, statPenalties: { physical: -3, mental: -3 } },
      { value: 75, statPenalties: { physical: -5, mental: -5, social: -5 } },
    ],
  },
  hunger: {
    naturalRecoveryRate: 0,
    driftsUpward: true,
    driftRate: 0.1,
    thresholds: [
      { value: 50, statPenalties: { physical: -3 } },
      { value: 75, statPenalties: { physical: -5, mental: -3 } },
    ],
  },
};

const VITAL_IDS = Object.keys(VITAL_DATA);

/** Display names for vital IDs (used by modifier stacking). */
const VITAL_DISPLAY_NAMES: Record<string, string> = {
  bloodloss: 'Blood Loss',
  anxiety: 'Anxiety',
  fatigue: 'Fatigue',
  hunger: 'Hunger',
};

/** Vital threshold configs for modifier stacking system. */
const VITAL_THRESHOLD_CONFIGS: VitalThresholdConfig[] = Object.entries(VITAL_DATA).map(
  ([vitalId, data]) => ({
    vitalId,
    vitalName: VITAL_DISPLAY_NAMES[vitalId] ?? vitalId,
    thresholds: data.thresholds,
  }),
);

// ============================================================================
// Stat Definitions
// ============================================================================

/** Hunger cascade: fatigue accumulation rate per game-minute when hunger >= 100. */
const HUNGER_CASCADE_FATIGUE_RATE = 0.5;

const STAT_DEFINITIONS: StatDefinition[] = [
  // Base stats (allocatable)
  {
    id: 'physical',
    name: 'Physical',
    description: 'Strength, endurance, health, raw athleticism.',
    min: 0,
    max: 100,
    default: DEFAULT_BASE_STAT,
    allocatable: true,
    category: 'base',
    incapacitationConfig: null,
  },
  {
    id: 'mental',
    name: 'Mental',
    description: 'Intelligence, perception, willpower, problem-solving.',
    min: 0,
    max: 100,
    default: DEFAULT_BASE_STAT,
    allocatable: true,
    category: 'base',
    incapacitationConfig: null,
  },
  {
    id: 'social',
    name: 'Social',
    description: 'Influence, empathy, composure, social awareness.',
    min: 0,
    max: 100,
    default: DEFAULT_BASE_STAT,
    allocatable: true,
    category: 'base',
    incapacitationConfig: null,
  },
  // Derived stats (computed)
  {
    id: 'dexterity',
    name: 'Dexterity',
    description: 'Reflexes, precision, hand-eye coordination. Derived from Physical and Mental.',
    min: 0,
    max: 100,
    default: DEFAULT_BASE_STAT,
    allocatable: false,
    derivedFrom: ['physical', 'mental'],
    category: 'derived',
    incapacitationConfig: null,
  },
  {
    id: 'charisma',
    name: 'Charisma',
    description: 'Presence, bearing, force of personality. Derived from Physical and Social.',
    min: 0,
    max: 100,
    default: DEFAULT_BASE_STAT,
    allocatable: false,
    derivedFrom: ['physical', 'social'],
    category: 'derived',
    incapacitationConfig: null,
  },
  {
    id: 'wisdom',
    name: 'Wisdom',
    description: 'Insight, intuition, street smarts. Derived from Social and Mental.',
    min: 0,
    max: 100,
    default: DEFAULT_BASE_STAT,
    allocatable: false,
    derivedFrom: ['social', 'mental'],
    category: 'derived',
    incapacitationConfig: null,
  },
  // Poise (resource)
  {
    id: 'poise',
    name: 'Poise',
    description: 'Universal buffer absorbing failure consequences. Recovers over time.',
    min: 0,
    max: 100,
    default: 0,
    allocatable: false,
    category: 'resource',
    incapacitationConfig: null,
  },
  {
    id: 'max_poise',
    name: 'Max Poise',
    description: 'Maximum poise capacity, derived from base stat average.',
    min: 0,
    max: 100,
    default: 0,
    allocatable: false,
    category: 'internal',
    incapacitationConfig: null,
  },
  // Vitals
  {
    id: 'bloodloss',
    name: 'Blood Loss',
    description: 'Cumulative blood loss from wounds. Penalizes physical stats at thresholds.',
    min: 0,
    max: 100,
    default: 0,
    allocatable: false,
    category: 'vital',
    incapacitationConfig: {
      name: 'Unconscious',
      description: 'The character has lost too much blood and collapsed. They cannot act.',
      allowedActionTypes: [],
      priority: 1,
      deathAfterMinutes: 30,
    },
  },
  {
    id: 'anxiety',
    name: 'Anxiety',
    description: 'Cumulative mental strain. Penalizes mental stats at thresholds.',
    min: 0,
    max: 100,
    default: 0,
    allocatable: false,
    category: 'vital',
    incapacitationConfig: {
      name: 'Panicking',
      description:
        'The character is overwhelmed by fear and anxiety. They can only flee or take desperate action.',
      allowedActionTypes: ['Action', 'Transition'],
      priority: 2,
      deathAfterMinutes: null,
    },
  },
  {
    id: 'fatigue',
    name: 'Fatigue',
    description: 'Cumulative exhaustion. Penalizes all stats at thresholds.',
    min: 0,
    max: 100,
    default: 0,
    allocatable: false,
    category: 'vital',
    incapacitationConfig: {
      name: 'Collapsed',
      description:
        'The character is physically spent and has collapsed from exhaustion. They cannot act.',
      allowedActionTypes: [],
      priority: 3,
      deathAfterMinutes: null,
    },
  },
  {
    id: 'hunger',
    name: 'Hunger',
    description: 'Hunger increases naturally. Penalizes physical and mental stats at thresholds.',
    min: 0,
    max: 100,
    default: 0,
    allocatable: false,
    category: 'vital',
    incapacitationConfig: null,
  },
];

// ============================================================================
// Condition Definitions (exposed via GameRuleset.conditionDefinitions)
// ============================================================================

const CONDITION_DEFINITIONS: ConditionDefinition[] = [
  {
    id: 'wound',
    name: 'Wound',
    description: 'Physical injury. Reduces Physical, feeds bloodloss.',
    category: 'physical',
    statModifiers: { physical: -5 },
  },
  {
    id: 'bruise',
    name: 'Bruise',
    description: 'Minor physical damage. Reduces Physical and Dexterity.',
    category: 'physical',
    statModifiers: { physical: -2, dexterity: -3 },
  },
  {
    id: 'exhaustion',
    name: 'Exhaustion',
    description: 'Physical exhaustion. Reduces Physical and Mental, feeds fatigue.',
    category: 'physical',
    statModifiers: { physical: -3, mental: -2 },
  },
  {
    id: 'rattled',
    name: 'Rattled',
    description: 'Mental shock or fear. Reduces Mental and Wisdom, feeds anxiety.',
    category: 'mental',
    statModifiers: { mental: -4, wisdom: -2 },
  },
  {
    id: 'sickness',
    name: 'Sickness',
    description: 'Illness. Reduces Physical and Social, feeds fatigue.',
    category: 'physical',
    statModifiers: { physical: -4, social: -2 },
  },
  {
    id: 'depression',
    name: 'Depression',
    description: 'Persistent low mood. Reduces Mental and Social, feeds anxiety.',
    category: 'mental',
    statModifiers: { mental: -3, social: -3 },
  },
  {
    id: 'humiliation',
    name: 'Humiliation',
    description: 'Social defeat. Reduces Social and Charisma, feeds anxiety.',
    category: 'social',
    statModifiers: { social: -5, charisma: -3 },
  },
];

// ============================================================================
// Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute the raw base or derived stat value (no modifiers).
 */
function computeRawStat(statId: string, stats: Record<string, number>): number {
  const formula = DERIVED_STAT_FORMULAS[statId];
  if (formula) {
    const [base1, base2] = formula;
    return Math.floor(
      ((stats[base1] ?? DEFAULT_BASE_STAT) + (stats[base2] ?? DEFAULT_BASE_STAT)) / 2,
    );
  }
  return stats[statId] ?? DEFAULT_BASE_STAT;
}

/**
 * Compute the effective value of a stat including ailment penalties,
 * vital threshold penalties, and equipment bonuses.
 *
 * Uses the modifier stacking system (FEAT-189):
 * - Bonuses: same-type non-stacking (highest per sourceType)
 * - Penalties: all accumulate
 */
export function computeEffectiveStat(
  statId: string,
  stats: Record<string, number>,
  conditions: ConditionInstance[],
  weaponStatModifiers: Record<string, number>,
  weaponName: string | null,
): number {
  const rawValue = computeRawStat(statId, stats);

  const allModifiers = collectStatModifiers({
    conditions,
    conditionDefs: CONDITION_DEFINITIONS,
    weaponStatModifiers,
    weaponName,
    vitalStats: stats,
    vitalThresholdConfigs: VITAL_THRESHOLD_CONFIGS,
  });

  const delta = computeStackedDeltaForStat(statId, allModifiers);
  return Math.max(rawValue + delta, 0);
}

/**
 * Compute max poise from base stat average.
 */
export function computeMaxPoise(stats: Record<string, number>): number {
  const sum = BASE_STAT_IDS.reduce((acc, id) => acc + (stats[id] ?? DEFAULT_BASE_STAT), 0);
  return Math.floor(sum / BASE_STAT_IDS.length);
}

/**
 * Check whether any active ailment feeds a given vital.
 */
function isVitalFedByAilments(vitalId: string, conditions: ConditionInstance[]): boolean {
  for (const condition of conditions) {
    const data = AILMENT_DATA[condition.typeId];
    if (data && vitalId in data.vitalContributions) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Contested Check Resolution
// ============================================================================

interface PercentileRollResult {
  roll: number;
  successChance: number;
  outcome: 'success' | 'partial' | 'failure';
  margin: number;
  effectiveStat: number;
}

/**
 * Roll d100 for a single participant in a check.
 */
function rollPercentile(
  statId: string,
  stats: Record<string, number>,
  conditions: ConditionInstance[],
  weaponStatModifiers: Record<string, number>,
  weaponName: string | null,
  difficulty: DifficultyClass,
  randomFn: (() => number) | undefined,
): PercentileRollResult {
  const effectiveStat = computeEffectiveStat(
    statId,
    stats,
    conditions,
    weaponStatModifiers,
    weaponName,
  );
  const difficultyModifier = DIFFICULTY_MODIFIERS[difficulty];
  const successChance = clamp(effectiveStat + difficultyModifier, 5, 95);
  const roll = rollD100(randomFn);

  let outcome: 'success' | 'partial' | 'failure';
  if (roll <= Math.floor(successChance / 2)) {
    outcome = 'success';
  } else if (roll <= successChance) {
    outcome = 'success';
  } else if (roll <= successChance + 15) {
    outcome = 'partial';
  } else {
    outcome = 'failure';
  }

  return { roll, successChance, outcome, margin: successChance - roll, effectiveStat };
}

/** Outcome tier numeric values for comparison. Higher is better. */
const OUTCOME_TIER: Record<string, number> = { success: 3, partial: 2, failure: 1 };

/**
 * Resolve a contested check between two characters.
 * Both roll the same stat. Winner determined by: outcome tier > margin > effective stat.
 */
function resolveContestedCheck(
  initiatorStats: Record<string, number>,
  initiatorConditions: ConditionInstance[],
  initiatorWeaponMods: Record<string, number>,
  initiatorWeaponName: string | null,
  opponentStats: Record<string, number>,
  opponentConditions: ConditionInstance[],
  opponentId: string,
  opponentName: string,
  statId: string,
  difficulty: DifficultyClass,
  randomFn: (() => number) | undefined,
): ResolutionResult {
  const initiatorRoll = rollPercentile(
    statId,
    initiatorStats,
    initiatorConditions,
    initiatorWeaponMods,
    initiatorWeaponName,
    difficulty,
    randomFn,
  );
  const opponentRoll = rollPercentile(
    statId,
    opponentStats,
    opponentConditions,
    {}, // Opponent weapon modifiers not passed through context — future: enrich from opponent's weapon
    null,
    difficulty,
    randomFn,
  );

  const initiatorTier = OUTCOME_TIER[initiatorRoll.outcome];
  const opponentTier = OUTCOME_TIER[opponentRoll.outcome];

  let initiatorOutcome: 'success' | 'partial' | 'failure';

  if (initiatorTier > opponentTier) {
    initiatorOutcome = 'success';
  } else if (initiatorTier < opponentTier) {
    initiatorOutcome = 'failure';
  } else {
    // Same tier — compare margins
    if (initiatorRoll.margin > opponentRoll.margin) {
      initiatorOutcome = 'success';
    } else if (initiatorRoll.margin < opponentRoll.margin) {
      initiatorOutcome = 'failure';
    } else {
      // Same margin — compare effective stats
      if (initiatorRoll.effectiveStat > opponentRoll.effectiveStat) {
        initiatorOutcome = 'success';
      } else if (initiatorRoll.effectiveStat < opponentRoll.effectiveStat) {
        initiatorOutcome = 'failure';
      } else {
        // True tie — draw, both get partial
        initiatorOutcome = 'partial';
      }
    }
  }

  const initiatorDetail: StandardCheckDetail = {
    stat: statId,
    statValue: initiatorRoll.effectiveStat,
    roll: initiatorRoll.roll,
    modifier: DIFFICULTY_MODIFIERS[difficulty],
    target: initiatorRoll.successChance,
  };

  const opponentDetail: StandardCheckDetail = {
    stat: statId,
    statValue: opponentRoll.effectiveStat,
    roll: opponentRoll.roll,
    modifier: DIFFICULTY_MODIFIERS[difficulty],
    target: opponentRoll.successChance,
  };

  const initiatorLabel = `${statId.charAt(0).toUpperCase() + statId.slice(1)} ${initiatorRoll.effectiveStat}, rolled ${initiatorRoll.roll} — ${initiatorRoll.outcome.charAt(0).toUpperCase() + initiatorRoll.outcome.slice(1)}`;
  const opponentLabel = `${statId.charAt(0).toUpperCase() + statId.slice(1)} ${opponentRoll.effectiveStat}, rolled ${opponentRoll.roll} — ${opponentRoll.outcome.charAt(0).toUpperCase() + opponentRoll.outcome.slice(1)}`;
  const resultLabel =
    initiatorOutcome === 'partial'
      ? 'Draw'
      : initiatorOutcome === 'success'
        ? 'Initiator wins'
        : 'Opponent wins';

  return {
    actionIndex: 0, // Caller must set correct index
    checkRequired: true,
    outcome: initiatorOutcome,
    margin: initiatorRoll.margin - opponentRoll.margin,
    check: {
      type: 'contested',
      initiator: initiatorDetail,
      opponent: opponentDetail,
      opponentId,
      opponentName,
    },
    mechanicalSummary: `Contested ${statId} check: Player (${initiatorLabel}) vs ${opponentName} (${opponentLabel}) → ${resultLabel}`,
  };
}

/**
 * Apply loser effects for a contested check: poise loss + potential ailment.
 * Extracted helper to avoid duplication between initiator-loses and opponent-loses paths.
 */
function applyLoserEffects(
  effects: RulesetEffect[],
  loser: Character,
  statId: string,
  difficulty: DifficultyClass,
): void {
  const poiseCost = POISE_COST_BY_DIFFICULTY[difficulty];
  effects.push({
    type: 'modify_stat',
    characterId: loser.id,
    stat: 'poise',
    delta: -poiseCost,
    reason: `Lost contested check — poise cost (${difficulty})`,
  });

  // Check if poise depleted → apply ailment
  const currentPoise = loser.info.rulesetState.stats.poise;
  if (currentPoise - poiseCost <= 0) {
    const category = STAT_TO_CATEGORY[statId] ?? 'physical';
    const ailmentId = CATEGORY_DEFAULT_AILMENT[category];
    effects.push({
      type: 'apply_condition',
      characterId: loser.id,
      conditionId: ailmentId,
      severity: 1,
      reason: `Poise depleted in contested ${statId} check`,
    });
  }
}

// ============================================================================
// BasicRuleset Factory
// ============================================================================

/**
 * Create a BasicRuleset instance.
 * @param randomFn Optional custom random function for deterministic tests.
 */
export function createBasicRuleset(randomFn?: () => number): GameRuleset {
  return {
    id: 'basic',
    name: 'Basic Ruleset',
    description:
      'Percentile-based resolution with 3 base stats, 3 derived stats, poise, ailments, and vitals.',

    statDefinitions: STAT_DEFINITIONS,
    conditionDefinitions: CONDITION_DEFINITIONS,

    statAllocationConfig: {
      method: 'point_buy',
      budget: ALLOCATION_BUDGET,
      startingValues: {
        physical: DEFAULT_BASE_STAT,
        mental: DEFAULT_BASE_STAT,
        social: DEFAULT_BASE_STAT,
      },
    },

    resolve(context: ResolutionContext): ResolutionResult[] {
      const weaponMods = context.weaponStatModifiers;
      // Weapon name not available in context — used for modifier display labels only.
      // The action resolver can provide it via an enriched context in the future.
      const weaponName: string | null = getCharacterWeaponId(context.character.info.clothing)
        ? 'Weapon'
        : null;

      return context.actions.map((action, i) => {
        const difficulty = action.suggestedDifficulty;

        // Trivial = auto-pass, no roll (even if opposedBy is set)
        if (difficulty === 'trivial') {
          return {
            actionIndex: i,
            checkRequired: false,
            outcome: 'success' as const,
            margin: 0,
            check: null,
            mechanicalSummary: 'Auto-pass (trivial)',
          };
        }

        const statId = action.suggestedStat ?? 'physical';

        // Contested check: opponent actively opposing
        if (action.opposedBy) {
          const opponent = context.nearbyCharacters.find((c) => c.id === action.opposedBy);
          if (opponent) {
            const result = resolveContestedCheck(
              context.character.info.rulesetState.stats,
              context.character.info.rulesetState.conditions,
              weaponMods,
              weaponName,
              opponent.info.rulesetState.stats,
              opponent.info.rulesetState.conditions,
              opponent.id,
              opponent.label,
              statId,
              difficulty,
              randomFn,
            );
            return { ...result, actionIndex: i };
          }
          // Opponent not found in nearby characters → fall through to standard check
        }

        // Standard check: character vs DC
        const stats = context.character.info.rulesetState.stats;
        const conditions = context.character.info.rulesetState.conditions;
        const rollResult = rollPercentile(
          statId,
          stats,
          conditions,
          weaponMods,
          weaponName,
          difficulty,
          randomFn,
        );

        return {
          actionIndex: i,
          checkRequired: true,
          outcome: rollResult.outcome,
          margin: rollResult.margin,
          check: {
            type: 'standard' as const,
            stat: statId,
            statValue: rollResult.effectiveStat,
            roll: rollResult.roll,
            modifier: DIFFICULTY_MODIFIERS[difficulty],
            target: rollResult.successChance,
          },
          mechanicalSummary: `${statId.charAt(0).toUpperCase() + statId.slice(1)} check: d100(${rollResult.roll}) vs ${rollResult.successChance}% (${rollResult.effectiveStat} base ${DIFFICULTY_MODIFIERS[difficulty] >= 0 ? '+' : ''}${DIFFICULTY_MODIFIERS[difficulty]} difficulty) → ${rollResult.outcome} (margin ${rollResult.margin >= 0 ? '+' : ''}${rollResult.margin})`,
        };
      });
    },

    generateStats(context: StatGenerationContext): Record<string, number> {
      const purpose = context.purpose;
      const biases = purpose ? (PURPOSE_STAT_BIASES[purpose] ?? {}) : {};

      const stats: Record<string, number> = {};
      for (const baseId of BASE_STAT_IDS) {
        const bias = biases[baseId] ?? 0;
        const variance =
          purpose && purpose !== 'player'
            ? Math.floor((randomFn ?? Math.random)() * (NPC_VARIANCE * 2 + 1)) - NPC_VARIANCE
            : 0;
        stats[baseId] = clamp(DEFAULT_BASE_STAT + bias + variance, 0, 100);
      }

      // Initialize poise to max (derived from base stat average)
      const maxPoise = computeMaxPoise(stats);
      stats.poise = maxPoise;
      stats.max_poise = maxPoise;

      // Initialize vitals at 0
      for (const vitalId of VITAL_IDS) {
        stats[vitalId] = 0;
      }

      return stats;
    },

    onTimeTick(context: TimeTickHookContext): RulesetEffect[] {
      const { character, minutesElapsed, newDate, disabledVitals } = context;
      const rs = character.info.rulesetState;
      const effects: RulesetEffect[] = [];
      const disabled = new Set(disabledVitals ?? []);

      if (minutesElapsed <= 0) return effects;

      // Dead characters: skip all processing
      if (character.info.deathdate) return effects;

      // 1. Heal ailments (reduce severity based on healing rate)
      for (const condition of rs.conditions) {
        const data = AILMENT_DATA[condition.typeId];
        if (!data) continue;

        // Healing rate decreases with severity: baseRate / severity
        const effectiveRate = data.baseHealingRate / Math.max(condition.severity, 1);
        const healing = effectiveRate * minutesElapsed;

        if (healing >= 1) {
          // Only emit whole-number severity reductions
          const severityReduction = Math.floor(healing);
          effects.push({
            type: 'modify_condition',
            characterId: character.id,
            conditionId: condition.typeId,
            severityDelta: -severityReduction,
            reason: `Natural healing (${minutesElapsed}min)`,
          });
        }
      }

      // 2. Accumulate vital contributions from active ailments
      for (const condition of rs.conditions) {
        const data = AILMENT_DATA[condition.typeId];
        if (!data) continue;

        for (const [vitalId, perSeverity] of Object.entries(data.vitalContributions)) {
          if (disabled.has(vitalId)) continue;
          const contribution = perSeverity * condition.severity * minutesElapsed;
          if (contribution > 0) {
            effects.push({
              type: 'modify_stat',
              characterId: character.id,
              stat: vitalId,
              delta: contribution,
              reason: `${condition.typeId} (severity ${condition.severity}) → ${vitalId}`,
            });
          }
        }
      }

      // 3. Natural vital recovery (when no ailments feed that vital) + hunger drift
      for (const vitalId of VITAL_IDS) {
        if (disabled.has(vitalId)) continue;
        const vitalValue = rs.stats[vitalId] ?? 0;
        const vitalData = VITAL_DATA[vitalId];

        if (vitalData.driftsUpward) {
          // Hunger always increases
          const drift = vitalData.driftRate * minutesElapsed;
          if (drift > 0 && vitalValue < 100) {
            effects.push({
              type: 'modify_stat',
              characterId: character.id,
              stat: vitalId,
              delta: Math.min(drift, 100 - vitalValue),
              reason: `Natural ${vitalId} increase`,
            });
          }
        } else if (vitalValue > 0 && !isVitalFedByAilments(vitalId, rs.conditions)) {
          // Recover vital when not being fed by ailments
          const recovery = vitalData.naturalRecoveryRate * minutesElapsed;
          if (recovery > 0) {
            effects.push({
              type: 'modify_stat',
              characterId: character.id,
              stat: vitalId,
              delta: -Math.min(recovery, vitalValue),
              reason: `Natural ${vitalId} recovery`,
            });
          }
        }
      }

      // 4. Recover poise toward max
      const currentPoise = rs.stats.poise;
      const maxPoise = rs.stats.max_poise;
      if (currentPoise < maxPoise) {
        const poiseRecovery = Math.min(
          POISE_RECOVERY_PER_MINUTE * minutesElapsed,
          maxPoise - currentPoise,
        );
        if (poiseRecovery > 0) {
          effects.push({
            type: 'modify_stat',
            characterId: character.id,
            stat: 'poise',
            delta: poiseRecovery,
            reason: 'Poise recovery',
          });
        }
      }

      // 5. Use-based stat progression
      for (const baseId of BASE_STAT_IDS) {
        const statValue = rs.stats[baseId] ?? DEFAULT_BASE_STAT;
        const usage = rs.statUsage[baseId] ?? 0;
        const threshold = Math.max(Math.floor(statValue * PROGRESSION_THRESHOLD_MULTIPLIER), 1);

        if (usage >= threshold && statValue < 100) {
          effects.push({
            type: 'modify_stat',
            characterId: character.id,
            stat: baseId,
            delta: 1,
            reason: `Progression: ${usage} uses (threshold: ${threshold})`,
          });
          // Reset usage counter
          effects.push({
            type: 'increment_stat_usage',
            characterId: character.id,
            stat: baseId,
            delta: -usage,
            reason: `Reset usage after ${baseId} progression`,
          });
          // Update max_poise since base stats changed
          effects.push({
            type: 'modify_stat',
            characterId: character.id,
            stat: 'max_poise',
            delta: 0, // Will be recalculated on next tick; +1 to one stat changes avg by ~0.33
            reason: 'Max poise recalc hint',
          });
        }
      }

      // 6. Hunger cascade: hunger >= 100 feeds fatigue (skip if either vital is disabled)
      const hungerValue = rs.stats.hunger;
      if (hungerValue >= 100 && !disabled.has('hunger') && !disabled.has('fatigue')) {
        const fatigueDelta = HUNGER_CASCADE_FATIGUE_RATE * minutesElapsed;
        const currentFatigue = rs.stats.fatigue;
        const cappedDelta = Math.min(fatigueDelta, 100 - currentFatigue);
        if (cappedDelta > 0) {
          effects.push({
            type: 'modify_stat',
            characterId: character.id,
            stat: 'fatigue',
            delta: cappedDelta,
            reason: `Hunger cascade (+${HUNGER_CASCADE_FATIGUE_RATE}/min)`,
          });
        }
      }

      // 7. Incapacitation: check vitals with incapacitationConfig in priority order
      // Collect vital stats with incapacitationConfig, sorted by priority (ascending = highest priority first)
      const vitalConfigs = STAT_DEFINITIONS.filter(
        (s) => s.incapacitationConfig !== null && !disabled.has(s.id),
      ).sort((a, b) => a.incapacitationConfig!.priority - b.incapacitationConfig!.priority);

      const currentIncap = rs.incapacitation;

      if (currentIncap && disabled.has(currentIncap)) {
        // Incapacitated by a now-disabled vital — clear it
        effects.push({
          type: 'set_incapacitation',
          characterId: character.id,
          vitalId: null,
          gameDate: newDate,
          reason: `${currentIncap} vital disabled`,
        });
      } else if (currentIncap) {
        // Currently incapacitated — check if the causing vital dropped below 100
        const causingVitalValue = rs.stats[currentIncap] ?? 0;
        if (causingVitalValue < 100) {
          // Clear incapacitation
          effects.push({
            type: 'set_incapacitation',
            characterId: character.id,
            vitalId: null,
            gameDate: newDate,
            reason: `${currentIncap} recovered below 100`,
          });

          // Re-check remaining vitals in priority order — another may still be >= 100
          for (const def of vitalConfigs) {
            if (def.id === currentIncap) continue;
            const vitalValue = rs.stats[def.id] ?? 0;
            if (vitalValue >= 100) {
              effects.push({
                type: 'set_incapacitation',
                characterId: character.id,
                vitalId: def.id,
                gameDate: newDate,
                reason: `${def.id} still at ${vitalValue} after ${currentIncap} recovery`,
              });
              break;
            }
          }
        } else {
          // Still incapacitated — check death timer
          const incapConfig = vitalConfigs.find((d) => d.id === currentIncap)?.incapacitationConfig;
          if (incapConfig?.deathAfterMinutes != null && rs.incapacitatedSince) {
            const elapsedIncap = getMinutesBetween(rs.incapacitatedSince, newDate);
            if (elapsedIncap >= incapConfig.deathAfterMinutes) {
              effects.push({
                type: 'set_death',
                characterId: character.id,
                gameDate: newDate,
                reason: `${currentIncap} incapacitation sustained for ${Math.floor(elapsedIncap)} minutes (threshold: ${incapConfig.deathAfterMinutes})`,
              });
            }
          }
        }
      } else {
        // Not incapacitated — check if any vital reached 100
        for (const def of vitalConfigs) {
          const vitalValue = rs.stats[def.id] ?? 0;
          if (vitalValue >= 100) {
            effects.push({
              type: 'set_incapacitation',
              characterId: character.id,
              vitalId: def.id,
              gameDate: newDate,
              reason: `${def.id} reached ${vitalValue}`,
            });
            break; // Only one incapacitation at a time (highest priority)
          }
        }
      }

      return effects;
    },

    onActionComplete(context: ActionCompleteHookContext): RulesetEffect[] {
      const { character, resolution, opponent } = context;
      const effects: RulesetEffect[] = [];

      if (!resolution.checkRequired || !resolution.check) return effects;

      const check = resolution.check;
      const difficulty = context.action.suggestedDifficulty;

      // --- Contested check: effects for both participants ---
      if (check.type === 'contested' && opponent) {
        const initiatorDetail = check.initiator;
        const opponentDetail = check.opponent;

        // Both participants track stat usage
        effects.push({
          type: 'increment_stat_usage',
          characterId: character.id,
          stat: initiatorDetail.stat,
          delta: 1,
          reason: `Used ${initiatorDetail.stat} in contested check`,
        });
        effects.push({
          type: 'increment_stat_usage',
          characterId: opponent.id,
          stat: opponentDetail.stat,
          delta: 1,
          reason: `Used ${opponentDetail.stat} in contested check (opponent)`,
        });

        if (resolution.outcome === 'partial') {
          // Draw: both take minor poise cost
          effects.push({
            type: 'modify_stat',
            characterId: character.id,
            stat: 'poise',
            delta: -3,
            reason: 'Contested check draw — minor exertion',
          });
          effects.push({
            type: 'modify_stat',
            characterId: opponent.id,
            stat: 'poise',
            delta: -3,
            reason: 'Contested check draw — minor exertion',
          });
        } else if (resolution.outcome === 'success') {
          // Initiator won
          effects.push({
            type: 'modify_stat',
            characterId: character.id,
            stat: 'poise',
            delta: 5,
            reason: 'Won contested check — confidence boost',
          });
          applyLoserEffects(effects, opponent, opponentDetail.stat, difficulty);
        } else {
          // Initiator lost
          effects.push({
            type: 'modify_stat',
            characterId: opponent.id,
            stat: 'poise',
            delta: 5,
            reason: 'Won contested check — confidence boost',
          });
          applyLoserEffects(effects, character, initiatorDetail.stat, difficulty);
        }

        return effects;
      }

      // --- Standard check: effects for acting character only ---
      const standardCheck = check.type === 'standard' ? check : null;
      if (!standardCheck) return effects;

      const rs = character.info.rulesetState;
      const isCriticalSuccess = resolution.margin >= Math.floor(standardCheck.target / 2);
      const isCriticalFailure = standardCheck.roll > 95;

      // Track stat usage for progression
      effects.push({
        type: 'increment_stat_usage',
        characterId: character.id,
        stat: standardCheck.stat,
        delta: 1,
        reason: `Used ${standardCheck.stat} in ${resolution.outcome} check`,
      });

      // Poise changes based on outcome
      if (isCriticalSuccess) {
        // Critical success: poise +5 (confidence boost)
        effects.push({
          type: 'modify_stat',
          characterId: character.id,
          stat: 'poise',
          delta: 5,
          reason: 'Critical success confidence boost',
        });
      } else if (resolution.outcome === 'partial') {
        // Partial: poise -5
        effects.push({
          type: 'modify_stat',
          characterId: character.id,
          stat: 'poise',
          delta: -5,
          reason: 'Partial success poise cost',
        });
      } else if (resolution.outcome === 'failure') {
        // Failure: poise loss scaled by difficulty
        const poiseCost = POISE_COST_BY_DIFFICULTY[difficulty];
        const finalCost = isCriticalFailure ? poiseCost * 2 : poiseCost;
        effects.push({
          type: 'modify_stat',
          characterId: character.id,
          stat: 'poise',
          delta: -finalCost,
          reason: `Failure poise cost (${difficulty}${isCriticalFailure ? ', critical' : ''})`,
        });

        // Check if poise depleted → apply ailment
        const currentPoise = rs.stats.poise;
        const newPoise = currentPoise - finalCost;

        if (newPoise <= 0 || isCriticalFailure) {
          const statId = standardCheck.stat;
          const category = STAT_TO_CATEGORY[statId] ?? 'physical';
          const ailmentId = CATEGORY_DEFAULT_AILMENT[category];

          effects.push({
            type: 'apply_condition',
            characterId: character.id,
            conditionId: ailmentId,
            severity: 1,
            reason: `Poise depleted on ${resolution.outcome} ${statId} check`,
          });
        }
      }

      return effects;
    },
  };
}

/** Default BasicRuleset instance (non-deterministic rolls). */
export const basicRuleset = createBasicRuleset();
