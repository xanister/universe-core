/**
 * Create Event Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventTool } from '../../src/tools/create-event-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('createEventTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an event and returns success', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.history.createEvent).mockResolvedValue({
      id: 'EVENT_new',
      date: '1/1/1',
      subject: 'Test Subject',
      fact: 'CHAR_player searched PLACE_cellar',
      significance: 'minor',
    });

    const result = await createEventTool.execute(
      {
        fact: 'CHAR_player searched PLACE_cellar',
        subject: 'Test Subject',
        placeId: '',
        significance: 'minor',
        witnessIds: ['CHAR_player'],
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      eventId: 'EVENT_new',
      fact: 'CHAR_player searched PLACE_cellar',
      significance: 'minor',
      witnessCount: 1,
    });
  });

  it('creates major event with place', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.history.createEvent).mockResolvedValue({
      id: 'EVENT_major',
      date: '1/1/1',
      subject: 'King',
      fact: 'The King was assassinated',
      significance: 'major',
      placeId: 'PLACE_throne',
    });

    const result = await createEventTool.execute(
      {
        fact: 'The King was assassinated',
        subject: 'King',
        placeId: 'PLACE_throne',
        significance: 'major',
        witnessIds: ['CHAR_guard1', 'CHAR_guard2'],
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      eventId: 'EVENT_major',
      fact: 'The King was assassinated',
      significance: 'major',
      witnessCount: 2,
    });
  });

  it('calls createEvent with correct parameters', async () => {
    const context = createMockToolContext();

    await createEventTool.execute(
      {
        fact: 'Test fact',
        subject: 'Subject',
        placeId: 'PLACE_x',
        significance: 'moderate',
        witnessIds: ['CHAR_a', 'CHAR_b'],
      },
      { context },
    );

    expect(context.services.history.createEvent).toHaveBeenCalledWith(
      context.universe,
      {
        date: context.universe.universe.date,
        fact: 'Test fact',
        subject: 'Subject',
        placeId: 'PLACE_x',
        significance: 'moderate',
      },
      ['CHAR_a', 'CHAR_b'],
    );
  });

  it('logs event creation', async () => {
    const context = createMockToolContext();

    await createEventTool.execute(
      {
        fact: 'Something happened',
        subject: 'Someone',
        placeId: '',
        significance: 'minor',
        witnessIds: ['CHAR_a'],
      },
      { context },
    );

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'CreateEventTool',
      expect.stringContaining('Event created'),
    );
  });

  it('throws when creation fails', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.history.createEvent).mockRejectedValue(new Error('Database error'));

    await expect(
      createEventTool.execute(
        {
          fact: 'Test',
          subject: 'Test',
          placeId: '',
          significance: 'minor',
          witnessIds: [],
        },
        { context },
      ),
    ).rejects.toThrow('Database error');
  });

  it('has correct tool metadata', () => {
    expect(createEventTool.name).toBe('create_event');
    expect(createEventTool.description).toContain('historical event');
  });

  it('validates input with Zod schema', () => {
    const schema = createEventTool.inputSchema;

    // Valid input (all required, placeId can be empty)
    expect(() =>
      schema.parse({
        fact: 'Something happened',
        subject: 'Someone',
        placeId: '',
        significance: 'minor',
        witnessIds: ['CHAR_a'],
      }),
    ).not.toThrow();

    // With placeId
    expect(() =>
      schema.parse({
        fact: 'Something happened',
        subject: 'Someone',
        placeId: 'PLACE_x',
        significance: 'major',
        witnessIds: [],
      }),
    ).not.toThrow();

    // Invalid significance
    expect(() =>
      schema.parse({
        fact: 'Test',
        subject: 'Test',
        placeId: '',
        significance: 'trivial',
        witnessIds: [],
      }),
    ).toThrow();

    // Missing witnessIds
    expect(() =>
      schema.parse({
        fact: 'Test',
        subject: 'Test',
        placeId: '',
        significance: 'minor',
      }),
    ).toThrow();

    // Missing placeId
    expect(() =>
      schema.parse({
        fact: 'Test',
        subject: 'Test',
        significance: 'minor',
        witnessIds: [],
      }),
    ).toThrow();
  });

  it('passes empty placeId as undefined to createEvent', async () => {
    const context = createMockToolContext();

    await createEventTool.execute(
      {
        fact: 'Test',
        subject: 'Test',
        placeId: '',
        significance: 'minor',
        witnessIds: [],
      },
      { context },
    );

    expect(context.services.history.createEvent).toHaveBeenCalledWith(
      context.universe,
      {
        date: context.universe.universe.date,
        fact: 'Test',
        subject: 'Test',
        placeId: undefined,
        significance: 'minor',
      },
      [],
    );
  });
});
