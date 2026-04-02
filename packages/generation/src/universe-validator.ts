/**
 * Universe Validator
 *
 * Provides idempotent universe generation that can resume from any state.
 * Validates existing places against Layout Templates and generates missing children.
 */

import type { Place } from '@dmnpc/types/entity';
import type { Purpose } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import {
  loadLayoutTemplates,
  getLayoutTemplate,
  selectLayoutVariant,
  getChildPlaceSlotsForPurpose,
} from './place-layout/layout-templates.js';
import type { LayoutVariant } from './place-layout/layout-templates.js';
import { generatePlace, DEFAULT_CREATION_HINT } from './place-generator.js';

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const dot = trimmed.indexOf('.');
  return dot >= 0 ? trimmed.slice(0, dot + 1).trim() : trimmed;
}

/**
 * Options for validation and completion.
 */
export interface ValidateAndCompleteOptions {
  /** Random seed for deterministic generation */
  seed?: number;
  /** Maximum depth to validate (undefined = unlimited) */
  maxDepth?: number;
  /** Whether to generate missing children (false = report only) */
  generate?: boolean;
  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

/**
 * Result of validation.
 */
export interface PlaceValidationResult {
  /** Total places checked */
  placesChecked: number;
  /** Places that needed children */
  placesIncomplete: number;
  /** New places generated */
  placesGenerated: number;
  /** Places that are complete */
  placesComplete: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Gets the purpose (place type) from a place.
 */
function getPlacePurpose(place: Place): Purpose | undefined {
  return place.info.purpose;
}

/**
 * Gets children of a place.
 */
function getChildren(ctx: UniverseContext, parentId: string): Place[] {
  return ctx.places.filter((p) => p.position.parent === parentId);
}

/**
 * Counts existing children by purpose.
 */
function countChildrenByPurpose(children: Place[]): Map<Purpose, number> {
  const counts = new Map<Purpose, number>();
  for (const child of children) {
    const childPurpose = getPlacePurpose(child);
    if (childPurpose) {
      counts.set(childPurpose, (counts.get(childPurpose) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Determines what children need to be generated based on Layout Template slots.
 * Compares existing children against slot definitions.
 */
function determineNeededChildren(
  placePurpose: Purpose,
  existingChildren: Place[],
  _variant?: LayoutVariant,
): { purpose: Purpose; count: number }[] {
  const needed: { purpose: Purpose; count: number }[] = [];
  const existingCounts = countChildrenByPurpose(existingChildren);

  // Get child place slots from Layout Template
  const childSlots = getChildPlaceSlotsForPurpose(placePurpose);

  if (childSlots.length === 0) {
    // No child place slots - this is a leaf node
    return [];
  }

  // For each child slot, check if we have enough children of that purpose
  for (const slot of childSlots) {
    const existing = existingCounts.get(slot.purpose) ?? 0;
    const neededCount = slot.count - existing;

    if (neededCount > 0) {
      needed.push({ purpose: slot.purpose, count: neededCount });
    }
  }

  return needed;
}

/**
 * Generates a child place.
 */
async function generateChildPlace(
  ctx: UniverseContext,
  parentPlace: Place,
  childPurpose: Purpose,
  seed: number,
): Promise<Place | null> {
  try {
    // Check if we have a Layout Template for this purpose
    const template = getLayoutTemplate(childPurpose);
    const variant = template ? selectLayoutVariant(template, seed) : null;

    // Build a description for the LLM based on the purpose
    const description = `A ${childPurpose.replace(/_/g, ' ')} within ${parentPlace.label}`;

    const parentOneLine =
      parentPlace.short_description.trim() || firstSentence(parentPlace.description || '');
    const creationHint = `${DEFAULT_CREATION_HINT}\n\nThis place is a ${childPurpose.replace(/_/g, ' ')} within ${parentPlace.label}. (${parentPlace.label}: ${parentOneLine}).`;

    // Generate the place using the existing place generator
    const result = await generatePlace(ctx, {
      description,
      creationHint,
      parentId: parentPlace.id,
      purpose: childPurpose,
      environment: variant?.environment ?? ENVIRONMENT_PRESETS.exterior(),
    });

    {
      // Update the generated place with the correct purpose
      result.info.purpose = childPurpose;
      if (variant) {
        result.info.scale = variant.scale;
      }
      ctx.upsertEntity('place', result);
    }

    return result;
  } catch (error) {
    logger.error(
      'UniverseValidator',
      `Failed to generate ${childPurpose} child for ${parentPlace.label}`,
      error,
    );
    return null;
  }
}

/**
 * Validates and completes a single place and its descendants.
 *
 * @param ctx Universe context
 * @param placeId ID of the place to validate
 * @param options Validation options
 * @param currentDepth Current recursion depth
 * @param result Accumulated results
 */
async function validatePlaceRecursive(
  ctx: UniverseContext,
  placeId: string,
  options: ValidateAndCompleteOptions,
  currentDepth: number,
  result: PlaceValidationResult,
): Promise<void> {
  const place = ctx.findPlace(placeId);
  if (!place) {
    result.errors.push(`Place not found: ${placeId}`);
    return;
  }

  result.placesChecked++;

  const placePurpose = getPlacePurpose(place);
  if (!placePurpose) {
    // No purpose - can't validate
    result.placesComplete++;
    return;
  }

  // Check if we have a Layout Template for this purpose
  const template = getLayoutTemplate(placePurpose);
  if (!template) {
    result.placesComplete++;
    return;
  }

  // Check depth limit
  if (options.maxDepth !== undefined && currentDepth >= options.maxDepth) {
    return;
  }

  // Get children and determine what's needed
  const children = getChildren(ctx, placeId);
  const needed = determineNeededChildren(placePurpose, children);

  if (needed.length > 0) {
    result.placesIncomplete++;

    if (options.generate) {
      options.onProgress?.(`Generating children for ${place.label}...`);

      // Generate needed children
      let seedOffset = 0;
      for (const { purpose, count } of needed) {
        for (let i = 0; i < count; i++) {
          const childSeed = (options.seed ?? Date.now()) + seedOffset++;
          const child = await generateChildPlace(ctx, place, purpose, childSeed);
          if (child) {
            result.placesGenerated++;
            options.onProgress?.(`Generated ${purpose}: ${child.label}`);
          }
        }
      }
    }
  } else {
    result.placesComplete++;
  }

  // Recursively validate children (including newly generated ones)
  const allChildren = getChildren(ctx, placeId);
  for (const child of allChildren) {
    await validatePlaceRecursive(ctx, child.id, options, currentDepth + 1, result);
  }
}

/**
 * Validates and completes the universe starting from a root place.
 * This function is idempotent - running it multiple times will produce the same result.
 *
 * @param ctx Universe context
 * @param rootPlaceId ID of the root place (usually cosmos)
 * @param options Validation options
 * @returns Validation result
 */
export async function validateAndComplete(
  ctx: UniverseContext,
  rootPlaceId: string,
  options: ValidateAndCompleteOptions = {},
): Promise<PlaceValidationResult> {
  const defaultOptions: ValidateAndCompleteOptions = {
    seed: Date.now(),
    generate: true,
    ...options,
  };

  // Ensure Layout Templates are loaded
  loadLayoutTemplates();

  const result: PlaceValidationResult = {
    placesChecked: 0,
    placesIncomplete: 0,
    placesGenerated: 0,
    placesComplete: 0,
    errors: [],
  };

  logger.info('UniverseValidator', `Starting validation from ${rootPlaceId}`);
  defaultOptions.onProgress?.(`Starting validation...`);

  await validatePlaceRecursive(ctx, rootPlaceId, defaultOptions, 0, result);

  logger.info(
    'UniverseValidator',
    `Validation complete: ${result.placesChecked} checked, ${result.placesGenerated} generated, ${result.errors.length} errors`,
  );

  return result;
}

/**
 * Finds the root place in a universe using universe.rootPlaceId.
 *
 * @param ctx Universe context
 * @returns The root place, or undefined if not found
 */
export function findCosmos(ctx: UniverseContext): Place | undefined {
  return ctx.findPlace(ctx.universe.rootPlaceId) ?? undefined;
}
