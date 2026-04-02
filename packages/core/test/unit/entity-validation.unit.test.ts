import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { BaseEntity } from '@dmnpc/types/entity';

// This test validates production universe data. Skip when TEST_UNIVERSES_DIR is set.
const SKIP_PRODUCTION_VALIDATION = !!process.env.TEST_UNIVERSES_DIR;
const UNIVERSES_DIR = join(process.cwd(), 'universes', 'definitions');
const FARSREACH_CHARS_DIR = join(UNIVERSES_DIR, 'farsreach', 'entities', 'characters');
const FARSREACH_PLACES_DIR = join(UNIVERSES_DIR, 'farsreach', 'entities', 'places');

interface ValidationError {
  entityId: string;
  entityLabel: string;
  missingFields: string[];
  invalidFields: Array<{ field: string; reason: string }>;
}

/**
 * Validates that a BaseEntity has all required fields
 */
function validateBaseEntity(
  entity: unknown,
  entityType: 'character' | 'place'
): ValidationError | null {
  const errors: ValidationError = {
    entityId: 'unknown',
    entityLabel: 'unknown',
    missingFields: [],
    invalidFields: [],
  };

  if (!entity || typeof entity !== 'object') {
    errors.missingFields.push('entity (entity is null or not an object)');
    return errors;
  }

  const e = entity as Record<string, unknown>;

  // Required fields from BaseEntity
  const requiredFields = ['id', 'label', 'description', 'tags', 'entityType', 'info'];

  for (const field of requiredFields) {
    if (!(field in e)) {
      errors.missingFields.push(field);
    }
  }

  // Set entityId and entityLabel for error reporting
  if (e.id && typeof e.id === 'string') {
    errors.entityId = e.id;
  }
  if (e.label && typeof e.label === 'string') {
    errors.entityLabel = e.label;
  }

  // Validate field types
  if (e.id && typeof e.id !== 'string') {
    errors.invalidFields.push({ field: 'id', reason: 'must be a string' });
  }
  if (e.label && typeof e.label !== 'string') {
    errors.invalidFields.push({ field: 'label', reason: 'must be a string' });
  }
  if (e.description && typeof e.description !== 'string') {
    errors.invalidFields.push({ field: 'description', reason: 'must be a string' });
  }
  if (e.tags && !Array.isArray(e.tags)) {
    errors.invalidFields.push({ field: 'tags', reason: 'must be an array' });
  } else if (e.tags && Array.isArray(e.tags)) {
    // Validate all tags are strings
    const nonStringTags = e.tags.filter((tag) => typeof tag !== 'string');
    if (nonStringTags.length > 0) {
      errors.invalidFields.push({ field: 'tags', reason: 'all tags must be strings' });
    }
  }
  if (e.entityType && typeof e.entityType !== 'string') {
    errors.invalidFields.push({ field: 'entityType', reason: 'must be a string' });
  } else if (e.entityType && e.entityType !== entityType) {
    errors.invalidFields.push({
      field: 'entityType',
      reason: `must be "${entityType}" but got "${e.entityType}"`,
    });
  }
  if ((e.info && typeof e.info !== 'object') || e.info === null) {
    errors.invalidFields.push({ field: 'info', reason: 'must be an object' });
  }

  // Validate description is not empty
  if (e.description && typeof e.description === 'string' && e.description.trim().length === 0) {
    errors.invalidFields.push({ field: 'description', reason: 'must not be empty' });
  }

  // Return null if no errors, otherwise return the errors
  if (errors.missingFields.length === 0 && errors.invalidFields.length === 0) {
    return null;
  }

  return errors;
}

describe.skipIf(SKIP_PRODUCTION_VALIDATION)('Entity Validation', () => {
  describe('Character Validation', () => {
    it.skipIf(!existsSync(FARSREACH_CHARS_DIR))('validates all characters have required fields', async () => {
      const files = await readdir(FARSREACH_CHARS_DIR);
      const errors: ValidationError[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const filePath = join(FARSREACH_CHARS_DIR, file);
          const content = await readFile(filePath, 'utf-8');
          const raw: unknown = JSON.parse(content);

          const error = validateBaseEntity(raw, 'character');
          if (error) {
            errors.push(error);
          }
        } catch {
          // Skip invalid files
          continue;
        }
      }

      if (errors.length > 0) {
        const errorMessages = errors.map((err) => {
          const parts = [
            `Character "${err.entityLabel}" (${err.entityId}):`,
            ...err.missingFields.map((f) => `  - Missing: ${f}`),
            ...err.invalidFields.map((f) => `  - Invalid ${f.field}: ${f.reason}`),
          ];
          return parts.join('\n');
        });
        throw new Error(
          `Found ${errors.length} character(s) with validation errors:\n\n${errorMessages.join('\n\n')}`
        );
      }

      expect(errors.length).toBe(0);
    });
  });

  describe('Place Validation', () => {
    it.skipIf(!existsSync(FARSREACH_PLACES_DIR))('validates all places have required fields', async () => {
      const files = await readdir(FARSREACH_PLACES_DIR);
      const errors: ValidationError[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const filePath = join(FARSREACH_PLACES_DIR, file);
          const content = await readFile(filePath, 'utf-8');
          const raw: unknown = JSON.parse(content);

          const error = validateBaseEntity(raw, 'place');
          if (error) {
            errors.push(error);
          }
        } catch {
          // Skip invalid files
          continue;
        }
      }

      if (errors.length > 0) {
        const errorMessages = errors.map((err) => {
          const parts = [
            `Place "${err.entityLabel}" (${err.entityId}):`,
            ...err.missingFields.map((f) => `  - Missing: ${f}`),
            ...err.invalidFields.map((f) => `  - Invalid ${f.field}: ${f.reason}`),
          ];
          return parts.join('\n');
        });
        throw new Error(
          `Found ${errors.length} place(s) with validation errors:\n\n${errorMessages.join('\n\n')}`
        );
      }

      expect(errors.length).toBe(0);
    });
  });
});
