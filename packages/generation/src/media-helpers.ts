/**
 * Media Helpers
 *
 * Utilities for working with universe audio files.
 * The media.json file in each universe contains metadata about audio tracks.
 *
 * Note: The tag-based music matching system (getPlaceMusicUrl) has been replaced
 * by the situational ambient audio system in audio-generator.ts.
 * The media.json structure is preserved for future storyteller song triggers.
 */

import { UNIVERSES_DIR } from '@dmnpc/data';
import { logger } from '@dmnpc/core/infra/logger.js';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { readJsonFile } from '@dmnpc/core/infra/read-json-file.js';
import { existsSync } from 'fs';

/**
 * Audio entry structure in media.json.
 */
export interface MediaEntry {
  id?: string;
  entityType: string;
  mediaType: string;
  extension: string;
  filename: string;
  url: string;
  size?: number;
  tags?: string[];
  entityName?: string;
  description?: string;
  prompt?: string | null;
  name?: string;
}

/**
 * Media data structure from media.json.
 */
export interface MediaData {
  universeId: string;
  media: MediaEntry[];
}

/**
 * Get the path to a universe's media.json file.
 */
export function getMediaFilePath(universeId: string): string {
  return join(UNIVERSES_DIR, universeId, 'media.json');
}

/**
 * Load media data from a universe's media.json file.
 * Returns empty media array if file doesn't exist.
 * Throws on read/parse errors (file exists but is corrupt).
 */
export async function loadMediaData(universeId: string): Promise<MediaData> {
  const filePath = getMediaFilePath(universeId);

  // File not existing is expected - return empty array
  if (!existsSync(filePath)) {
    return { universeId, media: [] };
  }

  // File exists - read and parse errors should propagate
  try {
    const parsed = await readJsonFile<{ media?: MediaEntry[] }>(filePath);
    return {
      universeId,
      media: Array.isArray(parsed.media) ? parsed.media : [],
    };
  } catch (error) {
    logger.error('Media Helpers', `Failed to load/parse media.json`, {
      universeId,
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get all audio entries from a universe's media.json.
 * Useful for future storyteller song triggers.
 */
export async function getAudioEntries(universeId: string): Promise<MediaEntry[]> {
  const mediaData = await loadMediaData(universeId);
  return mediaData.media.filter((m) => m.mediaType === 'audio');
}

/**
 * Delete a media file if it exists.
 * Logs the deletion and silently handles missing files.
 *
 * @param filePath - Absolute path to the file to delete
 * @returns true if file was deleted, false if it didn't exist or deletion failed
 */
export async function deleteMediaFile(filePath: string): Promise<boolean> {
  try {
    if (!existsSync(filePath)) return false;
    await unlink(filePath);
    logger.info('Media Helpers', `Deleted media file: ${filePath}`);
    return true;
  } catch (error) {
    logger.warn(
      'Media Helpers',
      `Failed to delete media file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Register a new media entry in a universe's media.json.
 * If an entry with the same URL already exists, it will be updated.
 *
 * @param universeId - The universe to register the entry in
 * @param entry - The media entry to register
 */
export async function registerMediaEntry(universeId: string, entry: MediaEntry): Promise<void> {
  const filePath = getMediaFilePath(universeId);

  try {
    // Load existing media data
    const mediaData = await loadMediaData(universeId);

    // Check for existing entry with same URL (update instead of duplicate)
    const existingIndex = mediaData.media.findIndex((m) => m.url === entry.url);

    if (existingIndex >= 0) {
      // Update existing entry
      mediaData.media[existingIndex] = entry;
      logger.info('Media Helpers', `Updated media entry: ${entry.url}`);
    } else {
      // Add new entry
      mediaData.media.push(entry);
      logger.info('Media Helpers', `Registered new media entry: ${entry.url}`);
    }

    // Write back to file
    await writeFile(filePath, JSON.stringify({ media: mediaData.media }, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Media Helpers', 'Failed to register media entry', {
      universeId,
      url: entry.url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
