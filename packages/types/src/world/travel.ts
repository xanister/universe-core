/**
 * Travel and journey types.
 */

import type { PlannedCharacter, PlannedPlace, PlotTurningPoint } from '../npc/plot.js';

/**
 * A single segment of a multi-hop travel path.
 */
export interface TravelSegment {
  /** Place where this segment starts */
  fromPlaceId: string;
  /** Place where this segment ends */
  toPlaceId: string;
  /** Exit object used to traverse this segment (if any) */
  exitId: string | null;
  /** Distance of this segment in miles */
  distanceMiles: number;
}

/**
 * A complete travel path from origin to destination.
 * Used for multi-region travel tracking.
 */
export interface TravelPath {
  /** Ordered list of segments to traverse */
  segments: TravelSegment[];
  /** Total distance in miles */
  totalDistanceMiles: number;
  /** Estimated travel time in minutes (based on walking speed) */
  estimatedMinutes: number;
}

/**
 * Travel context for a character aboard a vessel.
 * Used to provide travel state information in arbiter prompts.
 * (Renamed from TravelContext in travel-time.ts)
 */
export interface VesselTravelContext {
  /** Whether the character is aboard a vessel */
  isAboardVessel: boolean;
  /** Vessel label (e.g., "The Ledgerwake") */
  vesselName: string | null;
  /** Vessel ID */
  vesselId: string | null;
  /** Vessel travel state */
  travelState: 'docked' | 'traveling' | null;
  /** If docked, the dock location label */
  dockedAt: string | null;
  /** If traveling, destination description */
  destinationDescription: string | null;
  /** If traveling, ETA as formatted game date */
  eta: string | null;
  /** If traveling, human-readable time remaining (e.g., "3 hours 20 min") */
  timeRemaining: string | null;
  /** If traveling, when the vessel departed (game date) */
  departedAt: string | null;
  /** If traveling, where the vessel departed from */
  departedFrom: string | null;
  /** If traveling, how long since departure (e.g., "6 hours ago") */
  timeSinceDeparture: string | null;
  /** Whether the character can pilot this vessel (has captain/helmsman tag or is at controls) */
  canPilot: boolean;
}

/**
 * Travel context when the player is on a vessel or character traversing a regional place.
 * Helps the storyteller generate travel-appropriate events.
 * (Renamed from TravelContext in storyteller-orchestrator.ts)
 */
export interface TransitContext {
  /** True if the player is currently in transit */
  isInTransit: true;
  /** The vessel's name (undefined for foot travel) */
  vesselName: string | null;
  /** The vessel's place ID (undefined for foot travel) */
  vesselId: string | null;
  /** Regional place ID being traversed (from entity.position.parent) */
  regionId: string | null;
  /** Transit environment description (e.g., "the open sea", "the frigid northern waters") */
  regionDescription: string;
  /** Where the journey is heading */
  destination: string;
  /** Current position description (e.g., "en route", "near origin") */
  positionDescription: string;
  /** Hours remaining until estimated arrival (if timed travel) */
  hoursRemaining: number | null;
}

/**
 * Context provided to the agent when storyteller triggers.
 * This is designed to be seamlessly incorporated into the DM's response.
 */
export interface StorytellerEventContext {
  /** Type of event to weave into the narrative */
  eventType: string;
  /** Guidance for the agent on how to incorporate the event */
  guidance: string;
  /** Current progress level (0-100) */
  progressLevel: number;
  /** Active story arcs for reference */
  activeArcs: Array<{ name: string; stage: number; maxStages: number }>;
  /** Suggested entities to involve (IDs of generated entities) */
  suggestedEntities: string[];
  /** The overarching plot (CONFIDENTIAL - never reveal) */
  plot: string;
  /** The active plot ID (for setting story flags) */
  plotId: string;
  /** Active planned characters who can appear (with descriptions for consistency) */
  activeCharacters: PlannedCharacter[] | null;
  /** Planned places (with descriptions for consistency) */
  activePlaces: PlannedPlace[] | null;
  /** Turning points that are ready to trigger */
  pendingTurningPoints: PlotTurningPoint[] | null;
  /** Travel context if player is on a vessel or character in transit through regional place */
  travelContext: TransitContext | null;
}

/**
 * Travel information for a character in transit.
 */
export interface TravelInfo {
  /** Whether the character is currently traveling */
  isInTransit: boolean;
  /** Name of the vessel if aboard one */
  vesselName: string | null;
  /** ID of the vessel if aboard one */
  vesselId: string | null;
  /** ID of the region being traveled through */
  regionId: string | null;
  /** Human-readable description of the region */
  regionDescription: string | null;
  /** Where they're heading */
  destinationDescription: string | null;
  /** Distance remaining in miles (if calculable) */
  distanceRemainingMiles: number | null;
  /** Estimated time remaining in hours (if calculable) */
  etaHours: number | null;
  /** Current speed in miles per hour */
  speedMph: number | null;
  /** Terrain type of the route */
  terrain: string | null;
}
