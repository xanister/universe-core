/**
 * World Bible Matcher
 *
 * Matches world bible children to layout slots using LLM-ranked assignment.
 * Used during place generation to give WB-described places priority on
 * layout template slots, with remaining slots filled generically.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { WorldBible, WorldBiblePlaceRef, GeneratedSlot } from '@dmnpc/types/world';

/**
 * Get world bible children whose parentName matches the given parent place name.
 * Uses case-insensitive comparison. "Cosmos" and "Root" are treated as sentinel
 * values meaning "child of the root place" — callers should pass the root label.
 */
export function getWorldBibleChildrenOf(
  worldBible: WorldBible,
  parentPlaceName: string,
): WorldBiblePlaceRef[] {
  const normalizedParent = parentPlaceName.toLowerCase();
  return worldBible.places.filter((p) => {
    const pn = p.parentName.toLowerCase();
    if (pn === normalizedParent) return true;
    if ((pn === 'cosmos' || pn === 'root') && normalizedParent === parentPlaceName.toLowerCase()) {
      return false;
    }
    return false;
  });
}

/**
 * Get all world bible children whose parentName matches the given name,
 * including those with "Cosmos" or "Root" sentinel when the parent IS the root.
 */
export function getWorldBibleChildrenOfRoot(
  worldBible: WorldBible,
  rootLabel: string,
): WorldBiblePlaceRef[] {
  const normalizedRoot = rootLabel.toLowerCase();
  return worldBible.places.filter((p) => {
    const pn = p.parentName.toLowerCase();
    return pn === normalizedRoot || pn === 'cosmos' || pn === 'root';
  });
}

export interface SlotMatch {
  wbPlace: WorldBiblePlaceRef;
  slotIndex: number;
}

export interface MatchChildrenToSlotsResult {
  matched: SlotMatch[];
  unmatchedChildren: WorldBiblePlaceRef[];
  unmatchedSlots: number[];
}

/**
 * Match WB children to layout slots using LLM-ranked assignment.
 *
 * When there are no WB children, returns all slots as unmatched (fast path).
 * Otherwise, makes a single LLM call to intelligently assign children to
 * slots based on purpose, description, and geographic context.
 */
export async function matchChildrenToSlots(
  wbChildren: WorldBiblePlaceRef[],
  slots: GeneratedSlot[],
  parentContext: string,
): Promise<MatchChildrenToSlotsResult> {
  const allSlotIndices = slots.map((_, i) => i);

  if (wbChildren.length === 0) {
    return {
      matched: [],
      unmatchedChildren: [],
      unmatchedSlots: allSlotIndices,
    };
  }

  const childDescriptions = wbChildren
    .map((c, i) => `  [child_${i}] "${c.name}" (purpose: ${c.purpose}): ${c.description}`)
    .join('\n');

  const slotDescriptions = slots
    .map(
      (s, i) =>
        `  [slot_${i}] purpose: ${s.purpose}, position: (${s.x}, ${s.y}), size: ${s.width}x${s.height}`,
    )
    .join('\n');

  interface MatchResult {
    matches: Array<{ childIndex: number; slotIndex: number }>;
  }

  const result = await queryLlm<MatchResult>({
    system: `You are matching world-bible-described places to layout template slots.

Each slot has a purpose (e.g., "tavern", "forest", "harbor") and each world bible child has a purpose and description. Match children to slots where the purposes are compatible or the child naturally fits the slot's role.

Rules:
- A child can match at most one slot, and a slot can be claimed by at most one child.
- Prefer exact purpose matches (e.g., child purpose "tavern" → slot purpose "tavern").
- Allow reasonable purpose mapping (e.g., child purpose "harbor" → slot purpose "harbor").
- If a child's purpose has no compatible slot, leave it unmatched (it will be created at a generic position).
- If a slot has no compatible child, leave it unmatched (it will be filled generically).
- Return ONLY matches you are confident about.`,
    prompt: `Parent context: ${parentContext}

World Bible children:
${childDescriptions}

Available layout slots:
${slotDescriptions}

Return the best matches.`,
    complexity: 'simple',
    context: 'WB Slot Matching',
    schema: {
      name: 'wb_slot_matching',
      schema: {
        type: 'object',
        properties: {
          matches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                childIndex: {
                  type: 'number',
                  description: 'Index of the world bible child (child_N)',
                },
                slotIndex: {
                  type: 'number',
                  description: 'Index of the layout slot (slot_N)',
                },
              },
              required: ['childIndex', 'slotIndex'],
              additionalProperties: false,
            },
          },
        },
        required: ['matches'],
        additionalProperties: false,
      },
    },
  });

  const rawMatches = result.content.matches;
  const usedChildren = new Set<number>();
  const usedSlots = new Set<number>();
  const matched: SlotMatch[] = [];

  for (const m of rawMatches) {
    if (
      m.childIndex < 0 ||
      m.childIndex >= wbChildren.length ||
      m.slotIndex < 0 ||
      m.slotIndex >= slots.length
    ) {
      continue;
    }
    if (usedChildren.has(m.childIndex) || usedSlots.has(m.slotIndex)) {
      continue;
    }
    usedChildren.add(m.childIndex);
    usedSlots.add(m.slotIndex);
    matched.push({ wbPlace: wbChildren[m.childIndex], slotIndex: m.slotIndex });
  }

  const unmatchedChildren = wbChildren.filter((_, i) => !usedChildren.has(i));
  const unmatchedSlots = allSlotIndices.filter((i) => !usedSlots.has(i));

  logger.info(
    'WBSlotMatcher',
    `Matched ${matched.length} WB children to slots, ${unmatchedChildren.length} unmatched children, ${unmatchedSlots.length} unmatched slots`,
  );

  return { matched, unmatchedChildren, unmatchedSlots };
}
