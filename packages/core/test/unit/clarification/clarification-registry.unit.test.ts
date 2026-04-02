/**
 * Clarification Registry - Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';
import type { ClarificationProvider } from '@dmnpc/core/clarification/clarification-types.js';

describe('clarification-registry', () => {
  // Create test providers
  const createTestProvider = (
    id: string,
    categories: string[] = ['classification']
  ): ClarificationProvider => ({
    providerId: id,
    providerName: `Test Provider ${id}`,
    categories: categories as ClarificationProvider['categories'],
    resolveAnswer: async () => [],
  });

  beforeEach(() => {
    // Clear registry before each test
    clarificationRegistry.clear();
  });

  afterEach(() => {
    // Clean up after tests
    clarificationRegistry.clear();
  });

  describe('register', () => {
    it('should register a provider', () => {
      const provider = createTestProvider('test-1');

      clarificationRegistry.register(provider);

      expect(clarificationRegistry.hasProvider('test-1')).toBe(true);
    });

    it('should throw when registering duplicate provider', () => {
      const provider = createTestProvider('test-1');
      clarificationRegistry.register(provider);

      expect(() => {
        clarificationRegistry.register(provider);
      }).toThrow('Clarification provider already registered: test-1');
    });
  });

  describe('unregister', () => {
    it('should unregister a provider', () => {
      const provider = createTestProvider('test-1');
      clarificationRegistry.register(provider);

      const result = clarificationRegistry.unregister('test-1');

      expect(result).toBe(true);
      expect(clarificationRegistry.hasProvider('test-1')).toBe(false);
    });

    it('should return false when provider not found', () => {
      const result = clarificationRegistry.unregister('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getProvider', () => {
    it('should return provider by ID', () => {
      const provider = createTestProvider('test-1');
      clarificationRegistry.register(provider);

      const retrieved = clarificationRegistry.getProvider('test-1');

      expect(retrieved).toBe(provider);
    });

    it('should return undefined for unknown ID', () => {
      const retrieved = clarificationRegistry.getProvider('unknown');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAllProviders', () => {
    it('should return empty array when no providers', () => {
      const providers = clarificationRegistry.getAllProviders();

      expect(providers).toEqual([]);
    });

    it('should return all registered providers', () => {
      const provider1 = createTestProvider('test-1');
      const provider2 = createTestProvider('test-2');
      clarificationRegistry.register(provider1);
      clarificationRegistry.register(provider2);

      const providers = clarificationRegistry.getAllProviders();

      expect(providers).toHaveLength(2);
      expect(providers).toContain(provider1);
      expect(providers).toContain(provider2);
    });
  });

  describe('getProvidersForCategory', () => {
    it('should return providers for a category', () => {
      const provider1 = createTestProvider('test-1', ['classification', 'hierarchy']);
      const provider2 = createTestProvider('test-2', ['temporal']);
      const provider3 = createTestProvider('test-3', ['classification']);
      clarificationRegistry.register(provider1);
      clarificationRegistry.register(provider2);
      clarificationRegistry.register(provider3);

      const classificationProviders =
        clarificationRegistry.getProvidersForCategory('classification');

      expect(classificationProviders).toHaveLength(2);
      expect(classificationProviders).toContain(provider1);
      expect(classificationProviders).toContain(provider3);
    });

    it('should return empty array for category with no providers', () => {
      const provider = createTestProvider('test-1', ['classification']);
      clarificationRegistry.register(provider);

      const providers = clarificationRegistry.getProvidersForCategory('temporal');

      expect(providers).toEqual([]);
    });
  });

  describe('hasProvider', () => {
    it('should return true for registered provider', () => {
      const provider = createTestProvider('test-1');
      clarificationRegistry.register(provider);

      expect(clarificationRegistry.hasProvider('test-1')).toBe(true);
    });

    it('should return false for unregistered provider', () => {
      expect(clarificationRegistry.hasProvider('unknown')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return 0 when empty', () => {
      expect(clarificationRegistry.size).toBe(0);
    });

    it('should return correct count', () => {
      clarificationRegistry.register(createTestProvider('test-1'));
      clarificationRegistry.register(createTestProvider('test-2'));
      clarificationRegistry.register(createTestProvider('test-3'));

      expect(clarificationRegistry.size).toBe(3);
    });
  });

  describe('clear', () => {
    it('should remove all providers', () => {
      clarificationRegistry.register(createTestProvider('test-1'));
      clarificationRegistry.register(createTestProvider('test-2'));

      clarificationRegistry.clear();

      expect(clarificationRegistry.size).toBe(0);
      expect(clarificationRegistry.hasProvider('test-1')).toBe(false);
    });
  });
});
