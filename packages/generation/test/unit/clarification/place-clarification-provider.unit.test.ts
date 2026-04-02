/**
 * Place Clarification Provider - Unit Tests
 *
 * Tests the clarification provider for place-related questions,
 * including the createPlaceNamingQuestion factory and attribute resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPlaceNamingQuestion,
  placeGeneratorClarificationProvider,
} from '@dmnpc/generation/place/place-clarification-provider.js';
import { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';
import type { ClarificationResolutionContext } from '@dmnpc/core/clarification/clarification-types.js';
import type { Place } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

describe('place-clarification-provider', () => {
  function createPlace(overrides: Partial<Place> = {}): Place {
    return {
      id: 'PLACE_test',
      label: 'Test Place',
      description: 'A test place description.',
      short_description: 'test place',
      entityType: 'place',
      tags: [],
      position: { x: null, y: null, parent: null },
      relationships: [],
      info: {
        environment: ENVIRONMENT_PRESETS.interior(),
        scale: 'feet',
        size: { width: 100, height: 100 },
      },
      ...overrides,
    };
  }

  describe('createPlaceNamingQuestion', () => {
    it('creates question for parenthetical detail', () => {
      const place = createPlace({
        id: 'PLACE_tavern',
        label: 'Quayside Tavern (The Chain & Cask)',
      });

      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      expect(question.category).toBe('attribute');
      expect(question.resolutionContext.issueType).toBe('parenthetical_detail');
      expect(question.resolutionContext.extractedContent).toBe('The Chain & Cask');
    });

    it('extracts parenthetical content correctly', () => {
      const place = createPlace({
        label: 'Warehouse Row Three (Markers 19–21)',
      });

      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      expect(question.resolutionContext.extractedContent).toBe('Markers 19–21');
    });

    it('suggests parenthetical content for parenthetical patterns', () => {
      const place = createPlace({
        label: 'Some Location (The Real Name)',
      });

      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      expect(question.currentGuess).toBe('The Real Name');
    });

    it('includes place ID in affected entities', () => {
      const place = createPlace({
        id: 'PLACE_specific_id',
        label: 'Test (Details)',
      });

      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      expect(question.affectedEntityIds).toContain('PLACE_specific_id');
    });

    it('context explains parenthetical issue', () => {
      const place = createPlace({
        label: 'Place (Details)',
      });

      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      expect(question.context).toContain('Details');
      expect(question.context).toContain('description');
    });
  });

  describe('provider registration', () => {
    it('includes attribute in categories', () => {
      expect(placeGeneratorClarificationProvider.categories).toContain('attribute');
    });

    it('includes all expected categories', () => {
      const categories = placeGeneratorClarificationProvider.categories;
      expect(categories).toContain('classification');
      expect(categories).toContain('hierarchy');
      expect(categories).toContain('identity');
      expect(categories).toContain('attribute');
    });
  });

  describe('resolveAnswer for attribute category', () => {
    // Mock universe context
    function createMockUniverseCtx(places: Place[] = []) {
      const placeMap = new Map(places.map((p) => [p.id, p]));
      return {
        findPlace: vi.fn((id: string) => placeMap.get(id)),
        upsertEntity: vi.fn(),
      };
    }

    it('updates place label from freeform answer', async () => {
      const place = createPlace({
        id: 'PLACE_test',
        label: 'Old Name (Details)',
        description: 'Original description.',
      });

      const mockCtx = createMockUniverseCtx([place]);
      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      const resolutionCtx: ClarificationResolutionContext = {
        universeCtx: mockCtx as unknown as ClarificationResolutionContext['universeCtx'],
        question,
        answer: {
          questionId: question.id,
          freeformText: 'New Name',
          answeredAt: new Date().toISOString(),
        },
      };

      const modifiedIds = await placeGeneratorClarificationProvider.resolveAnswer(resolutionCtx);

      expect(modifiedIds).toContain('PLACE_test');
      expect(mockCtx.upsertEntity).toHaveBeenCalledWith(
        'place',
        expect.objectContaining({
          label: 'New Name',
        })
      );
    });

    it('moves extracted content to description', async () => {
      const place = createPlace({
        id: 'PLACE_test',
        label: 'Warehouse (Section A)',
        description: 'A storage area.',
      });

      const mockCtx = createMockUniverseCtx([place]);
      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      const resolutionCtx: ClarificationResolutionContext = {
        universeCtx: mockCtx as unknown as ClarificationResolutionContext['universeCtx'],
        question,
        answer: {
          questionId: question.id,
          freeformText: 'Warehouse',
          answeredAt: new Date().toISOString(),
        },
      };

      await placeGeneratorClarificationProvider.resolveAnswer(resolutionCtx);

      // Should prepend extracted content to description
      expect(mockCtx.upsertEntity).toHaveBeenCalledWith(
        'place',
        expect.objectContaining({
          description: 'Section A. A storage area.',
        })
      );
    });

    it('does not duplicate content already in description', async () => {
      const place = createPlace({
        id: 'PLACE_test',
        label: 'Warehouse (Section A)',
        description: 'Section A is a storage area.',
      });

      const mockCtx = createMockUniverseCtx([place]);
      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', place.label);

      const resolutionCtx: ClarificationResolutionContext = {
        universeCtx: mockCtx as unknown as ClarificationResolutionContext['universeCtx'],
        question,
        answer: {
          questionId: question.id,
          freeformText: 'Warehouse',
          answeredAt: new Date().toISOString(),
        },
      };

      await placeGeneratorClarificationProvider.resolveAnswer(resolutionCtx);

      // Should not add duplicate - description already contains "Section A"
      expect(mockCtx.upsertEntity).toHaveBeenCalledWith(
        'place',
        expect.objectContaining({
          description: 'Section A is a storage area.',
        })
      );
    });

    it('does nothing when place is not found', async () => {
      const mockCtx = createMockUniverseCtx([]); // Empty - no places
      const question = createPlaceNamingQuestion(
        createPlace({ id: 'PLACE_missing' }),
        'parenthetical_detail',
        'Test (Details)'
      );

      const resolutionCtx: ClarificationResolutionContext = {
        universeCtx: mockCtx as unknown as ClarificationResolutionContext['universeCtx'],
        question,
        answer: {
          questionId: question.id,
          freeformText: 'New Name',
          answeredAt: new Date().toISOString(),
        },
      };

      const modifiedIds = await placeGeneratorClarificationProvider.resolveAnswer(resolutionCtx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockCtx.upsertEntity).not.toHaveBeenCalled();
    });

    it('does nothing when freeform text is empty', async () => {
      const place = createPlace({ id: 'PLACE_test' });
      const mockCtx = createMockUniverseCtx([place]);
      const question = createPlaceNamingQuestion(place, 'parenthetical_detail', 'Test (Details)');

      const resolutionCtx: ClarificationResolutionContext = {
        universeCtx: mockCtx as unknown as ClarificationResolutionContext['universeCtx'],
        question,
        answer: {
          questionId: question.id,
          freeformText: '', // Empty
          answeredAt: new Date().toISOString(),
        },
      };

      const modifiedIds = await placeGeneratorClarificationProvider.resolveAnswer(resolutionCtx);

      expect(modifiedIds).toHaveLength(0);
      expect(mockCtx.upsertEntity).not.toHaveBeenCalled();
    });
  });
});
