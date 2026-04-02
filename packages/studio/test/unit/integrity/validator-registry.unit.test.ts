/**
 * Validator Registry Tests
 *
 * Ensures the validator registry is properly structured and all validators
 * are correctly categorized.
 */

import { describe, it, expect } from 'vitest';
import {
  ENTITY_VALIDATORS,
  UNIVERSE_VALIDATORS,
  getEntityValidators,
  getEntityValidatorsByCategory,
  getIntegrityEntityValidators,
  getBatchScanUniverseValidators,
  getUniverseValidatorsByCategory,
  getValidatorSummary,
  getEntityValidatorsWithoutImages,
} from '@dmnpc/studio/integrity/validator-registry.js';

describe('ValidatorRegistry', () => {
  describe('ENTITY_VALIDATORS', () => {
    it('should have all required properties for each validator', () => {
      for (const entry of ENTITY_VALIDATORS) {
        expect(entry.id).toBeDefined();
        expect(entry.name).toBeDefined();
        expect(entry.category).toMatch(/^(integrity|migration)$/);
        expect(entry.description).toBeDefined();
        expect(entry.validator).toBeDefined();
        expect(entry.validator.id).toBe(entry.id);
        expect(typeof entry.validator.validate).toBe('function');
      }
    });

    it('should have unique IDs', () => {
      const ids = ENTITY_VALIDATORS.map((v) => v.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('should contain expected integrity validators', () => {
      const integrityIds = ENTITY_VALIDATORS.filter((v) => v.category === 'integrity').map(
        (v) => v.id
      );

      // Core integrity validators that should always exist
      expect(integrityIds).toContain('missing-fields');
      expect(integrityIds).toContain('orphaned-refs');
      expect(integrityIds).toContain('location-consistency');
    });

    it('should have no migration validators (all cleaned up)', () => {
      const migrationIds = ENTITY_VALIDATORS.filter((v) => v.category === 'migration').map(
        (v) => v.id
      );

      // All entity-level migration validators have been removed
      expect(migrationIds).toHaveLength(0);
    });
  });

  describe('UNIVERSE_VALIDATORS', () => {
    it('should have all required properties for each validator', () => {
      for (const entry of UNIVERSE_VALIDATORS) {
        expect(entry.id).toBeDefined();
        expect(entry.name).toBeDefined();
        expect(entry.category).toMatch(/^(integrity|migration)$/);
        expect(entry.description).toBeDefined();
        expect(typeof entry.validate).toBe('function');
        expect(typeof entry.repair).toBe('function');
      }
    });

    it('should have unique IDs', () => {
      const ids = UNIVERSE_VALIDATORS.map((v) => v.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('should contain expected integrity validators', () => {
      const integrityIds = UNIVERSE_VALIDATORS.filter((v) => v.category === 'integrity').map(
        (v) => v.id
      );

      expect(integrityIds).toContain('vessel-hierarchy');
      expect(integrityIds).toContain('travel-coordinates');
    });

    it('should have no migration validators (all cleaned up)', () => {
      const migrationIds = UNIVERSE_VALIDATORS.filter((v) => v.category === 'migration').map(
        (v) => v.id
      );

      expect(migrationIds).toHaveLength(0);
    });

    it('should have vessel-routes as integrity validator', () => {
      const integrityIds = UNIVERSE_VALIDATORS.filter((v) => v.category === 'integrity').map(
        (v) => v.id
      );
      expect(integrityIds).toContain('vessel-routes');
    });
  });

  describe('helper functions', () => {
    it('getEntityValidators returns all entity validators', () => {
      const validators = getEntityValidators();
      expect(validators.length).toBe(ENTITY_VALIDATORS.length);

      // Should be in the same order
      for (let i = 0; i < validators.length; i++) {
        expect(validators[i].id).toBe(ENTITY_VALIDATORS[i].id);
      }
    });

    it('getEntityValidatorsByCategory filters correctly', () => {
      const integrityValidators = getEntityValidatorsByCategory('integrity');
      const migrationValidators = getEntityValidatorsByCategory('migration');

      // Should add up to total
      expect(integrityValidators.length + migrationValidators.length).toBe(
        ENTITY_VALIDATORS.length
      );

      // Each should only have that category
      for (const v of integrityValidators) {
        const entry = ENTITY_VALIDATORS.find((e) => e.validator === v);
        expect(entry?.category).toBe('integrity');
      }

      for (const v of migrationValidators) {
        const entry = ENTITY_VALIDATORS.find((e) => e.validator === v);
        expect(entry?.category).toBe('migration');
      }
    });

    it('getIntegrityEntityValidators returns only integrity validators', () => {
      const validators = getIntegrityEntityValidators();
      expect(validators.length).toBeGreaterThan(0);

      for (const v of validators) {
        const entry = ENTITY_VALIDATORS.find((e) => e.validator === v);
        expect(entry?.category).toBe('integrity');
      }
    });

    it('getBatchScanUniverseValidators excludes disabled validators', () => {
      const batchValidators = getBatchScanUniverseValidators();
      const disabledCount = UNIVERSE_VALIDATORS.filter((v) => v.disabled).length;

      expect(batchValidators.length).toBe(UNIVERSE_VALIDATORS.length - disabledCount);

      for (const v of batchValidators) {
        expect(v.disabled).not.toBe(true);
      }
    });

    it('getUniverseValidatorsByCategory filters correctly', () => {
      const integrityValidators = getUniverseValidatorsByCategory('integrity');
      const migrationValidators = getUniverseValidatorsByCategory('migration');

      expect(integrityValidators.length + migrationValidators.length).toBe(
        UNIVERSE_VALIDATORS.length
      );
    });

    it('getValidatorSummary returns correct structure', () => {
      const summary = getValidatorSummary();

      expect(summary.entity).toBeDefined();
      expect(summary.universe).toBeDefined();
      expect(Array.isArray(summary.entity.integrity)).toBe(true);
      expect(Array.isArray(summary.entity.migration)).toBe(true);
      expect(Array.isArray(summary.universe.integrity)).toBe(true);
      expect(Array.isArray(summary.universe.migration)).toBe(true);

      // Counts should match
      expect(summary.entity.integrity.length + summary.entity.migration.length).toBe(
        ENTITY_VALIDATORS.length
      );
      expect(summary.universe.integrity.length + summary.universe.migration.length).toBe(
        UNIVERSE_VALIDATORS.length
      );
    });

    it('getEntityValidatorsWithoutImages excludes image validators', () => {
      const validators = getEntityValidatorsWithoutImages();
      const allValidators = getEntityValidators();

      // Should have fewer validators
      expect(validators.length).toBeLessThan(allValidators.length);

      // Should not include missing-image or place-environment
      const ids = validators.map((v) => v.id);
      expect(ids).not.toContain('missing-image');
      expect(ids).not.toContain('place-environment');
    });
  });

  describe('no ID conflicts between entity and universe validators', () => {
    it('should have no overlapping IDs', () => {
      const entityIds = new Set(ENTITY_VALIDATORS.map((v) => v.id));
      const universeIds = UNIVERSE_VALIDATORS.map((v) => v.id);

      for (const id of universeIds) {
        expect(entityIds.has(id)).toBe(false);
      }
    });
  });
});
