/**
 * Vitest setup file for @dmnpc/sprites
 *
 * Mocks Node.js APIs for testing.
 */

import { vi } from 'vitest';

// Mock node-canvas module
vi.mock('canvas', () => {
  const mockContext = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: new Uint8ClampedArray(64 * 64 * 4),
      width: 64,
      height: 64,
    }),
    putImageData: vi.fn(),
  };

  const mockCanvas = {
    width: 832,
    height: 1344,
    getContext: vi.fn().mockReturnValue(mockContext),
    toBuffer: vi.fn().mockReturnValue(Buffer.from('mock-png-data')),
  };

  return {
    createCanvas: vi.fn().mockReturnValue(mockCanvas),
    loadImage: vi.fn().mockResolvedValue({
      width: 832,
      height: 1344,
    }),
  };
});

// Create fs mock with vi.fn for testing
const readFileSyncMock = vi.fn();
vi.mock('fs', () => ({
  readFileSync: readFileSyncMock,
}));

// Export for tests to access
export { readFileSyncMock };
