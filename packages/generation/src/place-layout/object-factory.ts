/**
 * Object Factory
 *
 * Creates ObjectEntity instances from placed objects.
 * Uses Entity Registry for entity definitions and defaults.
 */

import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Place, ObjectEntity, ObjectInfo } from '@dmnpc/types/entity';
import type { StagedPlacedObject } from './layers/context-populator.js';
import {
  getEntityDefinition,
  getSpriteDimensions,
  computeWorldPosition,
  getEntityProperties,
  getSpriteDefaultLayer,
  getEntityWallVerticalOffsetPx,
  getEntityDefaultTint,
} from './object-catalog.js';
import { loadInteractionTypeIdForPurpose } from '../purpose-loader.js';

// ============================================================================
// ID Generation
// ============================================================================

let objectCounter = 0;

/**
 * Generate a unique object ID.
 */
function generateObjectId(placeId: string, entityId: string): string {
  const placeSlug = placeId.replace(/^PLACE_/, '').toLowerCase();
  const typeSlug = entityId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const counter = (++objectCounter).toString().padStart(4, '0');
  return `OBJ_${placeSlug}_${typeSlug}_${counter}`;
}

// ============================================================================
// Object Factory
// ============================================================================

/**
 * Create an ObjectEntity from a placed object.
 *
 * @param place The place containing the object
 * @param placedObject The placed object from population (entityId is the registry key)
 * @param ctx Universe context for ID uniqueness checking
 * @returns The created ObjectEntity
 */
export function createObjectEntity(
  place: Place,
  placedObject: StagedPlacedObject,
  ctx: UniverseContext,
): ObjectEntity {
  const isStructural = placedObject.isStructural ?? false;
  // placedObject.objectTypeId is now the entity ID from the Entity Registry
  const entityId = placedObject.objectTypeId;
  const entityDef = getEntityDefinition(entityId);
  if (!entityDef) {
    throw new Error(`Unknown entity: ${entityId}`);
  }

  // Generate unique ID
  let objectId = generateObjectId(place.id, entityId);

  // Check for uniqueness
  let attempts = 0;
  while (ctx.objects.find((o) => o.id === objectId) && attempts < 100) {
    objectId = generateObjectId(place.id, entityId);
    attempts++;
  }

  // Build description with material if provided
  let description = entityDef.description ?? entityDef.name ?? entityId;
  if (placedObject.material) {
    description = description.replace('wooden', placedObject.material);
    description = description.replace('A ', `A ${placedObject.material} `);
  }

  // Get entity properties with defaults
  const props = getEntityProperties(entityId);

  // Determine animated state from object-specific fields (only ObjectEntityDefinition has 'states')
  const animated = 'states' in entityDef && entityDef.states?.includes('animated') === true;

  const facing = placedObject.facing;

  const resolvedLayer =
    props.layer !== 'default'
      ? props.layer
      : (getSpriteDefaultLayer(entityDef.sprite) ?? placedObject.layer);

  // Build object info
  const objectInfo: ObjectInfo = {
    purpose: entityDef.purpose,
    solid: props.solid,
    layer: resolvedLayer,
    isStructural,
    material: placedObject.material ?? null,
    tint: placedObject.tint ?? getEntityDefaultTint(entityId),
    spriteConfig: {
      spriteId: entityDef.sprite,
      frame: null,
      animationKey: null,
      animated,
      facing,
    },
    hp: null,
    maxHp: null,
    state: null,
    contents: null,
    lightSource: props.lightSource,
    itemId: entityDef.purpose === 'item' ? entityId : null,
    plotId: null,
  };

  // Derive interaction type from the purpose definition.
  // Object factory stamps only { typeId } — all behavioral logic lives in the interaction registry.
  let interaction: ObjectEntity['interaction'] = null;
  if (entityDef.purpose === 'exit') {
    interaction = { typeId: 'enter' };
  } else {
    const interactionTypeId = loadInteractionTypeIdForPurpose(entityDef.purpose);
    if (interactionTypeId) {
      interaction = { typeId: interactionTypeId };
    }
  }

  // Convert tile position to world position via shared utility.
  // Apply wallVerticalOffset so wall-mounted objects (torches, trophies) render
  // at head height rather than floor level. Negative offset = higher on the wall.
  const dims = entityDef.sprite ? getSpriteDimensions(entityDef.sprite) : { width: 32, height: 32 };
  // BUG-263: Use slot footprint from placement algorithm.
  // The placement algorithm determines the tile footprint (e.g. 1x1 for in_wall),
  // which may differ from the sprite's bounding box (e.g. 1x2 for a tall door).
  // Using sprite dimensions shifts tall objects off their intended wall position.
  const footprintW = placedObject.footprint.w;
  const footprintH = placedObject.footprint.h;
  const worldPos = computeWorldPosition(
    placedObject.position.x,
    placedObject.position.y,
    footprintW,
    footprintH,
  );
  worldPos.y += getEntityWallVerticalOffsetPx(entityId);

  // Get tags from entity definition
  const tags = entityDef.tags ?? [];

  const entity: ObjectEntity = {
    id: objectId,
    label: entityDef.name ?? entityId,
    description,
    important: false,
    short_description: (entityDef.name ?? entityId).toLowerCase(),
    tags,
    entityType: 'object',
    info: objectInfo,
    position: {
      x: worldPos.x,
      y: worldPos.y,
      width: dims.width,
      height: dims.height,
      parent: place.id,
    },
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    relationships: [],
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction,
  };

  // Save to context
  ctx.upsertEntity('object', entity);

  return entity;
}
