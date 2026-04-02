/**
 * Determine Action Outcome Tool
 *
 * Calls the LLM to determine outcomes, declare entities, and plan state changes.
 * Does NOT execute - just plans. The agent can then execute individual state changes.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext, ToolStateChange } from '../types.js';

export const determineActionOutcomeTool = tool({
  name: 'determine_action_outcome',
  description:
    'REQUIRED: Determine the outcome of player actions and check for storyteller events. ' +
    'Call after classify_input, BEFORE describe_narrative. ' +
    'This runs story arbitration (inciting incidents, plot events, etc.) - without it, storyteller events will NOT fire. ' +
    'Returns outcome, required entities, and planned state changes.',
  inputSchema: z.object({}),
  async execute(_input: Record<string, never>, { context }: { context: ToolContext }) {
    const { services } = context;
    const classification = context.classificationResult;
    if (!classification) {
      throw new Error('No classification result - call classify_input first');
    }

    const arbCtx = services.arbitration.buildArbitrationContext(classification, context);

    const arbiterResult = await services.arbitration.planArbitration(arbCtx);

    context.arbiterResult = arbiterResult;

    // This enables same-turn flag-triggered events (e.g., player action sets flag -> event fires)
    await services.arbitration.arbitrateStoryteller(context);

    const sceneContribution = arbiterResult.sceneContributions[0] as
      | (typeof arbiterResult.sceneContributions)[number]
      | undefined;
    const entityChanges = arbiterResult.stateChanges.filter((sc) => sc.type === 'create_entity');
    const timeChanges = arbiterResult.stateChanges.filter(
      (sc): sc is ToolStateChange & { type: 'advance_time' } => sc.type === 'advance_time',
    );
    const movementChanges = arbiterResult.stateChanges.filter(
      (sc) => sc.type === 'travel' || sc.type === 'move',
    );
    const dispositionChanges = arbiterResult.stateChanges.filter(
      (sc) => sc.type === 'update_disposition',
    );
    const inventoryChanges = arbiterResult.stateChanges.filter(
      (sc) => sc.type === 'add_inventory' || sc.type === 'remove_inventory',
    );
    const eventChanges = arbiterResult.stateChanges.filter((sc) => sc.type === 'create_event');

    if (!sceneContribution) {
      throw new Error('No scene contribution found in arbitration result');
    }

    return {
      outcome: sceneContribution.outcome,
      outcomeReason: sceneContribution.outcomeReason,
      narrativeGuidance: sceneContribution.guidance,
      rejection: arbiterResult.rejectionReason ?? null,
      plannedChanges: {
        entities: entityChanges.map((sc) => ({
          type: sc.entity.type,
          name: sc.entity.name,
          role: sc.entity.role,
        })),
        timeAdvance: timeChanges.length > 0 ? timeChanges[0].minutes : 0,
        movements: movementChanges.map((sc) => {
          if (sc.type === 'travel') {
            return {
              type: sc.characterId ? ('npc' as const) : ('player' as const),
              destinationId: sc.destinationId,
              ...(sc.characterId ? { characterId: sc.characterId } : {}),
            };
          } else {
            return {
              type: 'reposition' as const,
              characterId: sc.characterId,
              nearEntityId: sc.nearEntityId,
            };
          }
        }),
        dispositions: dispositionChanges.length,
        inventoryChanges: inventoryChanges.length,
        events: eventChanges.length,
      },
      flagsToSet: arbiterResult.flagsToSet ?? [],
      totalToolStateChanges: arbiterResult.stateChanges.length,
      hasStorytellerEvent: arbiterResult.sceneContributions.some(
        (c) => c.source === 'storyteller_event',
      ),
    };
  },
});
