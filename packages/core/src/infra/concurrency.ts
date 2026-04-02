/**
 * Concurrency utilities for limiting parallel async operations.
 *
 * Provides a semaphore-based task runner that caps the number of
 * concurrent promises, useful for respecting API rate limits when
 * parallelizing LLM or image generation calls.
 */

import { logger } from './logger.js';

/**
 * Run async tasks with a concurrency limit.
 *
 * Executes up to `limit` tasks simultaneously. When one completes, the next
 * queued task starts. Returns `PromiseSettledResult<T>[]` so callers can
 * inspect individual successes/failures without the batch aborting on a
 * single error.
 *
 * @param tasks  Factory functions that produce promises (not pre-started promises).
 * @param limit  Maximum number of tasks running at the same time. Must be >= 1.
 * @param context  Optional label for log messages (e.g. 'Character Generation').
 * @returns Settled results in the same order as the input tasks.
 *
 * @example
 * ```typescript
 * const results = await runWithConcurrency(
 *   templateIds.map((id) => () => generateCharacter(id)),
 *   3,
 *   'Template Characters',
 * );
 * const successes = results.filter(r => r.status === 'fulfilled').map(r => r.value);
 * ```
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  context?: string,
): Promise<PromiseSettledResult<T>[]> {
  if (limit < 1) {
    throw new Error('Concurrency limit must be >= 1');
  }

  if (tasks.length === 0) {
    return [];
  }

  const effectiveLimit = Math.min(limit, tasks.length);
  const tag = context ?? 'Concurrency';

  logger.info(tag, `Starting ${tasks.length} tasks with concurrency limit ${effectiveLimit}`);

  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  // Launch `effectiveLimit` worker loops that pull from the shared index
  const workers = Array.from({ length: effectiveLimit }, () => runNext());
  await Promise.all(workers);

  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.length - fulfilled;
  logger.info(tag, `Completed ${tasks.length} tasks: ${fulfilled} succeeded, ${rejected} failed`);

  return results;
}
