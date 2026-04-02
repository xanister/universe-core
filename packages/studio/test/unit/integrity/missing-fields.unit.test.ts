/**
 * Missing Fields Validator Tests
 */

import { describe, it, expect } from 'vitest';
import { missingFieldsValidator } from '@dmnpc/studio/integrity/validators/missing-fields.js';
import type { Character, Place, Universe } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

function createTestContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    universe: {
      id: 'test',
      name: 'Test Universe',
      version: '1.0',
      description: '',
      custom: {},
      rules: '',
      tone: '',
      style: '',
      voice: 'alloy',
      date: '01.01.1477 4A',
      races: [
        { id: 'RACE_human', label: 'Human', description: 'Common folk', rarity: 'common' },
        { id: 'RACE_elf', label: 'Elf', description: 'Long-lived', rarity: 'uncommon' },
      ],
      rootPlaceId: 'PLACE_root',
    } as Universe,
    characters: new Map(),
    places: new Map(),
    objects: new Map(),
    validRaceIds: new Set(['RACE_human', 'RACE_elf']),
    rootPlaceId: 'PLACE_root',
    ...overrides,
  };
}

describe('MissingFieldsValidator', () => {
  describe('character validation', () => {
    it('should detect missing race', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test char',
        tags: [],
        entityType: 'character',
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: '', // Empty - should be detected
          routine: {
            // Has routine, so only race is missing
            schedule: {
              dawn: 'home',
              morning: 'work',
              afternoon: 'work',
              evening: 'leisure',
              night: 'home',
            },
            home: { description: 'home', placeId: 'PLACE_home' },
            variance: 0.1,
          },
          placeId: 'PLACE_root',
          messages: [],
          journal: [],
        },
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_root' },
        relationships: {},
      };

      const ctx = createTestContext();
      const issues = await missingFieldsValidator.validate(character, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('info.race');
      expect(issues[0].suggestedFix?.method).toBe('llm');
    });

    it('should detect multiple missing fields', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test char',
        tags: [],
        entityType: 'character',
        info: {
          aliases: [],
          birthdate: '', // Empty
          birthPlace: '', // Empty
          eyeColor: '', // Empty
          gender: '', // Empty
          hairColor: '', // Empty
          personality: '', // Empty
          race: '', // Empty
          // No routine - should also be detected
          storytellerState: null, // No active storyteller session
          isPlayer: false,

          placeId: 'PLACE_root',
          messages: [],
          journal: [],
        },
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_root' },
        relationships: {},
      };

      const ctx = createTestContext();
      const issues = await missingFieldsValidator.validate(character, ctx);

      expect(issues).toHaveLength(8); // 7 required fields + missing routine
    });

    it('should not flag valid character', async () => {
      const character: Character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test char',
        tags: [],
        entityType: 'character',
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          routine: {
            schedule: {
              dawn: 'home',
              morning: 'work',
              afternoon: 'work',
              evening: 'leisure',
              night: 'home',
            },
            home: { description: 'home', placeId: 'PLACE_home' },
            variance: 0.1,
          },
          placeId: 'PLACE_root',
          messages: [],
          journal: [],
        },
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_root' },
        relationships: {},
      };

      const ctx = createTestContext();
      const issues = await missingFieldsValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should not flag character with active storyteller session for missing routine', async () => {
      const character: Character = {
        id: 'CHAR_player',
        label: 'Player Character',
        description: 'A player character',
        short_description: 'player',
        tags: [],
        entityType: 'character',
        info: {
          aliases: [],
          birthdate: '01.01.1450 4A',
          birthPlace: 'Test Town',
          eyeColor: 'Blue',
          gender: 'Male',
          hairColor: 'Brown',
          personality: 'Friendly',
          race: 'RACE_human',
          // No routine, but has active storyteller session
          placeId: 'PLACE_root',
          messages: [{ role: 'user', content: 'hello' }],
          journal: [],
          storytellerState: { storytellerId: 'test', plots: [] },
        },
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_root' },
        relationships: {},
      };

      const ctx = createTestContext();
      const issues = await missingFieldsValidator.validate(character, ctx);

      expect(issues).toHaveLength(0);
    });
  });

  describe('place validation', () => {
    it('should detect missing description', async () => {
      const place: Place = {
        id: 'PLACE_test',
        label: 'Test Place',
        description: '', // Empty
        short_description: 'test place',
        tags: [],
        entityType: 'place',
        info: {
          environment: ENVIRONMENT_PRESETS.interior(),
          scale: 'feet',
          size: { width: 100, height: 100 },
        },
        position: { x: 0, y: 0, width: 400, height: 400, innerWidth: 800, innerHeight: 600, parent: 'PLACE_root' },
        relationships: {},
      };

      const ctx = createTestContext();
      const issues = await missingFieldsValidator.validate(place, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('description');
    });

    it('should detect missing short_description', async () => {
      const place: Place = {
        id: 'PLACE_test',
        label: 'Test Place',
        description: 'A test place',
        short_description: '', // Empty
        tags: [],
        entityType: 'place',
        info: {
          environment: ENVIRONMENT_PRESETS.interior(),
          scale: 'feet',
          size: { width: 100, height: 100 },
        },
        position: { x: 0, y: 0, width: 400, height: 400, innerWidth: 800, innerHeight: 600, parent: 'PLACE_root' },
        relationships: {},
      };

      const ctx = createTestContext();
      const issues = await missingFieldsValidator.validate(place, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].field).toBe('short_description');
    });
  });
});
