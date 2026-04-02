import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';

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
  unlink: vi.fn(),
}));

const existsSyncMock = existsSync as ReturnType<typeof vi.fn>;
const readFileMock = readFile as ReturnType<typeof vi.fn>;
const writeFileMock = writeFile as ReturnType<typeof vi.fn>;
const unlinkMock = unlink as ReturnType<typeof vi.fn>;

// Static import — loads at collection time with mocks already in place
import {
  loadMediaData,
  getAudioEntries,
  deleteMediaFile,
  registerMediaEntry,
} from '@dmnpc/generation/media-helpers.js';

describe('generation/media-helpers.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadMediaData', () => {
    it('returns empty media array when file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      const result = await loadMediaData('test_universe');

      expect(result).toEqual({ universeId: 'test_universe', media: [] });
      expect(readFileMock).not.toHaveBeenCalled();
    });

    it('loads and parses media.json when file exists', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          media: [
            {
              filename: 'test.mp3',
              url: '/api/media/test/audio/test.mp3',
              entityType: 'music',
              mediaType: 'audio',
              extension: 'mp3',
              path: '/path/to/test.mp3',
            },
          ],
        })
      );

      const result = await loadMediaData('test_universe');

      expect(result.universeId).toBe('test_universe');
      expect(result.media).toHaveLength(1);
      expect(result.media[0].filename).toBe('test.mp3');
    });

    it('throws on parse error', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue('not valid json');

      await expect(loadMediaData('test_universe')).rejects.toThrow();
    });

    it('throws on read error', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockRejectedValue(new Error('Read error'));

      await expect(loadMediaData('test_universe')).rejects.toThrow('Read error');
    });
  });

  describe('getAudioEntries', () => {
    it('filters to only audio entries', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          media: [
            { filename: 'audio.mp3', mediaType: 'audio', url: '/audio.mp3' },
            { filename: 'image.png', mediaType: 'image', url: '/image.png' },
            { filename: 'music.mp3', mediaType: 'audio', url: '/music.mp3' },
          ],
        })
      );

      const result = await getAudioEntries('test_universe');

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.mediaType === 'audio')).toBe(true);
    });
  });

  describe('deleteMediaFile', () => {
    it('returns false when file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      const result = await deleteMediaFile('/path/to/nonexistent.mp3');

      expect(result).toBe(false);
      expect(unlinkMock).not.toHaveBeenCalled();
    });

    it('deletes file and returns true when file exists', async () => {
      existsSyncMock.mockReturnValue(true);
      unlinkMock.mockResolvedValue(undefined);

      const result = await deleteMediaFile('/path/to/file.mp3');

      expect(result).toBe(true);
      expect(unlinkMock).toHaveBeenCalledWith('/path/to/file.mp3');
    });

    it('returns false on deletion error', async () => {
      existsSyncMock.mockReturnValue(true);
      unlinkMock.mockRejectedValue(new Error('Permission denied'));

      const result = await deleteMediaFile('/path/to/file.mp3');

      expect(result).toBe(false);
    });
  });

  describe('registerMediaEntry', () => {
    const mockEntry = {
      entityType: 'music',
      mediaType: 'audio',
      extension: 'mp3',
      filename: 'bg_calm_tavern_slow.mp3',
      url: '/api/media/test_universe/audio/music/bg_calm_tavern_slow.mp3',
      path: '/path/to/bg_calm_tavern_slow.mp3',
      size: 12345,
      tags: ['TAG_calm', 'TAG_tavern', 'TAG_pace_slow'],
      description: 'Peaceful tavern music',
    };

    it('adds new entry to empty media.json', async () => {
      existsSyncMock.mockReturnValue(false);
      writeFileMock.mockResolvedValue(undefined);

      await registerMediaEntry('test_universe', mockEntry);

      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('media.json'),
        expect.stringContaining('bg_calm_tavern_slow.mp3'),
        'utf-8'
      );

      const writtenContent = JSON.parse(writeFileMock.mock.calls[0][1]);
      expect(writtenContent.media).toHaveLength(1);
      expect(writtenContent.media[0]).toEqual(mockEntry);
    });

    it('adds new entry to existing media.json', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          media: [
            {
              filename: 'existing.mp3',
              url: '/api/media/test/audio/existing.mp3',
              entityType: 'music',
              mediaType: 'audio',
              extension: 'mp3',
              path: '/path/to/existing.mp3',
            },
          ],
        })
      );
      writeFileMock.mockResolvedValue(undefined);

      await registerMediaEntry('test_universe', mockEntry);

      const writtenContent = JSON.parse(writeFileMock.mock.calls[0][1]);
      expect(writtenContent.media).toHaveLength(2);
      expect(writtenContent.media[0].filename).toBe('existing.mp3');
      expect(writtenContent.media[1].filename).toBe('bg_calm_tavern_slow.mp3');
    });

    it('updates existing entry with same URL', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          media: [
            {
              filename: 'bg_calm_tavern_slow.mp3',
              url: mockEntry.url,
              entityType: 'music',
              mediaType: 'audio',
              extension: 'mp3',
              path: '/old/path.mp3',
              description: 'Old description',
            },
          ],
        })
      );
      writeFileMock.mockResolvedValue(undefined);

      await registerMediaEntry('test_universe', mockEntry);

      const writtenContent = JSON.parse(writeFileMock.mock.calls[0][1]);
      expect(writtenContent.media).toHaveLength(1);
      expect(writtenContent.media[0].description).toBe('Peaceful tavern music');
      expect(writtenContent.media[0].path).toBe('/path/to/bg_calm_tavern_slow.mp3');
    });

    it('throws error on write failure', async () => {
      existsSyncMock.mockReturnValue(false);
      writeFileMock.mockRejectedValue(new Error('Write failed'));

      await expect(registerMediaEntry('test_universe', mockEntry)).rejects.toThrow('Write failed');
    });
  });
});
