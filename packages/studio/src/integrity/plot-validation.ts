/**
 * Plot Validation
 *
 * Pure validation logic for plot definitions.
 * No dependencies on plot-store to avoid circular imports.
 * Extracted from plot-validator-runner.ts.
 */

import type { PlotDefinition } from '@dmnpc/types/npc';
import type {
  PlotValidationResult,
  PlotValidationIssue,
  PlotUnfixedIssues,
  PlotIssueSummary,
  PlotIssuesByValidator,
} from './plot-validation-types.js';
import { buildPlotValidationContext, createEmptyUnfixedIssues } from './plot-validation-types.js';
import { PLOT_VALIDATORS } from './validators/plot/index.js';
import { addPlotQuestions } from '@dmnpc/core/clarification/plot-clarification-store.js';
import { logger } from '@dmnpc/core/infra/logger.js';

/**
 * Build unfixed issues breakdown by reason.
 */
function buildUnfixedIssues(
  allIssues: PlotValidationIssue[],
  fixedIssues: PlotValidationIssue[],
): PlotUnfixedIssues {
  const fixedIds = new Set(fixedIssues.map((i) => `${i.validatorId}:${i.message}`));
  const result = createEmptyUnfixedIssues();

  for (const issue of allIssues) {
    const key = `${issue.validatorId}:${issue.message}`;
    if (fixedIds.has(key)) continue;

    if (issue.clarificationQuestion) {
      result.needsClarification.push(issue);
    } else if (issue.suggestedFix?.confidence === 'medium') {
      result.mediumConfidence.push(issue);
    } else if (issue.suggestedFix && !fixedIds.has(key)) {
      result.fixFailed.push(issue);
    }
  }

  return result;
}

/**
 * Build validation summary.
 */
function buildSummary(
  allIssues: PlotValidationIssue[],
  fixedIssues: PlotValidationIssue[],
  unfixed: PlotUnfixedIssues,
): PlotIssueSummary {
  return {
    totalFound: allIssues.length,
    totalFixed: fixedIssues.length,
    mediumConfidence: unfixed.mediumConfidence.length,
    fixFailed: unfixed.fixFailed.length,
    needsClarification: unfixed.needsClarification.length,
  };
}

/**
 * Validate a plot definition.
 *
 * Note: This function does NOT save the plot. Callers should handle saving
 * if the repairedPlot field is present and they want to persist fixes.
 *
 * @param plot - The plot to validate
 * @param options - Validation options
 * @returns Validation result with repairedPlot if fixes were made
 */
export async function validatePlotDefinition(
  plot: PlotDefinition,
  options: { repair?: boolean; allowMediumConfidence?: boolean } = {},
): Promise<PlotValidationResult> {
  const { repair = false, allowMediumConfidence = false } = options;
  const startedAt = Date.now();

  const ctx = buildPlotValidationContext(plot);
  const allIssues: PlotValidationIssue[] = [];
  const fixedIssues: PlotValidationIssue[] = [];
  const issuesByValidator: PlotIssuesByValidator = {};

  // Run all validators
  for (const validator of PLOT_VALIDATORS) {
    const issues = await validator.validate(ctx);
    allIssues.push(...issues);
    issuesByValidator[validator.id] = issues;

    // Attempt repairs if requested and validator has repair function
    if (repair && validator.repair && issues.length > 0) {
      const repairableIssues = issues.filter((i) => {
        if (i.clarificationQuestion) return false;
        if (i.suggestedFix?.confidence === 'high') return true;
        if (allowMediumConfidence && i.suggestedFix?.confidence === 'medium') return true;
        return false;
      });

      if (repairableIssues.length > 0) {
        const fixed = await validator.repair(ctx, repairableIssues);
        fixedIssues.push(...fixed);
      }
    }
  }

  // Collect clarification questions from issues
  const clarificationQuestions = allIssues
    .filter((i) => i.clarificationQuestion)
    .map((i) => i.clarificationQuestion!);

  // Add questions to the store
  if (clarificationQuestions.length > 0) {
    await addPlotQuestions(clarificationQuestions);
  }

  // Build unfixed issues breakdown
  const unfixed = buildUnfixedIssues(allIssues, fixedIssues);

  // Build summary
  const summary = buildSummary(allIssues, fixedIssues, unfixed);

  const durationMs = Date.now() - startedAt;
  logger.info(
    'PlotValidation',
    `Validated plot: ${plot.id} issues=${allIssues.length} fixed=${fixedIssues.length} clarifications=${clarificationQuestions.length} durationMs=${durationMs}`,
  );

  return {
    plotId: plot.id,
    issuesFound: allIssues.length,
    issuesFixed: fixedIssues.length,
    issues: allIssues,
    issuesFixedList: fixedIssues,
    issuesUnfixed: unfixed,
    summary,
    issuesByValidator,
    repairedPlot: fixedIssues.length > 0 ? plot : undefined,
  };
}
