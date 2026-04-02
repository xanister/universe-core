/**
 * Batch Scanner Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  triggerBatchValidation,
  resetBatchState,
  getMessagesSinceLastRun,
} from '@dmnpc/studio/integrity/batch-scanner.js';

// Mock validateEntity
vi.mock('@dmnpc/studio/integrity/validate-entity.js', () => ({
  validateEntity: vi.fn().mockResolvedValue({
    entityId: 'CHAR_test',
    entityType: 'character',
    issuesFound: 0,
    issuesFixed: 0,
    issues: [],
    issuesFixedList: [],
    issuesUnfixed: {
      mediumConfidence: [],
      fixFailed: [],
      skipped: [],
    },
    summary: {
      totalFound: 0,
      totalFixed: 0,
      mediumConfidence: 0,
      fixFailed: 0,
      skipped: 0,
    },
    issuesByValidator: {},
  }),
}));

// Mock UniverseContext.load
vi.mock('@dmnpc/core/universe/universe-context.js', () => ({
  UniverseContext: {
    load: vi.fn().mockResolvedValue({
      universeId: 'test',
      characters: [{ id: 'CHAR_1' }, { id: 'CHAR_2' }, { id: 'CHAR_3' }],
      places: [{ id: 'PLACE_1' }, { id: 'PLACE_2' }],
      objects: [{ id: 'OBJ_exit_1' }],
    }),
  },
}));

describe('BatchScanner', () => {
  beforeEach(() => {
    resetBatchState();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not trigger batch before message threshold', () => {
    // Default threshold is 10
    for (let i = 0; i < 9; i++) {
      triggerBatchValidation('test');
    }

    expect(getMessagesSinceLastRun()).toBe(9);
  });

  it('should reset counter after reaching threshold', () => {
    for (let i = 0; i < 10; i++) {
      triggerBatchValidation('test');
    }

    // Counter should reset after batch is triggered
    expect(getMessagesSinceLastRun()).toBe(0);
  });

  it('should respect custom message interval', () => {
    // Custom interval of 3
    for (let i = 0; i < 3; i++) {
      triggerBatchValidation('test', { messageInterval: 3 });
    }

    // Counter should reset after hitting custom threshold
    expect(getMessagesSinceLastRun()).toBe(0);
  });

  it('should reset state properly', () => {
    triggerBatchValidation('test');
    triggerBatchValidation('test');
    expect(getMessagesSinceLastRun()).toBe(2);

    resetBatchState();
    expect(getMessagesSinceLastRun()).toBe(0);
  });
});
