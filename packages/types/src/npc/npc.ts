/**
 * NPC schedule and routine types.
 */

/**
 * Time periods for NPC schedules.
 * Maps to GameDate.timeOfDay values (dawn, morning/midday, afternoon, evening/dusk, night).
 */
export type TimePeriod = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Types of locations NPCs can be scheduled to be at.
 */
export type LocationType = 'home' | 'work' | 'leisure' | 'away';

/**
 * Reference to a location, either concrete (placeId) or abstract (description).
 * Used for lazy place generation - concrete places are created when needed.
 */
export interface LocationReference {
  /** Concrete PLACE_xxx if the location exists */
  placeId: string | null;
  /** Description of the location (e.g., "a cramped room above the tavern") */
  description: string;
  /** Geographic hint for exit placement (e.g., "the Undercroft") - matched via entity aliases */
  areaHint: string | null;
}

/**
 * A character's daily routine/schedule.
 * Defines where they should be at different times of day.
 */
export interface CharacterRoutine {
  /** Maps time periods to location types */
  schedule: Record<TimePeriod, LocationType>;
  /** Where the character lives */
  home: LocationReference;
  /** Where the character works (optional - not all characters have jobs) */
  work?: LocationReference;
  /** Leisure preferences for where they spend free time */
  leisure: {
    /** A specific favorite spot (e.g., their regular tavern) */
    favoriteSpot: LocationReference | null;
    /** Tag IDs for types of places they prefer (e.g., ["TAG_tavern", "TAG_temple"]) */
    preferredTagIds: string[];
  } | null;
  /** How much the character deviates from schedule (0.0 = punctual, 1.0 = unpredictable) */
  variance: number;
  /** Maps location types to activity definition IDs (FEAT-034). If absent, defaults are derived from place purpose. */
  activities?: Partial<Record<LocationType, string>>;
}

/**
 * A scheduled route that a captain runs.
 * Stored on the captain character (not the vessel) because captains are the ones
 * with navigation knowledge - vessels are just vehicles.
 */
export interface VesselRoute {
  /** Unique identifier for this route */
  id: string;
  /** Route name (e.g., "Duras Straits Run") */
  name: string | null;
  /** Ports of call in order */
  ports: string[]; // PLACE_xxx IDs
  /** Schedule: departure times from first port */
  departures: Array<{
    /** Day of week (0-6, where 0=Sunday) - if omitted, departs daily */
    day?: number;
    /** Hour (0-23) */
    hour: number;
  }>;
  /** Fare per leg (optional, for player reference) */
  farePerLeg: string | null;
}

/**
 * Represents a character's current abstract location.
 * Used when the character is at a location that doesn't have a concrete PLACE_ entity yet.
 */
export interface AbstractLocation {
  /** Type of location they're at */
  state: LocationType;
  /** Reference to where they are (may be abstract) */
  reference: LocationReference;
  /** ISO timestamp of when they arrived at this abstract location */
  since: string | null;
}

/**
 * A single step within an NPC activity definition.
 * Steps define what objects NPCs seek and how long they dwell there.
 * Use `"_wander"` as targetPurpose to trigger random-tile wandering.
 */
export interface NpcActivityStep {
  /** Object purpose to seek (e.g. "workspace", "seating", or "_wander" for random) */
  targetPurpose: string;
  /** Minimum dwell time at target in ms */
  dwellMin: number;
  /** Maximum dwell time at target in ms */
  dwellMax: number;
  /** Relative selection weight (higher = more likely to be picked) */
  weight: number;
}

/**
 * An NPC activity definition.
 * Defines a set of weighted steps that NPCs cycle through.
 */
export interface NpcActivityDef {
  /** Unique activity identifier (e.g. "shopkeeping", "tavern_leisure") */
  id: string;
  name: string;
  /** Weighted steps the NPC cycles through */
  steps: NpcActivityStep[];
}

/**
 * Sentinel purpose value that triggers random-tile wandering
 * instead of object-targeted movement.
 */
export const WANDER_PURPOSE = '_wander';

/**
 * Explicit NPC behavior state. Set by the arbiter during game logic
 * (e.g., "Follow me!" sets following, hostile chase sets following,
 * "Stay here" clears it). Used by overhead transitions to determine
 * which NPCs move with the player.
 */
export type NpcBehavior =
  | { mode: 'following'; targetCharacterId: string }
  | { mode: 'fleeing'; fromCharacterId: string }
  | { mode: 'guarding'; placeId: string }
  | { mode: 'hostile'; targetCharacterId: string };

/**
 * Visual category for physical states. Maps to concrete rendering treatments:
 * - elevated: climbing, perched, flying → upward arrow badge
 * - submerged: swimming, underwater, wading → wave badge
 * - concealed: hiding, sneaking → alpha 0.4 + speed × 0.5
 * - prone: lying down, crawling → horizontal bar badge
 * - mounted: riding a mount → mount badge (reserved)
 */
export type PhysicalStateCategory = 'elevated' | 'submerged' | 'concealed' | 'prone' | 'mounted';

/**
 * A character's current non-default physical state.
 * The category drives visual rendering; the label carries narrative detail.
 */
export interface PhysicalState {
  category: PhysicalStateCategory;
  /** Narrative description (e.g., "climbing the crow's nest", "hiding behind crates"). */
  label: string;
}

/**
 * Tracks when a character needs to leave but is in an active scene with the player.
 * Enables narrative departure instead of characters vanishing mid-conversation.
 */
export interface PendingDeparture {
  /** Where they need to go */
  destination: LocationReference;
  /** Why they need to leave (e.g., "shift starting", "closing time") */
  reason: string;
  /** How insistent they'll be about leaving */
  urgency: 'low' | 'medium' | 'high';
  /** ISO timestamp of when departure was first triggered */
  since: string;
}

/**
 * Tracks when a character needs to arrive at the player's location.
 * Enables narrative arrival instead of characters appearing suddenly.
 */
export interface PendingArrival {
  /** Where they're coming from (current location) */
  origin: LocationReference;
  /** Where they're trying to arrive (should be player's current location) */
  destination: LocationReference;
  /** Why they're arriving (e.g., "shift starting", "routine leisure") */
  reason: string;
  /** ISO timestamp of when arrival was first triggered */
  since: string;
}
