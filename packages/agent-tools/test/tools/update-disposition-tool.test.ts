/**
 * Update Disposition Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateDispositionTool } from '../../src/tools/update-disposition-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('updateDispositionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates disposition and returns new value', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.disposition.updateDisposition).mockReturnValue(25);

    const result = await updateDispositionTool.execute(
      {
        characterId: 'CHAR_npc',
        targetId: 'CHAR_player',
        delta: 10,
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      characterId: 'CHAR_npc',
      targetId: 'CHAR_player',
      delta: 10,
      newDisposition: 25,
    });
  });

  it('handles negative delta', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.disposition.updateDisposition).mockReturnValue(-15);

    const result = await updateDispositionTool.execute(
      {
        characterId: 'CHAR_npc',
        targetId: 'CHAR_player',
        delta: -20,
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      characterId: 'CHAR_npc',
      targetId: 'CHAR_player',
      delta: -20,
      newDisposition: -15,
    });
  });

  it('calls updateDisposition with correct parameters', async () => {
    const context = createMockToolContext();

    await updateDispositionTool.execute(
      {
        characterId: 'CHAR_a',
        targetId: 'CHAR_b',
        delta: 15,
      },
      { context },
    );

    expect(context.services.disposition.updateDisposition).toHaveBeenCalledWith(
      context.universe,
      'CHAR_a',
      'CHAR_b',
      15,
    );
  });

  it('logs disposition update', async () => {
    const context = createMockToolContext();

    await updateDispositionTool.execute(
      {
        characterId: 'CHAR_a',
        targetId: 'CHAR_b',
        delta: 10,
      },
      { context },
    );

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'UpdateDispositionTool',
      expect.stringContaining('Disposition'),
    );
  });

  it('throws when update fails', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.disposition.updateDisposition).mockImplementation(() => {
      throw new Error('Character not found');
    });

    await expect(
      updateDispositionTool.execute(
        {
          characterId: 'CHAR_invalid',
          targetId: 'CHAR_player',
          delta: 10,
        },
        { context },
      ),
    ).rejects.toThrow('Character not found');
  });

  it('has correct tool metadata', () => {
    expect(updateDispositionTool.name).toBe('update_disposition');
    expect(updateDispositionTool.description).toContain('disposition');
  });

  it('validates input with Zod schema', () => {
    const schema = updateDispositionTool.inputSchema;

    // Valid input
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        targetId: 'CHAR_b',
        delta: 10,
      }),
    ).not.toThrow();

    // Negative delta
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        targetId: 'CHAR_b',
        delta: -50,
      }),
    ).not.toThrow();

    // Delta too low
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        targetId: 'CHAR_b',
        delta: -101,
      }),
    ).toThrow();

    // Delta too high
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        targetId: 'CHAR_b',
        delta: 101,
      }),
    ).toThrow();

    // Missing characterId
    expect(() =>
      schema.parse({
        targetId: 'CHAR_b',
        delta: 10,
      }),
    ).toThrow();
  });
});
