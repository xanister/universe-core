import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const registryPath = join(__dirname, '../../sprites/sprite-registry.json');

interface SpriteEntry {
  tileset?: string;
  composite?: boolean;
  [key: string]: unknown;
}

interface SpriteRegistry {
  tilesets: Record<string, unknown>;
  sprites: Record<string, SpriteEntry>;
  floorTypes?: Record<string, { tileset: string }>;
}

const registry: SpriteRegistry = JSON.parse(readFileSync(registryPath, 'utf8'));
const registeredTilesetIds = new Set(Object.keys(registry.tilesets));

// Old tileset IDs that were renamed before BUG-277 was filed.
// Sprites referencing these were emitting [world-renderer] tileset-not-found warnings.
const OLD_RENAMED_TILESET_IDS = [
  'lpc-interior-furniture_dark',
  'lpc-interior-furniture_blonde',
  'lpc-interior-containers',
  'lpc-interior-containers-full',
  'lpc-interior-tavern-furniture',
  'lpc-interior-tavern-deco',
  'lpc-interior-floors',
];

describe('sprite-registry.json', () => {
  it('no sprite or floorType references old lpc-interior tileset IDs (BUG-277 regression)', () => {
    const broken: string[] = [];
    for (const [spriteId, sprite] of Object.entries(registry.sprites)) {
      if (sprite.tileset && OLD_RENAMED_TILESET_IDS.includes(sprite.tileset)) {
        broken.push(`  sprite "${spriteId}" → tileset "${sprite.tileset}" (old ID)`);
      }
    }
    if (registry.floorTypes) {
      for (const [typeId, floor] of Object.entries(registry.floorTypes)) {
        if (OLD_RENAMED_TILESET_IDS.includes(floor.tileset)) {
          broken.push(`  floorType "${typeId}" → tileset "${floor.tileset}" (old ID)`);
        }
      }
    }
    expect(broken, `Entries reference old/renamed tileset IDs:\n${broken.join('\n')}`).toHaveLength(0);
  });

  it('all world_map tagged sprites have defaultLayer floor (BUG-297 regression)', () => {
    const broken: string[] = [];
    for (const [spriteId, sprite] of Object.entries(registry.sprites)) {
      const tags = (sprite as { tags?: string[] }).tags ?? [];
      if (tags.includes('world_map') && (sprite as { defaultLayer?: string }).defaultLayer !== 'floor') {
        const actual = (sprite as { defaultLayer?: string }).defaultLayer ?? 'unset';
        broken.push(`  sprite "${spriteId}" has world_map tag but defaultLayer is "${actual}" (expected "floor")`);
      }
    }
    expect(broken, `World map sprites must render at floor depth:\n${broken.join('\n')}`).toHaveLength(0);
  });

  it('non-composite sprites reference a registered tileset', () => {
    // Composite sprites are packed into the custom atlas and legitimately
    // do not need a tileset entry — skip them here.
    // NOTE: ~59 non-lpc-interior sprites also reference unregistered tilesets
    // (world-map, space-objects-*, scifi-interior-*, sailing-ships, etc.).
    // These are pre-existing issues tracked in BUG-281.
    const broken: string[] = [];
    for (const [spriteId, sprite] of Object.entries(registry.sprites)) {
      if (sprite.composite) continue;
      if (!sprite.tileset) continue;
      if (!registeredTilesetIds.has(sprite.tileset)) {
        broken.push(`  sprite "${spriteId}" → tileset "${sprite.tileset}" not in registry`);
      }
    }
    // Exact ratchet: fails on new regressions AND on silent drift from BUG-281 progress.
    // Decrement this constant as BUG-281 batches are fixed; set to 0 when fully resolved.
    const PRE_EXISTING_COUNT = 0;
    expect(broken.length).toEqual(PRE_EXISTING_COUNT);
  });
});
