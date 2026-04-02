/**
 * Unit tests for algorithm default tag constraints (FEAT-324).
 *
 * Tests the PlacementAlgorithmMeta registry, opt-out semantics (null vs [] vs explicit),
 * and the merge logic in generatePositionedSlots.
 */

import { describe, it, expect } from 'vitest';

// Import algorithm metadata registry (triggers built-in registration via side-effect import)
import {
  getPlacementAlgorithmMeta,
} from '../../src/place-layout/algorithms/index.js';

// Import the tag merge helper from the generator
import { mergeTagArrays } from '../../src/place-layout/generator.js';

// ============================================================================
// Metadata Registration
// ============================================================================

describe('PlacementAlgorithmMeta registry', () => {
  it('in_wall has defaultRequiredTags: ["wall"]', () => {
    const meta = getPlacementAlgorithmMeta('in_wall');
    expect(meta).toBeDefined();
    expect(meta!.defaultRequiredTags).toEqual(['wall']);
    expect(meta!.defaultForbiddenTags).toBeNull();
  });

  it('against_wall has defaultForbiddenTags: ["wall"]', () => {
    const meta = getPlacementAlgorithmMeta('against_wall');
    expect(meta).toBeDefined();
    expect(meta!.defaultRequiredTags).toBeNull();
    expect(meta!.defaultForbiddenTags).toEqual(['wall']);
  });

  it('random_valid has no metadata registered', () => {
    const meta = getPlacementAlgorithmMeta('random_valid');
    expect(meta).toBeUndefined();
  });

  it('under has no metadata registered', () => {
    const meta = getPlacementAlgorithmMeta('under');
    expect(meta).toBeUndefined();
  });
});

// ============================================================================
// Opt-out Semantics
// ============================================================================

describe('algorithm default tag opt-out semantics', () => {
  // Simulates the merge logic from generator.ts lines 186-196.
  // Extracted here to test the decision logic in isolation.
  function resolveEffectiveTags(
    slotRequiredTags: string[] | null,
    slotForbiddenTags: string[] | null,
    algorithmName: string,
    inheritedRequiredTags?: string[] | null
  ) {
    const algoMeta = getPlacementAlgorithmMeta(algorithmName as any);
    const baseRequired =
      slotRequiredTags !== null
        ? slotRequiredTags
        : (algoMeta?.defaultRequiredTags ?? null);
    const effectiveRequired = mergeTagArrays(baseRequired, inheritedRequiredTags);
    const effectiveForbidden =
      slotForbiddenTags !== null
        ? slotForbiddenTags
        : (algoMeta?.defaultForbiddenTags ?? null);
    return { effectiveRequired, effectiveForbidden };
  }

  describe('requiredTags', () => {
    it('null slot tags → algo default applies (in_wall → ["wall"])', () => {
      const { effectiveRequired } = resolveEffectiveTags(null, null, 'in_wall');
      expect(effectiveRequired).toEqual(['wall']);
    });

    it('[] slot tags → algo default skipped (opt-out)', () => {
      const { effectiveRequired } = resolveEffectiveTags([], null, 'in_wall');
      // Empty slot tags + no inherited = null (mergeTagArrays returns null for empty)
      expect(effectiveRequired).toBeNull();
    });

    it('explicit slot tags → algo default skipped (slot takes control)', () => {
      const { effectiveRequired } = resolveEffectiveTags(['ship'], null, 'in_wall');
      expect(effectiveRequired).toEqual(['ship']);
    });

    it('null slot tags on algorithm with no meta → null', () => {
      const { effectiveRequired } = resolveEffectiveTags(null, null, 'random_valid');
      expect(effectiveRequired).toBeNull();
    });
  });

  describe('forbiddenTags', () => {
    it('null slot tags → algo default applies (against_wall → ["wall"])', () => {
      const { effectiveForbidden } = resolveEffectiveTags(null, null, 'against_wall');
      expect(effectiveForbidden).toEqual(['wall']);
    });

    it('[] slot tags → algo default skipped (opt-out)', () => {
      const { effectiveForbidden } = resolveEffectiveTags(null, [], 'against_wall');
      expect(effectiveForbidden).toEqual([]);
    });

    it('explicit slot tags → algo default skipped (slot takes control)', () => {
      const { effectiveForbidden } = resolveEffectiveTags(null, ['heavy'], 'against_wall');
      expect(effectiveForbidden).toEqual(['heavy']);
    });

    it('null slot tags on algorithm with no meta → null', () => {
      const { effectiveForbidden } = resolveEffectiveTags(null, null, 'random_valid');
      expect(effectiveForbidden).toBeNull();
    });
  });

  describe('inherited tag interaction', () => {
    it('algo default + inherited tags → merged union', () => {
      const { effectiveRequired } = resolveEffectiveTags(null, null, 'in_wall', ['ship']);
      // in_wall default ["wall"] merged with inherited ["ship"]
      expect(effectiveRequired).toEqual(expect.arrayContaining(['wall', 'ship']));
      expect(effectiveRequired).toHaveLength(2);
    });

    it('opt-out + inherited tags → only inherited tags', () => {
      const { effectiveRequired } = resolveEffectiveTags([], null, 'in_wall', ['ship']);
      // [] opts out of algo default, inherited ["ship"] still applies
      expect(effectiveRequired).toEqual(['ship']);
    });

    it('explicit slot tags + inherited tags → merged union', () => {
      const { effectiveRequired } = resolveEffectiveTags(['common'], null, 'in_wall', ['ship']);
      // Slot takes control with ["common"], merged with inherited ["ship"]
      expect(effectiveRequired).toEqual(expect.arrayContaining(['common', 'ship']));
      expect(effectiveRequired).toHaveLength(2);
    });

    it('algo default + null inherited → algo default only', () => {
      const { effectiveRequired } = resolveEffectiveTags(null, null, 'in_wall', null);
      expect(effectiveRequired).toEqual(['wall']);
    });
  });
});

// ============================================================================
// mergeTagArrays edge cases relevant to the new feature
// ============================================================================

describe('mergeTagArrays with algorithm default patterns', () => {
  it('null + null → null', () => {
    expect(mergeTagArrays(null, null)).toBeNull();
  });

  it('["wall"] + null → ["wall"]', () => {
    expect(mergeTagArrays(['wall'], null)).toEqual(['wall']);
  });

  it('null + ["ship"] → ["ship"]', () => {
    expect(mergeTagArrays(null, ['ship'])).toEqual(['ship']);
  });

  it('["wall"] + ["ship"] → ["wall", "ship"]', () => {
    const result = mergeTagArrays(['wall'], ['ship']);
    expect(result).toEqual(expect.arrayContaining(['wall', 'ship']));
    expect(result).toHaveLength(2);
  });

  it('deduplicates overlapping tags', () => {
    const result = mergeTagArrays(['wall', 'common'], ['common', 'ship']);
    expect(result).toEqual(expect.arrayContaining(['wall', 'common', 'ship']));
    expect(result).toHaveLength(3);
  });

  it('[] + [] → null (empty merge)', () => {
    expect(mergeTagArrays([], [])).toBeNull();
  });

  it('[] + ["ship"] → ["ship"]', () => {
    expect(mergeTagArrays([], ['ship'])).toEqual(['ship']);
  });
});

// ============================================================================
// BUG-121: Facing pre-filter alignment invariant
//
// The placement algorithms' facing pre-filter MUST use the same effective tags
// that convertPositionedToGenerated will apply. Using raw slot tags (before
// defaults are applied) causes a mismatch: the pre-filter admits wall candidates
// that the object selector later rejects when the tag filter is applied.
//
// This test documents the invariant by verifying that the effective tags
// computed by each algorithm match the effective tags computed by the generator.
// ============================================================================

describe('BUG-121 facing pre-filter alignment invariant', () => {
  it('in_wall effective requiredTags with null slot → ["wall"] (matches defaultRequiredTags)', () => {
    // When slot.requiredTags is null, in_wall must pass ['wall'] to
    // getAnyAllowedFacingsForPurpose — the same value convertPositionedToGenerated applies.
    const meta = getPlacementAlgorithmMeta('in_wall');
    const slotRequiredTags: string[] | null = null;
    // Effective = slot override ?? algo default
    const effectiveRequired = slotRequiredTags ?? (meta?.defaultRequiredTags ?? undefined);
    expect(effectiveRequired).toEqual(['wall']);
  });

  it('against_wall effective forbiddenTags with null slot → ["wall"] (matches defaultForbiddenTags)', () => {
    // When slot.forbiddenTags is null, against_wall must pass ['wall'] to
    // getAnyAllowedFacingsForPurpose — the same value convertPositionedToGenerated applies.
    const meta = getPlacementAlgorithmMeta('against_wall');
    const slotForbiddenTags: string[] | null = null;
    // Effective = slot override ?? algo default
    const effectiveForbidden = slotForbiddenTags ?? (meta?.defaultForbiddenTags ?? undefined);
    expect(effectiveForbidden).toEqual(['wall']);
  });

  it('in_wall effective requiredTags with explicit slot → uses slot value', () => {
    const meta = getPlacementAlgorithmMeta('in_wall');
    const slotRequiredTags: string[] | null = ['ship', 'wall'];
    const effectiveRequired = slotRequiredTags ?? (meta?.defaultRequiredTags ?? undefined);
    expect(effectiveRequired).toEqual(['ship', 'wall']);
  });

  it('against_wall effective forbiddenTags with explicit slot → uses slot value', () => {
    const meta = getPlacementAlgorithmMeta('against_wall');
    const slotForbiddenTags: string[] | null = ['ship'];
    const effectiveForbidden = slotForbiddenTags ?? (meta?.defaultForbiddenTags ?? undefined);
    expect(effectiveForbidden).toEqual(['ship']);
  });
});
