/**
 * Unit tests for object catalog layer resolution (FEAT-267).
 *
 * Tests that resolveEntityLayerBySprite returns the catalog entity's explicit
 * non-default layer, falling back to sprite defaultLayer, then to the provided fallback.
 * Also tests getSpriteDefaultLayer for sprite-level intrinsic layer lookup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  readdirSync: vi.fn().mockReturnValue(['rug.json', 'barrel.json', 'torch.json', 'hatch_cover.json']),
}));

vi.mock('@dmnpc/core/infra/read-json-file.js', () => ({
  readJsonFileSync: vi.fn((path: string) => {
    if (path.includes('sprite-registry')) {
      return {
        sprites: {
          rug: { id: 'rug', width: 32, height: 32, boundingBox: null },
          barrel: { id: 'barrel', width: 32, height: 32, boundingBox: null },
          torch_anim: { id: 'torch_anim', width: 32, height: 64, boundingBox: null },
          ship_hatch: { id: 'ship_hatch', width: 96, height: 96, boundingBox: null, defaultLayer: 'floor' },
        },
      };
    }
    if (path.includes('rug.json')) {
      return {
        id: 'rug',
        name: 'Rug',
        purposes: ['floor_covering'],
        spriteId: 'rug',
        solid: false,
        layer: 'floor',
        tags: ['common', 'floor'],
      };
    }
    if (path.includes('barrel.json')) {
      return {
        id: 'barrel',
        name: 'Barrel',
        purposes: ['storage', 'decoration'],
        spriteId: 'barrel',
        solid: true,
        layer: 'default',
        tags: ['common'],
      };
    }
    if (path.includes('torch.json')) {
      return {
        id: 'torch',
        name: 'Wall Torch',
        purposes: ['lighting'],
        spriteId: 'torch_anim',
        solid: true,
        tags: ['common'],
      };
    }
    if (path.includes('hatch_cover.json')) {
      return {
        id: 'hatch_cover',
        name: 'Hatch Cover',
        purposes: ['decoration'],
        spriteId: 'ship_hatch',
        solid: false,
        tags: ['ship'],
      };
    }
    return {};
  }),
}));

vi.mock('@dmnpc/data', () => ({
  ENTITIES_DIR: '/mock/entities',
  SPRITE_REGISTRY_PATH: '/mock/sprites/sprite-registry.json',
}));

let resolveEntityLayerBySprite: typeof import('../../src/place-layout/object-catalog.js').resolveEntityLayerBySprite;
let getSpriteDefaultLayer: typeof import('../../src/place-layout/object-catalog.js').getSpriteDefaultLayer;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../../src/place-layout/object-catalog.js');
  resolveEntityLayerBySprite = mod.resolveEntityLayerBySprite;
  getSpriteDefaultLayer = mod.getSpriteDefaultLayer;
});

describe('resolveEntityLayerBySprite', () => {
  it('returns catalog floor layer for entity with explicit floor layer', () => {
    const layer = resolveEntityLayerBySprite('floor_covering', 'rug', 'default');
    expect(layer).toBe('floor');
  });

  it('returns fallback when catalog entity has default layer and sprite has no defaultLayer', () => {
    const layer = resolveEntityLayerBySprite('storage', 'barrel', 'wall');
    expect(layer).toBe('wall');
  });

  it('returns fallback when catalog entity has no layer field and sprite has no defaultLayer', () => {
    const layer = resolveEntityLayerBySprite('lighting', 'torch_anim', 'wall');
    expect(layer).toBe('wall');
  });

  it('returns fallback when no catalog entity matches purpose + spriteId', () => {
    const layer = resolveEntityLayerBySprite('decoration', 'nonexistent_sprite', 'overhead');
    expect(layer).toBe('overhead');
  });

  it('catalog floor layer overrides even when fallback is wall', () => {
    const layer = resolveEntityLayerBySprite('floor_covering', 'rug', 'wall');
    expect(layer).toBe('floor');
  });

  it('uses sprite defaultLayer when catalog entity has no explicit layer', () => {
    const layer = resolveEntityLayerBySprite('decoration', 'ship_hatch', 'default');
    expect(layer).toBe('floor');
  });
});

describe('getSpriteDefaultLayer', () => {
  it('returns floor for sprite with defaultLayer: floor', () => {
    expect(getSpriteDefaultLayer('ship_hatch')).toBe('floor');
  });

  it('returns null for sprite with no defaultLayer', () => {
    expect(getSpriteDefaultLayer('barrel')).toBeNull();
  });

  it('returns null for unknown sprite', () => {
    expect(getSpriteDefaultLayer('nonexistent')).toBeNull();
  });

  it('returns null for null spriteId (FEAT-367)', () => {
    expect(getSpriteDefaultLayer(null)).toBeNull();
  });
});

describe('FEAT-367: null sprite handling', () => {
  it('resolveEntityLayerBySprite returns fallback for null spriteId', () => {
    const layer = resolveEntityLayerBySprite('player_start', null, 'floor');
    expect(layer).toBe('floor');
  });
});
