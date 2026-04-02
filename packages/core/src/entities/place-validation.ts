/**
 * Place Label Validation
 *
 * Centralized validation for place and exit labels.
 * Ensures labels refer to actual physical locations that can be entered,
 * not objects, containers, passages, or generic references.
 *
 * Used by:
 * - object-generator.ts (exit validation before creation)
 * - place-generator.ts (validatePlace before generation)
 * - place-awareness.ts (validatePlace before generation)
 */

/**
 * Object/container types that are NOT physical locations you can enter.
 * These are items, containers, compartments, or abstract concepts - not rooms.
 */
const OBJECT_CONTAINER_TYPES = [
  // Containers and storage
  'kit',
  'kits',
  'box',
  'boxes',
  'crate',
  'crates',
  'chest',
  'trunk',
  'trunks',
  'bag',
  'bags',
  'sack',
  'sacks',
  'pouch',
  'pouches',
  'container',
  'containers',
  'cabinet',
  'cabinets',
  'drawer',
  'drawers',
  'locker',
  'lockers',
  'bin',
  'bins',
  'barrel',
  'barrels',
  'basket',
  'baskets',
  'case',
  'cases',
  'canister',
  'canisters',
  // Equipment and tools
  'tool',
  'tools',
  'equipment',
  'device',
  'devices',
  'instrument',
  'instruments',
  'apparatus',
  'mechanism',
  'mechanisms',
  'machine',
  'machines',
  'terminal',
  'terminals',
  'console',
  'consoles',
  'panel',
  'panels',
  'unit',
  'units',
  'module',
  'modules',
  // Abstract/virtual
  'database',
  'databases',
  'system',
  'systems',
  'network',
  'networks',
  'interface',
  'interfaces',
  'communications',
  'channel',
  'channels',
  'connection',
  'connections',
  'link',
  'links',
  // Furniture parts (not rooms)
  'shelf',
  'shelves',
  'rack',
  'racks',
  'slot',
  'slots',
  'compartment',
  'compartments',
  'section',
  'sections',
  'partition',
  'partitions',
  'cubby',
  'cubbies',
];

/**
 * Room-type words that override object/container detection.
 * If a label contains one of these, it's considered a valid place even if
 * it also contains object/container words.
 */
const ROOM_TYPE_WORDS = [
  'bay',
  'room',
  'chamber',
  'hall',
  'quarters',
  'ward',
  'deck',
  'hold',
  'cabin',
  'cellar',
  'attic',
  'loft',
  'floor',
  'level',
  'wing',
  'tower',
  'keep',
  'center',
  'centre',
  'hub',
  'station',
  'office',
  'lab',
  'laboratory',
  // Transportation - these are places (e.g., "Terminal Gate" is a location, not a device)
  'gate',
  'gates',
  'platform',
  'platforms',
  'depot',
  'concourse',
  // Establishments - these are places even if they contain object words
  'inn',
  'tavern',
  'pub',
  'bar',
  'restaurant',
  'cafe',
  'hotel',
  'hostel',
  'house',
];

/**
 * Check if a label refers to an object, container, or abstract concept rather than a physical location.
 * These are things you interact WITH, not places you walk INTO.
 *
 * @param label - The label to check
 * @returns The detected object type if it's an object/container, or null if it's a valid location
 */
export function isObjectOrContainer(label: string): string | null {
  const normalized = label.toLowerCase().trim();

  const articlesAndPreps = ['the', 'a', 'an', 'via', 'through', 'by', 'from', 'to'];
  let stripped = normalized;
  for (const art of articlesAndPreps) {
    if (stripped.startsWith(art + ' ')) {
      stripped = stripped.slice(art.length + 1);
    }
  }

  const words = stripped.split(/\s+/);

  const hasRoomWord = words.some((w) => ROOM_TYPE_WORDS.includes(w));
  if (hasRoomWord) {
    return null; // It's a room, not an object
  }

  for (const word of words) {
    if (OBJECT_CONTAINER_TYPES.includes(word)) {
      return word;
    }
  }

  return null;
}

/**
 * Non-enterable location types - these are passages/connectors, not destinations.
 * Streets, roads, and similar are regions you travel THROUGH, not places you enter.
 */
const NON_ENTERABLE_TYPES = [
  'street',
  'streets',
  'road',
  'roads',
  'lane',
  'lanes',
  'alley',
  'alleys',
  'avenue',
  'avenues',
  'boulevard',
  'boulevards',
  'highway',
  'highways',
  'path',
  'paths',
  'trail',
  'trails',
  'way',
  'walkway',
  'walkways',
  'ladder',
  'ladders',
  'rope',
  'ropes',
  'bridge',
  'bridges',
  'stairway',
  'stairways',
  'staircase',
  'staircases',
];

/**
 * Check if a label refers to a non-enterable location type.
 * These are passages/connectors that shouldn't be standalone destinations.
 *
 * @param label - The label to check
 * @returns The detected non-enterable type, or null if it's a valid destination
 */
export function isNonEnterableLocation(label: string): string | null {
  const normalized = label.toLowerCase().trim();

  // Strip common articles
  const articles = ['the', 'a', 'an'];
  let stripped = normalized;
  for (const art of articles) {
    if (stripped.startsWith(art + ' ')) {
      stripped = stripped.slice(art.length + 1);
    }
  }

  const words = stripped.split(/\s+/);

  for (const word of words) {
    if (NON_ENTERABLE_TYPES.includes(word)) {
      // Exception: compound names like "Market Street" where the full name is a proper place
      const distinctiveWords = words.filter(
        (w) =>
          !NON_ENTERABLE_TYPES.includes(w) && !['the', 'a', 'an', 'to', 'of', 'at'].includes(w),
      );

      // If the only distinctive word is generic (like cardinal directions), still reject
      const genericDirections = [
        'north',
        'south',
        'east',
        'west',
        'main',
        'old',
        'new',
        'back',
        'front',
      ];
      const hasProperName = distinctiveWords.some((w) => !genericDirections.includes(w));

      if (!hasProperName) {
        return word;
      }
    }
  }

  return null;
}

/**
 * Common structural words that aren't distinctive place names.
 * Includes both generic structural terms AND building types that require proper noun prefixes.
 */
const STRUCTURE_WORDS = [
  // Generic structural terms
  'door',
  'room',
  'passage',
  'hallway',
  'corridor',
  'entrance',
  'exit',
  'stair',
  'stairs',
  'archway',
  'gateway',
  'threshold',
  'opening',
  'chamber',
  'cell',
  'alcove',
  'nook',
  'corner',
  'area',
  'space',
  'place',
  'building',
  'structure',
  // Generic directional/locational terms (vague references)
  'inside',
  'outside',
  'upstairs',
  'downstairs',
  'back',
  'there',
  'here',
  'way',
  // Building types that need proper noun prefixes (safety net for prompt failures)
  'dungeon',
  'tower',
  'gatehouse',
  'castle',
  'keep',
  'fortress',
  'citadel',
  'tavern',
  'inn',
  'pub',
  'temple',
  'shrine',
  'chapel',
  'church',
  'prison',
  'jail',
  'barracks',
  'armory',
  'armoury',
  'smithy',
  'forge',
  'warehouse',
  'manor',
  'mansion',
  'lighthouse',
  'watchtower',
  'guardhouse',
];

/**
 * Modifiers that make labels generic (positional/ordinal/possessive).
 */
const GENERIC_MODIFIERS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'left',
  'right',
  'far',
  'near',
  'back',
  'front',
  'main',
  'side',
  'other',
  'next',
  'upper',
  'lower',
  'inner',
  'outer',
  'nearby',
  'opposite',
  'adjacent',
  'old',
  'new',
  'the',
  'a',
  'an',
  'that',
  'this',
  'your',
  'my',
  'our',
  // Additional vague directional/relational words
  'another',
  'over',
  'in',
  'out',
];

/**
 * Check if a label contains navigation/direction syntax that shouldn't be in a place name.
 * Arrow notation and relative direction phrases indicate the label was copied from
 * player input rather than being a proper canonical place name.
 *
 * @param label - The label to check
 * @returns True if the label contains navigation syntax
 */
export function hasNavigationSyntax(label: string): boolean {
  const normalized = label.toLowerCase();

  // Arrow notation (navigation instructions)
  if (normalized.includes('→') || normalized.includes('->')) {
    return true;
  }

  // Relative direction phrases
  const RELATIVE_DIRECTION_PATTERNS = [
    /\bpast the\b/,
    /\bthrough the\b/,
    /\bvia the\b/,
    /\bbeyond the\b/,
    /\btoward the\b/,
    /\btowards the\b/,
    /\bdown the\b/,
    /\bup the\b/,
    /\bacross the\b/,
    /\balong the\b/,
  ];

  for (const pattern of RELATIVE_DIRECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a label contains parenthetical details.
 * Details should be in description, not the name.
 *
 * BAD: "Market Square (Fish Stalls)"
 * GOOD: "The Fish Market"
 *
 * @param label - The label to check
 * @returns True if the label contains parenthetical details
 */
export function hasParentheticalDetail(label: string): boolean {
  return /\([^)]+\)/.test(label);
}

/**
 * Check if a label contains a location suffix (address appended after a comma).
 * Labels like "The Crossroads Inn, Trident Road" should be rejected because they
 * mix the place name with its geographic location. Location context should come
 * from the place hierarchy (parentId), not the label.
 *
 * @param label - The label to check
 * @returns The detected location suffix if found, or null if valid
 *
 * @example
 * hasLocationSuffix("The Crossroads Inn, Trident Road") // ", Trident Road"
 * hasLocationSuffix("The Crossroads Inn") // null
 * hasLocationSuffix("Baker Street") // null (no comma, this is the place name itself)
 */
export function hasLocationSuffix(label: string): string | null {
  // Look for comma followed by words ending in a location type
  // Pattern: ", <optional words> <location type word>"
  const pattern =
    /,\s+[\w\s]+\b(road|street|avenue|lane|way|boulevard|highway|drive|court|place|row|terrace|alley|path|trail)\b/i;
  const match = label.match(pattern);
  if (match) {
    return match[0].trim();
  }
  return null;
}

/**
 * Check if a label is a generic/vague reference rather than a proper place name.
 * Generic labels like "second door", "the room", "back passage" should be rejected.
 *
 * @param label - The label to check
 * @returns True if the label is too generic, false if it's a valid place name
 */
export function isGenericLabel(label: string): boolean {
  const normalized = label.toLowerCase().trim();

  if (hasNavigationSyntax(label)) {
    return true;
  }

  if (isNonEnterableLocation(label)) {
    return true;
  }

  if (isObjectOrContainer(label)) {
    return true;
  }

  let stripped = normalized;
  for (const mod of GENERIC_MODIFIERS) {
    if (stripped.startsWith(mod + ' ')) {
      stripped = stripped.slice(mod.length + 1);
    }
  }

  const words = stripped.split(/\s+/);
  const lastWord = words[words.length - 1];

  // If the main noun is just a generic structure word, it's not a proper name
  if (STRUCTURE_WORDS.includes(lastWord)) {
    // Exception: if there's a distinctive adjective/name before it, allow it
    // e.g., "Crimson Chamber" is OK, but "back chamber" is not
    if (words.length >= 2) {
      const allGeneric = words
        .slice(0, -1)
        .every((w) => GENERIC_MODIFIERS.includes(w) || STRUCTURE_WORDS.includes(w));
      return allGeneric;
    }
    return true; // Just "door", "room", etc.
  }

  return false;
}

/**
 * Result of place label validation.
 */
export interface PlaceLabelValidation {
  /** Whether the label is valid */
  valid: boolean;
  /** If invalid, the reason why */
  reason?: string;
  /** If invalid, the detected problematic type */
  detectedType?: string;
}

/**
 * Validate a place or exit label.
 * Checks that the label refers to a valid physical location that can be entered.
 *
 * @param label - The label to validate
 * @returns Validation result with reason if invalid
 */
export function validatePlaceLabel(label: string): PlaceLabelValidation {
  if (!label || !label.trim()) {
    return {
      valid: false,
      reason: 'Label is empty',
    };
  }

  if (hasNavigationSyntax(label)) {
    return {
      valid: false,
      reason: 'Label contains navigation directions - use a canonical place name instead',
    };
  }

  if (hasParentheticalDetail(label)) {
    return {
      valid: false,
      reason: 'Label contains parenthetical details - put details in description instead',
      detectedType: 'parenthetical_detail',
    };
  }

  const locationSuffix = hasLocationSuffix(label);
  if (locationSuffix) {
    return {
      valid: false,
      reason: `Label contains a location suffix ("${locationSuffix}") - remove the address and use just the place name`,
      detectedType: locationSuffix,
    };
  }

  const objectType = isObjectOrContainer(label);
  if (objectType) {
    return {
      valid: false,
      reason: `Label refers to an object/container ("${objectType}"), not a physical location`,
      detectedType: objectType,
    };
  }

  const nonEnterableType = isNonEnterableLocation(label);
  if (nonEnterableType) {
    return {
      valid: false,
      reason: `Label refers to a non-enterable passage ("${nonEnterableType}"), not a destination`,
      detectedType: nonEnterableType,
    };
  }

  if (isGenericLabel(label)) {
    return {
      valid: false,
      reason: 'Label is too generic - use a proper place name',
    };
  }

  return { valid: true };
}

/**
 * Words that indicate a label refers to a sub-location within a larger place.
 * Used to prevent merging "The Tavern Back Room" with "The Tavern" via canonical hints.
 */
const SUB_LOCATION_INDICATORS = [
  // Positional modifiers
  'back',
  'front',
  'upper',
  'lower',
  'private',
  'inner',
  'outer',
  // Room/space types (indicates a sub-space)
  'room',
  'chamber',
  'quarters',
  'wing',
  'annex',
  'office',
  'closet',
  'pantry',
  'kitchen',
  'bedroom',
  'bathroom',
  'study',
  'library',
  'hall',
  'corridor',
  'passage',
  'alcove',
  // Storage areas (sub-spaces)
  'storage',
  'cellar',
  'basement',
  'attic',
  'vault',
  'storeroom',
];

/**
 * Check if a label refers to a sub-location within another place.
 * Sub-locations contain modifiers like "back", "storage", "room" that indicate
 * they are part of a larger location rather than being a top-level destination.
 *
 * This is used to prevent canonical hint matching from incorrectly merging
 * "The Tavern Back Room" with an existing "The Tavern" exit.
 *
 * @param label - The label to check
 * @returns True if the label appears to be a sub-location
 */
export function isSubLocation(label: string): boolean {
  const normalized = label.toLowerCase().trim();
  return SUB_LOCATION_INDICATORS.some((indicator) => normalized.includes(indicator));
}

/**
 * Generic region type words that need qualifying context.
 * A region named just "Harbor District" is too generic - it should be "Saltfog Harbor District".
 */
const GENERIC_REGION_TYPES = [
  // Districts and wards
  'district',
  'ward',
  'quarter',
  'sector',
  'zone',
  'precinct',
  // Harbor/water areas
  'harbor',
  'harbour',
  'docks',
  'port',
  'wharf',
  'quay',
  'pier',
  'waterfront',
  // Market/commerce
  'market',
  'marketplace',
  'bazaar',
  'trading',
  // Other common generic regions
  'square',
  'plaza',
  'commons',
  'green',
  'park',
  'garden',
  'slums',
  'undercity',
  'sewers',
  'tunnels',
  'heights',
  'hills',
  'flats',
  'row',
];

/**
 * Words that don't count as distinctive context for region names.
 * These are articles, generic modifiers, or the region type itself.
 */
const NON_DISTINCTIVE_WORDS = [
  // Articles
  'the',
  'a',
  'an',
  // Generic position/direction modifiers
  'old',
  'new',
  'upper',
  'lower',
  'inner',
  'outer',
  'central',
  'main',
  'north',
  'south',
  'east',
  'west',
  'northern',
  'southern',
  'eastern',
  'western',
  // Size modifiers
  'great',
  'grand',
  'little',
  'small',
  'big',
  'large',
  // Condition modifiers
  'dark',
  'deep',
  'high',
  'low',
];

/**
 * Result of region label validation.
 */
export interface RegionLabelValidation {
  /** Whether the label is valid for a region */
  valid: boolean;
  /** If invalid, the reason why */
  reason?: string;
  /** The generic type word that needs context */
  genericType?: string;
}

/**
 * Validate a region label to ensure it has globally unique proper noun naming.
 * Regions must include geographic context, not just generic types.
 *
 * @param label - The label to validate
 * @returns Validation result with reason if invalid
 *
 * @example
 * validateRegionLabel("Harbor District") // { valid: false, reason: "...", genericType: "district" }
 * validateRegionLabel("Saltfog Harbor District") // { valid: true }
 * validateRegionLabel("The Docks") // { valid: false, reason: "...", genericType: "docks" }
 * validateRegionLabel("Oxenfurt Docks") // { valid: true }
 */
export function validateRegionLabel(label: string): RegionLabelValidation {
  if (!label || !label.trim()) {
    return {
      valid: false,
      reason: 'Label is empty',
    };
  }

  const basicValidation = validatePlaceLabel(label);
  if (!basicValidation.valid) {
    return {
      valid: false,
      reason: basicValidation.reason,
    };
  }

  const normalized = label.toLowerCase().trim();
  const words = normalized.split(/\s+/);

  const genericTypeWord = words.find((w) => GENERIC_REGION_TYPES.includes(w));

  if (!genericTypeWord) {
    // No generic region type word found - this is fine (e.g., "Farsreach" is valid)
    return { valid: true };
  }

  const distinctiveWords = words.filter(
    (w) => !NON_DISTINCTIVE_WORDS.includes(w) && !GENERIC_REGION_TYPES.includes(w),
  );

  if (distinctiveWords.length === 0) {
    // No distinctive words - this is a generic region name
    return {
      valid: false,
      reason: `Region name "${label}" is too generic. Include geographic context (e.g., "Saltfog ${label}" or "Oxenfurt ${label}")`,
      genericType: genericTypeWord,
    };
  }

  return { valid: true };
}

/**
 * Check if a region label is generic (would fail validateRegionLabel).
 * Convenience function for filtering/detection.
 *
 * @param label - The label to check
 * @returns True if the label is a generic region name
 */
export function isGenericRegionLabel(label: string): boolean {
  return !validateRegionLabel(label).valid;
}
