/**
 * Surface placement algorithm
 *
 * Places small decorative objects on top of already-placed furniture slots
 * (tables, altars, shelves, counters). Reads ctx.placedSlots to locate
 * furniture matching nearPurpose, then distributes up to `max` surface items
 * across available furniture positions via round-robin with random positioning
 * within each furniture footprint.
 *
 * Key properties:
 * - Reads ctx.placedSlots (live array grown by generator.ts after each algorithm).
 * - Must run last: generator sort assigns priority 2 so all furniture is placed first.
 * - Does NOT call occupy() — surface items share tile space with furniture.
 * - Always emits layer: 'default' (same depth as furniture, above floor layer).
 * - Uses nearPurpose to identify the target furniture purpose.
 */

import { randomIntWithRng } from '@dmnpc/core/infra/random-utils.js';
import { createRng } from './placement-utils.js';
import {
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
} from './algorithm-types.js';
import { getRandomSupportedFacing } from '../object-catalog.js';

export const onSurfacePlacement: PlacementAlgorithmFn = (
  ctx: PlacementContext,
): PositionedSlot[] => {
  const { slots, seed, placedSlots } = ctx;
  const rng = createRng(seed);
  const positioned: PositionedSlot[] = [];

  for (const slot of slots) {
    const nearPurpose = slot.nearPurpose;
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;

    const anchors = nearPurpose ? placedSlots.filter((ps) => ps.slot.purpose === nearPurpose) : [];

    if (anchors.length === 0) {
      if (min > 0) {
        throw new Error(
          `Cannot place required on_surface slot (purpose: ${slot.purpose}): ` +
            (nearPurpose
              ? `no placed slot with purpose "${nearPurpose}" found. ` +
                `Ensure the furniture slot appears earlier in the template ` +
                `and on_surface runs after all floor algorithms.`
              : `nearPurpose is null — on_surface slots must specify a nearPurpose.`),
        );
      }
      continue;
    }

    for (let i = 0; i < max; i++) {
      // Round-robin across anchor furniture pieces so items spread evenly.
      const anchor = anchors[i % anchors.length];

      // Pick a random tile within the furniture footprint.
      const x = anchor.width > 1 ? anchor.x + randomIntWithRng(rng, 0, anchor.width - 1) : anchor.x;
      const y =
        anchor.height > 1 ? anchor.y + randomIntWithRng(rng, 0, anchor.height - 1) : anchor.y;

      const facing = getRandomSupportedFacing(slot.purpose, rng, slot.requiredTags ?? undefined);

      positioned.push({
        slot,
        x,
        y,
        width: 1,
        height: 1,
        facing,
        layer: 'default',
      });
      // Intentionally no occupy() call — surface items share tile space with furniture.
    }
  }

  return positioned;
};
