import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config (must be hoisted — vi.mock factories run before module-scope const initializers)
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    elevenLabsApiKey: 'test-api-key',
  },
}));
vi.mock('@dmnpc/core/infra/config.js', () => ({
  config: mockConfig,
}));

// No need to mock barrel-level deps since we import from subpath directly

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('lib/elevenlabs-client.ts', () => {
  beforeEach(() => {
    mockConfig.elevenLabsApiKey = 'test-api-key';
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function getModule() {
    vi.resetModules();
    return await import('@dmnpc/core/clients/elevenlabs-client.js');
  }

  describe('generateCorrelationId', () => {
    it('generates unique IDs with el- prefix', async () => {
      const { generateCorrelationId } = await getModule();

      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      expect(id1).toMatch(/^el-/);
      expect(id2).toMatch(/^el-/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateSoundEffect', () => {
    it('generates sound effect successfully', async () => {
      const { generateSoundEffect } = await getModule();

      const mockAudio = Buffer.from('fake audio data');
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudio.buffer.slice(0),
      });

      const result = await generateSoundEffect('tavern ambient sounds');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/sound-generation',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-api-key',
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('throws error when API key is not configured', async () => {
      mockConfig.elevenLabsApiKey = '';
      const { generateSoundEffect } = await getModule();

      await expect(generateSoundEffect('test')).rejects.toThrow(
        'ELEVENLABS_API_KEY is not configured'
      );
    });

    it('throws error on API error response', async () => {
      const { generateSoundEffect } = await getModule();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Invalid prompt' }),
      });

      await expect(generateSoundEffect('test')).rejects.toThrow('Invalid prompt');
    });

    it('passes duration and prompt influence options', async () => {
      const { generateSoundEffect } = await getModule();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      });

      await generateSoundEffect('test', {
        durationSeconds: 10,
        promptInfluence: 0.8,
        loop: true,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.duration_seconds).toBe(10);
      expect(requestBody.prompt_influence).toBe(0.8);
      expect(requestBody.loop).toBe(true);
    });
  });

  describe('generateMusic', () => {
    it('generates music successfully', async () => {
      const { generateMusic } = await getModule();

      const mockAudio = Buffer.from('fake music data');
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudio.buffer.slice(0),
      });

      const result = await generateMusic('fantasy tavern background music');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/music',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'test-api-key',
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('throws error when API key is not configured', async () => {
      mockConfig.elevenLabsApiKey = '';
      const { generateMusic } = await getModule();

      await expect(generateMusic('test')).rejects.toThrow('ELEVENLABS_API_KEY is not configured');
    });

    it('throws error on API error response', async () => {
      const { generateMusic } = await getModule();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Invalid music prompt' }),
      });

      await expect(generateMusic('test')).rejects.toThrow('Invalid music prompt');
    });

    it('uses model_id music_v1 in request', async () => {
      const { generateMusic } = await getModule();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      });

      await generateMusic('test');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.model_id).toBe('music_v1');
    });

    it('passes duration and instrumental options', async () => {
      const { generateMusic } = await getModule();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      });

      await generateMusic('test', {
        durationSeconds: 90,
        instrumental: true,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.music_length_ms).toBe(90000); // 90 seconds in ms
      expect(requestBody.force_instrumental).toBe(true);
    });

    it('defaults instrumental to true', async () => {
      const { generateMusic } = await getModule();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      });

      await generateMusic('test');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.force_instrumental).toBe(true);
    });

    it('allows vocal music when instrumental is false', async () => {
      const { generateMusic } = await getModule();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      });

      await generateMusic('test', { instrumental: false });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.force_instrumental).toBe(false);
    });

    it('handles network errors', async () => {
      const { generateMusic } = await getModule();

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(generateMusic('test')).rejects.toThrow('Network error');
    });

    it('handles non-JSON error responses', async () => {
      const { generateMusic } = await getModule();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(generateMusic('test')).rejects.toThrow('ElevenLabs Music API error: 500');
    });
  });

  describe('handleElevenLabsError', () => {
    it('returns specific message for 401 error', async () => {
      const { handleElevenLabsError } = await getModule();

      const result = handleElevenLabsError({ status: 401 });

      expect(result.status).toBe(401);
      expect(result.message).toContain('Invalid API key');
    });

    it('returns specific message for 429 error', async () => {
      const { handleElevenLabsError } = await getModule();

      const result = handleElevenLabsError({ status: 429 });

      expect(result.status).toBe(429);
      expect(result.message).toContain('Rate limit exceeded');
    });

    it('returns specific message for 422 error', async () => {
      const { handleElevenLabsError } = await getModule();

      const result = handleElevenLabsError({ status: 422 });

      expect(result.status).toBe(422);
      expect(result.message).toContain('Invalid request parameters');
    });

    it('returns generic message for unknown errors', async () => {
      const { handleElevenLabsError } = await getModule();

      const result = handleElevenLabsError({ status: 503, message: 'Service unavailable' });

      expect(result.status).toBe(503);
      expect(result.message).toBe('Service unavailable');
    });
  });

  describe('listElevenLabsVoices', () => {
    it('fetches and returns voice list', async () => {
      const { listElevenLabsVoices } = await getModule();

      const mockVoices = [
        { voice_id: 'abc123', name: 'Rachel', category: 'premade' },
        { voice_id: 'def456', name: 'Adam', category: 'premade' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ voices: mockVoices }),
      });

      const result = await listElevenLabsVoices('test-api-key');

      expect(mockFetch).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'xi-api-key': 'test-api-key',
        },
      });
      expect(result).toEqual(mockVoices);
    });

    it('throws error on API failure', async () => {
      const { listElevenLabsVoices } = await getModule();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(listElevenLabsVoices('bad-key')).rejects.toThrow(
        'ElevenLabs API error: 401 - Unauthorized'
      );
    });
  });

  describe('generateElevenLabsSpeech', () => {
    it('generates speech with default settings', async () => {
      const { generateElevenLabsSpeech } = await getModule();

      const mockAudio = Buffer.from('fake audio data');
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockAudio.buffer.slice(0),
      });

      const result = await generateElevenLabsSpeech('test-api-key', 'voice123', 'Hello world');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice123',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': 'test-api-key',
          }),
        })
      );

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.text).toBe('Hello world');
      expect(requestBody.model_id).toBe('eleven_multilingual_v2');
      expect(requestBody.voice_settings.stability).toBe(0.5);
      expect(requestBody.voice_settings.similarity_boost).toBe(0.75);
      expect(requestBody.voice_settings.style).toBe(0);
      expect(requestBody.voice_settings.speed).toBe(1.0);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('applies custom voice settings', async () => {
      const { generateElevenLabsSpeech } = await getModule();

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      });

      await generateElevenLabsSpeech('test-api-key', 'voice123', 'Hello', {
        stability: 0.3,
        similarityBoost: 0.9,
        style: 0.5,
        speed: 1.1,
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.voice_settings.stability).toBe(0.3);
      expect(requestBody.voice_settings.similarity_boost).toBe(0.9);
      expect(requestBody.voice_settings.style).toBe(0.5);
      expect(requestBody.voice_settings.speed).toBe(1.1);
    });

    it('throws error on API failure', async () => {
      const { generateElevenLabsSpeech } = await getModule();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Voice not found',
      });

      await expect(
        generateElevenLabsSpeech('test-api-key', 'invalid-voice', 'Hello')
      ).rejects.toThrow('ElevenLabs API error: 400 - Voice not found');
    });

    it('handles network errors', async () => {
      const { generateElevenLabsSpeech } = await getModule();

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(generateElevenLabsSpeech('test-api-key', 'voice123', 'Hello')).rejects.toThrow(
        'Network error'
      );
    });
  });
});
