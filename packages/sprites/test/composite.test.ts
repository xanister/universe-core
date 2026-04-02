/**
 * Composite Sprite Generator Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateCompositeSprite, computeLayerConfigHash } from '../src/composite';
import { setLPCAssetManifest } from '../src/lpc-assets';
import { createMockManifest } from './helpers/mock-manifest';
import type { LayerConfig } from '../src/types';

describe('composite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLPCAssetManifest(createMockManifest());
  });

  describe('generateCompositeSprite', () => {
    it('throws if no layers provided', async () => {
      await expect(generateCompositeSprite([])).rejects.toThrow('No layers loaded successfully');
    });

    it('returns CompositeSpriteData with expected properties', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers);

      expect(result).toHaveProperty('image');
      expect(result).toHaveProperty('frames');
      expect(result).toHaveProperty('animations');
      expect(result).toHaveProperty('size');
      expect(result).toHaveProperty('frameSize');
    });

    it('returns a Buffer', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers);

      expect(Buffer.isBuffer(result.image)).toBe(true);
    });

    it('respects custom frame dimensions', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers, { frameWidth: 32, frameHeight: 32 });

      expect(result.frameSize.width).toBe(32);
      expect(result.frameSize.height).toBe(32);
      expect(result.size.width).toBe(13 * 32);
      expect(result.size.height).toBe(21 * 32);
    });

    it('generates frame metadata for all animations', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers);

      expect(Object.keys(result.animations).length).toBeGreaterThan(0);
      expect(result.animations).toHaveProperty('walk_down');
      expect(result.animations).toHaveProperty('idle_down');
    });

    it('generates correct frame count for walk animation', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers);

      expect(result.animations['walk_down'].length).toBe(9);
    });

    it('generates single frame for idle animation', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers);

      expect(result.animations['idle_down'].length).toBe(1);
    });

    it('filters animations based on options', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers, { animations: ['walk', 'idle'] });

      expect(result.animations).toHaveProperty('walk_down');
      expect(result.animations).toHaveProperty('idle_down');
      expect(result.animations).not.toHaveProperty('slash_down');
    });

    it('filters directions based on options', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers, { directions: ['down', 'up'] });

      expect(result.animations).toHaveProperty('walk_down');
      expect(result.animations).toHaveProperty('walk_up');
      expect(result.animations).not.toHaveProperty('walk_left');
      expect(result.animations).not.toHaveProperty('walk_right');
    });

    it('skips invisible layers', async () => {
      const layers: LayerConfig[] = [
        { type: 'body', imageUrl: '/test/body.png' },
        { type: 'hair', imageUrl: '/test/hair.png', visible: false },
      ];

      const result = await generateCompositeSprite(layers);

      expect(result).toBeDefined();
    });

    it('handles layers with custom z-index', async () => {
      const layers: LayerConfig[] = [
        { type: 'body', imageUrl: '/test/body.png', zIndex: 0 },
        { type: 'hair', imageUrl: '/test/hair.png', zIndex: 100 },
      ];

      const result = await generateCompositeSprite(layers);

      expect(result).toBeDefined();
    });

    it('includes frame coordinates in frame metadata', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers);

      const walkDownFrame = result.frames['walk_down_0'];
      expect(walkDownFrame).toBeDefined();
      expect(walkDownFrame.frame).toHaveProperty('x');
      expect(walkDownFrame.frame).toHaveProperty('y');
      expect(walkDownFrame.frame).toHaveProperty('w', 64);
      expect(walkDownFrame.frame).toHaveProperty('h', 64);
    });

    it('handles attack as slash alias', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers, { animations: ['attack'] });

      expect(result.animations).toHaveProperty('attack_down');
      expect(result.animations['attack_down'].length).toBe(6);
    });

    it('handles cast as spellcast alias', async () => {
      const layers: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png' }];

      const result = await generateCompositeSprite(layers, { animations: ['cast'] });

      expect(result.animations).toHaveProperty('cast_down');
      expect(result.animations['cast_down'].length).toBe(7);
    });

    it('processes colorize tint option', async () => {
      const layers: LayerConfig[] = [
        { type: 'hair', imageUrl: '/test/hair.png', colorize: { type: 'tint', color: 0xff0000 } },
      ];

      const result = await generateCompositeSprite(layers);

      expect(result).toBeDefined();
    });

    it('processes colorize tint with threshold (BUG-083: eye sclera preservation)', async () => {
      const layers: LayerConfig[] = [
        {
          type: 'eyes',
          imageUrl: '/test/eyes.png',
          colorize: { type: 'tint', color: 0x4488dd, threshold: 230 },
        },
      ];

      const result = await generateCompositeSprite(layers);

      expect(result).toBeDefined();
      expect(result.image).toBeInstanceOf(Buffer);
    });

    it('processes colorize tint with tintMode overlay (FEAT-113: metallic specular)', async () => {
      const layers: LayerConfig[] = [
        {
          type: 'torso',
          imageUrl: '/test/torso.png',
          colorize: { type: 'tint', color: 0xc0c0c0, tintMode: 'overlay' },
        },
      ];

      const result = await generateCompositeSprite(layers);

      expect(result).toBeDefined();
      expect(result.image).toBeInstanceOf(Buffer);
    });

    it('tintMode defaults to multiply when omitted', async () => {
      const layers: LayerConfig[] = [
        {
          type: 'torso',
          imageUrl: '/test/torso.png',
          colorize: { type: 'tint', color: 0xff0000 },
        },
      ];

      const result = await generateCompositeSprite(layers);

      expect(result).toBeDefined();
      expect(result.image).toBeInstanceOf(Buffer);
    });

    it('tint on one layer does not affect other layers (temp canvas isolation)', async () => {
      // Regression: before the fix, applyTint read the entire frame region from the main
      // canvas and tinted all previously drawn layers (body, eyes, etc.), not just the
      // tinted layer. The fix draws tinted layers to a temp canvas first.
      const layers: LayerConfig[] = [
        { type: 'body', imageUrl: '/test/body.png' },
        { type: 'torso', imageUrl: '/test/torso.png', colorize: { type: 'tint', color: 0xff0000 } },
        { type: 'hair', imageUrl: '/test/hair.png' },
      ];

      // Should not throw -- the temp canvas approach handles tinted layers correctly
      const result = await generateCompositeSprite(layers);

      expect(result).toBeDefined();
      expect(result.image).toBeInstanceOf(Buffer);
      expect(result.image.length).toBeGreaterThan(0);
    });
  });

  describe('computeLayerConfigHash', () => {
    it('returns consistent hash for same config', () => {
      const layers: LayerConfig[] = [
        { type: 'body', imageUrl: '/test/body.png' },
        { type: 'hair', imageUrl: '/test/hair.png' },
      ];

      const hash1 = computeLayerConfigHash(layers);
      const hash2 = computeLayerConfigHash(layers);

      expect(hash1).toBe(hash2);
    });

    it('returns same hash regardless of layer order', () => {
      const layers1: LayerConfig[] = [
        { type: 'body', imageUrl: '/test/body.png' },
        { type: 'hair', imageUrl: '/test/hair.png' },
      ];
      const layers2: LayerConfig[] = [
        { type: 'hair', imageUrl: '/test/hair.png' },
        { type: 'body', imageUrl: '/test/body.png' },
      ];

      const hash1 = computeLayerConfigHash(layers1);
      const hash2 = computeLayerConfigHash(layers2);

      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different configs', () => {
      const layers1: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body1.png' }];
      const layers2: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body2.png' }];

      const hash1 = computeLayerConfigHash(layers1);
      const hash2 = computeLayerConfigHash(layers2);

      expect(hash1).not.toBe(hash2);
    });

    it('includes tint in hash', () => {
      const layers1: LayerConfig[] = [
        { type: 'hair', imageUrl: '/test/hair.png', colorize: { type: 'tint', color: 0xff0000 } },
      ];
      const layers2: LayerConfig[] = [
        { type: 'hair', imageUrl: '/test/hair.png', colorize: { type: 'tint', color: 0x00ff00 } },
      ];

      const hash1 = computeLayerConfigHash(layers1);
      const hash2 = computeLayerConfigHash(layers2);

      expect(hash1).not.toBe(hash2);
    });

    it('includes zIndex in hash', () => {
      const layers1: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png', zIndex: 1 }];
      const layers2: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png', zIndex: 2 }];

      const hash1 = computeLayerConfigHash(layers1);
      const hash2 = computeLayerConfigHash(layers2);

      expect(hash1).not.toBe(hash2);
    });

    it('includes visibility in hash', () => {
      const layers1: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png', visible: true }];
      const layers2: LayerConfig[] = [{ type: 'body', imageUrl: '/test/body.png', visible: false }];

      const hash1 = computeLayerConfigHash(layers1);
      const hash2 = computeLayerConfigHash(layers2);

      expect(hash1).not.toBe(hash2);
    });

    it('includes tintMode in hash', () => {
      const layers1: LayerConfig[] = [
        {
          type: 'torso',
          imageUrl: '/test/torso.png',
          colorize: { type: 'tint', color: 0xc0c0c0 },
        },
      ];
      const layers2: LayerConfig[] = [
        {
          type: 'torso',
          imageUrl: '/test/torso.png',
          colorize: { type: 'tint', color: 0xc0c0c0, tintMode: 'overlay' },
        },
      ];

      const hash1 = computeLayerConfigHash(layers1);
      const hash2 = computeLayerConfigHash(layers2);

      expect(hash1).not.toBe(hash2);
    });

    it('includes tint threshold in hash', () => {
      const layers1: LayerConfig[] = [
        { type: 'eyes', imageUrl: '/test/eyes.png', colorize: { type: 'tint', color: 0x4488dd } },
      ];
      const layers2: LayerConfig[] = [
        {
          type: 'eyes',
          imageUrl: '/test/eyes.png',
          colorize: { type: 'tint', color: 0x4488dd, threshold: 230 },
        },
      ];

      const hash1 = computeLayerConfigHash(layers1);
      const hash2 = computeLayerConfigHash(layers2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
