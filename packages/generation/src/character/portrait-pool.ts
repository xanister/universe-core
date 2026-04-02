/**
 * Portrait Pool
 *
 * Manages per-universe portrait pools for disposable character types.
 * Characters with purposes that have `portraitPoolSize > 0` share portraits
 * from a pool instead of generating a unique portrait each time.
 *
 * Lazy-fill strategy: first N characters generate normally and populate the pool.
 * Once the pool reaches the target size, subsequent characters draw randomly.
 *
 * Pool manifest: `{universeDir}/portrait-pool.json`
 * Pool S3 paths: `universes/{universeId}/images/portrait-pool/{purposeId}/{index}.png`
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { UNIVERSES_DIR } from '@dmnpc/data';
import { pickRandomElement } from '@dmnpc/core/infra/random-utils.js';
import { readJsonFile } from '@dmnpc/core/infra/read-json-file.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';

/** A single portrait entry in the pool. */
export interface PoolPortrait {
  /** Public URL (CDN or S3) of the portrait image */
  url: string;
  /** Normalized Y position (0.0=top, 1.0=bottom) for avatar cropping */
  faceAnchorY: number;
}

/** Full portrait pool manifest for a universe. */
export interface PortraitPoolManifest {
  [purposeId: string]: PoolPortrait[];
}

function getManifestPath(universeId: string): string {
  return join(UNIVERSES_DIR, universeId, 'portrait-pool.json');
}

function getPoolS3Key(universeId: string, purposeId: string, index: number): string {
  return `universes/${universeId}/images/portrait-pool/${purposeId}/${index}.png`;
}

/**
 * Load the portrait pool manifest for a universe.
 * Returns empty object if the file doesn't exist.
 */
export async function loadPortraitPool(universeId: string): Promise<PortraitPoolManifest> {
  const filePath = getManifestPath(universeId);
  if (!existsSync(filePath)) return {};

  return readJsonFile<PortraitPoolManifest>(filePath);
}

/**
 * Save the portrait pool manifest for a universe.
 */
async function savePortraitPool(universeId: string, manifest: PortraitPoolManifest): Promise<void> {
  const filePath = getManifestPath(universeId);
  await writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Pick a random portrait from the pool for a given purpose.
 * Returns null if the pool is empty or doesn't exist for this purpose.
 */
export function pickFromPool(
  manifest: PortraitPoolManifest,
  purposeId: string,
): PoolPortrait | null {
  const entries = manifest[purposeId] as PoolPortrait[] | undefined;
  if (!entries || entries.length === 0) return null;
  return pickRandomElement(entries);
}

/**
 * Check whether the pool for a purpose is full (reached target size).
 */
export function isPoolFull(
  manifest: PortraitPoolManifest,
  purposeId: string,
  targetSize: number,
): boolean {
  const entries = manifest[purposeId] as PoolPortrait[] | undefined;
  return (entries?.length ?? 0) >= targetSize;
}

/**
 * Add a portrait to the pool for a purpose.
 * Uploads the image to the pool S3 path and updates the manifest.
 *
 * @returns The pool portrait entry (with CDN URL), or null if pool is already full.
 */
export async function addToPool(
  universeId: string,
  purposeId: string,
  targetSize: number,
  imageBuffer: Buffer,
  faceAnchorY: number,
): Promise<PoolPortrait | null> {
  const manifest = await loadPortraitPool(universeId);
  const entries = manifest[purposeId] ?? [];

  if (entries.length >= targetSize) {
    return null;
  }

  const index = entries.length;
  const s3Key = getPoolS3Key(universeId, purposeId, index);
  const url = await storageService.uploadFile(s3Key, imageBuffer, 'image/png');

  const portrait: PoolPortrait = { url, faceAnchorY };
  entries.push(portrait);
  manifest[purposeId] = entries;

  await savePortraitPool(universeId, manifest);

  logger.info(
    'Portrait Pool',
    `Added portrait to pool: universe=${universeId} purpose=${purposeId} index=${index}/${targetSize}`,
  );

  return portrait;
}

/**
 * Try to assign a portrait from the pool to a disposable character.
 * If the pool is full, picks a random portrait. If not, returns null
 * (caller should generate normally and then call addToPool).
 *
 * @returns A pool portrait if available, or null if pool needs filling.
 */
export async function tryAssignFromPool(
  universeId: string,
  purposeId: string,
  targetSize: number,
): Promise<PoolPortrait | null> {
  const manifest = await loadPortraitPool(universeId);

  if (!isPoolFull(manifest, purposeId, targetSize)) {
    return null;
  }

  const portrait = pickFromPool(manifest, purposeId);
  if (portrait) {
    logger.info(
      'Portrait Pool',
      `Assigned portrait from pool: universe=${universeId} purpose=${purposeId}`,
    );
  }
  return portrait;
}
