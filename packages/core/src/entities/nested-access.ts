import { isRecord } from './type-guards.js';

/**
 * Get a nested value from an object using dot notation.
 * Returns undefined if any intermediate path segment is not a record.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Set a nested value in an object using dot notation.
 * Creates intermediate objects as needed.
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      current[part] = {};
    }
    if (!isRecord(current[part])) {
      throw new Error(`Cannot traverse non-object at path segment "${part}" in "${path}"`);
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Delete a nested field from an object using dot notation.
 * No-ops if any intermediate path segment doesn't exist or isn't a record.
 */
export function deleteNestedField(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isRecord(current[part])) {
      return;
    }
    current = current[part];
  }

  const lastPart = parts[parts.length - 1];
  delete current[lastPart];
}
