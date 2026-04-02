/**
 * API request/response types.
 */

/**
 * Request body for POST /api/universes/:universeId/lookup
 * Used for defining words or clarifying phrases from chat/entity content.
 */
export interface TextLookupRequest {
  /** The word or phrase to look up */
  text: string;
  /** Type of lookup: define (dictionary-style) or clarify (explanation) */
  type: 'define' | 'clarify';
  /** Optional character ID for additional context from their knowledge */
  characterId?: string;
}

/** An entity definition or layout template affected by a cascade delete. */
export interface AffectedEntityDefinition {
  id: string;
  name: string;
}

/** An object entity affected by a cascade delete. */
export interface AffectedObjectEntity {
  universeId: string;
  entityId: string;
  label: string;
  reason?: 'objectTypeId' | 'spriteId';
  referencedId?: string;
}

/** Preview of what deleting a sprite would cascade-delete. */
export interface SpriteDeletePreview {
  wouldDelete: {
    sprite: string;
    entityDefinitions: AffectedEntityDefinition[];
    objectEntities: AffectedObjectEntity[];
    layoutTemplates: AffectedEntityDefinition[];
  };
  requiresCascade: boolean;
}

/** Result of a sprite cascade delete. */
export interface SpriteDeleteResult {
  sprite: {
    id: string;
    deleted: boolean;
  };
  deletedEntityDefinitions: string[];
  deletedObjectEntities: Array<{
    universeId: string;
    entityId: string;
  }>;
  clearedLayoutTemplates: string[];
}

/** Preview of what deleting an object type would cascade-delete. */
export interface ObjectTypeDeletePreview {
  wouldDelete: {
    objectType: {
      id: string;
      name: string;
    };
    objectEntities: AffectedObjectEntity[];
  };
  requiresCascade: boolean;
}

/** Result of an object type cascade delete. */
export interface ObjectTypeDeleteResult {
  objectType: {
    id: string;
    deleted: boolean;
  };
  deletedObjectEntities: Array<{
    universeId: string;
    entityId: string;
  }>;
}

/** Preview of what deleting a layout template would affect. */
export interface LayoutTemplateDeletePreview {
  wouldDelete: { template: string };
  dependencies: {
    places: Array<{ universeId: string; placeId: string; label: string }>;
  };
  blocked: boolean;
}

/** Preview of what deleting a template character would affect. */
export interface TemplateCharacterDeletePreview {
  wouldDelete: { template: string };
  dependencies: {
    scenarios: Array<{ scenarioId: string; label: string }>;
  };
  blocked: boolean;
}

/** Preview of what deleting a storyteller would affect. */
export interface StorytellerDeletePreview {
  wouldDelete: { storyteller: string };
  dependencies: {
    scenarios: Array<{ scenarioId: string; label: string }>;
    characters: Array<{ universeId: string; characterId: string; label: string }>;
  };
  blocked: boolean;
}
