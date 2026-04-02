/**
 * Unit tests for object-type-generator (BUG-136 regression).
 *
 * Verifies that loadSpriteIds correctly reads sprite IDs from the registry
 * where sprites is Record<string, SpriteDefinition>, not an array.
 */

import { describe, it, expect, vi } from 'vitest';

const { mockQueryLlm } = vi.hoisted(() => ({
  mockQueryLlm: vi.fn(),
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: mockQueryLlm,
}));

vi.mock('fs', () => ({
  readdirSync: vi.fn().mockReturnValue(['barrel.json', 'torch.json']),
}));

vi.mock('@dmnpc/core/infra/read-json-file.js', () => ({
  readJsonFileSync: vi.fn((path: string) => {
    if (path.includes('sprite-registry')) {
      return {
        version: '1.1.0',
        sprites: {
          barrel: { id: 'barrel', width: 32, height: 32, boundingBox: null },
          torch_lpc: { id: 'torch_lpc', width: 32, height: 64, boundingBox: null },
        },
        tilesets: {},
        floorTypes: {},
      };
    }
    if (path.includes('purposes')) {
      return {
        version: '1.0.0',
        purposes: [
          { id: 'decoration', category: 'object' },
          { id: 'lighting', category: 'object' },
        ],
      };
    }
    return {};
  }),
}));

import { generateObjectType } from '../../src/place/object-type-generator.js';

describe('generateObjectType', () => {
  it('reads sprite IDs from Record<string, SpriteDefinition> without crashing (BUG-136)', async () => {
    mockQueryLlm.mockResolvedValue({
      content: {
        suggestedId: 'iron_anvil',
        objectType: {
          id: 'iron_anvil',
          name: 'Iron Anvil',
          description: 'A heavy iron anvil',
          purposes: ['decoration'],
          solid: true,
          layer: 'default',
          spriteId: 'barrel',
          materials: ['metal'],
          tintable: false,
        },
      },
    });

    const result = await generateObjectType({ prompt: 'An iron anvil' });

    expect(result.suggestedId).toBe('iron_anvil');
    expect(mockQueryLlm).toHaveBeenCalledOnce();

    const systemPrompt = mockQueryLlm.mock.calls[0][0].system as string;
    expect(systemPrompt).toContain('barrel');
    expect(systemPrompt).toContain('torch_lpc');
  });

  it('includes supportedOrientations in LLM prompt and schema (FEAT-238)', async () => {
    mockQueryLlm.mockResolvedValue({
      content: {
        suggestedId: 'round_table',
        objectType: {
          id: 'round_table',
          name: 'Round Table',
          description: 'A round wooden table',
          purposes: ['decoration'],
          solid: true,
          layer: 'default',
          spriteId: 'barrel',
          materials: ['wood'],
          tintable: false,
          supportedOrientations: ['north', 'south', 'east', 'west'],
        },
      },
    });

    const result = await generateObjectType({ prompt: 'A round table' });
    expect(result.objectType.supportedOrientations).toEqual(['north', 'south', 'east', 'west']);

    const systemPrompt = mockQueryLlm.mock.calls[0][0].system as string;
    expect(systemPrompt).toContain('supportedOrientations');
  });
});
