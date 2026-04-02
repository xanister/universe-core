import { describe, it, expect, beforeEach } from 'vitest';
import { acquireLock, releaseLock, isLocked } from '@dmnpc/core/universe/universe-lock.js';

describe('shared/universe-lock.ts', () => {
  beforeEach(() => {
    // Release any lingering locks between tests
    releaseLock('u1');
    releaseLock('u2');
  });

  describe('acquireLock', () => {
    it('returns true when acquiring lock on unlocked universe', () => {
      const result = acquireLock('u1');
      expect(result).toBe(true);
    });

    it('returns false when acquiring lock on already locked universe', () => {
      acquireLock('u1');
      const result = acquireLock('u1');
      expect(result).toBe(false);
    });

    it('allows locking different universes independently', () => {
      expect(acquireLock('u1')).toBe(true);
      expect(acquireLock('u2')).toBe(true);
    });
  });

  describe('releaseLock', () => {
    it('releases a held lock', () => {
      acquireLock('u1');
      releaseLock('u1');
      // Should be able to acquire again
      expect(acquireLock('u1')).toBe(true);
    });

    it('does not throw when releasing unlocked universe', () => {
      expect(() => releaseLock('u1')).not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('returns false for unlocked universe', () => {
      expect(isLocked('u1')).toBe(false);
    });

    it('returns true for locked universe', () => {
      acquireLock('u1');
      expect(isLocked('u1')).toBe(true);
    });

    it('returns false after lock is released', () => {
      acquireLock('u1');
      releaseLock('u1');
      expect(isLocked('u1')).toBe(false);
    });
  });
});
