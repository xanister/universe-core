/**
 * Slot Registry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setSlotRegistry,
  loadSlotRegistry,
  getSlotOrder,
  getSlotAssetLayer,
  getSlotZIndex,
  isValidSlot,
} from '../src/slot-registry';
import { setLPCAssetManifest } from '../src/lpc-assets';
import { createMockManifest, createMockLayer } from './helpers/mock-manifest';

describe('Slot Registry', () => {
  beforeEach(() => {
    // Provide a manifest with the layers used by getSlotZIndex
    setLPCAssetManifest(
      createMockManifest({
        layers: [
          ...createMockManifest().layers,
          createMockLayer({
            type: 'behind_body',
            zIndex: 0,
            variantFiltered: false,
            bodyTypeSpecific: false,
            slotKind: 'wearable',
          }),
          createMockLayer({
            type: 'belt',
            zIndex: 8,
            variantFiltered: false,
            bodyTypeSpecific: false,
            slotKind: 'wearable',
          }),
        ],
      }),
    );
    setSlotRegistry({
      version: 1,
      slots: [
        { id: 'behind_body', region: 'back', subOrder: 0 },
        { id: 'feet', region: 'feet', subOrder: 0 },
        { id: 'torso_under', region: 'torso', subOrder: 0 },
        { id: 'torso_mid', region: 'torso', subOrder: 1 },
        { id: 'torso_top', region: 'torso', subOrder: 3 },
        { id: 'belt', region: 'waist', subOrder: 0 },
      ],
    });
  });

  it('getSlotOrder returns slots in array order', () => {
    const order = getSlotOrder();
    expect(order).toEqual(['behind_body', 'feet', 'torso_under', 'torso_mid', 'torso_top', 'belt']);
  });

  it('getSlotAssetLayer maps region to asset type', () => {
    expect(getSlotAssetLayer('torso_under')).toBe('torso');
    expect(getSlotAssetLayer('torso_top')).toBe('torso');
    expect(getSlotAssetLayer('belt')).toBe('belt');
    expect(getSlotAssetLayer('behind_body')).toBe('behind_body');
  });

  it('getSlotZIndex returns distinct values for same-region slots', () => {
    const zUnder = getSlotZIndex('torso_under');
    const zMid = getSlotZIndex('torso_mid');
    const zTop = getSlotZIndex('torso_top');
    expect(zUnder).toBeLessThan(zMid);
    expect(zMid).toBeLessThan(zTop);
  });

  it('isValidSlot returns true for known slots', () => {
    expect(isValidSlot('torso_under')).toBe(true);
    expect(isValidSlot('belt')).toBe(true);
  });

  it('isValidSlot returns false for unknown slots', () => {
    expect(isValidSlot('nonexistent')).toBe(false);
  });

  it('loadSlotRegistry returns injected registry when set', () => {
    const reg = loadSlotRegistry();
    expect(reg.version).toBe(1);
    expect(reg.slots).toHaveLength(6);
  });

  it('preserves injected data in dev mode (does not re-read from disk)', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const injectedRegistry = {
        version: 99,
        slots: [{ id: 'test_slot', region: 'torso', subOrder: 0 }],
      };
      setSlotRegistry(injectedRegistry);

      // loadSlotRegistry should return injected data, not attempt disk read
      const result = loadSlotRegistry();
      expect(result.version).toBe(99);
      expect(result.slots).toHaveLength(1);
      expect(result.slots[0].id).toBe('test_slot');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
