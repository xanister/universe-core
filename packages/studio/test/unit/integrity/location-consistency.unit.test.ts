/**
 * Location Consistency Validator Tests
 */

import { describe, it, expect } from 'vitest';
import { locationConsistencyValidator } from '@dmnpc/studio/integrity/validators/location-consistency.js';
import type {
  Character,
  Place,
  ObjectEntity,
  UniverseEvent
} from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

function createTestContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  const places = new Map<string, Place>();
  places.set('PLACE_root', {
    id: 'PLACE_root',
    label: 'Root Place',
    description: 'The root place',
    short_description: 'root',
    tags: [],
    entityType: 'place',
    position: { x: null, y: null, parent: null },
    info: { environment: ENVIRONMENT_PRESETS.exterior() },
    relationships: {},
  });
  places.set('PLACE_tavern', {
    id: 'PLACE_tavern',
    label: 'Tavern',
    description: 'A tavern',
    short_description: 'tavern',
    tags: [],
    entityType: 'place',
    position: { x: null, y: null, parent: 'PLACE_root' },
    info: { environment: ENVIRONMENT_PRESETS.interior() },
    relationships: {},
  });
  places.set('PLACE_highway', {
    id: 'PLACE_highway',
    label: 'Kings Highway',
    description: 'A long road',
    short_description: 'highway',
    tags: [],
    entityType: 'place',
    position: { x: null, y: null, parent: 'PLACE_root' },
    info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles' },
    relationships: {},
  });
  places.set('PLACE_open_sea', {
    id: 'PLACE_open_sea',
    label: 'Open Sea',
    description: 'The open sea',
    short_description: 'sea',
    tags: [],
    entityType: 'place',
    position: { x: null, y: null, parent: null },
    info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'miles' },
    relationships: {},
  });
  places.set('PLACE_harbor', {
    id: 'PLACE_harbor',
    label: 'Harbor',
    description: 'A harbor',
    short_description: 'harbor',
    tags: [],
    entityType: 'place',
    position: { x: null, y: null, parent: 'PLACE_root' },
    info: { environment: ENVIRONMENT_PRESETS.exterior() },
    relationships: {},
  });

  const characters = new Map<string, Character>();
  characters.set('CHAR_npc', {
    id: 'CHAR_npc',
    label: 'NPC',
    description: 'A non-player character',
    short_description: 'npc',
    tags: [],
    entityType: 'character',
    position: { x: null, y: null, parent: 'PLACE_root' },
    info: {},
    relationships: {},
  } as Character);

  return {
    universe: {
      id: 'test',
      name: 'Test Universe',
      rootPlaceId: 'PLACE_root',
    } as ValidationContext['universe'],
    characters: overrides.characters ?? characters,
    places: overrides.places ?? places,
    objects: overrides.objects ?? new Map<string, ObjectEntity>(),
    events: overrides.events ?? new Map<string, UniverseEvent>(),
    validRaceIds: new Set(['RACE_human']),
    rootPlaceId: 'PLACE_root',
    ...overrides,
  };
}

function createCharacter(overrides: Partial<Character> = {}): Character {
  const placeId = overrides.info?.placeId ?? overrides.position?.parent ?? 'PLACE_root';
  return {
    id: 'CHAR_test',
    label: 'Test Character',
    description: 'A test character',
    short_description: 'test',
    tags: [],
    entityType: 'character',
    info: {
      ...overrides.info,
    },
    position: { x: null, y: null, parent: placeId },
    relationships: {},
    ...overrides,
  } as Character;
}

function createPlace(id: string, overrides: Partial<Place> = {}): Place {
  return {
    id,
    label: `Place ${id}`,
    description: 'A place',
    short_description: 'place',
    tags: [],
    entityType: 'place',
    position: { x: null, y: null, parent: null },
    info: { environment: ENVIRONMENT_PRESETS.exterior(), ...overrides.info },
    relationships: {},
    ...overrides,
  } as Place;
}

describe('locationConsistencyValidator', () => {
  describe('character with valid local location', () => {
    it('should return no issues for character at local place without travel state', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: null, y: null, parent: 'PLACE_tavern' },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });
  });

  describe('character at place with children', () => {
    it('should not flag character at place with children', async () => {
      // Create context with a container place and a child place
      const places = new Map<string, Place>();
      places.set('PLACE_city', {
        id: 'PLACE_city',
        label: 'City',
        description: 'A city',
        short_description: 'city',
        tags: [],
        entityType: 'place',
        position: { x: null, y: null, parent: null },
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 100, height: 100 } },
        relationships: {},
      });
      places.set('PLACE_city_market', {
        id: 'PLACE_city_market',
        label: 'City Market',
        description: 'A market in the city',
        short_description: 'market',
        tags: [],
        entityType: 'place',
        position: { x: null, y: null, parent: 'PLACE_city' },
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 100, height: 100 } },
        relationships: {},
      });
      const ctx = createTestContext({ places });

      const character = createCharacter({
        position: { x: null, y: null, parent: 'PLACE_city' },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      // No issues
      expect(issues).toHaveLength(0);
    });
  });

  describe('character with valid destination', () => {
    it('should return no issues for valid destination on regional place', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: 50, y: 50, parent: 'PLACE_highway' },
        destination: { placeId: 'PLACE_tavern', description: 'destination' },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      // May have info message about position interpolation, but no errors
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should return no issues for destination with only description', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: 50, y: 50, parent: 'PLACE_highway' },
        destination: { description: 'somewhere distant' },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('character with invalid destinationPlaceId', () => {
    it('should flag non-existent destinationPlaceId', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: 50, y: 50, parent: 'PLACE_highway' },
        destinationPlaceId: 'PLACE_nonexistent',
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('destinationPlaceId');
      expect(issues[0].severity).toBe('error');
    });

    it('should suggest clearing destinationPlaceId when place non-existent', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: 50, y: 50, parent: 'PLACE_highway' },
        destinationPlaceId: 'PLACE_nonexistent',
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].suggestedFix?.value).toBeUndefined();
    });

    it('should not flag character at place with children', async () => {
      const ctx = createTestContext();
      // Add a place with children to the context
      ctx.places.set('PLACE_ship', {
        id: 'PLACE_ship',
        label: 'Ship',
        description: 'A ship',
        short_description: 'ship',
        tags: [],
        entityType: 'place',
        position: { x: null, y: null, parent: 'PLACE_open_sea' },
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 100, height: 100 } },
        relationships: {},
      });
      const character = createCharacter({
        position: { x: null, y: null, parent: 'PLACE_ship' },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      // No issues
      expect(issues).toHaveLength(0);
    });
  });

  describe('character at place with children', () => {
    it('should not flag character at place with children', async () => {
      const ctx = createTestContext();
      // Add place with children
      ctx.places.set('PLACE_ship', {
        id: 'PLACE_ship',
        label: 'Ship',
        description: 'A ship',
        short_description: 'ship',
        tags: [],
        entityType: 'place',
        position: { x: null, y: null, parent: 'PLACE_open_sea' },
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', size: { width: 100, height: 100 } },
        relationships: {},
      });
      const character = createCharacter({
        position: { x: null, y: null, parent: 'PLACE_ship' },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      // No issues
      expect(issues).toHaveLength(0);
    });

    // Test for character with abstractLocation - validator allows this now
    it('should not flag abstractLocation when destination is present', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: 50, y: 50, parent: 'PLACE_highway' },
        destination: { placeId: 'PLACE_tavern', description: 'destination' },
        info: {
          placeId: 'PLACE_highway',
          abstractLocation: {
            state: 'away',
            reference: { description: 'somewhere' },
          },
        },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      // No errors expected - abstractLocation is allowed with destination
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('character at regional place without destination', () => {
    it('should not flag character at regional place without destination', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: null, y: null, parent: 'PLACE_highway' },
        // No destination - this is now valid (character just standing in region)
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      // No errors expected - characters can be at regions without traveling
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should allow character with abstractLocation at regional place', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        position: { x: null, y: null, parent: 'PLACE_highway' },
        info: {
          placeId: 'PLACE_highway',
          abstractLocation: {
            state: 'away',
            reference: { description: 'traveling' },
          },
        },
      });

      const issues = await locationConsistencyValidator.validate(character, ctx);

      // No errors expected
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('vessel validation', () => {
    it('should return no issues for valid docked vessel', async () => {
      const ctx = createTestContext();
      const vessel = createPlace('PLACE_ship', {
        position: { x: null, y: null, parent: 'PLACE_harbor' },
        info: {
          environment: ENVIRONMENT_PRESETS.interior(),
          dockedAt: { placeId: 'PLACE_harbor', description: 'Harbor' },
        },
      });

      const issues = await locationConsistencyValidator.validate(vessel, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should return no issues for valid vessel in transit', async () => {
      const ctx = createTestContext();
      const vessel = createPlace('PLACE_ship', {
        position: { x: 50, y: 50, parent: 'PLACE_open_sea' },
        destinationPlaceId: 'PLACE_harbor',
        info: {
          environment: ENVIRONMENT_PRESETS.interior(),
        },
      });

      const issues = await locationConsistencyValidator.validate(vessel, ctx);

      // Vessel-specific validation is handled by vessel-routes validator
      // location-consistency only checks position.parent validity
      expect(issues).toHaveLength(0);
    });
  });
});
