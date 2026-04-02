/**
 * Place Label Validator Tests
 *
 * Tests the unified place label validator which handles:
 * - Parenthetical details → clarification questions
 * - Generic region names → LLM repair
 *
 * Detection is mutually exclusive (stops at first match).
 */

import { describe, it, expect } from 'vitest';
import { placeLabelValidator } from '@dmnpc/studio/integrity/validators/place-label.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import { type Place, type Universe } from '@dmnpc/types/entity';

const ROOT_PLACE_ID = 'PLACE_the_cosmos';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createPlace(
  id: string,
  label: string,
  parentId: string | null,
  options: {
    environment?: 'interior' | 'exterior' | 'space';
    scale?: 'feet' | 'miles' | 'lightyears';
  } = {}
): Place {
  return {
    id,
    label,
    description: `A ${label}`,
    short_description: label.toLowerCase(),
    tags: [],
    entityType: 'place',
    info: {
      environment: options.environment ?? 'exterior',
      scale: options.scale ?? 'feet',
      size: { width: 100, height: 100 },
    },
    position: {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      parent: parentId,
    },
    relationships: [],
  };
}

function createTestContext(placesArray: Place[]): ValidationContext {
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
      rootPlaceId: 'PLACE_root',
    } as Universe,
    characters: new Map(),
    places,
    objects: new Map(),
    events: new Map(),
    validRaceIds: new Set(['RACE_human']),
    rootPlaceId: 'PLACE_root',
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('PlaceLabelValidator', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // PARENTHETICAL DETAILS (clarification questions)
  // ───────────────────────────────────────────────────────────────────────────

  describe('parenthetical details', () => {
    it('detects parenthetical details and creates clarification question', async () => {
      const place = createPlace('PLACE_test', 'Market Square (Fish Stalls)', null);
      const ctx = createTestContext([place]);

      const issues = await placeLabelValidator.validate(place, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].validatorId).toBe('place-label');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].message).toContain('parenthetical details');
      // Should have clarification question, NOT suggestedFix
      expect(issues[0].suggestedFix).toBeUndefined();
      expect(issues[0].clarificationQuestion).toBeDefined();
    });

    it('extracts parenthetical content into resolution context', async () => {
      const place = createPlace('PLACE_test', 'Tavern (The Chain & Cask)', null);
      const ctx = createTestContext([place]);

      const issues = await placeLabelValidator.validate(place, ctx);

      expect(issues[0].clarificationQuestion?.resolutionContext.extractedContent).toBe(
        'The Chain & Cask'
      );
      expect(issues[0].clarificationQuestion?.resolutionContext.issueType).toBe(
        'parenthetical_detail'
      );
    });

    it('suggests extracted content as potential name', async () => {
      const place = createPlace('PLACE_test', 'Some Location (The Real Name)', null);
      const ctx = createTestContext([place]);

      const issues = await placeLabelValidator.validate(place, ctx);

      expect(issues[0].clarificationQuestion?.currentGuess).toBe('The Real Name');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GENERIC REGION NAMES (LLM repair)
  // ───────────────────────────────────────────────────────────────────────────

  describe('generic region names', () => {
    it('flags "Harbor District" as too generic', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null, { environment: ENVIRONMENT_PRESETS.space() });
      const city = createPlace('PLACE_city', 'Farsreach', ROOT_PLACE_ID);
      const district = createPlace('PLACE_harbor', 'Harbor District', 'PLACE_city');

      const ctx = createTestContext([cosmos, city, district]);
      const issues = await placeLabelValidator.validate(district, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].validatorId).toBe('place-label');
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].field).toBe('label');
      // Should have suggestedFix, NOT clarificationQuestion
      expect(issues[0].clarificationQuestion).toBeUndefined();
      expect(issues[0].suggestedFix).toBeDefined();
      expect(issues[0].suggestedFix?.method).toBe('llm');
      expect(issues[0].suggestedFix?.confidence).toBe('medium');
    });

    it('flags "The Docks" as too generic', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null, { environment: ENVIRONMENT_PRESETS.space() });
      const city = createPlace('PLACE_city', 'Saltfog', ROOT_PLACE_ID);
      const docks = createPlace('PLACE_docks', 'The Docks', 'PLACE_city');

      const ctx = createTestContext([cosmos, city, docks]);
      const issues = await placeLabelValidator.validate(docks, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].suggestedFix).toBeDefined();
    });

    it('includes parent place label in message', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null, { environment: ENVIRONMENT_PRESETS.space() });
      const city = createPlace('PLACE_city', 'Farsreach', ROOT_PLACE_ID);
      const district = createPlace('PLACE_harbor', 'Harbor District', 'PLACE_city');

      const ctx = createTestContext([cosmos, city, district]);
      const issues = await placeLabelValidator.validate(district, ctx);

      expect(issues[0].message).toContain('Farsreach');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // VALID LABELS (should pass)
  // ───────────────────────────────────────────────────────────────────────────

  describe('valid labels', () => {
    it('passes for proper place names', async () => {
      const place = createPlace('PLACE_test', 'The Rope Tables', null);
      const ctx = createTestContext([place]);

      const issues = await placeLabelValidator.validate(place, ctx);

      expect(issues).toHaveLength(0);
    });

    it('passes for hyphenated names without spaces', async () => {
      const place = createPlace('PLACE_test', 'Markers 19-21', null);
      const ctx = createTestContext([place]);

      const issues = await placeLabelValidator.validate(place, ctx);

      expect(issues).toHaveLength(0);
    });

    it('passes for specific region names (has proper noun context)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null, { environment: ENVIRONMENT_PRESETS.space() });
      const city = createPlace('PLACE_city', 'Saltfog', ROOT_PLACE_ID);
      const harbor = createPlace('PLACE_harbor', 'Saltfog Harbor Ward', 'PLACE_city');

      const ctx = createTestContext([cosmos, city, harbor]);
      const issues = await placeLabelValidator.validate(harbor, ctx);

      expect(issues).toHaveLength(0);
    });

    it('passes for building names (no generic region type)', async () => {
      const cosmos = createPlace(ROOT_PLACE_ID, 'The Cosmos', null, { environment: ENVIRONMENT_PRESETS.space() });
      const city = createPlace('PLACE_city', 'Saltfog', ROOT_PLACE_ID);
      const tavern = createPlace('PLACE_tavern', 'The Rusty Anchor', 'PLACE_city', {
        environment: ENVIRONMENT_PRESETS.interior(),
      });

      const ctx = createTestContext([cosmos, city, tavern]);
      const issues = await placeLabelValidator.validate(tavern, ctx);

      expect(issues).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MUTUALLY EXCLUSIVE DETECTION
  // ───────────────────────────────────────────────────────────────────────────

  describe('mutually exclusive detection', () => {
    it('parenthetical pattern takes precedence over generic region', async () => {
      // This has both parenthetical AND could be flagged as generic
      const place = createPlace('PLACE_test', 'Harbor District (Docks)', null);
      const ctx = createTestContext([place]);

      const issues = await placeLabelValidator.validate(place, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].clarificationQuestion).toBeDefined(); // parenthetical uses clarification
      expect(issues[0].suggestedFix).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // NON-PLACE ENTITIES
  // ───────────────────────────────────────────────────────────────────────────

  describe('non-place entities', () => {
    it('skips character entities', async () => {
      const character = {
        id: 'CHAR_test',
        label: 'Harbor District', // Would be generic if it were a place
        description: 'Test',
        short_description: 'test',
        tags: [],
        entityType: 'character',
        info: {},
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_somewhere' },
        relationships: [],
      };

      const ctx = createTestContext([]);
      const issues = await placeLabelValidator.validate(character as unknown as Place, ctx);

      expect(issues).toHaveLength(0);
    });

    it('skips exit object entities', async () => {
      const exitObject = {
        id: 'OBJ_exit_test',
        label: 'Duras — Declared Lanes', // Would be hierarchical if it were a place
        description: 'Test',
        short_description: 'test',
        tags: [],
        entityType: 'object',
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { exitType: 'door', targetPlaceId: 'B' } },
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_somewhere' },
        relationships: [],
      };

      const ctx = createTestContext([]);
      const issues = await placeLabelValidator.validate(exitObject as unknown as Place, ctx);

      expect(issues).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE CASES
  // ───────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles place with no parent', async () => {
      const genericPlace = createPlace('PLACE_generic', 'Harbor District', null);
      const ctx = createTestContext([genericPlace]);

      const issues = await placeLabelValidator.validate(genericPlace, ctx);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('unknown region'); // No parent available
    });

    it('includes place ID in clarification affected entities', async () => {
      const place = createPlace('PLACE_test_place', 'Test (Details)', null);
      const ctx = createTestContext([place]);

      const issues = await placeLabelValidator.validate(place, ctx);

      expect(issues[0].clarificationQuestion?.affectedEntityIds).toContain('PLACE_test_place');
    });
  });
});
