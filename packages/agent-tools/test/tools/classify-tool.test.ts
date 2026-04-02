/**
 * Classify Input Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyInputTool } from '../../src/tools/classify-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';
import type { ClassificationResult } from '@dmnpc/types/game';

describe('classifyInputTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls classification service with correct parameters', async () => {
    const context = createMockToolContext({
      userMessage: {
        role: 'user',
        action: 'input',
        opts: { text: 'I walk to the tavern' },
        date: null,
        omitFromTranscript: false,
        hidden: false,
      },
    });

    await classifyInputTool.execute({}, { context });

    expect(context.services.classification.classifyPlayerInput).toHaveBeenCalledWith(
      context.universe,
      context.character.id,
      'I walk to the tavern',
    );
  });

  it('stores classification result in context', async () => {
    const mockResult: ClassificationResult = {
      actions: [{ type: 'Transition', intent: 'go to tavern', targetRef: 'tavern' }],
    };

    const context = createMockToolContext();
    vi.mocked(context.services.classification.classifyPlayerInput).mockResolvedValue(mockResult);

    await classifyInputTool.execute({}, { context });

    expect(context.classificationResult).toEqual(mockResult);
  });

  it('returns mapped actions from classification', async () => {
    const mockResult: ClassificationResult = {
      actions: [
        {
          type: 'Dialogue',
          intent: 'ask about quest',
          targetRef: 'bartender',
          targetId: 'CHAR_bartender',
        },
        { type: 'Action', intent: 'examine the map' },
      ],
    };

    const context = createMockToolContext();
    vi.mocked(context.services.classification.classifyPlayerInput).mockResolvedValue(mockResult);

    const result = await classifyInputTool.execute({}, { context });

    expect(result).toEqual({
      actions: [
        {
          type: 'Dialogue',
          intent: 'ask about quest',
          targetRef: 'bartender',
          targetId: 'CHAR_bartender',
        },
        { type: 'Action', intent: 'examine the map', targetRef: undefined, targetId: undefined },
      ],
      rejection: undefined,
    });
  });

  it('returns rejection when classification rejects input', async () => {
    const mockResult: ClassificationResult = {
      actions: [],
      rejection: 'Cannot perform that action in combat',
    };

    const context = createMockToolContext();
    vi.mocked(context.services.classification.classifyPlayerInput).mockResolvedValue(mockResult);

    const result = await classifyInputTool.execute({}, { context });

    expect(result.rejection).toBe('Cannot perform that action in combat');
    expect(result.actions).toEqual([]);
  });

  it('has correct tool metadata', () => {
    expect(classifyInputTool.name).toBe('classify_input');
    expect(classifyInputTool.description).toContain('Parse the player');
  });
});
