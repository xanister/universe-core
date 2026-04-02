/**
 * Advance Time Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { advanceTimeTool } from '../../src/tools/advance-time-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('advanceTimeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls advanceGameTime with correct params and returns result', async () => {
    const context = createMockToolContext();

    const result = await advanceTimeTool.execute(
      { minutes: 30, reason: 'searching the room' },
      { context },
    );

    expect(context.services.time.advanceGameTime).toHaveBeenCalledWith(context, 30, null);
    expect(result).toEqual({
      success: true,
      previousDate: '1/1/1',
      newDate: context.universe.universe.date,
      minutesAdvanced: 30,
      reason: 'searching the room',
    });
  });

  it('logs time advancement', async () => {
    const context = createMockToolContext();

    await advanceTimeTool.execute({ minutes: 45, reason: 'travel' }, { context });

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'AdvanceTimeTool',
      expect.stringContaining('+45min'),
    );
  });

  it('throws when no calendar is configured', async () => {
    const context = createMockToolContext();
    context.universe.universe.calendar = undefined;

    await expect(
      advanceTimeTool.execute({ minutes: 30, reason: 'waiting' }, { context }),
    ).rejects.toThrow('No calendar configured for this universe');
  });

  it('has correct tool metadata', () => {
    expect(advanceTimeTool.name).toBe('advance_time');
    expect(advanceTimeTool.description).toContain('Advance the game clock');
  });

  it('validates input with Zod schema', () => {
    const schema = advanceTimeTool.inputSchema;

    // Valid input
    expect(() => schema.parse({ minutes: 30, reason: 'test' })).not.toThrow();

    // Minutes too low
    expect(() => schema.parse({ minutes: 0, reason: 'test' })).toThrow();

    // Minutes too high
    expect(() => schema.parse({ minutes: 1441, reason: 'test' })).toThrow();

    // Missing reason
    expect(() => schema.parse({ minutes: 30 })).toThrow();
  });
});
