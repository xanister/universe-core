import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so mock fns are available before vi.mock() factories run (hoisted)
const {
  generateMusicMock,
  queryLlmMock,
  registerMediaEntryMock,
  uploadFileMock,
  existsMock,
} = vi.hoisted(() => ({
  generateMusicMock: vi.fn(),
  queryLlmMock: vi.fn(),
  registerMediaEntryMock: vi.fn(),
  uploadFileMock: vi.fn().mockImplementation((key: string) =>
    Promise.resolve(`https://test-bucket.s3.us-east-1.amazonaws.com/${key}`)
  ),
  existsMock: vi.fn(),
}));

// Mock ElevenLabs client
vi.mock('@dmnpc/core/clients/elevenlabs-client.js', () => ({
  generateMusic: generateMusicMock,
}));

// Mock OpenAI client
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: queryLlmMock,
}));

const TEST_UNIVERSE_ID = 'test_universe';

// Mock media-helpers
vi.mock('@dmnpc/generation/media-helpers.js', () => ({
  registerMediaEntry: registerMediaEntryMock,
}));

// Mock storage service
vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  storageService: {
    uploadFile: uploadFileMock,
    getPublicUrl: vi.fn(
      (key: string) => `https://test-bucket.s3.us-east-1.amazonaws.com/${key}`
    ),
    exists: existsMock,
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Static import — loads at collection time with mocks already in place
import {
  buildMusicSignature,
  parseMusicSignature,
  buildMusicPrompt,
  buildMusicDescription,
  determineMusicRequirement,
  getBackgroundMusic,
  generateBackgroundMusic,
  getOrGenerateBackgroundMusic,
  DRAMATIC_STATES,
} from '@dmnpc/generation/media/background-music-generator.js';

// Test data - MusicContext with purpose (LLM determines dramaticState and pace)
const mockContext = {
  purpose: 'tavern' as const,
  placeTags: ['TAG_tavern', 'TAG_lively'],
  placeLabel: 'The Golden Tankard',
  placeDescription: 'A cozy tavern with warm firelight',
  isInterior: true,
  timeOfDay: 'evening',
  weather: 'clear',
  eventType: 'none',
  activityLevel: 'crowded' as const,
  recentTranscript: 'PLAYER: I order an ale.\nDM: The barmaid pours you a frothy drink.',
};

describe('generation/background-music-generator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsMock.mockResolvedValue(false);
    // Reset uploadFileMock to return URL with the key
    uploadFileMock.mockImplementation((key: string) => 
      Promise.resolve(`https://test-bucket.s3.us-east-1.amazonaws.com/${key}`)
    );
    registerMediaEntryMock.mockResolvedValue(undefined);
    delete process.env.DISABLE_AUDIO_GENERATION;
  });

  afterEach(() => {
    delete process.env.DISABLE_AUDIO_GENERATION;
  });

  // Removed getModule() — using static import instead (see top of file)

  describe('buildMusicSignature', () => {
    it('builds correct signature from requirement', async () => {

      expect(
        buildMusicSignature({ dramaticState: 'combat', purpose: 'tavern', pace: 'fast' })
      ).toBe('combat_tavern_fast');
      expect(
        buildMusicSignature({
          dramaticState: 'exploration',
          purpose: 'forest',
          pace: 'medium',
        })
      ).toBe('exploration_forest_medium');
      expect(
        buildMusicSignature({ dramaticState: 'calm', purpose: 'temple', pace: 'slow' })
      ).toBe('calm_temple_slow');
    });

    it('handles purpose with underscore (e.g. throne_room)', async () => {

      expect(
        buildMusicSignature({
          dramaticState: 'victory',
          purpose: 'throne_room',
          pace: 'medium',
        })
      ).toBe('victory_throne_room_medium');
    });
  });

  describe('parseMusicSignature', () => {
    it('parses valid signature back to requirement', async () => {

      expect(parseMusicSignature('combat_tavern_fast')).toEqual({
        dramaticState: 'combat',
        purpose: 'tavern',
        pace: 'fast',
      });
      expect(parseMusicSignature('exploration_forest_medium')).toEqual({
        dramaticState: 'exploration',
        purpose: 'forest',
        pace: 'medium',
      });
    });

    it('parses signature with purpose containing underscore', async () => {

      expect(parseMusicSignature('calm_storage_room_slow')).toEqual({
        dramaticState: 'calm',
        purpose: 'storage_room',
        pace: 'slow',
      });
    });

    it('returns null for invalid signatures', async () => {

      expect(parseMusicSignature('invalid')).toBeNull();
      expect(parseMusicSignature('combat')).toBeNull();
      // Purposes are now dynamic strings, so any non-empty purpose is valid
      // Only invalid dramatic states or malformed formats return null
      expect(parseMusicSignature('invalid_tavern_fast')).toBeNull();
      expect(parseMusicSignature('a_b_c')).toBeNull();
    });
  });

  describe('buildMusicPrompt', () => {
    it('builds prompt with purpose in natural language', async () => {

      const prompt = buildMusicPrompt({
        dramaticState: 'calm',
        purpose: 'tavern',
        pace: 'slow',
      });

      expect(prompt).toContain('peaceful');
      expect(prompt).toContain('tavern');
      expect(prompt).toContain('Cinematic');
      expect(prompt).toContain('no vocals');
    });

    it('builds prompt for jail subtype', async () => {

      const prompt = buildMusicPrompt({
        dramaticState: 'progress',
        purpose: 'jail',
        pace: 'fast',
      });

      expect(prompt).toContain('suspenseful');
      expect(prompt).toContain('jail');
    });

    it('builds prompt for docks subtype', async () => {

      const prompt = buildMusicPrompt({
        dramaticState: 'victory',
        purpose: 'docks',
        pace: 'fast',
      });

      expect(prompt).toContain('triumphant');
      expect(prompt).toContain('docks');
    });

    it('uses universe instrumentation overrides', async () => {

      const requirement = {
        dramaticState: 'calm' as const,
        purpose: 'tavern' as const,
        pace: 'slow' as const,
      };

      const config = {
        instrumentationOverrides: {
          tavern: 'hurdy-gurdy, bodhran, dark accordion',
        },
      };

      const prompt = buildMusicPrompt(requirement, config);

      expect(prompt).toContain('hurdy-gurdy');
      expect(prompt).toContain('bodhran');
    });
  });

  describe('buildMusicDescription', () => {
    it('builds human-readable description', async () => {

      expect(
        buildMusicDescription({ dramaticState: 'calm', purpose: 'tavern', pace: 'slow' })
      ).toBe(
        'Peaceful, reflective, serene, deliberate, contemplative tempo RPG music for a tavern setting.'
      );

      expect(
        buildMusicDescription({ dramaticState: 'combat', purpose: 'jail', pace: 'fast' })
      ).toBe(
        'Intense, urgent, dangerous, urgent, energetic tempo RPG music for a jail setting.'
      );
    });
  });

  describe('determineMusicRequirement', () => {
    it('always calls LLM to determine requirement', async () => {

      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'calm',
          pace: 'medium',
          reasoning: 'A cozy tavern scene with patrons drinking.',
        },
      });

      const result = await determineMusicRequirement(mockContext);

      expect(queryLlmMock).toHaveBeenCalled();
      expect(result.dramaticState).toBe('calm');
      expect(result.purpose).toBe('tavern');
      expect(result.pace).toBe('medium');
    });

    it('passes scene context to LLM', async () => {

      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'progress',
          pace: 'fast',
          reasoning: 'Scene suggests danger.',
        },
      });

      await determineMusicRequirement({
        ...mockContext,
        placeLabel: 'Dark Cave',
        placeDescription: 'A damp cave with echoing drips',
        weather: 'storm',
      });

      // Verify the prompt includes scene context
      const promptArg = queryLlmMock.mock.calls[0][0].prompt;
      expect(promptArg).toContain('Dark Cave');
      expect(promptArg).toContain('damp cave');
      expect(promptArg).toContain('storm');
    });

    it('passes place hints to LLM', async () => {

      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'calm',
          pace: 'slow',
          reasoning: 'Cozy atmosphere.',
        },
      });

      await determineMusicRequirement(mockContext, {
        placeHints: { hints: 'warm fireplace ambience' },
      });

      const promptArg = queryLlmMock.mock.calls[0][0].prompt;
      expect(promptArg).toContain('warm fireplace ambience');
    });

    it('passes target mood and pace to LLM as suggestions', async () => {

      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'combat',
          pace: 'fast',
          reasoning: 'Combat situation.',
        },
      });

      await determineMusicRequirement(mockContext, {
        targetMood: 'combat',
        targetPace: 'fast',
      });

      const promptArg = queryLlmMock.mock.calls[0][0].prompt;
      expect(promptArg).toContain('combat');
      expect(promptArg).toContain('fast');
    });

    it('throws error when LLM fails', async () => {

      queryLlmMock.mockRejectedValue(new Error('LLM error'));

      await expect(determineMusicRequirement(mockContext)).rejects.toThrow('LLM error');
    });

    it('throws error for invalid LLM response', async () => {

      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'invalid_state',
          pace: 'slow',
          reasoning: 'Test.',
        },
      });

      await expect(determineMusicRequirement(mockContext)).rejects.toThrow(
        'Invalid LLM dramatic state: invalid_state'
      );
    });
  });

  describe('getBackgroundMusic', () => {
    it('returns null when file does not exist in S3', async () => {

      existsMock.mockResolvedValue(false);

      const result = await getBackgroundMusic(TEST_UNIVERSE_ID, 'combat_tavern_fast');

      expect(result).toBeNull();
    });

    it('returns S3 URL when file exists', async () => {

      existsMock.mockResolvedValue(true);

      const result = await getBackgroundMusic(TEST_UNIVERSE_ID, 'combat_tavern_fast');

      expect(result).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
      expect(result).toContain('bg_combat_tavern_fast.mp3');
    });
  });

  describe('generateBackgroundMusic', () => {
    it('generates music and registers in media.json', async () => {

      generateMusicMock.mockResolvedValue({
        audio: Buffer.from('fake audio data'),
        durationMs: 5000,
      });

      const result = await generateBackgroundMusic(TEST_UNIVERSE_ID, 'calm_tavern_slow', {
        dramaticState: 'calm',
        purpose: 'tavern',
        pace: 'slow',
      });

      expect(result.success !== false).toBe(true);
      expect(result.url).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
      expect(result.url).toContain('bg_calm_tavern_slow.mp3');
      expect(result.signature).toBe('calm_tavern_slow');
      expect(result.generated).toBe(true);

      // Verify ElevenLabs was called
      expect(generateMusicMock).toHaveBeenCalledWith(
        expect.stringContaining('Instrumental RPG'),
        expect.objectContaining({
          durationSeconds: 90,
          instrumental: true,
        })
      );

      // Verify file was uploaded to S3
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.stringMatching(/universes\/test_universe\/audio\/music\/bg_calm_tavern_slow\.mp3$/),
        expect.any(Buffer),
        'audio/mpeg'
      );

      // Verify media entry was registered
      expect(registerMediaEntryMock).toHaveBeenCalledWith(
        'test_universe',
        expect.objectContaining({
          entityType: 'music',
          mediaType: 'audio',
          tags: ['TAG_calm', 'TAG_tavern', 'TAG_pace_slow'],
        })
      );
    });

    it('appends instructions to prompt when provided', async () => {

      generateMusicMock.mockResolvedValue({
        audio: Buffer.from('fake audio data'),
        durationMs: 5000,
      });

      await generateBackgroundMusic(
        TEST_UNIVERSE_ID,
        'calm_tavern_slow',
        { dramaticState: 'calm', purpose: 'tavern', pace: 'slow' },
        { instructions: 'Make it more dramatic with heavy percussion' }
      );

      // Verify the prompt includes the instructions
      expect(generateMusicMock).toHaveBeenCalledWith(
        expect.stringContaining('Additional guidance: Make it more dramatic with heavy percussion'),
        expect.any(Object)
      );
    });

    it('ignores empty instructions', async () => {

      generateMusicMock.mockResolvedValue({
        audio: Buffer.from('fake audio data'),
        durationMs: 5000,
      });

      await generateBackgroundMusic(
        TEST_UNIVERSE_ID,
        'calm_tavern_slow',
        { dramaticState: 'calm', purpose: 'tavern', pace: 'slow' },
        { instructions: '   ' } // whitespace-only instructions
      );

      // Verify the prompt does NOT include "Additional guidance"
      expect(generateMusicMock).toHaveBeenCalledWith(
        expect.not.stringContaining('Additional guidance'),
        expect.any(Object)
      );
    });

    it('throws error when audio generation is disabled', async () => {
      process.env.DISABLE_AUDIO_GENERATION = 'true';

      await expect(
        generateBackgroundMusic(TEST_UNIVERSE_ID, 'calm_tavern_slow', {
          dramaticState: 'calm',
          purpose: 'tavern',
          pace: 'slow',
        })
      ).rejects.toThrow('Audio generation is disabled');

      expect(generateMusicMock).not.toHaveBeenCalled();
    });

    it('throws error when ElevenLabs fails', async () => {

      generateMusicMock.mockRejectedValue(new Error('ElevenLabs API error'));

      await expect(
        generateBackgroundMusic(TEST_UNIVERSE_ID, 'calm_tavern_slow', {
          dramaticState: 'calm',
          purpose: 'tavern',
          pace: 'slow',
        })
      ).rejects.toThrow('ElevenLabs API error');
    });
  });

  describe('getOrGenerateBackgroundMusic', () => {
    it('returns cached music when it exists', async () => {

      existsMock.mockResolvedValue(true);
      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'exploration',
          pace: 'medium',
          reasoning: 'A lively tavern scene.',
        },
      });

      const result = await getOrGenerateBackgroundMusic(TEST_UNIVERSE_ID, mockContext);

      expect(result).not.toBeNull();
      expect(result.generated).toBe(false);
      expect(result.url).toContain('bg_exploration_tavern_medium.mp3');
      expect(generateMusicMock).not.toHaveBeenCalled();
    });

    it('generates music when cache miss', async () => {

      existsMock.mockResolvedValue(false);
      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'exploration',
          pace: 'medium',
          reasoning: 'A lively tavern scene.',
        },
      });
      generateMusicMock.mockResolvedValue({
        audio: Buffer.from('fake audio'),
        durationMs: 5000,
      });

      const result = await getOrGenerateBackgroundMusic(TEST_UNIVERSE_ID, mockContext);

      expect(result).not.toBeNull();
      expect(result.generated).toBe(true);
      expect(generateMusicMock).toHaveBeenCalled();
    });

    it('throws error on LLM failure', async () => {

      existsMock.mockResolvedValue(false);
      queryLlmMock.mockRejectedValue(new Error('LLM failed'));

      await expect(getOrGenerateBackgroundMusic(TEST_UNIVERSE_ID, mockContext)).rejects.toThrow(
        'LLM failed'
      );
    });

    it('throws error on generation failure', async () => {

      existsMock.mockResolvedValue(false);
      queryLlmMock.mockResolvedValue({
        content: {
          dramaticState: 'exploration',
          pace: 'medium',
          reasoning: 'Test.',
        },
      });
      generateMusicMock.mockRejectedValue(new Error('Generation failed'));

      await expect(getOrGenerateBackgroundMusic(TEST_UNIVERSE_ID, mockContext)).rejects.toThrow(
        'Generation failed'
      );
    });
  });

  describe('DRAMATIC_STATES constant', () => {
    it('exports all expected dramatic states', async () => {

      expect(DRAMATIC_STATES).toContain('exploration');
      expect(DRAMATIC_STATES).toContain('calm');
      expect(DRAMATIC_STATES).toContain('progress');
      expect(DRAMATIC_STATES).toContain('combat');
      expect(DRAMATIC_STATES).toContain('victory');
      expect(DRAMATIC_STATES).toContain('mystery');
      expect(DRAMATIC_STATES).toContain('melancholy');
      expect(DRAMATIC_STATES).toHaveLength(7);
    });
  });
});
