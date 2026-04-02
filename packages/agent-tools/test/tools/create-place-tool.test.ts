/**
 * Create Place Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlaceTool } from '../../src/tools/create-place-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('createPlaceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new place and returns success', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.place.findSimilarPlace).mockReturnValue(null);
    vi.mocked(context.services.place.generatePlace).mockResolvedValue({
      id: 'PLACE_new_room',
      label: 'New Room',
      description: 'A newly created room',
      parentId: 'PLACE_parent',
    });

    const result = await createPlaceTool.execute(
      {
        name: 'New Room',
        description: 'A secret chamber',
        parentId: 'PLACE_parent',
        environment: 'interior',
        purpose: 'bedroom',
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      placeId: 'PLACE_new_room',
      label: 'New Room',
      action: 'created',
    });
  });

  it('returns existing place if similar found', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.place.findSimilarPlace).mockReturnValue({
      place: { id: 'PLACE_existing', label: 'Existing Room' },
    });

    const result = await createPlaceTool.execute(
      {
        name: 'Existing Room',
        description: 'A room that already exists',
        parentId: 'PLACE_parent',
        environment: 'interior',
        purpose: 'bedroom',
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      placeId: 'PLACE_existing',
      label: 'Existing Room',
      action: 'found_existing',
    });
    expect(context.services.place.generatePlace).not.toHaveBeenCalled();
  });

  it('calls generatePlace with correct parameters', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.place.findSimilarPlace).mockReturnValue(null);

    await createPlaceTool.execute(
      {
        name: 'Cellar',
        description: 'A dark cellar',
        parentId: 'PLACE_tavern',
        environment: 'interior',
        purpose: 'bedroom',
      },
      { context },
    );

    expect(context.services.place.generatePlace).toHaveBeenCalledWith({
      ctx: context.universe,
      name: 'Cellar',
      description: 'A dark cellar',
      parentId: 'PLACE_tavern',
      environment: 'interior',
      purpose: 'bedroom',
    });
  });

  it('logs place creation', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.place.findSimilarPlace).mockReturnValue(null);

    await createPlaceTool.execute(
      {
        name: 'Test Place',
        description: 'Testing',
        parentId: 'PLACE_parent',
        environment: 'exterior',
        purpose: 'wilderness',
      },
      { context },
    );

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'CreatePlaceTool',
      expect.stringContaining('Created place'),
    );
  });

  it('throws when generation fails', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.place.findSimilarPlace).mockReturnValue(null);
    vi.mocked(context.services.place.generatePlace).mockRejectedValue(
      new Error('Generation failed'),
    );

    await expect(
      createPlaceTool.execute(
        {
          name: 'Bad Place',
          description: 'Should fail',
          parentId: 'PLACE_parent',
          environment: 'interior',
          purpose: 'bedroom',
        },
        { context },
      ),
    ).rejects.toThrow('Generation failed');
  });

  it('has correct tool metadata', () => {
    expect(createPlaceTool.name).toBe('create_place');
    expect(createPlaceTool.description).toContain('Generate a new location');
  });

  it('validates input with Zod schema', () => {
    const schema = createPlaceTool.inputSchema;

    // Valid input (all required)
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'interior',
        purpose: 'bedroom',
      }),
    ).not.toThrow();

    // All environment values are valid
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'space',
        purpose: 'unspecified',
      }),
    ).not.toThrow();

    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'underwater',
        purpose: 'unspecified',
      }),
    ).not.toThrow();

    // Missing name
    expect(() =>
      schema.parse({
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'interior',
        purpose: 'bedroom',
      }),
    ).toThrow();

    // Missing parentId
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        environment: 'interior',
        purpose: 'bedroom',
      }),
    ).toThrow();

    // Missing environment
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        purpose: 'bedroom',
      }),
    ).toThrow();

    // Missing purpose
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'interior',
      }),
    ).toThrow();
  });

  it('passes environment directly and converts unspecified purpose to undefined', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.place.findSimilarPlace).mockReturnValue(null);

    await createPlaceTool.execute(
      {
        name: 'The Corridor',
        description: 'A narrow passage',
        parentId: 'PLACE_tavern',
        environment: 'interior',
        purpose: 'unspecified',
      },
      { context },
    );

    expect(context.services.place.generatePlace).toHaveBeenCalledWith({
      ctx: context.universe,
      name: 'The Corridor',
      description: 'A narrow passage',
      parentId: 'PLACE_tavern',
      environment: 'interior',
      purpose: undefined,
    });
  });

  it('validates purpose and environment with Zod schema', () => {
    const schema = createPlaceTool.inputSchema;

    // Valid purpose values (with required environment)
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'interior',
        purpose: 'bedroom',
      }),
    ).not.toThrow();

    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'exterior',
        purpose: 'forest',
      }),
    ).not.toThrow();

    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'interior',
        purpose: 'path',
      }),
    ).not.toThrow();

    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'space',
        purpose: 'unspecified',
      }),
    ).not.toThrow();

    // Purpose is now a free string (dynamically managed via purpose registry),
    // so any string is valid at the schema level
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'interior',
        purpose: 'door',
      }),
    ).not.toThrow();

    // Invalid environment values
    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'outdoor',
        purpose: 'bedroom',
      }),
    ).toThrow();

    expect(() =>
      schema.parse({
        name: 'Test',
        description: 'Test desc',
        parentId: 'PLACE_x',
        environment: 'unspecified',
        purpose: 'bedroom',
      }),
    ).toThrow();
  });
});
