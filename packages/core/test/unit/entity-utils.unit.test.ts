import { describe, it, expect } from 'vitest';
import type { BaseEntity, Character } from '@dmnpc/types/entity';
import {
  addDisplayNames,
  matchesEntityByName,
  partialMatchEntityByName,
  findEntityByName,
} from '@dmnpc/core/entities/entity-utils.js';

// ============================================================================
// Test Data
// ============================================================================

function createMockEntity(overrides: Partial<BaseEntity> = {}): BaseEntity {
  return {
    id: 'ENTITY_test',
    label: 'Test Entity',
    entityType: 'character',
    description: 'A test entity',
    short_description: 'test',
    tags: [],
    info: {},
    relationships: [],
    ...overrides,
  };
}

// ============================================================================
// Tests: matchesEntityByName
// ============================================================================

describe('matchesEntityByName', () => {
  it('matches entity by exact label (case-insensitive)', () => {
    const entity = createMockEntity({ label: 'Old Tom' });

    expect(matchesEntityByName('Old Tom', entity)).toBe(true);
    expect(matchesEntityByName('old tom', entity)).toBe(true);
    expect(matchesEntityByName('OLD TOM', entity)).toBe(true);
  });

  it('matches entity by alias', () => {
    const entity = createMockEntity({
      label: 'Thomas Greenwood',
      aliases: ['Old Tom', 'Tom', 'The Barkeep'],
    });

    expect(matchesEntityByName('Old Tom', entity)).toBe(true);
    expect(matchesEntityByName('tom', entity)).toBe(true);
    expect(matchesEntityByName('the barkeep', entity)).toBe(true);
  });

  it('does not match partial names', () => {
    const entity = createMockEntity({ label: 'Old Tom' });

    expect(matchesEntityByName('Old', entity)).toBe(false);
    expect(matchesEntityByName('Tom', entity)).toBe(false);
  });

  it('handles entities without aliases', () => {
    const entity = createMockEntity({ label: 'Simple Entity' });

    expect(matchesEntityByName('Simple Entity', entity)).toBe(true);
    expect(matchesEntityByName('Other Name', entity)).toBe(false);
  });

  it('handles empty search term', () => {
    const entity = createMockEntity({ label: 'Test' });

    expect(matchesEntityByName('', entity)).toBe(false);
    expect(matchesEntityByName('   ', entity)).toBe(false);
  });

  it('trims whitespace from search term', () => {
    const entity = createMockEntity({ label: 'Test Entity' });

    expect(matchesEntityByName('  Test Entity  ', entity)).toBe(true);
  });
});

// ============================================================================
// Tests: partialMatchEntityByName
// ============================================================================

describe('partialMatchEntityByName', () => {
  it('matches partial label (case-insensitive)', () => {
    const entity = createMockEntity({ label: 'The Green Dragon Inn' });

    expect(partialMatchEntityByName('green dragon', entity)).toBe(true);
    expect(partialMatchEntityByName('Green', entity)).toBe(true);
    expect(partialMatchEntityByName('dragon inn', entity)).toBe(true);
  });

  it('matches partial alias', () => {
    const entity = createMockEntity({
      label: 'Harbor District Market Square',
      aliases: ['The Market', 'Fish Market'],
    });

    expect(partialMatchEntityByName('market', entity)).toBe(true);
    expect(partialMatchEntityByName('fish', entity)).toBe(true);
    expect(partialMatchEntityByName('harbor', entity)).toBe(true);
  });

  it('does not match unrelated terms', () => {
    const entity = createMockEntity({ label: 'The Tavern' });

    expect(partialMatchEntityByName('marketplace', entity)).toBe(false);
    expect(partialMatchEntityByName('xyz', entity)).toBe(false);
  });

  it('handles empty search term', () => {
    const entity = createMockEntity({ label: 'Test' });

    expect(partialMatchEntityByName('', entity)).toBe(false);
  });
});

// ============================================================================
// Tests: findEntityByName
// ============================================================================

describe('findEntityByName', () => {
  const entities = [
    createMockEntity({ id: 'E1', label: 'The Harbor' }),
    createMockEntity({ id: 'E2', label: 'Harbor District', aliases: ['The Docks'] }),
    createMockEntity({ id: 'E3', label: 'Market Square' }),
    createMockEntity({ id: 'E4', label: 'Harbor Inn', aliases: ['Sailors Rest'] }),
  ];

  it('finds entity by exact match (prioritized)', () => {
    const result = findEntityByName('The Harbor', entities);
    expect(result?.id).toBe('E1');
  });

  it('finds entity by exact alias match', () => {
    const result = findEntityByName('The Docks', entities);
    expect(result?.id).toBe('E2');
  });

  it('falls back to partial match if no exact match', () => {
    const result = findEntityByName('Sailors', entities);
    expect(result?.id).toBe('E4');
  });

  it('returns undefined if no match found', () => {
    const result = findEntityByName('Nonexistent', entities);
    expect(result).toBeUndefined();
  });

  it('returns first exact match when multiple partial matches exist', () => {
    // "Harbor" partially matches E1, E2, and E4
    // But E1 matches exactly "The Harbor" only via partial
    // Let's test with exact match for E2
    const result = findEntityByName('Harbor District', entities);
    expect(result?.id).toBe('E2');
  });

  it('handles empty entity list', () => {
    const result = findEntityByName('Test', []);
    expect(result).toBeUndefined();
  });
});

// ============================================================================
// Tests: addDisplayNames
// ============================================================================

function createMockCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'CHAR_player',
    label: 'Player',
    entityType: 'character',
    description: 'The player character',
    short_description: 'adventurer',
    tags: [],
    info: {
      aliases: [],
      birthdate: '',
      birthPlace: '',
      eyeColor: '',
      gender: '',
      hairColor: '',

      personality: '',
      race: '',
      placeId: '',
    },
    relationships: [],
    ...overrides,
  };
}

describe('addDisplayNames', () => {
  it('returns short_description for entities when no context is provided', () => {
    // Without a UniverseContext, entities are treated as unknown
    const player = createMockCharacter();
    const entities = [
      createMockEntity({ id: 'CHAR_known', label: 'Known Entity', short_description: 'someone' }),
    ];

    const result = addDisplayNames(entities, player);

    expect(result[0].displayName).toBe('someone');
  });

  it('returns short_description for entities the player does not know (familiarity < 20)', () => {
    const player = createMockCharacter({
      relationships: [
        { targetId: 'ENTITY_unknown', type: 'stranger', disposition: 0, familiarity: 10 },
      ],
    });
    const entities = [
      createMockEntity({
        id: 'ENTITY_unknown',
        label: 'Unknown Entity',
        short_description: 'a mysterious figure',
      }),
    ];

    const result = addDisplayNames(entities, player);

    expect(result[0].displayName).toBe('a mysterious figure');
  });

  it('returns short_description for entities with no relationship', () => {
    const player = createMockCharacter({ relationships: [] });
    const entities = [
      createMockEntity({
        id: 'ENTITY_stranger',
        label: 'Stranger',
        short_description: 'a tall person',
      }),
    ];

    const result = addDisplayNames(entities, player);

    expect(result[0].displayName).toBe('a tall person');
  });

  it('returns label for the player themselves', () => {
    const player = createMockCharacter({
      id: 'CHAR_player',
      label: 'Hero',
      short_description: 'you',
    });
    const entities = [
      createMockEntity({ id: 'CHAR_player', label: 'Hero', short_description: 'you' }),
    ];

    const result = addDisplayNames(entities, player);

    expect(result[0].displayName).toBe('Hero');
  });

  it('handles multiple entities with mixed entity types', () => {
    // Without context, all non-exit entities use short_description
    const player = createMockCharacter();
    const entities = [
      createMockEntity({
        id: 'CHAR_friend',
        label: 'Best Friend',
        short_description: 'a friendly face',
      }),
      createMockEntity({
        id: 'CHAR_stranger',
        label: 'Mysterious Mage',
        short_description: 'a hooded figure',
      }),
      createMockEntity({
        id: 'OBJ_exit_door',
        label: 'Market Square',
        entityType: 'object',
        short_description: 'door',
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'door', targetPlaceId: 'PLACE_market' } },
      }),
    ];

    const result = addDisplayNames(entities, player);

    expect(result[0].displayName).toBe('a friendly face'); // character uses short_description
    expect(result[1].displayName).toBe('a hooded figure'); // character uses short_description
    expect(result[2].displayName).toBe('Market Square'); // exit uses label
  });

  it('returns empty array for empty input', () => {
    const player = createMockCharacter();
    const result = addDisplayNames([], player);

    expect(result).toEqual([]);
  });

  it('uses description as fallback when short_description is empty', () => {
    const player = createMockCharacter({ relationships: [] });
    const entities = [
      createMockEntity({
        id: 'ENTITY_test',
        label: 'Test',
        short_description: '',
        description: 'A detailed description',
      }),
    ];

    const result = addDisplayNames(entities, player);

    expect(result[0].displayName).toBe('A detailed description');
  });

  it('preserves all original entity properties', () => {
    const player = createMockCharacter();
    const entity = createMockEntity({
      id: 'ENTITY_test',
      label: 'Test',
      tags: ['tag1', 'tag2'],
      description: 'A test description',
    });

    const result = addDisplayNames([entity], player);

    expect(result[0].id).toBe('ENTITY_test');
    expect(result[0].label).toBe('Test');
    expect(result[0].tags).toEqual(['tag1', 'tag2']);
    expect(result[0].description).toBe('A test description');
    expect(result[0].displayName).toBeDefined();
  });

  it('returns label for exits regardless of familiarity', () => {
    const player = createMockCharacter({ relationships: [] });
    const exit = createMockEntity({
      id: 'OBJ_exit_test',
      label: 'The Backwash Nook',
      entityType: 'object',
      short_description: 'tunnel', // Exit type, not a description
      info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'tunnel', targetPlaceId: 'PLACE_test' } },
    });

    const result = addDisplayNames([exit], player);

    // Exits always show destination name (label), not exit type
    expect(result[0].displayName).toBe('The Backwash Nook');
  });

  it('returns label for exits even when player has no relationship', () => {
    const player = createMockCharacter({ relationships: [] });
    const entities = [
      // Character without relationship shows short_description
      createMockEntity({
        id: 'CHAR_stranger',
        label: 'Mysterious Stranger',
        entityType: 'character',
        short_description: 'a hooded figure',
      }),
      // Exit without relationship still shows label
      createMockEntity({
        id: 'OBJ_exit_door',
        label: 'Market Square',
        entityType: 'object',
        short_description: 'door',
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'door', targetPlaceId: 'PLACE_market' } },
      }),
    ];

    const result = addDisplayNames(entities, player);

    expect(result[0].displayName).toBe('a hooded figure'); // Character uses short_description
    expect(result[1].displayName).toBe('Market Square'); // Exit uses label
  });
});
