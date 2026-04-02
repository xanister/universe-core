/**
 * LPC Asset Utilities Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadLPCManifest,
  getLPCAssetManifest,
  setLPCAssetManifest,
  getLPCLayerManifest,
  getAvailableBodyTypes,
  getLPCLayerOptions,
  getLPCLayerOptionsFiltered,
  getLPCAssetOption,
  getLPCAssetPath,
  getLPCDefaultCharacter,
  createLayerConfig,
  getRandomCharacter,
  getAvailableHairStyles,
} from '../src/lpc-assets';
import { createMockManifest, createMockOption, createMockLayer } from './helpers/mock-manifest';
import { readFileSyncMock } from './setup';

describe('lpc-assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset manifest state before each test
    setLPCAssetManifest(null as never);
  });

  describe('loadLPCManifest', () => {
    it('loads and caches manifest from file system', () => {
      const mockManifest = createMockManifest();
      readFileSyncMock.mockReturnValue(JSON.stringify(mockManifest));

      const result = loadLPCManifest('/test/path');

      // Use toHaveBeenCalled and check args contain the path parts (cross-platform)
      expect(readFileSyncMock).toHaveBeenCalled();
      const callArgs = readFileSyncMock.mock.calls[0];
      expect(callArgs[0]).toContain('test');
      expect(callArgs[0]).toContain('path');
      expect(callArgs[0]).toContain('manifest.json');
      expect(callArgs[1]).toBe('utf-8');
      expect(result).toEqual(mockManifest);
    });

    it('returns cached manifest on subsequent calls with same path in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const mockManifest = createMockManifest();
        readFileSyncMock.mockReturnValue(JSON.stringify(mockManifest));

        loadLPCManifest('/test/path');
        loadLPCManifest('/test/path');

        expect(readFileSyncMock).toHaveBeenCalledTimes(1);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('re-reads manifest on every call in dev mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const mockManifest = createMockManifest();
        readFileSyncMock.mockReturnValue(JSON.stringify(mockManifest));

        loadLPCManifest('/test/path');
        loadLPCManifest('/test/path');

        expect(readFileSyncMock).toHaveBeenCalledTimes(2);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('preserves injected data in dev mode (does not re-read from disk)', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const injectedManifest = createMockManifest({ version: 'injected' });
        setLPCAssetManifest(injectedManifest);

        // loadLPCManifest should return the injected data, not read from disk
        const result = loadLPCManifest('/test/path');
        expect(result.version).toBe('injected');
        expect(readFileSyncMock).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('reloads manifest when path changes', () => {
      const mockManifest1 = createMockManifest({ version: '1.0.0' });
      const mockManifest2 = createMockManifest({ version: '2.0.0' });
      readFileSyncMock
        .mockReturnValueOnce(JSON.stringify(mockManifest1))
        .mockReturnValueOnce(JSON.stringify(mockManifest2));

      const result1 = loadLPCManifest('/path1');
      const result2 = loadLPCManifest('/path2');

      expect(readFileSyncMock).toHaveBeenCalledTimes(2);
      expect(result1.version).toBe('1.0.0');
      expect(result2.version).toBe('2.0.0');
    });
  });

  describe('getLPCAssetManifest', () => {
    it('throws if manifest not loaded', () => {
      expect(() => getLPCAssetManifest()).toThrow('LPC manifest not loaded');
    });

    it('returns manifest after setLPCAssetManifest', () => {
      const mockManifest = createMockManifest();
      setLPCAssetManifest(mockManifest);

      expect(getLPCAssetManifest()).toEqual(mockManifest);
    });
  });

  describe('getLPCLayerManifest', () => {
    beforeEach(() => {
      setLPCAssetManifest(createMockManifest());
    });

    it('returns layer manifest for valid type', () => {
      const layer = getLPCLayerManifest('body');

      expect(layer).toBeDefined();
      expect(layer?.type).toBe('body');
      expect(layer?.displayName).toBe('Body');
    });

    it('returns undefined for invalid type', () => {
      const layer = getLPCLayerManifest('invalid' as never);

      expect(layer).toBeUndefined();
    });
  });

  describe('getAvailableBodyTypes', () => {
    it('returns body types from manifest', () => {
      setLPCAssetManifest(createMockManifest({ bodyTypes: ['male', 'female'] }));

      const types = getAvailableBodyTypes();

      expect(types).toEqual(['male', 'female']);
    });

    it('returns default body types if not specified', () => {
      setLPCAssetManifest(createMockManifest({ bodyTypes: undefined }));

      const types = getAvailableBodyTypes();

      expect(types).toEqual(['male', 'female']);
    });
  });

  describe('getLPCLayerOptions', () => {
    beforeEach(() => {
      setLPCAssetManifest(createMockManifest());
    });

    it('returns all options without body type filter', () => {
      const options = getLPCLayerOptions('hair');

      expect(options.length).toBe(3);
    });

    it('returns empty array for non-existent layer', () => {
      const options = getLPCLayerOptions('invalid' as never);

      expect(options).toEqual([]);
    });

    it('filters body-specific layers by bodyType field', () => {
      const maleOptions = getLPCLayerOptions('body', 'male');

      expect(maleOptions.every((o) => !o.bodyType || o.bodyType === 'male')).toBe(true);
    });

    it('filters equipment layers by path for male', () => {
      const maleOptions = getLPCLayerOptions('hair', 'male');

      expect(maleOptions.some((o) => o.path.includes('/either/'))).toBe(true);
      expect(maleOptions.some((o) => o.path.includes('/male/'))).toBe(true);
      expect(maleOptions.every((o) => !o.path.includes('/female/'))).toBe(true);
    });

    it('includes options with bodyTypeOverrides', () => {
      const options = getLPCLayerOptions('torso', 'female');

      expect(options.some((o) => o.id === 'armor')).toBe(true);
    });
  });

  describe('getLPCLayerOptionsFiltered', () => {
    beforeEach(() => {
      setLPCAssetManifest(createMockManifest());
    });

    it('filters by variant for variant-filtered layers', () => {
      const humanOptions = getLPCLayerOptionsFiltered('eyes', undefined, 'human');

      expect(humanOptions.every((o) => o.variant === 'human' || !o.variant)).toBe(true);
    });

    it('falls back to non-variant options if variant not found', () => {
      const options = getLPCLayerOptionsFiltered('eyes', undefined, 'unknown_variant');

      expect(options.every((o) => !o.variant)).toBe(true);
    });

    it('returns non-variant options when no variant specified', () => {
      const options = getLPCLayerOptionsFiltered('eyes');

      expect(options.every((o) => !o.variant)).toBe(true);
    });
  });

  describe('getLPCAssetOption', () => {
    beforeEach(() => {
      setLPCAssetManifest(createMockManifest());
    });

    it('returns option by id', () => {
      const option = getLPCAssetOption('hair', 'messy_brown');

      expect(option).toBeDefined();
      expect(option?.id).toBe('messy_brown');
      expect(option?.name).toBe('Messy Brown');
    });

    it('returns undefined for non-existent option', () => {
      const option = getLPCAssetOption('hair', 'nonexistent');

      expect(option).toBeUndefined();
    });

    it('respects body type filter', () => {
      const maleOption = getLPCAssetOption('hair', 'short_black', 'male');
      const femaleOption = getLPCAssetOption('hair', 'short_black', 'female');

      expect(maleOption).toBeDefined();
      expect(femaleOption).toBeUndefined();
    });
  });

  describe('getLPCAssetPath', () => {
    beforeEach(() => {
      // Load manifest with a specific basePath
      const mockManifest = createMockManifest();
      readFileSyncMock.mockReturnValue(JSON.stringify(mockManifest));
      loadLPCManifest('/sprites/lpc');
    });

    it('builds file path from base path and option path', () => {
      const option = createMockOption({ path: 'hair/either/test.png' });

      const path = getLPCAssetPath(option);

      // Cross-platform path check
      expect(path).toContain('sprites');
      expect(path).toContain('lpc');
      expect(path).toContain('hair');
      expect(path).toContain('either');
      expect(path).toContain('test.png');
    });

    it('uses bodyTypeOverride when specified', () => {
      const option = createMockOption({
        path: 'torso/male/armor.png',
        bodyTypeOverrides: { female: 'torso/female/armor.png' },
      });

      const pathMale = getLPCAssetPath(option, 'male');
      const pathFemale = getLPCAssetPath(option, 'female');

      // Cross-platform path check
      expect(pathMale).toContain('male');
      expect(pathMale).toContain('armor.png');
      expect(pathFemale).toContain('female');
      expect(pathFemale).toContain('armor.png');
    });
  });

  describe('getLPCDefaultCharacter', () => {
    beforeEach(() => {
      const mockManifest = createMockManifest();
      readFileSyncMock.mockReturnValue(JSON.stringify(mockManifest));
      loadLPCManifest('/sprites/lpc');
    });

    it('returns layer configs for default selections', () => {
      const layers = getLPCDefaultCharacter();

      expect(layers.length).toBeGreaterThan(0);
      expect(layers.some((l) => l.type === 'body')).toBe(true);
      expect(layers.some((l) => l.type === 'hair')).toBe(true);
    });

    it('respects body type for layer selection', () => {
      const maleLayers = getLPCDefaultCharacter('male');
      const femaleLayers = getLPCDefaultCharacter('female');

      const maleBody = maleLayers.find((l) => l.type === 'body');
      const femaleBody = femaleLayers.find((l) => l.type === 'body');

      expect(maleBody?.imageUrl).toContain('male');
      expect(femaleBody?.imageUrl).toContain('female');
    });
  });

  describe('createLayerConfig', () => {
    beforeEach(() => {
      const mockManifest = createMockManifest();
      readFileSyncMock.mockReturnValue(JSON.stringify(mockManifest));
      loadLPCManifest('/sprites/lpc');
    });

    it('creates layer config from type and option id', () => {
      const config = createLayerConfig('hair', 'messy_brown');

      expect(config).toBeDefined();
      expect(config?.type).toBe('hair');
      expect(config?.imageUrl).toContain('messy_brown');
    });

    it('returns null for invalid option id', () => {
      const config = createLayerConfig('hair', 'nonexistent');

      expect(config).toBeNull();
    });

    it('adds colorize for tintable options with tint specified', () => {
      const config = createLayerConfig('hair', 'messy_brown', { tint: 0xff0000 });

      expect(config?.colorize).toEqual({ type: 'tint', color: 0xff0000 });
    });

    it('does not add colorize for non-tintable options', () => {
      const manifest = createMockManifest();
      manifest.layers.push(
        createMockLayer({
          type: 'weapon',
          options: [
            createMockOption({
              id: 'sword',
              name: 'Sword',
              path: 'weapon/sword.png',
              tintable: false,
            }),
          ],
        }),
      );
      setLPCAssetManifest(manifest);

      const config = createLayerConfig('weapon', 'sword', { tint: 0xff0000 });

      expect(config?.colorize).toBeUndefined();
    });

    it('respects body type option', () => {
      const config = createLayerConfig('body', 'light', { bodyType: 'female' });

      expect(config?.imageUrl).toContain('female');
    });
  });

  describe('getRandomCharacter', () => {
    beforeEach(() => {
      const mockManifest = createMockManifest();
      readFileSyncMock.mockReturnValue(JSON.stringify(mockManifest));
      loadLPCManifest('/sprites/lpc');
      vi.spyOn(Math, 'random');
    });

    it('always includes required layers', () => {
      vi.mocked(Math.random).mockReturnValue(0.99);

      const layers = getRandomCharacter();

      expect(layers.some((l) => l.type === 'body')).toBe(true);
      expect(layers.some((l) => l.type === 'torso')).toBe(true);
      expect(layers.some((l) => l.type === 'legs')).toBe(true);
    });

    it('includes optional layers based on random chance', () => {
      vi.mocked(Math.random).mockReturnValue(0.6);

      const layers = getRandomCharacter();

      expect(layers.some((l) => l.type === 'hair')).toBe(true);
    });

    it('respects body type filter', () => {
      vi.mocked(Math.random).mockReturnValue(0.5);

      const maleLayers = getRandomCharacter('male');

      const bodyLayer = maleLayers.find((l) => l.type === 'body');
      expect(bodyLayer?.imageUrl).toContain('male');
    });
  });

  describe('getAvailableHairStyles (FEAT-123)', () => {
    it('returns empty array when manifest is not loaded', () => {
      setLPCAssetManifest(null as never);
      const styles = getAvailableHairStyles();
      expect(styles).toEqual([]);
    });

    it('returns deduplicated hair styles from manifest', () => {
      const manifest = createMockManifest({
        layers: [
          createMockLayer({
            type: 'hair',
            optional: true,
            options: [
              createMockOption({ id: 'hair_bangs', name: 'Bangs' }),
              createMockOption({ id: 'hair_long', name: 'Long' }),
              createMockOption({ id: 'hair_ponytail', name: 'Ponytail' }),
              createMockOption({ id: 'hair_bangs_female', name: 'Bangs Female' }), // should be skipped
              createMockOption({ id: 'hair_long_female', name: 'Long Female' }), // should be skipped
            ],
          }),
        ],
      });
      setLPCAssetManifest(manifest);

      const styles = getAvailableHairStyles();
      const styleIds = styles.map((s) => s.id);

      expect(styleIds).toContain('bangs');
      expect(styleIds).toContain('long');
      expect(styleIds).toContain('ponytail');
      // Female-suffixed entries should be filtered out (not appear as separate styles)
      expect(styleIds).not.toContain('bangs_female');
      expect(styleIds).not.toContain('long_female');
    });

    it('skips shadow and scrunchie entries', () => {
      const manifest = createMockManifest({
        layers: [
          createMockLayer({
            type: 'hair',
            optional: true,
            options: [
              createMockOption({ id: 'hair_bangs', name: 'Bangs' }),
              createMockOption({ id: 'hair_shadows_darkbody_male', name: 'Shadows Dark Male' }),
              createMockOption({ id: 'hair_scrunchies_female', name: 'Scrunchies Female' }),
            ],
          }),
        ],
      });
      setLPCAssetManifest(manifest);

      const styles = getAvailableHairStyles();
      const styleIds = styles.map((s) => s.id);

      expect(styleIds).toContain('bangs');
      expect(styleIds).not.toContain('shadows_darkbody_male');
      expect(styleIds).not.toContain('scrunchies_female');
    });

    it('returns styles sorted by label', () => {
      const manifest = createMockManifest({
        layers: [
          createMockLayer({
            type: 'hair',
            optional: true,
            options: [
              createMockOption({ id: 'hair_ponytail', name: 'Ponytail' }),
              createMockOption({ id: 'hair_bangs', name: 'Bangs' }),
              createMockOption({ id: 'hair_mohawk', name: 'Mohawk' }),
            ],
          }),
        ],
      });
      setLPCAssetManifest(manifest);

      const styles = getAvailableHairStyles();
      const labels = styles.map((s) => s.label);

      expect(labels).toEqual([...labels].sort());
    });

    it('includes human-readable labels', () => {
      const manifest = createMockManifest({
        layers: [
          createMockLayer({
            type: 'hair',
            optional: true,
            options: [createMockOption({ id: 'hair_dark_blonde', name: 'Dark Blonde' })],
          }),
        ],
      });
      setLPCAssetManifest(manifest);

      const styles = getAvailableHairStyles();
      const darkBlonde = styles.find((s) => s.id === 'dark_blonde');

      expect(darkBlonde).toBeDefined();
      expect(darkBlonde!.label).toBe('Dark Blonde');
    });
  });
});
