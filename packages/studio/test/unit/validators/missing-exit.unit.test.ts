import { describe, it, expect } from 'vitest';
import { validateMissingExits } from '../../../src/integrity/validators/missing-exit.js';
import type { ValidationContext } from '../../../src/integrity/integrity-types.js';
import type { Place, ObjectEntity, ObjectInfo } from '@dmnpc/types/entity';

function makePlace(id: string, parentId: string | null, scale: string = 'feet'): Place {
  return {
    id,
    label: id,
    description: '',
    short_description: '',
    tags: [],
    entityType: 'place',
    info: { scale, environment: 'temperate', timeScale: 1 },
    position: { x: 0, y: 0, width: 100, height: 100, parent: parentId },
    relationships: [],
    important: false,
  } as Place;
}

function makeExitObject(id: string, placeId: string): ObjectEntity {
  return {
    id,
    label: 'Exit',
    description: 'An exit',
    short_description: 'door',
    tags: [],
    entityType: 'object',
    info: {
      purpose: 'exit',
      solid: true,
      layer: 'default',
      spriteConfig: { spriteId: 'door_wooden', frame: null, animationKey: null, animated: false },
    } as ObjectInfo,
    position: { x: 10, y: 10, width: 32, height: 48, parent: placeId },
    relationships: [],
    important: false,
  } as ObjectEntity;
}

function makeCtx(places: Place[], objects: ObjectEntity[]): ValidationContext {
  return {
    universe: { id: 'test', label: 'Test' } as ValidationContext['universe'],
    characters: new Map(),
    places: new Map(places.map((p) => [p.id, p])),
    objects: new Map(objects.map((o) => [o.id, o])),
    events: new Map(),
    validRaceIds: new Set(),
    rootPlaceId: 'PLACE_cosmos',
  };
}

describe('validateMissingExits', () => {
  it('passes when a place without an exit object has no parent (root)', () => {
    const cosmos = makePlace('PLACE_cosmos', null, 'lightyears');
    const result = validateMissingExits(makeCtx([cosmos], []));
    expect(result.missingExits).toHaveLength(0);
  });

  it('passes when a feet-scale place has an exit object', () => {
    const cosmos = makePlace('PLACE_cosmos', null, 'lightyears');
    const town = makePlace('PLACE_town', 'PLACE_cosmos', 'feet');
    const exit = makeExitObject('OBJ_exit_town', 'PLACE_town');
    const result = validateMissingExits(makeCtx([cosmos, town], [exit]));
    expect(result.missingExits).toHaveLength(0);
  });

  it('passes when a place without an exit is non-feet scale', () => {
    const cosmos = makePlace('PLACE_cosmos', null, 'lightyears');
    const region = makePlace('PLACE_region', 'PLACE_cosmos', 'miles');
    const result = validateMissingExits(makeCtx([cosmos, region], []));
    expect(result.missingExits).toHaveLength(0);
  });

  it('reports a feet-scale place missing an exit object', () => {
    const cosmos = makePlace('PLACE_cosmos', null, 'lightyears');
    const tavern = makePlace('PLACE_tavern', 'PLACE_cosmos', 'feet');
    const result = validateMissingExits(makeCtx([cosmos, tavern], []));
    expect(result.missingExits).toHaveLength(1);
    expect(result.missingExits[0].placeId).toBe('PLACE_tavern');
  });

  it('exits are optional — validation reports but does not block', () => {
    // FEAT-402: exits are optional. The validator reports missing exits
    // as informational findings (missingExits array), not as hard errors.
    // Callers decide whether to act on them.
    const cosmos = makePlace('PLACE_cosmos', null, 'lightyears');
    const tavern = makePlace('PLACE_tavern', 'PLACE_cosmos', 'feet');
    const result = validateMissingExits(makeCtx([cosmos, tavern], []));
    // Validator returns findings but repaired is false (informational)
    expect(result.repaired).toBe(false);
    expect(result.repairs).toHaveLength(0);
  });
});
