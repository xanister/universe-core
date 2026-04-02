/**
 * Missing Character Sprite Validator Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { missingCharacterSpriteValidator } from '@dmnpc/studio/integrity/validators/missing-character-sprite.js';
import type {
  Character,
  Place,
  ObjectEntity,
  UniverseEvent
} from '@dmnpc/types/entity';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

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
      gender: 'male',
      spriteConfig: {
        bodyType: 'male',
        layers: [],
      },
    },
    relationships: {},
    ...overrides,
  } as Character;
}

describe('missingCharacterSpriteValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('character sprite validation', () => {
    it('should return no issues for character with spriteUrl', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        info: {
          placeId: 'PLACE_root',
          gender: 'male',
          spriteConfig: {
            bodyType: 'male',
            layers: [],
            spriteUrl: 'https://example.com/sprite.png',
          },
        },
      });

      const issues = await missingCharacterSpriteValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should suggest character-sprite repair when character has no spriteUrl', async () => {
      const ctx = createTestContext();
      const character = createCharacter(); // spriteConfig has no spriteUrl

      const issues = await missingCharacterSpriteValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('info.spriteConfig.spriteUrl');
      expect(issues[0].message).toBe('Character is missing in-world sprite');
      expect(issues[0].suggestedFix?.method).toBe('character-sprite');
      expect(issues[0].validatorId).toBe('missing-character-sprite');
    });

    it('should report missing sprite when spriteConfig has no spriteUrl', async () => {
      const ctx = createTestContext();
      const character = createCharacter({
        info: {
          placeId: 'PLACE_root',
          gender: 'male',
          spriteConfig: {
            bodyType: 'male',
            layers: [],
            // no spriteUrl
          },
        },
      });

      const issues = await missingCharacterSpriteValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].suggestedFix?.method).toBe('character-sprite');
    });
  });

  describe('non-character entities', () => {
    it('should return no issues for place', async () => {
      const ctx = createTestContext();
      const place = {
        id: 'PLACE_test',
        label: 'Test Place',
        entityType: 'place',
      } as unknown as Place;

      const issues = await missingCharacterSpriteValidator.validate(place, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should return no issues for object', async () => {
      const ctx = createTestContext();
      const obj = {
        id: 'OBJ_test',
        label: 'Test Object',
        entityType: 'object',
      } as unknown as ObjectEntity;

      const issues = await missingCharacterSpriteValidator.validate(obj, ctx);

      expect(issues).toHaveLength(0);
    });
  });
});
