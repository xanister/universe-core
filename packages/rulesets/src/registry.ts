/**
 * Ruleset registry.
 * Stores and retrieves GameRuleset implementations by ID.
 */

import type { GameRuleset } from '@dmnpc/types/combat';

const registry = new Map<string, GameRuleset>();

/**
 * Register a ruleset. Throws if a ruleset with the same ID is already registered.
 */
export function registerRuleset(ruleset: GameRuleset): void {
  if (registry.has(ruleset.id)) {
    throw new Error(`Ruleset "${ruleset.id}" is already registered`);
  }
  registry.set(ruleset.id, ruleset);
}

/**
 * Retrieve a ruleset by ID. Throws if not found.
 */
export function getRuleset(id: string): GameRuleset {
  const ruleset = registry.get(id);
  if (!ruleset) {
    throw new Error(`Ruleset "${id}" is not registered`);
  }
  return ruleset;
}

/**
 * List all registered ruleset IDs.
 */
export function listRulesetIds(): string[] {
  return [...registry.keys()];
}

/**
 * Clear all registered rulesets. For testing only.
 */
export function clearRegistry(): void {
  registry.clear();
}
