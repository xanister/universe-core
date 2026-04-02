/**
 * Query Events Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryEventsTool } from '../../src/tools/query-events-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('queryEventsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns events matching query', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.history.getRelevantEvents).mockReturnValue([
      {
        id: 'EVENT_1',
        date: '1/1/1',
        subject: 'King',
        fact: 'The King declared war',
        significance: 'major',
      },
      {
        id: 'EVENT_2',
        date: '1/2/1',
        subject: 'King',
        fact: 'The King signed a treaty',
        significance: 'moderate',
      },
    ]);

    const result = await queryEventsTool.execute(
      { topic: 'King', placeId: '', characterId: '', maxEvents: 10 },
      { context },
    );

    expect(result).toMatchObject({
      success: true,
      eventCount: 2,
    });
    expect((result as { events: unknown[] }).events).toHaveLength(2);
  });

  it('filters by place', async () => {
    const context = createMockToolContext();

    await queryEventsTool.execute(
      { topic: '', placeId: 'PLACE_castle', characterId: '', maxEvents: 10 },
      { context },
    );

    expect(context.services.history.getRelevantEvents).toHaveBeenCalledWith(
      context.universe,
      expect.objectContaining({ placeId: 'PLACE_castle' }),
    );
  });

  it('filters by character', async () => {
    const context = createMockToolContext();

    await queryEventsTool.execute(
      { topic: '', placeId: '', characterId: 'CHAR_hero', maxEvents: 10 },
      { context },
    );

    expect(context.services.history.getRelevantEvents).toHaveBeenCalledWith(
      context.universe,
      expect.objectContaining({ characterId: 'CHAR_hero' }),
    );
  });

  it('respects maxEvents parameter', async () => {
    const context = createMockToolContext();

    await queryEventsTool.execute(
      { topic: '', placeId: '', characterId: '', maxEvents: 5 },
      { context },
    );

    expect(context.services.history.getRelevantEvents).toHaveBeenCalledWith(
      context.universe,
      expect.objectContaining({ maxEvents: 5 }),
    );
  });

  it('uses default maxEvents of 10', async () => {
    const context = createMockToolContext();

    await queryEventsTool.execute(
      { topic: '', placeId: '', characterId: '', maxEvents: 10 },
      { context },
    );

    expect(context.services.history.getRelevantEvents).toHaveBeenCalledWith(
      context.universe,
      expect.objectContaining({ maxEvents: 10 }),
    );
  });

  it('returns empty array when no events found', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.history.getRelevantEvents).mockReturnValue([]);

    const result = await queryEventsTool.execute(
      { topic: 'nothing', placeId: '', characterId: '', maxEvents: 10 },
      { context },
    );

    expect(result).toEqual({
      success: true,
      eventCount: 0,
      events: [],
    });
  });

  it('logs query', async () => {
    const context = createMockToolContext();

    await queryEventsTool.execute(
      { topic: 'test', placeId: '', characterId: '', maxEvents: 10 },
      { context },
    );

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'QueryEventsTool',
      expect.stringContaining('Found'),
    );
  });

  it('throws when query fails', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.history.getRelevantEvents).mockImplementation(() => {
      throw new Error('Query failed');
    });

    await expect(
      queryEventsTool.execute(
        { topic: 'test', placeId: '', characterId: '', maxEvents: 10 },
        { context },
      ),
    ).rejects.toThrow('Query failed');
  });

  it('has correct tool metadata', () => {
    expect(queryEventsTool.name).toBe('query_historical_events');
    expect(queryEventsTool.description).toContain('historical events');
  });

  it('validates input with Zod schema', () => {
    const schema = queryEventsTool.inputSchema;

    // All parameters required
    expect(() => schema.parse({})).toThrow();

    // With all parameters
    expect(() =>
      schema.parse({
        topic: 'war',
        placeId: 'PLACE_x',
        characterId: 'CHAR_x',
        maxEvents: 15,
      }),
    ).not.toThrow();

    // Empty strings for optional filters
    expect(() =>
      schema.parse({
        topic: '',
        placeId: '',
        characterId: '',
        maxEvents: 10,
      }),
    ).not.toThrow();

    // maxEvents too low
    expect(() =>
      schema.parse({
        topic: '',
        placeId: '',
        characterId: '',
        maxEvents: 0,
      }),
    ).toThrow();

    // maxEvents too high
    expect(() =>
      schema.parse({
        topic: '',
        placeId: '',
        characterId: '',
        maxEvents: 21,
      }),
    ).toThrow();
  });
});
