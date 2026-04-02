/**
 * Object Generator
 *
 * Generates Object entities including exits.
 * Exits are one-way from child to parent place.
 * The target is derived from the place hierarchy.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import {
  mapPositionToWorld,
  getPlaceInnerDimensions,
} from '@dmnpc/core/entities/position-utils.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { ObjectEntity, ObjectInfo, Place } from '@dmnpc/types/entity';
import { isEnclosed } from '@dmnpc/types/world';
// Note: Sprite resolution happens at runtime via object-sprite-resolver.ts

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for generating an exit object.
 * The target place is derived from the hierarchy (placeId's parent).
 */
export interface GenerateExitParams {
  /** ID of the place where this exit is located (target = this place's parent) */
  placeId: string;
  /**
   * Name for the exit. Defaults to targetPlace.label (where it goes).
   * Only override for special cases like "Back Door" or "Secret Passage".
   */
  label?: string;
  /** Additional description for the exit */
  description?: string;
  /**
   * Visual style of the exit: "door", "stairs", "archway", "gate", etc.
   * Determines the sprite used for rendering. Not a type-level constraint.
   * Defaults to "door" for interior places, "archway" for exterior places.
   */
  exitType?: string;
  /** Optional direction hint: "north", "up", "down", "back", etc. */
  direction?: string;
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate an exit object ID from source place slug and label.
 */
function generateExitObjectId(sourcePlaceId: string, label: string): string {
  const sourceSlug = sourcePlaceId.replace(/^PLACE_/, '').toLowerCase();
  const labelSlug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `OBJ_exit_${sourceSlug}_${labelSlug}`;
}

// ============================================================================
// Position Estimation
// ============================================================================

/**
 * Context for estimating an exit's position on a map.
 */
interface PositionEstimationContext {
  label: string;
  exitType: string;
  direction?: string;
  sourcePlace: Place;
  existingExits: ObjectEntity[];
}

/**
 * Estimate an exit's position within its source place using LLM.
 * Returns normalized 0-1 coordinates based on contextual hints.
 */
async function estimateExitPosition(
  ctx: PositionEstimationContext,
): Promise<{ x: number; y: number }> {
  const { label, exitType, direction, sourcePlace, existingExits } = ctx;

  // Build context about existing exit positions to avoid clustering
  const { width: placeW, height: placeH } = getPlaceInnerDimensions(sourcePlace);
  const existingPositionsDesc =
    existingExits
      .filter(() => placeW > 0 && placeH > 0)
      .map((e) => {
        const normX = e.position.x / placeW;
        const normY = e.position.y / placeH;
        return `- "${e.label}" (${e.short_description || 'exit'}): approximately (${normX.toFixed(2)}, ${normY.toFixed(2)})`;
      })
      .join('\n') || 'None yet';

  const prompt = `Estimate the position for a new exit on a top-down map.

Place: ${sourcePlace.label}
Place Type: ${sourcePlace.info.environment.type}
Place Description: ${sourcePlace.description || 'No description'}

New Exit:
- Label: "${label}"
- Exit Type: ${exitType}
- Direction Hint: ${direction || 'none provided'}

Existing Exits (avoid placing near these):
${existingPositionsDesc}

COORDINATE SYSTEM:
- x=0.0 is the LEFT edge, x=1.0 is the RIGHT edge
- y=0.0 is the TOP edge, y=1.0 is the BOTTOM edge
- For compass directions: north=top (low y), south=bottom (high y), west=left (low x), east=right (high x)
- For vertical: up=top (low y), down=bottom (high y)

Based on the exit's label, type, and direction hint, estimate where this exit would logically appear on the map.
Place exits along the edges (near 0.1 or 0.9) rather than in the center unless it's a central feature.
Avoid clustering multiple exits in the same area.`;

  try {
    const result = await queryLlm<{ x: number; y: number; reasoning: string }>({
      system: `You are a map layout assistant. Estimate logical positions for exits on a top-down map based on their labels, types, and directional hints. Return normalized 0-1 coordinates.`,
      prompt,
      complexity: 'reasoning', // gpt-5.2 for reliable structured outputs
      context: 'ExitPositionEstimation',
      schema: {
        name: 'exit_position',
        schema: {
          type: 'object',
          properties: {
            x: {
              type: 'number',
              description: 'X coordinate (0.0 = left edge, 1.0 = right edge)',
            },
            y: {
              type: 'number',
              description: 'Y coordinate (0.0 = top edge, 1.0 = bottom edge)',
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation (max 200 chars) of why this position was chosen',
            },
          },
          required: ['x', 'y', 'reasoning'],
          additionalProperties: false,
        },
      },
    });

    // Clamp values to valid range
    const x = Math.max(0.05, Math.min(0.95, result.content.x));
    const y = Math.max(0.05, Math.min(0.95, result.content.y));

    logger.info(
      'ObjectGenerator',
      `Estimated position for exit "${label}": (${x.toFixed(2)}, ${y.toFixed(2)}) - ${result.content.reasoning}`,
    );

    return { x, y };
  } catch (error) {
    logger.error(
      'ObjectGenerator',
      `Failed to estimate position for exit "${label}", using fallback`,
      { error: error instanceof Error ? error.message : String(error) },
    );

    return getDirectionBasedFallback(direction, existingExits, sourcePlace);
  }
}

/**
 * Generate a fallback position based on direction hint.
 */
function getDirectionBasedFallback(
  direction: string | undefined,
  existingExits: ObjectEntity[],
  sourcePlace: Place,
): { x: number; y: number } {
  const directionDefaults: Record<string, { x: number; y: number }> = {
    north: { x: 0.5, y: 0.1 },
    south: { x: 0.5, y: 0.9 },
    east: { x: 0.9, y: 0.5 },
    west: { x: 0.1, y: 0.5 },
    up: { x: 0.5, y: 0.1 },
    down: { x: 0.5, y: 0.9 },
    back: { x: 0.5, y: 0.9 },
    front: { x: 0.5, y: 0.1 },
    outside: { x: 0.5, y: 0.9 },
  };

  const normalizedDir = direction?.toLowerCase();
  let basePosition = normalizedDir ? directionDefaults[normalizedDir] : { x: 0.5, y: 0.5 };

  // Jitter position slightly if it would overlap with existing exit
  const { width: placeWidth, height: placeHeight } = getPlaceInnerDimensions(sourcePlace);
  for (const exit of existingExits) {
    if (placeWidth > 0 && placeHeight > 0) {
      const normX = exit.position.x / placeWidth;
      const normY = exit.position.y / placeHeight;
      const dist = Math.sqrt((normX - basePosition.x) ** 2 + (normY - basePosition.y) ** 2);
      if (dist < 0.15) {
        basePosition = {
          x: Math.max(0.05, Math.min(0.95, basePosition.x + (Math.random() - 0.5) * 0.2)),
          y: Math.max(0.05, Math.min(0.95, basePosition.y + (Math.random() - 0.5) * 0.2)),
        };
      }
    }
  }

  return basePosition;
}

// ============================================================================
// Exit Object Generation
// ============================================================================

/**
 * Get all exit objects from a place.
 * Exits are objects with purpose === 'exit'.
 */
function getExitsFromPlace(ctx: UniverseContext, placeId: string): ObjectEntity[] {
  return ctx.objects.filter(
    (obj) => obj.info.purpose === 'exit' && obj.position.parent === placeId,
  );
}

/**
 * Generate a new exit object and update the provided universe context.
 *
 * Exit naming convention: label = target place label (where it goes).
 * Exit type convention: "door" for interior places, "archway" for exterior.
 *
 * Exits are one-way from child to parent:
 * - The exit lives in placeId (becomes position.parent)
 * - The target is placeId's parent (derived from hierarchy)
 *
 * @throws Error if place not found, has no parent, or exit already exists
 */
export async function generateExitObject(
  ctx: UniverseContext,
  params: GenerateExitParams,
): Promise<ObjectEntity> {
  const { placeId, direction } = params;

  // Get the source place
  const sourcePlace = ctx.getPlace(placeId);

  // Derive target from hierarchy (source place's parent)
  const targetPlaceId = sourcePlace.position.parent;
  if (!targetPlaceId) {
    throw new Error(`Cannot create exit: place ${placeId} has no parent in hierarchy`);
  }

  const targetPlace = ctx.findPlace(targetPlaceId);
  if (!targetPlace) {
    throw new Error(`Cannot create exit: parent place ${targetPlaceId} not found`);
  }

  // Apply defaults
  const label = params.label ?? targetPlace.label;
  const exitType: string =
    params.exitType ?? (isEnclosed(sourcePlace.info.environment) ? 'door' : 'archway');
  const description =
    params.description ??
    `${exitType.charAt(0).toUpperCase() + exitType.slice(1)} to ${targetPlace.label}`;

  logger.info(
    'ObjectGenerator',
    `Generating exit "${label}" (${exitType}) from ${placeId} -> ${targetPlaceId}${direction ? ` direction: ${direction}` : ''}`,
  );

  // Check for duplicate exits (all exits in this place lead to the same target - the parent)
  const existingExits = getExitsFromPlace(ctx, placeId);
  const normalizedLabel = label.toLowerCase().trim();

  const duplicate = existingExits.find((e) => e.label.toLowerCase().trim() === normalizedLabel);

  if (duplicate) {
    logger.info(
      'ObjectGenerator',
      `Exit already exists: ${duplicate.id} from ${sourcePlace.label} to ${targetPlace.label}`,
    );
    return duplicate;
  }

  // Generate exit ID
  const exitId = generateExitObjectId(placeId, label);

  // Check if this exact exit ID already exists
  if (existingExits.some((e) => e.id === exitId)) {
    const existing = existingExits.find((e) => e.id === exitId)!;
    logger.info('ObjectGenerator', `Exit ${exitId} already exists`);
    return existing;
  }

  // Resolve exit sprite from exitType. This path is used by callers outside the
  // slot system (integrity validators, agent service). Slot-created exits get
  // their sprite from the catalog entity selected during layout generation.
  const exitEntityMap: Record<string, string> = {
    door: 'door_wooden',
    archway: 'archway',
    gate: 'gate',
    stairs: 'stairs_up',
    ladder: 'ladder',
    trapdoor: 'trapdoor',
    teleporter: 'teleporter',
    passage: 'secret_passage',
  };
  const exitEntityId = exitEntityMap[exitType] || 'door_wooden';

  // Build object info with required fields
  const objectInfo: ObjectInfo = {
    purpose: 'exit',
    solid: true, // Exits block movement - player must interact to pass through
    layer: 'default',
    isStructural: false,
    material: null,
    tint: null,
    spriteConfig: { spriteId: exitEntityId, frame: null, animationKey: null, animated: false },
    hp: null,
    maxHp: null,
    state: null,
    contents: null,
    lightSource: null,
    itemId: null,
    plotId: null,
  };

  // Estimate exit position
  const { width: sourcePlaceWidth, height: sourcePlaceHeight } =
    getPlaceInnerDimensions(sourcePlace);

  const estimatedPosition = await estimateExitPosition({
    label,
    exitType,
    direction,
    sourcePlace,
    existingExits,
  });

  const placeSize = {
    width: sourcePlaceWidth,
    height: sourcePlaceHeight,
  };
  const worldPos = mapPositionToWorld(estimatedPosition.x, estimatedPosition.y, placeSize);
  const positionX = worldPos.x;
  const positionY = worldPos.y;

  const exitEntity: ObjectEntity = {
    id: exitId,
    label,
    description,
    short_description: exitType,
    tags: [],
    entityType: 'object',
    info: objectInfo,
    position: {
      x: positionX,
      y: positionY,
      width: 32,
      height: 32,
      parent: placeId,
    },
    important: false,
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    relationships: [],
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction: { typeId: 'enter' },
  };

  // Save the exit entity
  ctx.upsertEntity('object', exitEntity);

  logger.info(
    'ObjectGenerator',
    `Exit created: ${exitId} "${label}" (${exitType}) from ${sourcePlace.label} -> ${targetPlace.label}`,
  );

  return exitEntity;
}

// ============================================================================
// Hierarchy Utilities
// ============================================================================

/**
 * Find the lowest common regional ancestor of two places.
 * A regional place is one with a large scale (miles, kilometers, au, lightyears).
 *
 * @param ctx - Universe context
 * @param placeA - First place
 * @param placeB - Second place
 * @returns The common region place, or null if none found
 */
export function findCommonRegionAncestor(
  ctx: UniverseContext,
  placeA: Place,
  placeB: Place,
): Place | null {
  const LARGE_SCALE_UNITS = ['miles', 'kilometers', 'au', 'lightyears'];

  // Build set of all large-scale ancestors of placeA (regional places)
  const ancestorsA = new Set<string>();
  let current: Place | null = placeA;

  while (current) {
    if (LARGE_SCALE_UNITS.includes(current.info.scale)) {
      ancestorsA.add(current.id);
    }
    current = current.position.parent ? (ctx.findPlace(current.position.parent) ?? null) : null;
  }

  // Walk up placeB's ancestry and find first match
  current = placeB;
  while (current) {
    if (LARGE_SCALE_UNITS.includes(current.info.scale) && ancestorsA.has(current.id)) {
      return current;
    }
    current = current.position.parent ? (ctx.findPlace(current.position.parent) ?? null) : null;
  }

  return null;
}
