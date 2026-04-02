/**
 * Layer 1: Shape Generator
 *
 * Entry point for generating the physical structure of a place.
 * Delegates to the terrain layer processor which iterates layers by renderOrder.
 */

import type { GeneratedShape, LayoutVariant } from '@dmnpc/types/world';
import { processLayers } from '../algorithms/shape-algorithms.js';

// Re-export for consumers
export { processLayers };

/**
 * Generate a shape for a place using its layout variant.
 *
 * The variant's terrain layers drive all geometry, tiles, and blocking.
 * Dimensions come from variant.width / variant.height.
 *
 * @param variant The layout variant (required -- no fallbacks)
 * @param targetWidth Target width in world units (pixels), 0 to use template range
 * @param targetHeight Target height in world units (pixels), 0 to use template range
 * @param seed Random seed for reproducibility
 * @returns Generated shape with tiles and geometry
 */
export function generateShapeFromTemplate(
  variant: LayoutVariant,
  targetWidth: number,
  targetHeight: number,
  seed: number,
): GeneratedShape {
  return processLayers(variant, targetWidth, targetHeight, seed);
}
