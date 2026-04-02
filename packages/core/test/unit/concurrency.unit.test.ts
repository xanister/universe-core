import { describe, it, expect, vi } from 'vitest';
import { runWithConcurrency } from '@dmnpc/core/infra/concurrency.js';

describe('runWithConcurrency', () => {
  it('runs all tasks and returns fulfilled results in order', async () => {
    const tasks = [() => Promise.resolve('a'), () => Promise.resolve('b'), () => Promise.resolve('c')];

    const results = await runWithConcurrency(tasks, 3);

    expect(results).toEqual([
      { status: 'fulfilled', value: 'a' },
      { status: 'fulfilled', value: 'b' },
      { status: 'fulfilled', value: 'c' },
    ]);
  });

  it('returns an empty array for no tasks', async () => {
    const results = await runWithConcurrency([], 3);
    expect(results).toEqual([]);
  });

  it('throws if limit is less than 1', async () => {
    await expect(runWithConcurrency([() => Promise.resolve(1)], 0)).rejects.toThrow(
      'Concurrency limit must be >= 1',
    );
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    const makeTask = (id: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      // Simulate async work with a short delay
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      return id;
    };

    const tasks = Array.from({ length: 8 }, (_, i) => makeTask(i));
    const results = await runWithConcurrency(tasks, 3, 'ConcurrencyTest');

    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // Verify order is preserved
    const values = results.map((r) => (r as PromiseFulfilledResult<number>).value);
    expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles rejected tasks without aborting the batch', async () => {
    const tasks = [
      () => Promise.resolve('ok-1'),
      () => Promise.reject(new Error('fail-2')),
      () => Promise.resolve('ok-3'),
      () => Promise.reject(new Error('fail-4')),
      () => Promise.resolve('ok-5'),
    ];

    const results = await runWithConcurrency(tasks, 2);

    expect(results).toHaveLength(5);

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok-1' });
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('fail-2');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'ok-3' });
    expect(results[3].status).toBe('rejected');
    expect(results[4]).toEqual({ status: 'fulfilled', value: 'ok-5' });
  });

  it('works with a single task', async () => {
    const results = await runWithConcurrency([() => Promise.resolve(42)], 5);

    expect(results).toEqual([{ status: 'fulfilled', value: 42 }]);
  });

  it('clamps effective concurrency to task count when limit exceeds tasks', async () => {
    let running = 0;
    let maxRunning = 0;

    const makeTask = () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return true;
    };

    // 2 tasks with limit of 10 — should only spawn 2 workers
    const tasks = [makeTask(), makeTask()];
    await runWithConcurrency(tasks, 10);

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('preserves result order even when tasks complete out of order', async () => {
    // Task 0 is slow, task 1 is fast, task 2 is medium
    const tasks = [
      () => new Promise<string>((resolve) => setTimeout(() => resolve('slow'), 60)),
      () => new Promise<string>((resolve) => setTimeout(() => resolve('fast'), 10)),
      () => new Promise<string>((resolve) => setTimeout(() => resolve('medium'), 30)),
    ];

    const results = await runWithConcurrency(tasks, 3);

    // Results should be in input order, not completion order
    expect(results).toEqual([
      { status: 'fulfilled', value: 'slow' },
      { status: 'fulfilled', value: 'fast' },
      { status: 'fulfilled', value: 'medium' },
    ]);
  });
});
