import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOpenAIError } from '@dmnpc/core/clients/openai-client.js';

describe('clients/openai-client.ts — handleOpenAIError', () => {
  it('handleOpenAIError maps rate limit with retryAfter', () => {
    const err = { status: 429, headers: { 'retry-after': '7' } };
    const result = handleOpenAIError(err);
    expect(result.status).toBe(429);
    expect(result.message).toBe('Rate limit exceeded. Please wait a moment and try again.');
    // Parse the string header value to number
    expect(Number(result.retryAfter)).toBe(7);
  });

  it('handleOpenAIError maps auth error', () => {
    const err = { status: 401 };
    expect(handleOpenAIError(err)).toEqual({
      status: 401,
      message: 'Invalid API key. Please check your OPENAI_API_KEY environment variable.',
    });
  });

  it('handleOpenAIError maps token error', () => {
    const err = { status: 400, message: 'token limit exceeded' };
    expect(handleOpenAIError(err)).toEqual({
      status: 400,
      message: 'Message is too long. Please shorten your message or start a new conversation.',
    });
  });

  it('handleOpenAIError maps quota/billing error', () => {
    const err = { status: 402, message: 'billing' };
    expect(handleOpenAIError(err)).toEqual({
      status: 402,
      message: 'API quota exceeded. Please check your OpenAI account billing and usage limits.',
    });
  });

  it('handleOpenAIError falls back to generic', () => {
    const err = { status: 500, message: 'boom' };
    expect(handleOpenAIError(err)).toEqual({ status: 500, message: 'boom' });
  });
});

// Note: Tests for generateImage, editImage, and detectExitPositions are now in openai-client.unit.test.ts
// as these functions have been moved to openai-client.ts
