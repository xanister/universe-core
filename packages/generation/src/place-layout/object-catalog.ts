/**
 * Object Catalog Loader
 *
 * Loads object definitions from entities/objects/*.json (one file per object).
 * Files use catalog shape: purposes[], spriteId. Matched to slot purpose for generation.
 * Place sprites come from layout templates.
 */

import { readdirSync } from 'fs';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { join } from 'path';
import type {
  Purpose,
  EntityDefinition,
  EntityRegistry,
  ObjectEntityDefinition,
  RenderLayer,
  LightSourceConfig,
} from '@dmnpc/types/world';
import { ENTITIES_DIR, SPRITE_REGISTRY_PATH } from '@dmnpc/data';

const RENDER_LAYERS: readonly string[] = ['floor', 'default', 'overhead'];

function isRenderLayer(val: string): val is RenderLayer {
  return RENDER_LAYERS.includes(val);
}

function isObjectEntityDefinition(def: EntityDefinition): def is ObjectEntityDefinition {
  return 'solid' in def;
}

/** Stored shape in entities/objects/*.json (catalog format) */
interface CatalogObjectType {
  id?: string;
  name: string;
  description?: string;
  purposes: string[];
  spriteId: string | null;
  solid?: boolean;
  layer?: string;
  materials?: string[];
  tintable?: boolean;
  tags?: string[];
  canContain?: boolean;
  states?: string[];
  /**
   * Vertical render offset in tiles. Negative = higher on the wall.
   * Applied at world-position time so wall-mounted objects (torches, trophies)
   * appear at head height rather than at floor level. Default = 0.
   */
  wallVerticalOffset?: number;
  /** Default tint color (hex number, e.g. 0xFFD700 for gold). Applied when no explicit tint is provided. */
  defaultTint?: number;
  lightSource?: {
    radius: number;
    color: number;
    intensity: number;
    flicker: boolean;
    flickerSpeed?: number;
    flickerRange?: number;
    offsetX?: number;
    offsetY?: number;
  } | null;
  [key: string]: unknown;
}

// ============================================================================
// Sprite Registry Types & Loading
// ============================================================================

type WallFacing = 'north' | 'south' | 'east' | 'west';

const WALL_FACINGS = new Set<string>(['north', 'south', 'east', 'west']);

function isWallFacing(value: string): value is WallFacing {
  return WALL_FACINGS.has(value);
}

interface SpriteDirection {
  x: number;
  y: number;
}

interface SpriteDefinition {
  id: string;
  width: number;
  height: number;
  boundingBox: { width: number; height: number; offsetX: number; offsetY: number } | null;
  directions: Record<string, SpriteDirection> | null;
  supportedOrientations: string[];
  defaultLayer?: 'floor' | 'default' | 'overhead' | 'wall' | null;
}

interface SpriteRegistry {
  sprites: Record<string, SpriteDefinition | undefined>;
}

let spriteRegistry: SpriteRegistry | null = null;

/**
 * Load the sprite registry from disk.
 */
function loadSpriteRegistry(): SpriteRegistry {
  if (process.env.NODE_ENV === 'production' && spriteRegistry) {
    return spriteRegistry;
  }

  const registryPath = SPRITE_REGISTRY_PATH;
  spriteRegistry = readJsonFileSync<SpriteRegistry>(registryPath);

  return spriteRegistry;
}

/**
 * Get sprite dimensions from the sprite registry.
 * @param spriteId The sprite ID to look up
 * @returns Width and height in pixels
 * @throws Error if sprite not found
 */
export function getSpriteDimensions(spriteId: string): { width: number; height: number } {
  const registry = loadSpriteRegistry();
  const sprite = registry.sprites[spriteId];
  if (!sprite) {
    throw new Error(
      `Sprite "${spriteId}" not found in sprite registry. Check sprite-registry.json or the object definition referencing it.`,
    );
  }
  return { width: sprite.width, height: sprite.height };
}

/**
 * Get the bounding box for a sprite from the sprite registry.
 * Returns null if the sprite has no bounding box defined.
 */
export function getSpriteBoundingBox(
  spriteId: string,
): { width: number; height: number; offsetX: number; offsetY: number } | null {
  const registry = loadSpriteRegistry();
  const sprite = registry.sprites[spriteId];
  if (!sprite) return null;
  return sprite.boundingBox ?? null;
}

/**
 * Convert tile coordinates to world pixel position.
 * Single source of truth for tile-to-world conversion used by both
 * object-factory (new objects) and generator (reused objects).
 *
 * (tileX, tileY) is the top-left corner of the footprint.
 * footprintW/footprintH default to 1 (single tile).
 *
 * X: centered on the footprint.
 * Y: bottom-aligned to the footprint (client renders with setOrigin(0.5, 1)).
 */
export function computeWorldPosition(
  tileX: number,
  tileY: number,
  footprintW = 1,
  footprintH = 1,
): { x: number; y: number } {
  const tileSize = 32;
  return {
    x: tileX * tileSize + (footprintW * tileSize) / 2,
    y: (tileY + footprintH) * tileSize,
  };
}

/**
 * Get the supported facing directions for a sprite.
 * Reads from the sprite's `supportedOrientations` field, which is always
 * a non-empty array (at least `["south"]` for single-direction sprites).
 */
export function getSpriteDirections(spriteId: string): WallFacing[] {
  const registry = loadSpriteRegistry();
  const sprite = registry.sprites[spriteId];
  if (!sprite) {
    throw new Error(
      `Sprite "${spriteId}" not found in sprite registry. Check sprite-registry.json or the object definition referencing it.`,
    );
  }
  return sprite.supportedOrientations.filter(isWallFacing);
}

/**
 * Determine which wall-facing directions are allowed for a given slot purpose.
 *
 * Computes the INTERSECTION of supported facings across all candidate objects
 * matching the purpose + tags. This guarantees that whichever object the selector
 * picks, the sprite will support the assigned facing.
 *
 * @returns Non-empty array of allowed WallFacing values
 */
export function getAllowedFacingsForPurpose(
  purpose: Purpose,
  requiredTags?: string[],
): WallFacing[] {
  ensureObjectDefinitions();

  const candidateSpriteIds: string[] = [];
  for (const [, raw] of Object.entries(objectDefinitions!)) {
    if (!raw) continue;
    if (!purposesMatch(purpose, raw.purposes)) continue;
    if (requiredTags && requiredTags.length > 0) {
      const entityTags = raw.tags ?? [];
      if (!requiredTags.every((tag) => entityTags.includes(tag))) continue;
    }
    if (raw.spriteId) candidateSpriteIds.push(raw.spriteId);
  }

  if (candidateSpriteIds.length === 0) {
    return ['south'];
  }

  // Compute intersection: start with the first candidate's facings,
  // then intersect with each subsequent candidate.
  let allowed: Set<WallFacing> | null = null;

  for (const spriteId of candidateSpriteIds) {
    const supported = new Set<WallFacing>(getSpriteDirections(spriteId));

    if (!allowed) {
      allowed = supported;
    } else {
      for (const f of allowed) {
        if (!supported.has(f)) {
          allowed.delete(f);
        }
      }
    }
  }

  const result = allowed ? [...allowed] : [];
  // Fallback: if intersection is empty (shouldn't happen in practice),
  // default to south-only so objects still get placed.
  return result.length > 0 ? result : ['south'];
}

/**
 * Determine which wall-facing directions have at least one candidate object
 * for a given slot purpose.
 *
 * Computes the UNION of supported facings across all candidate objects
 * matching the purpose + tags. Used by against_wall placement to pre-filter
 * tiles: a tile is a valid candidate if at least one object can face that way.
 * The actual object is then filtered by facing at selection time.
 *
 * @returns Non-empty array of allowed WallFacing values
 */
export function getAnyAllowedFacingsForPurpose(
  purpose: Purpose,
  requiredTags?: string[],
  forbiddenTags?: string[],
): WallFacing[] {
  ensureObjectDefinitions();

  const union = new Set<WallFacing>();
  for (const [, raw] of Object.entries(objectDefinitions!)) {
    if (!raw) continue;
    if (!purposesMatch(purpose, raw.purposes)) continue;
    const entityTags = raw.tags ?? [];
    if (requiredTags && requiredTags.length > 0) {
      if (!requiredTags.every((tag) => entityTags.includes(tag))) continue;
    }
    if (forbiddenTags && forbiddenTags.length > 0) {
      if (forbiddenTags.some((tag) => entityTags.includes(tag))) continue;
    }
    if (raw.spriteId) {
      for (const facing of getSpriteDirections(raw.spriteId)) {
        union.add(facing);
      }
    }
  }

  return union.size > 0 ? [...union] : ['south'];
}

/**
 * Pick a random supported facing for a slot's purpose.
 * Returns null if all candidates are south-only (no visual variety to add).
 * Used by non-wall algorithms to add orientation variety for multi-direction sprites.
 */
export function getRandomSupportedFacing(
  purpose: Purpose,
  rng: () => number,
  requiredTags?: string[],
): WallFacing {
  const allowed = getAllowedFacingsForPurpose(purpose, requiredTags);
  return allowed[Math.floor(rng() * allowed.length)];
}

// ============================================================================
// Types
// ============================================================================

/**
 * Entity definition with its ID and sprite dimensions included.
 * This is the runtime representation used during generation.
 */
export type EntityWithId = EntityDefinition & {
  id: string;
  /** Width in pixels (from sprite registry) */
  width: number;
  /** Height in pixels (from sprite registry) */
  height: number;
};

// ============================================================================
// Object Definitions Loading (entities/objects/*.json, catalog format)
// ============================================================================

let objectDefinitions: { [key: string]: CatalogObjectType | undefined } | null = null;

/** Check if an entity's purposes include the slot purpose */
function purposesMatch(slotPurpose: Purpose, purposes: string[]): boolean {
  return purposes.includes(slotPurpose);
}

/** Normalize catalog type to EntityDefinition for getEntityDefinition / compatibility */
function toEntityDefinition(_id: string, raw: CatalogObjectType): EntityDefinition {
  const purpose = raw.purposes[0] ? raw.purposes[0] : 'decoration';
  const rawLight = raw.lightSource ?? null;
  return {
    purpose,
    sprite: raw.spriteId ?? null,
    name: raw.name,
    description: raw.description ?? null,
    tags: raw.tags ?? null,
    solid: raw.solid ?? false,
    layer: raw.layer && isRenderLayer(raw.layer) ? raw.layer : null,
    materials: raw.materials ?? null,
    tintable: raw.tintable ?? false,
    canContain: raw.canContain ?? false,
    states: raw.states ?? null,
    lightSource: rawLight
      ? {
          radius: rawLight.radius,
          color: rawLight.color,
          intensity: rawLight.intensity,
          flicker: rawLight.flicker,
          flickerSpeed: rawLight.flickerSpeed ?? 200,
          flickerRange: rawLight.flickerRange ?? 0.15,
          offsetX: rawLight.offsetX ?? 0,
          offsetY: rawLight.offsetY ?? 0,
        }
      : null,
  };
}

/**
 * Load all object definitions from entities/objects/*.json (catalog format).
 */
export function loadEntityRegistry(): EntityRegistry {
  if (process.env.NODE_ENV === 'production' && objectDefinitions) {
    const definitions: Record<string, EntityDefinition> = {};
    for (const [id, raw] of Object.entries(objectDefinitions)) {
      if (!raw) continue;
      definitions[id] = toEntityDefinition(id, raw);
    }
    return { version: '1.0.0', description: null, definitions };
  }

  const objectsDir = join(ENTITIES_DIR, 'objects');
  const definitions: { [key: string]: CatalogObjectType | undefined } = {};
  // Skip _-prefixed files (test fixtures, internal files) — matches the convention used in loadAllLayoutTemplateFiles
  const files = readdirSync(objectsDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  for (const file of files) {
    const obj = readJsonFileSync<CatalogObjectType>(join(objectsDir, file));
    const id = obj.id ?? file.replace(/\.json$/, '');
    definitions[id] = obj;
  }
  objectDefinitions = definitions;
  const out: Record<string, EntityDefinition> = {};
  for (const [id, raw] of Object.entries(objectDefinitions)) {
    if (!raw) continue;
    out[id] = toEntityDefinition(id, raw);
  }
  return { version: '1.0.0', description: null, definitions: out };
}

/** Ensure objectDefinitions is loaded, re-reading from disk in dev mode. */
function ensureObjectDefinitions(): void {
  if (process.env.NODE_ENV !== 'production' || !objectDefinitions) {
    loadEntityRegistry();
  }
}

/**
 * Get a specific entity definition by ID (normalized to EntityDefinition).
 */
export function getEntityDefinition(entityId: string): EntityDefinition | undefined {
  ensureObjectDefinitions();
  const raw = objectDefinitions![entityId];
  if (!raw) return undefined;
  return toEntityDefinition(entityId, raw);
}

/**
 * Get all entities that match a specific purpose.
 * Matches catalog purposes array (and exit <-> door/entrance).
 * @param purpose The purpose to match
 * @param requiredTags Optional tags that entities must ALL have (AND logic)
 * @param forbiddenTags Optional tags that entities must have NONE of (NOR logic)
 * @param supportedFacing Optional facing filter — only return entities whose sprite supports this facing
 * @returns Array of entities with their IDs and sprite dimensions
 */
export function getEntitiesByPurpose(
  purpose: Purpose,
  requiredTags?: string[],
  forbiddenTags?: string[],
  supportedFacing?: WallFacing,
): EntityWithId[] {
  ensureObjectDefinitions();
  const results: EntityWithId[] = [];

  for (const [id, raw] of Object.entries(objectDefinitions!)) {
    if (!raw) continue;
    if (!purposesMatch(purpose, raw.purposes)) continue;
    const entityTags = raw.tags ?? [];
    if (requiredTags && requiredTags.length > 0) {
      if (!requiredTags.every((tag) => entityTags.includes(tag))) continue;
    }
    if (forbiddenTags && forbiddenTags.length > 0) {
      if (forbiddenTags.some((tag) => entityTags.includes(tag))) continue;
    }
    if (supportedFacing && raw.spriteId) {
      const spriteFacings = getSpriteDirections(raw.spriteId);
      if (!spriteFacings.includes(supportedFacing)) continue;
    }

    const dims = raw.spriteId ? getSpriteDimensions(raw.spriteId) : { width: 32, height: 32 };
    const entity: EntityDefinition = toEntityDefinition(id, raw);
    results.push({
      ...entity,
      purpose,
      sprite: raw.spriteId ?? null,
      id,
      width: dims.width,
      height: dims.height,
    });
  }

  return results;
}

/**
 * Get entity properties with defaults filled in.
 * Object entities have solid, layer, materials, etc. properties.
 */
export function getEntityProperties(entityId: string): {
  solid: boolean;
  layer: RenderLayer;
  materials: string[];
  tintable: boolean;
  lightSource: LightSourceConfig | null;
} {
  const entity = getEntityDefinition(entityId);
  if (!entity || !isObjectEntityDefinition(entity)) {
    return {
      solid: true,
      layer: 'default',
      materials: [],
      tintable: false,
      lightSource: null,
    };
  }
  return {
    solid: entity.solid,
    layer: entity.layer ?? 'default',
    materials: entity.materials ?? [],
    tintable: entity.tintable,
    lightSource: entity.lightSource,
  };
}

/**
 * Resolve the render layer for an entity matched by purpose + spriteId.
 * Priority: catalog entity explicit layer > sprite defaultLayer > fallback.
 */
export function resolveEntityLayerBySprite(
  purpose: string,
  spriteId: string | null,
  fallbackLayer: RenderLayer,
): RenderLayer {
  ensureObjectDefinitions();
  if (spriteId) {
    for (const [, raw] of Object.entries(objectDefinitions!)) {
      if (!raw) continue;
      if (raw.spriteId === spriteId && raw.purposes.includes(purpose)) {
        if (raw.layer && isRenderLayer(raw.layer) && raw.layer !== 'default') {
          return raw.layer;
        }
        break;
      }
    }
  }
  return getSpriteDefaultLayer(spriteId) ?? fallbackLayer;
}

/**
 * Get the wall vertical offset for an entity in pixels.
 * Reads wallVerticalOffset (in tiles) from the raw catalog and converts to pixels.
 * Returns 0 if the field is absent, so existing objects are unaffected.
 */
export function getEntityWallVerticalOffsetPx(entityId: string): number {
  ensureObjectDefinitions();
  const raw = objectDefinitions![entityId];
  if (!raw || !raw.wallVerticalOffset) return 0;
  return raw.wallVerticalOffset * 32;
}

/**
 * Get the default tint for an entity from the catalog.
 * Returns null if no default tint is defined.
 */
export function getEntityDefaultTint(entityId: string): number | null {
  ensureObjectDefinitions();
  const raw = objectDefinitions![entityId];
  if (!raw || raw.defaultTint == null) return null;
  return raw.defaultTint;
}

/**
 * Get a sprite's intrinsic default layer from the sprite registry.
 * Returns the defaultLayer when explicitly set and non-default, otherwise null.
 */
export function getSpriteDefaultLayer(spriteId: string | null): RenderLayer | null {
  if (!spriteId) return null;
  const registry = loadSpriteRegistry();
  const sprite = registry.sprites[spriteId];
  if (!sprite?.defaultLayer || sprite.defaultLayer === 'default') return null;
  return sprite.defaultLayer;
}
