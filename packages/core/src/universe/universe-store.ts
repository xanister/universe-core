import { readdir, unlink, rm, stat } from 'fs/promises';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import createHttpError from 'http-errors';
import type { BaseEntity, EntityType, Universe, UniverseEvent } from '@dmnpc/types/entity';
import type { WeatherCondition, PlaceLayout } from '@dmnpc/types/world';
import { UNIVERSES_DIR } from '@dmnpc/data';
import { logger } from '../infra/logger.js';
import { readJsonFile } from '../infra/read-json-file.js';
import { isCharacter, isPlace, isObjectEntity } from '../entities/type-guards.js';

// ============================================================================
// Data Validation Helpers
// ============================================================================

/**
 * Validates and cleans an entity's tags array.
 * Removes null/undefined values and logs a warning if any are found.
 * This catches data corruption from JSON serialization (undefined → null).
 */
function validateEntityTags(entity: BaseEntity, filePath: string): void {
  const originalLength = entity.tags.length;
  const validTags = entity.tags.filter((tag): tag is string => typeof tag === 'string');

  if (validTags.length !== originalLength) {
    const invalidCount = originalLength - validTags.length;
    logger.warn(
      'UniverseStore',
      `Entity ${entity.id} has ${invalidCount} invalid tag(s) (null/undefined) - cleaned. File: ${filePath}`,
    );
    entity.tags = validTags;
  }
}

// ============================================================================
// File I/O Helpers
// ============================================================================

function getUniverseEntitiesDir(universeId: string, type: EntityType): string {
  const dirNames: Record<EntityType, string> = {
    character: 'characters',
    place: 'places',
    event: 'events',
    object: 'objects',
  };
  return join(UNIVERSES_DIR, universeId, 'entities', dirNames[type]);
}

function getUniverseEntityFilePath(universeId: string, type: EntityType, entityId: string): string {
  return join(getUniverseEntitiesDir(universeId, type), `${entityId}.json`);
}

/**
 * Get the modification time (mtime) of an entity file.
 * Returns null if the file doesn't exist.
 */
export async function getEntityFileMtime(
  universeId: string,
  type: EntityType,
  entityId: string,
): Promise<number | null> {
  const filePath = getUniverseEntityFilePath(universeId, type, entityId);
  try {
    const stats = await stat(filePath);
    return stats.mtimeMs;
  } catch {
    return null; // File doesn't exist
  }
}

// ============================================================================
// Universe Management
// ============================================================================

export async function loadUniverse(universeId: string): Promise<Universe> {
  const indexPath = join(UNIVERSES_DIR, universeId, 'index.json');
  const universe = await readJsonFile<Universe>(indexPath);

  universe.characters = (await loadUniverseEntities(universeId, 'character')).filter(isCharacter);
  universe.places = (await loadUniverseEntities(universeId, 'place')).filter(isPlace);
  universe.objects = (await loadUniverseEntities(universeId, 'object')).filter(isObjectEntity);
  universe.events = await loadUniverseEvents(universeId);

  return universe;
}

export async function listUniverses(): Promise<Universe[]> {
  const entries = await readdir(UNIVERSES_DIR, { withFileTypes: true });
  const universes: Universe[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const indexPath = join(UNIVERSES_DIR, entry.name, 'index.json');
    // Check if file exists before reading to avoid hanging on missing files
    if (!existsSync(indexPath)) continue;

    const universeData = await readJsonFile<Universe>(indexPath);

    if (universeData.name && universeData.version) {
      universes.push({
        id: entry.name,
        name: universeData.name,
        version: universeData.version,
        description: universeData.description || '',
        custom: universeData.custom,
        rules: universeData.rules || '',
        tone: universeData.tone || '',
        style: universeData.style || '',
        mapStyle: universeData.mapStyle ?? null,
        image: universeData.image,
        date: universeData.date || '',
        calendar: universeData.calendar,
        weather: universeData.weather ?? null,
        weatherSeverity: universeData.weatherSeverity ?? null,
        climate: universeData.climate ?? null,
        music: universeData.music ?? null,
        races: universeData.races,
        characters: null,
        places: null,
        objects: null,
        events: null,
        rootPlaceId: universeData.rootPlaceId || '',
        rulesetId: universeData.rulesetId ?? null,
        defaultStartPlaceId: universeData.defaultStartPlaceId ?? null,
        stagingSpriteTheme: universeData.stagingSpriteTheme,
        hungerFatigueEnabled: universeData.hungerFatigueEnabled,
        // Don't include characters/places in list response
      });
    }
  }

  return universes;
}

// ============================================================================
// Entity Management
// ============================================================================

export async function loadUniverseEntities(
  universeId: string,
  type: EntityType,
): Promise<BaseEntity[]> {
  const entitiesDir = getUniverseEntitiesDir(universeId, type);
  if (!existsSync(entitiesDir)) return [];

  const files = await readdir(entitiesDir);
  const entities: BaseEntity[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = join(entitiesDir, file);
    const entity = await readJsonFile<BaseEntity>(filePath);
    validateEntityTags(entity, filePath);
    entities.push(entity);
  }

  return entities;
}

/**
 * Load universe events from disk.
 *
 * Separate from loadUniverseEntities because UniverseEvent does not extend
 * BaseEntity (no tags, entityType, etc.) — it's a distinct type.
 */
export async function loadUniverseEvents(universeId: string): Promise<UniverseEvent[]> {
  const entitiesDir = getUniverseEntitiesDir(universeId, 'event');
  if (!existsSync(entitiesDir)) return [];

  const files = await readdir(entitiesDir);
  const events: UniverseEvent[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = join(entitiesDir, file);
    events.push(await readJsonFile<UniverseEvent>(filePath));
  }

  return events;
}

export function upsertUniverseEntity(
  universeId: string,
  type: EntityType,
  entity: BaseEntity,
): BaseEntity {
  const filePath = getUniverseEntityFilePath(universeId, type, entity.id);

  // Validate and clean tags before saving to prevent data corruption
  // This catches bugs where undefined values get into tags arrays
  validateEntityTags(entity, filePath);

  // Use synchronous writes to ensure disk is always up-to-date before function returns
  // This eliminates the need for fragile tracking of "recently updated" entities
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(entity, null, 2) + '\n', 'utf-8');

  return entity;
}

// ============================================================================
// Universe Metadata Updates
// ============================================================================

/**
 * Allowed fields for admin universe updates.
 */
export type UniverseUpdateFields = {
  weather?: WeatherCondition;
  weatherSeverity?: number | null;
  date?: string;
};

/**
 * Updates multiple universe fields and persists to index.json.
 * Also updates the in-memory cache.
 * Returns the fields that were actually updated.
 */
export async function updateUniverseFields(
  universeId: string,
  updates: UniverseUpdateFields,
): Promise<UniverseUpdateFields> {
  const indexPath = join(UNIVERSES_DIR, universeId, 'index.json');

  // Read current index
  const index = await readJsonFile<Universe>(indexPath);

  const updated: UniverseUpdateFields = {};

  // Apply updates
  if (updates.weather !== undefined) {
    index.weather = updates.weather;
    updated.weather = updates.weather;
  }
  if (updates.weatherSeverity !== undefined) {
    index.weatherSeverity = updates.weatherSeverity;
    updated.weatherSeverity = updates.weatherSeverity;
  }
  if (updates.date !== undefined) {
    index.date = updates.date;
    updated.date = updates.date;
  }

  // Write back synchronously for consistency
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf-8');

  const changedFields = Object.keys(updated).join(', ');
  logger.info(
    'UniverseStore',
    `Universe updated: universeId=${universeId} fields=${changedFields}`,
  );

  return updated;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generates a unique event ID from a fact description.
 * Format: EVENT_{slugified_prefix}_{timestamp}
 *
 * @param fact - The event fact description
 * @returns A unique event ID
 */
export function generateEventId(fact: string): string {
  // Take first 4-5 words, slugify, and add timestamp
  const words = fact
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('_');

  const maxSlugLength = 80;
  let slug = words || 'event';
  if (slug.length > maxSlugLength) {
    slug = slug.slice(0, maxSlugLength).replace(/_+$/g, '');
    if (!slug) slug = 'event';
  }
  const timestamp = Date.now();

  return `EVENT_${slug}_${timestamp}`;
}

/**
 * Resolves entity ID references to their labels in a text string.
 * Uses the provided UniverseContext to look up entity labels.
 */
export function resolveReferencesWithContext(
  ctx: {
    characters: Array<{ id: string; label: string }>;
    places: Array<{ id: string; label: string }>;
  },
  text: string,
): string {
  if (!text) return text || '';

  const charMap = new Map<string, string>();
  const placeMap = new Map<string, string>();

  ctx.characters.forEach((char) => {
    if (char.id && char.label) charMap.set(char.id, char.label);
  });

  ctx.places.forEach((place) => {
    if (place.id && place.label) placeMap.set(place.id, place.label);
  });

  let resolved = text;
  charMap.forEach((name, id) => {
    resolved = resolved.replace(new RegExp(`\\b${id}\\b`, 'g'), name);
  });
  placeMap.forEach((name, id) => {
    resolved = resolved.replace(new RegExp(`\\b${id}\\b`, 'g'), name);
  });

  return resolved;
}

// ============================================================================
// Universe CRUD Operations
// ============================================================================

/**
 * Creates a new universe with the given configuration.
 * Creates the directory structure: universeId/index.json, entities/characters/, entities/places/
 *
 * @param universe - The universe configuration to create
 * @returns The created universe
 * @throws Error if universe already exists
 */
export function createUniverse(universe: Omit<Universe, 'characters' | 'places'>): Universe {
  const universeDir = join(UNIVERSES_DIR, universe.id);

  if (existsSync(universeDir)) {
    throw new Error(`Universe ${universe.id} already exists`);
  }

  // Create directory structure
  mkdirSync(universeDir, { recursive: true });
  mkdirSync(join(universeDir, 'entities', 'characters'), { recursive: true });
  mkdirSync(join(universeDir, 'entities', 'places'), { recursive: true });
  mkdirSync(join(universeDir, 'entities', 'events'), { recursive: true });
  mkdirSync(join(universeDir, 'media', 'images'), { recursive: true });
  mkdirSync(join(universeDir, 'media', 'audio'), { recursive: true });

  // Create index.json (exclude runtime entity arrays)
  const indexData = {
    id: universe.id,
    name: universe.name,
    version: universe.version,
    description: universe.description,
    custom: universe.custom,
    rules: universe.rules || '',
    tone: universe.tone || '',
    style: universe.style || '',
    mapStyle: universe.mapStyle ?? null,
    image: universe.image,
    date: universe.date || '',
    calendar: universe.calendar,
    weather: universe.weather,
    weatherSeverity: universe.weatherSeverity ?? null,
    climate: universe.climate,
    music: universe.music ?? null,
    races: universe.races,
    rootPlaceId: universe.rootPlaceId || '',
    rulesetId: universe.rulesetId ?? null,
    defaultStartPlaceId: universe.defaultStartPlaceId ?? null,
    stagingSpriteTheme: universe.stagingSpriteTheme,
    hungerFatigueEnabled: universe.hungerFatigueEnabled,
  };

  const indexPath = join(universeDir, 'index.json');
  writeFileSync(indexPath, JSON.stringify(indexData, null, 2) + '\n', 'utf-8');

  logger.info('UniverseStore', `Universe created: ${universe.id}`);

  // Return full universe with empty entity arrays
  return {
    ...indexData,
    characters: [],
    places: [],
    objects: [],
    events: [],
  } as Universe;
}

/**
 * Updates an existing universe's index.json fields.
 * Does not modify entities (use upsertUniverseEntity for that).
 *
 * @param universeId - The universe to update
 * @param updates - Partial universe data to merge
 * @returns The updated universe metadata
 * @throws Error if universe doesn't exist
 */
export async function updateUniverse(
  universeId: string,
  updates: Partial<Omit<Universe, 'id' | 'characters' | 'places'>>,
): Promise<Universe> {
  const indexPath = join(UNIVERSES_DIR, universeId, 'index.json');

  if (!existsSync(indexPath)) {
    throw createHttpError.NotFound(`Universe ${universeId} not found`);
  }

  // Read current index
  const index = await readJsonFile<Universe>(indexPath);

  // Apply updates (excluding entity arrays)
  const updatedIndex: Universe = {
    ...index,
    ...updates,
    id: universeId, // Ensure ID cannot be changed
    // Entity arrays live on disk, not in index.json — return empty for caller convenience
    characters: [],
    places: [],
    objects: [],
    events: [],
  };

  // Write back synchronously
  writeFileSync(indexPath, JSON.stringify(updatedIndex, null, 2) + '\n', 'utf-8');

  const changedFields = Object.keys(updates).join(', ');
  logger.info(
    'UniverseStore',
    `Universe updated: universeId=${universeId} fields=${changedFields}`,
  );

  return updatedIndex;
}

/**
 * Deletes a universe and all its contents.
 *
 * @param universeId - The universe to delete
 * @param force - If true, delete even if entities exist. Default false.
 * @returns true if deleted, false if universe didn't exist
 * @throws Error if entities exist and force is false
 */
export async function deleteUniverse(universeId: string, force = false): Promise<boolean> {
  const universeDir = join(UNIVERSES_DIR, universeId);

  if (!existsSync(universeDir)) {
    return false;
  }

  // Check for entities if not forcing
  if (!force) {
    const characterDir = join(universeDir, 'entities', 'characters');
    const placeDir = join(universeDir, 'entities', 'places');
    const eventDir = join(universeDir, 'entities', 'events');

    const characterCount = existsSync(characterDir)
      ? (await readdir(characterDir)).filter((f) => f.endsWith('.json')).length
      : 0;
    const placeCount = existsSync(placeDir)
      ? (await readdir(placeDir)).filter((f) => f.endsWith('.json')).length
      : 0;
    const eventCount = existsSync(eventDir)
      ? (await readdir(eventDir)).filter((f) => f.endsWith('.json')).length
      : 0;

    const totalEntities = characterCount + placeCount + eventCount;
    if (totalEntities > 0) {
      throw new Error(
        `Universe ${universeId} contains ${totalEntities} entities (${characterCount} characters, ${placeCount} places, ${eventCount} events). ` +
          `Use force=true to delete anyway.`,
      );
    }
  }

  // Delete the entire universe directory
  await rm(universeDir, { recursive: true, force: true });

  logger.info('UniverseStore', `Universe deleted: ${universeId}`);
  return true;
}

/**
 * Gets universe metadata without loading entities.
 * Useful for admin operations that just need index.json data.
 *
 * @param universeId - The universe to get
 * @returns Universe metadata (without entity arrays)
 * @throws Error if universe doesn't exist
 */
export async function getUniverseMetadata(
  universeId: string,
): Promise<Omit<Universe, 'characters' | 'places'>> {
  const indexPath = join(UNIVERSES_DIR, universeId, 'index.json');

  if (!existsSync(indexPath)) {
    throw createHttpError.NotFound(`Universe ${universeId} not found`);
  }

  const index = await readJsonFile<Universe>(indexPath);

  return {
    id: universeId,
    name: index.name,
    version: index.version,
    description: index.description || '',
    custom: index.custom,
    rules: index.rules || '',
    tone: index.tone || '',
    style: index.style || '',
    mapStyle: index.mapStyle ?? null,
    image: index.image,
    date: index.date || '',
    calendar: index.calendar,
    weather: index.weather ?? null,
    weatherSeverity: index.weatherSeverity ?? null,
    climate: index.climate ?? null,
    music: index.music ?? null,
    races: index.races,
    objects: null,
    events: null,
    rootPlaceId: index.rootPlaceId || '',
    rulesetId: index.rulesetId ?? null,
    defaultStartPlaceId: index.defaultStartPlaceId ?? null,
    stagingSpriteTheme: index.stagingSpriteTheme,
    hungerFatigueEnabled: index.hungerFatigueEnabled,
  };
}

// ============================================================================
// Place Layout Storage
// ============================================================================

/**
 * Get the file path for a place layout.
 * Layouts are stored in: {universeId}/layouts/{placeId}.json
 */
export function getLayoutFilePath(universeId: string, placeId: string): string {
  return join(UNIVERSES_DIR, universeId, 'layouts', `${placeId}.json`);
}

/**
 * Get the layouts directory for a universe.
 */
export function getLayoutsDir(universeId: string): string {
  return join(UNIVERSES_DIR, universeId, 'layouts');
}

/**
 * Check if a layout file exists for a place.
 */
export function layoutExists(universeId: string, placeId: string): boolean {
  const filePath = getLayoutFilePath(universeId, placeId);
  return existsSync(filePath);
}

/**
 * Load a place layout from disk.
 * Returns null if the layout file doesn't exist.
 */
export async function loadPlaceLayout(
  universeId: string,
  placeId: string,
): Promise<PlaceLayout | null> {
  const filePath = getLayoutFilePath(universeId, placeId);

  if (!existsSync(filePath)) {
    return null;
  }

  const layout = await readJsonFile<PlaceLayout>(filePath);
  logger.info('UniverseStore', `Loaded layout for ${placeId} from disk`);
  return layout;
}

/**
 * Save a place layout to disk.
 * Creates the layouts directory if it doesn't exist.
 */
export function savePlaceLayout(universeId: string, placeId: string, layout: PlaceLayout): void {
  const filePath = getLayoutFilePath(universeId, placeId);
  const layoutsDir = getLayoutsDir(universeId);

  // Create layouts directory if needed
  if (!existsSync(layoutsDir)) {
    mkdirSync(layoutsDir, { recursive: true });
  }

  // Write layout to disk synchronously for consistency
  writeFileSync(filePath, JSON.stringify(layout, null, 2) + '\n', 'utf-8');
  logger.info('UniverseStore', `Saved layout for ${placeId} to disk`);
}

/**
 * Delete a place layout file.
 * Returns true if the file was deleted, false if it didn't exist.
 */
export async function deletePlaceLayout(universeId: string, placeId: string): Promise<boolean> {
  const filePath = getLayoutFilePath(universeId, placeId);

  if (!existsSync(filePath)) {
    return false;
  }

  await unlink(filePath);
  logger.info('UniverseStore', `Deleted layout for ${placeId}`);
  return true;
}

/**
 * Synchronous version of deletePlaceLayout.
 * Used by entity deletion (which is synchronous) to clean up layout files.
 */
export function deletePlaceLayoutSync(universeId: string, placeId: string): boolean {
  const filePath = getLayoutFilePath(universeId, placeId);

  if (!existsSync(filePath)) {
    return false;
  }

  unlinkSync(filePath);
  logger.info('UniverseStore', `Deleted layout for ${placeId}`);
  return true;
}
