/**
 * Unit tests for slot-routine-builder.
 *
 * Tests deterministic routine creation from purpose definitions.
 */

import { describe, it, expect } from 'vitest';
import { createTestPlace } from '@dmnpc/core/test-helpers/index.js';
import type { PurposeDefinition } from '@dmnpc/types/world';
import { buildSlotRoutine } from '../../src/character/slot-routine-builder.js';

function makePurposeDef(overrides?: Partial<PurposeDefinition>): PurposeDefinition {
  return {
    id: 'bartender',
    label: 'Bartender',
    description: 'Serves drinks',
    category: 'character',
    interactionTypeId: 'talk',
    defaultActivityId: 'tavern_work',
    defaultSchedule: {
      dawn: 'home',
      morning: 'work',
      afternoon: 'work',
      evening: 'work',
      night: 'home',
    },
    system: false,
    ...overrides,
  };
}

describe('buildSlotRoutine', () => {
  it('creates routine with schedule from purpose definition', () => {
    const place = createTestPlace({ id: 'PLACE_tavern', label: 'The Rusty Flagon' });
    const routine = buildSlotRoutine(makePurposeDef(), place, 'PLACE_bedroom');

    expect(routine.schedule).toEqual({
      dawn: 'home',
      morning: 'work',
      afternoon: 'work',
      evening: 'work',
      night: 'home',
    });
  });

  it('sets work location to spawning place', () => {
    const place = createTestPlace({ id: 'PLACE_tavern', label: 'The Rusty Flagon' });
    const routine = buildSlotRoutine(makePurposeDef(), place, 'PLACE_bedroom');

    expect(routine.work!.placeId).toBe('PLACE_tavern');
    expect(routine.work!.description).toBe('The Rusty Flagon');
  });

  it('sets home location to resolved home place', () => {
    const place = createTestPlace({ id: 'PLACE_tavern', label: 'The Rusty Flagon' });
    const routine = buildSlotRoutine(makePurposeDef(), place, 'PLACE_bedroom');

    expect(routine.home.placeId).toBe('PLACE_bedroom');
    expect(routine.home.description).toBe('Quarters near The Rusty Flagon');
  });

  it('uses place label as home description when home is same as work', () => {
    const place = createTestPlace({ id: 'PLACE_tavern', label: 'The Rusty Flagon' });
    const routine = buildSlotRoutine(makePurposeDef(), place, 'PLACE_tavern');

    expect(routine.home.placeId).toBe('PLACE_tavern');
    expect(routine.home.description).toBe('The Rusty Flagon');
  });

  it('sets work activity from defaultActivityId', () => {
    const place = createTestPlace({ id: 'PLACE_tavern' });
    const routine = buildSlotRoutine(makePurposeDef(), place, 'PLACE_tavern');

    expect(routine.activities).toEqual({ work: 'tavern_work' });
  });

  it('omits activities when no defaultActivityId', () => {
    const place = createTestPlace({ id: 'PLACE_tavern' });
    const routine = buildSlotRoutine(
      makePurposeDef({ defaultActivityId: null }),
      place,
      'PLACE_tavern'
    );

    expect(routine.activities).toBeUndefined();
  });

  it('sets variance to 0.2', () => {
    const place = createTestPlace({ id: 'PLACE_tavern' });
    const routine = buildSlotRoutine(makePurposeDef(), place, 'PLACE_tavern');

    expect(routine.variance).toBe(0.2);
  });

  it('sets leisure to null', () => {
    const place = createTestPlace({ id: 'PLACE_tavern' });
    const routine = buildSlotRoutine(makePurposeDef(), place, 'PLACE_tavern');

    expect(routine.leisure).toBeNull();
  });

  it('throws when defaultSchedule is null', () => {
    const place = createTestPlace({ id: 'PLACE_tavern' });
    expect(() =>
      buildSlotRoutine(makePurposeDef({ defaultSchedule: null }), place, 'PLACE_tavern')
    ).toThrow('has no defaultSchedule');
  });

  it('sets home.placeId to null and home.areaHint to area hint string when homePlaceId is null', () => {
    const place = createTestPlace({ id: 'PLACE_tavern', label: 'The Rusty Flagon' });
    const routine = buildSlotRoutine(makePurposeDef(), place, null, 'Market District area');

    expect(routine.home.placeId).toBeNull();
    expect(routine.home.areaHint).toBe('Market District area');
    expect(routine.home.description).toBe('Quarters near The Rusty Flagon');
  });

  it('uses work place label as area hint when homePlaceId is null and no hint provided', () => {
    const place = createTestPlace({ id: 'PLACE_tavern', label: 'The Rusty Flagon' });
    const routine = buildSlotRoutine(makePurposeDef(), place, null);

    expect(routine.home.placeId).toBeNull();
    expect(routine.home.areaHint).toBe('The Rusty Flagon area');
  });
});
