import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI before importing the module
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      responses: {
        create: vi.fn(),
      },
      chat: {},
    })),
  };
});

// Static import — loads at collection time with openai mock already in place
import { createOpenAIClient } from '@dmnpc/core/clients/openai-client.js';

describe('clients/openai-client.ts', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createOpenAIClient constructs an OpenAI client when OPENAI_API_KEY is set', () => {
    const client = createOpenAIClient();

    expect(client).toBeTruthy();
    expect(typeof (client as any).chat).toBe('object');
  });

  describe('queryLlm retry behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries once by default on transient failure (Empty response)', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      const mockCreate = vi.fn();

      // First call: empty response (transient failure)
      // Second call: success
      mockCreate
        .mockResolvedValueOnce({
          output_text: undefined,
          status: 'incomplete',
          usage: { input_tokens: 100, output_tokens: 0 },
        })
        .mockResolvedValueOnce({
          output_text: 'Success response',
          status: 'completed',
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      OpenAI.mockImplementation(() => ({
        responses: { create: mockCreate },
        chat: {},
      }));

      vi.resetModules();
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');

      const resultPromise = queryLlm({
        prompt: 'Test prompt',
        complexity: 'simple',
        context: 'Test',
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.content).toBe('Success response');
      expect(mockCreate).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    it('does not retry on truncation (structural failure, not transient)', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      const mockCreate = vi.fn();

      // Truncated response — token limit too low
      mockCreate.mockResolvedValueOnce({
        output_text: '{"partial": true',
        status: 'incomplete',
        stop_reason: 'max_output_tokens',
        usage: { input_tokens: 100, output_tokens: 1024 },
      });

      OpenAI.mockImplementation(() => ({
        responses: { create: mockCreate },
        chat: {},
      }));

      vi.resetModules();
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');

      // Truncation fails immediately — no retry delay needed
      await expect(
        queryLlm<{ complete: boolean }>({
          prompt: 'Test prompt',
          complexity: 'simple',
          context: 'Test',
          schema: {
            name: 'test',
            schema: { type: 'object', properties: { complete: { type: 'boolean' } } },
          },
        }),
      ).rejects.toThrow('Response truncated');
      expect(mockCreate).toHaveBeenCalledTimes(1); // No retry — truncation is structural
    });

    it('retries on 429 rate limit with retry-after header', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      const mockCreate = vi.fn();

      // First call: 429 rate limit error
      const rateLimitError = new Error('Rate limit exceeded') as Error & {
        status: number;
        headers: Record<string, string>;
      };
      rateLimitError.status = 429;
      rateLimitError.headers = { 'retry-after': '1' };
      mockCreate.mockRejectedValueOnce(rateLimitError);

      // Second call: success
      mockCreate.mockResolvedValueOnce({
        output_text: 'Success after rate limit',
        status: 'completed',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      OpenAI.mockImplementation(() => ({
        responses: { create: mockCreate },
        chat: {},
      }));

      vi.resetModules();
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');

      const resultPromise = queryLlm({
        prompt: 'Test prompt',
        complexity: 'simple',
        context: 'Test',
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;

      expect(result.content).toBe('Success after rate limit');
      expect(mockCreate).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });

    it('retries on 429 rate limit without retry-after header (uses default 5s)', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      const mockCreate = vi.fn();

      const rateLimitError = new Error('Rate limit exceeded') as Error & {
        status: number;
      };
      rateLimitError.status = 429;
      mockCreate.mockRejectedValueOnce(rateLimitError);

      mockCreate.mockResolvedValueOnce({
        output_text: 'Success',
        status: 'completed',
        usage: { input_tokens: 50, output_tokens: 25 },
      });

      OpenAI.mockImplementation(() => ({
        responses: { create: mockCreate },
        chat: {},
      }));

      vi.resetModules();
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');

      const start = Date.now();
      const resultPromise = queryLlm({
        prompt: 'Test prompt',
        complexity: 'simple',
        context: 'Test',
      });
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await resultPromise;
      const elapsed = Date.now() - start;

      expect(result.content).toBe('Success');
      expect(mockCreate).toHaveBeenCalledTimes(2);
      // Fake timers advanced by 10s; retry waited 5s (default for 429 without retry-after)
      expect(elapsed).toBeGreaterThanOrEqual(4000);
    });

    it('respects retries: 0 to disable retries', async () => {
      const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
      const mockCreate = vi.fn();

      mockCreate.mockResolvedValue({
        output_text: undefined,
        status: 'incomplete',
        usage: { input_tokens: 100, output_tokens: 0 },
      });

      OpenAI.mockImplementation(() => ({
        responses: { create: mockCreate },
        chat: {},
      }));

      vi.resetModules();
      const { queryLlm } = await import('@dmnpc/core/clients/openai-client.js');

      await expect(
        queryLlm({
          prompt: 'Test prompt',
          complexity: 'simple',
          context: 'Test',
          retries: 0,
        })
      ).rejects.toThrow('Empty response');

      expect(mockCreate).toHaveBeenCalledTimes(1); // No retries
    });
  });
});

describe('detectFacePosition', () => {
  it('returns face position from valid vision response', async () => {
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      output_text: '0.15',
      status: 'completed',
    });

    OpenAI.mockImplementation(() => ({
      responses: { create: mockCreate },
      chat: {},
    }));

    vi.resetModules();
    const { detectFacePosition } = await import('@dmnpc/core/clients/openai-client.js');

    const result = await detectFacePosition('base64ImageData', 'Test Character');

    expect(result).toBe(0.15);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns default position when response is invalid', async () => {
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      output_text: 'not a number',
      status: 'completed',
    });

    OpenAI.mockImplementation(() => ({
      responses: { create: mockCreate },
      chat: {},
    }));

    vi.resetModules();
    const { detectFacePosition } = await import('@dmnpc/core/clients/openai-client.js');

    const result = await detectFacePosition('base64ImageData', 'Test Character');

    // Should return default value (0.15)
    expect(result).toBe(0.15);
  });

  it('returns default position on API error', async () => {
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const mockCreate = vi.fn().mockRejectedValueOnce(new Error('API Error'));

    OpenAI.mockImplementation(() => ({
      responses: { create: mockCreate },
      chat: {},
    }));

    vi.resetModules();
    const { detectFacePosition } = await import('@dmnpc/core/clients/openai-client.js');

    const result = await detectFacePosition('base64ImageData', 'Test Character');

    // Should return default value (0.15)
    expect(result).toBe(0.15);
  });

  it('clamps out-of-range values', async () => {
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const mockCreate = vi.fn().mockResolvedValueOnce({
      output_text: '1.5', // Out of range
      status: 'completed',
    });

    OpenAI.mockImplementation(() => ({
      responses: { create: mockCreate },
      chat: {},
    }));

    vi.resetModules();
    const { detectFacePosition } = await import('@dmnpc/core/clients/openai-client.js');

    const result = await detectFacePosition('base64ImageData', 'Test Character');

    // Should return default value since 1.5 is > 1
    expect(result).toBe(0.15);
  });
});

describe('generateImage and editImage error logging', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs full prompt when generateImage fails (e.g. safety violation)', async () => {
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const mockGenerate = vi.fn().mockRejectedValue(new Error('content_filter'));

    OpenAI.mockImplementation(() => ({
      images: { generate: mockGenerate, edit: vi.fn() },
    }));

    vi.resetModules();
    const { generateImage } = await import('@dmnpc/core/clients/openai-client.js');
    const { logger } = await import('@dmnpc/core/infra/logger.js');

    const errorSpy = vi.spyOn(logger, 'error');
    const testPrompt = 'Role-playing game character portrait: Gandalf the Grey.';

    await expect(
      generateImage({ prompt: testPrompt, size: '1024x1536', context: 'Test Portrait' })
    ).rejects.toThrow('content_filter');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, , metadata] = errorSpy.mock.calls[0] ?? [];
    expect(metadata).toBeDefined();
    expect(metadata).toMatchObject({ prompt: testPrompt });
  });

  it('logs prompt and referenceImageUsed when editImage fails', async () => {
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const mockEdit = vi.fn().mockRejectedValue(new Error('content_filter'));

    OpenAI.mockImplementation(() => ({
      images: { generate: vi.fn(), edit: mockEdit },
    }));

    vi.resetModules();
    const { editImage } = await import('@dmnpc/core/clients/openai-client.js');
    const { logger } = await import('@dmnpc/core/infra/logger.js');

    const errorSpy = vi.spyOn(logger, 'error');
    const testPrompt = 'Create full-body portrait from this pixel-art sprite.';

    await expect(
      editImage({
        image: Buffer.alloc(100),
        prompt: testPrompt,
        size: '1024x1536',
        context: 'Test Edit',
      })
    ).rejects.toThrow('content_filter');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, , metadata] = errorSpy.mock.calls[0] ?? [];
    expect(metadata).toBeDefined();
    expect(metadata).toMatchObject({
      prompt: testPrompt,
      referenceImageUsed: true,
    });
  });

  it('truncates long prompts in error log', async () => {
    const OpenAI = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const mockGenerate = vi.fn().mockRejectedValue(new Error('content_filter'));

    OpenAI.mockImplementation(() => ({
      images: { generate: mockGenerate, edit: vi.fn() },
    }));

    vi.resetModules();
    const { generateImage } = await import('@dmnpc/core/clients/openai-client.js');
    const { logger } = await import('@dmnpc/core/infra/logger.js');

    const errorSpy = vi.spyOn(logger, 'error');
    const longPrompt = 'x'.repeat(600);

    await expect(
      generateImage({ prompt: longPrompt, size: '1024x1536', context: 'Test' })
    ).rejects.toThrow('content_filter');

    const [, , metadata] = errorSpy.mock.calls[0] ?? [];
    expect(metadata).toBeDefined();
    expect(metadata?.prompt).toContain('[truncated]');
    expect((metadata?.prompt as string).length).toBeLessThanOrEqual(520);
  });
});
