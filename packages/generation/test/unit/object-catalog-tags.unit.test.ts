/**
 * Unit tests for object catalog tag filtering (FEAT-208 + FEAT-241).
 *
 * Tests that getEntitiesByPurpose filters candidates by requiredTags (AND) and forbiddenTags (NOR).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Purpose } from '@dmnpc/types/world';

// Mock fs and data paths before importing
vi.mock('fs', () => ({
  readdirSync: vi.fn().mockReturnValue([
    'barrel.json',
    'ship_rope.json',
    'wall_torch.json',
    'throne.json',
    'crate.json',
  ]),
}));

vi.mock('@dmnpc/core/infra/read-json-file.js', () => ({
  readJsonFileSync: vi.fn((path: string) => {
    if (path.includes('sprite-registry')) {
      return {
        sprites: {
          barrel: { id: 'barrel', width: 32, height: 32, boundingBox: null },
          ship_rope: { id: 'ship_rope', width: 32, height: 32, boundingBox: null },
          torch_lpc: { id: 'torch_lpc', width: 32, height: 64, boundingBox: null },
          throne: { id: 'throne', width: 32, height: 48, boundingBox: null },
          crate: { id: 'crate', width: 32, height: 32, boundingBox: null },
        },
      };
    }
    // Object catalog files
    if (path.includes('barrel.json')) {
      return { id: 'barrel', name: 'Barrel', purposes: ['storage', 'decoration'], spriteId: 'barrel', tags: ['common', 'ship'] };
    }
    if (path.includes('ship_rope.json')) {
      return { id: 'ship_rope', name: 'Ship Rope', purposes: ['decoration'], spriteId: 'ship_rope', tags: ['common', 'ship', 'rope'] };
    }
    if (path.includes('wall_torch.json')) {
      return { id: 'wall_torch', name: 'Wall Torch', purposes: ['lighting', 'decoration'], spriteId: 'torch_lpc', tags: ['common', 'fixture', 'lighting'] };
    }
    if (path.includes('throne.json')) {
      return { id: 'throne', name: 'Throne', purposes: ['decoration'], spriteId: 'throne', tags: ['common', 'furniture', 'royal'] };
    }
    if (path.includes('crate.json')) {
      return { id: 'crate', name: 'Crate', purposes: ['storage'], spriteId: 'crate', tags: [] };
    }
    return {};
  }),
}));

vi.mock('@dmnpc/data', () => ({
  ENTITIES_DIR: '/mock/entities',
  SPRITE_REGISTRY_PATH: '/mock/sprite-registry.json',
}));

// Import after mocks
const { getEntitiesByPurpose } = await import('../../src/place-layout/object-catalog.js');

describe('getEntitiesByPurpose — requiredTags filtering (FEAT-208)', () => {
  it('returns all matching entities when requiredTags is undefined', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('barrel');
    expect(ids).toContain('ship_rope');
    expect(ids).toContain('wall_torch');
    expect(ids).toContain('throne');
  });

  it('returns all matching entities when requiredTags is empty', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, []);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('barrel');
    expect(ids).toContain('ship_rope');
    expect(ids).toContain('wall_torch');
    expect(ids).toContain('throne');
  });

  it('filters by a single required tag', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, ['ship']);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('barrel');
    expect(ids).toContain('ship_rope');
    expect(ids).not.toContain('wall_torch');
    expect(ids).not.toContain('throne');
  });

  it('filters by multiple required tags using AND logic', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, ['ship', 'rope']);
    const ids = results.map((r) => r.id);
    expect(ids).toEqual(['ship_rope']);
  });

  it('returns empty when no entity has all required tags', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, ['ship', 'royal']);
    expect(results).toEqual([]);
  });

  it('filters by tag on a different purpose', () => {
    const results = getEntitiesByPurpose('storage' as Purpose, ['ship']);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('barrel');
    expect(ids).not.toContain('crate');
  });

  it('excludes entities with empty tags when requiredTags is set', () => {
    const results = getEntitiesByPurpose('storage' as Purpose, ['common']);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('barrel');
    expect(ids).not.toContain('crate');
  });
});

describe('getEntitiesByPurpose — forbiddenTags filtering (FEAT-241)', () => {
  it('returns all matching entities when forbiddenTags is undefined', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, undefined, undefined);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('barrel');
    expect(ids).toContain('ship_rope');
    expect(ids).toContain('wall_torch');
    expect(ids).toContain('throne');
  });

  it('returns all matching entities when forbiddenTags is empty', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, undefined, []);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('barrel');
    expect(ids).toContain('ship_rope');
    expect(ids).toContain('wall_torch');
    expect(ids).toContain('throne');
  });

  it('excludes entities with a single forbidden tag', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, undefined, ['ship']);
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('barrel');
    expect(ids).not.toContain('ship_rope');
    expect(ids).toContain('wall_torch');
    expect(ids).toContain('throne');
  });

  it('excludes entities matching ANY forbidden tag (NOR logic)', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, undefined, ['ship', 'royal']);
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('barrel');
    expect(ids).not.toContain('ship_rope');
    expect(ids).not.toContain('throne');
    expect(ids).toContain('wall_torch');
  });

  it('does not exclude entities with empty tags array', () => {
    const results = getEntitiesByPurpose('storage' as Purpose, undefined, ['ship']);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('crate');
    expect(ids).not.toContain('barrel');
  });

  it('combines requiredTags AND + forbiddenTags NOR', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, ['common'], ['ship']);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('wall_torch');
    expect(ids).toContain('throne');
    expect(ids).not.toContain('barrel');
    expect(ids).not.toContain('ship_rope');
  });

  it('returns empty when all candidates are forbidden', () => {
    const results = getEntitiesByPurpose('decoration' as Purpose, ['ship'], ['ship']);
    expect(results).toEqual([]);
  });
});
