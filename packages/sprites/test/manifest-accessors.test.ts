/**
 * Manifest-Driven Layer Metadata Accessor Tests
 *
 * Validates that the manifest accessor functions produce the same results
 * as the previously hardcoded constants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLPCAssetManifest,
  getLayerZIndex,
  getLayerOrder,
  isVariantFiltered,
  isBodyTypeSpecific,
  getLayersBySlotKind,
} from '../src/lpc-assets';
import { createFullManifest } from './helpers/mock-manifest';

describe('manifest accessors', () => {
  beforeEach(() => {
    setLPCAssetManifest(createFullManifest());
  });

  describe('getLayerZIndex', () => {
    it('returns correct z-index for each layer', () => {
      expect(getLayerZIndex('behind_body')).toBe(0);
      expect(getLayerZIndex('body')).toBe(1);
      expect(getLayerZIndex('ears')).toBe(2);
      expect(getLayerZIndex('eyes')).toBe(3);
      expect(getLayerZIndex('nose')).toBe(4);
      expect(getLayerZIndex('feet')).toBe(5);
      expect(getLayerZIndex('legs')).toBe(6);
      expect(getLayerZIndex('torso')).toBe(7);
      expect(getLayerZIndex('belt')).toBe(8);
      expect(getLayerZIndex('hands')).toBe(9);
      expect(getLayerZIndex('facial')).toBe(10);
      expect(getLayerZIndex('hair')).toBe(11);
      expect(getLayerZIndex('head')).toBe(12);
      expect(getLayerZIndex('neck')).toBe(13);
      expect(getLayerZIndex('accessories')).toBe(14);
      expect(getLayerZIndex('weapon')).toBe(15);
    });

    it('returns layer count for unknown types', () => {
      expect(getLayerZIndex('unknown')).toBe(16);
    });
  });

  describe('getLayerOrder', () => {
    it('returns layers sorted by z-index', () => {
      const order = getLayerOrder();
      expect(order).toEqual([
        'behind_body',
        'body',
        'ears',
        'eyes',
        'nose',
        'feet',
        'legs',
        'torso',
        'belt',
        'hands',
        'facial',
        'hair',
        'head',
        'neck',
        'accessories',
        'weapon',
      ]);
    });

    it('has same count as manifest layers', () => {
      const order = getLayerOrder();
      expect(order.length).toBe(16);
    });
  });

  describe('isVariantFiltered', () => {
    it('returns true for variant-filtered layers', () => {
      expect(isVariantFiltered('ears')).toBe(true);
      expect(isVariantFiltered('eyes')).toBe(true);
      expect(isVariantFiltered('nose')).toBe(true);
    });

    it('returns false for non-variant-filtered layers', () => {
      expect(isVariantFiltered('torso')).toBe(false);
      expect(isVariantFiltered('legs')).toBe(false);
      expect(isVariantFiltered('weapon')).toBe(false);
    });

    it('returns false for unknown layer types', () => {
      expect(isVariantFiltered('unknown')).toBe(false);
    });
  });

  describe('isBodyTypeSpecific', () => {
    it('returns true for body-type-specific layers', () => {
      expect(isBodyTypeSpecific('body')).toBe(true);
      expect(isBodyTypeSpecific('ears')).toBe(true);
      expect(isBodyTypeSpecific('eyes')).toBe(true);
      expect(isBodyTypeSpecific('nose')).toBe(true);
    });

    it('returns false for non-body-type-specific layers', () => {
      expect(isBodyTypeSpecific('torso')).toBe(false);
      expect(isBodyTypeSpecific('legs')).toBe(false);
      expect(isBodyTypeSpecific('hair')).toBe(false);
    });

    it('returns false for unknown layer types', () => {
      expect(isBodyTypeSpecific('unknown')).toBe(false);
    });
  });

  describe('getLayersBySlotKind', () => {
    it('returns body layers', () => {
      const bodyLayers = getLayersBySlotKind('body');
      expect(bodyLayers).toContain('body');
      expect(bodyLayers).toContain('eyes');
      expect(bodyLayers).toContain('hair');
      expect(bodyLayers).not.toContain('torso');
    });

    it('returns feature layers', () => {
      const featureLayers = getLayersBySlotKind('feature');
      expect(featureLayers).toContain('ears');
      expect(featureLayers).toContain('nose');
      expect(featureLayers).toContain('facial');
      expect(featureLayers).not.toContain('body');
    });

    it('returns wearable layers', () => {
      const wearableLayers = getLayersBySlotKind('wearable');
      expect(wearableLayers).toContain('behind_body');
      expect(wearableLayers).toContain('feet');
      expect(wearableLayers).toContain('legs');
      expect(wearableLayers).toContain('torso');
      expect(wearableLayers).toContain('belt');
      expect(wearableLayers).toContain('hands');
      expect(wearableLayers).toContain('head');
      expect(wearableLayers).toContain('neck');
      expect(wearableLayers).toContain('accessories');
      expect(wearableLayers).toContain('weapon');
      expect(wearableLayers).not.toContain('body');
    });

    it('returns empty array for unknown kind', () => {
      expect(getLayersBySlotKind('unknown')).toEqual([]);
    });
  });
});
