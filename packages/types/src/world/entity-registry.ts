/**
 * Entity Registry Types
 *
 * Defines the schema for the unified Entity Registry that contains all
 * entity definitions (objects, places, exits) that can fill slots.
 *
 * Replaces: object catalog (catalog.json), placeType, objectKind, objectTypeId
 */

import type { PlaceScale } from './place-templates.js';
import type { EnvironmentConfig } from './weather.js';
import type { TimePeriod, LocationType } from '../npc/npc.js';
import type { LightSourceConfig } from './object-types.js';

/**
 * Purpose type - managed dynamically via the purpose registry (purposes.json).
 *
 * Slots define supported purposes. Entities have a purpose.
 * Generation matches entities to slots by purpose.
 *
 * Whether an entity is a "place" (can be entered) is determined by whether
 * a layout template exists for that purpose.
 */
export type Purpose = string;

/**
 * A proximity-based behavior reaction for character purposes.
 * When a player enters `detectionRange` tiles of a character with this purpose,
 * the specified `NpcBehavior` mode is applied. When the player exits `clearRange`
 * tiles, the behavior is cleared and ambient movement resumes.
 */
export interface ProximityReaction {
  /** Tile radius within which the player triggers this reaction */
  detectionRange: number;
  /** Behavior to apply: 'hostile' = pursue player; 'flee' = move away */
  reaction: 'hostile' | 'flee';
  /** Tile radius beyond which the reaction is cleared */
  clearRange: number;
}

/**
 * Purpose category - whether a purpose applies to objects, places, characters, or creatures.
 */
export type PurposeCategory = 'object' | 'place' | 'character';

/**
 * A purpose definition from the purpose registry.
 * Shared type used by server API, admin UI, and generation.
 */
export interface PurposeDefinition {
  /** Unique purpose identifier (e.g., "seating", "exit", "airlock") */
  id: string;
  /** Human-readable label */
  label: string;
  /** Description of this purpose */
  description: string;
  /** Whether this purpose applies to objects, places, or characters */
  category: PurposeCategory;
  /**
   * Interaction type ID for entities with this purpose (e.g., 'enter', 'helm', 'talk').
   * References a code-defined interaction type in the interaction registry.
   * Null for non-interactive purposes.
   */
  interactionTypeId: string | null;
  /**
   * Default NPC activity definition ID for character purposes (e.g., 'tavern_work', 'guard_duty').
   * Used by slot-based routine generation to assign work activities.
   * Null for non-character purposes.
   */
  defaultActivityId: string | null;
  /**
   * Default daily schedule for character purposes.
   * Maps time periods to location types (home, work, leisure, away).
   * Used by slot-based routine generation.
   * Null for non-character purposes.
   */
  defaultSchedule: Record<TimePeriod, LocationType> | null;
  /**
   * Proximity-based behavior reactions for this purpose.
   * Each entry describes a distance threshold and the behavior to apply
   * when the player enters/exits that range. Evaluated every tick.
   * Absent or empty = no proximity reactions (humanoid NPCs).
   */
  proximityReactions?: ProximityReaction[];
  /**
   * Whether social walk (NPC-to-NPC greeting/conversation movement) is enabled
   * for this purpose. Defaults to true. Set false for creature purposes that
   * should not exhibit humanoid social behavior (rats, undead, etc.).
   */
  socialWalkEnabled?: boolean;
  /**
   * Whether this purpose has special-case code that depends on its ID.
   * System purposes cannot be deleted from the admin UI or API.
   */
  system: boolean;
  /**
   * When set and > 0, characters with this purpose draw from a shared portrait pool
   * instead of generating a unique portrait each time. The value is the target pool size
   * per universe. First N characters generate normally and populate the pool; subsequent
   * characters reuse a random portrait from the pool (no OpenAI call).
   * Null or 0 = no pooling (default behavior).
   */
  portraitPoolSize: number | null;
  /**
   * Whether characters with this purpose prefer on-site quarters (bedroom in their workplace)
   * over off-site housing. Used by home-resolution (FEAT-442) to prioritize child bedrooms
   * of the work place before searching sibling residences.
   */
  preferOnSiteQuarters?: boolean;
  /**
   * Default leisure venue tag IDs for characters with this purpose.
   * Used by leisure-assignment (FEAT-443) to find a matching venue among sibling places.
   * e.g. ["TAG_workplace_tavern"] means the character prefers taverns for leisure time.
   */
  defaultLeisureTagIds?: string[];
  /**
   * The object purpose that serves as this character's primary workspace object.
   * When set, slot population assigns the first unclaimed object of this purpose
   * in the work place to `assignedWorkspaceId` on the character.
   * Absent means this character has no assignable workspace object
   * (assignment is skipped; runtime uses nearest-match).
   * e.g. "workspace" for bartender/merchant; "exit" for guard.
   */
  defaultWorkspacePurpose?: string;
}

/**
 * Rendering layer for depth sorting.
 */
export type RenderLayer = 'floor' | 'default' | 'overhead' | 'wall';

/**
 * Base definition for all entities in the registry.
 */
export interface EntityDefinitionBase {
  /** Functional purpose - what this entity is for */
  purpose: Purpose;

  /** Sprite ID for rendering. Null for invisible marker objects (e.g. player_start). */
  sprite: string | null;

  /** Human-readable name */
  name: string | null;

  /** Description for LLM context */
  description: string | null;

  /** Tags for modifier matching (e.g., ["fancy", "common", "royal"]) */
  tags: string[] | null;
}

/**
 * Object entity definition - entities that don't contain other things.
 * These are furniture, containers, decorations, exits, etc.
 */
export interface ObjectEntityDefinition extends EntityDefinitionBase {
  /** Valid materials for tinting/variation */
  materials: string[] | null;

  /** Whether this object blocks movement */
  solid: boolean;

  /** Rendering layer for depth sorting */
  layer: RenderLayer | null;

  /** Whether the sprite can be tinted */
  tintable: boolean;

  /** Whether this object can contain items */
  canContain: boolean;

  /** Valid states for the object (e.g., ["open", "closed", "locked"]) */
  states: string[] | null;

  /** Light source configuration (torches, campfires, lanterns). Null = no light. */
  lightSource: LightSourceConfig | null;
}

/**
 * Place entity definition - entities that have internal layouts.
 * These appear as entrances (doors, buildings) in their parent place.
 */
export interface PlaceEntityDefinition extends EntityDefinitionBase {
  /** Scale for the internal layout (inherited by Layout Template) */
  scale?: PlaceScale;

  /** Environment config (inherited by Layout Template) */
  environment?: EnvironmentConfig;
}

/**
 * Union type for all entity definitions.
 * Place vs Object is determined by whether the entity has a Layout Template.
 */
export type EntityDefinition = ObjectEntityDefinition | PlaceEntityDefinition;

/**
 * Complete Entity Registry - contains all entity definitions.
 * Keyed by entity ID (e.g., "chair", "bedroom", "tavern").
 */
export interface EntityRegistry {
  /** Schema version */
  version: string;

  /** Description of the registry */
  description: string | null;

  /** All entity definitions */
  definitions: Record<string, EntityDefinition>;
}

/**
 * Slot definition - what can be placed in a slot.
 */
export interface SlotDefinition {
  /** Purpose to match (e.g., "seating", "lodging") */
  purpose: Purpose;

  /** Modifier to filter by tag (e.g., "fancy") */
  modifier: string | null;

  /** Probability this slot gets filled (0.0 - 1.0, default 1.0) */
  chance: number | null;

  /** Maximum count for this purpose in the layout */
  max: number | null;

  /** Minimum count required for this purpose */
  min: number | null;
}

/**
 * Variant of a layout template.
 * Allows for size/complexity variations (e.g., small/standard/large tavern).
 */
export interface LayoutTemplateVariant {
  /** Unique identifier for this variant */
  id: string;

  /** Scale for positions in this layout */
  scale: PlaceScale;

  /** Environment config */
  environment: EnvironmentConfig;

  /** Slots that can be filled in this layout */
  slots: SlotDefinition[];

  /** Human-readable description for LLM context */
  description: string | null;

  /** Selection weight when randomly choosing variants (default 1) */
  weight: number | null;
}

/**
 * Layout template definition for the entity registry.
 * Defines the internal structure - what slots it has.
 */
export interface LayoutTemplateRegistryEntry {
  /** Available variants for this layout */
  variants: LayoutTemplateVariant[];
}

/**
 * Complete Layout Template catalog.
 * Keyed by entity ID (e.g., "tavern", "bedroom").
 * Only entities with entries here are "places" (can be entered).
 */
export type LayoutTemplateCatalog = Record<string, LayoutTemplateRegistryEntry>;
