/**
 * Service Interfaces for Agent Tools
 *
 * These interfaces define the contracts that tools expect from the host application.
 * The server provides concrete implementations when building the tool context.
 */

import type {
  BackgroundJobPayload,
  Character,
  EventSignificance,
  LocationUpdateReason,
  Place,
} from '@dmnpc/types/entity';
import type { CalendarConfig, EnvironmentPresetName, Purpose } from '@dmnpc/types/world';
import type { ClassificationResult, MilestoneData } from '@dmnpc/types/game';
import type {
  PlannedCharacter,
  PlotState,
  StorytellerInstanceState,
  StorytellerPlan,
} from '@dmnpc/types/npc';
import type { UniverseContextInterface, ToolArbiterResult, ToolContext } from '../types.js';

export interface ClassificationService {
  classifyPlayerInput(
    universe: UniverseContextInterface,
    characterId: string,
    message: string,
  ): Promise<ClassificationResult>;
}

export interface ArbitrationContextInput {
  classification: ClassificationResult;
  turnContext: ToolContext;
}

/**
 * Service for arbitrating player actions.
 */
export interface ArbitrationService {
  /**
   * Build the full arbitration context from classification and turn context.
   */
  buildArbitrationContext(classification: ClassificationResult, turnContext: ToolContext): unknown; // Returns ArbitrationContext from server

  /**
   * Plan arbitration without executing state changes.
   * Returns ToolArbiterResult with planned changes.
   */
  planArbitration(arbitrationContext: unknown): Promise<ToolArbiterResult>;

  /**
   * Full arbitration: plan and execute.
   */
  arbitrate(turnContext: ToolContext): Promise<void>;

  /**
   * Run storyteller arbitration: check for plot events, evaluate goals, detect endings.
   * Should be called after player action arbitration to enable same-turn flag-triggered events.
   */
  arbitrateStoryteller(context: ToolContext): Promise<void>;
}

export type ToolNarrativeType =
  | 'action'
  | 'dialogue'
  | 'transition'
  | 'sleep'
  | 'storyteller_event';

export interface NarrativeService {
  describeAction(context: ToolContext): Promise<string>;
  describeDialogue(context: ToolContext): Promise<string>;
  describeTransition(context: ToolContext): Promise<string>;
  describeSleep(context: ToolContext): Promise<string>;
  describeStorytellerEvent(context: ToolContext): Promise<string>;
}

/**
 * Service for extracting information after narrative generation.
 */
export interface ExtractionService {
  /**
   * Run post-turn extraction (name reveals, etc.).
   */
  runTurnExtraction(context: ToolContext): Promise<void>;
}

export interface CharacterService {
  generateCharacter(options: {
    ctx: UniverseContextInterface;
    description: string;
    placeId: string;
  }): Promise<Character>;

  tryMatchExistingCharacter(
    universe: UniverseContextInterface,
    plannedCharacter: PlannedCharacter,
    placeId: string,
    excludedIds: Set<string>,
    searchScope: 'all' | 'nearby',
  ): Promise<Character | null>;

  setCharacterLocation(options: {
    character: Character;
    targetPlaceId: string;
    ctx: UniverseContextInterface;
    exitObject?: unknown;
  }): Promise<void>;

  updateCharacterTags(
    universe: UniverseContextInterface,
    characterId: string,
    options: { currentPlace?: Place },
  ): Promise<void>;

  isPlayerCharacter(character: Character): boolean;
  isDesignatedPlayerCharacter(character: Character): boolean;

  computeDisplayName(
    character: Character,
    viewer: Character,
    universe: UniverseContextInterface,
  ): string;
}

/**
 * Parsed game date interface.
 */
export interface GameDateInterface {
  addMinutes(minutes: number): GameDateInterface;
  format(): string;
}

/**
 * Service for time operations.
 */
export interface TimeService {
  /**
   * Parse a date string into a GameDate object.
   */
  parseDate(calendar: CalendarConfig, dateString: string): GameDateInterface;

  /**
   * Advance game time and run world effects (weather, NPC movements, vessel positions, arrivals).
   * Combines date advancement + world tick in one call.
   */
  advanceGameTime(
    context: ToolContext,
    minutes: number,
    interactionTargetId: string | null,
  ): Promise<void>;
}

export interface GeneratePlaceOptions {
  ctx: UniverseContextInterface;
  name: string;
  description: string;
  parentId: string;
  environment: EnvironmentPresetName;
  /** Purpose from the purpose registry */
  purpose?: Purpose;
}

/**
 * Generated place result.
 */
export interface GeneratedPlace {
  id: string;
  label: string;
  description: string;
  parentId: string;
}

/**
 * Service for place operations.
 */
export interface PlaceService {
  /**
   * Generate a new place.
   */
  generatePlace(options: GeneratePlaceOptions): Promise<GeneratedPlace>;

  /**
   * Find a similar existing place by name.
   */
  findSimilarPlace(
    universe: UniverseContextInterface,
    name: string,
  ): { place: { id: string; label: string } } | null;
}

/**
 * Options for creating an exit.
 * Target is derived from place hierarchy (placeId's parent).
 */
export interface CreateExitOptions {
  ctx: UniverseContextInterface;
  /** Place where the exit is located (target = this place's parent) */
  placeId: string;
  label: string;
  exitType: string;
  direction?: string;
}

export interface CreatedExit {
  id: string;
  label: string;
  exitType: string;
}

export interface ExitService {
  createExit(options: CreateExitOptions): Promise<CreatedExit>;
}

/**
 * Historical event from the universe.
 */
export interface HistoricalEvent {
  id: string;
  date: string;
  placeId?: string;
  subject: string;
  fact: string;
  significance: EventSignificance;
}

/**
 * Options for querying historical events.
 */
export interface QueryEventsOptions {
  topic?: string;
  placeId?: string;
  characterId?: string;
  maxEvents?: number;
}

/**
 * Service for accessing historical events.
 */
export interface HistoryService {
  /**
   * Get relevant historical events based on query options.
   */
  getRelevantEvents(
    universe: UniverseContextInterface,
    options: QueryEventsOptions,
  ): HistoricalEvent[];

  /**
   * Create a new historical event.
   */
  createEvent(
    universe: UniverseContextInterface,
    event: Omit<HistoricalEvent, 'id'>,
    witnessIds: string[],
  ): Promise<HistoricalEvent>;
}

export interface DispositionService {
  /** Returns the new disposition value. */
  updateDisposition(
    universe: UniverseContextInterface,
    characterId: string,
    targetId: string,
    delta: number,
  ): number;

  getDisposition(universe: UniverseContextInterface, characterId: string, targetId: string): number;
}

/**
 * Service for managing character inventories.
 */
export interface InventoryService {
  /**
   * Add an item to a character's inventory.
   */
  addItem(universe: UniverseContextInterface, characterId: string, item: string): string[];

  /**
   * Remove an item from a character's inventory.
   * Returns true if the item was found and removed.
   */
  removeItem(universe: UniverseContextInterface, characterId: string, item: string): boolean;

  /**
   * Get a character's inventory.
   */
  getInventory(universe: UniverseContextInterface, characterId: string): string[];
}

export interface ToolPendingStorytellerEvent {
  plotId: string;
  eventType: string;
  minutesUntilTrigger: number;
}

export interface StorytellerService {
  checkPendingEvents(context: ToolContext): ToolPendingStorytellerEvent | null;
  triggerEvent(context: ToolContext): Promise<void>;
}

/**
 * Service for story flag operations.
 */
export interface FlagService {
  /**
   * Collect valid flags from a plot plan.
   */
  collectValidFlags(plotPlan: StorytellerPlan): string[];

  /**
   * Add flags to an existing flag array.
   */
  addStoryFlags(existingFlags: string[], newFlags: string[]): string[];

  /**
   * Get the status of a plot.
   */
  getPlotStatus(plot: PlotState, currentDate: GameDateInterface, calendar: CalendarConfig): string;

  /**
   * Save storyteller state for a character.
   */
  saveStorytellerState(
    universe: UniverseContextInterface,
    characterId: string,
    state: StorytellerInstanceState,
  ): Promise<void>;
}

export interface CharacterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  speaker: string;
  milestone?: MilestoneData | null;
}

export interface EventService {
  addMessageForCharacter(
    context: { character: Character; universe: UniverseContextInterface },
    message: CharacterMessage,
    placeId?: string,
  ): void;

  emitLocationUpdated(
    universe: UniverseContextInterface,
    characterId: string,
    reason: LocationUpdateReason,
  ): void;
}

/**
 * Service for background job queue.
 */
export interface QueueService {
  /**
   * Enqueue a background job.
   */
  enqueueJob(universeId: string, job: BackgroundJobPayload): void;
}

/**
 * Service for logging.
 */
export interface LoggerService {
  info(context: string, message: string): void;
  warn(context: string, message: string): void;
  error(context: string, message: string, data?: unknown): void;
}

export interface ToolServices {
  classification: ClassificationService;
  arbitration: ArbitrationService;
  narrative: NarrativeService;
  extraction: ExtractionService;
  character: CharacterService;
  time: TimeService;
  flag: FlagService;
  event: EventService;
  queue: QueueService;
  logger: LoggerService;
  place: PlaceService;
  exit: ExitService;
  history: HistoryService;
  disposition: DispositionService;
  inventory: InventoryService;
  storyteller: StorytellerService;
}
