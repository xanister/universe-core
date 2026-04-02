/**
 * @dmnpc/rulesets — Pluggable ruleset implementations.
 *
 * Re-exports public API and auto-registers all rulesets on import.
 */

// Public API
export { rollD20, rollD100 } from './dice.js';
export { getRuleset, registerRuleset, listRulesetIds, clearRegistry } from './registry.js';
export { generateDefaultStats, completeStats } from './stat-generator.js';
export { assignDefaultWeapon } from './weapon-assigner.js';
export { pocRuleset, createPocRuleset } from './poc/poc-ruleset.js';
export {
  basicRuleset,
  createBasicRuleset,
  computeEffectiveStat,
  computeMaxPoise,
} from './basic/basic-ruleset.js';
export {
  collectStatModifiers,
  computeStackedDelta,
  computeStackedDeltaForStat,
  getModifiersForStat,
  type VitalThresholdConfig,
} from './basic/modifier-stacking.js';
export {
  resolveCombatCheck,
  resolveContestedCombatCheck,
  type CombatCheckResult,
} from './basic/combat-checks.js';
export {
  selectCombatAction,
  resolveBehaviorPattern,
  type CombatAIContext,
  type CombatAIDecision,
} from './basic/combat-ai.js';

// Auto-register all rulesets on first import
import { registerRuleset } from './registry.js';
import { pocRuleset } from './poc/poc-ruleset.js';
import { basicRuleset } from './basic/basic-ruleset.js';
registerRuleset(pocRuleset);
registerRuleset(basicRuleset);
