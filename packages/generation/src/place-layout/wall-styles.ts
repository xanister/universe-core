/**
 * Wall style loader.
 *
 * Reads wall-styles-full.json from @dmnpc/data. Each style maps corner
 * configurations (TL,TR,BL,BR as 0/1) to tile IDs for both:
 *   - Overhead tiles (ceiling overlay with room cutout, rows 5-9 per style)
 *   - Face tiles (south-facing wall texture, 3x3 grid at rows 20+)
 *
 * Corner key convention: "TL,TR,BL,BR" where 1 = room, 0 = wall/ceiling.
 */

import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { WALL_STYLES_FULL_PATH } from '@dmnpc/data';

interface RawFullStyle {
  id: string;
  name: string;
  colorIndex: number;
  overheadTiles: Record<string, number>;
  faceTiles: Record<string, number>;
}

export interface FullWallStyle {
  id: string;
  name: string;
  /** Overhead tile ID by normalized corner key "TL,TR,BL,BR" (0 or 1). */
  overheadTiles: Map<string, number>;
  /** Face tile ID by normalized corner key. */
  faceTiles: Map<string, number>;
}

let cachedFullStyles: Map<string, FullWallStyle> | null = null;

/**
 * Normalize corner keys from color-indexed (e.g., "2,0,2,0") to binary ("1,0,1,0").
 */
function normalizeCornerKey(key: string): string {
  return key
    .split(',')
    .map((v) => (parseInt(v) > 0 ? '1' : '0'))
    .join(',');
}

function loadFullStyles(): Map<string, FullWallStyle> {
  if (cachedFullStyles && process.env['NODE_ENV'] === 'production') return cachedFullStyles;

  const raw = readJsonFileSync<RawFullStyle[]>(WALL_STYLES_FULL_PATH);
  const map = new Map<string, FullWallStyle>();
  for (const style of raw) {
    const overhead = new Map<string, number>();
    for (const [key, tileId] of Object.entries(style.overheadTiles)) {
      overhead.set(normalizeCornerKey(key), tileId);
    }
    const face = new Map<string, number>();
    for (const [key, tileId] of Object.entries(style.faceTiles)) {
      face.set(normalizeCornerKey(key), tileId);
    }
    map.set(style.id, {
      id: style.id,
      name: style.name,
      overheadTiles: overhead,
      faceTiles: face,
    });
  }
  cachedFullStyles = map;
  return map;
}

/**
 * Load a full wall style by ID.
 * Throws if the style is not found.
 */
export function loadFullWallStyle(styleId: string): FullWallStyle {
  const styles = loadFullStyles();
  const style = styles.get(styleId);
  if (!style) {
    const available = [...styles.keys()].join(', ');
    throw new Error(`Unknown wall style "${styleId}". Available: [${available}]`);
  }
  return style;
}
