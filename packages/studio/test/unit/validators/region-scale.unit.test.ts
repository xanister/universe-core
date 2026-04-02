/**
 * Unit tests for the region-scale validator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { regionScaleValidator } from '@dmnpc/studio/integrity/validators/region-scale.js';
import type { Place } from '@dmnpc/types/entity';
import type { ValidationContext } from '@dmnpc/studio/integrity/integrity-types.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

const ROOT_PLACE_ID = 'PLACE_the_cosmos';

// Mock validation context (not used by this validator but required by interface)
const mockCtx: ValidationContext = {
  universe: {} as any,
  characters: new Map(),
  places: new Map(),
  objects: new Map(),
  events: new Map(),
  validRaceIds: new Set(),
  rootPlaceId: ROOT_PLACE_ID,
};

describe('regionScaleValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('skipping validation for cosmos', () => {
    it('should skip validation for PLACE_the_cosmos regardless of environment', async () => {
      // This is the actual PLACE_the_cosmos structure from the file
      const cosmosPlace: Place = {
        id: 'PLACE_the_cosmos',
        label: 'The Cosmos',
        description: 'The endless expanse of space...',
        short_description: 'The void between worlds',
        tags: ['TAG_space'],
        entityType: 'place',
        info: {
          scale: 'lightyears',
          size: { width: 100, height: 100 },
          environment: ENVIRONMENT_PRESETS.exterior(), // Note: NOT 'space'!
          purpose: 'region',
        },
        position: { x: 0, y: 0, width: 400, height: 400, parent: null },
        relationships: [],
      };

      const issues = await regionScaleValidator.validate(cosmosPlace, mockCtx);

      // Should return NO issues because it's PLACE_the_cosmos
      expect(issues).toHaveLength(0);
    });

    it('should skip validation for places with environment: space', async () => {
      const spaceStation: Place = {
        id: 'PLACE_space_station',
        label: 'Space Station',
        description: 'A space station',
        short_description: 'A space station',
        tags: [],
        entityType: 'place',
        info: {
          scale: 'au',
          size: { width: 10, height: 10 },
          environment: ENVIRONMENT_PRESETS.space(), // This IS 'space'
          purpose: 'region',
        },
        position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_the_cosmos' },
        relationships: [],
      };

      const issues = await regionScaleValidator.validate(spaceStation, mockCtx);

      // Should return NO issues because environment is 'space'
      expect(issues).toHaveLength(0);
    });
  });

  describe('flagging non-space places with cosmic scale', () => {
    it('should flag a terrestrial region with lightyears scale', async () => {
      const badPlace: Place = {
        id: 'PLACE_bad_region',
        label: 'Bad Region',
        description: 'A normal terrestrial region',
        short_description: 'A region',
        tags: [],
        entityType: 'place',
        info: {
          scale: 'lightyears', // Wrong! This is a terrestrial place
          size: { width: 100, height: 100 },
          environment: ENVIRONMENT_PRESETS.exterior(),
          purpose: 'region',
        },
        position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_some_parent' },
        relationships: [],
      };

      const issues = await regionScaleValidator.validate(badPlace, mockCtx);

      // Should flag this as an issue
      expect(issues).toHaveLength(1);
      expect(issues[0].validatorId).toBe('region-scale');
      expect(issues[0].entityId).toBe('PLACE_bad_region');
    });

    it('should NOT flag a terrestrial region with miles scale', async () => {
      const goodPlace: Place = {
        id: 'PLACE_good_region',
        label: 'Good Region',
        description: 'A normal terrestrial region',
        short_description: 'A region',
        tags: [],
        entityType: 'place',
        info: {
          scale: 'miles', // Correct for terrestrial
          size: { width: 100, height: 100 },
          environment: ENVIRONMENT_PRESETS.exterior(),
          purpose: 'region',
        },
        position: { x: 0, y: 0, width: 400, height: 400, parent: 'PLACE_some_parent' },
        relationships: [],
      };

      const issues = await regionScaleValidator.validate(goodPlace, mockCtx);

      // Should NOT flag this
      expect(issues).toHaveLength(0);
    });
  });

});
