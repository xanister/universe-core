/**
 * LPC Types Tests
 *
 * Tests manifest-derived layer metadata accessors (replaces hardcoded constants).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLPCAssetManifest,
  getLayerZIndex,
  getLayerOrder,
  isVariantFiltered,
  isBodyTypeSpecific,
} from '../src/lpc-assets';
import { createFullManifest } from './helpers/mock-manifest';

describe('types', () => {
  beforeEach(() => {
    setLPCAssetManifest(createFullManifest());
  });

  describe('getLayerZIndex (replaces LPC_LAYER_Z_INDEX)', () => {
    it('has all layer types', () => {
      const layerTypes = [
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
      ];

      for (const type of layerTypes) {
        expect(getLayerZIndex(type)).toBeGreaterThanOrEqual(0);
      }
    });

    it('has unique z-index values', () => {
      const order = getLayerOrder();
      const values = order.map((type) => getLayerZIndex(type));
      const uniqueValues = new Set(values);

      expect(values.length).toBe(uniqueValues.size);
    });

    it('has z-index values in ascending order', () => {
      const order = getLayerOrder();
      const values = order.map((type) => getLayerZIndex(type));
      const sorted = [...values].sort((a, b) => a - b);

      expect(values).toEqual(sorted);
    });

    it('behind_body has lowest z-index', () => {
      expect(getLayerZIndex('behind_body')).toBe(0);
    });

    it('weapon has highest z-index', () => {
      const order = getLayerOrder();
      const values = order.map((type) => getLayerZIndex(type));
      expect(getLayerZIndex('weapon')).toBe(Math.max(...values));
    });
  });

  describe('getLayerOrder (replaces LPC_LAYER_ORDER)', () => {
    it('matches z-index ordering', () => {
      const order = getLayerOrder();
      for (let i = 0; i < order.length; i++) {
        const layerType = order[i];
        expect(getLayerZIndex(layerType)).toBe(i);
      }
    });

    it('contains all layer types', () => {
      const order = getLayerOrder();
      const layerTypes = [
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
      ];

      for (const type of layerTypes) {
        expect(order).toContain(type);
      }
    });
  });

  describe('isVariantFiltered (replaces VARIANT_FILTERED_LAYERS)', () => {
    it('contains expected layer types', () => {
      expect(isVariantFiltered('ears')).toBe(true);
      expect(isVariantFiltered('eyes')).toBe(true);
      expect(isVariantFiltered('nose')).toBe(true);
    });

    it('does not contain equipment layers', () => {
      expect(isVariantFiltered('torso')).toBe(false);
      expect(isVariantFiltered('legs')).toBe(false);
      expect(isVariantFiltered('weapon')).toBe(false);
    });
  });

  describe('isBodyTypeSpecific (replaces BODY_TYPE_SPECIFIC_LAYERS)', () => {
    it('contains body layer', () => {
      expect(isBodyTypeSpecific('body')).toBe(true);
    });

    it('contains facial feature layers', () => {
      expect(isBodyTypeSpecific('ears')).toBe(true);
      expect(isBodyTypeSpecific('eyes')).toBe(true);
      expect(isBodyTypeSpecific('nose')).toBe(true);
    });

    it('does not contain equipment layers', () => {
      expect(isBodyTypeSpecific('torso')).toBe(false);
      expect(isBodyTypeSpecific('legs')).toBe(false);
      expect(isBodyTypeSpecific('hair')).toBe(false);
    });
  });
});
