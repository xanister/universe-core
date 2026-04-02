/**
 * Plot Validator Runner
 *
 * Orchestrates plot validation and repair with store operations.
 * Uses plot-validation.ts for core validation logic.
 * Handles saving and batch operations that require plot-store access.
 */

import type { PlotValidationResult, PlotBatchValidationResult } from './plot-validation-types.js';
import { validatePlotDefinition } from './plot-validation.js';
import { listPlots, getPlot, savePlot } from '@dmnpc/core/stores/plot-store.js';
import { logger } from '@dmnpc/core/infra/logger.js';

/**
 * Validate a plot by ID with optional save.
 *
 * @param plotId - The plot ID
 * @param options - Validation options
 * @returns Validation result or null if plot not found
 */
export async function validatePlotById(
  plotId: string,
  options: {
    repair?: boolean;
    save?: boolean;
    allowMediumConfidence?: boolean;
  } = {},
): Promise<PlotValidationResult | null> {
  const { save = false, ...validationOptions } = options;

  const plot = await getPlot(plotId);
  if (!plot) {
    logger.warn('PlotValidatorRunner', `Plot not found: ${plotId}`);
    return null;
  }

  const result = await validatePlotDefinition(plot, validationOptions);

  if (save && result.repairedPlot) {
    await savePlot(result.repairedPlot);
    logger.info(
      'PlotValidatorRunner',
      `Saved repaired plot: ${plotId} fixedIssues=${result.issuesFixed}`,
    );
  }

  return result;
}

/**
 * Validate all plots.
 *
 * @param options - Validation options
 * @returns Batch validation result
 */
export async function validateAllPlots(
  options: {
    repair?: boolean;
    save?: boolean;
    allowMediumConfidence?: boolean;
  } = {},
): Promise<PlotBatchValidationResult> {
  const { save = false, ...validationOptions } = options;

  const startedAt = Date.now();
  const plotMetadata = await listPlots();
  const results: PlotValidationResult[] = [];

  let totalIssuesFound = 0;
  let totalIssuesFixed = 0;

  for (const meta of plotMetadata) {
    const plot = await getPlot(meta.id);
    if (!plot) continue;

    const result = await validatePlotDefinition(plot, validationOptions);
    results.push(result);
    totalIssuesFound += result.issuesFound;
    totalIssuesFixed += result.issuesFixed;

    if (save && result.repairedPlot) {
      await savePlot(result.repairedPlot);
      logger.info(
        'PlotValidatorRunner',
        `Saved repaired plot: ${meta.id} fixedIssues=${result.issuesFixed}`,
      );
    }
  }

  const summary = {
    totalFound: totalIssuesFound,
    totalFixed: totalIssuesFixed,
    mediumConfidence: results.reduce((sum, r) => sum + r.summary.needsClarification, 0),
    fixFailed: results.reduce(
      (sum, r) => sum + (r.issuesFound - r.issuesFixed - r.summary.needsClarification),
      0,
    ),
    needsClarification: results.reduce((sum, r) => sum + r.summary.needsClarification, 0),
  };

  const durationMs = Date.now() - startedAt;
  logger.info(
    'PlotValidatorRunner',
    `Validated all plots: count=${plotMetadata.length} totalIssues=${totalIssuesFound} totalFixed=${totalIssuesFixed} durationMs=${durationMs}`,
  );

  return {
    plotsChecked: plotMetadata.length,
    totalIssuesFound,
    totalIssuesFixed,
    results,
    summary,
  };
}
