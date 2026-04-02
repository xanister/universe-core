/**
 * Determine Action Outcome Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { determineActionOutcomeTool } from '../../src/tools/determine-outcome-tool.js';
import {
  createMockToolContext,
  createMockToolArbiterResult,
  createAdvanceTimeChange,
  createMoveChange,
} from '../helpers/mock-context.js';
import type { ClassificationResult } from '@dmnpc/types/game';

describe('determineActionOutcomeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when classification result is missing', async () => {
    const context = createMockToolContext();
    context.classificationResult = undefined;

    await expect(determineActionOutcomeTool.execute({}, { context })).rejects.toThrow(
      'classify_input',
    );
  });

  it('calls arbitration service to build context and plan', async () => {
    const classificationResult: ClassificationResult = {
      actions: [{ type: 'Action', intent: 'search the room' }],
    };
    const context = createMockToolContext();
    context.classificationResult = classificationResult;

    vi.mocked(context.services.arbitration.buildArbitrationContext).mockReturnValue({
      mockContext: true,
    });
    vi.mocked(context.services.arbitration.planArbitration).mockResolvedValue(
      createMockToolArbiterResult(),
    );

    await determineActionOutcomeTool.execute({}, { context });

    expect(context.services.arbitration.buildArbitrationContext).toHaveBeenCalledWith(
      classificationResult,
      context,
    );
    expect(context.services.arbitration.planArbitration).toHaveBeenCalledWith({
      mockContext: true,
    });
  });

  it('stores arbiter result in context', async () => {
    const mockResult = createMockToolArbiterResult({
      sceneContributions: [
        { source: 'player_action', description: 'Success!', outcome: 'success' },
      ],
    });
    const context = createMockToolContext();
    context.classificationResult = { actions: [] };

    vi.mocked(context.services.arbitration.planArbitration).mockResolvedValue(mockResult);

    await determineActionOutcomeTool.execute({}, { context });

    expect(context.arbiterResult).toEqual(mockResult);
  });

  it('returns outcome information', async () => {
    const mockResult = createMockToolArbiterResult({
      sceneContributions: [
        {
          source: 'player_action',
          description: 'You search and find a key',
          outcome: 'success',
          outcomeReason: 'Perception check passed',
        },
      ],
    });
    const context = createMockToolContext();
    context.classificationResult = { actions: [] };

    vi.mocked(context.services.arbitration.planArbitration).mockResolvedValue(mockResult);

    const result = await determineActionOutcomeTool.execute({}, { context });

    expect(result).toMatchObject({
      outcome: 'success',
      outcomeReason: 'Perception check passed',
    });
  });

  it('returns rejection when present', async () => {
    const mockResult = createMockToolArbiterResult({
      rejectionReason: 'The door is locked',
      sceneContributions: [
        { source: 'player_action', description: 'Attempted action', outcome: 'failure' },
      ],
    });
    const context = createMockToolContext();
    context.classificationResult = { actions: [] };

    vi.mocked(context.services.arbitration.planArbitration).mockResolvedValue(mockResult);

    const result = await determineActionOutcomeTool.execute({}, { context });

    expect(result).toMatchObject({
      rejection: 'The door is locked',
    });
  });

  it('categorizes planned changes correctly', async () => {
    const mockResult = createMockToolArbiterResult({
      stateChanges: [
        createAdvanceTimeChange(30, 'searching'),
        createMoveChange('PLACE_new'),
        {
          type: 'create_entity',
          entity: { type: 'character', name: 'Guard', role: 'enemy', description: 'A guard' },
        },
        { type: 'update_disposition', characterId: 'CHAR_npc', targetId: 'CHAR_player', delta: 10 },
        { type: 'add_inventory', characterId: 'CHAR_player', itemId: 'golden_key' },
      ],
      sceneContributions: [{ source: 'player_action', description: 'Test', outcome: 'success' }],
    });
    const context = createMockToolContext();
    context.classificationResult = { actions: [] };

    vi.mocked(context.services.arbitration.planArbitration).mockResolvedValue(mockResult);

    const result = await determineActionOutcomeTool.execute({}, { context });

    expect(result).toMatchObject({
      plannedChanges: expect.objectContaining({
        timeAdvance: 30,
        dispositions: 1,
        inventoryChanges: 1,
      }),
    });
  });

  it('has correct tool metadata', () => {
    expect(determineActionOutcomeTool.name).toBe('determine_action_outcome');
    expect(determineActionOutcomeTool.description).toContain('Determine');
  });
});
