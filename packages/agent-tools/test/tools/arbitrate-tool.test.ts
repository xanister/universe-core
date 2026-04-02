/**
 * Arbitrate Actions Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { arbitrateActionsTool } from '../../src/tools/arbitrate-tool.js';
import { createMockToolContext, createMockToolArbiterResult } from '../helpers/mock-context.js';

describe('arbitrateActionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls arbitration service', async () => {
    const context = createMockToolContext();

    await arbitrateActionsTool.execute({}, { context });

    expect(context.services.arbitration.arbitrate).toHaveBeenCalledWith(context);
  });

  it('returns outcome from scene contributions', async () => {
    const context = createMockToolContext();
    context.arbiterResult = createMockToolArbiterResult({
      sceneContributions: [
        {
          source: 'player_action',
          description: 'You successfully pick the lock',
          outcome: 'success',
          outcomeReason: 'High dexterity roll',
        },
      ],
    });

    const result = await arbitrateActionsTool.execute({}, { context });

    expect(result.outcome).toBe('success');
    expect(result.outcomeReason).toBe('High dexterity roll');
  });

  it('returns state change count', async () => {
    const context = createMockToolContext();
    context.arbiterResult = createMockToolArbiterResult({
      stateChanges: [
        { type: 'advance_time', minutes: 15, reason: 'picking lock' },
        { type: 'move', destinationId: 'PLACE_vault' },
      ],
      sceneContributions: [],
    });

    const result = await arbitrateActionsTool.execute({}, { context });

    expect(result.stateChangesCount).toBe(2);
  });

  it('counts declared entities', async () => {
    const context = createMockToolContext();
    context.arbiterResult = createMockToolArbiterResult({
      stateChanges: [
        {
          type: 'create_entity',
          entity: { type: 'character', name: 'Guard', role: 'enemy', description: 'A guard' },
        },
        {
          type: 'create_entity',
          entity: { type: 'character', name: 'Merchant', role: 'npc', description: 'A merchant' },
        },
        { type: 'advance_time', minutes: 5, reason: 'interaction' },
      ],
      sceneContributions: [],
    });

    const result = await arbitrateActionsTool.execute({}, { context });

    expect(result.entitiesDeclared).toBe(2);
  });

  it('returns flags to set', async () => {
    const context = createMockToolContext();
    context.arbiterResult = createMockToolArbiterResult({
      flagsToSet: ['met_the_king', 'received_quest'],
      sceneContributions: [],
    });

    const result = await arbitrateActionsTool.execute({}, { context });

    expect(result.flagsToSet).toEqual(['met_the_king', 'received_quest']);
  });

  it('detects storyteller events', async () => {
    const context = createMockToolContext();
    context.arbiterResult = createMockToolArbiterResult({
      sceneContributions: [
        { source: 'player_action', description: 'You enter the room', outcome: 'success' },
        {
          source: 'storyteller_event',
          description: 'A mysterious figure appears',
          outcome: 'success',
        },
      ],
    });

    const result = await arbitrateActionsTool.execute({}, { context });

    expect(result.hasStorytellerEvent).toBe(true);
  });

  it('returns rejection reason when present', async () => {
    const context = createMockToolContext();
    context.arbiterResult = createMockToolArbiterResult({
      rejectionReason: 'You cannot fly without wings',
      sceneContributions: [],
    });

    const result = await arbitrateActionsTool.execute({}, { context });

    expect(result.rejection).toBe('You cannot fly without wings');
  });

  it('handles missing arbiter result gracefully', async () => {
    const context = createMockToolContext();
    context.arbiterResult = undefined;

    const result = await arbitrateActionsTool.execute({}, { context });

    expect(result.outcome).toBe('unknown');
    expect(result.stateChangesCount).toBe(0);
    expect(result.entitiesDeclared).toBe(0);
    expect(result.flagsToSet).toEqual([]);
    expect(result.hasStorytellerEvent).toBe(false);
    expect(result.rejection).toBe(null);
  });

  it('has correct tool metadata', () => {
    expect(arbitrateActionsTool.name).toBe('arbitrate_actions');
    expect(arbitrateActionsTool.description).toContain('determine outcomes');
  });
});
