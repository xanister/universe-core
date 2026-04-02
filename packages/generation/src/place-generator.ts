import { addQuestion } from '@dmnpc/core/clarification/clarification-store.js';
import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { normalizeName } from '@dmnpc/core/entities/entity-utils.js';
import {
  createPlacePosition,
  getPlaceInnerDimensions,
} from '@dmnpc/core/entities/position-utils.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import {
  WRITING_STYLE_RULES,
  PLACE_DESCRIPTION_EXAMPLE,
  NO_INDIVIDUALS_IN_DESCRIPTIONS,
  PLACE_NAMING_RULES,
  VESSEL_NAMING_RULES,
} from '@dmnpc/core/prompts/prompt-constants.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Place, PlaceInfo } from '@dmnpc/types/entity';
import type { EnvironmentConfig, Purpose, WorldBible, GeneratedSlot } from '@dmnpc/types/world';
import { generateEntityId } from './id-generator.js';
import { generateEntityImage } from './media/entity-image-service.js';
import { runWithConcurrency } from '@dmnpc/core/infra/concurrency.js';
import { getOrGenerateLayout } from './place/place-layout-service.js';
import { getLayoutTemplate, selectLayoutVariant } from './place-layout/layout-templates.js';
import { mergeTagArrays } from './place-layout/generator.js';
import { getSpriteDefaultLayer, computeWorldPosition } from './place-layout/object-catalog.js';
import { extractCanonicalHint } from './place/canonical-place-hints.js';
import { createPlaceIdentityQuestion } from './place/place-clarification-provider.js';
import {
  getWorldBibleChildrenOf,
  getWorldBibleChildrenOfRoot,
  matchChildrenToSlots,
} from './place/world-bible-matcher.js';

/**
 * Check if a place is a vessel.
 * Derived from whether the place has a vessel_helm object.
 */
export function hasVesselTags(ctx: UniverseContext, place: Place): boolean {
  return ctx.getObjectsByPlace(place.id).some((o) => o.info.purpose === 'vessel_helm');
}

/**
 * Initialize a vessel place by setting its position.parent if not already traveling.
 * Should be called after tag extraction if the place has vessel tags.
 * Only initializes vessels that are explicitly tagged - no heuristic detection.
 *
 * @param place - The place to initialize as a vessel
 * @param dockPlaceId - The place ID where the vessel is docked
 * @param dockDescription - Optional description of the dock location (for logging)
 * @param ctx - Universe context for persistence
 */
export function initializeVesselIfNeeded(
  place: Place,
  dockPlaceId: string,
  dockDescription: string | undefined,
  ctx: UniverseContext,
): void {
  // Skip if already in transit
  if (place.destinationPlaceId) {
    return;
  }

  // Skip if already has a docked location (position.parent)
  if (place.position.parent) {
    return;
  }

  // Only initialize if explicitly tagged as a vessel
  if (!hasVesselTags(ctx, place)) {
    return;
  }

  // Initialize as docked - set position.parent to dock
  // (new vessels start docked, not in transit)
  const dockPlace = ctx.getPlace(dockPlaceId); // Throws if not found
  const dockSize = getPlaceInnerDimensions(dockPlace);
  const pos = place.position;
  place.position = {
    x: dockSize.width / 2,
    y: dockSize.height / 2,
    width: pos.width,
    height: pos.height,
    ...(pos.innerWidth != null && { innerWidth: pos.innerWidth }),
    ...(pos.innerHeight != null && { innerHeight: pos.innerHeight }),
    parent: dockPlaceId,
  };

  ctx.upsertEntity('place', place);

  logger.info(
    'Place Generator',
    `Auto-initialized vessel: ${place.label} docked at ${dockDescription ?? dockPlaceId}`,
  );
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Return the first sentence of a description (or the whole string if no period).
 * Used for one-line parent context in recursive creation hints.
 */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const dot = trimmed.indexOf('.');
  return dot >= 0 ? trimmed.slice(0, dot + 1).trim() : trimmed;
}

/** Default creation hint when no universe/slot context is available (e.g. repair flows, ad-hoc generation). */
export const DEFAULT_CREATION_HINT = 'Consistent with the existing world.';

/**
 * Build WorldBible context for place generation prompts.
 * Includes known places, lore, and atmosphere to ensure location consistency.
 * Uses truncation to control prompt size while preserving ALL items for continuity.
 */
function buildWorldBibleContextForPlaces(worldBible: WorldBible | null): string {
  if (!worldBible) {
    return '';
  }

  const parts: string[] = [];
  parts.push('\n## WORLD CONTEXT (use for consistency)');

  // Known places - ALL included, descriptions truncated to 80 chars
  if (worldBible.places.length > 0) {
    const placeDescriptions = worldBible.places
      .map((p) => `- ${p.name}: ${truncate(p.description, 80)}`)
      .join('\n');
    parts.push(`\n**Known Locations:**\n${placeDescriptions}`);
  }

  // Atmosphere - truncated to 100 chars
  if (worldBible.atmosphere) {
    parts.push(`\n**Atmosphere:** ${truncate(worldBible.atmosphere, 100)}`);
  }

  // Lore - truncated to 350 chars
  if (worldBible.lore) {
    parts.push(`\n**Lore:** ${truncate(worldBible.lore, 350)}`);
  }

  parts.push('\nPlaces should be consistent with established geography and culture.');

  return parts.join('');
}

/**
 * Result of finding a similar place.
 */
export interface SimilarPlaceMatch {
  place: Place;
  matchType: 'label' | 'alias' | 'canonicalHint';
  matchedValue: string;
}

/**
 * Find an existing place that matches or is similar to the given label.
 * Checks:
 * 1. Exact label match (case-insensitive)
 * 2. Alias match (case-insensitive)
 * 3. Canonical hint match within nearby places (e.g., both are "gate" type places)
 *
 * @param ctx - Universe context for data access
 * @param label - The label to match against
 * @param nearbyPlaceIds - Optional set of nearby place IDs for hint matching
 * @returns The matching place and how it matched, or null if no match
 */
export function findSimilarPlace(
  ctx: UniverseContext,
  label: string,
  nearbyPlaceIds?: Set<string>,
): SimilarPlaceMatch | null {
  const normalizedLabel = normalizeName(label);
  const allPlaces = ctx.places;

  // 1. Check exact label match (universe-wide)
  for (const place of allPlaces) {
    if (normalizeName(place.label) === normalizedLabel) {
      return { place, matchType: 'label', matchedValue: place.label };
    }
  }

  // 2. Check alias match (universe-wide)
  for (const place of allPlaces) {
    const aliases = place.aliases || [];
    for (const alias of aliases) {
      if (normalizeName(alias) === normalizedLabel) {
        return { place, matchType: 'alias', matchedValue: alias };
      }
    }
  }

  // 3. Check canonical hint match within nearby places
  // This catches cases like "the gates" matching "Farsreach Gates" when nearby
  // Only apply for SHORT/GENERIC labels (e.g., "the tavern", "back room")
  // Skip for SPECIFIC labels (e.g., "Golden Mug Tavern Storage Room") which should create new places
  const labelHint = extractCanonicalHint(label);
  const labelWordsForHint = label
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
    .split(/\s+/);
  const isGenericLabel = labelWordsForHint.length <= 3; // "back room", "the tavern", "storage area" are generic

  if (labelHint && isGenericLabel && nearbyPlaceIds && nearbyPlaceIds.size > 0) {
    for (const placeId of nearbyPlaceIds) {
      const place = ctx.findPlace(placeId);
      if (!place) continue;

      const placeHint = extractCanonicalHint(place.label);
      if (placeHint === labelHint) {
        // Found a nearby place with the same canonical hint
        // Log for visibility but return the match
        logger.info(
          'Place Generator',
          `Found similar place via canonical hint: "${label}" (${labelHint}) matches "${place.label}"`,
        );
        return { place, matchType: 'canonicalHint', matchedValue: labelHint };
      }

      // Also check aliases for canonical hint match
      for (const alias of place.aliases || []) {
        const aliasHint = extractCanonicalHint(alias);
        if (aliasHint === labelHint) {
          logger.info(
            'Place Generator',
            `Found similar place via alias canonical hint: "${label}" (${labelHint}) matches "${place.label}" alias "${alias}"`,
          );
          return { place, matchType: 'canonicalHint', matchedValue: labelHint };
        }
      }
    }
  }

  return null;
}

/**
 * Find existing places that share 2+ significant words with a given label.
 * These are candidates that need semantic (LLM) checking to determine if they're the same place.
 *
 * @param ctx - Universe context for data access
 * @param label - The label to check against existing places
 * @returns Array of places that share significant word overlap with the label
 */
export function findCandidatesWithWordOverlap(ctx: UniverseContext, label: string): Place[] {
  const normalizedLabel = normalizeName(label);
  const labelWords = normalizedLabel
    .split(/[\s—–-]+/) // Split on whitespace and various dashes
    .filter((w) => w.length > 2); // Ignore very short words like "of", "the", "a"

  // Need at least 2 words in the label to find meaningful overlap
  if (labelWords.length < 2) {
    return [];
  }

  const candidates: Place[] = [];
  const allPlaces = ctx.places;

  for (const place of allPlaces) {
    const placeLabelNormalized = normalizeName(place.label);
    const placeWords = placeLabelNormalized.split(/[\s—–-]+/).filter((w) => w.length > 2);

    // Count matching words
    const matchingWords = labelWords.filter((w) => placeWords.includes(w));

    // Need at least 2 matching significant words
    if (matchingWords.length >= 2) {
      candidates.push(place);
    }
  }

  return candidates;
}

/** Confidence threshold below which we create a clarification question */
const SIMILARITY_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Use LLM to check if a new place is semantically equivalent to one of the candidate existing places.
 * This is used to distinguish between:
 * - Abbreviations: "Warehouse Twelve" = "Seacouver District — Warehouse Twelve" (SAME)
 * - Child locations: "Fogfen Cross library" ≠ "Fogfen Cross" (DIFFERENT - library is inside town)
 * - Adjacent locations: "river outside Fogfen Cross" ≠ "Fogfen Cross" (DIFFERENT)
 *
 * When the LLM's confidence is below threshold, creates a clarification question for user review.
 *
 * @param newLabel - Label of the new place being created
 * @param newDescription - Description of the new place
 * @param candidates - Existing places with word overlap that need semantic checking
 * @param universeId - Optional universe ID for storing clarification questions
 * @returns The matching existing place if LLM determines they're the same with high confidence, or null
 */
export async function checkPlaceSimilarityWithLlm(
  newLabel: string,
  newDescription: string,
  candidates: Place[],
  universeId?: string,
): Promise<Place | null> {
  if (candidates.length === 0) {
    return null;
  }

  const systemPrompt = `You are checking if two place references refer to the same physical location.

Consider these examples:
- "Warehouse Twelve" and "Seacouver District — Warehouse Twelve" = SAME (abbreviation/shortening)
- "Harbor Ward" and "Saltfog Harbor Ward" = SAME (informal name)
- "Fogfen Cross library" and "Fogfen Cross" = DIFFERENT (library is inside the town)
- "river outside Fogfen Cross" and "Fogfen Cross" = DIFFERENT (river is adjacent to town)
- "Fogfen Cross market" and "Fogfen Cross" = DIFFERENT (market is a location within the town)

The key distinction:
- SAME = one name is a shortened/informal version of the other
- DIFFERENT = one is a sub-location, adjacent location, or distinct place that happens to share words

You must also provide a confidence score (0.0-1.0) for your decision:
- 1.0 = absolutely certain
- 0.7+ = confident based on clear evidence
- 0.5-0.7 = uncertain, could go either way
- <0.5 = very uncertain, need more context`;

  interface SimilarityResult {
    result: 'same' | 'different';
    confidence: number;
  }

  const similaritySchema = {
    type: 'object',
    properties: {
      result: { type: 'string', enum: ['same', 'different'] },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence in this decision (0.0-1.0)',
      },
    },
    required: ['result', 'confidence'],
    additionalProperties: false,
  };

  // Check each candidate
  for (const candidate of candidates) {
    const userPrompt = `New place: "${newLabel}"
Description: "${newDescription}"

Existing place: "${candidate.label}"
Description: "${candidate.description}"

Are these the SAME physical location, or DIFFERENT locations? Provide your confidence.`;

    try {
      const result = await queryLlm<SimilarityResult>({
        system: systemPrompt,
        prompt: userPrompt,
        complexity: 'simple', // gpt-5-mini - nano struggles with structured output
        context: 'Place Similarity Check',
        schema: {
          name: 'similarity_check',
          schema: similaritySchema,
        },
      });

      const { result: decision, confidence } = result.content;

      // If confidence is below threshold, create a clarification question instead of deciding
      if (confidence < SIMILARITY_CONFIDENCE_THRESHOLD && universeId) {
        const question = createPlaceIdentityQuestion(
          newLabel,
          newDescription,
          candidate,
          undefined, // newPlaceId not known yet
        );
        await addQuestion(universeId, question);
        logger.info(
          'Place Generator',
          `Low confidence (${confidence.toFixed(2)}) for "${newLabel}" vs "${candidate.label}", created clarification question`,
        );
        // Don't make a decision - return null and let the user decide
        continue;
      }

      if (decision === 'same') {
        logger.info(
          'Place Generator',
          `LLM similarity check: "${newLabel}" is SAME as "${candidate.label}" (confidence: ${confidence.toFixed(2)})`,
        );
        return candidate;
      }

      logger.info(
        'Place Generator',
        `LLM similarity check: "${newLabel}" is DIFFERENT from "${candidate.label}" (confidence: ${confidence.toFixed(2)})`,
      );
    } catch (error) {
      logger.error('Place Generator', `LLM similarity check failed for "${newLabel}"`, {
        error: error instanceof Error ? error.message : String(error),
        candidate: candidate.label,
      });
      throw error;
    }
  }

  return null;
}

/**
 * Extract the region context prefix from a place label.
 * This is the first word(s) that provide geographic context.
 *
 * Examples:
 * - "Saltfog Harbor Ward" → "Saltfog"
 * - "Oxenfurt Harbor District" → "Oxenfurt"
 * - "Icehold Upper Wards" → "Icehold"
 * - "The Rusty Mug" → null (not a region-style name)
 */
function extractRegionContext(place: Place): string | null {
  const label = place.label;

  // Skip if it starts with "The" - likely a building name
  if (label.toLowerCase().startsWith('the ')) {
    return null;
  }

  // Look for the first distinctive word (proper noun context)
  const words = label.split(/\s+/);
  if (words.length >= 2) {
    // Return first word if it looks like a proper noun (capitalized, not a generic word)
    const genericWords = [
      'harbor',
      'district',
      'ward',
      'quarter',
      'docks',
      'market',
      'temple',
      'upper',
      'lower',
      'old',
      'new',
    ];
    const firstWord = words[0];
    if (firstWord && !genericWords.includes(firstWord.toLowerCase())) {
      return firstWord;
    }
  }

  return null;
}

/**
 * Get the region context prefix from ancestors.
 * Looks for the most specific region context from the hierarchy.
 */
function getRegionContextFromAncestors(parentPlace: Place, ancestors: Place[]): string | null {
  // First try the immediate parent
  const parentContext = extractRegionContext(parentPlace);
  if (parentContext) {
    return parentContext;
  }

  // Then try ancestors (they're already ordered from nearest to farthest)
  for (const ancestor of ancestors) {
    const context = extractRegionContext(ancestor);
    if (context) {
      return context;
    }
  }

  return null;
}

/**
 * Build context about ancestor places by traversing the place hierarchy.
 * Returns an array of places from immediate parent up to the top-level (max depth).
 * Uses position.parent for hierarchy traversal.
 */
function getAncestorPlaces(ctx: UniverseContext, placeId: string, maxDepth: number = 3): Place[] {
  const ancestors: Place[] = [];
  const visited = new Set<string>();
  let currentPlaceId = placeId;

  for (let depth = 0; depth < maxDepth; depth++) {
    if (visited.has(currentPlaceId)) break;
    visited.add(currentPlaceId);

    const currentPlace = ctx.findPlace(currentPlaceId);
    if (!currentPlace) break;

    // Get parent from hierarchy
    const parentId = currentPlace.position.parent;
    if (!parentId) break;

    const parentPlace = ctx.findPlace(parentId);
    if (parentPlace) {
      ancestors.push(parentPlace);
      currentPlaceId = parentId;
    } else {
      break;
    }
  }

  return ancestors;
}

export interface GeneratePlaceParams {
  description: string;
  /** Required. Theme/setting hint for this place; seeded at universe creation and combined recursively (parent hint + slot role + one-line parent context). */
  creationHint: string;
  /** Omit or null for root place (cosmos); required for non-root places */
  parentId?: string | null;
  /** For root place only: use this id instead of generating from label */
  id?: string;
  /** Force the place to have this exact label */
  label?: string;
  /** Required. Environment from layout template. */
  environment: EnvironmentConfig;
  /** Required. Purpose from layout template (e.g. cosmos, plains, tavern). */
  purpose: Purpose;
  /** If true, marks the place as important so it persists across sessions */
  important?: boolean;
  /** Pre-computed position from layout slot (in tile coordinates) */
  slotPosition?: { x: number; y: number; width: number; height: number };
  /** Tags inherited from parent place and slot, used for child object filtering */
  inheritedRequiredTags?: string[] | null;
  /** World bible for WB-aware child generation (WB children claim slots first) */
  worldBible?: WorldBible | null;
  /** Label of this place in the world bible (for looking up WB children) */
  worldBiblePlaceName?: string | null;
}

/**
 * Create a root place for a universe using a selected layout template.
 *
 * Derives purpose, environment, and description from the template so callers
 * never need to hardcode cosmos-specific values.
 */
export async function createRootPlace(
  ctx: UniverseContext,
  templateId: string,
  creationHint: string,
  overrides?: { label?: string; description?: string; purpose?: string },
): Promise<Place> {
  const template = getLayoutTemplate(templateId);
  if (!template) {
    throw new Error(
      `Root layout template "${templateId}" not found. Available templates must have a matching id.`,
    );
  }
  const variant = selectLayoutVariant(template);
  const purpose = overrides?.purpose ?? template.purposes[0];

  return generatePlace(ctx, {
    purpose,
    environment: variant.environment,
    description: overrides?.description ?? template.description,
    creationHint,
    parentId: null,
    label: overrides?.label,
    important: true,
  });
}

/**
 * Generates a place using OpenAI based on a description and saves it to the universe.
 * Includes all required PlaceInfo fields.
 *
 * @param ctx - Universe context for data access
 * @param params - Generation parameters
 * @param params.label - If provided, the place MUST have this exact label
 * @param params.environment - Required. Environment config from layout template.
 */
export async function generatePlace(
  ctx: UniverseContext,
  {
    description,
    creationHint,
    parentId: parentIdParam,
    id: forcedId,
    label,
    environment,
    purpose,
    important,
    slotPosition,
    inheritedRequiredTags,
    worldBible,
    worldBiblePlaceName,
  }: GeneratePlaceParams,
): Promise<Place> {
  logger.info('Place Generator', `Generating place: ${description.slice(0, 80)}`);

  const universe = ctx.universe;
  const isRoot = parentIdParam == null;
  const parentId = isRoot ? undefined : parentIdParam;

  // Root place: no parent. Non-root: parent must exist.
  const parentPlace: Place | null = isRoot ? null : (ctx.findPlace(parentId!) ?? null);
  if (!isRoot && !parentPlace) {
    throw new Error(`Parent place with id ${parentId} not found`);
  }

  // Check for existing similar places before generating
  // Build set of nearby place IDs for hint matching (parent + siblings); empty for root
  const nearbyPlaceIds = new Set<string>(parentId ? [parentId] : []);
  if (parentId) {
    for (const place of ctx.places) {
      if (place.position.parent === parentId) {
        nearbyPlaceIds.add(place.id);
      }
    }
  }

  // Build nearby places list for LLM context (to prevent duplicate label generation)
  const nearbyPlaces = Array.from(nearbyPlaceIds)
    .map((id) => ctx.findPlace(id))
    .filter((p): p is Place => p != null);
  const nearbyPlacesList = nearbyPlaces
    .map((p) => {
      const aliasesStr =
        p.aliases && p.aliases.length > 0 ? ` [aliases: ${p.aliases.join(', ')}]` : '';
      return `- ${p.label}${aliasesStr}`;
    })
    .join('\n');
  const nearbyPlacesBlock =
    nearbyPlaces.length > 0
      ? `\n\n**NEARBY EXISTING PLACES** (do not create duplicates):
${nearbyPlacesList}
CRITICAL: Do not create a place with a name similar to any existing place listed above. If the description matches an existing place, you should generate a label that clearly distinguishes it or indicates it's a different area/room.`
      : '';

  if (label) {
    // Fast check: exact label/alias/canonical hint match
    const similarPlace = findSimilarPlace(ctx, label, nearbyPlaceIds);
    if (similarPlace) {
      logger.info(
        'Place Generator',
        `Found existing similar place, skipping generation: "${label}" matches "${similarPlace.place.label}" via ${similarPlace.matchType}`,
      );
      // Add the requested label as an alias if it's not already there
      if (similarPlace.matchType !== 'label') {
        ctx.addPlaceAlias(similarPlace.place.id, label);
      }
      return similarPlace.place;
    }

    // LLM-based semantic similarity check for places with word overlap
    const candidates = findCandidatesWithWordOverlap(ctx, label);
    if (candidates.length > 0) {
      const matchingPlace = await checkPlaceSimilarityWithLlm(
        label,
        description,
        candidates,
        ctx.universeId,
      );
      if (matchingPlace) {
        logger.info(
          'Place Generator',
          `LLM similarity check found existing place: "${label}" is same as "${matchingPlace.label}", skipping generation`,
        );
        // Add the new label as an alias
        ctx.addPlaceAlias(matchingPlace.id, label);
        return matchingPlace;
      }
    }
  }

  // Build rich context about the universe, parent place, and ancestors
  const universeContext = universe.name ? `Universe: ${universe.name}` : '';

  // Get ancestor places for context (city → district → building hierarchy); none for root
  const ancestors = isRoot ? [] : getAncestorPlaces(ctx, parentId!, 3);

  // Build hierarchical location context (from largest to smallest)
  let locationContext = '';
  if (isRoot) {
    locationContext = '\n\nThis is the root of the universe (no parent location).';
  } else {
    // Add ancestors in reverse order (top-level first)
    const ancestorContext = [...ancestors].reverse();
    for (const ancestor of ancestorContext) {
      locationContext += `\n\n### ${ancestor.label}\n${ancestor.description}`;
    }
    // Add the immediate parent place with full description
    locationContext += `\n\n### ${parentPlace!.label} (Immediate Parent)\n${parentPlace!.description}`;
  }

  const parentPlaceContext = `LOCATION HIERARCHY (the new place will be inside/connected to these locations):${locationContext}`;

  // Get region context for proper noun naming (null for root)
  const regionContext = isRoot ? null : getRegionContextFromAncestors(parentPlace!, ancestors);

  // Build WorldBible context for world consistency
  const worldBibleContext = buildWorldBibleContextForPlaces(ctx.worldBible);

  const systemPrompt = `You are a place generator. Generate locations based on the description and context provided.

${WRITING_STYLE_RULES}
${PLACE_DESCRIPTION_EXAMPLE}
${worldBibleContext}
WORLD CONSISTENCY (CRITICAL):
- You will be given the LOCATION HIERARCHY showing where this new place fits in the world.
- The new place MUST be consistent with its parent locations. A tavern in a foggy harbor district should reflect that atmosphere. A room in an ancient tower should match the tower's style.
- Reference specific details from parent locations when appropriate (architectural style, atmosphere, cultural elements).
- The new place should feel like it naturally belongs in its parent location.

${NO_INDIVIDUALS_IN_DESCRIPTIONS}

${label ? '' : PLACE_NAMING_RULES + '\n\n' + VESSEL_NAMING_RULES + '\n\n'}Rules: 
${
  label
    ? `- CRITICAL: The place MUST be labeled EXACTLY "${label}". Use this exact value as the label field.`
    : `- Follow the PLACE NAMING STYLE rules above. For districts/regions, include parent context like "${regionContext || 'Farsreach'}".`
}
- Keep all fields concise.
- The description MUST be 3-4 sentences maximum, focusing on the most distinctive architectural and atmospheric features.
- The description MUST be written in third person (describe what the place is, not "you see" or "you enter").
- Place type (for context only; do not output): purpose="${purpose}", environment="${environment.type}". Use this to write a fitting label and description.
- The short_description MUST be a brief phrase describing the place WITHOUT using its name. It MUST be less than 30 characters total. Examples: "dim smoky tavern", "ancient stone tower", "crowded market district".`;

  const userPrompt = `${universeContext ? `${universeContext}\n` : ''}Creation context (use to guide label and description):\n${creationHint}\n\n${parentPlaceContext}${nearbyPlacesBlock}\n\nPlace description: ${description}\n\nGenerate the place JSON.`;

  interface GeneratedPlace {
    label: string;
    description: string;
    short_description: string;
  }

  const placeSchema = {
    type: 'object',
    properties: {
      label: { type: 'string' },
      description: { type: 'string' },
      short_description: { type: 'string' },
    },
    required: ['label', 'description', 'short_description'],
    additionalProperties: false,
  };

  try {
    const result = await queryLlm<GeneratedPlace>({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'reasoning', // Place generation requires quality
      context: 'Place Generator',
      schema: {
        name: 'place_schema',
        schema: placeSchema,
      },
    });

    const parsed = result.content;

    // Validate required fields
    if (!parsed.label || !parsed.description || !parsed.short_description) {
      throw new Error(
        'Generated place missing required fields (label, description, short_description)',
      );
    }

    // Validate short_description length
    if (parsed.short_description.length > 30) {
      logger.warn(
        'Place Generator',
        `short_description too long (${parsed.short_description.length} chars), truncating`,
      );
      parsed.short_description = parsed.short_description.substring(0, 30).trim();
    }

    // Post-generation duplicate check: if no label was provided upfront, check if LLM-generated label matches existing place
    if (!label) {
      const similarPlace = findSimilarPlace(ctx, parsed.label, nearbyPlaceIds);
      if (similarPlace) {
        logger.info(
          'Place Generator',
          `LLM generated label "${parsed.label}" matches existing place "${similarPlace.place.label}" via ${similarPlace.matchType}, reusing existing place`,
        );
        // Add the generated label as an alias if it's not already there
        if (similarPlace.matchType !== 'label') {
          ctx.addPlaceAlias(similarPlace.place.id, parsed.label);
        }
        return similarPlace.place;
      }
    }

    // LLM-based semantic similarity check for places with word overlap
    // This catches cases like "Warehouse Twelve" = "Seacouver District — Warehouse Twelve" (same place)
    // while correctly allowing "Fogfen Cross library" ≠ "Fogfen Cross" (different places)
    const candidates = findCandidatesWithWordOverlap(ctx, parsed.label);
    if (candidates.length > 0) {
      const matchingPlace = await checkPlaceSimilarityWithLlm(
        parsed.label,
        parsed.description,
        candidates,
        ctx.universeId,
      );
      if (matchingPlace) {
        logger.info(
          'Place Generator',
          `LLM similarity check found existing place: "${parsed.label}" is same as "${matchingPlace.label}", reusing existing place`,
        );
        // Add the new label as an alias
        ctx.addPlaceAlias(matchingPlace.id, parsed.label);
        return matchingPlace;
      }
    }

    // Purpose and environment are required from the caller (layout template).
    const scale = 'feet';

    // Look up sprite from layout template
    const layoutTemplate = getLayoutTemplate(purpose);
    if (!layoutTemplate) {
      throw new Error(
        `No layout template found for purpose "${purpose}". Add a layout in entities/layouts/ with id "${purpose}" and a spriteId that exists in sprite-registry.json.`,
      );
    }
    const spriteId = layoutTemplate.spriteId;
    logger.debug('Place Generator', `Found sprite "${spriteId}" for purpose "${purpose}"`);

    const placeInfo: PlaceInfo = {
      purpose,
      environment,
      scale,
      spriteConfig: {
        spriteId,
        facing: 'south',
        layer: getSpriteDefaultLayer(spriteId) ?? 'default',
      },
      music: null,
      musicHints: null,
      commonKnowledge: null,
      secrets: null,
      isTemporary: false,
      dockedAtPlaceId: null,
      timeScale: layoutTemplate.timeScale,
      battleBackgroundUrl: '',
      inheritedRequiredTags: inheritedRequiredTags ?? null,
    };

    const placeId = isRoot
      ? (forcedId ?? generateEntityId(ctx, parsed.label, 'place'))
      : generateEntityId(ctx, parsed.label, 'place');

    // Position: innerWidth/innerHeight set when layout is generated; width/height from slot when child
    const TILE_SIZE = 32;
    const position = isRoot
      ? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          parent: null,
        }
      : slotPosition
        ? {
            // Use computeWorldPosition for consistency with regeneration path
            // (center-x, bottom-y alignment matching client setOrigin(0.5, 1))
            ...computeWorldPosition(
              slotPosition.x,
              slotPosition.y,
              slotPosition.width,
              slotPosition.height,
            ),
            width: slotPosition.width * TILE_SIZE,
            height: slotPosition.height * TILE_SIZE,
            parent: parentId!,
          }
        : createPlacePosition(parentPlace!, { width: 0, height: 0 });

    const place: Place = {
      id: placeId,
      label: parsed.label,
      description: parsed.description,
      short_description: parsed.short_description,
      tags: [], // Tags extracted async in separate step
      entityType: 'place',
      info: placeInfo,
      position,
      destinationPlaceId: null,
      travelPath: null,
      travelSegmentIndex: null,
      image: null,
      faceAnchorY: null,
      omitFromPlot: false,
      aliases: null,
      displayName: null,
      interaction: { typeId: 'enter' },
      relationships: [],
      important: important || false,
    };

    // Save the place (this also updates the in-memory universe cache)
    ctx.upsertEntity('place', place);

    // Initialize vessel position if place has explicit vessel tags (TAG_vessel, etc.)
    // Skip for root (no parent to dock at)
    if (!isRoot && parentPlace) {
      initializeVesselIfNeeded(place, parentId!, parentPlace.label, ctx);
    }

    logger.info('Place Generator', `Generated and saved place: ${place.label}`);

    // Generate layout - this creates all objects including exit objects
    const layout = await getOrGenerateLayout(ctx, place.id, {
      skipAugmentation: true,
    });

    // Configure exits to parent (skip for root; root has no parent)
    // Always overwrite labels -- slot-created exits get the catalog entity's name
    // (e.g. "Archway") which is not meaningful. Set the parent place label instead.
    if (parentPlace) {
      const exits = ctx.getObjectsByPlace(place.id).filter((o) => o.info.purpose === 'exit');
      for (const exit of exits) {
        exit.label = parentPlace.label;
        exit.description = `Exit to ${parentPlace.label}`;
        ctx.upsertEntity('object', exit);
        logger.info('Place Generator', `Configured exit: ${exit.id} -> ${parentPlace.label}`);
      }
    }

    // Persist now - save this place before any recursive generation
    // If we crash during child generation, we don't lose this place
    await ctx.persistAll();
    logger.info('Place Generator', `Persisted place: ${place.label}`);

    // Filter slots that are child places (purpose has a layout template)
    const childPlaceSlots: GeneratedSlot[] = layout!.slots.filter((slot: GeneratedSlot) => {
      const hasTemplate = getLayoutTemplate(slot.purpose) !== undefined;
      return hasTemplate;
    });

    // Build child generation tasks and place image task to run in parallel.
    // Place image uses only parent data so it's safe to overlap with child subtrees.
    const childTasks: Array<() => Promise<Place>> = [];

    if (childPlaceSlots.length > 0) {
      logger.info(
        'Place Generator',
        `Generating ${childPlaceSlots.length} child places from positioned slots for ${place.label}`,
      );

      const wbPlaceName = worldBiblePlaceName ?? label;
      const wb = worldBible ?? null;

      // WB-aware child generation: WB children claim matching slots first
      const wbChildren =
        wb && wbPlaceName
          ? isRoot
            ? getWorldBibleChildrenOfRoot(wb, wbPlaceName)
            : getWorldBibleChildrenOf(wb, wbPlaceName)
          : [];

      let matchedSlots: Array<{
        wbPlace: import('./place/world-bible-matcher.js').SlotMatch['wbPlace'];
        slotIndex: number;
      }> = [];
      let unmatchedChildren = wbChildren;
      let unmatchedSlotIndices = childPlaceSlots.map((_, i) => i);

      if (wbChildren.length > 0) {
        const parentOneLine =
          place.short_description.trim() || firstSentence(place.description || '');
        const matchResult = await matchChildrenToSlots(
          wbChildren,
          childPlaceSlots,
          `${place.label}: ${parentOneLine}`,
        );
        matchedSlots = matchResult.matched;
        unmatchedChildren = matchResult.unmatchedChildren;
        unmatchedSlotIndices = matchResult.unmatchedSlots;

        logger.info(
          'Place Generator',
          `WB slot matching for ${place.label}: ${matchedSlots.length} matched, ${unmatchedChildren.length} unmatched children, ${unmatchedSlotIndices.length} unmatched slots`,
        );
      }

      // 1. Matched WB children → create in their matched slot positions
      for (const { wbPlace, slotIndex } of matchedSlots) {
        const slot = childPlaceSlots[slotIndex];
        const childTemplate = getLayoutTemplate(wbPlace.purpose) ?? getLayoutTemplate(slot.purpose);
        if (!childTemplate) continue;
        const childVariant = selectLayoutVariant(childTemplate);
        const parentOneLine =
          place.short_description.trim() || firstSentence(place.description || '');
        const childHint = `${creationHint}\n\nThis place is ${wbPlace.name} (${wbPlace.purpose}) within ${place.label}. (${place.label}: ${parentOneLine}).`;

        childTasks.push(() =>
          generatePlace(ctx, {
            description: wbPlace.description,
            creationHint: childHint,
            parentId: place.id,
            label: wbPlace.name,
            purpose: wbPlace.purpose,
            environment: childVariant.environment,
            slotPosition: {
              x: slot.x,
              y: slot.y,
              width: slot.width,
              height: slot.height,
            },
            inheritedRequiredTags: mergeTagArrays(
              place.info.inheritedRequiredTags,
              slot.inheritableTags,
            ),
            important: true,
            worldBible: wb,
            worldBiblePlaceName: wbPlace.name,
          }),
        );
      }

      // 2. Unmatched slots → generate generic children as before
      for (const slotIdx of unmatchedSlotIndices) {
        const slot = childPlaceSlots[slotIdx];
        const childPurpose = slot.purpose;
        const childTemplate = getLayoutTemplate(childPurpose);
        if (!childTemplate) continue;
        const childVariant = selectLayoutVariant(childTemplate);
        const parentOneLine =
          place.short_description.trim() || firstSentence(place.description || '');
        const childHint = `${creationHint}\n\nThis place is a ${childPurpose.replace(/_/g, ' ')} within ${place.label}. (${place.label}: ${parentOneLine}).`;

        childTasks.push(() =>
          generatePlace(ctx, {
            description: `A ${childPurpose.replace(/_/g, ' ')} within ${place.label}`,
            creationHint: childHint,
            parentId: place.id,
            purpose: childPurpose,
            environment: childVariant.environment,
            slotPosition: {
              x: slot.x,
              y: slot.y,
              width: slot.width,
              height: slot.height,
            },
            inheritedRequiredTags: mergeTagArrays(
              place.info.inheritedRequiredTags,
              slot.inheritableTags,
            ),
            worldBible: wb,
          }),
        );
      }

      // 3. Unmatched WB children → create at generic position under this place
      for (const wbChild of unmatchedChildren) {
        const childTemplate = getLayoutTemplate(wbChild.purpose);
        if (!childTemplate) {
          logger.warn(
            'Place Generator',
            `No layout template for WB child "${wbChild.name}" (purpose: ${wbChild.purpose}), skipping`,
          );
          continue;
        }
        const childVariant = selectLayoutVariant(childTemplate);
        const parentOneLine =
          place.short_description.trim() || firstSentence(place.description || '');
        const childHint = `${creationHint}\n\nThis place is ${wbChild.name} (${wbChild.purpose}) within ${place.label}. (${place.label}: ${parentOneLine}).`;

        childTasks.push(() =>
          generatePlace(ctx, {
            description: wbChild.description,
            creationHint: childHint,
            parentId: place.id,
            label: wbChild.name,
            purpose: wbChild.purpose,
            environment: childVariant.environment,
            important: true,
            worldBible: wb,
            worldBiblePlaceName: wbChild.name,
          }),
        );
      }
    } else {
      logger.debug('Place Generator', `No child place slots for ${purpose}`);
    }

    // Run child subtree generation (concurrency-limited) in parallel with place image
    const [childResults] = await Promise.all([
      childTasks.length > 0
        ? runWithConcurrency(childTasks, 3, `Place Children [${place.label}]`)
        : Promise.resolve([]),
      generateEntityImage(ctx, place.id, 'place'),
    ]);

    // Check for child generation failures
    const childFailures = childResults.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (childFailures.length > 0) {
      const reasons = childFailures
        .map((r): unknown => r.reason)
        .map((e) => (e instanceof Error ? e.message : String(e)));
      throw new Error(
        `${childFailures.length} child place(s) failed to generate: ${reasons.join('; ')}`,
      );
    }

    // Note: Tag extraction is handled by the caller (arbiter-executor)
    // to ensure it completes before persistence.

    return place;
  } catch (error: unknown) {
    logger.error('Place Generator', 'Failed to generate place', {
      error: error instanceof Error ? error.message : String(error),
      universeId: ctx.universeId,
      parentId: parentId ?? '(root)',
    });
    throw error;
  }
}

// ============================================================================
// Temporary Place Generation (for mid-transit scenarios)
// ============================================================================
