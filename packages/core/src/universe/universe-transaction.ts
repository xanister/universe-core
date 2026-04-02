/**
 * Universe Transaction
 *
 * Provides a simple unified interface for universe locking and persistence.
 * Handles lock acquisition, context loading, execution, persistence, and cleanup
 * for both synchronous and asynchronous operations.
 */

import { logger } from '../infra/logger.js';
import { acquireLock, releaseLock, waitForLock } from './universe-lock.js';
import { UniverseContext } from './universe-context.js';

/**
 * Options for universe transaction.
 */
export interface TransactionOptions {
  /** Universe ID to operate on */
  universeId: string;
  /** If true, skip locking and persistence (read-only mode) */
  readOnly?: boolean;
  /** Timeout in milliseconds for waiting for lock (default: 30000 = 30 seconds). Only used in write mode. */
  lockTimeoutMs?: number;
}

/**
 * Execute a function within a universe transaction.
 * Handles lock waiting, acquisition, context loading, persistence, and cleanup automatically.
 *
 * For write operations (non-readOnly), automatically waits for the lock to become available
 * before acquiring it. This makes it safe for async background operations.
 *
 * @param options - Transaction options
 * @param fn - Function to execute with the universe context
 * @returns Result of the function
 * @throws Error if lock timeout is reached (in write mode)
 *
 * @example
 * ```typescript
 * // Write operation - automatically waits for lock if needed
 * const result = await withUniverse({ universeId: 'u1' }, async (ctx) => {
 *   // Use ctx to mutate universe state
 *   ctx.upsertEntity('character', character);
 *   return someValue;
 * });
 *
 * // Read-only operation - no locking
 * const data = await withUniverse({ universeId: 'u1', readOnly: true }, async (ctx) => {
 *   return ctx.getCharacter('CHAR_player');
 * });
 * ```
 */
export async function withUniverse<T>(
  options: TransactionOptions,
  fn: (ctx: UniverseContext) => Promise<T>,
): Promise<T> {
  const { universeId, readOnly = false, lockTimeoutMs = 30000 } = options;

  // Wait for and acquire lock (if write mode)
  if (!readOnly) {
    // Wait for lock to become available (for async operations like plot generation)
    const lockAvailable = await waitForLock(universeId, lockTimeoutMs);
    if (!lockAvailable) {
      throw new Error(
        `Universe ${universeId} lock timeout after ${lockTimeoutMs}ms - another operation may be in progress`,
      );
    }

    // Now acquire the lock (should succeed since we just waited)
    if (!acquireLock(universeId)) {
      // This should be rare - race condition between waitForLock and acquireLock
      throw new Error(`Universe ${universeId} lock was acquired by another process during wait`);
    }
  }

  try {
    // Load context
    const ctx = await UniverseContext.loadAtEntryPoint(universeId);

    // Execute function
    const result = await fn(ctx);

    // Persist (if write mode)
    if (!readOnly) {
      await ctx.persistAll();
    }

    return result;
  } finally {
    // Always release lock
    if (!readOnly) {
      releaseLock(universeId);
    }
  }
}

/**
 * Execute a function within a universe transaction asynchronously (fire-and-forget).
 * Does not await the result and logs errors instead of throwing.
 *
 * Use this for operations that should not block the HTTP response.
 *
 * @param options - Transaction options
 * @param fn - Function to execute with the universe context
 *
 * @example
 * ```typescript
 * // Send response immediately
 * res.status(202).json({ accepted: true });
 *
 * // Process in background
 * withUniverseAsync({ universeId: 'u1' }, async (ctx) => {
 *   await processPlayerMessage(ctx, message);
 * });
 * ```
 */
export function withUniverseAsync(
  options: TransactionOptions,
  fn: (ctx: UniverseContext) => Promise<void>,
): void {
  void withUniverse(options, fn).catch((error) => {
    logger.error('UniverseTransaction', 'Async operation failed', {
      universeId: options.universeId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
