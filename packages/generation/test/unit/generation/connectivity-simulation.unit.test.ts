/**
 * Unit tests for connectivity simulation (FEAT-438).
 *
 * Tests simulateVariantConnectivity() in isolation. These tests build minimal
 * LayoutVariant fixtures with rectangle terrain layers so no object catalog or
 * layout template data is needed for shape generation.
 */

import { describe, it, expect } from 'vitest';
import { simulateVariantConnectivity } from '@dmnpc/generation/place-layout/connectivity-simulation.js';
import type { LayoutVariant, LayoutSlot, NoisePatchLayerConfig } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// ============================================================================
// Helpers
// ============================================================================

function createSlot(overrides: Partial<LayoutSlot> = {}): LayoutSlot {
  return {
    purpose: 'decoration',
    positionAlgorithm: 'random_valid',
    distribution: 'even',
    requiredTags: null,
    forbiddenTags: null,
    inheritableTags: null,
    min: null,
    max: 1,
    nearPurpose: null,
    slotSize: null,
    ...overrides,
  };
}

/** Minimal rectangle variant — no object catalog required for shape generation. */
function createRectVariant(
  widthMin: number,
  widthMax: number,
  heightMin: number,
  heightMax: number,
  slots: LayoutSlot[] = []
): LayoutVariant {
  return {
    id: 'test',
    scale: 'feet',
    environment: {
      type: 'interior',
      hasWeather: false,
      temperature: { enabled: false, base: 18, modifiersApply: false },
      maxDarkness: 0,
    },
    width: { min: widthMin, max: widthMax },
    height: { min: heightMin, max: heightMax },
    terrainLayers: [
      {
        id: 'floor',
        type: 'rectangle',
        tilesetId: 'lpc-interior-floors',
        renderOrder: 0,
        blocking: 'unblocks',
        terrain: 'land',
        procedural: false,
        fill: [0],
        inheritable: false,
      },
    ],
    slots,
    description: 'Test rect variant',
    weight: 1,
    defaultBlocked: true,
  };
}

/**
 * A noise_patch layer that produces highly scattered walkable tiles.
 * noiseScale 0.5 = very fine grain (near-independent neighbor values).
 * threshold 0.7 = ~30% walkable tiles — well below the 2D percolation
 * threshold of ~0.59, so virtually every seed produces disconnected regions.
 */
const SCATTERED_TERRAIN_LAYER: NoisePatchLayerConfig = {
  id: 'scattered',
  tilesetId: 'lpc-interior-floors',
  tilesetOffset: null,
  renderOrder: 0,
  type: 'noise_patch',
  autotilePreset: 'canonical',
  autotileAgainst: [],
  withinTerrain: null,
  shapePreset: 'custom',
  noiseScale: 0.5,
  octaves: 1,
  persistence: 0.5,
  threshold: 0.7,
  edgeBehavior: 'none',
  blocking: 'unblocks',
  terrain: 'land',
  procedural: false,
};

/** Variant with naturally fragmented terrain (outdoor-style). */
function createFragmentedVariant(): LayoutVariant {
  return {
    id: 'fragmented-outdoor',
    scale: 'miles',
    environment: ENVIRONMENT_PRESETS.exterior(),
    width: { min: 40, max: 40 },
    height: { min: 40, max: 40 },
    terrainLayers: [SCATTERED_TERRAIN_LAYER],
    slots: [],
    description: 'Test outdoor variant with naturally fragmented terrain',
    weight: 1,
    defaultBlocked: true,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('simulateVariantConnectivity', () => {
  it('returns runsCompleted:0 and no warnings when runs is 0', () => {
    const variant = createRectVariant(10, 10, 10, 10);
    const result = simulateVariantConnectivity(variant, 0);
    expect(result.runsCompleted).toBe(0);
    expect(result.failureRate).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.connected).toBe(true);
    expect(result.skippedRunCount).toBe(0);
  });

  it('returns failureRate 0 for a 10x10 room with no required slots', () => {
    const variant = createRectVariant(10, 10, 10, 10, [
      createSlot({ purpose: 'decoration', min: null }), // optional — not placed
    ]);
    const result = simulateVariantConnectivity(variant, 5);
    expect(result.failureRate).toBe(0);
    expect(result.connected).toBe(true);
    expect(result.runsCompleted).toBe(5);
  });

  it('returns failureRate > 0 when a full-width required slot blocks the only corridor', () => {
    // A 3-wide corridor. A required slot of width 3 will always block it.
    const variant = createRectVariant(3, 3, 10, 10, [
      createSlot({
        purpose: 'wall',
        positionAlgorithm: 'in_wall',
        min: 1,
        max: 1,
        slotSize: { width: 3, height: 1 },
      }),
    ]);
    const result = simulateVariantConnectivity(variant, 5);
    // The 3-wide slot placed anywhere in a 3-wide corridor partitions it
    expect(result.failureRate).toBeGreaterThan(0);
  });

  it('does not throw when a place-category slot has no matching template', () => {
    // 'nonexistent_place' will cause resolveSlotSizes to throw — simulation catches it
    const variant = createRectVariant(10, 10, 10, 10, [
      createSlot({
        purpose: 'nonexistent_place',
        positionAlgorithm: 'random_valid',
        min: 1,
        max: 1,
        slotSize: null,
      }),
    ]);
    expect(() => simulateVariantConnectivity(variant, 3)).not.toThrow();
    const result = simulateVariantConnectivity(variant, 3);
    expect(result.runsCompleted).toBe(3);
  });

  it('includes variantId in the result', () => {
    const variant = createRectVariant(10, 10, 10, 10);
    variant.id = 'my-variant';
    const result = simulateVariantConnectivity(variant, 1);
    expect(result.variantId).toBe('my-variant');
  });

  it('caps runs at 20 even if a higher value is passed', () => {
    const variant = createRectVariant(10, 10, 10, 10);
    const result = simulateVariantConnectivity(variant, 999);
    expect(result.runsCompleted).toBe(20);
  });

  it('skips fragmented-baseline runs and reports them in skippedRunCount', () => {
    // Outdoor templates (forests, ruins, caves) generate scattered walkable regions
    // before any slots are placed. The generator skips connectivity enforcement for
    // these — simulateVariantConnectivity must apply the same exemption.
    const variant = createFragmentedVariant();
    const result = simulateVariantConnectivity(variant, 5);
    expect(result.skippedRunCount).toBeGreaterThan(0);
    // Skipped runs are exempt from failure counting.
    expect(result.failureRate).toBe(0);
    expect(result.connected).toBe(true);
    // runsCompleted reflects only the slot-placement passes, not skipped runs.
    expect(result.runsCompleted).toBe(0);
  });

  it('sets skippedRunCount 0 for a connected rectangle variant', () => {
    const variant = createRectVariant(10, 10, 10, 10);
    const result = simulateVariantConnectivity(variant, 3);
    expect(result.skippedRunCount).toBe(0);
    expect(result.runsCompleted).toBe(3);
  });
});
