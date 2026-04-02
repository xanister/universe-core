/**
 * Duplicate Entity Validator Tests
 */

import { describe, it, expect } from 'vitest';
import { duplicateEntityValidator } from '@dmnpc/studio/integrity/validators/duplicate-entities.js';
import type { Character, Place, Universe } from '@dmnpc/types/entity';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

function createTestContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  const places = new Map<string, Place>();
  const characters = new Map<string, Character>();

  // Add an original character
  characters.set('CHAR_john_smith', {
    id: 'CHAR_john_smith',
    label: 'John Smith',
    description: 'The original John Smith',
    short_description: 'john',
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

      placeId: 'PLACE_root',
      messages: [],
      journal: [],
    },
    relationships: {},
  });

  // Add an original place
  places.set('PLACE_tavern', {
    id: 'PLACE_tavern',
    label: 'The Tavern',
    description: 'A cozy tavern',
    short_description: 'tavern',
    tags: [],
    entityType: 'place',
    info: {},
    relationships: {},
  });

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
      races: [],
      rootPlaceId: 'PLACE_root',
    } as Universe,
    characters,
    places,
    objects: new Map(),
    validRaceIds: new Set(['RACE_human']),
    rootPlaceId: 'PLACE_root',
    ...overrides,
  };
}

describe('DuplicateEntityValidator', () => {
  it('should detect character duplicate with _1 suffix', async () => {
    const duplicate: Character = {
      id: 'CHAR_john_smith_1', // Duplicate suffix
      label: 'John Smith',
      description: 'Another John Smith',
      short_description: 'john',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await duplicateEntityValidator.validate(duplicate, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].validatorId).toBe('duplicate-entities');
    expect(issues[0].suggestedFix?.method).toBe('merge');
    expect(issues[0].suggestedFix?.value).toBe('CHAR_john_smith');
  });

  it('should detect place duplicate with _2 suffix', async () => {
    const duplicate: Place = {
      id: 'PLACE_tavern_2', // Duplicate suffix
      label: 'The Tavern',
      description: 'Another tavern',
      short_description: 'tavern',
      tags: [],
      entityType: 'place',
      info: {},
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await duplicateEntityValidator.validate(duplicate, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].suggestedFix?.value).toBe('PLACE_tavern');
  });

  it('should not flag entity without duplicate suffix', async () => {
    const character: Character = {
      id: 'CHAR_unique_character',
      label: 'Unique Character',
      description: 'A unique character',
      short_description: 'unique',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await duplicateEntityValidator.validate(character, ctx);

    expect(issues).toHaveLength(0);
  });

  it('should not flag suffix entity when original does not exist', async () => {
    const orphanedSuffix: Character = {
      id: 'CHAR_orphan_1', // Suffix but no original CHAR_orphan exists
      label: 'Orphan',
      description: 'An orphan with suffix',
      short_description: 'orphan',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const ctx = createTestContext();
    const issues = await duplicateEntityValidator.validate(orphanedSuffix, ctx);

    expect(issues).toHaveLength(0); // No original, so not a duplicate
  });

  it('should detect when an original entity has duplicates', async () => {
    // Create context with original and its duplicate
    const characters = new Map<string, Character>();

    const original: Character = {
      id: 'CHAR_john_smith',
      label: 'John Smith',
      description: 'The original John Smith',
      short_description: 'john',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const duplicate: Character = {
      id: 'CHAR_john_smith_1',
      label: 'John Smith',
      description: 'A duplicate John Smith',
      short_description: 'john',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    characters.set('CHAR_john_smith', original);
    characters.set('CHAR_john_smith_1', duplicate);

    const ctx = createTestContext({ characters });
    // Validate the ORIGINAL - should detect it has duplicates
    const issues = await duplicateEntityValidator.validate(original, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].validatorId).toBe('duplicate-entities');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('has 1 duplicate');
    expect(issues[0].suggestedFix?.method).toBe('merge');
    expect(issues[0].suggestedFix?.value).toEqual(['CHAR_john_smith_1']);
  });

  it('should detect multiple duplicates of an original entity', async () => {
    // Create context with original and multiple duplicates
    const characters = new Map<string, Character>();

    const original: Character = {
      id: 'CHAR_john_smith',
      label: 'John Smith',
      description: 'The original John Smith',
      short_description: 'john',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const duplicate1: Character = {
      id: 'CHAR_john_smith_1',
      label: 'John Smith',
      description: 'First duplicate',
      short_description: 'john',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    const duplicate2: Character = {
      id: 'CHAR_john_smith_2',
      label: 'John Smith',
      description: 'Second duplicate',
      short_description: 'john',
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

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
      },
      relationships: {},
    };

    characters.set('CHAR_john_smith', original);
    characters.set('CHAR_john_smith_1', duplicate1);
    characters.set('CHAR_john_smith_2', duplicate2);

    const ctx = createTestContext({ characters });
    // Validate the ORIGINAL - should detect it has duplicates
    const issues = await duplicateEntityValidator.validate(original, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('has 2 duplicate');
    expect(issues[0].suggestedFix?.value).toEqual(['CHAR_john_smith_1', 'CHAR_john_smith_2']);
  });
});
