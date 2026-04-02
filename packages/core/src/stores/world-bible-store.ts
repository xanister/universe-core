/**
 * WorldBible Store
 *
 * Service for persisting and loading WorldBible data for universes.
 * The WorldBible is stored as world-bible.json in the universe directory.
 */

import { writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../infra/logger.js';
import type { WorldBible } from '@dmnpc/types/world';
import { UNIVERSES_DIR } from '@dmnpc/data';
import { readJsonFile } from '../infra/read-json-file.js';

/**
 * Get the path to the WorldBible file for a universe.
 */
function getWorldBiblePath(universeId: string): string {
  return join(UNIVERSES_DIR, universeId, 'world-bible.json');
}

/**
 * Save a WorldBible to the universe's directory.
 *
 * @param universeId - The universe ID
 * @param worldBible - The WorldBible to save
 */
export async function saveWorldBible(universeId: string, worldBible: WorldBible): Promise<void> {
  const filePath = getWorldBiblePath(universeId);

  try {
    await writeFile(filePath, JSON.stringify(worldBible, null, 2) + '\n', 'utf-8');
    logger.info(
      'WorldBibleStore',
      `Saved WorldBible: universeId=${universeId} themes=${worldBible.themes.length} characters=${worldBible.characters.length} places=${worldBible.places.length}`,
    );
  } catch (error) {
    logger.error('WorldBibleStore', `Failed to save WorldBible for ${universeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Load a WorldBible from the universe's directory.
 * Returns null if no WorldBible exists.
 *
 * @param universeId - The universe ID
 * @returns The WorldBible or null if not found
 */
export async function loadWorldBible(universeId: string): Promise<WorldBible | null> {
  const filePath = getWorldBiblePath(universeId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const worldBible = await readJsonFile<WorldBible>(filePath);

    logger.info(
      'WorldBibleStore',
      `Loaded WorldBible: universeId=${universeId} themes=${worldBible.themes.length} characters=${worldBible.characters.length}`,
    );

    return worldBible;
  } catch (error) {
    logger.error('WorldBibleStore', `Failed to load WorldBible for ${universeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Delete a WorldBible from the universe's directory.
 * Does nothing if the WorldBible doesn't exist.
 *
 * @param universeId - The universe ID
 * @returns true if deleted, false if file didn't exist
 */
export async function deleteWorldBible(universeId: string): Promise<boolean> {
  const filePath = getWorldBiblePath(universeId);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    await unlink(filePath);
    logger.info('WorldBibleStore', `Deleted WorldBible: universeId=${universeId}`);
    return true;
  } catch (error) {
    logger.error('WorldBibleStore', `Failed to delete WorldBible for ${universeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Check if a WorldBible exists for a universe.
 *
 * @param universeId - The universe ID
 * @returns true if WorldBible exists
 */
export function hasWorldBible(universeId: string): boolean {
  const filePath = getWorldBiblePath(universeId);
  return existsSync(filePath);
}
