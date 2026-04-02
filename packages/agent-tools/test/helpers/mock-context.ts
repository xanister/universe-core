/**
 * Mock Context Helpers for Agent Tools Tests
 *
 * Provides factory functions for creating mock ToolContext and services.
 */

import { vi } from 'vitest';
import type { Character, Place } from '@dmnpc/types/entity';
import type { ClassificationResult } from '@dmnpc/types/game';
import type { StorytellerDefinition } from '@dmnpc/types/npc';
import type {
  ToolContext,
  UniverseContextInterface,
  ToolArbiterResult,
  ToolStateChange,
} from '../../src/types.js';
import type {
  ToolServices,
  ClassificationService,
  ArbitrationService,
  NarrativeService,
  ExtractionService,
  CharacterService,
  TimeService,
  FlagService,
  EventService,
  QueueService,
  LoggerService,
  PlaceService,
  ExitService,
  HistoryService,
  DispositionService,
  InventoryService,
  StorytellerService,
  GameDateInterface,
} from '../../src/services/index.js';

// ============================================================================
// Mock Character
// ============================================================================

export function createMockCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'CHAR_test_player',
    type: 'character',
    label: 'Test Player',
    description: 'A test player character',
    short_description: 'Test player',
    personality: 'Brave and curious',
    shortDescription: 'Test player',
    placeId: 'PLACE_test_location',
    initialPlaceId: 'PLACE_test_location',
    pronouns: { subject: 'they', object: 'them', possessive: 'their' },
    disposition: {},
    isPlayer: true,
    position: { parent: 'PLACE_test_location' },
    info: { isPlayer: overrides.isPlayer ?? true },
    ...overrides,
  } as Character;
}

// ============================================================================
// Mock Place
// ============================================================================

export function createMockPlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 'PLACE_test_location',
    type: 'place',
    label: 'Test Location',
    description: 'A test location',
    shortDescription: 'Test place',
    environment: 'interior',
    parentId: null,
    position: { parent: null },
    info: {},
    ...overrides,
  } as Place;
}

// ============================================================================
// Mock Universe Context
// ============================================================================

export function createMockUniverseContext(
  overrides: Partial<UniverseContextInterface> = {},
): UniverseContextInterface {
  const defaultCharacter = createMockCharacter();
  const defaultPlace = createMockPlace();

  return {
    universeId: 'TEST_UNIVERSE',
    universe: {
      date: '1/1/1',
      calendar: { name: 'Test Calendar' },
    },
    characters: [defaultCharacter],
    places: [defaultPlace],
    exits: [],
    findCharacter: vi.fn((id: string) =>
      id === defaultCharacter.id ? defaultCharacter : undefined,
    ),
    findPlace: vi.fn((id: string) => (id === defaultPlace.id ? defaultPlace : undefined)),
    getPlace: vi.fn((id: string) => {
      if (id === defaultPlace.id) return defaultPlace;
      throw new Error(`Place not found: ${id}`);
    }),
    getCharacter: vi.fn((id: string) => {
      if (id === defaultCharacter.id) return defaultCharacter;
      throw new Error(`Character not found: ${id}`);
    }),
    findExit: vi.fn(() => undefined),
    updateUniverse: vi.fn(),
    upsertEntity: vi.fn(),
    recordVisit: vi.fn(),
    getEntitiesByPlace: vi.fn(() => []),
    ...overrides,
  };
}

// ============================================================================
// Mock Game Date
// ============================================================================

export function createMockGameDate(dateString: string = '1/1/1'): GameDateInterface {
  return {
    addMinutes: vi.fn(function (this: GameDateInterface, _minutes: number) {
      return this;
    }),
    format: vi.fn(() => dateString),
  };
}

// ============================================================================
// Mock Services
// ============================================================================

export function createMockClassificationService(): ClassificationService {
  return {
    classifyPlayerInput: vi.fn().mockResolvedValue({
      actions: [],
      intent: 'explore',
    } as ClassificationResult),
  };
}

export function createMockArbitrationService(): ArbitrationService {
  return {
    buildArbitrationContext: vi.fn().mockReturnValue({}),
    planArbitration: vi.fn().mockResolvedValue({
      stateChanges: [],
      sceneContributions: [],
    } as ToolArbiterResult),
    arbitrate: vi.fn().mockResolvedValue(undefined),
    arbitrateStoryteller: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockNarrativeService(): NarrativeService {
  return {
    describeAction: vi.fn().mockResolvedValue('The action succeeds.'),
    describeDialogue: vi.fn().mockResolvedValue('The conversation continues.'),
    describeTransition: vi.fn().mockResolvedValue('You arrive at the new location.'),
    describeSleep: vi.fn().mockResolvedValue('You rest peacefully.'),
    describeStorytellerEvent: vi.fn().mockResolvedValue('Something important happens.'),
  };
}

export function createMockExtractionService(): ExtractionService {
  return {
    runTurnExtraction: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockCharacterService(): CharacterService {
  return {
    generateCharacter: vi.fn().mockResolvedValue(createMockCharacter({ id: 'CHAR_generated' })),
    tryMatchExistingCharacter: vi.fn().mockResolvedValue(null),
    setCharacterLocation: vi.fn().mockResolvedValue(undefined),
    updateCharacterTags: vi.fn().mockResolvedValue(undefined),
    isPlayerCharacter: vi.fn((char: Character) => char.isPlayer === true),
    isDesignatedPlayerCharacter: vi.fn((char: Character) => char.isPlayer === true),
    computeDisplayName: vi.fn((_char: Character) => 'Test Character'),
  };
}

export function createMockTimeService(): TimeService {
  return {
    parseDate: vi.fn(() => createMockGameDate()),
    advanceGameTime: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockFlagService(): FlagService {
  return {
    collectValidFlags: vi.fn().mockReturnValue([]),
    addStoryFlags: vi.fn((existing: string[], newFlags: string[]) => [...existing, ...newFlags]),
    getPlotStatus: vi.fn().mockReturnValue('active'),
    saveStorytellerState: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockEventService(): EventService {
  return {
    addMessageForCharacter: vi.fn(),
    emitLocationUpdated: vi.fn(),
  };
}

export function createMockQueueService(): QueueService {
  return {
    enqueueJob: vi.fn(),
  };
}

export function createMockLoggerService(): LoggerService {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

export function createMockPlaceService(): PlaceService {
  return {
    generatePlace: vi.fn().mockResolvedValue({
      id: 'PLACE_generated',
      label: 'Generated Place',
      description: 'A generated place',
      parentId: 'PLACE_parent',
    }),
    findSimilarPlace: vi.fn().mockReturnValue(null),
  };
}

export function createMockExitService(): ExitService {
  return {
    createExit: vi.fn().mockResolvedValue({
      id: 'OBJ_exit_generated',
      label: 'Generated Exit',
      exitType: 'door',
      targetPlaceId: 'PLACE_target',
    }),
  };
}

export function createMockHistoryService(): HistoryService {
  return {
    getRelevantEvents: vi.fn().mockReturnValue([]),
    createEvent: vi.fn().mockResolvedValue({
      id: 'EVENT_generated',
      date: '1/1/1',
      subject: 'Test Subject',
      fact: 'Test fact',
      significance: 'minor',
    }),
  };
}

export function createMockDispositionService(): DispositionService {
  return {
    updateDisposition: vi.fn().mockReturnValue(10),
    getDisposition: vi.fn().mockReturnValue(0),
  };
}

export function createMockInventoryService(): InventoryService {
  return {
    addItem: vi.fn().mockReturnValue(['item1', 'item2']),
    removeItem: vi.fn().mockReturnValue(true),
    getInventory: vi.fn().mockReturnValue([]),
  };
}

export function createMockStorytellerService(): StorytellerService {
  return {
    checkPendingEvents: vi.fn().mockReturnValue(null),
    triggerEvent: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockServices(overrides: Partial<ToolServices> = {}): ToolServices {
  return {
    classification: createMockClassificationService(),
    arbitration: createMockArbitrationService(),
    narrative: createMockNarrativeService(),
    extraction: createMockExtractionService(),
    character: createMockCharacterService(),
    time: createMockTimeService(),
    flag: createMockFlagService(),
    event: createMockEventService(),
    queue: createMockQueueService(),
    logger: createMockLoggerService(),
    place: createMockPlaceService(),
    exit: createMockExitService(),
    history: createMockHistoryService(),
    disposition: createMockDispositionService(),
    inventory: createMockInventoryService(),
    storyteller: createMockStorytellerService(),
    ...overrides,
  };
}

// ============================================================================
// Mock Storyteller
// ============================================================================

export function createMockStoryteller(): StorytellerDefinition {
  return {
    id: 'STORYTELLER_test',
    label: 'Test Storyteller',
    description: 'A test storyteller',
    voice: 'neutral',
    triggerWindow: { start: 2, end: 6 },
  } as StorytellerDefinition;
}

// ============================================================================
// Mock Tool Context
// ============================================================================

export function createMockToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const universe = createMockUniverseContext();
  const character = createMockCharacter();

  return {
    universe,
    character,
    userMessage: {
      role: 'user',
      content: 'Test message',
      speaker: character.label,
    },
    storyteller: createMockStoryteller(),
    services: createMockServices(),
    ...overrides,
  } as ToolContext;
}

// ============================================================================
// Mock Arbiter Result
// ============================================================================

export function createMockToolArbiterResult(
  overrides: Partial<ToolArbiterResult> = {},
): ToolArbiterResult {
  return {
    stateChanges: [],
    sceneContributions: [
      {
        source: 'player_action',
        description: 'Test action',
        outcome: 'success',
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// State Change Factories
// ============================================================================

export function createAdvanceTimeChange(
  minutes: number = 30,
  reason: string = 'test',
): ToolStateChange & { type: 'advance_time' } {
  return { type: 'advance_time', minutes, reason };
}

export function createMoveChange(destinationId: string): ToolStateChange & { type: 'move' } {
  return { type: 'move', destinationId };
}

export function createMoveNpcChange(
  characterId: string,
  toPlaceId: string | null,
): ToolStateChange & { type: 'move_npc' } {
  return { type: 'move_npc', characterId, toPlaceId };
}
