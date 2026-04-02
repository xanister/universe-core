/**
 * Allowed Tags
 *
 * Centralized definitions of all functional tags used by the game systems.
 * Tags not in these lists should NOT be generated - they serve no purpose.
 *
 * Tag categories:
 * 1. LOCATION_TYPE_TAGS - Location types used for audio categorization
 * 2. CHARACTER_OCCUPATION_TAGS - Character occupations for job matching
 * 3. SYSTEM_MANAGED_TAGS - Capacity + vessel tags (never LLM-generated)
 */

/**
 * Location type tags used by the audio system to determine ambient audio.
 * These are the ONLY place tags that should be LLM-generated.
 * Must match the tags used in audio-generator.ts LOCATION_TYPE_TAGS.
 */
export const LOCATION_TYPE_TAGS = [
  // Hospitality
  'tavern',
  'inn',
  // Religious
  'temple',
  // Commerce
  'market',
  'shop',
  // Urban outdoor
  'street',
  // Natural/wilderness
  'forest',
  // Underground
  'cave',
  'dungeon',
  // Vessels/transport
  'vessel',
  // Space
  'space',
  // Maritime
  'harbor',
  // Grand structures
  'castle',
  // Indoor
  'library',
  'bedroom',
  'building',
] as const;

export type LocationTypeTag = (typeof LOCATION_TYPE_TAGS)[number];

/**
 * Character occupation tags used for job matching and routine generation.
 * These are the ONLY character tags that should be assigned.
 * Must match the tags used in job-matching.ts OCCUPATION_GROUPS and occupancy.ts.
 */
export const CHARACTER_OCCUPATION_TAGS = [
  // Hospitality
  'bartender',
  'server',
  'innkeeper',
  'cook',
  // Security
  'guard',
  'soldier',
  // Religious
  'priest',
  'acolyte',
  'healer',
  // Maritime
  'fisher',
  // Commerce
  'merchant',
  'clerk',
  // Labor
  'laborer',
] as const;

export type CharacterOccupationTag = (typeof CHARACTER_OCCUPATION_TAGS)[number];

/**
 * Tags that should NEVER be created - meta/coding terms that don't belong in-world.
 */
export const BLOCKED_TAGS = [
  'procedural',
  'random',
  'dynamic',
  'static',
  'generated',
  'npc',
  'player',
  'system',
  'meta',
  'debug',
  'test',
] as const;

/**
 * Check if a tag is blocked (should never be created).
 */
export function isBlockedTag(tag: string): boolean {
  const normalized = tag.toLowerCase().replace(/^tag_/, '').replace(/_/g, '-');
  return (BLOCKED_TAGS as readonly string[]).includes(normalized);
}

/**
 * Get all allowed tags for LLM generation (location types + occupations).
 */
export function getAllowedLlmTags(): string[] {
  return [...LOCATION_TYPE_TAGS, ...CHARACTER_OCCUPATION_TAGS];
}
