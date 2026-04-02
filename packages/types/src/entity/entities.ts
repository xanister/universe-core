/**
 * Core entity types: Character, Place, Object, Universe.
 */

import type { CalendarConfig } from '../world/calendar.js';
import type { GameMessage } from '../game/chat.js';
import type { Position, DistanceUnit, CharacterRelationship, RaceDefinition } from './core.js';
import type { UniverseEvent, JournalEntry, Sketch } from './events.js';
import type { UniverseMusicConfig, PlaceMusicHints } from '../ui/music.js';
import type { RulesetState } from '../combat/ruleset.js';
import type { LightSourceConfig } from '../world/object-types.js';
import type {
  CharacterRoutine,
  VesselRoute,
  AbstractLocation,
  NpcBehavior,
  PhysicalState,
  PendingDeparture,
  PendingArrival,
  TimePeriod,
} from '../npc/npc.js';
import type { StorytellerInstanceState } from '../npc/storyteller.js';
import type { TravelPath, TravelInfo } from '../world/travel.js';
import type {
  WeatherCondition,
  TemperatureBand,
  ClimateConfig,
  EnvironmentConfig,
} from '../world/weather.js';
import type { Purpose } from '../world/entity-registry.js';

/**
 * Interaction model for entities.
 * The typeId references a code-defined interaction type in the interaction registry
 * (packages/game/src/interactions/). All behavioral logic (prereqs, resolution)
 * lives in the registry, not on the entity data.
 */
export interface EntityInteraction {
  /** Interaction type ID (e.g., 'enter', 'talk', 'examine', 'helm', 'dock_enter'). */
  typeId: string;
}

/**
 * Contextual actions available based on player/vessel state.
 * Not tied to a specific entity -- computed server-side and sent to the client.
 * Extensible: add new kinds (camp, dive, surface, etc.) as needed.
 */
export type ContextualAction = { kind: 'navigate'; targetPlaceId: string; label: string };

export interface BaseEntity<TInfo extends object = object> {
  id: string;
  label: string;
  description: string;
  important: boolean;
  short_description: string; // For characters: observable traits only - physical features and visible professions (e.g., "tall human guard"), never hidden roles (thief, spy). For exits: just the exit type (e.g., "door", "tunnel").
  tags: string[];
  entityType: string;
  info: TInfo;
  /**
   * Unified position relative to parent place.
   * - For characters: which place they're in, optionally with x,y coordinates within that place
   * - For places: position within parent place (null parent = root)
   * - For objects/exits: position within source place (for map visualization)
   */
  position: Position;
  /**
   * Destination place ID - if set, entity is traveling toward this place.
   * Position is updated incrementally each time tick until arrival.
   * Cleared when entity arrives at destination.
   *
   * Used for all travel:
   * - Vessel travel (ships, airships, caravans)
   * - Character travel (foot, mounted, etc.)
   */
  destinationPlaceId: string | null;
  /**
   * Planned travel path for multi-hop journeys.
   * Contains ordered list of segments to traverse.
   * Cleared when journey completes or is cancelled.
   */
  travelPath: TravelPath | null;
  /**
   * Current segment index in travelPath (0-based).
   * Incremented as each segment is completed.
   * Cleared when journey completes or is cancelled.
   */
  travelSegmentIndex: number | null;
  relationships: CharacterRelationship[];
  image: string | null;
  /** Normalized Y position of face center (0.0 = top, 1.0 = bottom) for avatar cropping. */
  faceAnchorY: number | null;
  omitFromPlot: boolean;
  aliases: string[] | null;
  displayName: string | null;
  /**
   * Unified interaction model. Determines what happens when a player activates this entity.
   * Null means non-interactable.
   */
  interaction: EntityInteraction | null;
}

/**
 * Character kind - physical form/nature of the character.
 * Role (merchant, guard, etc.) goes in the entity's purpose/description.
 *
 * Expand as needed: 'construct', 'undead', 'elemental', 'aberration'
 */
export const CHARACTER_KINDS = [
  'humanoid', // Human-like form: humans, elves, dwarves, orcs, etc.
  'animal', // Natural creatures: dogs, horses, birds, fish
  'undead', // Animated dead: skeletons, zombies, wraiths
] as const;

export type CharacterKind = (typeof CHARACTER_KINDS)[number];

/**
 * Sprite layer configuration for LPC-style character sprites.
 * Each layer represents a composited element (body, clothes, hair, etc.)
 */
export interface SpriteLayerConfig {
  type: string;
  optionId: string;
  /** Hex number, e.g. 0xFF0000 for red */
  tint: number | null;
}

/**
 * Container capacity and allowed-type constraints for a container slot.
 * Stored in slot-registry.json per container slot (belt, behind_body, etc.).
 */
export interface ContainerConfig {
  /** Maximum number of items this container can hold. */
  capacity: number;
  /** Item types this container accepts. */
  allowedTypes: Array<ContainedItem['type']>;
}

/**
 * An item stored inside a container slot (e.g. a weapon in a belt, a potion in a backpack).
 * All character items live in container slots — there is no flat inventory array.
 */
export interface ContainedItem {
  /** Unique item instance ID. */
  id: string;
  /** Item key: weapon definition ID, clothing-data.json key, etc. */
  itemId: string;
  /** Display name for UI and LLM context. */
  name: string;
  /** Brief description. Null for items without descriptions. */
  description: string | null;
  /** Item category for filtering, routing, and container acceptance. */
  type: 'weapon' | 'clothing' | 'consumable' | 'generic';
  /** Stack count. 1 for non-stackable items. */
  quantity: number;
  /** Optional hex tint color. */
  color: string | null;
  /** Target equipment slot when drawn/equipped (e.g. "weapon", "torso_under"). Null for non-equippable items. */
  equipSlot: string | null;
  /** Plot that spawned this item. Non-null = quest/plot item. Propagated through pickup/drop. */
  plotId: string | null;
  /** Light source config from the source object. Propagated through pickup/drop. FEAT-399 */
  lightSource?: LightSourceConfig | null;
}

/**
 * A single clothing slot on a character.
 * Resolved once at creation time -- no random resolution at render time.
 *
 * Also used for weapon equipment: `{ slot: 'weapon', itemId: weaponDefinitionId, color: null }`.
 * Container slots (e.g. belt) may hold items in `contents` that are not visible on the sprite.
 */
export interface ClothingSlot {
  /** Slot ID from the slot registry (e.g., "torso_under", "legs", "feet", "weapon"). */
  slot: string;
  /** Item key: clothing-data.json key for clothing, weapon definition ID for weapons. */
  itemId: string;
  /** Optional hex tint color (e.g., "#8B4513"). Null = no tint. */
  color: string | null;
  /** Items stored inside this container slot. Null for non-container slots. */
  contents: ContainedItem[] | null;
}

/**
 * Extract the equipped weapon definition ID from a character's clothing/equipment array.
 * Returns null when no weapon slot is present (= weapon not drawn / unarmed).
 */
export function getEquippedWeaponId(clothing: ClothingSlot[]): string | null {
  const weaponSlot = clothing.find((c) => c.slot === 'weapon');
  return weaponSlot?.itemId ?? null;
}

/**
 * Find the character's weapon whether drawn (weapon slot) or sheathed in any container.
 * Searches weapon slot first, then all container slots.
 * Returns null when the character has no weapon at all.
 */
export function getCharacterWeaponId(clothing: ClothingSlot[]): string | null {
  const drawn = getEquippedWeaponId(clothing);
  if (drawn) return drawn;

  for (const slot of clothing) {
    if (!slot.contents) continue;
    const weapon = slot.contents.find((item) => item.type === 'weapon');
    if (weapon) return weapon.itemId;
  }
  return null;
}

const DEFAULT_BELT_ITEM = 'leather_belt';

/** Generate a unique contained item instance ID. */
export function generateContainedItemId(): string {
  return `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Move any top-level weapon slot entry into belt contents (sheathed).
 * Ensures the character has a belt; creates a default one if missing.
 * Mutates and returns the clothing array.
 *
 * @param getWeaponName - Optional resolver for weapon display names. Falls back to itemId.
 */
export function normalizeWeaponToBelt(
  clothing: ClothingSlot[],
  getWeaponName?: (itemId: string) => string,
): ClothingSlot[] {
  const weaponIdx = clothing.findIndex((c) => c.slot === 'weapon');
  if (weaponIdx === -1) return clothing;

  const weaponSlot = clothing[weaponIdx];
  clothing.splice(weaponIdx, 1);

  let belt = clothing.find((c) => c.slot === 'belt');
  if (!belt) {
    belt = { slot: 'belt', itemId: DEFAULT_BELT_ITEM, color: null, contents: [] };
    clothing.push(belt);
  }
  if (!belt.contents) belt.contents = [];
  belt.contents.push({
    id: generateContainedItemId(),
    itemId: weaponSlot.itemId,
    name: getWeaponName ? getWeaponName(weaponSlot.itemId) : weaponSlot.itemId,
    description: null,
    type: 'weapon',
    quantity: 1,
    color: weaponSlot.color,
    equipSlot: 'weapon',
    plotId: null,
  });

  return clothing;
}

/** Check if a clothing slot is a container (has a contents array). */
export function isContainerSlot(slot: ClothingSlot): boolean {
  return slot.contents !== null;
}

/** Count items inside a single container slot. */
export function getContainedItemCount(slot: ClothingSlot): number {
  return slot.contents?.length ?? 0;
}

/** Collect all contained items across all container slots. */
export function getAllContainedItems(clothing: ClothingSlot[]): ContainedItem[] {
  return clothing.flatMap((s) => s.contents ?? []);
}

/**
 * Remove a contained item by instance ID from any container slot.
 * Mutates the clothing array. Returns the removed item or null if not found.
 */
export function removeItemFromContainers(
  clothing: ClothingSlot[],
  itemInstanceId: string,
): ContainedItem | null {
  for (const slot of clothing) {
    if (!slot.contents) continue;
    const idx = slot.contents.findIndex((i) => i.id === itemInstanceId);
    if (idx !== -1) {
      return slot.contents.splice(idx, 1)[0];
    }
  }
  return null;
}

/**
 * Decrement a stackable item's quantity, or remove it entirely if quantity is 1.
 * Mutates the clothing array. Returns the affected item (still in-place if
 * decremented, removed if quantity was 1) or null if not found.
 */
export function decrementOrRemoveItem(
  clothing: ClothingSlot[],
  itemInstanceId: string,
): ContainedItem | null {
  for (const slot of clothing) {
    if (!slot.contents) continue;
    const idx = slot.contents.findIndex((i) => i.id === itemInstanceId);
    if (idx !== -1) {
      const item = slot.contents[idx];
      if (item.quantity > 1) {
        item.quantity -= 1;
        return item;
      }
      return slot.contents.splice(idx, 1)[0];
    }
  }
  return null;
}

/**
 * Find the first container slot that can accept an item of the given type.
 * Uses container configs from the slot registry to check capacity and allowed types.
 * Returns null if no container has room.
 */
export function findFirstContainerWithCapacity(
  clothing: ClothingSlot[],
  itemType: ContainedItem['type'],
  containerConfigs: Partial<Record<string, ContainerConfig>>,
): ClothingSlot | null {
  for (const slot of clothing) {
    if (slot.contents === null) continue;
    const config = containerConfigs[slot.slot];
    if (!config) continue;
    if (!config.allowedTypes.includes(itemType)) continue;
    if (slot.contents.length >= config.capacity) continue;
    return slot;
  }
  return null;
}

/** List all weapons across all container slots (not drawn weapon slot). */
export function getAvailableWeapons(clothing: ClothingSlot[]): ContainedItem[] {
  return getAllContainedItems(clothing).filter((i) => i.type === 'weapon');
}

/**
 * Character sprite configuration.
 * Defines the visual appearance of a character in the game world.
 */
export interface CharacterSpriteConfig {
  bodyType: string;
  layers: SpriteLayerConfig[];
  spriteHash: string | null;
  spriteUrl: string | null;
  /** Per-race visual scale multiplier (default 1.0). Composes with per-layout characterScale. */
  spriteScale: number;
}

export interface CharacterInfo {
  /** Functional role of this character (e.g., 'player', 'npc', 'bartender', 'guard'). */
  purpose: string;
  aliases: string[];
  birthdate: string;
  birthPlace: string;
  deathdate: string | null;
  eyeColor: string;
  gender: string;
  hairColor: string;
  /** Hair style pattern name (e.g., 'ponytail', 'bangs', 'mohawk'). Independent of hairColor. */
  hairStyle: string;
  /** Beard/facial hair shape (e.g., 'beard', 'mustache', 'medium'). Null = clean-shaven. */
  beardStyle: string | null;
  /** Head type from v3 character bases (e.g., 'human_male', 'orc_female', 'wolf_male'). */
  headType: string;
  skinTone: string;
  personality: string;
  race: string;
  title: string | null;
  messages: GameMessage[];
  conversationContext: string | null;
  journal: JournalEntry[];
  sketches: Sketch[];
  storytellerState: StorytellerInstanceState | null;
  isPlayer: boolean;
  /** Response verbosity 1-5. Player character setting. */
  verbosity: number;
  voiceId: string;
  storyComplete: boolean;
  routine: CharacterRoutine | null;
  vesselRoutes: VesselRoute[] | null;
  abstractLocation: AbstractLocation | null;
  npcBehavior: NpcBehavior | null;
  /** Current non-default physical state (climbing, swimming, sneaking, etc.). Null = normal standing. */
  physicalState: PhysicalState | null;
  pendingDeparture: PendingDeparture | null;
  pendingArrival: PendingArrival | null;
  lastRoutineCheckPeriod: TimePeriod | null;
  startingNarrative: string | null;
  startingCharacterState: string | null;
  spriteConfig: CharacterSpriteConfig;
  /** Explicit per-slot clothing items with optional tint colors. Empty array = no clothing. */
  clothing: ClothingSlot[];
  /** Active overlay layers for sprite generation (e.g., ["eyes"] or ["eyes", "nose"]). */
  enabledOverlayLayers: string[];
  /** Vessel this character is actively helming (player or NPC). Null when not at the helm. */
  helmingVesselId: string | null;
  /** Ruleset-owned mechanical state (stats, conditions, usage tracking). */
  rulesetState: RulesetState;
  /** Dev tool: when true, `arbitrateStoryteller()` is skipped for this character. */
  storytellerDisabled: boolean;
  /**
   * ID of the ObjectEntity this character sleeps at.
   * Assigned during slot population after home resolution.
   * Absent when no sleeping object was available at generation time —
   * runtime falls back to nearest-match scan.
   */
  assignedBedId?: string;
  /**
   * ID of the ObjectEntity this character works at.
   * Assigned during slot population from the work place's objects.
   * Absent when no matching workspace object was available at generation time —
   * runtime falls back to nearest-match scan.
   */
  assignedWorkspaceId?: string;
  /**
   * Activity step purpose that `assignedWorkspaceId` serves (e.g. "workspace", "exit").
   * Stored alongside the ID so the runtime can build a purpose → objectId map without
   * needing the purposes registry.
   */
  assignedWorkspacePurpose?: string;
}

export interface Character extends BaseEntity<CharacterInfo> {
  info: CharacterInfo;
}

/**
 * Sprite configuration for object instances.
 * Allows overriding type catalog defaults.
 */
export interface ObjectSpriteConfig {
  /** Override sprite sheet ID */
  spriteId: string | null;
  /** Override frame */
  frame: string | number | null;
  /** Override animation */
  animationKey: string | null;
  /** Whether the sprite is animated */
  animated: boolean;
  /** Direction for directional sprites (north/south/east/west). Used to pick from sprite.directions. Optional; null or absent means default south facing. */
  facing?: 'north' | 'south' | 'east' | 'west' | null;
}

/**
 * Object info for static scenery, obstacles, and exits.
 * Objects are rendered in the game world and can optionally block movement.
 *
 * Note: Collision dimensions (width, height, offsetX, offsetY) are now stored
 * in the entity's `position` field, not in ObjectInfo.
 */
export interface ObjectInfo {
  /**
   * Functional purpose of this object (e.g., "seating", "storage", "exit").
   * Used for slot matching during generation.
   * References Entity Registry definitions.
   */
  purpose: Purpose;
  /**
   * System-only object, hidden from players (e.g. requires vessel to traverse).
   * Set from layout template slot configuration during generation.
   */
  isStructural: boolean;
  /**
   * Whether this object blocks movement.
   * Set to false for objects that should be rendered but allow walk-through (e.g., grass, puddles, exits).
   */
  solid: boolean;
  /**
   * Rendering layer for depth sorting.
   * - 'floor': Always renders below characters (rugs, floor markings)
   * - 'default': Y-sorted with characters (furniture, trees)
   * - 'overhead': Always renders above characters (bridges, archways)
   */
  layer: 'floor' | 'default' | 'overhead' | 'wall';
  /**
   * Sprite configuration for rendering this object.
   * References Entity Registry sprite definitions.
   */
  spriteConfig: ObjectSpriteConfig;
  /**
   * Material for this instance (e.g., "oak", "iron", "cloth").
   * Overrides type catalog default.
   */
  material: string | null;
  /**
   * Current HP for destructible objects.
   * If not set, uses maxHp from type catalog.
   */
  hp: number | null;
  /**
   * Maximum HP (overrides type catalog default).
   */
  maxHp: number | null;
  /**
   * Color tint override (hex number, e.g., 0x8B4513 for brown).
   */
  tint: number | null;
  /**
   * Current object state: "open", "closed", "broken", "lit", etc.
   * Valid states defined in type catalog.
   */
  state: string | null;
  /**
   * For containers: IDs of items inside.
   */
  contents: string[] | null;
  /**
   * Light source configuration stamped from object type catalog.
   * Null = this object does not emit light.
   */
  lightSource: LightSourceConfig | null;
  /**
   * Unified item registry ID for pickup objects.
   * When set, this object can be picked up and becomes a ContainedItem.
   * The item's type, equipSlot, and name are resolved from the registry at pickup time.
   */
  itemId: string | null;
  /**
   * Plot that spawned this object. Non-null = quest/plot item.
   * Propagated to ContainedItem on pickup and back to ObjectInfo on drop.
   */
  plotId: string | null;
}

/**
 * Object: static scenery and obstacles in the game world.
 * File naming: OBJ_{descriptive_name}.json
 *
 * Objects have:
 * - Position within a place (entity.position.x, y, parent)
 * - Optional collision bounds in position (position.width, height, offsetX, offsetY)
 * - Optional sprite/image for rendering
 * - Depth layer for proper rendering order (info.layer)
 */
export interface ObjectEntity extends BaseEntity<ObjectInfo> {
  entityType: 'object';
  info: ObjectInfo;
}

// EnvironmentConfig, presets, and helpers are exported from weather.ts.
// PlaceEnvironment string enum has been replaced by EnvironmentConfig object (FEAT-044).

/**
 * Minimum hierarchy requirements for place structure.
 *
 * Defines the minimum count and valid parent kinds for each hierarchy level.
 * Used by validators to detect and repair insufficient hierarchy scaffolding.
 *
 * Cosmos (purpose 'cosmos') is the root of the hierarchy with null parent.
 * Template slot definitions (min/max) define minimum hierarchy requirements.
 */
export type PlaceInfo = {
  /**
   * Functional purpose of this place (e.g., "lodging", "leisure", "cooking").
   * Used for slot matching during generation.
   * References Entity Registry definitions.
   */
  purpose: Purpose;
  /**
   * Environment configuration - determines weather, temperature, and atmosphere behavior.
   * Use helpers: isEnclosed(), hasAtmosphericWeather(), getEnvironmentLabel().
   * Use presets: ENVIRONMENT_PRESETS.interior(), etc.
   */
  environment: EnvironmentConfig;
  /**
   * Distance unit for this place's size AND all positions within it.
   * REQUIRED on all places. Typical values:
   * - 'feet': Indoor spaces, ship decks, small outdoor areas
   * - 'miles': Wilderness, seas, continents, planetary surfaces
   * - 'lightyears': Deep space, galactic regions
   */
  scale: DistanceUnit;
  /**
   * Sprite configuration for rendering this place on maps.
   * References Entity Registry sprite definitions.
   */
  spriteConfig: {
    spriteId: string;
    facing: 'north' | 'south' | 'east' | 'west';
    layer: 'floor' | 'default' | 'overhead' | 'wall';
  };
  music: string | null;
  musicHints: PlaceMusicHints | null;
  /** Revealed at familiarity 20+ (heard of). */
  commonKnowledge: string | null;
  /** Revealed at familiarity 50+ (visited). */
  secrets: string | null;
  /** Generated mid-transit (e.g. "adrift"); can be cleaned up when empty. */
  isTemporary: boolean;
  /** When non-null, this vessel is docked at the specified place. Cleared when helm is taken. */
  dockedAtPlaceId: string | null;
  /** Game-minutes per real second of time passage in this place. Set from layout template at generation time. */
  timeScale: number;
  /** AI-generated battle background image URL on S3. Empty string when not yet generated. */
  battleBackgroundUrl: string;
  /**
   * Tags inherited from ancestor layout slots that get merged into this place's layout slots.
   * Computed during child place creation as the union of the parent place's inheritedRequiredTags
   * and the slot's inheritableTags. During layout generation, these tags are merged into every
   * generated slot's requiredTags.
   * Null = no inherited tag requirements (default for top-level places).
   */
  inheritedRequiredTags: string[] | null;
} & Record<string, unknown>;

export interface Place extends BaseEntity<PlaceInfo> {
  info: PlaceInfo;
}

/**
 * Location data for a character.
 * Fetched via REST endpoint, updated via WebSocket on movement/changes.
 * Contains the current place and nearby entities (characters, exits, etc.).
 */
export interface Location {
  place: Place;
  nearby: BaseEntity[];
  music: string | null;
  weather: WeatherCondition | null;
  /** Intensity of the current weather condition (0-1 continuous). Null when weather is null. */
  weatherSeverity: number | null;
  season: string | null;
  temperature: number | null;
  temperatureBand: TemperatureBand | null;
  /** Normalized (0-1) for map display; only set when character has world coordinates. */
  playerPosition: { x: number; y: number } | null;
  /** Raw pixel position of the character in the place. Authoritative source after movement. */
  characterPixelPosition: { x: number; y: number } | null;
  /** Continuous 0-1 fraction through the day cycle (0 = midnight, 0.5 = noon). Drives ambient darkness. */
  dayFraction: number;
  travel: TravelInfo | null;
  /** Place layout for feet-scale places (tilemap only). Generated on first visit. */
  placeLayout: import('../world/place-layout.js').PlaceLayout | null;
  /** Object placements for rendering. Built at runtime from entity data. */
  objectPlacements: import('../world/place-layout.js').ObjectPlacement[] | null;
  /** Sprite registry for rendering objects. Single source of truth for sprite coords. */
  spriteRegistry: import('../world/object-types.js').SpriteRegistry | null;
  /** Non-null when the player is at the helm of a vessel (controls the vessel on the overworld). */
  helming: {
    vesselId: string;
    vesselName: string;
    spriteId: string;
  } | null;
  /** Contextual actions available based on player/vessel state (e.g., "Leave Sol System"). */
  contextualActions: ContextualAction[] | null;
  /** Player character's current physical state (elevated, submerged, concealed, etc.). Null = normal. */
  physicalState: import('../npc/npc.js').PhysicalState | null;
  /** Light config from carried light-emitting items (e.g. torch). Null when not carrying a light source. */
  playerLightSource: LightSourceConfig | null;
}

export interface Universe {
  id: string;
  name: string;
  version: string;
  description: string;
  custom: Record<string, string>;
  rules: string;
  tone: string;
  style: string;
  mapStyle: string | null;
  image: string | null;
  date: string;
  calendar: CalendarConfig | null;
  weather: WeatherCondition | null;
  /** Intensity of the current weather condition (0-1 continuous). Null when weather is null. */
  weatherSeverity: number | null;
  climate: ClimateConfig | null;
  music: UniverseMusicConfig | null;
  races: RaceDefinition[];
  characters: Character[] | null;
  places: Place[] | null;
  objects: ObjectEntity[] | null;
  events: UniverseEvent[] | null;
  rootPlaceId: string;
  defaultStartPlaceId: string | null;
  /** Staging marker sprite theme (e.g. 'fantasy', 'scifi', 'modern'). FEAT-132 */
  stagingSpriteTheme: string;
  /** Whether hunger and fatigue vital tracks accumulate. When false, hunger/fatigue are disabled for all characters. */
  hungerFatigueEnabled: boolean;
  /** ID of the active GameRuleset for this universe. Null means no ruleset. */
  rulesetId: string | null;
}

/**
 * Minimal interface for modules that need to look up places.
 * Used by position.ts and map-image-service.ts to avoid importing UniverseContext directly.
 */
export interface PlaceLookupContext {
  findPlace(placeId: string): Place | undefined;
}

/**
 * Minimal interface for modules that need place and exit lookups.
 * Used by map-image-service.ts to avoid importing UniverseContext directly.
 */
export interface MapGenerationContext extends PlaceLookupContext {
  universeId: string;
  universe: Universe;
  places: Place[];
  getExitsFromPlace(placeId: string): ObjectEntity[];
  upsertEntity(type: 'place', entity: Place): void;
}
