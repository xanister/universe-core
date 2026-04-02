/**
 * Apply Repairs Tests
 *
 * Tests the repair application logic, including optimistic locking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BaseEntity } from '@dmnpc/types/entity';
import type {
  ValidationIssue,
  ValidationContext,
} from '@dmnpc/studio/integrity/integrity-types.js';

// Mock dependencies - use vi.hoisted() to avoid initialization order issues
const { mockUniverseContext, mockMtimeRef } = vi.hoisted(() => ({
  mockUniverseContext: {
    upsertEntity: vi.fn(),
    persistAll: vi.fn(),
    universeId: 'test',
  },
  mockMtimeRef: { value: 1000 as number | null },
}));

vi.mock('@dmnpc/core/universe/universe-context.js', () => ({
  UniverseContext: {
    loadAtEntryPoint: vi.fn().mockResolvedValue(mockUniverseContext),
  },
}));

// Track mtime mock state
let mockMtime: number | null = 1000;

vi.mock('@dmnpc/core/universe/universe-store.js', () => ({
  getEntityFileMtime: vi.fn(() => Promise.resolve(mockMtime)),
}));

vi.mock('@dmnpc/studio/integrity/repairs/deterministic-repairs.js', () => ({
  applyDeterministicRepair: vi.fn(() => true),
}));

vi.mock('@dmnpc/studio/integrity/repairs/llm-repairs.js', () => ({
  applyLlmRepair: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@dmnpc/studio/integrity/repairs/duplicate-merge.js', () => ({
  applyDuplicateMerge: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@dmnpc/studio/integrity/repairs/image-repairs.js', () => ({
  applyImageRepair: vi.fn(() => Promise.resolve(true)),
  applyMapImageRepair: vi.fn(() => Promise.resolve(true)),
}));

// Import after mocks
import { applyRepairs } from '@dmnpc/studio/integrity/apply-repairs.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { getEntityFileMtime } from '@dmnpc/core/universe/universe-store.js';

describe('applyRepairs', () => {
  const mockEntity: BaseEntity = {
    id: 'CHAR_test',
    label: 'Test Character',
    description: 'A test character',
    short_description: 'test',
    entityType: 'character',
    tags: [],
    position: { x: 0, y: 0, parent: 'PLACE_root' },
    relationships: [],
  };

  const mockValidationContext: ValidationContext = {
    universe: {
      id: 'test',
      name: 'Test',
      version: '1.0',
      description: '',
      custom: {},
      rules: '',
      tone: '',
      style: '',
      date: '',
      races: [],
      rootPlaceId: 'PLACE_root',
    },
    characters: new Map(),
    places: new Map(),
    objects: new Map(),
    events: new Map(),
    validRaceIds: new Set(),
    rootPlaceId: 'PLACE_root',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMtime = 1000;
  });

  it('should apply repairs when no issues are provided', async () => {
    const issues: ValidationIssue[] = [];
    const result = await applyRepairs(
      mockEntity,
      issues,
      mockValidationContext,
      mockUniverseContext,
      'high',
      1000
    );
    expect(result.fixedCount).toBe(0);
    expect(result.fixedIssues).toHaveLength(0);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('should skip low-confidence issues', async () => {
    const issues: ValidationIssue[] = [
      {
        entityId: 'CHAR_test',
        entityType: 'character',
        validatorId: 'test',
        severity: 'warning',
        field: 'test',
        message: 'Test issue',
        suggestedFix: {
          field: 'test',
          value: 'fixed',
          confidence: 'medium', // Not high confidence
          method: 'deterministic',
        },
      },
    ];

    const result = await applyRepairs(
      mockEntity,
      issues,
      mockValidationContext,
      mockUniverseContext,
      'high',
      1000
    );
    expect(result.fixedCount).toBe(0);
    expect(result.fixedIssues).toHaveLength(0);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('should apply high-confidence deterministic repairs when mtime unchanged', async () => {
    const issues: ValidationIssue[] = [
      {
        entityId: 'CHAR_test',
        entityType: 'character',
        validatorId: 'test',
        severity: 'error',
        field: 'position.parent',
        message: 'Invalid parent',
        suggestedFix: {
          field: 'position.parent',
          value: 'PLACE_root',
          confidence: 'high',
          method: 'deterministic',
        },
      },
    ];

    const result = await applyRepairs(
      mockEntity,
      issues,
      mockValidationContext,
      mockUniverseContext,
      'high',
      1000
    );
    expect(result.fixedCount).toBe(1);
    expect(result.fixedIssues).toHaveLength(1);
    expect(result.failedIssues).toHaveLength(0);

    // Should have updated the entity in context (persistence is handled by route middleware)
    expect(mockUniverseContext.upsertEntity).toHaveBeenCalled();
  });

  it('should skip repairs when mtime has changed (optimistic locking)', async () => {
    // Simulate entity being modified during validation
    mockMtime = 2000; // Different from original 1000

    const issues: ValidationIssue[] = [
      {
        entityId: 'CHAR_test',
        entityType: 'character',
        validatorId: 'test',
        severity: 'error',
        field: 'position.parent',
        message: 'Invalid parent',
        suggestedFix: {
          field: 'position.parent',
          value: 'PLACE_root',
          confidence: 'high',
          method: 'deterministic',
        },
      },
    ];

    const result = await applyRepairs(
      mockEntity,
      issues,
      mockValidationContext,
      mockUniverseContext,
      'high',
      1000
    );

    // Should return 0 because mtime changed
    expect(result.fixedCount).toBe(0);
    expect(result.fixedIssues).toHaveLength(0);
    expect(result.failedIssues).toHaveLength(0);

    // Should have checked mtime
    expect(getEntityFileMtime).toHaveBeenCalledWith(
      mockUniverseContext.universeId,
      'character',
      'CHAR_test'
    );

    // Should NOT have saved the entity (persist should not happen)
    expect(mockUniverseContext.persistAll).not.toHaveBeenCalled();
  });

  it('should proceed with repairs when originalMtime is null', async () => {
    const issues: ValidationIssue[] = [
      {
        entityId: 'CHAR_test',
        entityType: 'character',
        validatorId: 'test',
        severity: 'error',
        field: 'position.parent',
        message: 'Invalid parent',
        suggestedFix: {
          field: 'position.parent',
          value: 'PLACE_root',
          confidence: 'high',
          method: 'deterministic',
        },
      },
    ];

    // Pass null for originalMtime (file didn't exist when validation started)
    const result = await applyRepairs(
      mockEntity,
      issues,
      mockValidationContext,
      mockUniverseContext,
      'high',
      null
    );
    expect(result.fixedCount).toBe(1);
    expect(result.fixedIssues).toHaveLength(1);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('should proceed with repairs when originalMtime is undefined', async () => {
    const issues: ValidationIssue[] = [
      {
        entityId: 'CHAR_test',
        entityType: 'character',
        validatorId: 'test',
        severity: 'error',
        field: 'position.parent',
        message: 'Invalid parent',
        suggestedFix: {
          field: 'position.parent',
          value: 'PLACE_root',
          confidence: 'high',
          method: 'deterministic',
        },
      },
    ];

    // Don't pass originalMtime (defaults)
    const result = await applyRepairs(
      mockEntity,
      issues,
      mockValidationContext,
      mockUniverseContext
    );
    expect(result.fixedCount).toBe(1);
    expect(result.fixedIssues).toHaveLength(1);
    expect(result.failedIssues).toHaveLength(0);
  });
});
