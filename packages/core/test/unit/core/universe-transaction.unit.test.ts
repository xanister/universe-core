import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { withUniverse, withUniverseAsync } from '@dmnpc/core/universe/universe-transaction.js';

vi.mock('@dmnpc/core/universe/universe-lock.js', () => ({
  acquireLock: vi.fn(() => true),
  releaseLock: vi.fn(),
  isLocked: vi.fn(() => false),
  waitForLock: vi.fn(async () => true),
}));

// Create a shared mock context that persists across calls
const createMockCtx = (universeId: string) => ({
  universeId,
  universe: {
    id: universeId,
    name: 'Test Universe',
    date: '1476-12-27',
  },
  persistAll: vi.fn(async () => {}),
  upsertEntity: vi.fn(),
});

let sharedMockCtx: ReturnType<typeof createMockCtx>;

vi.mock('@dmnpc/core/universe/universe-context.js', () => ({
  UniverseContext: {
    loadAtEntryPoint: vi.fn(async (universeId: string) => {
      sharedMockCtx = createMockCtx(universeId);
      return sharedMockCtx;
    }),
  },
}));

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('shared/universe-transaction.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('withUniverse', () => {
    it('acquires lock, executes function, persists, and releases lock', async () => {
      const { acquireLock, releaseLock } = await import('@dmnpc/core/universe/universe-lock.js');
      const { UniverseContext } = await import('@dmnpc/core/universe/universe-context.js');

      const result = await withUniverse({ universeId: 'u1' }, async (ctx) => {
        expect(ctx.universeId).toBe('u1');
        return 'test-result';
      });

      expect(result).toBe('test-result');
      expect(acquireLock).toHaveBeenCalledWith('u1');
      expect(UniverseContext.loadAtEntryPoint).toHaveBeenCalledWith('u1');
      expect(releaseLock).toHaveBeenCalledWith('u1');
    });

    it('persists changes in write mode', async () => {
      await withUniverse({ universeId: 'u1' }, async (ctx) => {
        ctx.upsertEntity('character', { id: 'CHAR_1' } as any);
      });

      // sharedMockCtx is set by loadAtEntryPoint inside withUniverse
      expect(sharedMockCtx.persistAll).toHaveBeenCalled();
    });

    it('skips locking and persistence in read-only mode', async () => {
      const { acquireLock, releaseLock } = await import('@dmnpc/core/universe/universe-lock.js');

      await withUniverse({ universeId: 'u1', readOnly: true }, async (ctx) => {
        expect(ctx.universeId).toBe('u1');
      });

      expect(acquireLock).not.toHaveBeenCalled();
      expect(sharedMockCtx.persistAll).not.toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalled();
    });

    it('throws error if universe is locked', async () => {
      const { acquireLock } = await import('@dmnpc/core/universe/universe-lock.js');
      (acquireLock as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      await expect(
        withUniverse({ universeId: 'u1' }, async () => {
          return 'should not execute';
        })
      ).rejects.toThrow('Universe u1 lock was acquired by another process during wait');

      expect(acquireLock).toHaveBeenCalledWith('u1');
    });

    it('releases lock even if function throws', async () => {
      const { releaseLock } = await import('@dmnpc/core/universe/universe-lock.js');

      await expect(
        withUniverse({ universeId: 'u1' }, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(releaseLock).toHaveBeenCalledWith('u1');
    });

    it('releases lock even if persistAll throws', async () => {
      const { releaseLock } = await import('@dmnpc/core/universe/universe-lock.js');
      const { UniverseContext } = await import('@dmnpc/core/universe/universe-context.js');

      // Override loadAtEntryPoint to return a context with a failing persistAll
      (UniverseContext.loadAtEntryPoint as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        universeId: 'u1',
        universe: { id: 'u1', name: 'Test Universe', date: '1476-12-27' },
        persistAll: vi.fn().mockRejectedValueOnce(new Error('Persist failed')),
        upsertEntity: vi.fn(),
      });

      await expect(
        withUniverse({ universeId: 'u1' }, async () => {
          return 'result';
        })
      ).rejects.toThrow('Persist failed');

      expect(releaseLock).toHaveBeenCalledWith('u1');
    });
  });

  describe('withUniverseAsync', () => {
    it('executes function without awaiting', async () => {
      const { logger } = await import('@dmnpc/core/infra/logger.js');
      let executed = false;

      withUniverseAsync({ universeId: 'u1' }, async () => {
        executed = true;
      });

      // Function should be called asynchronously
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(executed).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs errors instead of throwing', async () => {
      const { logger } = await import('@dmnpc/core/infra/logger.js');

      withUniverseAsync({ universeId: 'u1' }, async () => {
        throw new Error('Test error');
      });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        'UniverseTransaction',
        'Async operation failed',
        expect.objectContaining({
          universeId: 'u1',
          error: 'Test error',
        })
      );
    });
  });
});
