/**
 * Connectivity Simulation (FEAT-438)
 *
 * Monte Carlo connectivity analysis for layout variants.
 * Used by the layout editor to warn authors when required slot placements
 * are likely to produce disconnected walkable regions.
 *
 * Does NOT use UniverseContext, PlaceContext, or LLM — only the variant
 * definition and static data files.
 */

import type { LayoutVariant, ConnectivityWarning, ConnectivitySimResult } from '@dmnpc/types/world';
import { generateShapeFromTemplate } from './layers/shape-generator.js';
import { resolveSlotSizes } from './generator.js';
import { validateFloorConnectivity } from './connectivity.js';

export type { ConnectivityWarning, ConnectivitySimResult };

// ============================================================================
// Simulation
// ============================================================================

const LOW_WALKABLE_RATIO_THRESHOLD = 0.15;
const FAILURE_RATE_ERROR_THRESHOLD = 0.1;

/**
 * Run N shape+slot-placement simulations for a layout variant and return
 * aggregated connectivity analysis.
 *
 * Per run:
 *  1. Generate a floor shape using the variant's terrain layers + dimension ranges.
 *  2. Resolve slot sizes (with 1×1 fallback for missing place-category templates).
 *  3. Scatter required slots (min > 0) at random walkable positions.
 *  4. Run validateFloorConnectivity() and record pass/fail.
 *
 * @param variant The layout variant to simulate.
 * @param runs    Number of runs (0–20). Default 5.
 */
export function simulateVariantConnectivity(
  variant: LayoutVariant,
  runs: number = 5,
): ConnectivitySimResult {
  if (runs === 0) {
    return {
      variantId: variant.id,
      connected: true,
      failureRate: 0,
      warnings: [],
      runsCompleted: 0,
      skippedRunCount: 0,
    };
  }

  const clampedRuns = Math.min(Math.max(runs, 1), 20);

  let failCount = 0;
  let checkedRuns = 0;
  let skippedRunCount = 0;
  let worstComponentCount = 1;
  let lowestWalkableRatio = 1;

  // Resolve slot sizes once — independent of shape, same for every run.
  // Falls back to 1×1 per-slot for place-category throws.
  const resolvedSlots = resolveSlotsWithFallback(variant);
  const requiredSlots = resolvedSlots.filter((s) => (s.min ?? 0) > 0);

  for (let i = 0; i < clampedRuns; i++) {
    const seed = lcgNext(Date.now() + i * 2654435761);

    let shape;
    try {
      shape = generateShapeFromTemplate(variant, 0, 0, seed);
    } catch {
      // Shape generation failed for this seed (e.g. degenerate dimensions) — skip run.
      continue;
    }

    const { width, height } = shape.bounds;

    // Mirror the generator's baseline check: if the raw terrain is already
    // fragmented (outdoor layouts — forests, caves, ruins), connectivity
    // enforcement is skipped at runtime, so skip the failure count here too.
    const baselineResult = validateFloorConnectivity(shape.blockedMask, new Set(), width, height);
    if (!baselineResult.connected) {
      skippedRunCount++;
      continue;
    }

    const occupiedTiles = new Set<string>();

    // Scatter each required slot's footprint at random walkable positions.
    for (const slot of requiredSlots) {
      const count = slot.min ?? 1;
      const slotW = slot.slotSize?.width ?? 1;
      const slotH = slot.slotSize?.height ?? 1;
      for (let n = 0; n < count; n++) {
        placeSlotRandom(shape.blockedMask, occupiedTiles, width, height, slotW, slotH, seed + n);
      }
    }

    const result = validateFloorConnectivity(shape.blockedMask, occupiedTiles, width, height);

    checkedRuns++;
    if (!result.connected) failCount++;

    if (result.componentCount > worstComponentCount) worstComponentCount = result.componentCount;

    const total = width * height;
    const ratio = total > 0 ? result.totalWalkable / total : 0;
    if (ratio < lowestWalkableRatio) lowestWalkableRatio = ratio;
  }

  const failureRate = checkedRuns > 0 ? failCount / checkedRuns : 0;
  const warnings = buildWarnings(failureRate, worstComponentCount, lowestWalkableRatio);

  return {
    variantId: variant.id,
    connected: warnings.every((w) => w.severity !== 'error'),
    failureRate,
    warnings,
    runsCompleted: checkedRuns,
    skippedRunCount,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve slot sizes for simulation, falling back to 1×1 for any slot
 * whose place-category template or sprite is missing (common during authoring).
 */
function resolveSlotsWithFallback(
  variant: LayoutVariant,
): import('@dmnpc/types/world').LayoutSlot[] {
  try {
    return resolveSlotSizes(variant.slots);
  } catch {
    // At least one place-category slot threw — resolve slot-by-slot.
    return variant.slots.map((slot) => {
      if (slot.slotSize) return slot;
      try {
        return resolveSlotSizes([slot])[0];
      } catch {
        return { ...slot, slotSize: { width: 1, height: 1 } };
      }
    });
  }
}

/**
 * Place a slot footprint at a random walkable position in the shape.
 * Skips placement silently if no valid position is found after N attempts.
 */
function placeSlotRandom(
  blockedMask: boolean[][],
  occupiedTiles: Set<string>,
  width: number,
  height: number,
  slotW: number,
  slotH: number,
  seed: number,
): void {
  const maxAttempts = 50;
  let rng = seed;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    rng = lcgNext(rng);
    const x = rng % Math.max(1, width - slotW + 1);
    rng = lcgNext(rng);
    const y = rng % Math.max(1, height - slotH + 1);

    if (isFootprintClear(blockedMask, occupiedTiles, x, y, slotW, slotH, width, height)) {
      for (let dy = 0; dy < slotH; dy++) {
        for (let dx = 0; dx < slotW; dx++) {
          occupiedTiles.add(`${x + dx},${y + dy}`);
        }
      }
      return;
    }
  }
  // No valid position found — skip this slot (connectivity check runs anyway).
}

function isFootprintClear(
  blockedMask: boolean[][],
  occupiedTiles: Set<string>,
  x: number,
  y: number,
  slotW: number,
  slotH: number,
  width: number,
  height: number,
): boolean {
  for (let dy = 0; dy < slotH; dy++) {
    for (let dx = 0; dx < slotW; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= width || ny >= height) return false;
      if (blockedMask[ny]?.[nx]) return false;
      if (occupiedTiles.has(`${nx},${ny}`)) return false;
    }
  }
  return true;
}

function buildWarnings(
  failureRate: number,
  worstComponentCount: number,
  lowestWalkableRatio: number,
): ConnectivityWarning[] {
  const warnings: ConnectivityWarning[] = [];

  if (lowestWalkableRatio === 0) {
    warnings.push({
      code: 'no_walkable_tiles',
      severity: 'error',
      message: 'No walkable tiles were generated — check terrain layer configuration.',
    });
    return warnings;
  }

  if (failureRate >= FAILURE_RATE_ERROR_THRESHOLD) {
    const pct = Math.round(failureRate * 100);
    warnings.push({
      code: 'disconnected_components',
      severity: 'error',
      message: `Required slots disconnect the floor in ${pct}% of simulations — the generator will fail or prune slots.`,
      detail: { failureRatePct: pct, worstComponentCount },
    });
  }

  if (lowestWalkableRatio < LOW_WALKABLE_RATIO_THRESHOLD) {
    const pct = Math.round(lowestWalkableRatio * 100);
    warnings.push({
      code: 'low_walkable_ratio',
      severity: 'warning',
      message: `As little as ${pct}% of the floor is walkable at minimum dimensions — characters may have very limited movement.`,
      detail: { lowestWalkableRatioPct: pct },
    });
  }

  return warnings;
}

/** Linear congruential generator step. Returns a non-negative integer. */
function lcgNext(seed: number): number {
  return (seed * 1103515245 + 12345) & 0x7fffffff;
}
