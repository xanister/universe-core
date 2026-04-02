/**
 * Relationship Symmetry Validator Tests
 *
 * The validator now checks for MISSING reciprocal relationships:
 * - When validating character B, it checks if any other character (A) has a relationship TO B
 * - If B doesn't have the same relationship type back to A, it flags as an issue with auto-fix
 */

import { describe, it, expect } from 'vitest';
import { relationshipSymmetryValidator } from '@dmnpc/studio/integrity/validators/relationship-symmetry.js';
import type { Character, Universe, UniverseEvent } from '@dmnpc/types/entity';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

function createTestContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  const characters = new Map<string, Character>();

  // Character A knows B (Alice→Bob friend relationship)
  characters.set('CHAR_alice', {
    id: 'CHAR_alice',
    label: 'Alice',
    description: 'Alice knows Bob',
    short_description: 'alice',
    tags: [],
    entityType: 'character',
    info: {
      aliases: [],
      birthdate: '01.01.1450 4A',
      birthPlace: 'Test Town',
      eyeColor: 'Blue',
      gender: 'Female',
      hairColor: 'Blonde',
      personality: 'Friendly',
      race: 'RACE_human',

      placeId: 'PLACE_root',
      messages: [],
      journal: [],
      voice: { voiceId: 'test', voiceName: 'Test', settings: {} },
    },
    relationships: [{ targetId: 'CHAR_bob', type: 'friend', familiarity: 50 }],
  });

  // Character B does NOT know A (asymmetric - Bob is missing reciprocal to Alice)
  characters.set('CHAR_bob', {
    id: 'CHAR_bob',
    label: 'Bob',
    description: 'Bob',
    short_description: 'bob',
    tags: [],
    entityType: 'character',
    info: {
      aliases: [],
      birthdate: '01.01.1450 4A',
      birthPlace: 'Test Town',
      eyeColor: 'Brown',
      gender: 'Male',
      hairColor: 'Black',
      personality: 'Reserved',
      race: 'RACE_human',

      placeId: 'PLACE_root',
      messages: [],
      journal: [],
      voice: { voiceId: 'test', voiceName: 'Test', settings: {} },
    },
    relationships: [], // Bob has no relationships - missing reciprocal
  });

  // Character C and D have symmetric relationship
  characters.set('CHAR_charlie', {
    id: 'CHAR_charlie',
    label: 'Charlie',
    description: 'Charlie',
    short_description: 'charlie',
    tags: [],
    entityType: 'character',
    info: {
      aliases: [],
      birthdate: '01.01.1450 4A',
      birthPlace: 'Test Town',
      eyeColor: 'Green',
      gender: 'Male',
      hairColor: 'Red',
      personality: 'Jolly',
      race: 'RACE_human',

      placeId: 'PLACE_root',
      messages: [],
      journal: [],
      voice: { voiceId: 'test', voiceName: 'Test', settings: {} },
    },
    relationships: [{ targetId: 'CHAR_david', type: 'friend', familiarity: 50 }],
  });

  characters.set('CHAR_david', {
    id: 'CHAR_david',
    label: 'David',
    description: 'David',
    short_description: 'david',
    tags: [],
    entityType: 'character',
    info: {
      aliases: [],
      birthdate: '01.01.1450 4A',
      birthPlace: 'Test Town',
      eyeColor: 'Blue',
      gender: 'Male',
      hairColor: 'Brown',
      personality: 'Calm',
      race: 'RACE_human',

      placeId: 'PLACE_root',
      messages: [],
      journal: [],
      voice: { voiceId: 'test', voiceName: 'Test', settings: {} },
    },
    relationships: [
      { targetId: 'CHAR_charlie', type: 'friend', familiarity: 50 }, // Symmetric!
    ],
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
    places: new Map(),
    objects: new Map(),
    events: new Map<string, UniverseEvent>(),
    validRaceIds: new Set(['RACE_human']),
    rootPlaceId: 'PLACE_root',
    ...overrides,
  };
}

describe('RelationshipSymmetryValidator', () => {
  it('should detect missing reciprocal relationship and provide auto-fix', async () => {
    const ctx = createTestContext();
    const bob = ctx.characters.get('CHAR_bob')!;

    // When validating Bob, should find that Alice→Bob exists but Bob→Alice doesn't
    const issues = await relationshipSymmetryValidator.validate(bob, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('Missing reciprocal');
    expect(issues[0].message).toContain('Alice');
    expect(issues[0].message).toContain('Bob');

    // Should have auto-fix
    expect(issues[0].suggestedFix).toBeDefined();
    expect(issues[0].suggestedFix?.confidence).toBe('high');
    expect(issues[0].suggestedFix?.method).toBe('deterministic');
    expect(issues[0].suggestedFix?.field).toBe('relationships');

    // The fix value should be the reciprocal relationship
    const fixValue = issues[0].suggestedFix?.value as { targetId: string; type: string };
    expect(fixValue.targetId).toBe('CHAR_alice');
    expect(fixValue.type).toBe('friend');
  });

  it('should not flag symmetric relationship', async () => {
    const ctx = createTestContext();
    const charlie = ctx.characters.get('CHAR_charlie')!;

    // Charlie and David have symmetric relationships
    const issues = await relationshipSymmetryValidator.validate(charlie, ctx);

    expect(issues).toHaveLength(0);
  });

  it('should not flag non-bidirectional relationship types', async () => {
    const ctx = createTestContext();

    // Add a character with a one-way relationship type (mentor is not bidirectional)
    const eve: Character = {
      id: 'CHAR_eve',
      label: 'Eve',
      description: 'Eve',
      short_description: 'eve',
      tags: [],
      entityType: 'character',
      info: {
        aliases: [],
        birthdate: '01.01.1450 4A',
        birthPlace: 'Test Town',
        eyeColor: 'Blue',
        gender: 'Female',
        hairColor: 'Black',
        personality: 'Sneaky',
        race: 'RACE_human',

        placeId: 'PLACE_root',
        messages: [],
        journal: [],
        voice: { voiceId: 'test', voiceName: 'Test', settings: {} },
      },
      relationships: [
        { targetId: 'CHAR_bob', type: 'mentor', familiarity: 50 }, // mentor is not in bidirectional list
      ],
    };
    ctx.characters.set('CHAR_eve', eve);

    // When validating Bob, should NOT flag Eve's mentor relationship (mentor is not bidirectional)
    const bob = ctx.characters.get('CHAR_bob')!;
    const issues = await relationshipSymmetryValidator.validate(bob, ctx);

    // Should still have 1 issue from Alice's friend relationship, but not from Eve's mentor
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Alice'); // From Alice's friend relationship
    expect(issues[0].message).not.toContain('Eve');
  });

  it('should not flag when character already has reciprocal', async () => {
    const ctx = createTestContext();

    // Alice has no one pointing at her with a bidirectional relationship type
    const alice = ctx.characters.get('CHAR_alice')!;
    const issues = await relationshipSymmetryValidator.validate(alice, ctx);

    expect(issues).toHaveLength(0); // No one has a relationship TO Alice that Alice doesn't reciprocate
  });
});
