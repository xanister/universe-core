/**
 * Internal Conflicts Validator Tests
 */

import { describe, it, expect } from 'vitest';
import { internalConflictsValidator } from '@dmnpc/studio/integrity/validators/internal-conflicts.js';
import type { Character, Universe } from '@dmnpc/types/entity';
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

describe('InternalConflictsValidator', () => {
  it('should detect invalid race ID', async () => {
    const character: Character = {
      id: 'CHAR_test',
      label: 'Test Character',
      description: 'A test character',
      short_description: 'test',
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
        race: 'RACE_invalid', // Invalid race

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await internalConflictsValidator.validate(character, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('info.race');
    expect(issues[0].suggestedFix?.method).toBe('llm');
  });

  it('should not flag valid race ID', async () => {
    const character: Character = {
      id: 'CHAR_test',
      label: 'Test Character',
      description: 'A test character',
      short_description: 'test',
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
        race: 'RACE_human', // Valid race

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await internalConflictsValidator.validate(character, ctx);

    expect(issues).toHaveLength(0);
  });

  it('should not flag empty race (handled by missing-fields)', async () => {
    const character: Character = {
      id: 'CHAR_test',
      label: 'Test Character',
      description: 'A test character',
      short_description: 'test',
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
        race: '', // Empty - not a conflict, handled by missing-fields

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await internalConflictsValidator.validate(character, ctx);

    expect(issues).toHaveLength(0); // Empty is not a conflict
  });

  it('should warn about dead character with recent messages', async () => {
    const character: Character = {
      id: 'CHAR_dead',
      label: 'Dead Character',
      description: 'A deceased character',
      short_description: 'dead',
      tags: [],
      entityType: 'character',
      info: {
        aliases: [],
        birthdate: '01.01.1400 4A',
        birthPlace: 'Test Town',
        eyeColor: 'Blue',
        gender: 'Male',
        hairColor: 'Brown',
        personality: 'Was friendly',
        race: 'RACE_human',
        deathdate: '01.01.1450 4A', // Dead

        placeId: 'PLACE_root',
        messages: [
          {
            speaker: 'CHAR_dead',
            content: 'Hello from beyond!',
            type: 'text',
            date: '01.01.1477 4A', // Recent message after death
          },
        ],
        journal: [],
      },
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await internalConflictsValidator.validate(character, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
      expect(issues[0].message).toContain('Dead character');
    });
});
