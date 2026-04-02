import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock storage service
vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  storageService: {
    uploadFile: vi.fn(),
  },
}));

const existsSyncMock = existsSync as ReturnType<typeof vi.fn>;
const readFileMock = readFile as ReturnType<typeof vi.fn>;
const writeFileMock = writeFile as ReturnType<typeof vi.fn>;

import { storageService } from '@dmnpc/core/clients/storage-service.js';
const uploadFileMock = storageService.uploadFile as ReturnType<typeof vi.fn>;

import {
  loadPortraitPool,
  pickFromPool,
  isPoolFull,
  addToPool,
  tryAssignFromPool,
  type PortraitPoolManifest,
} from '@dmnpc/generation/character/portrait-pool.js';

describe('generation/portrait-pool.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadPortraitPool', () => {
    it('returns empty object when manifest does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      const result = await loadPortraitPool('universe_1');

      expect(result).toEqual({});
      expect(readFileMock).not.toHaveBeenCalled();
    });

    it('loads and parses manifest when file exists', async () => {
      const manifest: PortraitPoolManifest = {
        undead: [{ url: 'https://cdn.example.com/pool/undead/0.png', faceAnchorY: 0.25 }],
      };
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify(manifest));

      const result = await loadPortraitPool('universe_1');

      expect(result).toEqual(manifest);
      expect(result.undead).toHaveLength(1);
    });
  });

  describe('pickFromPool', () => {
    it('returns null for empty manifest', () => {
      const result = pickFromPool({}, 'undead');
      expect(result).toBeNull();
    });

    it('returns null for missing purpose', () => {
      const manifest: PortraitPoolManifest = {
        goblin: [{ url: 'https://cdn.example.com/pool/goblin/0.png', faceAnchorY: 0.3 }],
      };
      const result = pickFromPool(manifest, 'undead');
      expect(result).toBeNull();
    });

    it('returns null for empty purpose array', () => {
      const manifest: PortraitPoolManifest = { undead: [] };
      const result = pickFromPool(manifest, 'undead');
      expect(result).toBeNull();
    });

    it('returns the only entry for single-element pool', () => {
      const portrait = { url: 'https://cdn.example.com/pool/undead/0.png', faceAnchorY: 0.25 };
      const manifest: PortraitPoolManifest = { undead: [portrait] };

      const result = pickFromPool(manifest, 'undead');
      expect(result).toEqual(portrait);
    });

    it('returns a valid entry from multi-element pool', () => {
      const portraits = [
        { url: 'https://cdn.example.com/pool/undead/0.png', faceAnchorY: 0.25 },
        { url: 'https://cdn.example.com/pool/undead/1.png', faceAnchorY: 0.28 },
        { url: 'https://cdn.example.com/pool/undead/2.png', faceAnchorY: 0.22 },
      ];
      const manifest: PortraitPoolManifest = { undead: portraits };

      const result = pickFromPool(manifest, 'undead');
      expect(portraits).toContainEqual(result);
    });
  });

  describe('isPoolFull', () => {
    it('returns false for missing purpose', () => {
      expect(isPoolFull({}, 'undead', 5)).toBe(false);
    });

    it('returns false for empty pool', () => {
      expect(isPoolFull({ undead: [] }, 'undead', 5)).toBe(false);
    });

    it('returns false when pool is under target', () => {
      const manifest: PortraitPoolManifest = {
        undead: [
          { url: 'url-0', faceAnchorY: 0.25 },
          { url: 'url-1', faceAnchorY: 0.28 },
        ],
      };
      expect(isPoolFull(manifest, 'undead', 5)).toBe(false);
    });

    it('returns true when pool reaches target size', () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        url: `url-${i}`,
        faceAnchorY: 0.25,
      }));
      expect(isPoolFull({ undead: entries }, 'undead', 5)).toBe(true);
    });

    it('returns true when pool exceeds target size', () => {
      const entries = Array.from({ length: 7 }, (_, i) => ({
        url: `url-${i}`,
        faceAnchorY: 0.25,
      }));
      expect(isPoolFull({ undead: entries }, 'undead', 5)).toBe(true);
    });
  });

  describe('addToPool', () => {
    it('uploads image and saves manifest for first entry', async () => {
      existsSyncMock.mockReturnValue(false); // No existing manifest
      writeFileMock.mockResolvedValue(undefined);
      uploadFileMock.mockResolvedValue('https://cdn.example.com/pool/undead/0.png');

      const result = await addToPool(
        'universe_1',
        'undead',
        5,
        Buffer.from('fake-image'),
        0.25
      );

      expect(result).toEqual({
        url: 'https://cdn.example.com/pool/undead/0.png',
        faceAnchorY: 0.25,
      });

      // Verify S3 upload
      expect(uploadFileMock).toHaveBeenCalledWith(
        'universes/universe_1/images/portrait-pool/undead/0.png',
        Buffer.from('fake-image'),
        'image/png'
      );

      // Verify manifest write
      expect(writeFileMock).toHaveBeenCalledTimes(1);
      const writtenManifest = JSON.parse(writeFileMock.mock.calls[0][1]);
      expect(writtenManifest.undead).toHaveLength(1);
      expect(writtenManifest.undead[0].url).toBe('https://cdn.example.com/pool/undead/0.png');
    });

    it('appends to existing pool entries', async () => {
      const existingManifest: PortraitPoolManifest = {
        undead: [{ url: 'https://cdn.example.com/pool/undead/0.png', faceAnchorY: 0.25 }],
      };
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify(existingManifest));
      writeFileMock.mockResolvedValue(undefined);
      uploadFileMock.mockResolvedValue('https://cdn.example.com/pool/undead/1.png');

      const result = await addToPool(
        'universe_1',
        'undead',
        5,
        Buffer.from('fake-image-2'),
        0.28
      );

      expect(result).toEqual({
        url: 'https://cdn.example.com/pool/undead/1.png',
        faceAnchorY: 0.28,
      });

      // Verify correct index in S3 key
      expect(uploadFileMock).toHaveBeenCalledWith(
        'universes/universe_1/images/portrait-pool/undead/1.png',
        expect.any(Buffer),
        'image/png'
      );

      // Verify manifest has both entries
      const writtenManifest = JSON.parse(writeFileMock.mock.calls[0][1]);
      expect(writtenManifest.undead).toHaveLength(2);
    });

    it('returns null when pool is already full', async () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        url: `url-${i}`,
        faceAnchorY: 0.25,
      }));
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify({ undead: entries }));

      const result = await addToPool(
        'universe_1',
        'undead',
        5,
        Buffer.from('fake-image'),
        0.25
      );

      expect(result).toBeNull();
      expect(uploadFileMock).not.toHaveBeenCalled();
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('handles multiple purposes independently', async () => {
      const existingManifest: PortraitPoolManifest = {
        undead: [{ url: 'url-undead-0', faceAnchorY: 0.25 }],
      };
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify(existingManifest));
      writeFileMock.mockResolvedValue(undefined);
      uploadFileMock.mockResolvedValue('https://cdn.example.com/pool/goblin/0.png');

      const result = await addToPool(
        'universe_1',
        'goblin',
        3,
        Buffer.from('fake-goblin'),
        0.3
      );

      expect(result).not.toBeNull();
      const writtenManifest = JSON.parse(writeFileMock.mock.calls[0][1]);
      expect(writtenManifest.undead).toHaveLength(1);
      expect(writtenManifest.goblin).toHaveLength(1);
    });
  });

  describe('tryAssignFromPool', () => {
    it('returns null when pool does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      const result = await tryAssignFromPool('universe_1', 'undead', 5);
      expect(result).toBeNull();
    });

    it('returns null when pool is not full', async () => {
      const manifest: PortraitPoolManifest = {
        undead: [
          { url: 'url-0', faceAnchorY: 0.25 },
          { url: 'url-1', faceAnchorY: 0.28 },
        ],
      };
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify(manifest));

      const result = await tryAssignFromPool('universe_1', 'undead', 5);
      expect(result).toBeNull();
    });

    it('returns a portrait when pool is full', async () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        url: `url-${i}`,
        faceAnchorY: 0.2 + i * 0.02,
      }));
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify({ undead: entries }));

      const result = await tryAssignFromPool('universe_1', 'undead', 5);

      expect(result).not.toBeNull();
      expect(entries).toContainEqual(result);
    });

    it('returns a portrait when pool exceeds target size', async () => {
      const entries = Array.from({ length: 8 }, (_, i) => ({
        url: `url-${i}`,
        faceAnchorY: 0.25,
      }));
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify({ undead: entries }));

      const result = await tryAssignFromPool('universe_1', 'undead', 5);
      expect(result).not.toBeNull();
    });
  });
});
