/**
 * Agent Tools Types
 *
 * Defines the context and result types for agentic tools.
 * Tools use these interfaces to interact with the game engine
 * without tight coupling to specific implementations.
 */

import type {
  ArbiterOutcome,
  CreatedCharacterInfo,
  CreatedExitInfo,
  GameMessage,
  ClassificationResult,
} from '@dmnpc/types/game';
import type {
  CalendarConfig,
  StorytellerEventContext,
  VesselTravelContext,
} from '@dmnpc/types/world';
import type { Character, JournalEntry, ObjectEntity, Place } from '@dmnpc/types/entity';
import type { StorytellerDefinition } from '@dmnpc/types/npc';
import type { ToolServices } from './services/index.js';

export interface UniverseContextInterface {
  universeId: string;
  universe: {
    calendar: CalendarConfig | null;
    date: string;
    [key: string]: unknown;
  };
  characters: Character[];
  places: Place[];
  exits: ObjectEntity[];

  findCharacter(id: string): Character | undefined;
  findPlace(id: string): Place | undefined;
  /** Throws if not found. */
  getPlace(id: string): Place;
  /** Throws if not found. */
  getCharacter(id: string): Character;
  findExit(id: string): ObjectEntity | undefined;
  updateUniverse(updates: Record<string, unknown>): void;
  upsertEntity(type: 'character' | 'place' | 'exit', entity: unknown): void;
  recordVisit(characterId: string, placeId: string, gameDate: string): void;
  getEntitiesByPlace(
    placeId: string,
    excludeId?: string,
    proximityMeters?: number,
  ): (Character | ObjectEntity)[];
}

export type { ArbiterOutcome, CreatedExitInfo, CreatedCharacterInfo };

/**
 * An entity that needs to be created for the scene.
 */
export interface ToolDeclaredEntity {
  type: 'character' | 'exit' | 'place';
  name: string;
  role: string;
  description: string;
  shouldSpeak?: boolean;
  plotCharacterId?: string;
  entityId?: string;
  locationHint?: string;
  isInCurrentScene?: boolean;
  exitType?: string;
  targetDescription?: string;
  targetPlaceName?: string;
  parentId?: string;
}

export type ToolStateChange =
  | { type: 'advance_time'; minutes: number; reason: string }
  | { type: 'travel'; destinationId: string; characterId?: string; elapsedMinutes?: number }
  | { type: 'move'; characterId: string; nearEntityId: string }
  | { type: 'update_disposition'; characterId: string; targetId: string; delta: number }
  | {
      type: 'add_inventory';
      characterId: string;
      itemId: string;
      customName?: string;
      customDescription?: string;
    }
  | { type: 'remove_inventory'; characterId: string; itemId: string }
  | { type: 'transfer_item'; sourceCharacterId: string; targetCharacterId: string; itemId: string }
  | { type: 'trigger_storyteller_event' }
  | { type: 'create_entity'; entity: ToolDeclaredEntity }
  | { type: 'create_event'; event: unknown; witnessIds: string[] }
  | { type: 'generate_sketch'; focus?: string }
  | { type: 'generate_journal' }
  | { type: 'generate_music' }
  | { type: 'set_npc_behavior'; characterId: string; behavior: unknown }
  | {
      type: 'set_physical_state';
      characterId: string;
      physicalState: { category: string; label: string } | null;
    };

/**
 * A contribution to the scene from a specific source.
 */
export interface ToolSceneContribution {
  source: 'player_action' | 'storyteller_event' | 'environment' | 'npc_reaction';
  actions?: unknown[];
  description: string;
  outcome: ArbiterOutcome;
  outcomeReason?: string;
  speakerId?: string;
  guidance?: string;
}

export interface ToolArbiterResult {
  stateChanges: ToolStateChange[];
  sceneContributions: ToolSceneContribution[];
  rejectionReason?: string;
  flagsToSet?: string[];
}

/**
 * Result of entity creation during arbitration.
 */
export interface ToolEntityCreationResult {
  createdCharacters: Map<string, string>;
  createdPlaces: Map<string, string>;
  createdExits: Map<string, string>;
}

/**
 * Cached arbitration context data.
 */
export interface ToolArbitrationContextCache {
  nearbyCharacters: Character[];
  availableExits: ObjectEntity[];
  recentMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
    speaker?: string;
  }>;
  storyFlags: string[];
  availableFlagsByPlot: Array<{
    plotId: string;
    plotLabel?: string;
    progress: number;
    flags: Array<{
      id: string;
      triggerDescription: string;
      requiredCharacter?: {
        name: string;
        entityId?: string;
        isNearby: boolean;
      };
    }>;
    resolvedPlaces: Array<{
      entityId: string;
      label: string;
      storyRole: string;
    }>;
    resolvedCharacters: Array<{
      entityId: string;
      label: string;
      role: string;
    }>;
  }>;
  progressByPlot: Record<string, number>;
  travelContext: VesselTravelContext | undefined;
  currentPlace: Place;
  placeId: string;
}

export interface ToolContext {
  universe: UniverseContextInterface;
  character: Character;
  userMessage: GameMessage;
  storyteller: StorytellerDefinition;
  services: ToolServices;

  classificationResult?: ClassificationResult;
  arbiterResult?: ToolArbiterResult;
  arbiterEntityResult?: ToolEntityCreationResult;
  storytellerContext?: StorytellerEventContext;
  storytellerEventMeta?: {
    requestedHours: number;
    actualHours: number;
    partialAdvance: boolean;
  };
  recentlyCreatedExits?: CreatedExitInfo[];
  recentlyCreatedCharacters?: CreatedCharacterInfo[];
  resolvedTargetPlaceId?: string;
  newlySetFlags?: string[];
  generatedSketchMarkdown?: string;
  generatedJournalEntry?: JournalEntry;
  generatedMusicUrl?: string;
  _arbitrationContextCache?: ToolArbitrationContextCache;
}
