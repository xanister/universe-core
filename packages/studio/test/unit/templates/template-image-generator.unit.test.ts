/**
 * Unit tests for Template Image Generator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mock is available when vi.mock factory runs
const { generateImageMock } = vi.hoisted(() => ({
  generateImageMock: vi.fn(),
}));

// Mock OpenAI
vi.mock('@dmnpc/core/clients/openai-client.js', async () => {
  const actual = await vi.importActual<typeof import('@dmnpc/core/clients/openai-client.js')>('@dmnpc/core/clients/openai-client.js');
  return {
    ...actual,
    generateImage: generateImageMock,
  };
});

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { generateImage } from '@dmnpc/core/clients/openai-client.js';
import { generateTemplateImage } from '@dmnpc/studio/templates/template-image-generator.js';

describe('generateTemplateImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure DISABLE_IMAGE_GENERATION is not set for these tests
    delete process.env.DISABLE_IMAGE_GENERATION;
  });

  it('generates an image from template data', async () => {
    const mockBase64 = 'mockBase64ImageData';
    generateImageMock.mockResolvedValue({
      base64: mockBase64,
      durationMs: 100,
    });

    const result = await generateTemplateImage({
      template: {
        label: 'Test Character',
        description: 'A tall warrior with battle scars.',
        personality: 'Stoic and brave.',
        physicalTraits: {
          gender: 'male',
          eyeColor: 'blue',
          hairColor: 'black',
        },
      },
    });

    expect(result).toBe(mockBase64);
    expect(generateImageMock).toHaveBeenCalledOnce();
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'Template Character Image Generation',
        size: '1024x1536',
      })
    );
  });

  it('includes physical traits in the prompt', async () => {
    generateImageMock.mockResolvedValue({
      base64: 'base64',
      durationMs: 100,
    });

    await generateTemplateImage({
      template: {
        label: 'Aldric',
        description: 'A weathered man.',
        physicalTraits: {
          gender: 'male',
          eyeColor: 'gray',
          hairColor: 'silver',
        },
      },
    });

    const call = generateImageMock.mock.calls[0][0];
    expect(call.prompt).toContain('silver hair');
    expect(call.prompt).toContain('gray eyes');
  });

  it('includes custom instructions in the prompt', async () => {
    generateImageMock.mockResolvedValue({
      base64: 'base64',
      durationMs: 100,
    });

    await generateTemplateImage({
      template: {
        label: 'Test',
        description: 'A character.',
      },
      instructions: 'Make it dramatic',
    });

    const call = generateImageMock.mock.calls[0][0];
    expect(call.prompt).toContain('Make it dramatic');
  });
});
