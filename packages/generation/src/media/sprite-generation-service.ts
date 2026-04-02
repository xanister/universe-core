/**
 * Sprite Generation Service
 *
 * Generates LPC composite spritesheets and uploads them to S3.
 * Uses hash-based caching so identical layer configs share the same sprite.
 */

import { LPC_SPRITES_DIR } from '@dmnpc/data';
import {
  loadLPCManifest,
  generateCompositeSprite,
  computeLayerConfigHash,
  type LayerConfig,
} from '@dmnpc/sprites';
import { uploadFile, exists, getPublicUrl } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';

/** S3 key prefix for generated spritesheets */
const SPRITE_KEY_PREFIX = 'sprites/generated';

/** Initialize the LPC manifest on module load */
let manifestLoaded = false;

function ensureManifestLoaded(): void {
  if (!manifestLoaded) {
    loadLPCManifest(LPC_SPRITES_DIR);
    manifestLoaded = true;
    logger.info('SpriteService', `Loaded LPC manifest from ${LPC_SPRITES_DIR}`);
  }
}

/**
 * Get the S3 key for a sprite based on its config hash.
 */
function getSpriteKey(hash: string): string {
  return `${SPRITE_KEY_PREFIX}/${hash}.png`;
}

/**
 * Generate or retrieve a composite sprite from S3.
 *
 * @param layers - Layer configurations for the sprite
 * @returns Object containing the S3 URL, hash, and whether it was newly generated
 */
export async function getOrGenerateSprite(layers: LayerConfig[]): Promise<{
  url: string;
  hash: string;
  generated: boolean;
}> {
  ensureManifestLoaded();

  // Compute hash of the layer configuration
  const hash = computeLayerConfigHash(layers);
  const s3Key = getSpriteKey(hash);

  // Check if sprite already exists in S3
  const spriteExists = await exists(s3Key);
  if (spriteExists) {
    logger.debug('SpriteService', `Cache hit for sprite hash=${hash}`);
    return {
      url: getPublicUrl(s3Key),
      hash,
      generated: false,
    };
  }

  // Generate the composite sprite
  logger.info('SpriteService', `Generating sprite hash=${hash} layers=${layers.length}`);
  const startTime = Date.now();

  const spriteData = await generateCompositeSprite(layers);

  const generationTime = Date.now() - startTime;
  logger.info(
    'SpriteService',
    `Generated sprite in ${generationTime}ms size=${spriteData.image.length} bytes`,
  );

  // Upload to S3
  const url = await uploadFile(s3Key, spriteData.image, 'image/png');

  logger.info('SpriteService', `Uploaded sprite hash=${hash} url=${url}`);

  return {
    url,
    hash,
    generated: true,
  };
}
