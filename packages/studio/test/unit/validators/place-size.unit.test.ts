/**
 * Unit tests for the place-size validator.
 *
 * Tests validation that ensures places have playable area dimensions:
 * - Size is validated from position.innerWidth and position.innerHeight (set when layout is generated)
 * - Missing or invalid inner dimensions are flagged
 *
 * NOTE: This validator no longer uses heuristic inference for size values.
 * All repairs use LLM to determine appropriate dimensions.
 */
import { describe, it, expect } from 'vitest';
import { placeSizeValidator } from '@dmnpc/studio/integrity/validators/place-size.js';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';
import type { Place, Universe } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

describe('placeSizeValidator', () => {
  function createContext(places: Place[] = []): ValidationContext {
    const universe: Universe = {
      id: 'test_universe',
      name: 'Test Universe',
      description: 'A test universe',
      places,
      objects: [],
    };

    return {
      universe,
      characters: new Map(),
      places: new Map(places.map((p) => [p.id, p])),
      objects: new Map(),
      events: new Map(),
      validRaceIds: new Set(),
      rootPlaceId: 'PLACE_root',
    };
  }

  function createPlace(overrides: Partial<Place> = {}): Place {
    return {
      id: 'PLACE_test',
      label: 'Test Place',
      description: 'A test place',
      short_description: 'test place',
      entityType: 'place',
      tags: [],
      position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerWidth: 800, innerHeight: 600 },
      relationships: [],
      info: {
        environment: ENVIRONMENT_PRESETS.interior(),
        scale: 'feet',
      },
      ...overrides,
    };
  }

  describe('valid size formats', () => {
    it('passes when position has valid innerWidth and innerHeight', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerWidth: 400, innerHeight: 300 },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues).toHaveLength(0);
    });

    it('warns when dimensions are missing and place has no map image', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    });

    it('skips validation for the cosmos root', async () => {
      const place = createPlace({
        id: 'PLACE_the_cosmos',
        position: { x: 0, y: 0, width: 48, height: 48, parent: null },
        info: {
          environment: ENVIRONMENT_PRESETS.exterior(),
          scale: 'miles',
        },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues).toHaveLength(0);
    });

    it('skips non-place entities', async () => {
      const character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test character',
        entityType: 'character',
        tags: [],
        position: { x: null, y: null, parent: 'PLACE_test' },
        relationships: [],
        info: {},
      };
      const ctx = createContext();

      const issues = await placeSizeValidator.validate(character as unknown as Place, ctx);

      expect(issues).toHaveLength(0);
    });
  });

  describe('missing dimensions', () => {
    it('flags missing innerWidth', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerHeight: 400 },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].field).toBe('position.innerWidth');
      expect(issues[0].message).toContain('inner');
      expect(issues[0].suggestedFix?.method).toBe('layout');
    });

    it('flags missing innerHeight', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerWidth: 400 },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].field).toBe('position.innerHeight');
      expect(issues[0].message).toContain('inner');
      expect(issues[0].suggestedFix?.method).toBe('layout');
    });

    it('flags both missing innerWidth and innerHeight', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBe(2);
      const fields = issues.map((i) => i.field);
      expect(fields).toContain('position.innerWidth');
      expect(fields).toContain('position.innerHeight');
    });
  });

  describe('invalid dimension values', () => {
    it('detects zero innerWidth', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerWidth: 0, innerHeight: 400 },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].field).toBe('position.innerWidth');
      expect(issues[0].message).toContain('invalid');
      expect(issues[0].suggestedFix?.method).toBe('layout');
    });

    it('detects zero innerHeight', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerWidth: 400, innerHeight: 0 },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].field).toBe('position.innerHeight');
      expect(issues[0].message).toContain('invalid');
      expect(issues[0].suggestedFix?.method).toBe('layout');
    });

    it('detects negative innerWidth', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerWidth: -10, innerHeight: 400 },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].field).toBe('position.innerWidth');
      expect(issues[0].suggestedFix?.method).toBe('layout');
    });

    it('detects negative innerHeight', async () => {
      const place = createPlace({
        position: { x: 0, y: 0, width: 48, height: 48, parent: null, innerWidth: 400, innerHeight: -10 },
      });
      const ctx = createContext([place]);

      const issues = await placeSizeValidator.validate(place, ctx);

      expect(issues.length).toBe(1);
      expect(issues[0].field).toBe('position.innerHeight');
      expect(issues[0].suggestedFix?.method).toBe('layout');
    });
  });
});
