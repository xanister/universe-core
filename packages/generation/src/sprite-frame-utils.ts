/**
 * Sprite Frame Utilities
 *
 * Extracts a single frame from an LPC composite spritesheet for use as
 * a reference image in portrait generation (Option B).
 */

import sharp from 'sharp';

/** LPC frame dimensions */
const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 64;
/** Walk animation, down direction, row index */
const WALK_DOWN_ROW = 10;
/** Output size for GPT Image edit API compatibility */
const OUTPUT_SIZE = 512;

/**
 * Extract the idle-down frame from an LPC spritesheet and upscale for API use.
 * LPC layout: walk animation starts at row 8; down is direction index 2 → row 10.
 *
 * @param spriteBuffer - Full LPC composite spritesheet PNG buffer (832×1344)
 * @returns 512×512 PNG buffer suitable for editImage
 */
export async function extractSpriteFrameForPortrait(spriteBuffer: Buffer): Promise<Buffer> {
  const frameX = 0;
  const frameY = WALK_DOWN_ROW * FRAME_HEIGHT;

  return sharp(spriteBuffer)
    .extract({
      left: frameX,
      top: frameY,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
}
