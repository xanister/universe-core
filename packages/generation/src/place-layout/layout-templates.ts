/**
 * Layout Template Loader
 *
 * Loads and provides access to Layout Templates for place generation.
 * Layout Templates define the internal structure (slots) for each place type.
 */

import { readdirSync } from 'fs';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { randomInt } from '@dmnpc/core/infra/random-utils.js';
import { join } from 'path';
import type {
  Purpose,
  DimensionRange,
  PlacementAlgorithm,
  SlotDistribution,
  TerrainLayerConfig,
  LayoutSlot,
  LayoutVariant,
  LayoutTemplate,
  PlaceScale,
  EnvironmentConfig,
} from '@dmnpc/types/world';
import { logger } from '@dmnpc/core/infra/logger.js';
import { ENTITIES_DIR } from '@dmnpc/data';

// Re-export layout config types from @dmnpc/types (single source of truth)
export type {
  DimensionRange,
  PlacementAlgorithm,
  SlotDistribution,
  TerrainLayerConfig,
  LayoutSlot,
  LayoutVariant,
  LayoutTemplate,
  PlaceScale,
  EnvironmentConfig,
};

/**
 * The full layouts data structure.
 */
interface LayoutsData {
  version: string;
  description: string;
  layouts: Record<string, LayoutTemplate>;
}

// ============================================================================
// Loader
// ============================================================================

let layoutsData: LayoutsData | null = null;

/**
 * Clear the cached layout templates.
 * Call this when templates are modified via the API.
 */
export function clearLayoutTemplatesCache(): void {
  layoutsData = null;
  logger.info('LayoutTemplates', 'Cache cleared');
}

/**
 * Load layout templates from disk.
 * Reads individual JSON files from the layouts directory.
 */
export function loadLayoutTemplates(): LayoutsData {
  if (layoutsData) {
    return layoutsData;
  }

  const layoutsDir = join(ENTITIES_DIR, 'layouts');
  try {
    // Load metadata if present
    let version = '1.0.0';
    let description = 'Layout Templates';
    const metadataPath = join(layoutsDir, '_metadata.json');
    try {
      const metadata = readJsonFileSync<{ version?: string; description?: string }>(metadataPath);
      version = metadata.version ?? version;
      description = metadata.description ?? description;
    } catch {
      // Metadata file is optional
    }

    // Load all layout template files
    const files = readdirSync(layoutsDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    const layouts: Record<string, LayoutTemplate> = {};

    for (const file of files) {
      const filePath = join(layoutsDir, file);
      const { id, ...template } = readJsonFileSync<{ id: string } & LayoutTemplate>(filePath);
      layouts[id] = template;
    }

    layoutsData = { version, description, layouts };
    logger.info(
      'LayoutTemplates',
      `Loaded ${Object.keys(layoutsData.layouts).length} layout templates from ${layoutsDir}`,
    );
    return layoutsData;
  } catch (error) {
    logger.error('LayoutTemplates', `Failed to load layout templates: ${String(error)}`);
    throw error;
  }
}

/**
 * Load all layout templates as an array of { id, template } pairs.
 * Used by root inference to present all templates to the LLM.
 */
export function loadAllTemplates(): Array<{ id: string; template: LayoutTemplate }> {
  const data = loadLayoutTemplates();
  return Object.entries(data.layouts).map(([id, template]) => ({ id, template }));
}

/**
 * Get the layout template for a purpose.
 * Scans all templates' `purposes` arrays and returns the first match.
 * Returns undefined if no template serves the given purpose.
 */
export function getLayoutTemplate(purpose: Purpose): LayoutTemplate | undefined {
  const data = loadLayoutTemplates();
  for (const template of Object.values(data.layouts)) {
    if (template.purposes.includes(purpose)) {
      return template;
    }
  }
  return undefined;
}

/**
 * Get all layout templates whose `purposes` array includes the given purpose.
 * Returns all matches (not just the first), useful when multiple templates
 * can serve the same purpose.
 *
 * Example: getTemplatesForPurpose('cosmos') returns all templates that list
 * "cosmos" in their purposes array.
 */
export function getTemplatesForPurpose(
  purpose: Purpose,
): Array<{ id: string; template: LayoutTemplate }> {
  const data = loadLayoutTemplates();
  const results: Array<{ id: string; template: LayoutTemplate }> = [];
  for (const [id, template] of Object.entries(data.layouts)) {
    if (template.purposes.includes(purpose)) {
      results.push({ id, template });
    }
  }
  return results;
}

/**
 * Select a variant from a layout template based on weights.
 * Uses weighted random selection.
 */
export function selectLayoutVariant(template: LayoutTemplate, seed?: number): LayoutVariant {
  const variants = template.variants;
  if (variants.length === 0) {
    throw new Error('Layout template has no variants');
  }
  if (variants.length === 1) {
    return variants[0];
  }

  // Calculate total weight
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);

  // Use provided seed or random
  const random = seed !== undefined ? seededRandom(seed) : Math.random();
  let target = random * totalWeight;

  // Select variant
  for (const variant of variants) {
    target -= variant.weight;
    if (target <= 0) {
      return variant;
    }
  }

  // Fallback to first variant
  return variants[0];
}

/**
 * Simple seeded random for reproducibility.
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Get child place slots from a layout template.
 * Returns slots with place-level purposes (lodging, cooking, etc.) that should
 * result in generating child places.
 *
 * @param purpose The purpose to get child slots for
 * @param variant Optional specific variant
 * @returns Array of {purpose, count} for child places to generate
 */
export function getChildPlaceSlotsForPurpose(
  purpose: Purpose,
  variant?: LayoutVariant,
): Array<{ purpose: Purpose; count: number }> {
  const template = getLayoutTemplate(purpose);
  if (!template) {
    throw new Error(
      `No layout template found for purpose="${purpose}". Add a template to layouts.json.`,
    );
  }

  const selectedVariant = variant || selectLayoutVariant(template);
  const childSlots: Array<{ purpose: Purpose; count: number }> = [];

  for (const slot of selectedVariant.slots) {
    // Skip non-place purposes (exits, seating, etc. are objects, not child places)
    // A purpose is a "place" purpose if a layout template exists for it
    const hasTemplate = getLayoutTemplate(slot.purpose) !== undefined;
    if (!hasTemplate) {
      continue;
    }

    // Determine count
    const min = slot.min ?? 0;
    const max = slot.max ?? 1;
    const count = randomInt(min, max);

    if (count > 0) {
      childSlots.push({ purpose: slot.purpose, count });
    }
  }

  return childSlots;
}
