/**
 * UniverseContext - Request-scoped universe state container.
 *
 * Provides isolated access to universe data without relying on global state.
 * Each request/operation should create its own context for proper isolation.
 *
 * Benefits:
 * - Enables multi-universe/multi-tenant scenarios
 * - Tests can create isolated contexts without affecting each other
 * - Request isolation prevents cross-request state leakage
 * - Makes dependencies explicit (context is passed, not imported globally)
 */

import { readdir, unlink } from 'fs/promises';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  BaseEntity,
  EntityType,
  Universe,
  Character,
  Place,
  ObjectEntity,
  UniverseEvent,
  CharacterRelationship,
} from '@dmnpc/types/entity';
import type { RelationshipType } from '@dmnpc/types';
import type { WorldBible } from '@dmnpc/types/world';
import { UNIVERSES_DIR } from '@dmnpc/data';
import { logger } from '../infra/logger.js';
import {
  isErrnoException,
  isCharacter,
  isPlace,
  isObjectEntity,
  isUniverseEvent,
} from '../entities/type-guards.js';
import { loadWorldBible } from '../stores/world-bible-store.js';
import { isWithinRange, DEFAULT_NEARBY_METERS } from '../entities/position-utils.js';
import { readJsonFile } from '../infra/read-json-file.js';

/**
 * Validates and cleans an entity's tags array.
 * Removes null/undefined values and logs a warning if any are found.
 * This catches data corruption from:
 * - JSON serialization (undefined → null)
 * - Array index access on shorter-than-expected arrays (tagIds[2] when only 2 elements)
 */
function validateEntityTags(entity: BaseEntity): void {
  const originalLength = entity.tags.length;
  const validTags = entity.tags.filter((tag): tag is string => typeof tag === 'string');

  if (validTags.length !== originalLength) {
    const invalidCount = originalLength - validTags.length;
    logger.error(
      'UniverseContext',
      `Entity ${entity.id} has ${invalidCount} invalid tag(s) (null/undefined) - this indicates a bug in tag assignment code`,
      { entityId: entity.id, originalTags: entity.tags },
    );
    entity.tags = validTags;
  }
}

/**
 * Check if an error is a "file/directory not found" error (ENOENT).
 * Use this to distinguish expected vs unexpected file system errors.
 */
function isNotFoundError(error: unknown): boolean {
  return isErrnoException(error) && error.code === 'ENOENT';
}

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

async function loadEntitiesFromDisk(universeId: string, type: EntityType): Promise<BaseEntity[]> {
  const entitiesDir = getUniverseEntitiesDir(universeId, type);
  try {
    if (!existsSync(entitiesDir)) return [];

    const files = await readdir(entitiesDir);
    const entities: BaseEntity[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(entitiesDir, file);
      try {
        entities.push(await readJsonFile<BaseEntity>(filePath));
      } catch (error) {
        logger.error('UniverseContext', `Failed to load entity file: ${file}`, {
          universeId,
          type,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return entities;
  } catch (error) {
    logger.error('UniverseContext', `Failed to read entity directory`, {
      universeId,
      type,
      directoryPath: entitiesDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Load events from disk. Separate from loadEntitiesFromDisk because
 * UniverseEvent does not extend BaseEntity.
 */
async function loadEventsFromDisk(universeId: string): Promise<UniverseEvent[]> {
  const entitiesDir = getUniverseEntitiesDir(universeId, 'event');
  try {
    if (!existsSync(entitiesDir)) return [];

    const files = await readdir(entitiesDir);
    const events: UniverseEvent[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(entitiesDir, file);
      try {
        events.push(await readJsonFile<UniverseEvent>(filePath));
      } catch (error) {
        logger.error('UniverseContext', `Failed to load event file: ${file}`, {
          universeId,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return events;
  } catch (error) {
    logger.error('UniverseContext', `Failed to read events directory`, {
      universeId,
      directoryPath: entitiesDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Encapsulates universe state for a single request/operation.
 *
 * Usage:
 * ```typescript
 * const ctx = await UniverseContext.loadAtEntryPoint('my-universe');
 * const player = ctx.getCharacter('CHAR_player');
 * ctx.upsertEntity('character', updatedPlayer);
 * ```
 */
export class UniverseContext {
  private _universeId: string;
  private _universe: Universe;
  private _characters: Map<string, Character>;
  private _places: Map<string, Place>;
  private _objects: Map<string, ObjectEntity>;
  private _events: Map<string, UniverseEvent>;
  /** Index: characterId -> Set of eventIds they witnessed */
  private _eventsByWitness: Map<string, Set<string>>;
  /** WorldBible extracted from documents (null if no documents were uploaded) */
  private _worldBible: WorldBible | null;
  /** Chain for serializing concurrent persistAll() calls */
  private _persistChain: Promise<void> = Promise.resolve();

  private constructor(
    universeId: string,
    universe: Universe,
    characters: Character[],
    places: Place[],
    objects: ObjectEntity[],
    events: UniverseEvent[],
    worldBible: WorldBible | null,
  ) {
    this._universeId = universeId;
    this._universe = universe;
    this._characters = new Map(characters.map((c) => [c.id, c]));
    this._places = new Map(places.map((p) => [p.id, p]));
    this._objects = new Map(objects.map((o) => [o.id, o]));
    this._events = new Map(events.map((e) => [e.id, e]));
    this._worldBible = worldBible;
    this._eventsByWitness = new Map();
    for (const event of events) {
      for (const witnessId of event.witnessIds ?? []) {
        if (!this._eventsByWitness.has(witnessId)) {
          this._eventsByWitness.set(witnessId, new Set());
        }
        this._eventsByWitness.get(witnessId)!.add(event.id);
      }
    }
  }

  /**
   * Load a universe and create a context.
   * **NEVER call this directly outside of withUniverse helper.**
   * Always use `withUniverse()` from `universe-transaction.ts` for proper state management
   * (locking, persistence, cleanup). This method is only called internally by `withUniverse`.
   *
   * For internal functions, receive context as a parameter instead of loading it.
   */
  static async loadAtEntryPoint(universeId: string): Promise<UniverseContext> {
    const indexPath = join(UNIVERSES_DIR, universeId, 'index.json');
    const universe = await readJsonFile<Universe>(indexPath);

    const characters = (await loadEntitiesFromDisk(universeId, 'character')).filter(isCharacter);
    const places = (await loadEntitiesFromDisk(universeId, 'place')).filter(isPlace);
    const objects = (await loadEntitiesFromDisk(universeId, 'object')).filter(isObjectEntity);
    const events = await loadEventsFromDisk(universeId);

    const worldBible = await loadWorldBible(universeId);

    logger.info(
      'UniverseContext',
      `Loaded universe: ${universeId} characters=${characters.length} places=${places.length} objects=${objects.length} events=${events.length} hasWorldBible=${worldBible !== null}`,
    );

    return new UniverseContext(
      universeId,
      universe,
      characters,
      places,
      objects,
      events,
      worldBible,
    );
  }

  /**
   * Create a context from existing data (useful for tests).
   */
  static fromData(
    universeId: string,
    universe: Universe,
    characters: Character[] = [],
    places: Place[] = [],
    objects: ObjectEntity[] = [],
    events: UniverseEvent[] = [],
    worldBible: WorldBible | null = null,
  ): UniverseContext {
    return new UniverseContext(
      universeId,
      universe,
      characters,
      places,
      objects,
      events,
      worldBible,
    );
  }

  get universeId(): string {
    return this._universeId;
  }

  get universe(): Universe {
    return this._universe;
  }

  get characters(): Character[] {
    return Array.from(this._characters.values());
  }

  get places(): Place[] {
    return Array.from(this._places.values());
  }

  get events(): UniverseEvent[] {
    return Array.from(this._events.values());
  }

  get objects(): ObjectEntity[] {
    return Array.from(this._objects.values());
  }

  /**
   * Get the WorldBible for this universe (extracted from documents).
   * Returns null if no documents were uploaded during universe creation.
   */
  get worldBible(): WorldBible | null {
    return this._worldBible;
  }

  /**
   * Check if this universe has a WorldBible.
   */
  get hasWorldBible(): boolean {
    return this._worldBible !== null;
  }

  /**
   * Get a character by ID.
   * @throws Error if character not found
   */
  getCharacter(characterId: string): Character {
    const character = this._characters.get(characterId);
    if (!character) {
      throw new Error(`Character ${characterId} not found`);
    }
    return character;
  }

  /**
   * Get a character by ID, or undefined if not found.
   */
  findCharacter(characterId: string): Character | undefined {
    return this._characters.get(characterId);
  }

  /**
   * Get a place by ID.
   * @throws Error if place not found
   */
  getPlace(placeId: string): Place {
    const place = this._places.get(placeId);
    if (!place) {
      throw new Error(`Place ${placeId} not found`);
    }
    return place;
  }

  /**
   * Get a place by ID, or undefined if not found.
   */
  findPlace(placeId: string): Place | undefined {
    return this._places.get(placeId);
  }

  /**
   * Get an object by ID, or undefined if not found.
   */
  findObject(objectId: string): ObjectEntity | undefined {
    return this._objects.get(objectId);
  }

  /**
   * Get all objects in a specific place.
   * Used by game-room to sync objects to clients.
   */
  getObjectsByPlace(placeId: string): ObjectEntity[] {
    return this.objects.filter((obj) => obj.position.parent === placeId);
  }

  /**
   * Get all exit objects originating from a specific place.
   * Exits are objects with purpose === 'exit'.
   */
  getExitsFromPlace(placeId: string): ObjectEntity[] {
    return this.objects.filter(
      (obj) => obj.info.purpose === 'exit' && obj.position.parent === placeId,
    );
  }

  /**
   * Find an exit from sourcePlaceId to targetPlaceId.
   * In the hierarchical exit model, exits only go from child to parent.
   * Returns undefined if no such exit exists or if target is not the source's parent.
   */
  findExitByTarget(sourcePlaceId: string, targetPlaceId: string): ObjectEntity | undefined {
    // Exits only go from child to parent, so target must be source's parent
    const sourcePlace = this.findPlace(sourcePlaceId);
    if (!sourcePlace || sourcePlace.position.parent !== targetPlaceId) {
      return undefined;
    }

    // Find any exit in the source place (all exits in source point to parent)
    return this.objects.find((obj) => {
      if (obj.info.purpose !== 'exit') return false;
      if (obj.position.parent !== sourcePlaceId) return false;
      return true;
    });
  }

  /**
   * Get an event by ID.
   * @throws Error if event not found
   */
  getEvent(eventId: string): UniverseEvent {
    const event = this._events.get(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }
    return event;
  }

  /**
   * Get an event by ID, or undefined if not found.
   */
  findEvent(eventId: string): UniverseEvent | undefined {
    return this._events.get(eventId);
  }

  /**
   * Get all universe events that a character witnessed.
   * Uses the witness index for O(1) lookup.
   */
  getEventsForCharacter(characterId: string): UniverseEvent[] {
    const eventIds = this._eventsByWitness.get(characterId);
    if (!eventIds) return [];

    return Array.from(eventIds)
      .map((eventId) => this._events.get(eventId))
      .filter((event): event is UniverseEvent => event !== undefined);
  }

  /**
   * Get an entity by ID and type.
   * @throws Error if entity not found
   */
  getEntity(entityId: string, entityType: EntityType): BaseEntity | UniverseEvent {
    if (entityType === 'character') {
      return this.getCharacter(entityId);
    } else if (entityType === 'place') {
      return this.getPlace(entityId);
    } else if (entityType === 'object') {
      const obj = this.findObject(entityId);
      if (!obj) throw new Error(`Object ${entityId} not found`);
      return obj;
    } else {
      return this.getEvent(entityId);
    }
  }

  /**
   * Find an entity by ID, searching all entity types.
   * Returns the entity and its type, or null if not found.
   * Note: Events are not included as they use a different type structure.
   */
  findEntityById(entityId: string): { entity: BaseEntity; entityType: EntityType } | null {
    const character = this._characters.get(entityId);
    if (character) {
      return { entity: character, entityType: 'character' };
    }

    const place = this._places.get(entityId);
    if (place) {
      return { entity: place, entityType: 'place' };
    }

    const object = this._objects.get(entityId);
    if (object) {
      return { entity: object, entityType: 'object' };
    }

    return null;
  }

  /**
   * Get the current place ID for a character (from position.parent).
   * Returns undefined if character has no position or no parent.
   *
   * @param characterId - The character ID
   * @returns The place ID the character is in, or undefined
   */
  getCharacterPlaceId(characterId: string): string | undefined {
    const char = this.findCharacter(characterId);
    return char?.position.parent ?? undefined;
  }

  /**
   * Get the parent place ID for a place (from position.parent).
   * Returns null for root places (cosmos).
   *
   * @param placeId - The place ID
   * @returns The parent place ID, or null for root
   */
  getParentPlaceId(placeId: string): string | null {
    const place = this.findPlace(placeId);
    return place?.position.parent ?? null;
  }

  /**
   * Get all child places of a given place (places whose position.parent matches).
   */
  getChildPlaces(placeId: string): Place[] {
    return this.places.filter((p) => p.position.parent === placeId);
  }

  /**
   * Get all entities (characters and exits) at a specific location.
   * Excludes characters that are in an abstract location state (not physically present).
   * Excludes hidden and structural exits.
   *
   * Uses distance-based proximity filtering for characters when a viewing character
   * is provided (via excludeCharacterId). Characters must be within the proximity
   * threshold (default ~805m / 0.5 miles) of the viewer.
   *
   * @param proximityMeters - Optional override for the proximity threshold.
   *   Pass a tighter value (e.g. 15 for conversational distance) for chat context.
   *   When omitted, uses DEFAULT_NEARBY_METERS (805m).
   */
  getEntitiesByPlace(
    placeId: string,
    excludeCharacterId?: string,
    proximityMeters?: number,
  ): BaseEntity[] {
    // Get the viewing character for proximity checks
    const viewingChar = excludeCharacterId
      ? (this.findCharacter(excludeCharacterId) ?? null)
      : null;

    const threshold = proximityMeters ?? DEFAULT_NEARBY_METERS;

    const characters = this.characters.filter((char) => {
      // Basic filters - use position.parent for character location
      if (char.position.parent !== placeId) return false;
      if (char.info.abstractLocation) return false;
      if (excludeCharacterId && char.id === excludeCharacterId) return false;

      if (viewingChar) {
        return isWithinRange(char.position, viewingChar.position, threshold);
      }

      return true;
    });

    const exits = this.getExitsFromPlace(placeId);

    return [...characters, ...exits];
  }

  /**
   * Get characters whose names this character knows (has name_revealed events).
   */
  getKnownCharacters(characterId: string): Character[] {
    const events = this.getEventsForCharacter(characterId);

    const knownCharacterIds = new Set<string>();
    for (const event of events) {
      if (event.eventType === 'name_revealed' && event.subjectId?.startsWith('CHAR_')) {
        knownCharacterIds.add(event.subjectId);
      }
    }

    // Always include self
    knownCharacterIds.add(characterId);

    return Array.from(knownCharacterIds)
      .map((id) => this.findCharacter(id))
      .filter((c): c is Character => c !== undefined);
  }

  /** Familiarity threshold for "knowing" an entity (name for characters, aware for places) */
  static readonly FAMILIARITY_THRESHOLD = 20;

  /** Familiarity threshold for "visited" state (places only) */
  static readonly VISITED_THRESHOLD = 50;

  /**
   * Get a character's relationship with another character.
   * Returns undefined if no relationship exists.
   */
  getRelationship(characterId: string, targetId: string): CharacterRelationship | undefined {
    const character = this.findCharacter(characterId);
    if (!character) return undefined;

    return character.relationships.find((rel) => rel.targetId === targetId);
  }

  /**
   * Check if a character knows another character's name (has a name_revealed event).
   */
  isKnown(characterId: string, targetId: string): boolean {
    // You always know yourself
    if (characterId === targetId) return true;

    const events = this.getEventsForCharacter(characterId);
    const matchingEvents = events.filter(
      (e) => e.eventType === 'name_revealed' && e.subjectId === targetId,
    );

    return matchingEvents.length > 0;
  }

  /**
   * Alias for isKnown() - checks if observer knows target's name.
   */
  knowsName(observerId: string, targetId: string): boolean {
    return this.isKnown(observerId, targetId);
  }

  /**
   * Record that a character learned another character's name.
   * Creates a name_revealed event if not already known.
   *
   * @param observerId - The character who learned the name
   * @param targetId - The character whose name was learned
   * @param gameDate - The in-game date when the name was revealed
   */
  recordNameReveal(observerId: string, targetId: string, gameDate: string): void {
    if (this.isKnown(observerId, targetId)) {
      return;
    }

    if (!this.findCharacter(observerId)) return;
    const target = this.findCharacter(targetId);
    if (!target) return;

    // Create name reveal event - include both observer and target to avoid collisions
    // when multiple observers learn the same name at the same time
    const eventId = `EVENT_name_revealed_${observerId.replace('CHAR_', '')}_${targetId.replace('CHAR_', '')}_${Date.now()}`;
    const nameEvent: UniverseEvent = {
      id: eventId,
      date: gameDate,
      placeId: null,
      important: false,
      importanceScore: null,
      scope: null,
      relevantPlaceIds: null,
      eventType: 'name_revealed',
      category: 'knowledge',
      subject: target.label,
      subjectId: targetId,
      fact: `Learned the name "${target.label}"`,
      significance: 'minor',
      witnessIds: [observerId],
    };

    this.upsertEvent(nameEvent);

    logger.info(
      'UniverseContext',
      `Recorded name reveal: ${observerId} learned name of ${targetId} (${target.label})`,
    );
  }

  /**
   * Create or update a relationship between characters.
   * Persists the change to disk.
   */
  upsertRelationship(characterId: string, relationship: CharacterRelationship): void {
    const character = this.findCharacter(characterId);
    if (!character) {
      throw new Error(`Character ${characterId} not found`);
    }

    const relationships = character.relationships;
    const existingIndex = relationships.findIndex((rel) => rel.targetId === relationship.targetId);

    if (existingIndex >= 0) {
      relationships[existingIndex] = relationship;
    } else {
      relationships.push(relationship);
    }

    const updatedCharacter: Character = {
      ...character,
      relationships,
    };

    this.upsertEntity('character', updatedCharacter);
  }

  /**
   * Adjust disposition for a relationship.
   * Creates the relationship if it doesn't exist.
   * Clamps to -100 to +100 range.
   */
  adjustDisposition(
    characterId: string,
    targetId: string,
    delta: number,
    options?: { type?: RelationshipType; context?: string },
  ): void {
    const existing = this.getRelationship(characterId, targetId);

    const currentDisposition = existing?.disposition ?? 0;
    const newDisposition = Math.max(-100, Math.min(100, currentDisposition + delta));

    const relationship: CharacterRelationship = {
      targetId,
      type: options?.type ?? existing?.type ?? 'acquaintance',
      disposition: newDisposition,
      familiarity: existing?.familiarity ?? 0,
      context: options?.context ?? existing?.context ?? null,
      pendingGeneration: existing?.pendingGeneration ?? false,
    };

    this.upsertRelationship(characterId, relationship);

    logger.info(
      'UniverseContext',
      `Adjusted disposition: ${characterId} -> ${targetId} delta=${delta} newDisposition=${newDisposition}`,
    );
  }

  /**
   * Adjust familiarity for a relationship.
   * Creates the relationship if it doesn't exist.
   * Clamps to 0 to 100 range.
   */
  adjustFamiliarity(
    characterId: string,
    targetId: string,
    delta: number,
    options?: { type?: RelationshipType },
  ): void {
    const existing = this.getRelationship(characterId, targetId);

    const currentFamiliarity = existing?.familiarity ?? 0;
    const newFamiliarity = Math.max(0, Math.min(100, currentFamiliarity + delta));

    const relationship: CharacterRelationship = {
      targetId,
      type: options?.type ?? existing?.type ?? null,
      disposition: existing?.disposition ?? null,
      familiarity: newFamiliarity,
      context: existing?.context ?? null,
      pendingGeneration: existing?.pendingGeneration ?? false,
    };

    this.upsertRelationship(characterId, relationship);

    logger.info(
      'UniverseContext',
      `Adjusted familiarity: ${characterId} -> ${targetId} delta=${delta} newFamiliarity=${newFamiliarity}`,
    );
  }

  /**
   * Ensure a character knows another entity's name.
   * For characters: creates a name_revealed event if not already known.
   * For places: creates a location_discovered event if not already known.
   */
  ensureKnown(characterId: string, targetId: string): void {
    if (targetId.startsWith('CHAR_')) {
      this.recordNameReveal(characterId, targetId, this._universe.date);
    } else if (targetId.startsWith('PLACE_')) {
      this.recordLocationDiscovered(characterId, targetId, this._universe.date);
    }
  }

  /**
   * Record that a character learned about a place (without visiting it).
   * Creates a location_discovered event if not already known.
   */
  recordLocationDiscovered(characterId: string, placeId: string, gameDate: string): void {
    // Skip if already visited (visiting implies knowing)
    if (this.hasVisited(characterId, placeId)) {
      return;
    }

    // Skip if already discovered
    const events = this.getEventsForCharacter(characterId);
    const alreadyDiscovered = events.some(
      (e) => e.eventType === 'location_discovered' && e.subjectId === placeId,
    );

    if (alreadyDiscovered) return;

    const place = this.findPlace(placeId);
    const placeLabel = place?.label ?? placeId;

    const eventId = `EVENT_location_discovered_${placeId.replace('PLACE_', '')}_${Date.now()}`;
    const discoveryEvent: UniverseEvent = {
      id: eventId,
      date: gameDate,
      placeId: null,
      important: false,
      importanceScore: null,
      scope: null,
      relevantPlaceIds: null,
      eventType: 'location_discovered',
      category: 'knowledge',
      subject: placeLabel,
      subjectId: placeId,
      fact: `Learned about ${placeLabel}`,
      significance: 'minor',
      witnessIds: [characterId],
    };

    this.upsertEvent(discoveryEvent);

    logger.info(
      'UniverseContext',
      `Recorded location discovered: ${characterId} learned about ${placeId} (${placeLabel})`,
    );
  }

  /**
   * Get all characters in the universe.
   */
  getAllCharacters(): Character[] {
    return this.characters;
  }

  /**
   * Get all places in the universe.
   */
  getAllPlaces(): Place[] {
    return this.places;
  }

  /**
   * Check if a character has visited a place (has a location_visited event).
   */
  hasVisited(characterId: string, placeId: string): boolean {
    const events = this.getEventsForCharacter(characterId);
    return events.some((e) => e.eventType === 'location_visited' && e.subjectId === placeId);
  }

  /**
   * Record a visit to a place.
   * Creates a location_visited event if this is the first visit.
   *
   * @param characterId - The character visiting the place
   * @param placeId - The place being visited
   * @param gameDate - The game date of the visit
   */
  recordVisit(characterId: string, placeId: string, gameDate: string): void {
    if (this.hasVisited(characterId, placeId)) {
      const existing = this.getRelationship(characterId, placeId);
      if (existing?.pendingGeneration) {
        this.upsertRelationship(characterId, {
          ...existing,
          pendingGeneration: false,
        });
      }
      return;
    }

    const place = this.findPlace(placeId);
    const placeLabel = place?.label ?? placeId;

    const existing = this.getRelationship(characterId, placeId);
    if (existing?.pendingGeneration) {
      this.upsertRelationship(characterId, {
        ...existing,
        pendingGeneration: false,
      });
    }

    const eventId = `EVENT_visited_${placeId.replace('PLACE_', '')}_${Date.now()}`;
    const visitEvent: UniverseEvent = {
      id: eventId,
      date: gameDate,
      placeId: placeId,
      important: false,
      importanceScore: null,
      scope: null,
      relevantPlaceIds: null,
      eventType: 'location_visited',
      category: 'world',
      subject: placeLabel,
      subjectId: placeId,
      fact: `Visited ${placeLabel}`,
      significance: 'minor',
      witnessIds: [characterId],
    };

    this.upsertEvent(visitEvent);

    logger.info('UniverseContext', `Recorded visit: ${characterId} -> ${placeId} at ${gameDate}`);
  }

  /**
   * Get the date of the first visit to a place (from universe events).
   */
  getFirstVisit(characterId: string, placeId: string): string | undefined {
    const visitEvents = this.getEventsForCharacter(characterId).filter(
      (e) => e.eventType === 'location_visited' && e.subjectId === placeId,
    );

    // Assuming events are in chronological order
    return visitEvents[0]?.date ?? undefined;
  }

  /**
   * Get the date of the most recent visit to a place (from universe events).
   */
  getLastVisit(characterId: string, placeId: string): string | undefined {
    const visitEvents = this.getEventsForCharacter(characterId).filter(
      (e) => e.eventType === 'location_visited' && e.subjectId === placeId,
    );

    return visitEvents[visitEvents.length - 1]?.date ?? undefined;
  }

  /**
   * Get the number of times a character has visited a place.
   */
  getVisitCount(characterId: string, placeId: string): number {
    return this.getEventsForCharacter(characterId).filter(
      (e) => e.eventType === 'location_visited' && e.subjectId === placeId,
    ).length;
  }

  /**
   * Get all known places for a character (visited or discovered via events).
   * A place is "known" if the character has a location_visited or location_discovered event for it.
   */
  getKnownPlaces(characterId: string): Place[] {
    const events = this.getEventsForCharacter(characterId);

    const knownPlaceIds = new Set<string>();
    for (const event of events) {
      if (
        (event.eventType === 'location_visited' || event.eventType === 'location_discovered') &&
        event.subjectId?.startsWith('PLACE_')
      ) {
        knownPlaceIds.add(event.subjectId);
      }
    }

    return Array.from(knownPlaceIds)
      .map((id) => this.findPlace(id))
      .filter((p): p is Place => p !== undefined);
  }

  /**
   * Add an alias to a place entity.
   * Aliases are alternative names that can be used to refer to the place.
   * The alias is only added if it doesn't already exist.
   *
   * @param placeId - The ID of the place to add the alias to
   * @param alias - The alias to add
   * @returns true if the alias was added, false if it already exists or place not found
   */
  addPlaceAlias(placeId: string, alias: string): boolean {
    const place = this.findPlace(placeId);
    if (!place) {
      logger.warn('UniverseContext', `Cannot add alias - place not found: ${placeId}`);
      return false;
    }

    const normalizedAlias = alias.trim();
    if (!normalizedAlias) return false;

    const existingAliases = place.aliases ?? [];
    const aliasLower = normalizedAlias.toLowerCase();

    if (place.label.toLowerCase() === aliasLower) {
      return false;
    }

    if (existingAliases.some((a) => a.toLowerCase() === aliasLower)) {
      return false;
    }

    const updatedPlace: Place = {
      ...place,
      aliases: [...existingAliases, normalizedAlias],
    };

    this.upsertEntity('place', updatedPlace);
    logger.info(
      'UniverseContext',
      `Added alias to place: placeId=${placeId} alias="${normalizedAlias}"`,
    );
    return true;
  }

  /**
   * Update or insert an entity.
   * Only updates the in-memory cache - persistence happens via persistAll().
   */
  upsertEntity(type: EntityType, entity: BaseEntity | UniverseEvent): BaseEntity | UniverseEvent {
    if (type === 'event') {
      if (!isUniverseEvent(entity)) throw new Error('Expected universe event');
      this._events.set(entity.id, entity);
      return entity;
    }

    // type is 'character' | 'place' | 'object' — entity must be BaseEntity
    if (!('entityType' in entity)) throw new Error('Expected base entity');
    const baseEntity = entity;

    if (type === 'character') {
      if (!isCharacter(baseEntity)) throw new Error('Expected character entity');
      validateEntityTags(baseEntity);
      this._characters.set(baseEntity.id, baseEntity);
    } else if (type === 'place') {
      if (!isPlace(baseEntity)) throw new Error('Expected place entity');
      validateEntityTags(baseEntity);
      this._places.set(baseEntity.id, baseEntity);
    } else {
      if (!isObjectEntity(baseEntity)) throw new Error('Expected object entity');
      validateEntityTags(baseEntity);
      this._objects.set(baseEntity.id, baseEntity);
    }

    return entity;
  }

  /**
   * Update or insert a universe event.
   * Only updates the in-memory cache - persistence happens via persistAll().
   */
  upsertEvent(event: UniverseEvent): UniverseEvent {
    const oldEvent = this._events.get(event.id);
    if (oldEvent) {
      for (const witnessId of oldEvent.witnessIds ?? []) {
        this._eventsByWitness.get(witnessId)?.delete(event.id);
      }
    }

    for (const witnessId of event.witnessIds ?? []) {
      if (!this._eventsByWitness.has(witnessId)) {
        this._eventsByWitness.set(witnessId, new Set());
      }
      this._eventsByWitness.get(witnessId)!.add(event.id);
    }

    this._events.set(event.id, event);

    return event;
  }

  /**
   * Delete an entity.
   * Only removes from in-memory cache - persistence happens via persistAll().
   */
  deleteEntity(type: EntityType, entityId: string): boolean {
    if (type === 'character') {
      this._characters.delete(entityId);
    } else if (type === 'place') {
      this._places.delete(entityId);
    } else if (type === 'object') {
      this._objects.delete(entityId);
    } else {
      const event = this._events.get(entityId);
      if (event) {
        for (const witnessId of event.witnessIds ?? []) {
          this._eventsByWitness.get(witnessId)?.delete(entityId);
        }
      }
      this._events.delete(entityId);
    }

    logger.info('UniverseContext', `Entity deleted: type=${type} entityId=${entityId}`);
    return true;
  }

  /**
   * Update universe metadata fields.
   * Only updates in-memory state - persistence happens via persistAll().
   */
  updateUniverse(updates: Partial<Universe>): void {
    Object.assign(this._universe, updates);
    logger.info('UniverseContext', `Universe updated: ${Object.keys(updates).join(', ')}`);
  }

  /**
   * Update the universe's date.
   * Convenience wrapper for updateUniverse({ date }).
   */
  updateDate(newDate: string): void {
    this.updateUniverse({ date: newDate });
  }

  /**
   * Resolve entity references in text (replace IDs with labels).
   */
  resolveReferences(text: string): string {
    if (!text) return text || '';

    let resolved = text;

    this._characters.forEach((char, id) => {
      if (char.label) {
        resolved = resolved.replace(new RegExp(`\\b${id}\\b`, 'g'), char.label);
      }
    });

    this._places.forEach((place, id) => {
      if (place.label) {
        resolved = resolved.replace(new RegExp(`\\b${id}\\b`, 'g'), place.label);
      }
    });

    return resolved;
  }

  /**
   * Refresh entities from disk.
   * Useful when external processes may have modified the files.
   */
  async refresh(): Promise<void> {
    const characters = (await loadEntitiesFromDisk(this._universeId, 'character')).filter(
      isCharacter,
    );
    const places = (await loadEntitiesFromDisk(this._universeId, 'place')).filter(isPlace);
    const objects = (await loadEntitiesFromDisk(this._universeId, 'object')).filter(isObjectEntity);
    const events = await loadEventsFromDisk(this._universeId);

    this._characters = new Map(characters.map((c) => [c.id, c]));
    this._places = new Map(places.map((p) => [p.id, p]));
    this._objects = new Map(objects.map((o) => [o.id, o]));
    this._events = new Map(events.map((e) => [e.id, e]));

    this._eventsByWitness = new Map();
    for (const event of events) {
      for (const witnessId of event.witnessIds ?? []) {
        if (!this._eventsByWitness.has(witnessId)) {
          this._eventsByWitness.set(witnessId, new Set());
        }
        this._eventsByWitness.get(witnessId)!.add(event.id);
      }
    }

    logger.info('UniverseContext', `Refreshed universe: ${this._universeId}`);
  }

  /**
   * Persist all entities and universe metadata to disk.
   * Saves all characters, places, objects, events, and the universe index atomically.
   * This is the single point of persistence - all mutations should call this when done.
   *
   * Serialized via promise chain: concurrent calls queue behind the previous one
   * so that readdir/write/unlink cycles don't race against each other.
   */
  async persistAll(): Promise<void> {
    const work = this._persistChain.then(() => this._persistAllImpl());
    this._persistChain = work.catch(() => {
      // Swallow rejection on the chain so subsequent calls still run.
      // The caller of persistAll() gets the rejection via the returned promise.
    });
    return work;
  }

  private async _persistAllImpl(): Promise<void> {
    // Save all entities from in-memory cache (single source of truth).
    const characters = Array.from(this._characters.values());
    const places = Array.from(this._places.values());
    const objects = Array.from(this._objects.values());
    const events = Array.from(this._events.values());

    // Save entities (implements same logic as saveUniverseEntities).
    for (const type of ['character', 'place', 'object', 'event'] as EntityType[]) {
      const entitiesDir = getUniverseEntitiesDir(this._universeId, type);
      mkdirSync(entitiesDir, { recursive: true });

      const existingFiles = new Set<string>();
      try {
        const files = await readdir(entitiesDir);
        files.forEach((file) => {
          if (file.endsWith('.json')) {
            existingFiles.add(file);
          }
        });
      } catch (error) {
        // ENOENT is expected for new universes - directory doesn't exist yet
        if (!isNotFoundError(error)) {
          logger.error('UniverseContext', `Failed to read directory for cleanup`, {
            universeId: this._universeId,
            type,
            directoryPath: entitiesDir,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const entities =
        type === 'character'
          ? characters
          : type === 'place'
            ? places
            : type === 'object'
              ? objects
              : events;

      for (const entity of entities) {
        const filePath = getUniverseEntityFilePath(this._universeId, type, entity.id);
        writeFileSync(filePath, JSON.stringify(entity, null, 2) + '\n', 'utf-8');
        existingFiles.delete(`${entity.id}.json`);
      }

      for (const file of existingFiles) {
        const filePath = join(entitiesDir, file);
        try {
          await unlink(filePath);
        } catch (error) {
          // ENOENT is expected - file might already be deleted
          if (!isNotFoundError(error)) {
            logger.error('UniverseContext', `Failed to delete entity file: ${file}`, {
              universeId: this._universeId,
              type,
              filePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    const indexPath = join(UNIVERSES_DIR, this._universeId, 'index.json');
    writeFileSync(indexPath, JSON.stringify(this._universe, null, 2) + '\n', 'utf-8');

    logger.info(
      'UniverseContext',
      `Persisted all: ${characters.length} characters, ${places.length} places, ${objects.length} objects, ${events.length} events`,
    );
  }
}
