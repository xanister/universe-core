import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import type { TagDefinition } from '@dmnpc/types/entity';
import { UNIVERSES_DIR } from '@dmnpc/data';
import { UniverseContext } from '../universe/universe-context.js';
import { queryLlm } from '../clients/openai-client.js';
import { logger } from '../infra/logger.js';
import { isBlockedTag, getAllowedLlmTags } from './allowed-tags.js';
import { readJsonFile } from '../infra/read-json-file.js';

interface TagsFile {
  tags: TagDefinition[];
}

function getTagsFilePath(universeId: string): string {
  return join(UNIVERSES_DIR, universeId, 'tags.json');
}

/**
 * Normalizes a tag label to lowercase with hyphens instead of spaces.
 */
function normalizeTagLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Checks if a tag looks like a proper noun (e.g., starts with capital letter,
 * is a name-like pattern, or contains multiple capitalized words).
 */
function looksLikeProperNoun(originalLabel: string): boolean {
  const trimmed = originalLabel.trim();
  if (!trimmed) return false;

  // Check if it starts with a capital letter (common for proper nouns)
  if (/^[A-Z]/.test(trimmed)) {
    return true;
  }

  // Check for title case pattern (multiple capitalized words like "The Hanging Oar")
  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    const capitalizedWords = words.filter((w) => /^[A-Z]/.test(w));
    if (capitalizedWords.length >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * Maps similar/redundant tags to their canonical form.
 * Use this to avoid creating near-duplicate tags.
 *
 * NOTE: Atmosphere/mood tags (lively, eerie, ominous, etc.) are no longer generated.
 * The audio system infers activity level from place type + time + weather, not tags.
 */
const TAG_SYNONYMS: Record<string, string> = {
  // Commerce-related → normalize to allowed occupation tags
  vendor: 'merchant',
  'street-vendor': 'merchant',
  merchants: 'merchant',
  trader: 'merchant',
  seller: 'merchant',
  shopkeeper: 'merchant',

  // Maritime/harbor-related → use 'harbor' (allowed place type)
  dock: 'harbor',
  docks: 'harbor',
  harbour: 'harbor',
  port: 'harbor',
  'port-city': 'harbor',
  wharf: 'harbor',
  pier: 'harbor',
  quay: 'harbor',

  // Religious place → use 'temple' (allowed place type)
  shrine: 'temple',
  chapel: 'temple',
  sanctuary: 'temple',

  // Natural/wilderness → use 'forest'
  woods: 'forest',
  woodland: 'forest',
  grove: 'forest',

  // Grand structures → use 'castle'
  palace: 'castle',
  fortress: 'castle',
  citadel: 'castle',

  // Urban outdoor → use 'street'
  alley: 'street',
  alleyway: 'street',
  lane: 'street',
  road: 'street',

  // Underground → use 'cave' or 'dungeon' (underground removed as too generic)
  underground: 'cave',
  cavern: 'cave',
  crypt: 'dungeon',
  cellar: 'dungeon',

  // Indoor → use 'building' or specific types
  study: 'library',
  office: 'library',
  room: 'building',
  house: 'building',
  home: 'building',
  residence: 'building',

  // Security occupation → use 'guard'
  bouncer: 'guard',
  watchman: 'guard',
  sentry: 'guard',
  sentinel: 'guard',

  // Occupation synonyms
  fishing: 'fisher',
  fisherman: 'fisher',
  barman: 'bartender',
  barkeep: 'bartender',
  barkeeper: 'bartender',
  waiter: 'server',
  waitress: 'server',
  warrior: 'soldier',
  knight: 'soldier',
  cleric: 'priest',
  monk: 'acolyte',

  // Atmosphere tags → REJECT (not useful for entity matching)
  lively: '',
  bustling: '',
  busy: '',
  vibrant: '',
  active: '',
  crowded: '',
  ominous: '',
  foreboding: '',
  menacing: '',
  threatening: '',
  eerie: '',
  spooky: '',
  creepy: '',
  unsettling: '',
  welcoming: '',
  warm: '',
  friendly: '',
  inviting: '',
  cozy: '',
  comfortable: '',
  homey: '',
  peaceful: '',
  quiet: '',
  serene: '',
  mysterious: '',
  dark: '',
  gloomy: '',

  // Personality traits → REJECT (never used by any system)
  procedural: '',
  methodical: '',
  cheerful: '',
  stern: '',
  keen: '',
  harried: '',
  gruff: '',
  stoic: '',
  jovial: '',

  // Too specific - reject entirely
  undercroft: '',
  plateaus: '',
  'city-street': 'street',

  // Home capacity synonyms
  'single-home': 'home-single',
  'residence-single': 'home-single',
  'private-room': 'home-single',
  'shared-home': 'home-shared',
  'residence-shared': 'home-shared',
  'boarding-house': 'home-shared',
  barracks: 'home-shared',
  dormitory: 'home-shared',

  // Workplace capacity synonyms
  'tavern-workplace': 'workplace-tavern',
  'bar-workplace': 'workplace-tavern',
  'pub-workplace': 'workplace-tavern',
  'temple-workplace': 'workplace-temple',
  'shrine-workplace': 'workplace-temple',
  'church-workplace': 'workplace-temple',
  'shop-workplace': 'workplace-shop',
  'store-workplace': 'workplace-shop',
  'warehouse-workplace': 'workplace-warehouse',
  'storage-workplace': 'workplace-warehouse',

  // Lodging synonyms (temporary accommodation)
  'inn-room': 'lodging',
  'guest-room': 'lodging',
  'rented-room': 'lodging',
  'guest-quarters': 'lodging',
  'travelers-room': 'lodging',
  'rental-room': 'lodging',
};

/**
 * Normalizes a tag to its canonical form using the synonym map.
 * Returns the canonical tag, or empty string if the tag should be rejected.
 */
function canonicalizeTag(label: string): string {
  const normalized = normalizeTagLabel(label);
  if (!normalized) return '';

  // Check if this tag has a canonical form
  if (normalized in TAG_SYNONYMS) {
    return TAG_SYNONYMS[normalized];
  }

  return normalized;
}

/**
 * Checks if a tag is too specific/granular to be useful as a broad category.
 * Returns true if the tag should be rejected.
 */
function isTooSpecific(label: string): boolean {
  // Tags that are compound/too specific patterns
  const tooSpecificPatterns = [
    // Compound location+type patterns
    /^(harbor|dock|market|street|tavern|coastal|warehouse|alley)[- ](tavern|patron|regular|staff|server|brawler|local|breeze|adjacent|stalls|street|side|front|view|noise|contact|sentinel|room|watchman|quay)/,
    // Physical descriptors
    /^(hazel|blue|green|brown|odd)[- ]eyed$/,
    /^(broad|long)[- ](shouldered|limbed)$/,
    /^(salt|storm|wind|weather)[- ](stained|crusted|worn|swept|scoured)$/,
    // Too specific items/objects
    /^(oil|cargo|worn|private|creaking)[- ]/,
    // Food/drink specifics
    /^(cheap|spiced|fried)[- ]/,
    // Compound personality traits
    /^(quiet|sharp|dry|no)[- ](authority|tongued|humored|nonsense)$/,
  ];

  for (const pattern of tooSpecificPatterns) {
    if (pattern.test(label)) {
      return true;
    }
  }

  // Tags that are too long are likely too specific
  if (label.length > 30) {
    return true;
  }

  return false;
}

/**
 * Loads tags from the universe's tags.json file.
 */
export async function loadTags(universeId: string): Promise<TagDefinition[]> {
  try {
    const tagsPath = getTagsFilePath(universeId);
    if (!existsSync(tagsPath)) {
      return [];
    }

    const data = await readJsonFile<TagsFile>(tagsPath);
    return data.tags;
  } catch (error) {
    logger.error('TagManager', `Failed to load tags for universe ${universeId}`, {
      universeId,
      tagsPath: getTagsFilePath(universeId),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Saves tags to the universe's tags.json file.
 */
async function saveTags(universeId: string, tags: TagDefinition[]): Promise<void> {
  const tagsPath = getTagsFilePath(universeId);
  const tagsDir = dirname(tagsPath);
  await mkdir(tagsDir, { recursive: true });

  const data: TagsFile = { tags };
  await writeFile(tagsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Finds an existing tag that matches the given label (case-insensitive, normalized).
 * Returns the existing tag's tagId if found, or null if not found.
 */
function findMatchingExistingTag(tagLabel: string, existingTags: TagDefinition[]): string | null {
  const normalized = normalizeTagLabel(tagLabel);
  if (!normalized) return null;

  for (const existing of existingTags) {
    if (normalizeTagLabel(existing.label) === normalized) {
      return existing.tagId;
    }
  }

  return null;
}

/**
 * Ensures tags exist in tags.json. Normalizes and validates tags according to rules:
 * - All tags are normalized to lowercase and canonicalized (similar tags → canonical form)
 * - Proper nouns are rejected (logged as warning)
 * - Existing tags are reused when a match is found
 * - New tags are logged when created
 *
 * @param tagLabels - Array of tag labels to ensure exist in tags.json
 * @param universeId - The universe ID (optional, will use current universe if not provided)
 * @returns The tag IDs for the validated/created tags
 */
export async function ensureTags(tagLabels: string[], ctx: UniverseContext): Promise<string[]> {
  const universeId = ctx.universeId;
  if (tagLabels.length === 0) {
    return [];
  }

  const existingTags = await loadTags(universeId);
  const existingTagLabels = new Set(existingTags.map((t) => normalizeTagLabel(t.label)));

  const resultTags: string[] = [];
  const tagsToAdd: TagDefinition[] = [];

  for (const tagLabel of tagLabels) {
    if (!tagLabel || !tagLabel.trim()) {
      continue;
    }

    if (looksLikeProperNoun(tagLabel)) {
      logger.warn('Tag Manager', `Rejected proper noun tag: "${tagLabel}"`);
      continue;
    }

    if (isBlockedTag(tagLabel)) {
      logger.warn('Tag Manager', `Rejected blocked meta-term tag: "${tagLabel}"`);
      continue;
    }

    const canonical = canonicalizeTag(tagLabel);
    if (!canonical) {
      // Empty string means this tag should be rejected
      logger.warn('Tag Manager', `Rejected tag via canonicalization: "${tagLabel}"`);
      continue;
    }

    const normalized = canonical;

    if (isTooSpecific(normalized)) {
      logger.warn('Tag Manager', `Rejected too-specific tag: "${tagLabel}" -> "${normalized}"`);
      continue;
    }

    const existingMatch = findMatchingExistingTag(normalized, existingTags);
    if (existingMatch) {
      resultTags.push(existingMatch);
      continue;
    }

    const alreadyAdded = tagsToAdd.find((t) => normalizeTagLabel(t.label) === normalized);
    if (alreadyAdded) {
      resultTags.push(alreadyAdded.tagId);
      continue;
    }

    const allowedTags = getAllowedLlmTags();
    if (!allowedTags.includes(normalized)) {
      logger.warn(
        'Tag Manager',
        `Creating tag "${normalized}" which is not in the allowed tags list - verify this is intentional`,
      );
    }

    const baseTagId = 'TAG_' + normalized.replace(/-/g, '_');
    let tagId = baseTagId;
    const existingTagIds = new Set(existingTags.map((t) => t.tagId));
    let counter = 1;
    while (existingTagIds.has(tagId) || tagsToAdd.some((t) => t.tagId === tagId)) {
      tagId = `${baseTagId}_${counter}`;
      counter++;
    }

    const description = await generateTagDescription(ctx, normalized);

    const newTag: TagDefinition = {
      tagId,
      label: normalized,
      description,
    };

    logger.info(
      'Tag Manager',
      `Created new tag: ${tagId} "${normalized}" in universe ${universeId}`,
    );

    tagsToAdd.push(newTag);
    existingTagLabels.add(normalized);
    resultTags.push(tagId);
  }

  if (tagsToAdd.length > 0) {
    const allTags = [...existingTags, ...tagsToAdd];
    await saveTags(universeId, allTags);
  }

  return resultTags;
}

/**
 * Gets all existing tag labels for a universe, useful for providing as context to generators.
 */
export async function getExistingTagLabels(universeId: string): Promise<string[]> {
  const existingTags = await loadTags(universeId);
  return existingTags.map((t) => t.label);
}

/**
 * Generates a basic description for a tag using OpenAI.
 * Returns a simple fallback description if generation fails.
 */
async function generateTagDescription(ctx: UniverseContext, tagLabel: string): Promise<string> {
  try {
    const universeContext = ctx.universe.name ? `Universe: ${ctx.universe.name}` : '';

    const systemPrompt = `You are a tag description generator. Generate a brief, one-sentence description for a tag in a role-playing game context.

Return ONLY the description text, no JSON, no quotes, just the plain description sentence. Do NOT include phrases like "A tag for" or "This tag represents" - just describe what the tag means directly.`;

    const userPrompt = `${universeContext ? `${universeContext}\n\n` : ''}Tag label: "${tagLabel}"

Generate a brief one-sentence description for this tag:`;

    const result = await queryLlm({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'simple',
      context: 'Tag Description Generation',
    });

    const description = result.content.trim();
    if (description) {
      return description
        .replace(/^["']|["']$/g, '')
        .replace(/^\*\*|\*\*$/g, '')
        .trim();
    }
  } catch (error) {
    logger.error(
      'Tag Manager',
      `Failed to generate tag description for "${tagLabel}", using fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const labelWords = tagLabel.replace(/-/g, ' ');
  return `${labelWords.charAt(0).toUpperCase() + labelWords.slice(1)}.`;
}
