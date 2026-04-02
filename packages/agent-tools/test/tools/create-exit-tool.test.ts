/**
 * Create Exit Tool Tests
 *
 * Tests the exit creation tool that creates exits from a place to its parent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExitTool } from '../../src/tools/create-exit-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('createExitTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an exit and returns success', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.exit.createExit).mockResolvedValue({
      id: 'OBJ_exit_new',
      label: 'Secret Door',
      exitType: 'door',
    });

    const result = await createExitTool.execute(
      {
        label: 'Secret Door',
        exitType: 'door',
        placeId: 'PLACE_source',
        direction: '',
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      exitId: 'OBJ_exit_new',
      label: 'Secret Door',
      exitType: 'door',
    });
  });

  it('calls createExit service with correct parameters', async () => {
    const context = createMockToolContext();

    await createExitTool.execute(
      {
        label: 'Stairs',
        exitType: 'stairs',
        placeId: 'PLACE_a',
        direction: 'up',
      },
      { context },
    );

    expect(context.services.exit.createExit).toHaveBeenCalledWith({
      ctx: context.universe,
      placeId: 'PLACE_a',
      label: 'Stairs',
      exitType: 'stairs',
      direction: 'up',
    });
  });

  it('passes empty direction as undefined to service', async () => {
    const context = createMockToolContext();

    await createExitTool.execute(
      {
        label: 'Door',
        exitType: 'door',
        placeId: 'PLACE_a',
        direction: '',
      },
      { context },
    );

    expect(context.services.exit.createExit).toHaveBeenCalledWith({
      ctx: context.universe,
      placeId: 'PLACE_a',
      label: 'Door',
      exitType: 'door',
      direction: undefined,
    });
  });

  it('logs exit creation', async () => {
    const context = createMockToolContext();

    await createExitTool.execute(
      {
        label: 'Gate',
        exitType: 'gate',
        placeId: 'PLACE_a',
        direction: '',
      },
      { context },
    );

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'CreateExitTool',
      expect.stringContaining('Created exit'),
    );
  });

  it('throws when creation fails', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.exit.createExit).mockRejectedValue(new Error('Exit already exists'));

    await expect(
      createExitTool.execute(
        {
          label: 'Door',
          exitType: 'door',
          placeId: 'PLACE_a',
          direction: '',
        },
        { context },
      ),
    ).rejects.toThrow('Exit already exists');
  });

  it('has correct tool metadata', () => {
    expect(createExitTool.name).toBe('create_exit');
    expect(createExitTool.description).toContain('Create an exit');
  });

  it('validates input with Zod schema', () => {
    const schema = createExitTool.inputSchema;

    // Valid input (all required)
    expect(() =>
      schema.parse({
        label: 'Door',
        exitType: 'door',
        placeId: 'PLACE_a',
        direction: '',
      }),
    ).not.toThrow();

    // With direction
    expect(() =>
      schema.parse({
        label: 'Path',
        exitType: 'path',
        placeId: 'PLACE_a',
        direction: 'north',
      }),
    ).not.toThrow();

    // Missing exitType
    expect(() =>
      schema.parse({
        label: 'Door',
        placeId: 'PLACE_a',
        direction: '',
      }),
    ).toThrow();

    // Missing direction
    expect(() =>
      schema.parse({
        label: 'Door',
        exitType: 'door',
        placeId: 'PLACE_a',
      }),
    ).toThrow();
  });
});
