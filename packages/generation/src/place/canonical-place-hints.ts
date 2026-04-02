/**
 * Canonical Place Hints
 *
 * Extracts semantic place type hints from text to enable matching
 * generic terms like "the harbor" to existing places of that type.
 * Used for lazy exit deduplication and place matching.
 */

/**
 * Mapping of canonical place types to their synonyms/variations.
 * The key is the canonical hint that will be stored on exits.
 */
const PLACE_TYPE_PATTERNS: Record<string, string[]> = {
  // Water/port areas
  harbor: [
    'harbor',
    'harbour',
    'docks',
    'dock',
    'port',
    'wharf',
    'wharves',
    'quay',
    'quays',
    'pier',
    'piers',
    'marina',
    'waterfront',
    'shipyard',
  ],

  // Commerce
  market: [
    'market',
    'marketplace',
    'bazaar',
    'fair',
    'trading post',
    'merchant quarter',
    'trade district',
  ],
  shop: ['shop', 'store', 'emporium', 'boutique', 'stall'],

  // Food/drink establishments
  tavern: ['tavern', 'inn', 'pub', 'bar', 'alehouse', 'taphouse', 'taproom', 'saloon', 'brewhouse'],
  restaurant: ['restaurant', 'eatery', 'dining hall', 'mess hall', 'canteen'],

  // Religious
  temple: [
    'temple',
    'shrine',
    'chapel',
    'church',
    'sanctuary',
    'cathedral',
    'monastery',
    'abbey',
    'priory',
  ],

  // Government/official
  palace: ['palace', 'castle', 'keep', 'citadel', 'fortress', 'stronghold'],
  townhall: ['town hall', 'city hall', 'guildhall', 'council hall', 'assembly hall', 'courthouse'],
  prison: ['prison', 'jail', 'gaol', 'dungeon', 'stockade', 'brig', 'holding cells'],

  // Military
  barracks: ['barracks', 'garrison', 'guardhouse', 'watch house', 'armory', 'armoury'],
  gate: ['gate', 'gates', 'gatehouse', 'city gate', 'town gate', 'main gate', 'entrance gate'],

  // Residential
  house: [
    'house',
    'home',
    'residence',
    'dwelling',
    'cottage',
    'hut',
    'hovel',
    'manor',
    'estate',
    'villa',
  ],
  apartment: ['apartment', 'flat', 'tenement', 'lodging', 'boarding house', 'room'],

  // Industrial/craft
  warehouse: ['warehouse', 'storehouse', 'depot', 'granary', 'silo', 'storage'],
  smithy: ['smithy', 'forge', 'blacksmith', 'foundry', 'metalworks'],
  workshop: ['workshop', 'atelier', 'studio', 'workroom'],

  // Public spaces
  square: ['square', 'plaza', 'piazza', 'forum', 'courtyard', 'commons', 'green'],
  park: ['park', 'garden', 'gardens', 'grove', 'orchard'],

  // Infrastructure
  bridge: ['bridge', 'crossing', 'overpass', 'viaduct'],
  tower: ['tower', 'spire', 'turret', 'watchtower', 'bell tower', 'lighthouse'],

  // Districts/regions
  district: ['district', 'ward', 'quarter', 'neighborhood', 'precinct', 'sector', 'zone'],

  // Underground
  cellar: ['cellar', 'basement', 'undercroft', 'crypt', 'vault', 'underground'],
  sewer: ['sewer', 'sewers', 'drain', 'drains', 'tunnels'],

  // Entertainment
  theater: ['theater', 'theatre', 'playhouse', 'amphitheater', 'arena', 'coliseum'],
  brothel: ['brothel', 'pleasure house', 'house of pleasure'],

  // Education
  library: ['library', 'archive', 'archives', 'scriptorium'],
  academy: ['academy', 'school', 'college', 'university', 'institute'],

  // Medical
  hospital: ['hospital', 'infirmary', 'hospice', 'clinic', 'healer'],

  // Nature
  forest: ['forest', 'woods', 'woodland', 'grove', 'thicket'],
  cave: ['cave', 'cavern', 'grotto', 'den', 'lair'],
  beach: ['beach', 'shore', 'shoreline', 'coast', 'strand'],
};

/**
 * Common articles and prepositions to strip from the beginning of place names.
 */
const STRIP_PREFIXES = ['the', 'a', 'an', 'to', 'toward', 'towards', 'into', 'unto'];

/**
 * Normalize text for matching: lowercase, strip articles, trim.
 */
function normalizeForHintMatch(text: string): string {
  let normalized = text.toLowerCase().trim();

  // Strip leading articles/prepositions
  for (const prefix of STRIP_PREFIXES) {
    if (normalized.startsWith(prefix + ' ')) {
      normalized = normalized.slice(prefix.length + 1).trim();
    }
  }

  return normalized;
}

/**
 * Extract a canonical place type hint from text.
 *
 * @param text - The text to analyze (exit label, target description, etc.)
 * @returns The canonical hint (e.g., "harbor") or null if no match
 *
 * @example
 * extractCanonicalHint("the docks") // returns "harbor"
 * extractCanonicalHint("The Green Dragon Inn") // returns "tavern"
 * extractCanonicalHint("mysterious cave") // returns "cave"
 */
export function extractCanonicalHint(text: string): string | null {
  if (!text) return null;

  const normalized = normalizeForHintMatch(text);

  // Check each canonical type and its patterns
  for (const [canonicalHint, patterns] of Object.entries(PLACE_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      // Check if the normalized text contains the pattern as a word
      // Use word boundary matching to avoid partial matches
      const regex = new RegExp(`\\b${escapeRegExp(pattern)}\\b`, 'i');
      if (regex.test(normalized)) {
        return canonicalHint;
      }
    }
  }

  return null;
}

/**
 * Check if two canonical hints overlap (are the same or semantically equivalent).
 *
 * @param hint1 - First canonical hint
 * @param hint2 - Second canonical hint
 * @returns True if the hints overlap
 */
export function hintsOverlap(
  hint1: string | null | undefined,
  hint2: string | null | undefined,
): boolean {
  if (!hint1 || !hint2) return false;
  return hint1 === hint2;
}

/**
 * Check if a text string matches a canonical hint.
 *
 * @param text - The text to check
 * @param hint - The canonical hint to match against
 * @returns True if the text matches the hint
 */
export function textMatchesHint(text: string, hint: string): boolean {
  const extractedHint = extractCanonicalHint(text);
  return extractedHint === hint;
}

/**
 * Get all patterns for a canonical hint.
 *
 * @param hint - The canonical hint
 * @returns Array of patterns or empty array if hint not found
 */
export function getPatternsForHint(hint: string): string[] {
  return PLACE_TYPE_PATTERNS[hint] ?? [];
}

/**
 * Get all known canonical hints.
 */
export function getAllCanonicalHints(): string[] {
  return Object.keys(PLACE_TYPE_PATTERNS);
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a mention should be added to an existing exit's mentions array.
 * Returns true if the mention is semantically related to the existing mentions/hint.
 *
 * @param newMention - The new mention to potentially add
 * @param existingMentions - Current mentions on the exit
 * @param existingHint - Current canonical hint on the exit
 * @returns True if the mention is related and should be consolidated
 */
export function mentionMatchesExit(
  newMention: string,
  existingMentions: string[] | undefined,
  existingHint: string | undefined,
): boolean {
  const newHint = extractCanonicalHint(newMention);

  // If we have a canonical hint match, they're related
  if (newHint && existingHint && hintsOverlap(newHint, existingHint)) {
    return true;
  }

  // Check if the new mention overlaps with any existing mention's hint
  if (existingMentions) {
    for (const existing of existingMentions) {
      const existingMentionHint = extractCanonicalHint(existing);
      if (newHint && existingMentionHint && hintsOverlap(newHint, existingMentionHint)) {
        return true;
      }
    }
  }

  return false;
}
