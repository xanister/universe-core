/**
 * Mock UniverseContext helpers for tests.
 *
 * Provides both filesystem-backed universe setup (for tests that need real I/O)
 * and in-memory mocks (for pure unit tests).
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Character, Place, Universe, ObjectEntity, UniverseEvent } from '@dmnpc/types/entity';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { createTestRace } from './fixtures.js';

process.env.TEST_STORYTELLERS_DIR ||= 'test/fixtures/storytellers/definitions';

// Use OS temp directory for generated test universes to avoid polluting the repository.
const TEST_TEMP_BASE =
  process.env.TEST_UNIVERSES_DIR || path.join(tmpdir(), 'dmnpc-test-universes');
const RETRYABLE_REMOVE_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES']);

function getFsErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    typeof (error as NodeJS.ErrnoException).code === 'string'
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (error as NodeJS.ErrnoException).code ?? null;
  }
  return null;
}

async function removeDirWithRetry(
  dir: string,
  options: {
    maxRetries?: number;
    retryDelayMs?: number;
    suppressFinalError?: boolean;
    contextLabel?: string;
  } = {},
): Promise<void> {
  const {
    maxRetries = 3,
    retryDelayMs = 100,
    suppressFinalError = false,
    contextLabel = 'removeDirWithRetry',
  } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = getFsErrorCode(error);
      const isRetryable = code !== null && RETRYABLE_REMOVE_CODES.has(code);
      if (isRetryable && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        continue;
      }
      break;
    }
  }

  if (!lastError) {
    return;
  }
  if (suppressFinalError) {
    console.warn(
      `${contextLabel}: failed to remove ${dir} after ${maxRetries} attempts: ${
        lastError instanceof Error ? lastError.message : JSON.stringify(lastError)
      }`,
    );
    return;
  }
  throw lastError instanceof Error ? lastError : new Error(JSON.stringify(lastError));
} // ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the directory for a test universe.
 *
 * Uses OS temp directory by default to avoid polluting the repository.
 * Tests should always clean up after themselves, but even if they don't,
 * temp directories are cleaned by the OS eventually.
 */
export function getTestUniverseDir(universeId: string): string {
  return path.join(TEST_TEMP_BASE, universeId);
}

// ============================================================================
// Types
// ============================================================================

/**
 * Input type for setupTestUniverse - uses real types from Universe.
 * All fields optional; setupTestUniverse provides sensible defaults.
 */
export type TestUniverseData = Partial<Omit<Universe, 'id'>> & {
  places?: Place[];
  characters?: Character[];
  objects?: ObjectEntity[];
  events?: UniverseEvent[];
};

// ============================================================================
// Default Mock Data
// ============================================================================

/**
 * Default mock data for UniverseContext mocking.
 * Tests can override specific fields as needed.
 */
export const defaultMockUniverse: Universe = {
  id: 'test_universe',
  name: 'Test Universe',
  version: '1.0.0',
  description: 'A test universe',
  custom: {},
  rules: '',
  tone: '',
  style: '',
  mapStyle: null,
  image: null,
  date: '27.12.1476 4A',
  rootPlaceId: 'PLACE_test',
  rulesetId: 'basic',
  defaultStartPlaceId: null,
  stagingSpriteTheme: 'fantasy',
  hungerFatigueEnabled: false,
  weather: null,
  weatherSeverity: null,
  climate: null,
  music: null,
  races: [createTestRace()],
  characters: null,
  places: null,
  objects: null,
  events: null,
  calendar: {
    name: 'Test Calendar',
    months: [
      { name: 'January', days: 31 },
      { name: 'February', days: 28 },
      { name: 'March', days: 31 },
      { name: 'April', days: 30 },
      { name: 'May', days: 31 },
      { name: 'June', days: 30 },
      { name: 'July', days: 31 },
      { name: 'August', days: 31 },
      { name: 'September', days: 30 },
      { name: 'October', days: 31 },
      { name: 'November', days: 30 },
      { name: 'December', days: 31 },
    ],
    eras: [
      { id: 1, name: 'First Age', shortName: '1A', backwards: false, transitionEra: null },
      { id: 2, name: 'Second Age', shortName: '2A', backwards: false, transitionEra: null },
      { id: 3, name: 'Third Age', shortName: '3A', backwards: false, transitionEra: null },
      { id: 4, name: 'Fourth Age', shortName: '4A', backwards: false, transitionEra: null },
    ],
    defaultEra: 4,
    calendarType: 'standard',
    time: {
      hoursPerDay: 24,
      minutesPerHour: 60,
    },
    seasons: [],
    format: {
      dateSeparator: '.',
      timeSeparator: ':',
      eraPosition: 'suffix',
      monthDisplay: 'name',
      yearFirst: false,
      use24Hour: true,
      yearOnlyTemplate: null,
      millenniumPrefix: null,
    },
  },
};

// ============================================================================
// Filesystem-backed Universe Setup
// ============================================================================

/**
 * Create a test universe directory structure with index.json and per-file entities
 */
export async function setupTestUniverse(
  universeId: string,
  data: TestUniverseData = {},
): Promise<string> {
  const testDir = getTestUniverseDir(universeId);
  // Ensure we start from a clean slate so tests don't leak entities via leftover files.
  await removeDirWithRetry(testDir, {
    maxRetries: 5,
    retryDelayMs: 100,
    suppressFinalError: false,
    contextLabel: 'setupTestUniverse',
  });
  await mkdir(testDir, { recursive: true });

  // Determine rootPlaceId: use provided, or first place's ID, or empty string
  const rootPlaceId =
    data.rootPlaceId || (data.places && data.places.length > 0 ? data.places[0].id : '');

  const universe: Universe & { files: { characters: string; places: string } } = {
    id: universeId,
    name: data.name ?? 'Test Universe',
    version: data.version ?? '1.0.0',
    description: data.description ?? '',
    rootPlaceId,
    defaultStartPlaceId: data.defaultStartPlaceId ?? null,
    files: {
      characters: 'characters.json',
      places: 'places.json',
    },
    custom: data.custom ?? {},
    rules: data.rules ?? '',
    tone: data.tone ?? '',
    style: data.style ?? '',
    mapStyle: data.mapStyle ?? null,
    image: data.image ?? null,
    date: data.date ?? '27.12.1476 4A',
    weather: data.weather ?? null,
    weatherSeverity: data.weatherSeverity ?? null,
    races: data.races ?? [createTestRace()],
    characters: null,
    places: null,
    objects: null,
    events: null,
    calendar: data.calendar ?? defaultMockUniverse.calendar,
    climate: data.climate ?? null,
    music: data.music ?? null,
    stagingSpriteTheme: data.stagingSpriteTheme ?? 'fantasy',
    hungerFatigueEnabled: data.hungerFatigueEnabled ?? false,
    rulesetId: data.rulesetId ?? 'basic',
  };

  await writeFile(path.join(testDir, 'index.json'), JSON.stringify(universe, null, 2) + '\n');

  // Create per-file entity structure
  const places = data.places ?? [];
  const placesDir = path.join(testDir, 'entities', 'places');
  await mkdir(placesDir, { recursive: true });
  for (const place of places) {
    const placeFile = path.join(placesDir, `${place.id}.json`);
    await writeFile(placeFile, JSON.stringify(place, null, 2) + '\n');
  }

  const characters = data.characters ?? [];
  const charactersDir = path.join(testDir, 'entities', 'characters');
  await mkdir(charactersDir, { recursive: true });
  for (const character of characters) {
    const characterFile = path.join(charactersDir, `${character.id}.json`);
    await writeFile(characterFile, JSON.stringify(character, null, 2) + '\n');
  }

  // Create object entities (includes exit objects)
  const objects = data.objects ?? [];
  const objectsDir = path.join(testDir, 'entities', 'objects');
  await mkdir(objectsDir, { recursive: true });
  for (const obj of objects) {
    const objFile = path.join(objectsDir, `${obj.id}.json`);
    await writeFile(objFile, JSON.stringify(obj, null, 2) + '\n');
  }

  // Create event entities
  const events = data.events ?? [];
  if (events.length > 0) {
    const eventsDir = path.join(testDir, 'entities', 'events');
    await mkdir(eventsDir, { recursive: true });
    for (const event of events) {
      const eventFile = path.join(eventsDir, `${event.id}.json`);
      await writeFile(eventFile, JSON.stringify(event, null, 2) + '\n');
    }
  }

  return testDir;
}

/**
 * Clean up a test universe directory.
 * Includes retry logic for Windows where file handles may not be released immediately.
 */
export async function cleanupTestUniverse(universeId: string): Promise<void> {
  const testDir = getTestUniverseDir(universeId);
  await removeDirWithRetry(testDir, {
    maxRetries: 5,
    retryDelayMs: 100,
    suppressFinalError: true,
    contextLabel: 'cleanupTestUniverse',
  });
}

/**
 * Setup test universe and return a UniverseContext for it
 */
export async function setupAndLoadTestUniverse(
  universeId: string,
  data: TestUniverseData = {},
): Promise<UniverseContext> {
  await setupTestUniverse(universeId, data);
  return UniverseContext.loadAtEntryPoint(universeId);
}

// ============================================================================
// In-memory Mock Context
// ============================================================================

/**
 * Create a mock UniverseContext for testing.
 * Uses minimal stubs that can be overridden as needed.
 */
export function createMockUniverseContext(
  options: {
    universeId?: string;
    universe?: Partial<Universe>;
    characters?: Character[];
    places?: Place[];
    objects?: ObjectEntity[];
    events?: UniverseEvent[];
  } = {},
): UniverseContext {
  const mockUniverse: Universe = {
    ...defaultMockUniverse,
    id: options.universeId ?? 'test_universe',
    rootPlaceId: '',
    weather: null,
    weatherSeverity: null,
    climate: null,
    music: null,
    ...options.universe,
  };

  return UniverseContext.fromData(
    options.universeId ?? 'test_universe',
    mockUniverse,
    options.characters ?? [],
    options.places ?? [],
    options.objects ?? [],
    options.events ?? [],
  );
}
