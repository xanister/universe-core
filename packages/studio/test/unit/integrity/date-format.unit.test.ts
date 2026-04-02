/**
 * Date Format Validator Tests
 *
 * Tests the date format validator that catches malformed date strings.
 */

import { describe, it, expect } from 'vitest';
import { dateFormatValidator } from '@dmnpc/studio/integrity/validators/date-format.js';
import type {
  Character,
  Universe,
  Place,
  ObjectEntity
} from '@dmnpc/types/entity';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

// Test calendar matching anslem universe format
const TEST_CALENDAR = {
  name: 'Test Calendar',
  calendarType: 'months' as const,
  months: [
    { name: 'Frostmoot', days: 30 },
    { name: 'Runvakr', days: 30 },
  ],
  time: { hoursPerDay: 22, minutesPerHour: 60 },
  eras: [
    { id: 4, name: 'Fourth Age', shortName: '4A', backwards: false },
    { id: 3, name: 'Third Age', shortName: '3A', backwards: false },
  ],
  defaultEra: 4,
  format: {
    dateSeparator: '.',
    timeSeparator: ':',
    eraPosition: 'suffix' as const,
    monthDisplay: 'number' as const,
    yearFirst: false,
    dateTemplate: '${day}.${month}.${year} ${era}',
  },
};

function createValidationContext(
  overrides: Partial<{ universe: Partial<Universe> }> = {}
): ValidationContext {
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
      date: '01.01.1472 4A 08:00',
      calendar: TEST_CALENDAR,
      races: [],
      rootPlaceId: 'PLACE_root',
      ...overrides.universe,
    } as Universe,
    characters: new Map<string, Character>(),
    places: new Map<string, Place>(),
    objects: new Map<string, ObjectEntity>(),
    validRaceIds: new Set<string>(),
    rootPlaceId: 'PLACE_root',
  };
}

function createTestCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'CHAR_test',
    label: 'Test Character',
    description: 'A test character',
    short_description: 'test person',
    tags: [],
    entityType: 'character',
    relationships: [],
    info: {
      aliases: [],
      birthdate: '1006-04-19',
      birthPlace: 'Test Town',
      eyeColor: 'brown',
      gender: 'male',
      hairColor: 'brown',
      personality: 'friendly',
      race: 'human',
      messages: [],
      journal: [],
      voice: { voiceId: 'test', voiceName: 'Test Voice' },
    },
    ...overrides,
  } as Character;
}

describe('dateFormatValidator', () => {
  it('should have correct id and name', () => {
    expect(dateFormatValidator.id).toBe('date-format');
    expect(dateFormatValidator.name).toBe('Date Format Validator');
  });

  describe('when calendar is not defined', () => {
    it('should skip validation and return no issues', async () => {
      const ctx = createValidationContext({ universe: { calendar: undefined } });
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          messages: [{ role: 'assistant', content: 'test', speaker: 'dm', date: 'invalid date' }],
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues).toHaveLength(0);
    });
  });

  describe('character message dates', () => {
    it('should pass for valid date format', async () => {
      const ctx = createValidationContext();
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          messages: [
            { role: 'assistant', content: 'test', speaker: 'dm', date: '01.01.1472 4A 08:00' },
          ],
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues).toHaveLength(0);
    });

    it('should detect malformed date missing day.month prefix', async () => {
      const ctx = createValidationContext();
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          messages: [{ role: 'assistant', content: 'test', speaker: 'dm', date: '1472 4A 08:00' }],
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues.length).toBeGreaterThanOrEqual(1);
      expect(issues[0].validatorId).toBe('date-format');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].field).toBe('info.messages[0].date');
      expect(issues[0].message).toContain('1472 4A 08:00');
      expect(issues[0].message).toContain('Could not find date component');
    });

    it('should detect multiple malformed dates', async () => {
      const ctx = createValidationContext();
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          messages: [
            { role: 'assistant', content: 'test1', speaker: 'dm', date: '1472 4A 08:00' },
            { role: 'user', content: 'test2', speaker: 'player', date: '01.01.1472 4A 09:00' },
            { role: 'assistant', content: 'test3', speaker: 'dm', date: '1473 4A 10:00' },
          ],
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues).toHaveLength(2);
      expect(issues[0].field).toBe('info.messages[0].date');
      expect(issues[1].field).toBe('info.messages[2].date');
    });

    it('should skip messages without dates', async () => {
      const ctx = createValidationContext();
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          messages: [{ role: 'assistant', content: 'test', speaker: 'dm' }],
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues).toHaveLength(0);
    });
  });

  describe('storytellerState dates', () => {
    it('should detect malformed storytellerSelectedAt', async () => {
      const ctx = createValidationContext();
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          storytellerState: {
            storytellerId: 'STORYTELLER_test',
            activePlots: [],
            generationInProgress: false,
            eventHistory: [],
            storytellerSelectedAt: '1472 4A 08:00', // Missing day.month
            custom: {},
          },
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues.length).toBeGreaterThanOrEqual(1);
      expect(issues[0].field).toBe('info.storytellerState.storytellerSelectedAt');
      expect(issues[0].message).toContain('1472 4A 08:00');
    });

    it('should pass for valid storytellerSelectedAt', async () => {
      const ctx = createValidationContext();
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          storytellerState: {
            storytellerId: 'STORYTELLER_test',
            activePlots: [],
            generationInProgress: false,
            eventHistory: [],
            storytellerSelectedAt: '01.01.1472 4A 08:00',
            custom: {},
          },
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues).toHaveLength(0);
    });
    it('should detect malformed nextEventAtGameDate in activePlots', async () => {
      const ctx = createValidationContext();
      const character = createTestCharacter({
        info: {
          ...createTestCharacter().info,
          storytellerState: {
            storytellerId: 'STORYTELLER_test',
            activePlots: [
              {
                plotId: 'plot_123',

                status: 'active',
                events: [],
                storyFlags: [],
                progressLevel: 10,
                nextEventAtGameDate: '1472 4A 10:00', // Missing day.month
              },
            ],
            generationInProgress: false,
            eventHistory: [],
            storytellerSelectedAt: '01.01.1472 4A 08:00',
            custom: {},
          },
        },
      });

      const issues = await dateFormatValidator.validate(character, ctx);
      expect(issues.length).toBeGreaterThanOrEqual(1);
      expect(
        issues.some((i) => i.field === 'info.storytellerState.activePlots[0].nextEventAtGameDate')
      ).toBe(true);
    });
  });

  describe('non-character entities', () => {
    it('should return no issues for place entities', async () => {
      const ctx = createValidationContext();
      const place = {
        id: 'PLACE_test',
        label: 'Test Place',
        description: 'A test place',
        short_description: 'test place',
        tags: [],
        entityType: 'place',
        relationships: [],
        info: {},
      };

      const issues = await dateFormatValidator.validate(place as any, ctx);
      expect(issues).toHaveLength(0);
    });

    it('should return no issues for exit object entities', async () => {
      const ctx = createValidationContext();
      const exitObject = {
        id: 'OBJ_exit_test',
        label: 'Test Exit',
        description: 'A test exit',
        short_description: 'door',
        tags: [],
        entityType: 'object',
        relationships: [],
        info: {
          purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' },
          options: { exitType: 'door', targetPlaceId: 'PLACE_b' },
        },
      };

      const issues = await dateFormatValidator.validate(exitObject as any, ctx);
      expect(issues).toHaveLength(0);
    });
  });
});
