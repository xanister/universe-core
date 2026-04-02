/**
 * Storyteller Definitions
 *
 * Pure definition-loading functions for storyteller data.
 * Extracted to break circular dependencies between storyteller-store and generation-context.
 */

import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { StorytellerDefinition } from '@dmnpc/types/npc';
import { STORYTELLERS_DIR } from '@dmnpc/data';
import { readJsonFile } from '../infra/read-json-file.js';

/**
 * Load all storyteller definitions from the storytellers/definitions directory.
 * Skips individual corrupted files to allow loading remaining valid definitions.
 */
export async function listStorytellers(): Promise<StorytellerDefinition[]> {
  if (!existsSync(STORYTELLERS_DIR)) {
    // No storytellers directory = no storytellers defined (not an error)
    return [];
  }

  const files = await readdir(STORYTELLERS_DIR);
  const storytellers: StorytellerDefinition[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const filePath = join(STORYTELLERS_DIR, file);
      const storyteller = await readJsonFile<StorytellerDefinition>(filePath);

      // Validate required fields
      if (storyteller.id && storyteller.label) {
        storytellers.push(storyteller);
      }
    } catch {
      // Skip corrupted files - allows loading remaining valid definitions
      continue;
    }
  }

  return storytellers;
}

/**
 * Get a specific storyteller definition by ID.
 * Returns null if storyteller doesn't exist, throws on read/parse errors.
 */
export async function getStoryteller(storytellerId: string): Promise<StorytellerDefinition | null> {
  const filePath = join(STORYTELLERS_DIR, `${storytellerId}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  return await readJsonFile<StorytellerDefinition>(filePath);
}
