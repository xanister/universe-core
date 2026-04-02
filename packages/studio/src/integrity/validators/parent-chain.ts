/**
 * Parent Chain Validator
 *
 * Validates that every place has a complete, valid parent chain from itself
 * up to the cosmos. This ensures proper world hierarchy and enables the LLM
 * to understand "I leave" semantics clearly.
 *
 * Detects:
 * - Broken chains (parent doesn't exist)
 * - Cycles (place is its own ancestor)
 * - Incomplete chains (doesn't reach cosmos)
 * - Excessive depth (chain > 20 levels, likely data corruption)
 *
 * Fixes:
 * - Cycles with valid ancestor: deterministically break by setting parent to nearest valid ancestor
 * - Cycles without valid ancestor: clarification question asking user to specify parent
 * - Broken/incomplete chains: use LLM to determine appropriate parent (handled by repair orchestrator)
 */

import type { Place, BaseEntity } from '@dmnpc/types/entity';
import { isPlace } from '@dmnpc/core/entities/type-guards.js';
import type { Validator, ValidationIssue, ValidationContext } from '../integrity-types.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { createPlaceHierarchyQuestion } from '@dmnpc/generation/place/place-clarification-provider.js';

const MAX_CHAIN_DEPTH = 20;

/**
 * Result of walking a parent chain.
 */
interface ChainWalkResult {
  /** The chain of place IDs from start to endpoint (or cycle point) */
  chain: string[];
  /** Whether the chain reaches cosmos */
  reachesCosmos: boolean;
  /** The first missing parent ID (if chain is broken) */
  missingParentId?: string;
  /** The ID where a cycle was detected (place appears in its own ancestor chain) */
  cycleAtId?: string;
  /** The nearest valid ancestor in case of a cycle */
  nearestValidAncestor?: string;
  /** Whether the chain exceeds max depth */
  exceedsMaxDepth: boolean;
}

/**
 * Walk the parent chain from a place up to cosmos (or until we hit a problem).
 */
function walkParentChain(
  startPlaceId: string,
  places: Map<string, Place>,
  rootPlaceId: string,
): ChainWalkResult {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = startPlaceId;
  let missingParentId: string | undefined;
  let cycleAtId: string | undefined;
  let nearestValidAncestor: string | undefined;

  for (;;) {
    // Check for cycle
    if (visited.has(currentId)) {
      cycleAtId = currentId;
      // Find the nearest valid ancestor (last place in chain before the cycle point)
      // Walk back through the chain to find a place that isn't part of the cycle
      // Start from i >= 1 to skip the starting place itself (chain[0]) - a place cannot be its own ancestor
      for (let i = chain.length - 1; i >= 1; i--) {
        const ancestorId = chain[i];
        if (ancestorId !== cycleAtId) {
          const ancestor = places.get(ancestorId);
          if (ancestor && ancestor.position.parent !== cycleAtId) {
            nearestValidAncestor = ancestorId;
            break;
          }
        }
      }
      break;
    }

    visited.add(currentId);
    chain.push(currentId);

    // Check depth
    if (chain.length > MAX_CHAIN_DEPTH) {
      return {
        chain,
        reachesCosmos: false,
        exceedsMaxDepth: true,
      };
    }

    // Check if we've reached cosmos
    if (currentId === rootPlaceId) {
      return {
        chain,
        reachesCosmos: true,
        exceedsMaxDepth: false,
      };
    }

    // Get the current place
    const currentPlace = places.get(currentId);
    if (!currentPlace) {
      // This shouldn't happen for the starting place, but could happen for parents
      if (currentId !== startPlaceId) {
        missingParentId = currentId;
      }
      break;
    }

    // Check if parent is null (only valid for cosmos)
    if (currentPlace.position.parent === null) {
      // Non-cosmos place with null parent - incomplete chain
      break;
    }

    // Check if parent exists
    const parentId = currentPlace.position.parent;
    if (!places.has(parentId) && parentId !== rootPlaceId) {
      missingParentId = parentId;
      break;
    }

    currentId = parentId;
  }

  return {
    chain,
    reachesCosmos: false,
    missingParentId,
    cycleAtId,
    nearestValidAncestor,
    exceedsMaxDepth: false,
  };
}

/**
 * Validate a place's parent chain.
 */
function validatePlaceParentChain(place: Place, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { id, label } = place;

  // Skip cosmos - it's the root
  if (id === ctx.rootPlaceId) {
    return [];
  }

  // Walk the parent chain
  const walkResult = walkParentChain(id, ctx.places, ctx.rootPlaceId);

  // Check for cycle
  if (walkResult.cycleAtId) {
    const issue: ValidationIssue = {
      entityId: id,
      entityType: 'place',
      validatorId: 'parent-chain',
      severity: 'error',
      field: 'position.parent',
      message: `Place "${label}" has a cycle in its parent chain at ${walkResult.cycleAtId}`,
    };

    // Only provide deterministic fix if we found a valid ancestor
    if (walkResult.nearestValidAncestor) {
      issue.suggestedFix = {
        field: 'position.parent',
        value: walkResult.nearestValidAncestor,
        confidence: 'high',
        method: 'deterministic',
      };
    } else {
      // No valid ancestor found - create clarification question asking user to specify parent
      logger.warn(
        'ParentChainValidator',
        `Cycle detected with no valid ancestor for place ${id} - requesting clarification (cycleAtId=${walkResult.cycleAtId})`,
      );

      // Build candidate parents: cosmos + any places NOT in the cycle
      const cycleIds = new Set(walkResult.chain);
      const candidateParents: Place[] = [];

      // Always include cosmos as an option
      const cosmos = ctx.places.get(ctx.rootPlaceId);
      if (cosmos) {
        candidateParents.push(cosmos);
      }

      // Add other places that aren't part of this cycle (limit to 10)
      let added = 0;
      for (const [placeId, candidate] of ctx.places) {
        if (!cycleIds.has(placeId) && placeId !== ctx.rootPlaceId && added < 10) {
          candidateParents.push(candidate);
          added++;
        }
      }

      issue.clarificationQuestion = createPlaceHierarchyQuestion(
        place,
        candidateParents,
        ctx.rootPlaceId, // Default guess is cosmos since there's no valid ancestor
      );
    }

    issues.push(issue);
    return issues; // Don't check other issues if there's a cycle
  }

  // Check for excessive depth
  if (walkResult.exceedsMaxDepth) {
    logger.error(
      'ParentChainValidator',
      `Place ${id} has excessive chain depth (>${MAX_CHAIN_DEPTH})`,
      {
        placeId: id,
        chainLength: walkResult.chain.length,
      },
    );

    issues.push({
      entityId: id,
      entityType: 'place',
      validatorId: 'parent-chain',
      severity: 'error',
      field: 'position.parent',
      message: `Place "${label}" has excessive chain depth (>${MAX_CHAIN_DEPTH} levels) - possible data corruption`,
      // No fix - requires manual review
    });
    return issues;
  }

  // Check for broken chain (missing parent)
  if (walkResult.missingParentId) {
    // Note: orphaned-refs validator catches immediate parent issues
    // This catches deeper breaks in the chain
    logger.error(
      'ParentChainValidator',
      `Place ${id} has broken parent chain - missing ${walkResult.missingParentId}`,
      {
        placeId: id,
        missingParentId: walkResult.missingParentId,
        chain: walkResult.chain,
      },
    );

    issues.push({
      entityId: id,
      entityType: 'place',
      validatorId: 'parent-chain',
      severity: 'error',
      field: 'position.parent',
      message: `Place "${label}" has broken parent chain - ancestor ${walkResult.missingParentId} does not exist`,
      suggestedFix: {
        field: 'position.parent',
        value: null, // Will be determined by LLM repair
        confidence: 'medium',
        method: 'llm',
      },
    });
    return issues;
  }

  // Check for incomplete chain (doesn't reach cosmos)
  if (!walkResult.reachesCosmos) {
    // Find where the chain ends
    const lastInChain = walkResult.chain[walkResult.chain.length - 1];
    const lastPlace = ctx.places.get(lastInChain);
    const terminationPoint =
      lastPlace?.position.parent === null
        ? `${lastInChain} (has null parent but is not cosmos)`
        : `${lastInChain} (unknown termination)`;

    logger.error(
      'ParentChainValidator',
      `Place ${id} has incomplete chain - does not reach cosmos`,
      {
        placeId: id,
        chain: walkResult.chain,
        terminationPoint,
      },
    );

    issues.push({
      entityId: id,
      entityType: 'place',
      validatorId: 'parent-chain',
      severity: 'error',
      field: 'position.parent',
      message: `Place "${label}" has incomplete parent chain - does not reach cosmos (ends at ${terminationPoint})`,
      suggestedFix: {
        field: 'position.parent',
        value: null, // Will be determined by LLM repair
        confidence: 'medium',
        method: 'llm',
      },
    });
  }

  return issues;
}

/**
 * Parent Chain Validator
 *
 * Validates that every place has a complete, valid parent chain to cosmos.
 */
export const parentChainValidator: Validator = {
  id: 'parent-chain',
  name: 'Parent Chain Validator',

  validate(entity: BaseEntity, ctx: ValidationContext): ValidationIssue[] {
    // Only validate places
    if (!entity.id.startsWith('PLACE_')) {
      return [];
    }

    if (!isPlace(entity)) return [];
    return validatePlaceParentChain(entity, ctx);
  },
};
