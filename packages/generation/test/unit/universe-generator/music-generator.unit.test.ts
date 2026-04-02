import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so mock fns are available before vi.mock() factories run
const { generateSoundEffectMock, uploadFileMock, mockUniverseContext } = vi.hoisted(() => ({
  generateSoundEffectMock: vi.fn(),
  uploadFileMock: vi.fn(),
  mockUniverseContext: {
    universe: { id: 'test_universe' },
    getCharacter: vi.fn(),
    getPlace: vi.fn(),
  },
}));

vi.mock('@dmnpc/core/clients/elevenlabs-client.js', () => ({
  generateSoundEffect: generateSoundEffectMock,
}));

vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  storageService: {
    uploadFile: uploadFileMock,
    getPublicUrl: vi.fn((key: string) => `https://test-bucket.s3.us-east-1.amazonaws.com/${key}`),
    exists: vi.fn().mockResolvedValue(true),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Static import — loads at collection time with mocks in place
import { generateCharacterMusic } from '@dmnpc/generation/media/music-generator.js';

const mockCharacter = {
  id: 'CHAR_test',
  label: 'Test Character',
  position: { parent: 'PLACE_tavern' },
  info: {
    placeId: 'PLACE_tavern',
  },
};

const mockPlace = {
  id: 'PLACE_tavern',
  label: 'The Golden Tankard',
  description: 'A cozy tavern',
};

describe('generation/music-generator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mocks
    mockUniverseContext.getCharacter.mockReturnValue(mockCharacter);
    mockUniverseContext.getPlace.mockReturnValue(mockPlace);
    uploadFileMock.mockResolvedValue(
      'https://test-bucket.s3.us-east-1.amazonaws.com/universes/test_universe/audio/music/test.mp3'
    );

    // Reset environment variable
    delete process.env.DISABLE_AUDIO_GENERATION;
  });

  afterEach(() => {
    delete process.env.DISABLE_AUDIO_GENERATION;
  });

  // Removed dynamic import — using static import instead

  describe('generateCharacterMusic', () => {
    it('generates music with mood and instrument', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'happy', 'harp');

      expect(result.success).toBe(true);
      expect(result.audioUrl).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
      expect(result.error).toBeUndefined();

      // Verify ElevenLabs was called with correct prompt
      expect(generateSoundEffectMock).toHaveBeenCalledWith(
        'A happy harp melody, solo performance',
        expect.objectContaining({
          durationSeconds: 30,
          promptInfluence: 0.7,
        })
      );
    });

    it('generates music with mood only (defaults to mandolin via lute mapping)', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'sad');

      expect(result.success).toBe(true);
      // Default instrument is 'lute' which maps to 'mandolin'
      expect(generateSoundEffectMock).toHaveBeenCalledWith(
        'A sad mandolin melody, solo performance',
        expect.any(Object)
      );
    });

    it('generates music with instrument only (no mood)', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });

      const result = await generateCharacterMusic(
        mockUniverseContext as any,
        'CHAR_test',
        undefined,
        'flute'
      );

      expect(result.success).toBe(true);
      expect(generateSoundEffectMock).toHaveBeenCalledWith(
        'A flute melody, solo performance',
        expect.any(Object)
      );
    });

    it('generates music with no mood or instrument (defaults to mandolin via lute mapping)', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test');

      expect(result.success).toBe(true);
      // Default instrument is 'lute' which maps to 'mandolin'
      expect(generateSoundEffectMock).toHaveBeenCalledWith(
        'A mandolin melody, solo performance',
        expect.any(Object)
      );
    });

    it('maps lute to mandolin for better ElevenLabs compatibility', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'happy', 'lute');

      expect(result.success).toBe(true);
      // 'lute' should be mapped to 'mandolin'
      expect(generateSoundEffectMock).toHaveBeenCalledWith(
        'A happy mandolin melody, solo performance',
        expect.any(Object)
      );
    });

    it('maps instrument case-insensitively', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'joyful', 'LUTE');

      expect(result.success).toBe(true);
      // 'LUTE' should be lowercased and mapped to 'mandolin'
      expect(generateSoundEffectMock).toHaveBeenCalledWith(
        'A joyful mandolin melody, solo performance',
        expect.any(Object)
      );
    });

    it('returns error when audio generation is disabled', async () => {
      process.env.DISABLE_AUDIO_GENERATION = 'true';

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'happy', 'harp');

      expect(result.success).toBe(false);
      expect(result.audioUrl).toBeNull();
      expect(result.error).toBe('Audio generation is disabled');
      expect(generateSoundEffectMock).not.toHaveBeenCalled();
    });

    it('returns error when ElevenLabs API fails', async () => {

      generateSoundEffectMock.mockRejectedValueOnce(new Error('ElevenLabs API error: 500'));

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'happy', 'harp');

      expect(result.success).toBe(false);
      expect(result.audioUrl).toBeNull();
      expect(result.error).toBe('ElevenLabs API error: 500');
    });

    it('returns error when S3 upload fails', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });
      uploadFileMock.mockRejectedValueOnce(new Error('S3 upload failed'));

      const result = await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'happy', 'harp');

      expect(result.success).toBe(false);
      expect(result.error).toContain('S3 upload failed');
    });

    it('uploads audio file to S3 with correct key format', async () => {

      const fakeAudio = Buffer.from('fake audio data');
      generateSoundEffectMock.mockResolvedValueOnce({
        audio: fakeAudio,
        durationMs: 1000,
      });

      await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'happy', 'harp');

      // Check that uploadFile was called with a key containing audio/music path
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.stringMatching(/universes\/test_universe\/audio\/music\/music_CHAR_test_\d+\.mp3$/),
        fakeAudio,
        'audio/mpeg'
      );
    });
  });

  describe('buildMusicPrompt (via generateCharacterMusic)', () => {
    it('builds prompt with voice for singing/humming', async () => {

      generateSoundEffectMock.mockResolvedValueOnce({
        audio: Buffer.from('fake audio data'),
        durationMs: 1000,
      });

      await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'melancholic', 'voice');

      expect(generateSoundEffectMock).toHaveBeenCalledWith(
        'A melancholic voice melody, solo performance',
        expect.any(Object)
      );
    });

    it('handles various mood types', async () => {
      const moods = ['triumphant', 'peaceful', 'energetic', 'haunting'];

      for (const mood of moods) {
        generateSoundEffectMock.mockResolvedValueOnce({
          audio: Buffer.from('fake audio data'),
          durationMs: 1000,
        });

        await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', mood, 'harp');

        expect(generateSoundEffectMock).toHaveBeenCalledWith(
          `A ${mood} harp melody, solo performance`,
          expect.any(Object)
        );
      }
    });

    it('handles various instrument types', async () => {
      const instruments = ['drum', 'violin', 'mandolin', 'pan flute'];

      for (const instrument of instruments) {
        generateSoundEffectMock.mockResolvedValueOnce({
          audio: Buffer.from('fake audio data'),
          durationMs: 1000,
        });

        await generateCharacterMusic(mockUniverseContext as any, 'CHAR_test', 'gentle', instrument);

        expect(generateSoundEffectMock).toHaveBeenCalledWith(
          `A gentle ${instrument} melody, solo performance`,
          expect.any(Object)
        );
      }
    });
  });
});
