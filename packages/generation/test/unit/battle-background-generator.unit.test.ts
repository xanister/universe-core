/**
 * Unit tests for battle-background-generator.
 *
 * Tests prompt construction, S3 upload, and terrain hint extraction.
 *
 * FEAT-192: Battle Backgrounds (Combat & Equipment System — Phase 6)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Place, Universe } from '@dmnpc/types/entity';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

// ============================================================================
// Mocks
// ============================================================================

const mockGenerateImage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ base64: 'dGVzdA==', durationMs: 1000 })
);
const mockUploadFile = vi.hoisted(() =>
  vi.fn().mockResolvedValue('https://s3.example.com/universes/test/images/battles/PLACE_tavern.png')
);

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  generateImage: mockGenerateImage,
}));
vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  storageService: { uploadFile: mockUploadFile },
}));
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildBattleBackgroundPrompt,
  extractTerrainHints,
  generateBattleBackground,
  getBattleBackgroundKey,
} from '@dmnpc/generation/media/battle-background-generator.js';

// ============================================================================
// Test data
// ============================================================================

function createTestPlace(overrides?: Partial<Place>): Place {
  return {
    id: 'PLACE_tavern',
    label: 'The Rusty Flagon',
    description: 'A dimly lit tavern with creaky wooden floors',
    short_description: 'rusty tavern',
    entityType: 'place',
    tags: [],
    info: {
      purpose: 'tavern',
      environment: ENVIRONMENT_PRESETS.interior(),
      scale: 'feet',
      spriteConfig: { spriteId: 'tavern' },
      music: null,
      musicHints: null,
      commonKnowledge: null,
      secrets: null,
      isTemporary: false,
      dockedAtPlaceId: null,
      timeScale: 1,
      battleBackgroundUrl: '',
      inheritedRequiredTags: null,
    },
    position: { x: 0, y: 0, parent: 'PLACE_town', width: 64, height: 64, innerWidth: 0, innerHeight: 0 },
    relationships: [],
    ...overrides,
  } as Place;
}

function createMockCtx(
  universeOverrides?: Partial<Universe>
): UniverseContext {
  return {
    universeId: 'test_universe',
    universe: {
      id: 'test_universe',
      name: 'Test Universe',
      description: 'A test universe',
      version: '1.0.0',
      custom: {},
      rules: '',
      tone: 'dark',
      style: 'grimdark military gothic horror',
      date: '1.1.1',
      races: [],
      rootPlaceId: 'PLACE_root',
      ...universeOverrides,
    } as Universe,
  } as unknown as UniverseContext;
}

// ============================================================================
// Tests
// ============================================================================

describe('battle-background-generator', () => {
  beforeEach(() => {
    mockGenerateImage.mockClear();
    mockUploadFile.mockClear();
  });

  describe('getBattleBackgroundKey', () => {
    it('returns correct S3 key', () => {
      expect(getBattleBackgroundKey('uni1', 'PLACE_tavern')).toBe(
        'universes/uni1/images/battles/PLACE_tavern.png'
      );
    });
  });

  describe('extractTerrainHints', () => {
    it('returns unique terrain tags excluding void and wall', () => {
      const grid = [
        ['land', 'land', 'water'],
        ['wall', 'land', 'forest'],
        ['void', 'water', 'land'],
      ];
      expect(extractTerrainHints(grid)).toEqual(['forest', 'land', 'water']);
    });

    it('returns empty array for null grid', () => {
      expect(extractTerrainHints(null)).toEqual([]);
    });

    it('returns empty array when grid only has void and wall', () => {
      const grid = [
        ['void', 'wall'],
        ['wall', 'void'],
      ];
      expect(extractTerrainHints(grid)).toEqual([]);
    });
  });

  describe('buildBattleBackgroundPrompt', () => {
    it('includes universe art style', () => {
      const place = createTestPlace();
      const prompt = buildBattleBackgroundPrompt('grimdark military gothic horror', place, []);
      expect(prompt).toContain('Color palette and mood inspired by: grimdark military gothic horror.');
    });

    it('includes place description', () => {
      const place = createTestPlace({ description: 'A smoky tavern with ale stains' });
      const prompt = buildBattleBackgroundPrompt('', place, []);
      expect(prompt).toContain('Setting: A smoky tavern with ale stains');
    });

    it('includes environment type and interior/exterior label', () => {
      const place = createTestPlace();
      const prompt = buildBattleBackgroundPrompt('', place, []);
      expect(prompt).toContain('Environment: interior, interior.');
    });

    it('includes terrain hints when provided', () => {
      const place = createTestPlace();
      const prompt = buildBattleBackgroundPrompt('', place, ['land', 'water']);
      expect(prompt).toContain('Terrain: land, water.');
    });

    it('omits terrain line when no hints', () => {
      const place = createTestPlace();
      const prompt = buildBattleBackgroundPrompt('', place, []);
      expect(prompt).not.toContain('Terrain:');
    });

    it('includes neutral lighting instruction', () => {
      const place = createTestPlace();
      const prompt = buildBattleBackgroundPrompt('', place, []);
      expect(prompt).toContain('neutral ambient');
    });

    it('includes no characters instruction', () => {
      const place = createTestPlace();
      const prompt = buildBattleBackgroundPrompt('', place, []);
      expect(prompt).toContain('No characters');
    });
  });

  describe('generateBattleBackground', () => {
    it('calls generateImage with landscape size', async () => {
      const ctx = createMockCtx();
      const place = createTestPlace();

      await generateBattleBackground(ctx, 'PLACE_tavern', place, ['land']);

      expect(mockGenerateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          size: '1536x1024',
          context: 'Battle Background Generation',
        })
      );
    });

    it('includes universe style in prompt', async () => {
      const ctx = createMockCtx({ style: 'absurdist space satire' });
      const place = createTestPlace();

      await generateBattleBackground(ctx, 'PLACE_tavern', place, []);

      const call = mockGenerateImage.mock.calls[0][0];
      expect(call.prompt).toContain('Color palette and mood inspired by: absurdist space satire.');
    });

    it('uploads to correct S3 key', async () => {
      const ctx = createMockCtx();
      const place = createTestPlace();

      await generateBattleBackground(ctx, 'PLACE_tavern', place, []);

      expect(mockUploadFile).toHaveBeenCalledWith(
        'universes/test_universe/images/battles/PLACE_tavern.png',
        expect.any(Buffer),
        'image/png'
      );
    });

    it('returns cache-busted URL', async () => {
      const ctx = createMockCtx();
      const place = createTestPlace();

      const url = await generateBattleBackground(ctx, 'PLACE_tavern', place, []);

      expect(url).toMatch(/^https:\/\/s3\.example\.com\/.*\?v=\d+$/);
    });
  });
});
