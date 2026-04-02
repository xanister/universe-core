/**
 * Query Flags Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryFlagsTool } from '../../src/tools/query-flags-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('queryFlagsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns flag status for active plots', async () => {
    const context = createMockToolContext();
    context.character.info = {
      storytellerState: {
        activePlots: [
          {
            id: 'PLOT_main',
            plan: { label: 'Main Quest' },
            storyFlags: ['flag_1', 'flag_2'],
            progressLevel: 50,
          },
        ],
      },
    };
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue([
      'flag_1',
      'flag_2',
      'flag_3',
      'flag_4',
    ]);

    const result = await queryFlagsTool.execute({ plotId: '' }, { context });

    expect(result).toMatchObject({
      success: true,
      activePlots: 1,
    });
    const plots = (result as { plots: { setFlags: string[]; availableFlags: string[] }[] }).plots;
    expect(plots[0].setFlags).toEqual(['flag_1', 'flag_2']);
    expect(plots[0].availableFlags).toEqual(['flag_3', 'flag_4']);
  });

  it('filters by plotId', async () => {
    const context = createMockToolContext();
    context.character.info = {
      storytellerState: {
        activePlots: [
          { id: 'PLOT_a', plan: { label: 'Plot A' }, storyFlags: [], progressLevel: 0 },
          { id: 'PLOT_b', plan: { label: 'Plot B' }, storyFlags: [], progressLevel: 0 },
        ],
      },
    };
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue([]);

    const result = await queryFlagsTool.execute({ plotId: 'PLOT_a' }, { context });

    expect((result as { plots: unknown[] }).plots).toHaveLength(1);
    expect((result as { plots: { plotId: string }[] }).plots[0].plotId).toBe('PLOT_a');
  });

  it('returns empty when no storyteller state', async () => {
    const context = createMockToolContext();
    context.character.info = {};

    const result = await queryFlagsTool.execute({ plotId: '' }, { context });

    expect(result).toEqual({
      success: true,
      activePlots: 0,
      plots: [],
      message: 'No active plots for this character',
    });
  });

  it('returns empty when no active plots', async () => {
    const context = createMockToolContext();
    context.character.info = {
      storytellerState: {
        activePlots: [],
      },
    };

    const result = await queryFlagsTool.execute({ plotId: '' }, { context });

    expect(result).toEqual({
      success: true,
      activePlots: 0,
      plots: [],
    });
  });

  it('calls collectValidFlags for each plot', async () => {
    const context = createMockToolContext();
    const plot1Plan = { label: 'Plot 1' };
    const plot2Plan = { label: 'Plot 2' };
    context.character.info = {
      storytellerState: {
        activePlots: [
          { id: 'PLOT_1', plan: plot1Plan, storyFlags: [], progressLevel: 0 },
          { id: 'PLOT_2', plan: plot2Plan, storyFlags: [], progressLevel: 0 },
        ],
      },
    };
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue([]);

    await queryFlagsTool.execute({ plotId: '' }, { context });

    expect(context.services.flag.collectValidFlags).toHaveBeenCalledWith(plot1Plan);
    expect(context.services.flag.collectValidFlags).toHaveBeenCalledWith(plot2Plan);
  });

  it('logs query', async () => {
    const context = createMockToolContext();
    context.character.info = {
      storytellerState: {
        activePlots: [{ id: 'PLOT_x', plan: {}, storyFlags: ['flag'], progressLevel: 10 }],
      },
    };
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue(['flag']);

    await queryFlagsTool.execute({ plotId: '' }, { context });

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'QueryFlagsTool',
      expect.stringContaining('Queried flags'),
    );
  });

  it('throws when query fails', async () => {
    const context = createMockToolContext();
    context.character.info = {
      storytellerState: {
        activePlots: [{ id: 'PLOT_x', plan: {}, storyFlags: [], progressLevel: 0 }],
      },
    };
    vi.mocked(context.services.flag.collectValidFlags).mockImplementation(() => {
      throw new Error('Failed to collect flags');
    });

    await expect(queryFlagsTool.execute({ plotId: '' }, { context })).rejects.toThrow(
      'Failed to collect flags',
    );
  });

  it('has correct tool metadata', () => {
    expect(queryFlagsTool.name).toBe('query_flag_status');
    expect(queryFlagsTool.description).toContain('story flags');
  });

  it('validates input with Zod schema', () => {
    const schema = queryFlagsTool.inputSchema;

    // plotId is required
    expect(() => schema.parse({})).toThrow();

    // With plotId (all plots)
    expect(() => schema.parse({ plotId: '' })).not.toThrow();

    // With specific plotId
    expect(() => schema.parse({ plotId: 'PLOT_x' })).not.toThrow();
  });
});
