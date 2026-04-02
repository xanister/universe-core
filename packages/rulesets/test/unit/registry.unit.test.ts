import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRuleset,
  getRuleset,
  listRulesetIds,
  clearRegistry,
} from '@dmnpc/rulesets/registry.js';
import type { GameRuleset } from '@dmnpc/types/combat';

function createStubRuleset(id: string): GameRuleset {
  return {
    id,
    name: `Stub ${id}`,
    description: `Stub ruleset ${id}`,
    statDefinitions: [],
    conditionDefinitions: [],
    statAllocationConfig: { method: 'point_buy', budget: 0, startingValues: {} },
    resolve: () => [],
    generateStats: () => ({}),
    onTimeTick: () => [],
    onActionComplete: () => [],
  };
}

describe('registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('registers and retrieves a ruleset by id', () => {
    const ruleset = createStubRuleset('test');
    registerRuleset(ruleset);
    expect(getRuleset('test')).toBe(ruleset);
  });

  it('throws when registering a duplicate id', () => {
    registerRuleset(createStubRuleset('dup'));
    expect(() => registerRuleset(createStubRuleset('dup'))).toThrow(
      'Ruleset "dup" is already registered'
    );
  });

  it('throws when getting an unregistered id', () => {
    expect(() => getRuleset('nonexistent')).toThrow(
      'Ruleset "nonexistent" is not registered'
    );
  });

  it('lists all registered ruleset ids', () => {
    registerRuleset(createStubRuleset('alpha'));
    registerRuleset(createStubRuleset('beta'));
    expect(listRulesetIds()).toEqual(['alpha', 'beta']);
  });

  it('clearRegistry removes all rulesets', () => {
    registerRuleset(createStubRuleset('x'));
    clearRegistry();
    expect(listRulesetIds()).toEqual([]);
    expect(() => getRuleset('x')).toThrow();
  });
});
