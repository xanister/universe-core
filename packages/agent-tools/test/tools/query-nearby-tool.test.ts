/**
 * Query Nearby Entities Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Character, Place } from '@dmnpc/types/entity';
import { queryNearbyTool } from '../../src/tools/query-nearby-tool.js';
import {
  createMockToolContext,
  createMockPlace,
  createMockCharacter,
} from '../helpers/mock-context.js';

describe('queryNearbyTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns characters and exits at location', async () => {
    const context = createMockToolContext();
    const testPlace = createMockPlace({ id: 'PLACE_tavern', label: 'Tavern' } as Partial<Place>);
    const npc = createMockCharacter({
      id: 'CHAR_bartender',
      label: 'Bartender',
      isPlayer: false,
      position: { parent: 'PLACE_tavern' },
    } as Partial<Character>);

    context.universe.findPlace = vi.fn().mockReturnValue(testPlace);
    // getEntitiesByPlace now used by the tool for character filtering
    // Ensure the mock NPC has entityType for the filter
    const npcWithEntityType = { ...npc, entityType: 'character' as const };
    context.universe.getEntitiesByPlace = vi.fn().mockReturnValue([npcWithEntityType]);
    context.universe.exits = [
      {
        id: 'OBJ_exit_door',
        label: 'Front Door',
        position: { parent: 'PLACE_tavern' },
        info: { options: { exitType: 'door', targetPlaceId: 'PLACE_street' } },
      },
    ];
    context.character.position = { parent: 'PLACE_tavern' };

    const result = await queryNearbyTool.execute(
      { placeId: 'PLACE_tavern', includeCharacters: true, includeExits: true },
      { context },
    );

    expect(result).toMatchObject({
      success: true,
      placeId: 'PLACE_tavern',
      placeLabel: 'Tavern',
    });
    expect((result as { characters: unknown[] }).characters).toHaveLength(1);
    expect((result as { exits: unknown[] }).exits).toHaveLength(1);
    // Verify it called getEntitiesByPlace with the right args
    expect(context.universe.getEntitiesByPlace).toHaveBeenCalledWith(
      'PLACE_tavern',
      context.character.id,
    );
  });

  it('uses player location when no placeId provided', async () => {
    const context = createMockToolContext();
    context.character.position = { parent: 'PLACE_current' };
    const currentPlace = createMockPlace({ id: 'PLACE_current', label: 'Current Place' });
    context.universe.findPlace = vi.fn().mockReturnValue(currentPlace);

    await queryNearbyTool.execute(
      { placeId: '', includeCharacters: true, includeExits: true },
      { context },
    );

    expect(context.universe.findPlace).toHaveBeenCalledWith('PLACE_current');
  });

  it('excludes player character from results', async () => {
    const context = createMockToolContext();
    context.character.position = { parent: 'PLACE_test' };
    context.character.id = 'CHAR_player';
    context.universe.findPlace = vi.fn().mockReturnValue(createMockPlace());
    // getEntitiesByPlace already excludes the player (via excludeCharacterId)
    context.universe.getEntitiesByPlace = vi.fn().mockReturnValue([]);

    const result = await queryNearbyTool.execute(
      { placeId: 'PLACE_test', includeCharacters: true, includeExits: true },
      { context },
    );

    expect((result as { characters: unknown[] }).characters).toHaveLength(0);
  });

  it('respects includeCharacters=false', async () => {
    const context = createMockToolContext();
    context.character.position = { parent: 'PLACE_test' };
    context.universe.findPlace = vi.fn().mockReturnValue(createMockPlace());

    const result = await queryNearbyTool.execute(
      { placeId: 'PLACE_test', includeCharacters: false, includeExits: true },
      { context },
    );

    expect(result).not.toHaveProperty('characters');
    expect(result).toHaveProperty('exits');
  });

  it('respects includeExits=false', async () => {
    const context = createMockToolContext();
    context.character.position = { parent: 'PLACE_test' };
    context.universe.findPlace = vi.fn().mockReturnValue(createMockPlace());

    const result = await queryNearbyTool.execute(
      { placeId: 'PLACE_test', includeCharacters: true, includeExits: false },
      { context },
    );

    expect(result).toHaveProperty('characters');
    expect(result).not.toHaveProperty('exits');
  });

  it('throws when place not found', async () => {
    const context = createMockToolContext();
    context.universe.findPlace = vi.fn().mockReturnValue(null);

    await expect(
      queryNearbyTool.execute(
        { placeId: 'PLACE_nonexistent', includeCharacters: true, includeExits: true },
        { context },
      ),
    ).rejects.toThrow('Place not found');
  });

  it('throws when no placeId and no player location', async () => {
    const context = createMockToolContext();
    context.character.position = { parent: null } as Character['position'];

    await expect(
      queryNearbyTool.execute(
        { placeId: '', includeCharacters: true, includeExits: true },
        { context },
      ),
    ).rejects.toThrow('No place ID provided');
  });

  it('logs query', async () => {
    const context = createMockToolContext();
    context.character.position = { parent: 'PLACE_test' };
    context.universe.findPlace = vi.fn().mockReturnValue(createMockPlace());

    await queryNearbyTool.execute(
      { placeId: 'PLACE_test', includeCharacters: true, includeExits: true },
      { context },
    );

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'QueryNearbyTool',
      expect.stringContaining('Queried'),
    );
  });

  it('has correct tool metadata', () => {
    expect(queryNearbyTool.name).toBe('query_nearby_entities');
    expect(queryNearbyTool.description).toContain('characters and exits');
  });

  it('validates input with Zod schema', () => {
    const schema = queryNearbyTool.inputSchema;

    // Valid with all required fields
    expect(() =>
      schema.parse({
        placeId: 'PLACE_x',
        includeCharacters: true,
        includeExits: false,
      }),
    ).not.toThrow();

    // Valid with empty placeId (use player location)
    expect(() =>
      schema.parse({
        placeId: '',
        includeCharacters: true,
        includeExits: true,
      }),
    ).not.toThrow();

    // Invalid without required fields
    expect(() => schema.parse({})).toThrow();
  });
});
