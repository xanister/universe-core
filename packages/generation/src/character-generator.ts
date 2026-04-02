import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import {
  createCharacterPosition,
  getPlaceInnerDimensions,
} from '@dmnpc/core/entities/position-utils.js';
import { loadPlaceLayout } from '@dmnpc/core/universe/universe-store.js';
import { findNearestPassablePosition } from '@dmnpc/types/world';
import type {
  Character,
  CharacterInfo,
  CharacterRelationship,
  CharacterPreviewData,
  ContainedItem,
  JournalEntry,
} from '@dmnpc/types/entity';
import type { RelationshipType } from '@dmnpc/types';
import type { StartingSituation } from '@dmnpc/types/npc';
import type { WorldBible } from '@dmnpc/types/world';
import { getCharacterWeaponId, normalizeWeaponToBelt } from '@dmnpc/types/entity';
import {
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  BEARD_STYLES,
  SKIN_COLORS,
  CLOTHING_COLORS,
  CLOTHING_COLOR_HEX,
  getClothingCatalogForPrompt,
  getClothingItemKeys,
  getSlotOrder,
  getSpriteArchetype,
  resolveHeadType,
  loadSpriteArchetypes,
  loadCharacterBasesManifest,
  loadClothingData,
  loadSlotRegistry,
} from '@dmnpc/sprites';
import type { ClothingColor } from '@dmnpc/sprites';
import type { ClothingSlot } from '@dmnpc/types/entity';
import { LPC_SPRITES_DIR } from '@dmnpc/data';
import { generateEntityId } from './id-generator.js';
import { generateEntityImage, savePortraitFromBase64 } from './media/entity-image-service.js';
import { detectFacePosition } from '@dmnpc/core/clients/openai-client.js';
import {
  generateCharacterSprite,
  findRaceOrFallback,
  normalizeSkinToneForRace,
  normalizeEyeColorForRace,
  normalizeHairColorForRace,
  resolveAutoGenOverlayLayers,
} from './character/character-sprite-helper.js';
import { buildCharacterFromTemplate } from './character/template-character-builder.js';
import type { MergedCharacterDefinition } from './document/template-document-merger.js';
import { loadInteractionTypeIdForPurpose } from './purpose-loader.js';
import {
  WRITING_STYLE_RULES,
  CHARACTER_DESCRIPTION_EXAMPLE,
} from '@dmnpc/core/prompts/prompt-constants.js';
import { getAvailableVoices, formatVoicesForPrompt } from './character/voice-matcher.js';

/** Default voice registry ID for LLM-generated characters. */
const DEFAULT_GENERATED_VOICE_ID = 'sarah';

/** Default voice registry ID for creator-path / preview characters. */
const DEFAULT_CREATOR_VOICE_ID = 'adam';

/**
 * Truncate text to a maximum length, adding ellipsis if truncated.
 */
/**
 * Resolve the head type for a character based on their race's sprite archetype.
 * Falls back to human_male/human_female based on gender.
 */
/** Ensure archetypes are loaded (lazy, idempotent) */
let _archetypesLoaded = false;
function ensureArchetypesLoaded(): void {
  if (!_archetypesLoaded) {
    loadCharacterBasesManifest(LPC_SPRITES_DIR);
    loadSpriteArchetypes(LPC_SPRITES_DIR);
    loadClothingData();
    _archetypesLoaded = true;
  }
}

function resolveHeadTypeForCharacter(
  raceId: string | undefined,
  gender: string | undefined,
  ctx: UniverseContext,
): string {
  ensureArchetypesLoaded();
  const raceDef = findRaceOrFallback(ctx.universe.races, raceId ?? 'human');
  const archetypeId = raceDef.spriteHints?.spriteArchetype ?? 'human';
  const archetype = getSpriteArchetype(archetypeId);
  if (archetype) {
    return resolveHeadType(archetype, gender ?? 'male');
  }
  // Absolute fallback
  const isFemale = (gender ?? 'male').toLowerCase().includes('female');
  return isFemale ? 'human_female' : 'human_male';
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Voice selection guidance for LLM prompts.
 */
const VOICE_SELECTION_GUIDANCE = `
Voice Selection Rules:
- Gender match is CRITICAL - match the character's gender to voice gender labels
- Consider age appropriateness (young, middle-aged, old based on description)
- Match personality (energetic voices for lively characters, calm for stoic ones)
- Consider character archetype (noble, rough, mysterious, cheerful, etc.)

Voice Settings Guide:
- stability (0.0-1.0): Lower = more expressive/varied, Higher = more consistent. Use lower for emotional/dramatic characters, higher for calm/professional ones.
- similarityBoost (0.0-1.0): How closely to match the original voice. Usually keep at 0.7-0.8.
- style (0.0-1.0): Amplifies emotional elements. Use higher for theatrical/dramatic characters, lower for subtle/restrained ones.
- speed (0.7-1.2): Speaking rate. Faster for energetic/young, slower for elderly/thoughtful.`;

/**
 * Build WorldBible context for character generation prompts.
 * Includes lore, themes, and key conflicts to ensure character consistency.
 * Uses truncation to control prompt size while preserving ALL items for continuity.
 */
function buildWorldBibleContext(worldBible: WorldBible | null): string {
  if (!worldBible) {
    return '';
  }

  const parts: string[] = [];
  parts.push('\n## WORLD CONTEXT (use for accuracy and consistency)');

  // Key conflicts - ALL included, each truncated to 100 chars
  if (worldBible.keyConflicts.length > 0) {
    const conflicts = worldBible.keyConflicts.map((c) => truncate(c, 100)).join('; ');
    parts.push(`\n**Key Conflicts:** ${conflicts}`);
  }

  // Lore - truncated to 400 chars
  if (worldBible.lore) {
    parts.push(`\n**World Lore:** ${truncate(worldBible.lore, 400)}`);
  }

  // Themes - full list
  if (worldBible.themes.length > 0) {
    parts.push(`\n**Themes:** ${worldBible.themes.join(', ')}`);
  }

  // Tone - full text
  if (worldBible.tone) {
    parts.push(`\n**Tone:** ${worldBible.tone}`);
  }

  parts.push('\nCharacters should fit naturally into this world.');

  return parts.join('');
}

/**
 * Build the system prompt for character generation.
 * Shared between generateCharacter and generateCharacterPreview.
 */
function buildCharacterSystemPrompt(params: {
  shortDescRaceGuidance: string;
  existingShortDescContext: string;
  existingNamesContext: string;
  existingAppearanceContext: string;
  racesContext: string;
  voicesContext: string;
  worldBibleContext: string;
}): string {
  const {
    shortDescRaceGuidance,
    existingShortDescContext,
    existingNamesContext,
    existingAppearanceContext,
    racesContext,
    voicesContext,
    worldBibleContext,
  } = params;

  return `You are a character generator.

${WRITING_STYLE_RULES}
${CHARACTER_DESCRIPTION_EXAMPLE}
${worldBibleContext}
Rules: 
- CRITICAL: The race field MUST be one of the available race IDs listed below. Match the race mentioned in the character description.
- Create a specific named individual. Keep all fields concise.
- NAMING CONVENTIONS:
  - **label**: The character's PROPER NAME only - no titles, no nicknames
    - GOOD: "Marcus Vale", "Meiloria", "James Johnson"
    - BAD: "Captain Marcus Vale", "Queen Meiloria", "Jimmy Johnson"
  - **title**: Rank or honorific (e.g., "Queen", "Lord", "Captain", "Dr.") - leave empty if none
  - **aliases**: Array of alternative names - nicknames, epithets, informal names
    - Examples: ["Jimmy", "The Iron Queen", "Old Tom", "The Shadow"]
- Name uniqueness: The label MUST be a new name that does not match any existing character name. It must also avoid being "too similar" to existing names.
- PHYSICAL REALISM: Most people have COMMON physical traits. Use ordinary features as the default:
  - Eyes: brown, blue, green, gray, hazel (NO heterochromia, violet, gold, or unusual colors)
  - Hair: black, brown, blonde, red, gray/white for elderly (NO unusual colors)
  - Skin: appropriate to their ancestry and environment
- Create VARIETY through different COMBINATIONS of common traits, facial structure, build, age, and distinguishing marks (scars, wrinkles, calluses) - NOT through rare conditions.
- STRICTLY AVOID rare medical conditions (heterochromia, albinism, vitiligo, etc.) - these should appear in less than 1% of all characters.
- The description MUST be written in third person.
- The description MUST be 3-4 sentences maximum, focusing on the most distinctive physical features.
- The description MUST focus on IMMUTABLE physical features.
- CRITICAL: The description MUST NOT contain any names (not the character's name, nor any other character/place names). Refer to the character as "they" or use descriptive terms like "this individual".
- DO NOT include clothing or accessories in the description.
- When describing physical features in the description, use the EXACT color terms you selected for the structured fields (eyeColor, hairColor, skinTone). Do not paraphrase or use synonyms (e.g., do not write "hazel" if you selected "brown" for eyeColor, do not write "olive" if you selected "green" for skinTone, do not write "raven" if you selected "black" for hairColor).
- The short_description MUST be less than 30 characters total and MUST include gender. VISIBLE professions evident from clothing/equipment are PREFERRED (e.g., "uniformed guard", "aproned bartender", "robed clerk"). NEVER include: (1) HIDDEN professions requiring knowledge to identify (thief, spy, assassin, smuggler, con artist), (2) personality traits (procedural, methodical, cheerful, stern, keen), (3) meta-terms describing behavior rather than appearance. ${shortDescRaceGuidance}
- VOICE: Select an appropriate voice from the AVAILABLE VOICES list. Match gender and personality.
- CLOTHING: Compose clothing by selecting individual items per slot. Each item can have a named color (from the available colors list) or null for the item's default color.
${getClothingCatalogForPrompt()}${existingShortDescContext}${existingNamesContext}${existingAppearanceContext}${racesContext}${voicesContext}`;
}

/**
 * Resolve a named clothing color (from LLM output) to a hex string for storage.
 * Named colors are resolved via CLOTHING_COLOR_HEX. Null passes through as null.
 * Crashes on unknown values — the LLM schema constrains to CLOTHING_COLORS enum.
 */
function isClothingColor(val: string): val is ClothingColor {
  return (CLOTHING_COLORS as readonly string[]).includes(val);
}

function resolveClothingColorToHex(color: string | null): string | null {
  if (color === null) return null;
  if (!isClothingColor(color)) {
    throw new Error(`Unknown clothing color "${color}" — not in CLOTHING_COLORS enum`);
  }
  const hex = CLOTHING_COLOR_HEX[color];
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** Returns the set of slot IDs that have a container config in the slot registry. */
function getContainerSlotIds(): Set<string> {
  const registry = loadSlotRegistry();
  return new Set(registry.slots.filter((s) => s.container).map((s) => s.id));
}

/** Returns `[]` for container-capable slots, `null` for non-container slots. */
function initSlotContents(slotId: string, containerSlotIds: Set<string>): ContainedItem[] | null {
  return containerSlotIds.has(slotId) ? [] : null;
}

function normalizeNameForComparison(name: string): string {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const dp: number[] = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1, // deletion
        dp[j - 1] + 1, // insertion
        prev + cost, // substitution
      );
      prev = tmp;
    }
  }
  return dp[b.length];
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeNameForComparison(a);
  const nb = normalizeNameForComparison(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen;
}

function findMostSimilarExistingName(
  proposedName: string,
  existingNames: string[],
): { existingName: string; similarity: number } | null {
  const proposed = String(proposedName).trim();
  if (!proposed) return null;

  let best: { existingName: string; similarity: number } | null = null;
  for (const existingName of existingNames) {
    const similarity = nameSimilarity(proposed, existingName);
    if (!best || similarity > best.similarity) {
      best = { existingName, similarity };
    }
  }
  return best;
}

/**
 * Format existing character appearances as a concise summary for the LLM prompt.
 * Mirrors the existingShortDescriptions/existingNamesContext pattern.
 * Returns empty string if no characters have appearance data.
 */
export function formatExistingAppearances(characters: readonly Character[], limit: number): string {
  const summaries: string[] = [];
  for (const c of characters.slice(0, limit)) {
    const info = c.info;
    const parts: string[] = [];
    if (info.race) parts.push(info.race);
    if (info.gender) parts.push(info.gender.toLowerCase());
    if (info.hairColor && info.hairStyle) {
      parts.push(`${info.hairColor} hair (${info.hairStyle})`);
    } else if (info.hairColor) {
      parts.push(`${info.hairColor} hair`);
    }
    if (info.eyeColor) parts.push(`${info.eyeColor} eyes`);
    if (info.skinTone) parts.push(`${info.skinTone} skin`);
    if (parts.length > 0) {
      summaries.push(`- ${c.label}: ${parts.join(', ')}`);
    }
  }
  return summaries.length > 0
    ? `\n\nEXISTING CHARACTER APPEARANCES in this universe (vary hair style, hair color, eye color, skin tone, and physical features to create visual diversity — avoid duplicating these combinations):\n${summaries.join('\n')}`
    : '';
}

/** Parameters for generating a character or character preview */
export interface GenerateCharacterParams {
  /** Universe context for mutations */
  ctx: UniverseContext;
  /** Generated path: description of the character to generate */
  description?: string;
  /** Creator/generated path: place ID where the character will be located */
  placeId?: string;
  /** Force a specific name for the character (generated path) */
  name?: string;
  /** Starting situation from scenario - injects universe events, memories, and journal entries */
  startingSituation?: StartingSituation;
  /** Creator path: character data from preview/request */
  characterData?: CharacterPreviewData;
  /** Creator path: optional portrait image as base64 */
  portraitBase64?: string;
  /** Template path: template ID to build from */
  templateId?: string;
  /** Template path: optional universe-specific guidance */
  guidance?: string;
  /** Template path: optional merged definition from document context */
  mergedDef?: MergedCharacterDefinition;
  /**
   * Character purpose/role (e.g., 'bartender', 'guard', 'helmsman').
   * Used as the character's purpose and injected into the LLM prompt
   * so generation is role-aware. Required for slot-generated characters.
   */
  role?: string;
  /**
   * Slot position in tile coordinates for slot-spawned characters.
   * Converted to world pixels (32px/tile) for the character position.
   */
  slotPosition?: { x: number; y: number };
  /**
   * When true (default), non-slot characters spawn at the exit door.
   * When false, spawn at a random passable position inside the place.
   * Use false for "already here" scenarios (scenario start, background generation)
   * where the character shouldn't appear to have just walked in.
   */
  spawnAtDoor?: boolean;
  /**
   * Pre-computed stats from the universe's active ruleset.
   * For creator path: comes from the wizard's point-buy allocation.
   * For generated/template path: callers compute via ruleset.generateStats().
   */
  stats?: Record<string, number>;
  /**
   * Pre-computed weapon ID from the universe's active ruleset.
   * For creator path: comes from the wizard's equipment step.
   * For generated/template path: callers compute via assignDefaultWeapon().
   */
  weapon?: string | null;
}

export interface GenerateCharacterPreviewParams {
  /** Description of the character to preview */
  description: string;
  /** Place ID where the character will be located */
  placeId: string;
  /** Force a specific name for the character */
  name?: string;
}

// CharacterPreviewData is now imported from types/index.ts

/** Type guard for RelationshipType */
function isRelationshipType(val: string): val is RelationshipType {
  return (VALID_RELATIONSHIP_TYPES as readonly string[]).includes(val);
}

/** Valid relationship types for constraining LLM output */
const VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
  'stranger',
  'acquaintance',
  'colleague',
  'friend',
  'rival',
  'enemy',
  'family',
  'romantic',
  'mentor',
  'subordinate',
  'superior',
];

/** Default familiarity values for each relationship type */
const TYPE_FAMILIARITY: Record<RelationshipType, number> = {
  stranger: 0,
  acquaintance: 40,
  colleague: 50,
  friend: 60,
  rival: 50,
  enemy: 50,
  family: 80,
  romantic: 70,
  mentor: 60,
  subordinate: 50,
  superior: 50,
};

/** Default disposition values for each relationship type */
const TYPE_DISPOSITION: Record<RelationshipType, number> = {
  stranger: 0,
  acquaintance: 0,
  colleague: 10,
  friend: 40,
  rival: -20,
  enemy: -60,
  family: 30,
  romantic: 50,
  mentor: 20,
  subordinate: 0,
  superior: 0,
};

/**
 * Determines relationships for a new character based on existing characters in the universe.
 * Uses contextual clues like shared tags (organizations, roles), same location, same birthPlace, etc.
 * Only includes relationships that make logical sense - not everyone knows everyone.
 *
 * @param newCharacter - Partial character data for the new character
 * @param newCharacterPlaceId - The place ID where the new character is located
 * @param existingCharacters - Existing characters to consider for relationships
 */
async function determineRelationships(
  newCharacter: {
    label: string;
    description: string;
    tags: string[];
    info: CharacterInfo;
  },
  newCharacterPlaceId: string | null,
  existingCharacters: Character[],
): Promise<CharacterRelationship[]> {
  // Filter out characters that likely wouldn't know each other
  // Only consider characters with shared context: same location, shared tags, same birthPlace, etc.
  const candidateCharacters = existingCharacters.filter((char) => {
    // Same location is a strong indicator (use position.parent)
    if (newCharacterPlaceId && char.position.parent === newCharacterPlaceId) {
      return true;
    }

    // Shared tags (same organization, similar roles)
    const sharedTags = newCharacter.tags.filter((tag) => char.tags.includes(tag));
    if (sharedTags.length > 0) {
      return true;
    }

    // Same birthPlace could indicate childhood connections
    if (
      char.info.birthPlace &&
      newCharacter.info.birthPlace &&
      char.info.birthPlace === newCharacter.info.birthPlace
    ) {
      return true;
    }

    return false;
  });

  if (candidateCharacters.length === 0) {
    return [];
  }

  // Limit to top candidates if too many to prevent prompt/response truncation
  const MAX_CANDIDATES = 50;
  const limitedCandidates =
    candidateCharacters.length > MAX_CANDIDATES
      ? candidateCharacters.slice(0, MAX_CANDIDATES)
      : candidateCharacters;

  // Build context about existing characters
  const existingCharsContext = limitedCandidates.map((char) => ({
    id: char.id,
    name: char.label,
    tags: char.tags,
    location: char.position.parent, // Use position.parent
    birthPlace: char.info.birthPlace,
    role: char.tags.join(', '),
    personality: char.info.personality,
  }));

  const systemPrompt = `You are a relationship analyzer. Given a new character and existing characters, determine which relationships make logical sense.

VALID RELATIONSHIP TYPES (use ONLY these exact values):
- "acquaintance" - Know each other casually
- "colleague" - Work together professionally
- "friend" - Personal positive relationship
- "rival" - Competitive relationship
- "enemy" - Hostile relationship
- "family" - Blood or legal family
- "romantic" - Romantic involvement
- "mentor" - Teacher/guide
- "subordinate" - Works for someone
- "superior" - Has authority over someone

Only include relationships that are LOGICALLY LIKELY based on:
- Shared tags/roles (same organization, similar jobs)
- Same location (work together, live in same place)
- Same birthPlace (might have grown up together)
- Professional context (hierarchical relationships, working relationships)

Be CONSERVATIVE - don't assume everyone knows everyone. Only include relationships that make clear logical sense.
If no relationships make sense, return {"relationships": []}.`;

  const userPrompt = `New Character:
- Name: ${newCharacter.label}
- Description: ${newCharacter.description}
- Tags: ${newCharacter.tags.join(', ')}
- Location: ${newCharacterPlaceId ?? 'Unknown'}
- Birth Place: ${newCharacter.info.birthPlace}
- Personality: ${newCharacter.info.personality}

Existing Characters (candidates for relationships):
${existingCharsContext
  .map(
    (char) =>
      `- ${char.name} (${char.id}): Tags: ${char.tags.join(', ')}, Location: ${char.location}, Birth Place: ${char.birthPlace}, Personality: ${char.personality}`,
  )
  .join('\n')}
${candidateCharacters.length > MAX_CANDIDATES ? `\nNote: Showing top ${MAX_CANDIDATES} most relevant candidates out of ${candidateCharacters.length} total. Focus on relationships with these candidates.` : ''}

Determine which relationships make logical sense.`;

  interface LlmRelationship {
    targetId: string;
    type: string;
    context?: string;
  }

  try {
    const result = await queryLlm<{ relationships: LlmRelationship[] }>({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'reasoning',
      context: 'Relationship Determination',
      maxTokensOverride: 4096, // Structured output needs more tokens - increased to prevent truncation
      schema: {
        name: 'relationships_schema',
        schema: {
          type: 'object',
          properties: {
            relationships: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  targetId: {
                    type: 'string',
                    description: 'Character ID from the candidates list',
                  },
                  type: {
                    type: 'string',
                    enum: VALID_RELATIONSHIP_TYPES,
                    description: 'Type of relationship',
                  },
                  context: {
                    type: 'string',
                    description: 'Brief note about the relationship',
                  },
                },
                required: ['targetId', 'type', 'context'],
                additionalProperties: false,
              },
            },
          },
          required: ['relationships'],
          additionalProperties: false,
        },
      },
    });

    const llmRelationships = result.content.relationships;
    const validCharIds = new Set(limitedCandidates.map((c) => c.id));

    // Convert and validate
    const relationships: CharacterRelationship[] = [];
    for (const rel of llmRelationships) {
      // Validate target exists
      if (!validCharIds.has(rel.targetId)) continue;

      // Validate type is valid
      const type: RelationshipType = isRelationshipType(rel.type) ? rel.type : 'acquaintance';

      relationships.push({
        targetId: rel.targetId,
        type,
        disposition: TYPE_DISPOSITION[type],
        familiarity: TYPE_FAMILIARITY[type],
        context: rel.context ?? null,
        pendingGeneration: false,
      });
    }

    return relationships;
  } catch (error: unknown) {
    logger.error(
      'Relationship Determination',
      `Failed to determine relationships for ${newCharacter.label}, returning empty: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * Builds a character entity from Creator preview data (no media generation).
 * Used when generateCharacter is called with characterData.
 */
function buildCharacterFromCreatorData(
  ctx: UniverseContext,
  characterData: CharacterPreviewData,
  placeId: string,
  startingSituation?: StartingSituation,
): Character {
  const place = ctx.findPlace(placeId);
  if (!place) {
    throw new Error(`Place with id ${placeId} not found`);
  }

  const characterId = generateEntityId(ctx, characterData.label, 'character');

  const initialJournal: JournalEntry[] = [];
  if (startingSituation?.initialKnowledge && startingSituation.initialKnowledge.length > 0) {
    initialJournal.push({
      content: startingSituation.narrative || 'The beginning of my journey.',
      gameDate: ctx.universe.date,
      facts: startingSituation.initialKnowledge,
      image: null,
      context: null,
    });
  }

  const gender = characterData.info?.gender || 'Unknown';
  const creatorRaceId = characterData.info?.race || 'Unknown';
  const creatorRaceDef = findRaceOrFallback(ctx.universe.races, creatorRaceId);
  const characterInfo: CharacterInfo = {
    purpose: 'player',
    aliases: characterData.info?.aliases || [],
    birthdate: characterData.info?.birthdate || 'Unknown',
    deathdate: null,
    title: null,
    birthPlace: characterData.info?.birthPlace || '',
    eyeColor: characterData.info?.eyeColor || 'Unknown',
    gender,
    hairColor: characterData.info?.hairColor || 'Unknown',
    hairStyle: characterData.info?.hairStyle || 'Unknown',
    beardStyle: characterData.info?.beardStyle ?? null,
    headType:
      characterData.info?.headType ||
      resolveHeadTypeForCharacter(characterData.info?.race, gender, ctx),
    skinTone: normalizeSkinToneForRace(characterData.info?.skinTone, creatorRaceDef),
    personality: characterData.info?.personality || 'Unknown',
    race: creatorRaceId,
    messages: [],
    journal: initialJournal,
    sketches: [],
    verbosity: 3,
    conversationContext: null,
    storytellerState: null,
    isPlayer: false,
    storyComplete: false,
    routine: null,
    vesselRoutes: null,
    abstractLocation: null,
    npcBehavior: null,
    physicalState: null,
    pendingDeparture: null,
    pendingArrival: null,
    lastRoutineCheckPeriod: null,
    startingNarrative: null,
    startingCharacterState: null,
    // ?? [] guard: LLM structured output may omit clothing on partial responses
    clothing: characterData.info?.clothing ?? [],
    enabledOverlayLayers: characterData.info?.enabledOverlayLayers ?? [],
    helmingVesselId: null,
    storytellerDisabled: false,
    rulesetState: {
      stats: characterData.info?.stats ?? {},
      conditions: [],
      statUsage: {},
      incapacitation: null,
      incapacitatedSince: null,
    },
    voiceId: characterData.info?.voiceId || DEFAULT_CREATOR_VOICE_ID,
    spriteConfig: {
      bodyType: gender.toLowerCase().includes('female') ? 'female' : 'male',
      layers: [],
      spriteHash: null,
      spriteUrl: null,
      spriteScale: 1,
    },
  };

  return {
    id: characterId,
    label: characterData.label,
    description: characterData.description,
    short_description: characterData.short_description,
    tags: [],
    entityType: 'character',
    info: characterInfo,
    position: (() => {
      const { width, height } = getPlaceInnerDimensions(place);
      return {
        x: width / 2,
        y: height / 2,
        width: 32,
        height: 48,
        parent: placeId,
      };
    })(),
    destinationPlaceId: null,
    travelPath: null,
    travelSegmentIndex: null,
    image: null,
    faceAnchorY: null,
    omitFromPlot: false,
    aliases: null,
    displayName: null,
    interaction: { typeId: 'talk' },
    relationships: [],
    important: false,
  };
}

/**
 * Ensures character has portrait and in-world sprite. Updates ctx. No-op if already set.
 * Portrait and sprite generation run concurrently when both are needed — they write
 * to different fields (.image/.faceAnchorY vs .info.spriteConfig) on the same object.
 */
async function ensureCharacterMedia(ctx: UniverseContext, character: Character): Promise<void> {
  const needsPortrait = !character.image;
  const needsSprite = !character.info.spriteConfig.spriteUrl;

  if (needsPortrait && needsSprite) {
    const raceDef = findRaceOrFallback(ctx.universe.races, character.info.race);
    await Promise.all([
      generateEntityImage(ctx, character.id, 'character'),
      generateCharacterSprite(character.info, raceDef).then((spriteConfig) => {
        character.info.spriteConfig = spriteConfig;
        ctx.upsertEntity('character', character);
      }),
    ]);
  } else if (needsPortrait) {
    await generateEntityImage(ctx, character.id, 'character');
  } else if (needsSprite) {
    const raceDef = findRaceOrFallback(ctx.universe.races, character.info.race);
    const spriteConfig = await generateCharacterSprite(character.info, raceDef);
    character.info.spriteConfig = spriteConfig;
    ctx.upsertEntity('character', character);
  }
}

/**
 * Generates a character using OpenAI based on a description and updates the provided context.
 * Supports three flows: Creator (characterData), Template (templateId), or Generated (description + placeId).
 * All paths run a common tail that ensures portrait and in-world sprite when missing.
 *
 * If a startingSituation is provided (from a scenario), it will be applied to the character:
 * - initialEvents are saved to universe and memories are created for the character
 * - initialKnowledge is added to the character's journal as an initial entry
 */
export async function generateCharacter({
  ctx,
  description,
  placeId,
  name,
  startingSituation,
  characterData,
  portraitBase64,
  templateId,
  guidance,
  mergedDef,
  role,
  slotPosition,
  spawnAtDoor = true,
  stats,
  weapon,
}: GenerateCharacterParams): Promise<Character> {
  const containerSlotIds = getContainerSlotIds();
  let character: Character;

  if (characterData) {
    // Creator path: require placeId
    if (!placeId) {
      throw new Error('placeId is required when characterData is provided');
    }
    logger.info('Character Generator', `Creating character from preview: ${characterData.label}`);
    character = buildCharacterFromCreatorData(ctx, characterData, placeId, startingSituation);
    if (portraitBase64) {
      character.image = await savePortraitFromBase64(ctx.universeId, character.id, portraitBase64);
      character.faceAnchorY = await detectFacePosition(portraitBase64, character.label);
    }
  } else if (templateId) {
    // Template path: build from template (no placeId required; character is dormant)
    logger.info('Character Generator', `Building character from template: ${templateId}`);
    character = await buildCharacterFromTemplate(ctx, { templateId, guidance, mergedDef });
  } else {
    // Generated path: require description and placeId
    if (!description || !placeId) {
      throw new Error('description and placeId are required for generated path');
    }
    logger.info('Character Generator', `Generating character: ${description}`);

    const universe = ctx.universe;

    // Verify the place exists
    const place = ctx.findPlace(placeId);
    if (!place) {
      throw new Error(`Place with id ${placeId} not found`);
    }

    // Build minimal context about the universe and place
    const universeContext = universe.name ? `Universe: ${universe.name}` : '';
    const placeContext = `Location: ${place.label}`;

    // If a specific name is provided, include it in the prompt
    const nameConstraint = name
      ? `\n\nIMPORTANT: The character MUST be named "${name}" exactly.`
      : '';

    // Collect existing characters' short descriptions to avoid duplicates
    const existingCharacters = ctx.characters;
    const existingShortDescriptions = existingCharacters
      .map((c) => c.short_description)
      .filter((desc): desc is string => Boolean(desc))
      .slice(0, 20);

    const existingCharacterNames = existingCharacters
      .map((c) => c.label)
      .filter((n): n is string => Boolean(n && n.trim()))
      .slice(0, 50);

    const existingShortDescContext =
      existingShortDescriptions.length > 0
        ? `\n\nIMPORTANT: The following short descriptions are already in use. Your short_description MUST be DIFFERENT and UNIQUE from all of these:\n${existingShortDescriptions.map((desc) => `- "${desc}"`).join('\n')}\n\nAvoid repeating common patterns like "scarred", "gray-eyed", or similar generic combinations. Be creative and use distinctive, varied features.`
        : '';

    const existingNamesContext =
      existingCharacterNames.length > 0
        ? `\n\nExisting character names in this universe (for inspiration; DO NOT reuse; avoid creating names that are visually/phonetically very similar to these):\n${existingCharacterNames
            .map((n) => `- ${n}`)
            .join(
              '\n',
            )}\n\nExamples of too-similar names to AVOID: "Voss" vs "Vossk", "Ralen" vs "Ralin", "Merrick" vs "Merik", or adding/removing a single letter.`
        : '';

    // Collect existing character appearances to guide visual diversity
    const existingAppearanceContext = formatExistingAppearances(existingCharacters, 20);

    // Build race context from universe-defined races
    const availableRaces = universe.races;
    const raceIds = availableRaces.map((r) => r.id);
    const commonRaces = availableRaces.filter((r) => r.rarity === 'common').map((r) => r.label);
    const nonCommonRaces = availableRaces.filter((r) => r.rarity !== 'common').map((r) => r.label);
    const racesContext =
      availableRaces.length > 0
        ? `\n\nAVAILABLE RACES (you MUST use one of these race IDs exactly):\n${availableRaces
            .map((r) => {
              const lines = [`- "${r.id}" (${r.label}, ${r.rarity}): ${r.description}`];
              const hints = r.spriteHints;
              if (hints?.humanoidBody) {
                lines.push(
                  `  Skin tones: ${hints.allowedSkinColors.join(', ')} (default: ${hints.defaultSkinColor})`,
                );
                if (hints.allowedEyeColors && hints.allowedEyeColors.length > 0) {
                  lines.push(`  Eye colors: ${hints.allowedEyeColors.join(', ')}`);
                }
                if (hints.allowedHairColors && hints.allowedHairColors.length > 0) {
                  lines.push(`  Hair colors: ${hints.allowedHairColors.join(', ')}`);
                }
              }
              return lines.join('\n');
            })
            .join(
              '\n',
            )}\n\nWhen generating a character, you MUST choose skinTone, eyeColor, and hairColor from the values allowed for the selected race. If the race lists specific allowed colors, pick from that list only.`
        : '';

    // Build short_description race guidance
    const shortDescRaceGuidance =
      nonCommonRaces.length > 0
        ? `Include race in short_description ONLY for non-common races (${nonCommonRaces.join(', ')}). For common races (${commonRaces.join(', ') || 'none'}), omit the race. Non-common race examples: "elderly male ${nonCommonRaces[0] ?? 'outsider'}". Common race examples: "grizzled old man", "cheerful young woman" (race omitted).`
        : `Include gender but omit race from short_description since all races are common.`;

    // Fetch available voices for voice selection
    let availableVoiceIds: string[] = [];
    let voicesContext = '';
    try {
      const availableVoices = getAvailableVoices();
      availableVoiceIds = availableVoices.map((v) => v.id);
      const voicesPrompt = formatVoicesForPrompt(availableVoices);
      voicesContext = `
${VOICE_SELECTION_GUIDANCE}

AVAILABLE VOICES (you MUST select one of these voice IDs):
${voicesPrompt}`;
    } catch (error) {
      logger.error('Character Generator', `Failed to fetch voices, will use default`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Build WorldBible context for world consistency
    const worldBibleContext = buildWorldBibleContext(ctx.worldBible);

    const systemPrompt = buildCharacterSystemPrompt({
      shortDescRaceGuidance,
      existingShortDescContext,
      existingNamesContext,
      existingAppearanceContext,
      racesContext,
      voicesContext,
      worldBibleContext,
    });

    const descriptionHonoringInstruction = `\n\nIMPORTANT: The character description above is the player's creative vision. You MUST honor all details they specified. The player's description OVERRIDES default generation rules when they conflict:
- NAME: If a name is mentioned, use it exactly as the character's label — even if it is similar to an existing character name. The player's chosen name takes precedence over the name uniqueness rule. If the name includes a title or honorific (e.g. "Captain Marcus", "Dr. Elena"), split it: the title field gets the honorific, the label gets the proper name only.
- CLOTHING: If clothing details are described, compose clothing from individual catalog items that matches. Pick appropriate items per slot with colors that fit the description.
- PHYSICAL TRAITS: If physical traits are described (hair color, build, scars, eye color, etc.), reflect them accurately. If the player describes unusual features (e.g. heterochromia, unusual eye color), honor their creative vision — pick the closest match from available color options rather than defaulting to common traits.
- PERSONALITY/BACKGROUND: If a personality or background is described, incorporate it into the character's personality and backstory.
Only fill in details the player did NOT specify. Never contradict what they wrote.`;

    // Build role context if generating a slot-spawned character
    const roleContext = role
      ? `\n\nROLE: This character is a ${role.replace(/_/g, ' ')} at this location. They should look and behave accordingly. Their appearance, personality, and short_description should clearly reflect this role.`
      : '';

    const userPrompt = `${universeContext ? `${universeContext}\n` : ''}${placeContext}${roleContext}\n\nCharacter description: ${description}${nameConstraint}${descriptionHonoringInstruction}\n\nGenerate the character.`;

    // Build voice schema — LLM just picks a registry ID
    const voiceSchema =
      availableVoiceIds.length > 0
        ? { type: 'string', enum: availableVoiceIds }
        : { type: 'string' };

    // Define schema with dynamic race enum and voice selection
    const characterSchema = {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Proper name only - no titles, no nicknames',
        },
        description: { type: 'string' },
        short_description: { type: 'string' },
        info: {
          type: 'object',
          properties: {
            race: raceIds.length > 0 ? { type: 'string', enum: raceIds } : { type: 'string' },
            birthdate: { type: 'string' },
            birthPlace: { type: 'string' },
            gender: { type: 'string' },
            eyeColor: {
              type: 'string',
              enum: [...EYE_COLORS],
              description: 'Character eye color',
            },
            hairColor: {
              type: 'string',
              enum: [...HAIR_COLORS],
              description: 'Character hair color (tint applied to hairstyle)',
            },
            hairStyle: {
              type: 'string',
              enum: [...HAIR_STYLES],
              description:
                'Character hairstyle shape (independent of color). Choose a visually appropriate style for the character.',
            },
            beardStyle: {
              type: ['string', 'null'],
              enum: [...BEARD_STYLES, null],
              description: 'Facial hair shape, or null for clean-shaven.',
            },
            skinTone: {
              type: 'string',
              enum: [...SKIN_COLORS],
              description:
                'Character skin/fur color from the v3 palette (amber, bronze, light, olive, taupe, green, fur_brown, etc.)',
            },
            personality: { type: 'string' },
            title: {
              type: 'string',
              description:
                'Rank or honorific (e.g., "Queen", "Lord", "Captain") - empty string if none',
            },
            aliases: {
              type: 'array',
              items: { type: 'string' },
              description: 'Nicknames, epithets, informal names',
            },
            voiceId: voiceSchema,
            clothing: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slot: {
                    type: 'string',
                    enum: getSlotOrder(),
                    description: 'Clothing slot ID',
                  },
                  item: {
                    type: 'string',
                    enum: getClothingItemKeys(),
                    description: 'Clothing item key from the catalog',
                  },
                  color: {
                    type: ['string', 'null'],
                    enum: [...CLOTHING_COLORS, null],
                    description:
                      'Named color (e.g., "brown", "navy", "crimson") or null for item default',
                  },
                },
                required: ['slot', 'item', 'color'],
                additionalProperties: false,
              },
              description: 'Clothing items per slot with named colors',
            },
          },
          required: [
            'race',
            'birthdate',
            'birthPlace',
            'gender',
            'eyeColor',
            'hairColor',
            'hairStyle',
            'beardStyle',
            'skinTone',
            'personality',
            'title',
            'aliases',
            'voiceId',
            'clothing',
          ],
          additionalProperties: false,
        },
      },
      required: ['label', 'description', 'short_description', 'info'],
      additionalProperties: false,
    };

    interface GeneratedClothingSlot {
      slot: string;
      item: string;
      color: string | null;
    }

    interface GeneratedCharacter {
      label: string;
      description: string;
      short_description: string;
      info: {
        race: string;
        birthdate: string;
        birthPlace: string;
        gender: string;
        eyeColor: string;
        hairColor: string;
        hairStyle: string;
        beardStyle?: string;
        skinTone: string;
        personality: string;
        title: string;
        aliases: string[];
        voiceId: string;
        clothing: GeneratedClothingSlot[];
      };
    }

    try {
      const result = await queryLlm<GeneratedCharacter>({
        system: systemPrompt,
        prompt: userPrompt,
        complexity: 'reasoning',
        context: 'Character Generator',
        maxTokensOverride: 4096,
        schema: {
          name: 'character_schema',
          schema: characterSchema,
        },
      });

      const parsed = result.content;

      if (!parsed.label || !parsed.description || !parsed.short_description) {
        throw new Error('Generated character missing required fields');
      }

      const mostSimilar = findMostSimilarExistingName(parsed.label, existingCharacterNames);
      if (mostSimilar && mostSimilar.similarity >= 0.82) {
        logger.warn(
          'Character Generator',
          `Generated name is very similar to existing: "${parsed.label}" vs "${mostSimilar.existingName}" (similarity: ${mostSimilar.similarity.toFixed(2)})`,
        );
      }

      if (parsed.short_description.length > 30) {
        parsed.short_description = parsed.short_description.substring(0, 30).trim();
      }

      // Save initial events from starting situation (character can query these via witnessIds)
      const initialEvents = startingSituation?.initialEvents || [];
      for (const event of initialEvents) {
        ctx.upsertEvent(event);
      }

      // Build initial journal entry from starting situation if provided
      const initialJournal: JournalEntry[] = [];
      if (startingSituation?.initialKnowledge && startingSituation.initialKnowledge.length > 0) {
        initialJournal.push({
          content: startingSituation.narrative || 'The beginning of my journey.',
          gameDate: universe.date,
          facts: startingSituation.initialKnowledge,
          image: null,
          context: null,
        });
      }

      // Validate voice ID against registry, fallback to default
      let voiceId = parsed.info.voiceId || DEFAULT_GENERATED_VOICE_ID;
      if (availableVoiceIds.length > 0 && !availableVoiceIds.includes(voiceId)) {
        logger.warn(
          'Character Generator',
          `Generated invalid voice ID "${voiceId}" for ${parsed.label}, using default`,
        );
        voiceId = DEFAULT_GENERATED_VOICE_ID;
      }
      logger.info('Character Generator', `Selected voice for ${parsed.label}: ${voiceId}`);

      const npcRaceDef = findRaceOrFallback(ctx.universe.races, parsed.info.race || 'Unknown');
      const normalizedSkinTone = normalizeSkinToneForRace(parsed.info.skinTone, npcRaceDef);
      const normalizedEyeColor = normalizeEyeColorForRace(parsed.info.eyeColor, npcRaceDef);
      const normalizedHairColor = normalizeHairColorForRace(parsed.info.hairColor, npcRaceDef);
      const characterInfo: CharacterInfo = {
        purpose: role ?? 'player',
        aliases: parsed.info.aliases,
        birthdate: parsed.info.birthdate || 'Unknown',
        deathdate: null,
        title: parsed.info.title || null,
        birthPlace: parsed.info.birthPlace || '',
        eyeColor: normalizedEyeColor,
        gender: parsed.info.gender || 'Unknown',
        hairColor: normalizedHairColor,
        hairStyle: parsed.info.hairStyle || 'Unknown',
        beardStyle: parsed.info.beardStyle ?? null,
        headType: resolveHeadTypeForCharacter(parsed.info.race, parsed.info.gender, ctx),
        skinTone: normalizedSkinTone,
        personality: parsed.info.personality || 'Unknown',
        race: parsed.info.race || 'Unknown',
        messages: [],
        journal: initialJournal,
        sketches: [],
        verbosity: 3, // Default verbosity for NPCs
        conversationContext: null,
        storytellerState: null,
        isPlayer: false,
        storyComplete: false,
        routine: null,
        vesselRoutes: null,
        abstractLocation: null,
        npcBehavior: null,
        physicalState: null,
        pendingDeparture: null,
        pendingArrival: null,
        lastRoutineCheckPeriod: null,
        startingNarrative: null,
        startingCharacterState: null,
        clothing: parsed.info.clothing.map(
          (o: GeneratedClothingSlot): ClothingSlot => ({
            slot: o.slot,
            itemId: o.item,
            color: resolveClothingColorToHex(o.color),
            contents: initSlotContents(o.slot, containerSlotIds),
          }),
        ),
        enabledOverlayLayers: resolveAutoGenOverlayLayers(npcRaceDef),
        helmingVesselId: null,
        storytellerDisabled: false,
        rulesetState: {
          stats: {},
          conditions: [],
          statUsage: {},
          incapacitation: null,
          incapacitatedSince: null,
        },
        voiceId,
        spriteConfig: {
          // Placeholder - will be generated immediately after
          bodyType: parsed.info.gender.toLowerCase().includes('female') ? 'female' : 'male',
          layers: [],
          spriteHash: null,
          spriteUrl: null,
          spriteScale: 1,
        },
      };

      const characterId = generateEntityId(ctx, parsed.label, 'character');

      const existingChars = ctx.characters.filter((c) => c.id !== characterId);
      const relationships = await determineRelationships(
        {
          label: parsed.label,
          description: parsed.description,
          tags: [],
          info: characterInfo,
        },
        placeId,
        existingChars,
      );

      // Determine interaction type from role/purpose
      const interactionTypeId = (role ? loadInteractionTypeIdForPurpose(role) : null) ?? 'talk';

      // Position: slot → exact tile | spawnAtDoor → exit entrance | else → random interior
      const tileSize = 32;
      let charPosition;
      if (slotPosition) {
        charPosition = {
          x: slotPosition.x * tileSize + tileSize / 2,
          y: slotPosition.y * tileSize + tileSize / 2,
          width: 32,
          height: 48,
          parent: placeId,
        };
      } else {
        // BUG-252: spawnAtDoor controls whether the character appears at the exit
        // (mid-scene arrival) or at a random interior position (already here).
        if (spawnAtDoor) {
          const exit = ctx.getObjectsByPlace(placeId).find((o) => o.info.purpose === 'exit');
          charPosition = exit
            ? { x: exit.position.x, y: exit.position.y, width: 32, height: 48, parent: placeId }
            : createCharacterPosition(place);
        } else {
          charPosition = createCharacterPosition(place);
        }

        const layout = await loadPlaceLayout(ctx.universeId, placeId);
        if (layout?.terrainGrid) {
          const gridHeight = layout.terrainGrid.length;
          const gridWidth = layout.terrainGrid[0]?.length ?? 0;
          // Build occupied tile set so new NPCs don't stack on existing characters
          const occupiedTiles = new Set<string>();
          for (const char of ctx.characters) {
            if (char.id === characterId) continue;
            if (char.position.parent !== placeId) continue;
            occupiedTiles.add(
              `${Math.floor(char.position.x / tileSize)},${Math.floor(char.position.y / tileSize)}`,
            );
          }
          const snapped = findNearestPassablePosition(
            charPosition.x,
            charPosition.y,
            layout.terrainGrid,
            tileSize,
            gridWidth,
            gridHeight,
            occupiedTiles,
          );
          if (snapped.x !== charPosition.x || snapped.y !== charPosition.y) {
            charPosition.x = snapped.x;
            charPosition.y = snapped.y;
          }
        }
      }

      character = {
        id: characterId,
        label: parsed.label,
        description: parsed.description,
        short_description: parsed.short_description,
        tags: [], // Tags extracted async in separate step
        entityType: 'character',
        info: characterInfo,
        position: charPosition,
        destinationPlaceId: null,
        travelPath: null,
        travelSegmentIndex: null,
        image: null,
        faceAnchorY: null,
        omitFromPlot: false,
        aliases: null,
        displayName: null,
        interaction: { typeId: interactionTypeId },
        relationships,
        important: false,
      };
    } catch (error: unknown) {
      logger.error('Character Generator', 'Failed to generate character', {
        error: error instanceof Error ? error.message : String(error),
        universeId: ctx.universeId,
        placeId,
      });
      throw error;
    }
  }

  // Apply pre-computed stats from the universe's active ruleset (generated/template paths).
  // Creator path stats are already set from characterData.info.rulesetState.stats.
  if (stats && Object.keys(character.info.rulesetState.stats).length === 0) {
    character.info.rulesetState.stats = stats;
  }

  // Generated/template path: weapon param adds to clothing as weapon slot first
  if (weapon && !getCharacterWeaponId(character.info.clothing)) {
    character.info.clothing.push({
      slot: 'weapon',
      itemId: weapon,
      color: null,
      contents: initSlotContents('weapon', containerSlotIds),
    });
  }
  // Normalize: move any weapon slot to belt contents (sheathed by default)
  normalizeWeaponToBelt(character.info.clothing);

  ctx.upsertEntity('character', character);

  await ensureCharacterMedia(ctx, character);

  const updated =
    (typeof ctx.findCharacter === 'function' ? ctx.findCharacter(character.id) : undefined) ??
    character;
  logger.info('Character Generator', `Generated and saved character: ${updated.label}`);
  return updated;
}

/**
 * Generates a character preview without saving it.
 * Returns the character data for review/editing before final creation.
 */
export async function generateCharacterPreview(
  ctx: UniverseContext,
  { description, placeId, name }: GenerateCharacterPreviewParams,
): Promise<CharacterPreviewData> {
  logger.info('Character Generator', `Generating character preview: ${description}`);
  const containerSlotIds = getContainerSlotIds();
  const universe = ctx.universe;

  // Verify the place exists
  const place = ctx.findPlace(placeId);
  if (!place) {
    throw new Error(`Place with id ${placeId} not found`);
  }

  // Build minimal context about the universe and place
  const universeContext = universe.name ? `Universe: ${universe.name}` : '';
  const placeContext = `Location: ${place.label}`;

  // If a specific name is provided, include it in the prompt
  const nameConstraint = name
    ? `\n\nIMPORTANT: The character MUST be named "${name}" exactly.`
    : '';

  // Collect existing characters' short descriptions to avoid duplicates
  const existingCharacters = ctx.characters;
  const existingShortDescriptions = existingCharacters
    .map((c) => c.short_description)
    .filter((desc): desc is string => Boolean(desc))
    .slice(0, 20);

  const existingCharacterNames = existingCharacters
    .map((c) => c.label)
    .filter((n): n is string => Boolean(n && n.trim()))
    .slice(0, 50);

  const existingShortDescContext =
    existingShortDescriptions.length > 0
      ? `\n\nIMPORTANT: The following short descriptions are already in use. Your short_description MUST be DIFFERENT and UNIQUE from all of these:\n${existingShortDescriptions.map((desc) => `- "${desc}"`).join('\n')}\n\nAvoid repeating common patterns like "scarred", "gray-eyed", or similar generic combinations. Be creative and use distinctive, varied features.`
      : '';

  const existingNamesContext =
    existingCharacterNames.length > 0
      ? `\n\nExisting character names in this universe (for inspiration; DO NOT reuse; avoid creating names that are visually/phonetically very similar to these):\n${existingCharacterNames
          .map((n) => `- ${n}`)
          .join(
            '\n',
          )}\n\nExamples of too-similar names to AVOID: "Voss" vs "Vossk", "Ralen" vs "Ralin", "Merrick" vs "Merik", or adding/removing a single letter.`
      : '';

  // Collect existing character appearances to guide visual diversity
  const existingAppearanceContext = formatExistingAppearances(existingCharacters, 20);

  // Build race context from universe-defined races
  const availableRaces = universe.races;
  const raceIds = availableRaces.map((r) => r.id);
  const commonRaces = availableRaces.filter((r) => r.rarity === 'common').map((r) => r.label);
  const nonCommonRaces = availableRaces.filter((r) => r.rarity !== 'common').map((r) => r.label);
  const racesContext =
    availableRaces.length > 0
      ? `\n\nAVAILABLE RACES (you MUST use one of these race IDs exactly):\n${availableRaces
          .map((r) => {
            const lines = [`- "${r.id}" (${r.label}, ${r.rarity}): ${r.description}`];
            const hints = r.spriteHints;
            if (hints?.humanoidBody) {
              lines.push(
                `  Skin tones: ${hints.allowedSkinColors.join(', ')} (default: ${hints.defaultSkinColor})`,
              );
              if (hints.allowedEyeColors && hints.allowedEyeColors.length > 0) {
                lines.push(`  Eye colors: ${hints.allowedEyeColors.join(', ')}`);
              }
              if (hints.allowedHairColors && hints.allowedHairColors.length > 0) {
                lines.push(`  Hair colors: ${hints.allowedHairColors.join(', ')}`);
              }
            }
            return lines.join('\n');
          })
          .join(
            '\n',
          )}\n\nWhen generating a character, you MUST choose skinTone, eyeColor, and hairColor from the values allowed for the selected race. If the race lists specific allowed colors, pick from that list only.`
      : '';

  // Build short_description race guidance
  const shortDescRaceGuidance =
    nonCommonRaces.length > 0
      ? `Include race in short_description ONLY for non-common races (${nonCommonRaces.join(', ')}). For common races (${commonRaces.join(', ') || 'none'}), omit the race. Non-common race examples: "elderly male ${nonCommonRaces[0] ?? 'outsider'}". Common race examples: "grizzled old man", "cheerful young woman" (race omitted).`
      : `Include gender but omit race from short_description since all races are common.`;

  // Fetch available voices for voice selection
  let availableVoiceIds: string[] = [];
  let voicesContext = '';
  try {
    const availableVoices = getAvailableVoices();
    availableVoiceIds = availableVoices.map((v) => v.id);
    const voicesPrompt = formatVoicesForPrompt(availableVoices);
    voicesContext = `
${VOICE_SELECTION_GUIDANCE}

AVAILABLE VOICES (you MUST select one of these voice IDs):
${voicesPrompt}`;
  } catch (error) {
    logger.error('Character Generator', `Failed to fetch voices for preview, will use default`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Build WorldBible context for world consistency
  const worldBibleContext = buildWorldBibleContext(ctx.worldBible);

  const systemPrompt = buildCharacterSystemPrompt({
    shortDescRaceGuidance,
    existingShortDescContext,
    existingNamesContext,
    existingAppearanceContext,
    racesContext,
    voicesContext,
    worldBibleContext,
  });

  const descriptionHonoringInstruction = `\n\nIMPORTANT: The character description above is the player's creative vision. You MUST honor all details they specified. The player's description OVERRIDES default generation rules when they conflict:
- NAME: If a name is mentioned, use it exactly as the character's label — even if it is similar to an existing character name. The player's chosen name takes precedence over the name uniqueness rule. If the name includes a title or honorific (e.g. "Captain Marcus", "Dr. Elena"), split it: the title field gets the honorific, the label gets the proper name only.
- CLOTHING: If clothing details are described, compose clothing from individual catalog items that matches. Pick appropriate items per slot with colors that fit the description.
- PHYSICAL TRAITS: If physical traits are described (hair color, build, scars, eye color, etc.), reflect them accurately. If the player describes unusual features (e.g. heterochromia, unusual eye color), honor their creative vision — pick the closest match from available color options rather than defaulting to common traits.
- PERSONALITY/BACKGROUND: If a personality or background is described, incorporate it into the character's personality and backstory.
Only fill in details the player did NOT specify. Never contradict what they wrote.`;

  const userPrompt = `${universeContext ? `${universeContext}\n` : ''}${placeContext}\n\nCharacter description: ${description}${nameConstraint}${descriptionHonoringInstruction}\n\nGenerate the character.`;

  // Build voice schema — LLM just picks a registry ID
  const voiceSchema =
    availableVoiceIds.length > 0 ? { type: 'string', enum: availableVoiceIds } : { type: 'string' };

  // Define schema with dynamic race enum and voice selection
  const characterSchema = {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'Proper name only - no titles, no nicknames',
      },
      description: { type: 'string' },
      short_description: { type: 'string' },
      info: {
        type: 'object',
        properties: {
          race: raceIds.length > 0 ? { type: 'string', enum: raceIds } : { type: 'string' },
          birthdate: { type: 'string' },
          birthPlace: { type: 'string' },
          gender: { type: 'string' },
          eyeColor: {
            type: 'string',
            enum: [...EYE_COLORS],
            description: 'Character eye color',
          },
          hairColor: {
            type: 'string',
            enum: [...HAIR_COLORS],
            description: 'Character hair color (tint applied to hairstyle)',
          },
          hairStyle: {
            type: 'string',
            enum: [...HAIR_STYLES],
            description:
              'Character hairstyle shape (independent of color). Choose a visually appropriate style for the character.',
          },
          beardStyle: {
            type: ['string', 'null'],
            enum: [...BEARD_STYLES, null],
            description: 'Facial hair shape, or null for clean-shaven.',
          },
          skinTone: {
            type: 'string',
            enum: [...SKIN_COLORS],
            description:
              'Character skin/fur color from the v3 palette (amber, bronze, light, olive, taupe, green, fur_brown, etc.)',
          },
          personality: { type: 'string' },
          title: {
            type: 'string',
            description:
              'Rank or honorific (e.g., "Queen", "Lord", "Captain") - empty string if none',
          },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description: 'Nicknames, epithets, informal names',
          },
          voiceId: voiceSchema,
          clothing: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slot: {
                  type: 'string',
                  enum: getSlotOrder(),
                  description: 'Clothing slot ID',
                },
                item: {
                  type: 'string',
                  enum: getClothingItemKeys(),
                  description: 'Clothing item key from the catalog',
                },
                color: {
                  type: ['string', 'null'],
                  enum: [...CLOTHING_COLORS, null],
                  description:
                    'Named color (e.g., "brown", "navy", "crimson") or null for item default',
                },
              },
              required: ['slot', 'item', 'color'],
              additionalProperties: false,
            },
            description: 'Clothing items per slot with named colors',
          },
        },
        required: [
          'race',
          'birthdate',
          'birthPlace',
          'gender',
          'eyeColor',
          'hairColor',
          'hairStyle',
          'beardStyle',
          'skinTone',
          'personality',
          'title',
          'aliases',
          'voiceId',
          'clothing',
        ],
        additionalProperties: false,
      },
    },
    required: ['label', 'description', 'short_description', 'info'],
    additionalProperties: false,
  };

  interface GeneratedPreviewClothingSlot {
    slot: string;
    item: string;
    color: string | null;
  }

  interface GeneratedPreviewData {
    label: string;
    description: string;
    short_description: string;
    info: {
      race: string;
      birthdate: string;
      birthPlace: string;
      gender: string;
      eyeColor: string;
      hairColor: string;
      hairStyle: string;
      beardStyle?: string;
      skinTone: string;
      personality: string;
      title: string;
      aliases: string[];
      voiceId: string;
      clothing: GeneratedPreviewClothingSlot[];
    };
  }

  try {
    const result = await queryLlm<GeneratedPreviewData>({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'reasoning',
      context: 'Character Generator Preview',
      maxTokensOverride: 4096,
      schema: {
        name: 'character_schema',
        schema: characterSchema,
      },
    });

    const parsed = result.content;

    if (parsed.short_description.length > 30) {
      parsed.short_description = parsed.short_description.substring(0, 30).trim();
    }

    // Validate voice ID against registry, fallback to default
    let previewVoiceId = parsed.info.voiceId || DEFAULT_CREATOR_VOICE_ID;
    if (availableVoiceIds.length > 0 && !availableVoiceIds.includes(previewVoiceId)) {
      previewVoiceId = DEFAULT_CREATOR_VOICE_ID;
    }

    const previewRaceDef = findRaceOrFallback(ctx.universe.races, parsed.info.race || 'Unknown');
    const normalizedPreviewSkinTone = normalizeSkinToneForRace(
      parsed.info.skinTone,
      previewRaceDef,
    );
    const normalizedPreviewEyeColor = normalizeEyeColorForRace(
      parsed.info.eyeColor,
      previewRaceDef,
    );
    const normalizedPreviewHairColor = normalizeHairColorForRace(
      parsed.info.hairColor,
      previewRaceDef,
    );
    const previewData: CharacterPreviewData = {
      label: parsed.label,
      description: parsed.description,
      short_description: parsed.short_description,
      info: {
        race: parsed.info.race || 'Unknown',
        birthdate: parsed.info.birthdate || 'Unknown',
        birthPlace: parsed.info.birthPlace || '',
        gender: parsed.info.gender || 'Unknown',
        eyeColor: normalizedPreviewEyeColor,
        hairColor: normalizedPreviewHairColor,
        hairStyle: parsed.info.hairStyle || 'Unknown',
        beardStyle: parsed.info.beardStyle ?? null,
        headType: resolveHeadTypeForCharacter(parsed.info.race, parsed.info.gender, ctx),
        skinTone: normalizedPreviewSkinTone,
        personality: parsed.info.personality || 'Unknown',
        title: parsed.info.title || undefined,
        aliases: parsed.info.aliases,
        voiceId: previewVoiceId,
        clothing: parsed.info.clothing.map(
          (o: GeneratedPreviewClothingSlot): ClothingSlot => ({
            slot: o.slot,
            itemId: o.item,
            color: resolveClothingColorToHex(o.color),
            contents: initSlotContents(o.slot, containerSlotIds),
          }),
        ),
        enabledOverlayLayers: resolveAutoGenOverlayLayers(previewRaceDef),
      },
    };

    logger.info('Character Generator', `Generated character preview: ${previewData.label}`);
    return previewData;
  } catch (error: unknown) {
    logger.error('Character Generator', 'Failed to generate character preview', {
      error: error instanceof Error ? error.message : String(error),
      universeId: ctx.universeId,
      placeId,
    });
    throw error;
  }
}
