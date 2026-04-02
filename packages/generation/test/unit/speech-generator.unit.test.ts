import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveVoiceForTTS, generateSpeech, type ResolvedVoice } from '@dmnpc/generation/media/speech-generator.js';
import { generateElevenLabsSpeech } from '@dmnpc/core/clients/elevenlabs-client.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

// Use vi.hoisted to ensure mocks are available when vi.mock factory runs
const { existsMock, downloadFileMock, uploadFileMock } = vi.hoisted(() => ({
  existsMock: vi.fn(),
  downloadFileMock: vi.fn(),
  uploadFileMock: vi.fn(),
}));

// Mock ElevenLabs client
vi.mock('@dmnpc/core/clients/elevenlabs-client.js', () => ({
  generateElevenLabsSpeech: vi.fn(),
}));

// Mock storage service for cache tests
vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  storageService: {
    exists: existsMock,
    downloadFile: downloadFileMock,
    uploadFile: uploadFileMock,
    getPublicUrl: vi.fn((key: string) => `https://test-bucket.s3.amazonaws.com/${key}`),
    deleteFile: vi.fn(),
  },
}));

// Mock voice registry
vi.mock('@dmnpc/core/infra/read-json-file.js', () => ({
  readJsonFileSync: vi.fn(() => [
    {
      id: 'test-voice',
      name: 'Test Voice',
      description: 'A test voice',
      source: 'preset',
      enabled: true,
      metadata: { gender: 'male', ageRange: 'middle-aged', accent: '', traits: [], suitableFor: [] },
      provider: { type: 'elevenlabs', voiceId: 'voice123', settings: { stability: 0.5, similarityBoost: 0.75, style: 0.3, speed: 1.0 } },
    },
    {
      id: 'storyteller-voice',
      name: 'Storyteller Voice',
      description: 'A storyteller voice',
      source: 'preset',
      enabled: true,
      metadata: { gender: 'female', ageRange: 'middle-aged', accent: '', traits: [], suitableFor: [] },
      provider: { type: 'elevenlabs', voiceId: 'st-voice-456', settings: { stability: 0.6, similarityBoost: 0.8, style: 0.4, speed: 0.95 } },
    },
  ]),
}));


describe('generation/speech-generator.ts', () => {
  const mockVoice: ResolvedVoice = {
    voiceId: 'voice123',
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.3,
      speed: 1.0,
    },
  };

  describe('resolveVoiceForTTS', () => {
    it('resolves voice for a character', () => {
      const mockCtx = {
        findCharacter: vi.fn((id: string) => {
          if (id === 'CHAR_test') {
            return {
              id: 'CHAR_test',
              info: { voiceId: 'test-voice' },
            };
          }
          return null;
        }),
      } as unknown as UniverseContext;

      const result = resolveVoiceForTTS(mockCtx, 'CHAR_test');

      expect(result.voiceId).toBe('voice123');
      expect(result.settings.stability).toBe(0.5);
      expect(mockCtx.findCharacter).toHaveBeenCalledWith('CHAR_test');
    });

    it('resolves storyteller voice from player character state', () => {
      const mockCtx = {
        findCharacter: vi.fn((id: string) => {
          if (id === 'CHAR_player') {
            return {
              id: 'CHAR_player',
              info: {
                storytellerState: {
                  voiceId: 'storyteller-voice',
                },
              },
            };
          }
          return null;
        }),
      } as unknown as UniverseContext;

      const result = resolveVoiceForTTS(mockCtx, 'storyteller', 'CHAR_player');

      expect(result.voiceId).toBe('st-voice-456');
      expect(result.settings.stability).toBe(0.6);
    });

    it('throws error when character not found', () => {
      const mockCtx = {
        findCharacter: vi.fn(() => null),
      } as unknown as UniverseContext;

      expect(() => resolveVoiceForTTS(mockCtx, 'CHAR_nonexistent')).toThrow(
        'Character CHAR_nonexistent not found'
      );
    });

    it('throws error when speakerId is storyteller but playerCharacterId is missing', () => {
      const mockCtx = {} as UniverseContext;

      expect(() => resolveVoiceForTTS(mockCtx, 'storyteller')).toThrow(
        'playerCharacterId is required when speakerId is "storyteller"'
      );
    });

    it('throws error when player character not found for storyteller voice', () => {
      const mockCtx = {
        findCharacter: vi.fn(() => null),
      } as unknown as UniverseContext;

      expect(() => resolveVoiceForTTS(mockCtx, 'storyteller', 'CHAR_missing')).toThrow(
        'Player character CHAR_missing not found'
      );
    });

    it('throws error when player character has no storyteller state', () => {
      const mockCtx = {
        findCharacter: vi.fn(() => ({
          id: 'CHAR_player',
          info: {}, // No storytellerState
        })),
      } as unknown as UniverseContext;

      expect(() => resolveVoiceForTTS(mockCtx, 'storyteller', 'CHAR_player')).toThrow(
        'has no storyteller state'
      );
    });
  });

  describe('generateSpeech', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.clearAllMocks();
      process.env.ELEVENLABS_API_KEY = 'test-key';
      // Default: no cache hit
      existsMock.mockResolvedValue(false);
      uploadFileMock.mockResolvedValue('https://test-bucket.s3.amazonaws.com/cache/test.mp3');
    });

    afterEach(() => {
      if (originalEnv.ELEVENLABS_API_KEY !== undefined) {
        process.env.ELEVENLABS_API_KEY = originalEnv.ELEVENLABS_API_KEY;
      } else {
        delete process.env.ELEVENLABS_API_KEY;
      }
    });

    it('generates speech via ElevenLabs', async () => {
      const mockAudio = Buffer.from('fake-audio-data');
      vi.mocked(generateElevenLabsSpeech).mockResolvedValue(mockAudio);

      const uniqueText = `Generate speech test ${Date.now()}`;
      const result = await generateSpeech(uniqueText, mockVoice);

      expect(result.audio).toEqual(mockAudio);
      expect(result.cached).toBe(false);
      expect(generateElevenLabsSpeech).toHaveBeenCalledWith(
        'test-key',
        mockVoice.voiceId,
        uniqueText,
        mockVoice.settings
      );
    });

    it('throws error when ELEVENLABS_API_KEY is not set', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      await expect(generateSpeech('Hello', mockVoice)).rejects.toThrow(
        'ELEVENLABS_API_KEY environment variable is not set'
      );
    });

    it('returns cached audio on cache hit', async () => {
      const mockAudio = Buffer.from('fake-audio-data');
      const cachedAudio = Buffer.from('cached-audio-data');

      // First call - simulate cache miss
      existsMock.mockResolvedValueOnce(false);
      vi.mocked(generateElevenLabsSpeech).mockResolvedValue(mockAudio);

      const uniqueText = `Unique text ${Date.now()}`;
      const result1 = await generateSpeech(uniqueText, mockVoice);
      expect(result1.cached).toBe(false);
      expect(generateElevenLabsSpeech).toHaveBeenCalledTimes(1);

      // Second call - simulate cache hit
      existsMock.mockResolvedValueOnce(true);
      downloadFileMock.mockResolvedValueOnce(cachedAudio);

      const result2 = await generateSpeech(uniqueText, mockVoice);
      expect(result2.cached).toBe(true);
      expect(result2.audio).toEqual(cachedAudio);
      // Should not have called ElevenLabs again
      expect(generateElevenLabsSpeech).toHaveBeenCalledTimes(1);
    });

    it('generates different cache keys for different voice settings', async () => {
      const mockAudio = Buffer.from('fake-audio-data');
      vi.mocked(generateElevenLabsSpeech).mockResolvedValue(mockAudio);

      const uniqueText = `Settings test ${Date.now()}`;
      const voice1 = { ...mockVoice };
      const voice2 = {
        ...mockVoice,
        settings: { ...mockVoice.settings, stability: 0.9 },
      };

      // Call with first voice config
      await generateSpeech(uniqueText, voice1);
      expect(generateElevenLabsSpeech).toHaveBeenCalledTimes(1);

      // Call with different settings - should be cache miss
      await generateSpeech(uniqueText, voice2);
      expect(generateElevenLabsSpeech).toHaveBeenCalledTimes(2);
    });
  });
});
