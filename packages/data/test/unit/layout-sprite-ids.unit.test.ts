import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const layoutsDir = join(__dirname, '../../entities/layouts');
const registryPath = join(__dirname, '../../sprites/sprite-registry.json');

interface LayoutFile {
  id: string;
  spriteId?: string;
}

interface SpriteRegistry {
  sprites: Record<string, unknown>;
}

const registry: SpriteRegistry = JSON.parse(readFileSync(registryPath, 'utf8'));
const registeredSpriteIds = new Set(Object.keys(registry.sprites));

describe('layout spriteIds (BUG-301 regression)', () => {
  it('every layout spriteId references a registered sprite', () => {
    const layoutFiles = readdirSync(layoutsDir).filter(
      (f) => f.endsWith('.json') && f !== '_metadata.json',
    );

    const broken: string[] = [];
    for (const file of layoutFiles) {
      const layout: LayoutFile = JSON.parse(readFileSync(join(layoutsDir, file), 'utf8'));
      if (!layout.spriteId) continue;
      if (!registeredSpriteIds.has(layout.spriteId)) {
        broken.push(`  ${file}: spriteId "${layout.spriteId}" not found in sprite registry`);
      }
    }

    expect(broken, `Layout files reference unregistered spriteIds:\n${broken.join('\n')}`).toHaveLength(0);
  });
});
