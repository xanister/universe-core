import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSpriteFrameForPortrait } from '@dmnpc/generation/sprite-frame-utils.js';

vi.mock('sharp', () => {
  const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from('fake-png-output'));
  const chain = {
    extract: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: mockToBuffer,
  };
  const sharpFn = vi.fn(() => chain);
  (sharpFn as { kernel: { nearest: string } }).kernel = { nearest: 'nearest' };
  return { default: sharpFn };
});

describe('sprite-frame-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractSpriteFrameForPortrait', () => {
    it('extracts idle-down frame (row 10) and upscales to 512x512', async () => {
      const sharp = (await import('sharp')).default;
      const inputBuffer = Buffer.alloc(100);

      const result = await extractSpriteFrameForPortrait(inputBuffer);

      expect(sharp).toHaveBeenCalledWith(inputBuffer);
      const chain = (await import('sharp')).default();
      expect(chain.extract).toHaveBeenCalledWith({
        left: 0,
        top: 640, // 10 * 64
        width: 64,
        height: 64,
      });
      expect(chain.resize).toHaveBeenCalledWith(
        512,
        512,
        expect.objectContaining({ kernel: expect.anything() })
      );
      expect(chain.png).toHaveBeenCalled();
      expect(chain.toBuffer).toHaveBeenCalled();
      expect(result).toEqual(Buffer.from('fake-png-output'));
    });
  });
});
