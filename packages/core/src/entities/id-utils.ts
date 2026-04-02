/**
 * ID Utilities
 *
 * Canonical ID generation so universe (and related) IDs are deterministic
 * and do not diverge due to LLM or client phrasing (e.g. "1000ad" vs "1000 AD").
 */

const UNIVERSE_ID_REGEX = /^[a-z][a-z0-9_]*$/;
const FALLBACK_UNIVERSE_ID = 'u_unknown';

/**
 * Normalize common era/date abbreviations so "1000 ad", "1000ad", "1000 A.D." collapse to one form.
 */
function normalizeEraAbbreviations(input: string): string {
  let s = input;
  // e.g. "1000 ad", "1000 a.d.", "1000ad" -> "1000_ad"
  s = s.replace(/\b(\d+)\s*(?:a\.?d\.?|ad)\b/gi, '$1_ad');
  // e.g. "500 bc", "500 b.c." -> "500_bc"
  s = s.replace(/\b(\d+)\s*(?:b\.?c\.?|bc)\b/gi, '$1_bc');
  return s;
}

/**
 * Produce a canonical universe ID from a display name.
 * Same name variants (e.g. "Guardia 1000 AD" vs "Guardia 1000ad") yield the same ID.
 * Result matches ^[a-z][a-z0-9_]*$ and is safe for folder names and APIs.
 */
export function canonicalUniverseIdFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return FALLBACK_UNIVERSE_ID;
  }
  const normalized = normalizeEraAbbreviations(trimmed.toLowerCase());
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/_+/g, '_');
  if (!slug) {
    return FALLBACK_UNIVERSE_ID;
  }
  if (/^\d/.test(slug)) {
    return `u_${slug}`;
  }
  if (!UNIVERSE_ID_REGEX.test(slug)) {
    return FALLBACK_UNIVERSE_ID;
  }
  return slug;
}
