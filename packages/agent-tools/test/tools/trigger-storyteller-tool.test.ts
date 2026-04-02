/**
 * Trigger Storyteller Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerStorytellerTool } from '../../src/tools/trigger-storyteller-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('triggerStorytellerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers pending event and returns success', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.storyteller.checkPendingEvents).mockReturnValue({
      plotId: 'PLOT_main',
      eventType: 'encounter',
      minutesUntilTrigger: 0,
    });

    const result = await triggerStorytellerTool.execute({}, { context });

    expect(result).toEqual({
      success: true,
      plotId: 'PLOT_main',
      eventType: 'encounter',
      triggered: true,
    });
  });

  it('returns failure when no pending event', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.storyteller.checkPendingEvents).mockReturnValue(null);

    const result = await triggerStorytellerTool.execute({}, { context });

    expect(result).toEqual({
      success: false,
      message: 'No pending storyteller event',
    });
  });

  it('calls triggerEvent when pending event exists', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.storyteller.checkPendingEvents).mockReturnValue({
      plotId: 'PLOT_x',
      eventType: 'revelation',
      minutesUntilTrigger: 0,
    });

    await triggerStorytellerTool.execute({}, { context });

    expect(context.services.storyteller.triggerEvent).toHaveBeenCalledWith(context);
  });

  it('does not call triggerEvent when no pending event', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.storyteller.checkPendingEvents).mockReturnValue(null);

    await triggerStorytellerTool.execute({}, { context });

    expect(context.services.storyteller.triggerEvent).not.toHaveBeenCalled();
  });

  it('logs event triggering', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.storyteller.checkPendingEvents).mockReturnValue({
      plotId: 'PLOT_test',
      eventType: 'test',
      minutesUntilTrigger: 0,
    });

    await triggerStorytellerTool.execute({}, { context });

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'TriggerStorytellerTool',
      expect.stringContaining('Triggered storyteller event'),
    );
  });

  it('throws when triggering fails', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.storyteller.checkPendingEvents).mockReturnValue({
      plotId: 'PLOT_x',
      eventType: 'test',
      minutesUntilTrigger: 0,
    });
    vi.mocked(context.services.storyteller.triggerEvent).mockRejectedValue(
      new Error('Trigger failed'),
    );

    await expect(triggerStorytellerTool.execute({}, { context })).rejects.toThrow('Trigger failed');
  });

  it('has correct tool metadata', () => {
    expect(triggerStorytellerTool.name).toBe('trigger_storyteller_event');
    expect(triggerStorytellerTool.description).toContain('Trigger a pending storyteller event');
  });

  it('accepts empty input', () => {
    const schema = triggerStorytellerTool.inputSchema;
    expect(() => schema.parse({})).not.toThrow();
  });
});
