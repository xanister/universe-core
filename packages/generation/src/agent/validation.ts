/**
 * Post-Generation Validation
 *
 * Validates the generated universe for structural integrity and quality.
 */

import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { loadPurposeIds } from '../purpose-loader.js';
import { MIN_VIABLE_PLACES } from './generator-config.js';

export interface GenerationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a generated universe for structural integrity and quality.
 */
export function validateGeneratedUniverse(ctx: UniverseContext): GenerationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const places = ctx.getAllPlaces();

  // Min-viable check
  if (places.length < MIN_VIABLE_PLACES) {
    errors.push(`Only ${places.length} place(s) created (minimum: ${MIN_VIABLE_PLACES})`);
  }

  // Root place exists
  const rootPlaceId = ctx.universe.rootPlaceId;
  if (!rootPlaceId) {
    errors.push('No root place ID set on universe');
  } else if (!ctx.findPlace(rootPlaceId)) {
    errors.push(`Root place ID "${rootPlaceId}" does not resolve to a place`);
  }

  // Hierarchy connectivity: all places reachable from root
  if (rootPlaceId) {
    const reachable = new Set<string>();
    const queue = [rootPlaceId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const children = ctx.getChildPlaces(id);
      for (const child of children) {
        queue.push(child.id);
      }
    }

    const orphans = places.filter((p) => !reachable.has(p.id));
    if (orphans.length > 0) {
      const names = orphans.map((p) => p.label).join(', ');
      warnings.push(`${orphans.length} orphaned place(s) not reachable from root: ${names}`);
    }
  }

  // No duplicate sibling names
  const parentGroups = new Map<string | null, string[]>();
  for (const place of places) {
    const parent = place.position.parent;
    const group = parentGroups.get(parent) ?? [];
    group.push(place.label);
    parentGroups.set(parent, group);
  }
  for (const [parent, names] of parentGroups) {
    const seen = new Set<string>();
    for (const name of names) {
      const lower = name.toLowerCase();
      if (seen.has(lower)) {
        warnings.push(`Duplicate sibling name "${name}" under parent ${parent ?? 'root'}`);
      }
      seen.add(lower);
    }
  }

  // Purpose validity
  const validPurposes = new Set(loadPurposeIds());
  for (const place of places) {
    if (!validPurposes.has(place.info.purpose)) {
      warnings.push(`Place "${place.label}" has unknown purpose "${place.info.purpose}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
