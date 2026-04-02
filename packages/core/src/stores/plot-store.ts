/**
 * Plot I/O
 *
 * Pure file I/O operations for plot definitions.
 * No validation or generation logic - those belong in game/plot/.
 */

import { readdir, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { PLOTS_DIR } from '@dmnpc/data';
import type { PlotMetadata, PlotDefinition } from '@dmnpc/types/npc';
import { logger } from '../infra/logger.js';
import { readJsonFile } from '../infra/read-json-file.js';

/**
 * Load all plot definitions from the plots/definitions directory.
 * Returns metadata only (id, label, description, universeId).
 */
export async function listPlots(): Promise<PlotMetadata[]> {
  try {
    if (!existsSync(PLOTS_DIR)) {
      throw new Error(`PlotStore: Plots directory does not exist: ${PLOTS_DIR}`);
    }

    const files = await readdir(PLOTS_DIR);
    const plots: PlotMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = join(PLOTS_DIR, file);
        const plot = await readJsonFile<PlotDefinition>(filePath);

        // Validate required fields and extract metadata
        if (plot.id && plot.label) {
          plots.push({
            id: plot.id,
            label: plot.label,
            description: plot.description,
            universeId: plot.universeId,
            image: plot.image,
          });
        }
      } catch (error) {
        logger.error('PlotStore', `Failed to load plot file: ${file}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    logger.info('PlotStore', `Loaded ${plots.length} plot definitions`);
    return plots;
  } catch (error) {
    logger.error('PlotStore', 'Failed to list plots', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get a specific plot definition by ID.
 */
export async function getPlot(plotId: string): Promise<PlotDefinition | null> {
  try {
    const filePath = join(PLOTS_DIR, `${plotId}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    return await readJsonFile<PlotDefinition>(filePath);
  } catch (error) {
    logger.error('PlotStore', `Failed to load plot: ${plotId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * List plots compatible with a specific universe.
 * Returns plots that either have no universeId constraint or match the given universeId.
 */
export async function listCompatiblePlots(universeId: string): Promise<PlotMetadata[]> {
  const allPlots = await listPlots();
  return allPlots.filter((plot) => !plot.universeId || plot.universeId === universeId);
}

/**
 * List plots that are explicitly tied to a specific universe.
 * Returns plots where universeId exactly matches the given universe ID.
 * Used for cascade deletion when a universe is deleted.
 */
export async function listPlotsUsingUniverse(universeId: string): Promise<PlotMetadata[]> {
  const allPlots = await listPlots();
  return allPlots.filter((plot) => plot.universeId === universeId);
}

/**
 * Save a plot definition to disk (raw I/O, no validation).
 * For validated saves, use savePlot() from game/plot/plot-store.
 */
export async function savePlotRaw(plot: PlotDefinition): Promise<void> {
  if (!plot.id || !plot.id.startsWith('PLOT_')) {
    throw new Error('Plot ID must start with PLOT_');
  }

  // Ensure the plots directory exists
  if (!existsSync(PLOTS_DIR)) {
    await mkdir(PLOTS_DIR, { recursive: true });
  }

  const filePath = join(PLOTS_DIR, `${plot.id}.json`);
  await writeFile(filePath, JSON.stringify(plot, null, 2) + '\n', 'utf-8');
  logger.info('PlotStore', `Saved plot: id=${plot.id} label="${plot.label}"`);
}

/**
 * Save a plot definition to disk.
 * This is currently identical to savePlotRaw because validation is handled by callers.
 */
export async function savePlot(plot: PlotDefinition): Promise<void> {
  await savePlotRaw(plot);
}

/**
 * Delete a plot definition from disk.
 */
export async function deletePlot(plotId: string): Promise<boolean> {
  const filePath = join(PLOTS_DIR, `${plotId}.json`);

  if (!existsSync(filePath)) {
    return false;
  }

  await unlink(filePath);
  logger.info('PlotStore', `Deleted plot: id=${plotId}`);
  return true;
}
