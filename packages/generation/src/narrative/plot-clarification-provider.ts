/**
 * Plot Clarification Provider
 *
 * Implements ClarificationProvider for plot-related questions:
 * - Dramatic role selection (climax, inciting_incident)
 * - Flag routing (which TP sets a flag)
 * - Flag naming (rename negative flags)
 * - Orphaned flag cleanup
 */

import { clarificationRegistry } from '@dmnpc/core/clarification/clarification-registry.js';
import type {
  ClarificationProvider,
  ClarificationResolutionContext,
} from '@dmnpc/core/clarification/clarification-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { getPlot, savePlotRaw } from '@dmnpc/core/stores/plot-store.js';
import type { PlotDefinition, PlotTurningPoint, FlagDefinition } from '@dmnpc/types/npc';

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * Clarification provider for plot-related questions.
 */
export const plotClarificationProvider: ClarificationProvider = {
  providerId: 'plot-validator',
  providerName: 'Plot Validator',
  categories: ['classification', 'relationship', 'attribute'],

  async resolveAnswer(ctx: ClarificationResolutionContext): Promise<string[]> {
    const { question } = ctx;

    const rawPlotId = question.resolutionContext.plotId;
    if (typeof rawPlotId !== 'string') throw new Error('Expected plotId to be string');
    const rawIssueType = question.resolutionContext.issueType;
    if (typeof rawIssueType !== 'string') throw new Error('Expected issueType to be string');

    const plot = await getPlot(rawPlotId);
    if (!plot) {
      logger.warn('PlotClarificationProvider', `Plot not found: ${rawPlotId}`);
      return [];
    }

    const handler = issueHandlers[rawIssueType];
    if (!handler) {
      logger.warn('PlotClarificationProvider', `Unknown issue type: ${rawIssueType}`);
      return [];
    }

    return handler(ctx, plot, rawPlotId);
  },
};

// ============================================================================
// Issue Handlers
// ============================================================================

type IssueHandler = (
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
) => Promise<string[]>;

const issueHandlers: Partial<Record<string, IssueHandler>> = {
  multiple_climax: handleMultipleClimax,
  missing_inciting: handleMissingInciting,
  unreachable_ending_flag: handleUnreachableEndingFlag,
  negative_flag: handleNegativeFlag,
  orphaned_flag: handleOrphanedFlag,
  climax_not_highest_progress: handleClimaxNotHighestProgress,
  vague_description: handleVagueDescription,
};

async function handleMultipleClimax(
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
): Promise<string[]> {
  const selectedTpId = ctx.answer.selectedOptionId;
  if (!selectedTpId) return [];

  for (const tp of plot.turningPoints) {
    if (tp.id === selectedTpId) {
      tp.dramaticRole = 'climax';
    } else if (tp.dramaticRole === 'climax') {
      tp.dramaticRole = 'crisis';
    }
  }
  await savePlotRaw(plot);
  logger.info('PlotClarificationProvider', `Set "${selectedTpId}" as climax for plot ${plotId}`);
  return [plotId];
}

async function handleMissingInciting(
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
): Promise<string[]> {
  const selectedTpId = ctx.answer.selectedOptionId;
  if (!selectedTpId) return [];

  const tp = plot.turningPoints.find((t: PlotTurningPoint) => t.id === selectedTpId);
  if (!tp) return [];

  tp.dramaticRole = 'inciting_incident';
  tp.progressTarget = 0;
  await savePlotRaw(plot);
  logger.info(
    'PlotClarificationProvider',
    `Set "${selectedTpId}" as inciting_incident for plot ${plotId}`,
  );
  return [plotId];
}

async function handleUnreachableEndingFlag(
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
): Promise<string[]> {
  const rawFlagId = ctx.question.resolutionContext.flagId;
  if (typeof rawFlagId !== 'string') throw new Error('Expected flagId to be string');

  const flagExists = plot.possibleFlags.some((f: FlagDefinition) => f.id === rawFlagId);
  if (!flagExists) {
    plot.possibleFlags.push({
      id: rawFlagId,
      triggerDescription: `Set when ${rawFlagId.replace(/_/g, ' ')} condition is met`,
    });
  }

  await savePlotRaw(plot);
  logger.info(
    'PlotClarificationProvider',
    `Added flag "${rawFlagId}" to possibleFlags for plot ${plotId}`,
  );
  return [plotId];
}

async function handleNegativeFlag(
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
): Promise<string[]> {
  const rawOldFlagId = ctx.question.resolutionContext.flagId;
  if (typeof rawOldFlagId !== 'string') throw new Error('Expected flagId to be string');
  const rawSuggestedName = ctx.question.resolutionContext.suggestedName;
  if (typeof rawSuggestedName !== 'string') throw new Error('Expected suggestedName to be string');

  const { answer } = ctx;
  let newFlagId: string | undefined;
  if (answer.selectedOptionId === 'suggested') {
    newFlagId = rawSuggestedName;
  } else if (answer.selectedOptionId === 'keep') {
    return [];
  } else if (answer.freeformText) {
    newFlagId = answer.freeformText;
  }

  if (newFlagId && newFlagId !== rawOldFlagId) {
    renameFlagInPlot(plot, rawOldFlagId, newFlagId);
    await savePlotRaw(plot);
    logger.info(
      'PlotClarificationProvider',
      `Renamed flag "${rawOldFlagId}" to "${newFlagId}" in plot ${plotId}`,
    );
    return [plotId];
  }
  return [];
}

async function handleOrphanedFlag(
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
): Promise<string[]> {
  const rawOrphanFlagId = ctx.question.resolutionContext.flagId;
  if (typeof rawOrphanFlagId !== 'string') throw new Error('Expected flagId to be string');

  if (ctx.answer.selectedOptionId === 'delete') {
    plot.possibleFlags = plot.possibleFlags.filter((f: FlagDefinition) => f.id !== rawOrphanFlagId);
    await savePlotRaw(plot);
    logger.info(
      'PlotClarificationProvider',
      `Deleted orphaned flag "${rawOrphanFlagId}" from possibleFlags in plot ${plotId}`,
    );
    return [plotId];
  }
  return [];
}

async function handleClimaxNotHighestProgress(
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
): Promise<string[]> {
  const selectedOption = ctx.answer.selectedOptionId;
  if (!selectedOption) return [];

  const rawClimaxId = ctx.question.resolutionContext.climaxId;
  if (typeof rawClimaxId !== 'string') throw new Error('Expected climaxId to be string');
  const rawMaxProgress = ctx.question.resolutionContext.maxProgress;
  if (typeof rawMaxProgress !== 'number') throw new Error('Expected maxProgress to be number');

  if (selectedOption === 'raise_climax') {
    return raiseClimaxProgress(plot, plotId, rawClimaxId, rawMaxProgress);
  }
  if (selectedOption.startsWith('lower_')) {
    return lowerTpProgress(plot, plotId, rawClimaxId, selectedOption.replace('lower_', ''));
  }
  if (selectedOption.startsWith('make_climax_')) {
    return swapClimax(plot, plotId, rawClimaxId, selectedOption.replace('make_climax_', ''));
  }
  return [];
}

async function raiseClimaxProgress(
  plot: PlotDefinition,
  plotId: string,
  climaxId: string,
  maxProgress: number,
): Promise<string[]> {
  const climax = plot.turningPoints.find((tp: PlotTurningPoint) => tp.id === climaxId);
  if (!climax) return [];

  climax.progressTarget = maxProgress;
  await savePlotRaw(plot);
  logger.info(
    'PlotClarificationProvider',
    `Raised climax "${climaxId}" progress to ${maxProgress} in plot ${plotId}`,
  );
  return [plotId];
}

async function lowerTpProgress(
  plot: PlotDefinition,
  plotId: string,
  climaxId: string,
  tpIdToLower: string,
): Promise<string[]> {
  const tpToLower = plot.turningPoints.find((tp: PlotTurningPoint) => tp.id === tpIdToLower);
  const climax = plot.turningPoints.find((tp: PlotTurningPoint) => tp.id === climaxId);
  if (!tpToLower || !climax) return [];

  tpToLower.progressTarget = Math.max(0, climax.progressTarget - 5);
  await savePlotRaw(plot);
  logger.info(
    'PlotClarificationProvider',
    `Lowered "${tpIdToLower}" progress to ${tpToLower.progressTarget} in plot ${plotId}`,
  );
  return [plotId];
}

async function swapClimax(
  plot: PlotDefinition,
  plotId: string,
  oldClimaxId: string,
  newClimaxId: string,
): Promise<string[]> {
  const oldClimax = plot.turningPoints.find((tp: PlotTurningPoint) => tp.id === oldClimaxId);
  const newClimax = plot.turningPoints.find((tp: PlotTurningPoint) => tp.id === newClimaxId);
  if (!oldClimax || !newClimax) return [];

  oldClimax.dramaticRole = 'crisis';
  newClimax.dramaticRole = 'climax';
  await savePlotRaw(plot);
  logger.info(
    'PlotClarificationProvider',
    `Changed climax from "${oldClimaxId}" to "${newClimaxId}" in plot ${plotId}`,
  );
  return [plotId];
}

async function handleVagueDescription(
  ctx: ClarificationResolutionContext,
  plot: PlotDefinition,
  plotId: string,
): Promise<string[]> {
  const { question, answer } = ctx;

  const rawTurningPointId = question.resolutionContext.turningPointId;
  if (typeof rawTurningPointId !== 'string')
    throw new Error('Expected turningPointId to be string');
  const rawSuggestedDesc = question.resolutionContext.suggestedDescription;
  const suggestedDescription = typeof rawSuggestedDesc === 'string' ? rawSuggestedDesc : undefined;
  const rawOriginalDesc = question.resolutionContext.originalDescription;
  if (typeof rawOriginalDesc !== 'string')
    throw new Error('Expected originalDescription to be string');

  const tp = plot.turningPoints.find((t: PlotTurningPoint) => t.id === rawTurningPointId);
  if (!tp) {
    logger.warn('PlotClarificationProvider', `Turning point not found: ${rawTurningPointId}`);
    return [];
  }

  let newDescription: string | null = null;

  if (answer.selectedOptionId === 'accept' && suggestedDescription) {
    newDescription = suggestedDescription;
  } else if (answer.selectedOptionId === 'keep') {
    logger.info(
      'PlotClarificationProvider',
      `User chose to keep original description for ${rawTurningPointId}`,
    );
    return [];
  } else if (answer.freeformText) {
    newDescription = answer.freeformText;
  }

  if (newDescription && newDescription !== rawOriginalDesc) {
    tp.essentialInformation = [newDescription];
    await savePlotRaw(plot);
    logger.info(
      'PlotClarificationProvider',
      `Updated essentialInformation for ${rawTurningPointId}: "${newDescription.substring(0, 50)}..."`,
    );
    return [plotId];
  }

  return [];
}

// Register provider on module load
clarificationRegistry.register(plotClarificationProvider);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Rename a flag throughout a plot definition.
 */
function renameFlagInPlot(plot: PlotDefinition, oldId: string, newId: string): void {
  // Rename in root-level possibleFlags
  for (const flagDef of plot.possibleFlags) {
    if (flagDef.id === oldId) {
      flagDef.id = newId;
    }
  }

  // Rename in turning point triggerOnFlags
  for (const tp of plot.turningPoints) {
    if (tp.triggerOnFlags) {
      tp.triggerOnFlags = tp.triggerOnFlags.map((f) => (f === oldId ? newId : f));
    }
  }

  // Rename in goals
  for (const goal of plot.goals) {
    goal.revealOnFlags = goal.revealOnFlags.map((f) => (f === oldId ? newId : f));
    if (goal.successFlags) {
      goal.successFlags = goal.successFlags.map((f) => (f === oldId ? newId : f));
    }
    if (goal.failureFlags) {
      goal.failureFlags = goal.failureFlags.map((f) => (f === oldId ? newId : f));
    }
  }

  // Rename in ending cards
  for (const card of plot.endingCards) {
    if (card.condition.flag === oldId) {
      card.condition.flag = newId;
    }
  }
}
