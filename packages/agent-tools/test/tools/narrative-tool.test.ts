/**
 * Describe Narrative Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { describeNarrativeTool } from '../../src/tools/narrative-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('describeNarrativeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls describeAction for action type', async () => {
    const context = createMockToolContext();

    const result = await describeNarrativeTool.execute({ type: 'action' }, { context });

    expect(context.services.narrative.describeAction).toHaveBeenCalledWith(context);
    expect(result).toEqual({ generated: true, type: 'action' });
  });

  it('calls describeDialogue for dialogue type', async () => {
    const context = createMockToolContext();

    const result = await describeNarrativeTool.execute({ type: 'dialogue' }, { context });

    expect(context.services.narrative.describeDialogue).toHaveBeenCalledWith(context);
    expect(result).toEqual({ generated: true, type: 'dialogue' });
  });

  it('calls describeTransition for transition type', async () => {
    const context = createMockToolContext();

    const result = await describeNarrativeTool.execute({ type: 'transition' }, { context });

    expect(context.services.narrative.describeTransition).toHaveBeenCalledWith(context);
    expect(result).toEqual({ generated: true, type: 'transition' });
  });

  it('calls describeSleep for sleep type', async () => {
    const context = createMockToolContext();

    const result = await describeNarrativeTool.execute({ type: 'sleep' }, { context });

    expect(context.services.narrative.describeSleep).toHaveBeenCalledWith(context);
    expect(result).toEqual({ generated: true, type: 'sleep' });
  });

  it('calls describeStorytellerEvent for storyteller_event type', async () => {
    const context = createMockToolContext();

    const result = await describeNarrativeTool.execute({ type: 'storyteller_event' }, { context });

    expect(context.services.narrative.describeStorytellerEvent).toHaveBeenCalledWith(context);
    expect(result).toEqual({ generated: true, type: 'storyteller_event' });
  });

  it('has correct tool metadata', () => {
    expect(describeNarrativeTool.name).toBe('describe_narrative');
    expect(describeNarrativeTool.description).toContain('narrative response');
  });

  it('validates narrative type with Zod schema', () => {
    const schema = describeNarrativeTool.inputSchema;

    // Valid types
    expect(() => schema.parse({ type: 'action' })).not.toThrow();
    expect(() => schema.parse({ type: 'dialogue' })).not.toThrow();
    expect(() => schema.parse({ type: 'transition' })).not.toThrow();
    expect(() => schema.parse({ type: 'sleep' })).not.toThrow();
    expect(() => schema.parse({ type: 'storyteller_event' })).not.toThrow();

    // Invalid type
    expect(() => schema.parse({ type: 'invalid' })).toThrow();

    // Missing type
    expect(() => schema.parse({})).toThrow();
  });
});
