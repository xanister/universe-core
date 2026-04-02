/**
 * Missing Image Validator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { missingImageValidator } from '@dmnpc/studio/integrity/validators/missing-image.js';
import type {
  Character,
  Place,
  ObjectEntity,
  UniverseEvent
} from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

// Note: The validator no longer checks file existence on disk - it only checks if the image field is set

function createTestContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    universe: {
      id: 'test_universe',
      name: 'Test Universe',
      rootPlaceId: 'PLACE_root',
    } as ValidationContext['universe'],
    characters: new Map<string, Character>(),
    places: new Map<string, Place>(),
    objects: new Map<string, ObjectEntity>(),
    events: new Map<string, UniverseEvent>(),
    validRaceIds: new Set(['RACE_human']),
    rootPlaceId: 'PLACE_root',
    ...overrides,
  };
}

function createCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'CHAR_test',
    label: 'Test Character',
    description: 'A test character',
    short_description: 'test',
    tags: [],
    entityType: 'character',
    info: {
      placeId: 'PLACE_root',
    },
    relationships: {},
    ...overrides,
  } as Character;
}

function createPlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 'PLACE_test',
    label: 'Test Place',
    description: 'A test place',
    short_description: 'test',
    tags: [],
    entityType: 'place',
    info: { environment: ENVIRONMENT_PRESETS.exterior() },
    relationships: {},
    ...overrides,
  } as Place;
}

describe('missingImageValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('character image validation', () => {
    it('should return no issues for character with image', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        image: '/api/media/test_universe/media/images/characters/CHAR_test.png',
      });

      const issues = await missingImageValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should suggest image generation when character has no image', async () => {
      const ctx = createTestContext();
      const character = createCharacter(); // No image field

      const issues = await missingImageValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('image');
      expect(issues[0].message).toBe('Character is missing image');
      expect(issues[0].suggestedFix?.method).toBe('image');
      expect(issues[0].suggestedFix?.value).toBeNull();
    });
  });

  describe('place image validation', () => {
    it('should return no issues for place with image', async () => {
      const ctx = createTestContext();
      const place = createPlace({
        image: '/api/media/test_universe/media/images/places/PLACE_test.png',
        info: {
          environment: ENVIRONMENT_PRESETS.exterior(),
        },
      });

      const issues = await missingImageValidator.validate(place, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should report missing entity image for place', async () => {
      const ctx = createTestContext();
      const place = createPlace({
        info: {
          environment: ENVIRONMENT_PRESETS.exterior(),
        },
      }); // No image field

      const issues = await missingImageValidator.validate(place, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('image');
      expect(issues[0].suggestedFix?.method).toBe('image');
    });
  });

  describe('non-image entities', () => {
    it('should return no issues for exit object entities', async () => {
      const ctx = createTestContext();
      const exitObject = {
        id: 'OBJ_exit_test',
        label: 'Test Exit',
        description: 'A test exit',
        short_description: 'exit',
        tags: [],
        entityType: 'object',
        info: {
          purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' },
          options: {
            exitType: 'door',
            targetPlaceId: 'PLACE_b',
          },
        },
        relationships: {},
      } as unknown as ObjectEntity;

      const issues = await missingImageValidator.validate(exitObject, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should return no issues for event entities', async () => {
      const ctx = createTestContext();
      const event = {
        id: 'EVENT_test',
        label: 'Test Event',
        description: 'A test event',
        entityType: 'event',
      } as unknown as UniverseEvent;

      const issues = await missingImageValidator.validate(event as unknown as Place, ctx);

      expect(issues).toHaveLength(0);
    });
  });
});
