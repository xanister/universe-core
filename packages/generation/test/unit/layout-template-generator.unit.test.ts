/**
 * Tests for layout-template-generator.ts
 *
 * Tests the wall style catalog loading, floor tile index lookup,
 * and prompt/schema construction for the 2-pass template generation pipeline.
 */

import { describe, it, expect } from 'vitest';
import {
  loadWallStyleCatalog,
  getWallStyleCategories,
  getWallStyleIdsForCategory,
  getFloorTileIndices,
} from '../../src/place/layout-template-generator.js';

// ============================================================================
// Wall Style Catalog
// ============================================================================

describe('loadWallStyleCatalog', () => {
  it('loads all wall styles from wall-styles-full.json', () => {
    const catalog = loadWallStyleCatalog();
    expect(catalog.length).toBeGreaterThan(300);
    expect(catalog[0]).toHaveProperty('id');
    expect(catalog[0]).toHaveProperty('name');
    expect(catalog[0]).toHaveProperty('category');
  });

  it('includes known wall styles', () => {
    const catalog = loadWallStyleCatalog();
    const ids = catalog.map((s) => s.id);
    expect(ids).toContain('brick_brown');
    expect(ids).toContain('stone_castle');
    expect(ids).toContain('plaster_sand');
  });
});

describe('getWallStyleCategories', () => {
  it('returns all categories with counts and examples', () => {
    const categories = getWallStyleCategories();
    expect(categories.length).toBeGreaterThan(0);

    for (const cat of categories) {
      expect(cat.category).toBeTruthy();
      expect(cat.count).toBeGreaterThan(0);
      expect(cat.examples.length).toBeGreaterThan(0);
      expect(cat.examples.length).toBeLessThanOrEqual(3);
    }
  });

  it('includes known categories', () => {
    const categories = getWallStyleCategories();
    const names = categories.map((c) => c.category);
    expect(names).toContain('brick');
    expect(names).toContain('stone');
    expect(names).toContain('wood');
    expect(names).toContain('plaster');
    expect(names).toContain('cave');
  });

  it('sorts by count descending', () => {
    const categories = getWallStyleCategories();
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i - 1].count).toBeGreaterThanOrEqual(categories[i].count);
    }
  });
});

describe('getWallStyleIdsForCategory', () => {
  it('returns IDs for a known category', () => {
    const brickIds = getWallStyleIdsForCategory('brick');
    expect(brickIds.length).toBeGreaterThan(10);
    expect(brickIds).toContain('brick_brown');
    expect(brickIds).toContain('brick_red');
  });

  it('returns empty array for unknown category', () => {
    const ids = getWallStyleIdsForCategory('nonexistent_category');
    expect(ids).toEqual([]);
  });

  it('all returned IDs belong to the requested category', () => {
    const catalog = loadWallStyleCatalog();
    const stoneIds = getWallStyleIdsForCategory('stone');
    for (const id of stoneIds) {
      const entry = catalog.find((s) => s.id === id);
      expect(entry?.category).toBe('stone');
    }
  });
});

// ============================================================================
// Floor Tile Catalog
// ============================================================================

describe('getFloorTileIndices', () => {
  it('returns indices for lpc wood_planks', () => {
    const indices = getFloorTileIndices('floor-interior', 'wood_planks');
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('returns indices for lpc stone_floor', () => {
    const indices = getFloorTileIndices('floor-interior', 'stone_floor');
    expect(indices).toEqual([16, 17, 18]);
  });

  it('returns indices for lpc carpet_red', () => {
    const indices = getFloorTileIndices('floor-interior', 'carpet_red');
    expect(indices).toEqual([64]);
  });

  it('returns indices for scifi metal_deck', () => {
    const indices = getFloorTileIndices('floor-scifi', 'metal_deck');
    expect(indices).not.toBeNull();
    expect(indices!.length).toBeGreaterThan(5);
  });

  it('returns indices for scifi teal_panel', () => {
    const indices = getFloorTileIndices('floor-scifi', 'teal_panel');
    expect(indices).toEqual([51, 52, 53]);
  });

  it('returns null for unknown tileset', () => {
    const indices = getFloorTileIndices('blob47-grass', 'wood_planks');
    expect(indices).toBeNull();
  });

  it('returns null for unknown floor type', () => {
    const indices = getFloorTileIndices('floor-interior', 'marble');
    expect(indices).toBeNull();
  });

  it('returns null for mismatched tileset and floor type', () => {
    // scifi floor type on lpc tileset
    const indices = getFloorTileIndices('floor-interior', 'metal_deck');
    expect(indices).toBeNull();
  });
});
