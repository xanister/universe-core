/**
 * Clarification Types - Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { generateClarificationId, createClarificationQuestion, QUESTION_CATEGORIES } from '@dmnpc/core/clarification/clarification-types.js';

describe('clarification-types', () => {
  describe('QUESTION_CATEGORIES', () => {
    it('should contain expected categories', () => {
      expect(QUESTION_CATEGORIES).toContain('classification');
      expect(QUESTION_CATEGORIES).toContain('hierarchy');
      expect(QUESTION_CATEGORIES).toContain('temporal');
      expect(QUESTION_CATEGORIES).toContain('relationship');
      expect(QUESTION_CATEGORIES).toContain('identity');
      expect(QUESTION_CATEGORIES).toContain('attribute');
    });
  });

  describe('generateClarificationId', () => {
    it('should generate deterministic ID with correct format', () => {
      const id = generateClarificationId('test-provider', 'ENTITY_123');

      // No timestamp - deterministic format: CLARIFY_{provider}_{hash}
      expect(id).toBe('CLARIFY_test-provider_entity_123');
    });

    it('should sanitize special characters in discriminator', () => {
      const id = generateClarificationId('my-validator', 'Place With Spaces!@#');

      expect(id).toBe('CLARIFY_my-validator_place_with_spaces_');
    });

    it('should truncate long discriminators to 80 chars', () => {
      const longDiscriminator = 'a'.repeat(100);
      const id = generateClarificationId('provider', longDiscriminator);

      // Hash portion should be max 80 chars (increased from 40 to preserve uniqueness)
      expect(id).toBe('CLARIFY_provider_' + 'a'.repeat(80));
    });

    it('should generate same ID for same inputs (deterministic)', () => {
      const id1 = generateClarificationId('provider', 'entity');
      const id2 = generateClarificationId('provider', 'entity');

      // Same inputs should produce same ID - this enables deduplication
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different inputs', () => {
      const id1 = generateClarificationId('provider', 'entity_a');
      const id2 = generateClarificationId('provider', 'entity_b');

      expect(id1).not.toBe(id2);
    });
  });

  describe('createClarificationQuestion', () => {
    it('should create question with required fields', () => {
      const question = createClarificationQuestion({
        providerId: 'test-provider',
        category: 'classification',
        question: 'Is this a city or a district?',
        context: 'Determines place hierarchy',
        affectedEntityIds: ['PLACE_123'],
        resolutionContext: { placeId: 'PLACE_123' },
      });

      expect(question.providerId).toBe('test-provider');
      expect(question.category).toBe('classification');
      expect(question.question).toBe('Is this a city or a district?');
      expect(question.context).toBe('Determines place hierarchy');
      expect(question.affectedEntityIds).toEqual(['PLACE_123']);
      expect(question.resolutionContext).toEqual({ placeId: 'PLACE_123' });
    });

    it('should set default values', () => {
      const question = createClarificationQuestion({
        providerId: 'test-provider',
        category: 'classification',
        question: 'Test question?',
        context: 'Test context',
        affectedEntityIds: ['ENTITY_1'],
        resolutionContext: {},
      });

      expect(question.id).toMatch(/^CLARIFY_/);
      expect(question.freeformAllowed).toBe(false);
      expect(question.confidence).toBe(0.5);
      expect(question.status).toBe('pending');
      expect(question.createdAt).toBeTruthy();
    });

    it('should allow overriding defaults', () => {
      const question = createClarificationQuestion({
        providerId: 'test-provider',
        category: 'temporal',
        question: 'Is this character historical?',
        context: 'Determines if character is an NPC',
        affectedEntityIds: ['CHAR_123'],
        resolutionContext: { characterId: 'CHAR_123' },
        id: 'CLARIFY_custom_id',
        freeformAllowed: true,
        confidence: 0.3,
        currentGuess: 'contemporary',
        status: 'answered',
      });

      expect(question.id).toBe('CLARIFY_custom_id');
      expect(question.freeformAllowed).toBe(true);
      expect(question.confidence).toBe(0.3);
      expect(question.currentGuess).toBe('contemporary');
      expect(question.status).toBe('answered');
    });

    it('should include options when provided', () => {
      const question = createClarificationQuestion({
        providerId: 'test-provider',
        category: 'classification',
        question: 'What type of place is this?',
        context: 'Determines environment',
        affectedEntityIds: ['PLACE_123'],
        resolutionContext: {},
        options: [
          { id: 'interior', label: 'Interior' },
          { id: 'exterior', label: 'Exterior' },
          { id: 'exterior_large', label: 'City/Settlement/Vessel' },
        ],
      });

      expect(question.options).toHaveLength(3);
      expect(question.options?.[0].id).toBe('interior');
      expect(question.options?.[1].label).toBe('Exterior');
    });

    it('should include source document when provided', () => {
      const question = createClarificationQuestion({
        providerId: 'document-processor',
        category: 'temporal',
        question: 'Is King Aldric alive?',
        context: 'From source documents',
        affectedEntityIds: [],
        resolutionContext: {},
        sourceDocument: 'world-history.pdf',
      });

      expect(question.sourceDocument).toBe('world-history.pdf');
    });

    it('should include validation issue ID when provided', () => {
      const question = createClarificationQuestion({
        providerId: 'place-kind',
        category: 'classification',
        question: 'What is the place kind?',
        context: 'Validation detected missing environment',
        affectedEntityIds: ['PLACE_123'],
        resolutionContext: {},
        validationIssueId: 'issue_abc123',
      });

      expect(question.validationIssueId).toBe('issue_abc123');
    });
  });
});
