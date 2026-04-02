/**
 * Typed JSON file reader.
 *
 * Wraps readFile + JSON.parse with clear error messages that include
 * the file path. No runtime validation — the caller's type assertion
 * is trusted (self-authored data, "trust the contract").
 */

import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';

/**
 * Read and parse a JSON file, returning the result typed as `T`.
 *
 * @param filePath - Absolute path to the JSON file
 * @returns Parsed JSON content typed as T
 * @throws Error with file path context on read or parse failure
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read JSON file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- readJsonFile<T> trusts the caller's type parameter for self-authored JSON data; no runtime validation by design
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Synchronous variant — read and parse a JSON file, returning the result typed as `T`.
 *
 * Prefer the async `readJsonFile` where possible. Use this when callers
 * require synchronous loading (e.g. cached module-level loaders).
 *
 * @param filePath - Absolute path to the JSON file
 * @returns Parsed JSON content typed as T
 * @throws Error with file path context on read or parse failure
 */
export function readJsonFileSync<T>(filePath: string): T {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read JSON file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- readJsonFileSync<T> trusts the caller's type parameter for self-authored JSON data; no runtime validation by design
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
