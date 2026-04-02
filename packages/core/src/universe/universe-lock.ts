/**
 * Universe Lock Service
 *
 * Provides in-memory locking for universe mutations to ensure only one
 * request per universe is processed at a time. Optionally broadcasts
 * lock/unlock events to connected clients via a registered callback.
 */

import { logger } from '../infra/logger.js';

// In-memory lock map: universeId -> boolean
const locks = new Map<string, boolean>();

// Optional broadcast callback (registered by server composition layer)
type BroadcastFn = (universeId: string, event: { type: string; universeId: string }) => void;
let broadcastFn: BroadcastFn | null = null;

/**
 * Register a broadcast function for lock/unlock events.
 * Called by the server composition layer to wire WebSocket broadcasting.
 */
export function registerLockBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

/**
 * Attempt to acquire a lock for a universe.
 * Returns true if lock was acquired, false if already locked.
 * Broadcasts universeLocked event on success (if broadcast is registered).
 */
export function acquireLock(universeId: string): boolean {
  if (locks.get(universeId)) {
    logger.info('UniverseLock', `Lock denied: universeId=${universeId} (already locked)`);
    return false;
  }
  locks.set(universeId, true);
  logger.info('UniverseLock', `Lock acquired: universeId=${universeId}`);

  // Notify connected clients (if broadcast is registered)
  broadcastFn?.(universeId, { type: 'universeLocked', universeId });

  return true;
}

/**
 * Release a lock for a universe.
 * Broadcasts universeUnlocked event (if broadcast is registered).
 * Idempotent: safe to call multiple times (only releases if lock exists).
 */
export function releaseLock(universeId: string): void {
  // Check if lock exists before releasing (idempotent)
  if (!locks.get(universeId)) {
    // Lock doesn't exist, nothing to release
    return;
  }

  locks.delete(universeId);
  logger.info('UniverseLock', `Lock released: universeId=${universeId}`);

  // Notify connected clients (if broadcast is registered)
  broadcastFn?.(universeId, { type: 'universeUnlocked', universeId });
}

/**
 * Check if a universe is currently locked.
 */
export function isLocked(universeId: string): boolean {
  return locks.get(universeId) === true;
}

/**
 * Wait for the universe lock to become available.
 * Polls at regular intervals until the lock is free or timeout is reached.
 *
 * @param universeId - The universe ID to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 30000 = 30 seconds)
 * @param pollIntervalMs - How often to check for lock availability (default: 100ms)
 * @returns Promise that resolves to true if lock became available, false on timeout
 */
export async function waitForLock(
  universeId: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 100,
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check if lock is available
    if (!isLocked(universeId)) {
      logger.info(
        'UniverseLock',
        `Lock available after wait: universeId=${universeId} waitMs=${Date.now() - startTime}`,
      );
      return true;
    }

    // Wait before checking again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  logger.warn('UniverseLock', `Lock wait timeout: universeId=${universeId} timeoutMs=${timeoutMs}`);
  return false;
}
