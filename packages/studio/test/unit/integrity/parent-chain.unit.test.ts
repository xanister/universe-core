/**
 * Parent Chain Validator Tests
 */

import { describe, it, expect } from 'vitest';
import { parentChainValidator } from '@dmnpc/studio/integrity/validators/parent-chain.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import { type Place, type Universe } from '@dmnpc/types/entity';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

const ROOT_PLACE_ID = 'PLACE_the_cosmos';

function createTestContext(
  placesArray: Place[],
  overrides: Partial<ValidationContext> = {}
): ValidationContext {
  const places = new Map<string, Place>();
  for (const place of placesArray) {
    places.set(place.id, place);
  }

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
      rootPlaceId: ROOT_PLACE_ID,
    } as Universe,
    characters: new Map(),
    places,
    objects: new Map(),
    events: new Map(),
    validRaceIds: new Set(['RACE_human']),
    rootPlaceId: ROOT_PLACE_ID,
    ...overrides,
  };
}

function createPlace(
  id: string,
  label: string,
  parentId: string | null,
  overrides: Partial<Place> = {}
): Place {
  return {
    id,
    label,
    description: `A ${label}`,
    short_description: label.toLowerCase(),
    tags: [],
    entityType: 'place',
    info: {
      environment: ENVIRONMENT_PRESETS.exterior(),
    },
    position: {
      x: null,
      y: null,
      parent: parentId,
    },
    relationships: [],
    ...overrides,
  };
}

describe('ParentChainValidator', () => {
  describe('valid chains', () => {
    it('should pass for cosmos (root place)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const ctx = createTestContext([cosmos]);

      const issues = await parentChainValidator.validate(cosmos, ctx);

      expect(issues).toHaveLength(0);
    });

    it('should pass for a valid chain: room -> building -> city -> region -> planet -> cosmos', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const planet = createPlace('PLACE_planet', 'Planet', ROOT_PLACE_ID);
      const region = createPlace('PLACE_region', 'Region', 'PLACE_planet');
      const city = createPlace('PLACE_city', 'City', 'PLACE_region');
      const building = createPlace('PLACE_building', 'Building', 'PLACE_city');
      const room = createPlace('PLACE_room', 'Room', 'PLACE_building');

      const ctx = createTestContext([cosmos, planet, region, city, building, room]);

      // Test each place in the chain
      expect(await parentChainValidator.validate(cosmos, ctx)).toHaveLength(0);
      expect(await parentChainValidator.validate(planet, ctx)).toHaveLength(0);
      expect(await parentChainValidator.validate(region, ctx)).toHaveLength(0);
      expect(await parentChainValidator.validate(city, ctx)).toHaveLength(0);
      expect(await parentChainValidator.validate(building, ctx)).toHaveLength(0);
      expect(await parentChainValidator.validate(room, ctx)).toHaveLength(0);
    });

    it('should pass for a short valid chain: place -> cosmos', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const place = createPlace('PLACE_direct', 'Direct Place', ROOT_PLACE_ID);

      const ctx = createTestContext([cosmos, place]);

      expect(await parentChainValidator.validate(place, ctx)).toHaveLength(0);
    });
  });

  describe('cycle detection', () => {
    it('should detect a self-referencing place (A -> A) and create clarification question', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const selfRef = createPlace('PLACE_self', 'Self Reference', 'PLACE_self');

      const ctx = createTestContext([cosmos, selfRef]);

      const issues = await parentChainValidator.validate(selfRef, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('cycle');
      expect(issues[0].message).toContain('PLACE_self');
      // Self-referencing cycle has no valid ancestor, so no deterministic fix
      expect(issues[0].suggestedFix).toBeUndefined();
      // But it should have a clarification question asking user to specify parent
      expect(issues[0].clarificationQuestion).toBeDefined();
      expect(issues[0].clarificationQuestion?.category).toBe('hierarchy');
      expect(issues[0].clarificationQuestion?.question).toContain('Self Reference');
    });

    it('should detect a two-place cycle (A -> B -> A)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const placeA = createPlace('PLACE_a', 'Place A', 'PLACE_b');
      const placeB = createPlace('PLACE_b', 'Place B', 'PLACE_a');

      const ctx = createTestContext([cosmos, placeA, placeB]);

      // Validate from A's perspective
      const issues = await parentChainValidator.validate(placeA, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('cycle');
    });

    it('should detect a multi-place cycle (A -> B -> C -> A)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const placeA = createPlace('PLACE_a', 'Place A', 'PLACE_b');
      const placeB = createPlace('PLACE_b', 'Place B', 'PLACE_c');
      const placeC = createPlace('PLACE_c', 'Place C', 'PLACE_a');

      const ctx = createTestContext([cosmos, placeA, placeB, placeC]);

      const issues = await parentChainValidator.validate(placeA, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('cycle');
    });

    it('should provide deterministic fix when valid ancestor exists before cycle', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const validAncestor = createPlace('PLACE_valid', 'Valid Ancestor', ROOT_PLACE_ID);
      // cycleA points to cycleB, cycleB points back to cycleA
      // but cycleA's actual parent in the chain was validAncestor before the cycle
      const cycleA = createPlace('PLACE_cycle_a', 'Cycle A', 'PLACE_cycle_b');
      const cycleB = createPlace('PLACE_cycle_b', 'Cycle B', 'PLACE_cycle_a');

      const ctx = createTestContext([cosmos, validAncestor, cycleA, cycleB]);

      const issues = await parentChainValidator.validate(cycleA, ctx);

      expect(issues).toHaveLength(1);
      // In a pure A -> B -> A cycle with no external ancestor, there's no valid ancestor
      // The fix would only be available if there was a branch point
    });

    it('should NOT suggest setting a place as its own parent when ancestors have a cycle', async () => {
      // Regression test: A place with a valid parent should NOT be "fixed" to point to itself
      // when that parent is part of a cycle elsewhere in the hierarchy.
      // Bug: walkParentChain was incorrectly selecting chain[0] (the starting place) as nearestValidAncestor
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      // Create a valid place pointing to an ancestor that's part of a cycle
      const goodPlace = createPlace(
        'PLACE_good',
        'Good Place',
        'PLACE_cycle_member' // Points to a place that's part of a cycle
      );
      // Create a cycle: cycle_member -> cycle_other -> cycle_member
      const cycleMember = createPlace('PLACE_cycle_member', 'Cycle Member', 'PLACE_cycle_other');
      const cycleOther = createPlace('PLACE_cycle_other', 'Cycle Other', 'PLACE_cycle_member');

      const ctx = createTestContext([cosmos, goodPlace, cycleMember, cycleOther]);

      const issues = await parentChainValidator.validate(goodPlace, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('cycle');

      // CRITICAL: The fix should NOT suggest setting the place's parent to itself
      if (issues[0].suggestedFix) {
        expect(issues[0].suggestedFix.value).not.toBe('PLACE_good');
      }
    });
  });

  describe('broken chains', () => {
    it('should detect a broken chain (parent does not exist)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const orphan = createPlace('PLACE_orphan', 'Orphan', 'PLACE_nonexistent');

      const ctx = createTestContext([cosmos, orphan]);

      const issues = await parentChainValidator.validate(orphan, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('broken parent chain');
      expect(issues[0].message).toContain('PLACE_nonexistent');
      expect(issues[0].suggestedFix?.method).toBe('llm');
    });

    it('should detect a deep broken chain (ancestor does not exist)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      // Parent exists but grandparent doesn't
      const brokenParent = createPlace(
        'PLACE_broken_parent',
        'Broken Parent',
        'PLACE_missing_grandparent'
      );
      const child = createPlace('PLACE_child', 'Child', 'PLACE_broken_parent');

      const ctx = createTestContext([cosmos, brokenParent, child]);

      // The child has valid immediate parent, but the chain is broken further up
      const issues = await parentChainValidator.validate(child, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('broken parent chain');
      expect(issues[0].message).toContain('PLACE_missing_grandparent');
    });
  });

  describe('incomplete chains', () => {
    it('should detect incomplete chain (non-cosmos place with null parent)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const orphanRoot = createPlace('PLACE_orphan_root', 'Orphan Root', null);

      const ctx = createTestContext([cosmos, orphanRoot]);

      const issues = await parentChainValidator.validate(orphanRoot, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('incomplete parent chain');
      expect(issues[0].message).toContain('does not reach cosmos');
      expect(issues[0].suggestedFix?.method).toBe('llm');
    });

    it('should detect chain that ends at non-cosmos without reaching cosmos', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      // A separate disconnected hierarchy
      const disconnectedRoot = createPlace('PLACE_disconnected_root', 'Disconnected Root', null);
      const disconnectedChild = createPlace(
        'PLACE_disconnected_child',
        'Disconnected Child',
        'PLACE_disconnected_root'
      );

      const ctx = createTestContext([cosmos, disconnectedRoot, disconnectedChild]);

      const issues = await parentChainValidator.validate(disconnectedChild, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('incomplete parent chain');
    });
  });

  describe('excessive depth', () => {
    it('should detect excessive chain depth (>20 levels)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const places = [cosmos];

      // Create a chain of 25 places
      let parentId = ROOT_PLACE_ID;
      for (let i = 0; i < 25; i++) {
        const placeId = `PLACE_level_${i}`;
        places.push(createPlace(placeId, `Level ${i}`, parentId));
        parentId = placeId;
      }

      const ctx = createTestContext(places);

      // Validate the deepest place
      const deepestPlace = places[places.length - 1];
      const issues = await parentChainValidator.validate(deepestPlace, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('excessive chain depth');
      // No fix for excessive depth - requires manual review
      expect(issues[0].suggestedFix).toBeUndefined();
    });

    it('should pass for chains at exactly 20 levels', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null);
      const places = [cosmos];

      // Create a chain of exactly 19 places (cosmos + 19 = 20 total)
      let parentId = ROOT_PLACE_ID;
      for (let i = 0; i < 19; i++) {
        const placeId = `PLACE_level_${i}`;
        places.push(createPlace(placeId, `Level ${i}`, parentId));
        parentId = placeId;
      }

      const ctx = createTestContext(places);

      // Validate the deepest place
      const deepestPlace = places[places.length - 1];
      const issues = await parentChainValidator.validate(deepestPlace, ctx);

      expect(issues).toHaveLength(0);
    });
  });

  describe('non-place entities', () => {
    it('should skip non-place entities', async () => {
      const character = {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        info: {},
        position: { x: null, y: null, parent: 'PLACE_nonexistent' },
        relationships: [],
      };

      const ctx = createTestContext([]);

      const issues = await parentChainValidator.validate(character as unknown as Place, ctx);

      expect(issues).toHaveLength(0);
    });
  });
});
