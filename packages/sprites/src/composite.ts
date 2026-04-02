/**
 * Composite Sprite Generator (Node.js)
 *
 * Generates composite spritesheets from multiple LPC layers.
 * Uses node-canvas for server-side rendering.
 */

import { createCanvas, loadImage, type Canvas, type Image } from 'canvas';
import { createHash } from 'crypto';
import type {
  LayerConfig,
  LPCLayerType,
  FacingDirection,
  AnimationState,
  GenerateOptions,
  CompositeSpriteData,
} from './types.js';
import { getLayerZIndex, getLayerOrder } from './lpc-assets.js';

/**
 * Standard LPC animation definitions.
 */
const LPC_ANIMATIONS: {
  [key: string]: { startRow: number; frames: number; singleDirection?: boolean } | undefined;
} = {
  spellcast: { startRow: 0, frames: 7 },
  thrust: { startRow: 4, frames: 8 },
  walk: { startRow: 8, frames: 9 },
  slash: { startRow: 12, frames: 6 },
  shoot: { startRow: 16, frames: 13 },
  hurt: { startRow: 20, frames: 6, singleDirection: true },
};

/**
 * Direction order in LPC spritesheets.
 */
const LPC_DIRECTIONS: FacingDirection[] = ['up', 'left', 'down', 'right'];

/**
 * All standard animations including aliases.
 */
const ALL_ANIMATIONS: AnimationState[] = [
  'idle',
  'walk',
  'slash',
  'thrust',
  'spellcast',
  'shoot',
  'hurt',
  'attack',
  'cast',
];

interface LoadedLayer {
  image: Image;
  type: LPCLayerType;
  zIndex: number;
  colorize?: LayerConfig['colorize'];
}

/**
 * Compute a hash of layer configurations for caching.
 * Identical configurations will produce the same hash.
 */
export function computeLayerConfigHash(layers: LayerConfig[]): string {
  const sortedLayers = [...layers].sort((a, b) => a.type.localeCompare(b.type));

  const configString = sortedLayers
    .map((layer) => {
      const parts = [layer.type, layer.imageUrl];
      if (layer.zIndex !== undefined) parts.push(`z:${layer.zIndex}`);
      if (layer.visible === false) parts.push('hidden');
      if (layer.colorize) {
        if (layer.colorize.type === 'tint') {
          parts.push(`tint:${layer.colorize.color.toString(16)}`);
          if (layer.colorize.tintMode) parts.push(`tintMode:${layer.colorize.tintMode}`);
          if (layer.colorize.threshold !== undefined)
            parts.push(`threshold:${layer.colorize.threshold}`);
        } else {
          const paletteStr = Object.entries(layer.colorize.colorMap)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
          parts.push(`palette:${paletteStr}`);
        }
      }
      return parts.join('|');
    })
    .join('::');

  return createHash('sha256').update(configString).digest('hex').substring(0, 16);
}

/**
 * Get direction-aware z-index for a layer.
 */
function getDirectionAwareZIndex(
  layerType: LPCLayerType,
  baseZIndex: number,
  direction: FacingDirection,
): number {
  if (direction === 'up' && layerType === 'behind_body') {
    return getLayerOrder().length + 1;
  }
  return baseZIndex;
}

/**
 * Get effective direction for a layer's texture.
 */
function getEffectiveDirection(
  layerType: LPCLayerType,
  direction: FacingDirection,
): FacingDirection {
  if (layerType === 'behind_body' && direction === 'up') {
    return 'down';
  }
  return direction;
}

/**
 * Load all layer images from file paths.
 */
async function loadLayers(layers: LayerConfig[]): Promise<LoadedLayer[]> {
  const loadedLayers: LoadedLayer[] = [];

  await Promise.all(
    layers.map(async (layer) => {
      if (layer.visible === false) return;

      try {
        const image = await loadImage(layer.imageUrl);
        const baseZIndex = layer.zIndex ?? getLayerZIndex(layer.type);

        loadedLayers.push({
          image,
          type: layer.type,
          zIndex: baseZIndex,
          colorize: layer.colorize,
        });
      } catch (error) {
        // Log but continue - allows partial sprites if some layers fail
        console.warn(`Failed to load layer ${layer.type} from ${layer.imageUrl}:`, error);
      }
    }),
  );

  return loadedLayers;
}

/**
 * Apply tint colorization to canvas image data.
 *
 * @param mode - 'multiply' (default): output = base * tint / 255. Best for fabric, cloth, skin.
 *               'overlay': preserves specular highlights for metallic items. (Future use.)
 * @param threshold - When set, pixels with max(R,G,B) >= threshold are skipped (pass through
 *                    untinted). Used for eye sprites where the sclera must stay white.
 */
function applyTint(
  ctx: ReturnType<Canvas['getContext']>,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  mode: 'multiply' | 'overlay' = 'multiply',
  threshold?: number,
): void {
  const imageData = ctx.getImageData(x, y, width, height);
  const data = imageData.data;

  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  if (mode === 'overlay') {
    for (let i = 0; i < data.length; i += 4) {
      if (threshold !== undefined && Math.max(data[i], data[i + 1], data[i + 2]) >= threshold)
        continue;
      data[i] =
        data[i] < 128 ? (2 * data[i] * r) / 255 : 255 - (2 * (255 - data[i]) * (255 - r)) / 255;
      data[i + 1] =
        data[i + 1] < 128
          ? (2 * data[i + 1] * g) / 255
          : 255 - (2 * (255 - data[i + 1]) * (255 - g)) / 255;
      data[i + 2] =
        data[i + 2] < 128
          ? (2 * data[i + 2] * b) / 255
          : 255 - (2 * (255 - data[i + 2]) * (255 - b)) / 255;
    }
  } else {
    for (let i = 0; i < data.length; i += 4) {
      if (threshold !== undefined && Math.max(data[i], data[i + 1], data[i + 2]) >= threshold)
        continue;
      data[i] = (data[i] * r) / 255;
      data[i + 1] = (data[i + 1] * g) / 255;
      data[i + 2] = (data[i + 2] * b) / 255;
    }
  }

  ctx.putImageData(imageData, x, y);
}

/**
 * Get frame coordinates for a specific animation, direction, and frame.
 */
function getFrameCoords(
  animation: string,
  direction: FacingDirection,
  frameNum: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } | null {
  // Handle aliases
  let baseAnim = animation;
  if (animation === 'idle') baseAnim = 'walk';
  if (animation === 'attack') baseAnim = 'slash';
  if (animation === 'cast') baseAnim = 'spellcast';

  const animDef = LPC_ANIMATIONS[baseAnim];
  if (!animDef) return null;

  const dirIndex = LPC_DIRECTIONS.indexOf(direction);
  if (dirIndex === -1) return null;

  const actualFrame = animation === 'idle' ? 0 : frameNum;
  if (actualFrame >= animDef.frames) return null;

  const row = animDef.singleDirection ? animDef.startRow : animDef.startRow + dirIndex;

  return {
    x: actualFrame * frameWidth,
    y: row * frameHeight,
  };
}

/**
 * Get the number of frames for an animation.
 */
function getFrameCount(animation: string): number {
  if (animation === 'idle') return 1;
  if (animation === 'attack') return LPC_ANIMATIONS['slash']!.frames;
  if (animation === 'cast') return LPC_ANIMATIONS['spellcast']!.frames;

  const animDef = LPC_ANIMATIONS[animation];
  return animDef?.frames ?? 0;
}

/**
 * Generate a composite sprite from multiple layer configurations.
 *
 * @param layers - Layer configurations with file paths to source images
 * @param options - Generation options
 * @returns Sprite data including PNG buffer and animation metadata
 */
export async function generateCompositeSprite(
  layers: LayerConfig[],
  options: GenerateOptions = {},
): Promise<CompositeSpriteData> {
  const {
    animations = ALL_ANIMATIONS,
    directions = LPC_DIRECTIONS,
    frameWidth = 64,
    frameHeight = 64,
  } = options;

  const loadedLayers = await loadLayers(layers);

  if (loadedLayers.length === 0) {
    throw new Error('No layers loaded successfully');
  }

  // LPC spritesheet: 832x1344
  const outputWidth = 13 * frameWidth;
  const outputHeight = 21 * frameHeight;

  const canvas = createCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, outputWidth, outputHeight);

  // Separate temp canvas for tinted layers avoids tinting previously drawn layers
  const tempCanvas = createCanvas(frameWidth, frameHeight);
  const tempCtx = tempCanvas.getContext('2d');

  for (const animation of animations) {
    const frameCount = getFrameCount(animation);

    for (const direction of directions) {
      for (let frameNum = 0; frameNum < frameCount; frameNum++) {
        const destCoords = getFrameCoords(animation, direction, frameNum, frameWidth, frameHeight);
        if (!destCoords) continue;

        const sortedLayers = [...loadedLayers].sort((a, b) => {
          const aZ = getDirectionAwareZIndex(a.type, a.zIndex, direction);
          const bZ = getDirectionAwareZIndex(b.type, b.zIndex, direction);
          return aZ - bZ;
        });

        for (const layer of sortedLayers) {
          const effectiveDir = getEffectiveDirection(layer.type, direction);
          const srcCoords = getFrameCoords(
            animation,
            effectiveDir,
            frameNum,
            frameWidth,
            frameHeight,
          );
          if (!srcCoords) continue;

          if (layer.colorize?.type === 'tint') {
            tempCtx.clearRect(0, 0, frameWidth, frameHeight);
            tempCtx.drawImage(
              layer.image,
              srcCoords.x,
              srcCoords.y,
              frameWidth,
              frameHeight,
              0,
              0,
              frameWidth,
              frameHeight,
            );
            applyTint(
              tempCtx,
              0,
              0,
              frameWidth,
              frameHeight,
              layer.colorize.color,
              layer.colorize.tintMode,
              layer.colorize.threshold,
            );
            ctx.drawImage(
              tempCanvas,
              0,
              0,
              frameWidth,
              frameHeight,
              destCoords.x,
              destCoords.y,
              frameWidth,
              frameHeight,
            );
          } else {
            ctx.drawImage(
              layer.image,
              srcCoords.x,
              srcCoords.y,
              frameWidth,
              frameHeight,
              destCoords.x,
              destCoords.y,
              frameWidth,
              frameHeight,
            );
          }
        }
      }
    }
  }

  const frames: Record<
    string,
    { frame: { x: number; y: number; w: number; h: number }; index: number }
  > = {};
  const animationSequences: Record<string, string[]> = {};
  let frameIndex = 0;

  for (const animation of animations) {
    const frameCount = getFrameCount(animation);

    for (const direction of directions) {
      const animKey = `${animation}_${direction}`;
      const frameNames: string[] = [];

      for (let frameNum = 0; frameNum < frameCount; frameNum++) {
        const coords = getFrameCoords(animation, direction, frameNum, frameWidth, frameHeight);
        if (!coords) continue;

        const frameName = `${animation}_${direction}_${frameNum}`;
        frames[frameName] = {
          frame: { x: coords.x, y: coords.y, w: frameWidth, h: frameHeight },
          index: frameIndex++,
        };
        frameNames.push(frameName);
      }

      if (frameNames.length > 0) {
        animationSequences[animKey] = frameNames;
      }
    }
  }

  const pngBuffer = canvas.toBuffer('image/png');

  return {
    image: pngBuffer,
    frames,
    animations: animationSequences,
    size: { width: outputWidth, height: outputHeight },
    frameSize: { width: frameWidth, height: frameHeight },
  };
}
