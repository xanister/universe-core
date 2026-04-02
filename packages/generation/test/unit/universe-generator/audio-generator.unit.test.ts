/**
 * Unit tests for the audio-generator service.
 *
 * inferActivityLevel is now time-of-day only (music/context assumes by purpose).
 * buildSituationSignature uses purpose directly.
 */
import { describe, it, expect } from 'vitest';
import {
  inferActivityLevel,
  buildSituationSignature,
  type ActivityLevel,
} from '@dmnpc/generation/media/audio-generator.js';
import type { Place } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

function createPlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 'PLACE_test',
    label: 'Test Place',
    description: 'A test place',
    short_description: 'A test place',
    entityType: 'place',
    tags: [],
    info: {
      purpose: 'tavern',
      environment: ENVIRONMENT_PRESETS.interior(),
      scale: 'feet',
      spriteConfig: { spriteId: 'test' },
    },
    position: { x: null, y: null, parent: null },
    relationships: [],
    ...overrides,
  } as Place;
}

describe('inferActivityLevel', () => {
  it('returns quiet for night', () => {
    const place = createPlace();
    const result = inferActivityLevel({ place, timeOfDay: 'night', weather: 'clear' });
    expect(result).toBe('quiet');
  });

  it('returns quiet for morning', () => {
    const place = createPlace();
    const result = inferActivityLevel({ place, timeOfDay: 'morning', weather: 'clear' });
    expect(result).toBe('quiet');
  });

  it('returns moderate for day', () => {
    const place = createPlace();
    const result = inferActivityLevel({ place, timeOfDay: 'midday', weather: 'clear' });
    expect(result).toBe('moderate');
  });

  it('returns moderate for afternoon', () => {
    const place = createPlace();
    const result = inferActivityLevel({ place, timeOfDay: 'afternoon', weather: 'clear' });
    expect(result).toBe('moderate');
  });

  it('returns moderate for evening', () => {
    const place = createPlace();
    const result = inferActivityLevel({ place, timeOfDay: 'evening', weather: 'clear' });
    expect(result).toBe('moderate');
  });

  it('returns moderate for dusk', () => {
    const place = createPlace();
    const result = inferActivityLevel({ place, timeOfDay: 'dusk', weather: 'clear' });
    expect(result).toBe('moderate');
  });
});

describe('buildSituationSignature', () => {
  it('builds signature from purpose, environment, time, and optional weather', () => {
    const place = createPlace({
      info: {
        purpose: 'tavern',
        environment: ENVIRONMENT_PRESETS.interior(),
        scale: 'feet',
        spriteConfig: { spriteId: 'test' },
      },
    });
    const result = buildSituationSignature({
      place,
      timeOfDay: 'evening',
      weather: 'clear',
    });
    expect(result).toBe('tavern_interior_evening');
  });

  it('includes weather when not clear', () => {
    const place = createPlace({
      info: {
        purpose: 'tavern',
        environment: ENVIRONMENT_PRESETS.interior(),
        scale: 'feet',
        spriteConfig: { spriteId: 'test' },
      },
    });
    const result = buildSituationSignature({
      place,
      timeOfDay: 'night',
      weather: 'rain',
    });
    expect(result).toBe('tavern_interior_night_rain');
  });

  it('produces empty purpose segment when purpose is missing (no fallback)', () => {
    const place = createPlace({
      info: {
        purpose: 'wilderness',
        environment: ENVIRONMENT_PRESETS.exterior(),
        scale: 'feet',
        spriteConfig: { spriteId: 'test' },
      },
    });
    delete (place.info as { purpose?: string }).purpose;
    const result = buildSituationSignature({
      place,
      timeOfDay: 'midday', // simplifies to 'day'
      weather: 'clear',
    });
    expect(result).toBe('_exterior_day');
  });
});
