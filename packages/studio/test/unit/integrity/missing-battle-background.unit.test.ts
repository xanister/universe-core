/**
 * Missing Battle Background Validator Tests
 *
 * FEAT-192: Battle Backgrounds (Combat & Equipment System — Phase 6)
 */

import { describe, it, expect } from 'vitest';
import { missingBattleBackgroundValidator } from '@dmnpc/studio/integrity/validators/missing-battle-background.js';
import type {
  Place,
  Character,
  ObjectEntity,
  UniverseEvent
} from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

function createTestContext(): ValidationContext {
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
    validRaceIds: new Set(),
    rootPlaceId: 'PLACE_root',
  };
}

function createPlace(overrides?: Partial<Place>): Place {
  return {
    id: 'PLACE_tavern',
    label: 'Tavern',
    description: 'A tavern',
    short_description: 'tavern',
    entityType: 'place',
    tags: [],
    info: {
      purpose: 'tavern',
      environment: ENVIRONMENT_PRESETS.interior(),
      scale: 'feet',
      spriteConfig: { spriteId: 'tavern' },
      music: null,
      musicHints: null,
      commonKnowledge: null,
      secrets: null,
      isTemporary: false,
      dockedAtPlaceId: null,
      timeScale: 1,
      battleBackgroundUrl: '',
      inheritedRequiredTags: null,
    },
    position: { x: 0, y: 0, parent: 'PLACE_root', width: 64, height: 64, innerWidth: 0, innerHeight: 0 },
    relationships: [],
    ...overrides,
  } as Place;
}

describe('missingBattleBackgroundValidator', () => {
  const ctx = createTestContext();

  it('returns no issues for place with battle background URL', () => {
    const place = createPlace({
      info: {
        ...createPlace().info,
        battleBackgroundUrl: 'https://s3.example.com/battles/PLACE_tavern.png',
      },
    });

    const issues = missingBattleBackgroundValidator.validate(place, ctx);
    expect(issues).toHaveLength(0);
  });

  it('reports issue for place with empty battleBackgroundUrl', () => {
    const place = createPlace(); // battleBackgroundUrl: ''

    const issues = missingBattleBackgroundValidator.validate(place, ctx);

    expect(issues).toHaveLength(1);
    expect(issues[0].entityId).toBe('PLACE_tavern');
    expect(issues[0].entityType).toBe('place');
    expect(issues[0].field).toBe('info.battleBackgroundUrl');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].suggestedFix?.method).toBe('battle-background');
    expect(issues[0].suggestedFix?.confidence).toBe('high');
  });

  it('skips non-place entities', () => {
    const character = {
      id: 'CHAR_test',
      label: 'Test',
      entityType: 'character',
    } as unknown as Character;

    const issues = missingBattleBackgroundValidator.validate(character, ctx);
    expect(issues).toHaveLength(0);
  });

  it('skips object entities', () => {
    const obj = {
      id: 'OBJ_test',
      label: 'Test',
      entityType: 'object',
    } as unknown as ObjectEntity;

    const issues = missingBattleBackgroundValidator.validate(obj, ctx);
    expect(issues).toHaveLength(0);
  });
});
