/**
 * Unit tests for entityMatchesSlotTags (BUG-183).
 *
 * Verifies that the tag-matching helper used during object reuse
 * correctly applies requiredTags (AND) and forbiddenTags (NOR) logic.
 */

import { describe, it, expect } from 'vitest';
import { entityMatchesSlotTags } from '../../src/place-layout/generator.js';

describe('entityMatchesSlotTags (BUG-183)', () => {
  // --- requiredTags ---

  it('matches when no tag constraints are set', () => {
    expect(entityMatchesSlotTags(['ship', 'wall'])).toBe(true);
  });

  it('matches when requiredTags is null', () => {
    expect(entityMatchesSlotTags(['ship', 'wall'], null, null)).toBe(true);
  });

  it('matches when requiredTags is empty', () => {
    expect(entityMatchesSlotTags(['ship'], [], null)).toBe(true);
  });

  it('matches when entity has all required tags', () => {
    expect(entityMatchesSlotTags(['ship', 'wall', 'common'], ['ship', 'wall'])).toBe(true);
  });

  it('rejects when entity is missing a required tag', () => {
    expect(entityMatchesSlotTags(['ship'], ['ship', 'wall'])).toBe(false);
  });

  it('rejects when entity has no tags but required tags are set', () => {
    expect(entityMatchesSlotTags([], ['wall'])).toBe(false);
  });

  // --- forbiddenTags ---

  it('matches when forbiddenTags is null', () => {
    expect(entityMatchesSlotTags(['wall'], null, null)).toBe(true);
  });

  it('matches when forbiddenTags is empty', () => {
    expect(entityMatchesSlotTags(['wall'], null, [])).toBe(true);
  });

  it('rejects when entity has a forbidden tag', () => {
    expect(entityMatchesSlotTags(['ship', 'wall'], null, ['wall'])).toBe(false);
  });

  it('matches when entity has none of the forbidden tags', () => {
    expect(entityMatchesSlotTags(['ship'], null, ['wall'])).toBe(true);
  });

  // --- combined ---

  it('matches when both required and forbidden constraints are satisfied', () => {
    expect(entityMatchesSlotTags(['ship', 'common'], ['ship'], ['wall'])).toBe(true);
  });

  it('rejects when required passes but forbidden fails', () => {
    expect(entityMatchesSlotTags(['ship', 'wall'], ['ship'], ['wall'])).toBe(false);
  });

  it('rejects when forbidden passes but required fails', () => {
    expect(entityMatchesSlotTags(['common'], ['ship'], ['wall'])).toBe(false);
  });

  // --- the exact scenario from BUG-183 ---

  it('torch (wall tag) matches wall slot, not floor slot', () => {
    const torchTags = ['common', 'lighting', 'tavern', 'ship', 'wall'];
    // Wall slot: requiredTags includes "wall"
    expect(entityMatchesSlotTags(torchTags, ['wall', 'ship'])).toBe(true);
    // Floor slot: forbiddenTags includes "wall"
    expect(entityMatchesSlotTags(torchTags, ['ship'], ['wall'])).toBe(false);
  });

  it('candle (no wall tag) matches floor slot, not wall slot', () => {
    const candleTags = ['ship'];
    // Wall slot: requiredTags includes "wall"
    expect(entityMatchesSlotTags(candleTags, ['wall', 'ship'])).toBe(false);
    // Floor slot: forbiddenTags includes "wall"
    expect(entityMatchesSlotTags(candleTags, ['ship'], ['wall'])).toBe(true);
  });
});
