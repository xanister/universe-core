/**
 * Set Story Flags Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setStoryFlagsTool } from '../../src/tools/set-flags-tool.js';
import {
  createMockToolContext,
  createMockGameDate,
  createMockCharacter,
} from '../helpers/mock-context.js';
import type { StorytellerInstanceState } from '@dmnpc/types/npc';

describe('setStoryFlagsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when no flags provided', async () => {
    const context = createMockToolContext();

    const result = await setStoryFlagsTool.execute({ flags: [] }, { context });

    expect(result).toEqual({
      success: true,
      appliedFlags: [],
      message: 'No flags provided',
    });
    expect(context.services.flag.saveStorytellerState).not.toHaveBeenCalled();
  });

  it('returns error when no active plots', async () => {
    const character = createMockCharacter({
      info: { storytellerState: { activePlots: [] } },
    });
    const context = createMockToolContext({ character });

    const result = await setStoryFlagsTool.execute({ flags: ['test_flag'] }, { context });

    expect(result.success).toBe(false);
    expect(result.message).toContain('No active plots');
  });

  it('returns error when no storyteller state', async () => {
    const character = createMockCharacter({
      info: {},
    });
    const context = createMockToolContext({ character });

    const result = await setStoryFlagsTool.execute({ flags: ['test_flag'] }, { context });

    expect(result.success).toBe(false);
    expect(result.message).toContain('No active plots');
  });

  it('returns error when no calendar configured', async () => {
    const state: StorytellerInstanceState = {
      activePlots: [{ id: 'PLOT_test', storyFlags: [], plan: {} }],
    } as StorytellerInstanceState;
    const character = createMockCharacter({
      info: { storytellerState: state },
    });
    const context = createMockToolContext({ character });
    context.universe.universe.calendar = undefined;

    const result = await setStoryFlagsTool.execute({ flags: ['test_flag'] }, { context });

    expect(result.success).toBe(false);
    expect(result.message).toContain('No calendar');
  });

  it('applies valid flags to active plot', async () => {
    const state: StorytellerInstanceState = {
      activePlots: [{ id: 'PLOT_test', storyFlags: [], plan: {} }],
    } as StorytellerInstanceState;
    const character = createMockCharacter({
      info: { storytellerState: state },
    });
    const context = createMockToolContext({ character });

    // Mock flag service
    vi.mocked(context.services.flag.getPlotStatus).mockReturnValue('active');
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue(['met_guard', 'found_key']);
    vi.mocked(context.services.time.parseDate).mockReturnValue(createMockGameDate());

    const result = await setStoryFlagsTool.execute({ flags: ['met_guard'] }, { context });

    expect(result.success).toBe(true);
    expect(result.appliedFlags).toContain('met_guard');
    expect(context.services.flag.saveStorytellerState).toHaveBeenCalled();
  });

  it('rejects flags not valid for plot', async () => {
    const state: StorytellerInstanceState = {
      activePlots: [{ id: 'PLOT_test', storyFlags: [], plan: {} }],
    } as StorytellerInstanceState;
    const character = createMockCharacter({
      info: { storytellerState: state },
    });
    const context = createMockToolContext({ character });

    vi.mocked(context.services.flag.getPlotStatus).mockReturnValue('active');
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue(['valid_flag']);
    vi.mocked(context.services.time.parseDate).mockReturnValue(createMockGameDate());

    const result = await setStoryFlagsTool.execute({ flags: ['invalid_flag'] }, { context });

    expect(result.appliedFlags).not.toContain('invalid_flag');
    expect(result.rejectedFlags).toBeDefined();
    expect(result.rejectedFlags![0]).toEqual({
      flag: 'invalid_flag',
      reason: 'not valid for plot PLOT_test',
    });
  });

  it('rejects already-set flags', async () => {
    const state: StorytellerInstanceState = {
      activePlots: [{ id: 'PLOT_test', storyFlags: ['already_set'], plan: {} }],
    } as StorytellerInstanceState;
    const character = createMockCharacter({
      info: { storytellerState: state },
    });
    const context = createMockToolContext({ character });

    vi.mocked(context.services.flag.getPlotStatus).mockReturnValue('active');
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue(['already_set', 'new_flag']);
    vi.mocked(context.services.time.parseDate).mockReturnValue(createMockGameDate());

    const result = await setStoryFlagsTool.execute({ flags: ['already_set'] }, { context });

    expect(result.appliedFlags).not.toContain('already_set');
    expect(result.rejectedFlags![0]).toEqual({
      flag: 'already_set',
      reason: 'already set',
    });
  });

  it('skips inactive plots', async () => {
    const state: StorytellerInstanceState = {
      activePlots: [{ id: 'PLOT_inactive', storyFlags: [], plan: {} }],
    } as StorytellerInstanceState;
    const character = createMockCharacter({
      info: { storytellerState: state },
    });
    const context = createMockToolContext({ character });

    vi.mocked(context.services.flag.getPlotStatus).mockReturnValue('completed');
    vi.mocked(context.services.time.parseDate).mockReturnValue(createMockGameDate());

    const result = await setStoryFlagsTool.execute({ flags: ['test_flag'] }, { context });

    expect(result.appliedFlags).toEqual([]);
    expect(context.services.flag.saveStorytellerState).not.toHaveBeenCalled();
  });

  it('updates newlySetFlags in context', async () => {
    const state: StorytellerInstanceState = {
      activePlots: [{ id: 'PLOT_test', storyFlags: [], plan: {} }],
    } as StorytellerInstanceState;
    const character = createMockCharacter({
      info: { storytellerState: state },
    });
    const context = createMockToolContext({ character });
    context.newlySetFlags = ['existing_flag'];

    vi.mocked(context.services.flag.getPlotStatus).mockReturnValue('active');
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue(['new_flag']);
    vi.mocked(context.services.time.parseDate).mockReturnValue(createMockGameDate());

    await setStoryFlagsTool.execute({ flags: ['new_flag'] }, { context });

    expect(context.newlySetFlags).toContain('existing_flag');
    expect(context.newlySetFlags).toContain('new_flag');
  });

  it('logs applied flags', async () => {
    const state: StorytellerInstanceState = {
      activePlots: [{ id: 'PLOT_test', storyFlags: [], plan: {} }],
    } as StorytellerInstanceState;
    const character = createMockCharacter({
      info: { storytellerState: state },
    });
    const context = createMockToolContext({ character });

    vi.mocked(context.services.flag.getPlotStatus).mockReturnValue('active');
    vi.mocked(context.services.flag.collectValidFlags).mockReturnValue(['applied_flag']);
    vi.mocked(context.services.time.parseDate).mockReturnValue(createMockGameDate());

    await setStoryFlagsTool.execute({ flags: ['applied_flag'] }, { context });

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'SetFlagsTool',
      expect.stringContaining('applied_flag'),
    );
  });

  it('has correct tool metadata', () => {
    expect(setStoryFlagsTool.name).toBe('set_story_flags');
    expect(setStoryFlagsTool.description).toContain('Set story flags');
  });

  it('validates input with Zod schema', () => {
    const schema = setStoryFlagsTool.inputSchema;

    // Valid input
    expect(() => schema.parse({ flags: ['flag1', 'flag2'] })).not.toThrow();
    expect(() => schema.parse({ flags: [] })).not.toThrow();

    // Invalid input - not an array
    expect(() => schema.parse({ flags: 'not-array' })).toThrow();

    // Missing flags
    expect(() => schema.parse({})).toThrow();
  });
});
