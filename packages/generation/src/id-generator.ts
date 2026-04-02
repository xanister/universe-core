import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { EntityType } from '@dmnpc/types/entity';

const MAX_ID_LENGTH = 60; // Total maximum length including prefix
const MAX_BASE_LENGTH = 50; // Maximum length for the base part (label-derived)

/**
 * Generates a base entity ID from a label (without checking for duplicates).
 * Useful for standalone generation where no universe is loaded.
 *
 * Format: {PREFIX}_{slugified_label}
 */
function generateEntityIdFromLabel(label: string, entityType: EntityType): string {
  const prefix = entityType === 'character' ? 'CHAR' : 'PLACE';

  // Convert label to a slug: lowercase, replace spaces/special chars with underscores
  let base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters except spaces
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores

  // If base is empty after processing (e.g., only special chars), use a fallback
  if (!base) {
    base = 'entity';
  }

  // Truncate if too long, but try to preserve word boundaries
  if (base.length > MAX_BASE_LENGTH) {
    const truncated = base.substring(0, MAX_BASE_LENGTH);
    const lastUnderscore = truncated.lastIndexOf('_');
    if (lastUnderscore > MAX_BASE_LENGTH - 10) {
      base = truncated.substring(0, lastUnderscore);
    } else {
      base = truncated;
    }
  }

  let candidateId = `${prefix}_${base}`;

  // Ensure candidate doesn't exceed max length
  if (candidateId.length > MAX_ID_LENGTH) {
    const maxBaseLength = MAX_ID_LENGTH - prefix.length - 1;
    base = base.substring(0, maxBaseLength);
    candidateId = `${prefix}_${base}`;
  }

  return candidateId;
}

/**
 * Generates a unique entity ID from a label, ensuring no duplicates in the provided set.
 * Standalone version that doesn't require a loaded universe.
 */
function generateEntityIdWithExistingIds(
  label: string,
  entityType: EntityType,
  existingIds: Set<string>,
): string {
  let candidateId = generateEntityIdFromLabel(label, entityType);

  if (!existingIds.has(candidateId)) {
    return candidateId;
  }

  // If duplicate, append a number and increment until unique
  let counter = 1;
  let numberedId = `${candidateId}_${counter}`;

  while (existingIds.has(numberedId) || numberedId.length > MAX_ID_LENGTH) {
    counter++;
    if (numberedId.length > MAX_ID_LENGTH) {
      const suffixLength = `_${counter}`.length;
      candidateId = candidateId.substring(0, MAX_ID_LENGTH - suffixLength);
    }
    numberedId = `${candidateId}_${counter}`;

    if (counter > 9999) {
      throw new Error(`Unable to generate unique ID for ${label} after many attempts`);
    }
  }

  return numberedId;
}

/**
 * Generates a unique entity ID based on the label, ensuring no duplicates exist
 * in the universe and keeping IDs reasonably short.
 *
 * Format: {PREFIX}_{slugified_label} or {PREFIX}_{slugified_label}_{number} if duplicate
 *
 * @param ctx - Universe context
 * @param label - The entity label (e.g., "John Smith", "The Crossed Cask")
 * @param entityType - The type of entity ('character' or 'place')
 * @returns A unique ID string
 */
export function generateEntityId(
  ctx: UniverseContext,
  label: string,
  entityType: EntityType,
): string {
  const existingEntities = entityType === 'character' ? ctx.characters : ctx.places;

  // Get all existing IDs for this entity type
  const existingIds = new Set(existingEntities.map((e) => e.id));

  return generateEntityIdWithExistingIds(label, entityType, existingIds);
}
