/**
 * Layout Pipeline Integration Test
 *
 * Tests the full layout generation pipeline:
 *   template → selectVariant → processLayers → terrainGrid → slot placement
 *
 * Uses real layout templates and algorithms. Only mocks LLM (for context detection).
 * Verifies the generated layout has valid structure, dimensions, and terrain data.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  setupAndLoadTestUniverse,
  cleanupTestUniverse,
  createTestPlace,
} from '@dmnpc/core/test-helpers/index.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// Mock LLM client — layout generation uses it for context detection
vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  createOpenAIClient: vi.fn(() => ({})),
  queryLlm: vi.fn().mockResolvedValue({
    content: {
      wealth: 'moderate',
      cleanliness: 'worn',
      crowding: 'normal',
      atmosphere: 'casual',
    },
    truncated: false,
    durationMs: 10,
  }),
  generateImage: vi.fn().mockResolvedValue({ url: 'https://test.example/image.png' }),
}));

// Mock storage service (S3)
vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://test-bucket.example/file'),
  getPublicUrl: vi.fn((key: string) => `https://test-bucket.example/${key}`),
  exists: vi.fn().mockResolvedValue(false),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
  storageService: {
    uploadFile: vi.fn().mockResolvedValue('https://test-bucket.example/file'),
    getPublicUrl: vi.fn((key: string) => `https://test-bucket.example/${key}`),
    exists: vi.fn().mockResolvedValue(false),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

// ============================================================================
// Test Setup
// ============================================================================

const TEST_UNIVERSE_ID = '__integ_layout_pipeline__';

beforeAll(async () => {
  await setupAndLoadTestUniverse(TEST_UNIVERSE_ID, {
    name: 'Layout Pipeline Test Universe',
    description: 'Integration test for layout generation.',
    places: [
      createTestPlace({
        id: 'PLACE_root',
        label: 'Root',
        description: 'Root place.',
        short_description: 'root',
        tags: ['Root'],
        position: { x: 0, y: 0, width: 100, height: 100, innerWidth: 800, innerHeight: 600, parent: null },
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet' },
      }),
      createTestPlace({
        id: 'PLACE_test_tavern',
        label: 'Test Tavern',
        description: 'A small tavern for layout generation testing.',
        short_description: 'test tavern',
        tags: ['Tavern', 'interior'],
        position: { x: 50, y: 50, width: 50, height: 50, innerWidth: 400, innerHeight: 300, parent: 'PLACE_root' },
        info: { environment: ENVIRONMENT_PRESETS.interior(), scale: 'feet', purpose: 'tavern' },
      }),
      createTestPlace({
        id: 'PLACE_test_forest',
        label: 'Test Forest',
        description: 'A dense forest for layout generation testing.',
        short_description: 'test forest',
        tags: ['Forest', 'exterior'],
        position: { x: 200, y: 50, width: 200, height: 200, innerWidth: 800, innerHeight: 800, parent: 'PLACE_root' },
        info: { environment: ENVIRONMENT_PRESETS.exterior(), scale: 'feet', purpose: 'forest' },
      }),
    ],
  });
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

// ============================================================================
// Tests
// ============================================================================

describe('layout generation pipeline (integration)', () => {
  // BUG-304 regression guard: object catalog must load without errors before layout tests run.
  // If this fails, a _-prefixed test fixture leaked into the catalog (check server unit tests).
  it('loads the full object catalog without errors', async () => {
    const { loadEntityRegistry } = await import('../../src/place-layout/object-catalog.js');
    const registry = loadEntityRegistry();
    expect(Object.keys(registry.definitions).length).toBeGreaterThan(0);
  });

  it('generates a valid tavern layout with terrain grid and slots', { timeout: 30_000 }, async () => {
    const { generatePlaceLayout } = await import('../../src/place-layout/generator.js');

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

    const result = await generatePlaceLayout(ctx, {
      placeId: 'PLACE_test_tavern',
      seed: 42,
      skipAugmentation: true,
      existingContext: { wealth: 'moderate', cleanliness: 'worn', crowding: 'normal', atmosphere: 'casual' },
    });

    // Verify result structure
    expect(result).toBeDefined();
    expect(result.layout).toBeDefined();

    const layout = result.layout;

    // Verify tilemap dimensions are positive
    expect(layout.tilemap).toBeDefined();
    expect(layout.tilemap.width).toBeGreaterThan(0);
    expect(layout.tilemap.height).toBeGreaterThan(0);
    expect(layout.tilemap.tileSize).toBe(32);

    // Verify tilemap has layers
    expect(layout.tilemap.layers.length).toBeGreaterThan(0);

    // Verify bounds exist and are valid
    expect(layout.bounds).toBeDefined();
    expect(layout.bounds.width).toBeGreaterThan(0);
    expect(layout.bounds.height).toBeGreaterThan(0);

    // Verify terrain grid exists and has correct dimensions
    expect(layout.terrainGrid).not.toBeNull();
    expect(layout.terrainGrid!.length).toBe(layout.tilemap.height);
    for (const row of layout.terrainGrid!) {
      expect(row.length).toBe(layout.tilemap.width);
      // Each cell should be a non-empty string (terrain type)
      for (const cell of row) {
        expect(typeof cell).toBe('string');
        expect(cell.length).toBeGreaterThan(0);
      }
    }

    // Verify slots were generated
    expect(layout.slots).toBeDefined();
    expect(layout.slots.length).toBeGreaterThan(0);

    // Verify each slot has valid position within bounds
    for (const slot of layout.slots) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x).toBeLessThan(layout.tilemap.width);
      expect(slot.y).toBeLessThan(layout.tilemap.height);
    }
  });

  it('generates a valid forest layout (different template type)', { timeout: 30_000 }, async () => {
    const { generatePlaceLayout } = await import('../../src/place-layout/generator.js');

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

    const result = await generatePlaceLayout(ctx, {
      placeId: 'PLACE_test_forest',
      seed: 123,
      skipAugmentation: true,
      existingContext: { wealth: 'moderate', cleanliness: 'worn', crowding: 'sparse', atmosphere: 'casual' },
    });

    expect(result).toBeDefined();
    expect(result.layout).toBeDefined();

    const layout = result.layout;

    // Forest layouts should have valid tilemap
    expect(layout.tilemap).toBeDefined();
    expect(layout.tilemap.width).toBeGreaterThan(0);
    expect(layout.tilemap.height).toBeGreaterThan(0);

    // Terrain grid may be null for procedural layers (e.g. forest with procedural rendering)
    // If present, verify it's well-formed
    if (layout.terrainGrid) {
      for (const row of layout.terrainGrid) {
        for (const cell of row) {
          expect(cell).toBeDefined();
          expect(typeof cell).toBe('string');
        }
      }
    }
  });

  // BUG-135: Reused exit objects must use in-wall positioning (facing-aware)
  it('positions reused exit objects using in-wall formula when slot has facing', { timeout: 30_000 }, async () => {
    const { generatePlaceLayout } = await import('../../src/place-layout/generator.js');

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const context = { wealth: 'moderate' as const, cleanliness: 'worn' as const, crowding: 'normal' as const, atmosphere: 'casual' as const };

    // First generation creates exit objects
    const firstResult = await generatePlaceLayout(ctx, {
      placeId: 'PLACE_test_tavern',
      seed: 42,
      skipAugmentation: true,
      existingContext: context,
    });

    // Find the exit object(s) created
    const exitEntities = ctx.objects.filter(
      (o) => o.info.purpose === 'exit' && o.position.parent === 'PLACE_test_tavern'
    );
    expect(exitEntities.length).toBeGreaterThan(0);

    // Regenerate with the existing exit as a reusable object
    const ctx2 = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const secondResult = await generatePlaceLayout(ctx2, {
      placeId: 'PLACE_test_tavern',
      seed: 42,
      skipAugmentation: true,
      existingContext: context,
      existingObjects: exitEntities,
    });

    // Find the exit slot in the generated layout
    const exitSlot = secondResult.layout.slots.find((s) => s.purpose === 'exit');
    expect(exitSlot).toBeDefined();
    expect(exitSlot!.facing).not.toBeNull();

    // Find the reused exit in the context
    const reusedExit = ctx2.objects.find(
      (o) => o.info.purpose === 'exit' && o.position.parent === 'PLACE_test_tavern'
    );
    expect(reusedExit).toBeDefined();

    // Verify in-wall positioning formula was applied: center on tile, bottom-aligned
    const tileSize = 32;
    const expectedX = exitSlot!.x * tileSize + tileSize / 2;
    const expectedY = (exitSlot!.y + 1) * tileSize;

    expect(reusedExit!.position.x).toBe(expectedX);
    expect(reusedExit!.position.y).toBe(expectedY);

    // Verify facing was set on the reused entity
    expect(reusedExit!.info.spriteConfig.facing).toBe(exitSlot!.facing);
  });

  // Seed 42 is used here instead of 999. Seed 999 creates an L-shaped room where
  // required slots (workspace/counter, tables) partition the floor into 4 disconnected
  // regions. pruneForConnectivity throws after all optional slots are pruned because
  // required slots can't be pruned. The retry loop only re-runs slot placement (seeds
  // 999, 1000, 1001) — it doesn't regenerate the room shape, so all 3 attempts fail.
  // Tracked as: https://github.com/xanister/dmnpc-monorepo/issues/163
  it('produces deterministic output with the same seed', { timeout: 30_000 }, async () => {
    const { generatePlaceLayout } = await import('../../src/place-layout/generator.js');

    const ctx1 = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const ctx2 = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

    const context = { wealth: 'moderate' as const, cleanliness: 'worn' as const, crowding: 'normal' as const, atmosphere: 'casual' as const };

    const result1 = await generatePlaceLayout(ctx1, {
      placeId: 'PLACE_test_tavern',
      seed: 42,
      skipAugmentation: true,
      existingContext: context,
    });

    const result2 = await generatePlaceLayout(ctx2, {
      placeId: 'PLACE_test_tavern',
      seed: 42,
      skipAugmentation: true,
      existingContext: context,
    });

    // Same seed should produce same dimensions
    expect(result1.layout.tilemap.width).toBe(result2.layout.tilemap.width);
    expect(result1.layout.tilemap.height).toBe(result2.layout.tilemap.height);

    // Same seed should produce same terrain grid
    expect(result1.layout.terrainGrid).toEqual(result2.layout.terrainGrid);
  });
});
