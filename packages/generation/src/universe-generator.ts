/**
 * Universe Generator
 *
 * AI generation service for universe definitions and images.
 */

import { queryLlm, generateImage } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { canonicalUniverseIdFromName } from '@dmnpc/core/entities/id-utils.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { Universe, RaceDefinition, NonEmptyArray } from '@dmnpc/types/entity';
import type { CalendarConfig, WorldBible, LayoutTemplate } from '@dmnpc/types/world';
import {
  SKIN_COLORS,
  EYE_COLORS,
  loadCharacterBasesManifest,
  loadSpriteArchetypes,
  loadClothingData,
  getSpriteArchetype,
} from '@dmnpc/sprites';
import { LPC_SPRITES_DIR } from '@dmnpc/data';

// ============================================================================
// Types
// ============================================================================

/**
 * Hints for universe generation.
 */
export interface UniverseGenerationHints {
  /** Theme or genre (e.g., "dark fantasy", "sci-fi", "steampunk") */
  genre?: string;
  /** Era or time period (e.g., "medieval", "futuristic", "victorian") */
  era?: string;
  /** Key elements to include (e.g., "magic is forbidden", "interstellar travel") */
  keyElements?: string[];
  /** Tone (e.g., "gritty", "whimsical", "epic") */
  tone?: string;
  /** Art style for images (e.g., "oil painting", "anime", "photorealistic") */
  artStyle?: string;
  /** Explicit cosmos layout template ID. If omitted, LLM infers from genre/era/tone. */
  cosmosTemplateId?: string;
}

interface UniverseGenerationResponse {
  id: string;
  name: string;
  description: string;
  rules: string;
  tone: string;
  style: string;
  date: string;
  races: RaceDefinition[];
  rootPlaceDescription: string;
  rootPlaceName: string;
}

let spriteArchetypesLoaded = false;
function ensureSpriteArchetypesLoaded(): void {
  if (!spriteArchetypesLoaded) {
    loadCharacterBasesManifest(LPC_SPRITES_DIR);
    loadSpriteArchetypes(LPC_SPRITES_DIR);
    loadClothingData();
    spriteArchetypesLoaded = true;
  }
}

function resolveArchetypeSkinColors(archetypeId: string): string[] {
  ensureSpriteArchetypesLoaded();
  const archetype = getSpriteArchetype(archetypeId);
  if (!archetype) {
    throw new Error(`Unknown sprite archetype "${archetypeId}" in generated race data`);
  }
  return [...archetype.allowedSkinColors];
}

function normalizeGeneratedRaceSpriteHints(race: RaceDefinition): RaceDefinition {
  const hints = race.spriteHints;
  if (!hints) {
    throw new Error(`Race "${race.id}" is missing spriteHints in generated universe data`);
  }

  if (!hints.humanoidBody) {
    return {
      ...race,
      spriteHints: {
        humanoidBody: false,
        spriteArchetype: null,
        defaultSkinColor: null,
        allowedSkinColors: null,
        allowedEyeColors: hints.allowedEyeColors ?? null,
        allowedHairColors: hints.allowedHairColors ?? null,
        spriteScale: hints.spriteScale,
        featureLayers: hints.featureLayers ?? null,
      },
    };
  }

  const archetypeId = hints.spriteArchetype;
  if (!archetypeId) {
    throw new Error(`Humanoid race "${race.id}" must define a spriteArchetype`);
  }
  const archetypeSkinColors = resolveArchetypeSkinColors(archetypeId);
  const configuredSkinColors = hints.allowedSkinColors.filter((color) =>
    archetypeSkinColors.includes(color),
  );
  const allowedSkinColors =
    configuredSkinColors.length > 0 ? configuredSkinColors : archetypeSkinColors;
  if (allowedSkinColors.length === 0) {
    throw new Error(`Humanoid race "${race.id}" resolved to an empty skin color palette`);
  }

  const fallbackSkinColor = allowedSkinColors[0];
  const defaultSkinColor =
    hints.defaultSkinColor && allowedSkinColors.includes(hints.defaultSkinColor)
      ? hints.defaultSkinColor
      : fallbackSkinColor;

  const normalizedAllowedSkinColors = [
    defaultSkinColor,
    ...allowedSkinColors.filter((color) => color !== defaultSkinColor),
  ] as NonEmptyArray<string>;

  return {
    ...race,
    spriteHints: {
      humanoidBody: true,
      spriteArchetype: archetypeId,
      defaultSkinColor,
      allowedSkinColors: normalizedAllowedSkinColors as [string, ...string[]],
      allowedEyeColors: hints.allowedEyeColors ?? null,
      allowedHairColors: hints.allowedHairColors ?? null,
      spriteScale: hints.spriteScale,
      featureLayers: hints.featureLayers ?? null,
    },
  };
}

// ============================================================================
// Calendar Generation Schema
// ============================================================================

interface CalendarGenerationResponse {
  name: string;
  calendarType: 'standard' | 'year-only' | 'millennium';
  months: Array<{ name: string; days: number }>;
  hoursPerDay: number;
  eras: Array<{
    id: number;
    name: string;
    shortName: string;
    backwards?: boolean;
    transitionEra?: number;
  }>;
  defaultEra: number;
  eraPosition: 'prefix' | 'suffix' | 'none';
  yearOnlyTemplate?: string;
  millenniumPrefix?: string;
}

const CALENDAR_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description:
        'Name of the calendar (e.g., "Shire Reckoning", "Imperial Calendar", "Galactic Standard")',
    },
    calendarType: {
      type: 'string',
      enum: ['standard', 'year-only', 'millennium'],
      description:
        'Type of calendar: "standard" (full day/month/year), "year-only" (just year and era), "millennium" (year within millennium notation like 999.M41)',
    },
    months: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Month name' },
          days: { type: 'number', description: 'Number of days in this month' },
        },
        required: ['name', 'days'],
        additionalProperties: false,
      },
      description:
        'Array of months. For year-only or millennium calendars, use a single month with all days in the year.',
    },
    hoursPerDay: {
      type: 'number',
      description: 'Hours per day in this world (typically 24, but can vary)',
    },
    eras: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Unique numeric ID for the era' },
          name: {
            type: 'string',
            description: 'Full name of the era (e.g., "Third Age", "Before Battle of Yavin")',
          },
          shortName: {
            type: 'string',
            description: 'Short abbreviation (e.g., "T.A.", "BBY", "M41")',
          },
          backwards: {
            type: 'boolean',
            description: 'If true, years count down (like BBY)',
          },
          transitionEra: {
            type: 'number',
            description: 'Era ID to transition to when year reaches 0 (for backwards eras)',
          },
        },
        required: ['id', 'name', 'shortName', 'backwards', 'transitionEra'],
        additionalProperties: false,
      },
      description: 'Array of eras/ages in the calendar',
    },
    defaultEra: {
      type: 'number',
      description: 'The era ID to use by default',
    },
    eraPosition: {
      type: 'string',
      enum: ['prefix', 'suffix', 'none'],
      description:
        'Where to display era in formatted date: "prefix" (T.A. 2940), "suffix" (2940 T.A.), "none"',
    },
    yearOnlyTemplate: {
      type: 'string',
      description: 'For year-only calendars: template like "${era} ${year}" or "${year} ${era}"',
    },
    millenniumPrefix: {
      type: 'string',
      description: 'For millennium calendars: prefix like "M" for "M41"',
    },
  },
  required: [
    'name',
    'calendarType',
    'months',
    'hoursPerDay',
    'eras',
    'defaultEra',
    'eraPosition',
    'yearOnlyTemplate',
    'millenniumPrefix',
  ],
  additionalProperties: false,
};

// ============================================================================
// Universe Generation Schema
// ============================================================================

const UNIVERSE_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description:
        'Unique lowercase ID with underscores (e.g., "shadow_realm", "starfall_station"). 3-20 characters.',
    },
    name: {
      type: 'string',
      description:
        'Display name for the universe (e.g., "The Shadow Realm", "Starfall Station"). NEVER use parenthetical qualifiers like "(Fallout)" or "(Modern Era)" - put such context in the description instead.',
    },
    description: {
      type: 'string',
      description:
        'Rich description of the universe setting (3-5 sentences). Describes the world, its history, and atmosphere.',
    },
    rules: {
      type: 'string',
      description:
        'Narrative rules and constraints for the world (e.g., "Magic is outlawed. Technology runs on steam. The sun never sets.").',
    },
    tone: {
      type: 'string',
      description:
        'Narrative tone for text generation (e.g., "gritty noir with dark humor", "epic high fantasy", "tense sci-fi thriller").',
    },
    style: {
      type: 'string',
      description:
        'Visual style for image generation (e.g., "dark fantasy oil painting", "cel-shaded anime", "photorealistic sci-fi").',
    },
    date: {
      type: 'string',
      description:
        'Starting date in the world (e.g., "15.03.1472", "Stardate 4523.7"). Use a format appropriate for the setting.',
    },
    races: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Unique lowercase ID matching the label pattern. Use simple, short IDs. For subtypes use underscore: "dark_elf", "fire_genasi". NEVER use geographic prefixes like "northern_" or "gaardian_".',
          },
          label: {
            type: 'string',
            description:
              'Display name using objective, clear naming. For distinct subtypes, place modifier BEFORE the race: "Dark Elf", "Fire Genasi". NEVER use: parenthetical qualifiers like "(Prime)" or "(Mutant)", geographic prefixes like "Northern" or "Gaardian", or phrases like "from the North".',
          },
          description: {
            type: 'string',
            description: 'Brief description of the race (1-2 sentences).',
          },
          rarity: {
            type: 'string',
            enum: ['common', 'uncommon', 'rare'],
            description: 'How common this race is in the world.',
          },
          spriteHints: {
            type: 'object',
            properties: {
              humanoidBody: {
                type: 'boolean',
                description:
                  'True if race has humanoid body shape (bipedal, human-like proportions). False for non-humanoid races like animals, constructs, or abstract entities.',
              },
              spriteArchetype: {
                type: ['string', 'null'],
                enum: [
                  'human',
                  'elf',
                  'orc',
                  'wolf',
                  'lizard',
                  'minotaur',
                  'boarman',
                  'skeleton',
                  'zombie',
                  null,
                ],
                description:
                  'Sprite archetype for this race. Determines head shape, skin color palette, and body options. Pick the most fitting archetype for the race. Set null if humanoidBody is false.',
              },
              defaultSkinColor: {
                type: ['string', 'null'],
                enum: [...SKIN_COLORS, null],
                description:
                  'Default skin/fur color for this race. For humanoidBody=true, this MUST be one of allowedSkinColors. Set null if humanoidBody is false.',
              },
              allowedSkinColors: {
                type: ['array', 'null'],
                items: { type: 'string', enum: [...SKIN_COLORS] },
                minItems: 1,
                description:
                  'Explicit skin/fur palette for this race. For humanoidBody=true, provide a non-empty array. Set null if humanoidBody is false.',
              },
              allowedEyeColors: {
                type: ['array', 'null'],
                items: { type: 'string', enum: [...EYE_COLORS] },
                description: 'Allowed eye colors for this race. Null means all are allowed.',
              },
            },
            required: [
              'humanoidBody',
              'spriteArchetype',
              'defaultSkinColor',
              'allowedSkinColors',
              'allowedEyeColors',
            ],
            description:
              'Sprite generation hints. Set humanoidBody=true for races that can use humanoid sprites. Pick a spriteArchetype that matches the race (human, elf, orc, wolf, lizard, minotaur, boarman, skeleton, zombie).',
            additionalProperties: false,
          },
        },
        required: ['id', 'label', 'description', 'rarity', 'spriteHints'],
        additionalProperties: false,
      },
      description: 'Available races in this universe (3-6 races recommended).',
    },
    rootPlaceName: {
      type: 'string',
      description:
        'Name for the starting location (e.g., "Ravenholm", "Sector 7", "The Crossroads").',
    },
    rootPlaceDescription: {
      type: 'string',
      description:
        'Description of the starting location where new characters begin (2-3 sentences).',
    },
  },
  required: [
    'id',
    'name',
    'description',
    'rules',
    'tone',
    'style',
    'date',
    'races',
    'rootPlaceName',
    'rootPlaceDescription',
  ],
  additionalProperties: false,
};

// ============================================================================
// Root Place Inference
// ============================================================================

export interface InferredRootPlace {
  purpose: string;
  label: string;
  description: string;
  templateId: string;
}

/**
 * Infer the root place for a universe from the world bible hierarchy.
 *
 * When a world bible is provided, the LLM analyzes the hierarchy to pick the
 * best root purpose (planet for single-planet fantasy, cosmos for multi-system
 * sci-fi, etc.) and assigns the correct label from the source material.
 *
 * When no world bible is provided, falls back to cosmos template selection.
 */
export async function inferRootPlace(
  worldBible: WorldBible | undefined,
  allTemplates: Array<{ id: string; template: LayoutTemplate }>,
  hints?: UniverseGenerationHints,
): Promise<InferredRootPlace> {
  if (!worldBible || worldBible.places.length === 0) {
    const cosmosTemplates = allTemplates.filter((t) => t.template.purposes.includes('cosmos'));
    const templateId = await inferCosmosTemplate(hints, cosmosTemplates);
    return {
      purpose: 'cosmos',
      label: 'Cosmos',
      description: 'The cosmos — the root of all existence.',
      templateId,
    };
  }

  const templateSummaries = allTemplates
    .map(
      (t) =>
        `- id="${t.id}", purposes=[${t.template.purposes.join(', ')}], name="${t.template.name}": ${t.template.description}`,
    )
    .join('\n');

  const hierarchyLines = worldBible.places
    .map((p) => `- "${p.name}" (purpose: ${p.purpose}, parent: "${p.parentName}")`)
    .join('\n');

  const result = await queryLlm<{
    purpose: string;
    label: string;
    description: string;
    templateId: string;
  }>({
    system: `You are analyzing a world bible's place hierarchy to determine the correct root place for a universe.

The root place is the top-level container for all other places. Choose wisely:
- For a single-planet fantasy setting (e.g., one world with kingdoms/regions), the root should be the PLANET (purpose "planet").
- For a multi-system sci-fi setting, the root should be the COSMOS (purpose "cosmos").
- For a city-focused setting, the root could be the city itself (purpose "residence").

The root place's label should come from the source material. For example, if the world bible describes a planet called "Anslem", the root label should be "Anslem" with purpose "planet".

CRITICAL:
- The root place MUST be the highest-level place that makes sense as a navigable container.
- Do NOT pick a place that is clearly a child of another place.
- "Cosmos" or "Root" as parentName means "this place is a direct child of whatever the root is".
- Places with parentName="Cosmos" or parentName="Root" are children of the root — the root itself is the place they all point to.

Available layout templates:
${templateSummaries}

Pick a templateId whose purposes array includes the root purpose you choose.`,
    prompt: `World Bible place hierarchy:
${hierarchyLines}

Themes: ${worldBible.themes.join(', ')}
Overview: ${worldBible.overview}

Determine the root place (purpose, label, description, templateId).`,
    complexity: 'simple',
    context: 'Root Place Inference',
    schema: {
      name: 'root_place_inference',
      schema: {
        type: 'object',
        properties: {
          purpose: {
            type: 'string',
            description:
              'The purpose/type of the root place (e.g., "planet", "cosmos", "residence")',
          },
          label: {
            type: 'string',
            description: 'The label for the root place from the source material',
          },
          description: {
            type: 'string',
            description: 'A 2-3 sentence description of the root place',
          },
          templateId: {
            type: 'string',
            enum: allTemplates.map((t) => t.id),
            description: 'The layout template ID to use for the root place',
          },
        },
        required: ['purpose', 'label', 'description', 'templateId'],
        additionalProperties: false,
      },
    },
  });

  const inferred = result.content;
  logger.info(
    'RootPlaceInference',
    `Inferred root: purpose=${inferred.purpose}, label="${inferred.label}", template=${inferred.templateId}`,
  );
  return inferred;
}

/**
 * Select the cosmos layout template for a new universe (no world bible).
 *
 * Resolution order:
 * 1. If `hints.cosmosTemplateId` is provided, validate and return it.
 * 2. If only one cosmos template exists, return it directly.
 * 3. Otherwise, ask the LLM to pick the best match from available templates.
 */
async function inferCosmosTemplate(
  hints: UniverseGenerationHints | undefined,
  availableTemplates: Array<{ id: string; template: LayoutTemplate }>,
): Promise<string> {
  if (availableTemplates.length === 0) {
    throw new Error(
      'No cosmos layout templates found. Add a template with purposes including "cosmos".',
    );
  }

  if (hints?.cosmosTemplateId) {
    const match = availableTemplates.find((t) => t.id === hints.cosmosTemplateId);
    if (!match) {
      throw new Error(
        `Cosmos template "${hints.cosmosTemplateId}" not found. Available: ${availableTemplates.map((t) => t.id).join(', ')}`,
      );
    }
    logger.info('CosmosTemplateSelection', `Using explicit template: ${match.id}`);
    return match.id;
  }

  if (availableTemplates.length === 1) {
    logger.info(
      'CosmosTemplateSelection',
      `Only one cosmos template available: ${availableTemplates[0].id}`,
    );
    return availableTemplates[0].id;
  }

  const templateSummaries = availableTemplates
    .map((t) => `- "${t.id}": ${t.template.name} -- ${t.template.description}`)
    .join('\n');

  const hintParts: string[] = [];
  if (hints?.genre) hintParts.push(`Genre: ${hints.genre}`);
  if (hints?.era) hintParts.push(`Era: ${hints.era}`);
  if (hints?.tone) hintParts.push(`Tone: ${hints.tone}`);
  if (hints?.keyElements?.length) hintParts.push(`Key Elements: ${hints.keyElements.join(', ')}`);
  const hintsText = hintParts.length > 0 ? hintParts.join('\n') : 'No specific hints provided.';

  const result = await queryLlm<{ templateId: string }>({
    system: `You are selecting a cosmos layout template for a new universe.
Pick the template that best fits the universe hints.

Available templates:
${templateSummaries}

Return ONLY the template id.`,
    prompt: `Universe hints:\n${hintsText}`,
    complexity: 'minimal',
    context: 'Cosmos Template Selection',
    schema: {
      name: 'cosmos_template_selection',
      schema: {
        type: 'object',
        properties: {
          templateId: {
            type: 'string',
            enum: availableTemplates.map((t) => t.id),
            description: 'The selected cosmos template id',
          },
        },
        required: ['templateId'],
        additionalProperties: false,
      },
    },
  });

  logger.info('CosmosTemplateSelection', `LLM selected template: ${result.content.templateId}`);
  return result.content.templateId;
}

// ============================================================================
// Universe Generation
// ============================================================================

/**
 * Generate a complete universe definition using AI.
 * This includes generating an appropriate calendar for the setting.
 * Optionally uses a WorldBible extracted from uploaded documents.
 */
export async function generateUniverse(
  hints?: UniverseGenerationHints,
  worldBible?: WorldBible,
): Promise<{
  universe: Omit<Universe, 'characters' | 'places'>;
  rootPlaceName: string;
  rootPlaceDescription: string;
}> {
  logger.info(
    'UniverseGenerator',
    `Generating universe with hints: ${JSON.stringify(hints || {})}${worldBible ? ' and World Bible' : ''}`,
  );

  const hintParts: string[] = [];
  if (hints?.genre) hintParts.push(`Genre: ${hints.genre}`);
  if (hints?.era) hintParts.push(`Era: ${hints.era}`);
  if (hints?.tone) hintParts.push(`Tone: ${hints.tone}`);
  if (hints?.artStyle) hintParts.push(`Art Style: ${hints.artStyle}`);
  if (hints?.keyElements?.length) hintParts.push(`Key Elements: ${hints.keyElements.join(', ')}`);

  const hintsText =
    hintParts.length > 0 ? hintParts.join('\n') : 'Create something unique and imaginative.';

  // Build World Bible context section if provided
  let worldBibleSection = '';
  let extractedRaces: string[] = [];
  if (worldBible) {
    // Extract race names from character descriptions (look for common race words)
    const racePatterns =
      /\b(human|elf|elven|halfling|dwarf|dwarven|gnome|orc|tiefling|dragonborn|leonin|leonine|genasi|aasimar|tabaxi|goliath|firbolg|kenku|lizardfolk|triton|goblin|hobgoblin|bugbear|kobold|yuan-ti|changeling|shifter|warforged|centaur|minotaur|satyr|fairy|harengon|owlin|plasmoid|thri-kreen|tortle|vedalken|loxodon|simic hybrid|gith)\b/gi;
    const foundRaces = new Set<string>();
    for (const char of worldBible.characters) {
      const matches = char.description.match(racePatterns);
      if (matches) {
        matches.forEach((m) => foundRaces.add(m.toLowerCase()));
      }
    }
    extractedRaces = Array.from(foundRaces);

    // Build races guidance based on what we found
    const racesGuidance =
      extractedRaces.length > 0
        ? `**Races mentioned in source:** ${extractedRaces.join(', ')}
CRITICAL: Only include races from this list. Do NOT invent new race names.`
        : `CRITICAL: Only include races explicitly mentioned or clearly implied by the source material and setting. Do NOT invent new race names or concepts like "Veilmarked" or similar.`;

    worldBibleSection = `

## Source Material (World Bible)
Use this consolidated world-building information as the foundation for the universe.

## CRITICAL: NO HALLUCINATION
When source material is provided:
- Universe name MUST use actual world/place names from the source (e.g., "Anslem", "Gaardia", "Muraii")
- Do NOT invent new proper nouns, terminology, or concepts not in the source
- Era names MUST match source notation exactly (e.g., if source says "Fourth Age" or "4A", use that - do NOT invent alternatives like "Lexfall")
- Month names should be generic/thematic, not invented world-specific terms

**Narrative Present (Current Time):** ${worldBible.narrativePresent || 'Not specified'}
The "date" field must match this. If it says "1472 4A" or "Fourth Age", preserve that exact era notation.

**Themes:** ${worldBible.themes.join(', ')}

**Tone:** ${worldBible.tone}

**Atmosphere:** ${worldBible.atmosphere}

**Overview:** ${worldBible.overview}

**Key Conflicts:** ${worldBible.keyConflicts.join('; ')}

**Lore:** ${worldBible.lore}

**Historical Background:** ${worldBible.historicalLore || 'None provided'}

**Rules/Constraints:** ${worldBible.rules.join('; ')}

**Contemporary Characters:** ${worldBible.characters.map((c) => `${c.name}: ${c.description}`).join('; ')}

**Notable Places:** ${worldBible.places.map((p) => `${p.name}: ${p.description}`).join('; ')}

${racesGuidance}`;
  }

  const baseInstructions = worldBible
    ? `You are a world-builder creating a universe setting from provided source material.

Create a universe that:
- Uses a name derived from the source material (world names, place names, or era names from the documents)
- Preserves the lore, atmosphere, and rules from the source
- Uses ONLY races mentioned in the source material
- Uses the starting location from notable places in the source`
    : `You are a world-builder creating unique, immersive universe settings for role-playing games.

Create a complete universe with:
- A distinctive name and ID
- Rich lore and atmosphere
- Clear narrative rules and constraints
- Appropriate tone and visual style
- 3-6 playable races that fit the setting
- A compelling starting location`;

  const creativityGuidance = worldBible
    ? 'Use ONLY terminology, proper nouns, and concepts from the source material. Do NOT invent new names, eras, races, or terminology.'
    : 'Be creative and avoid generic tropes unless specifically requested. The universe should feel cohesive and internally consistent.';

  const result = await queryLlm<UniverseGenerationResponse>({
    system: `${baseInstructions}
${worldBibleSection}

${creativityGuidance}`,
    prompt: `Generate a universe based on these hints:\n\n${hintsText}`,
    complexity: 'reasoning',
    context: 'Universe Generation',
    schema: {
      name: 'universe_definition',
      schema: UNIVERSE_GENERATION_SCHEMA,
    },
  });

  const data = result.content;

  // Generate a root place ID from the name
  const rootPlaceId = `PLACE_${data.rootPlaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;

  // Use narrativePresent from WorldBible if available, otherwise use the LLM-generated date
  // This ensures the calendar and date align with the source material's timeline
  const dateForCalendar = worldBible?.narrativePresent || data.date;
  if (worldBible?.narrativePresent) {
    logger.info(
      'UniverseGenerator',
      `Using narrativePresent from World Bible: ${worldBible.narrativePresent}`,
    );
  }

  // Generate a calendar configuration appropriate for the setting
  // Pass narrativePresent as sourceEraNotation to constrain era names to source material
  const calendar = await generateCalendar(
    data.name,
    data.description,
    dateForCalendar,
    hints,
    worldBible?.narrativePresent,
  );

  // Format the date to match the calendar's expected format
  const formattedDate = formatInitialDate(dateForCalendar, calendar);

  const universe: Omit<Universe, 'characters' | 'places'> = {
    id: canonicalUniverseIdFromName(data.name),
    name: data.name,
    version: '1.0.0',
    description: data.description,
    custom: {},
    rules: data.rules,
    tone: data.tone,
    style: data.style,
    mapStyle: null,
    image: null,
    date: formattedDate,
    calendar,
    weather: null,
    weatherSeverity: null,
    climate: null,
    music: null,
    races: data.races.map((race: RaceDefinition) => normalizeGeneratedRaceSpriteHints(race)),
    events: null,
    objects: null,
    rootPlaceId,
    defaultStartPlaceId: null,
    stagingSpriteTheme: 'fantasy',
    hungerFatigueEnabled: false,
    rulesetId: null,
  };

  logger.info(
    'UniverseGenerator',
    `Generated universe: ${universe.id} (${universe.name}) with calendar: ${calendar.name}`,
  );

  return {
    universe,
    rootPlaceName: data.rootPlaceName,
    rootPlaceDescription: data.rootPlaceDescription,
  };
}

/**
 * Format the initial date string to match the calendar configuration.
 * Attempts to parse the LLM-generated date and reformat it properly.
 */
function formatInitialDate(dateString: string, calendar: CalendarConfig): string {
  const calendarType = calendar.calendarType ?? 'standard';

  // Try to extract year, era, and time from the date string
  const timeMatch = dateString.match(/(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? parseInt(timeMatch[1], 10) : 10;
  const minute = timeMatch ? parseInt(timeMatch[2], 10) : 0;

  // Try to find a year (4-digit number or number followed by era)
  let year = 1;
  const yearMatch = dateString.match(/\b(\d{1,5})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  // Find era if present
  let eraId = calendar.defaultEra;
  if (calendar.eras) {
    for (const era of calendar.eras) {
      if (era.shortName && dateString.toUpperCase().includes(era.shortName.toUpperCase())) {
        eraId = era.id;
        break;
      }
      if (dateString.toLowerCase().includes(era.name.toLowerCase())) {
        eraId = era.id;
        break;
      }
    }
  }

  // Build the formatted date based on calendar type
  if (calendarType === 'year-only') {
    const template = calendar.format?.yearOnlyTemplate ?? '${year} ${era}';
    const eraShortName = calendar.eras?.find((e) => e.id === eraId)?.shortName ?? '';
    const datePart = template.replace('${year}', String(year)).replace('${era}', eraShortName);

    // Check for unsubstituted placeholders - indicates an unsupported variable in the template
    const unsubstituted = datePart.match(/\$\{(\w+)\}/g);
    if (unsubstituted) {
      logger.error(
        'UniverseGenerator',
        `yearOnlyTemplate contains unsupported placeholders: ${unsubstituted.join(', ')}. Only \${era} and \${year} are supported. Template: "${template}"`,
      );
    }

    return `${datePart} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  if (calendarType === 'millennium') {
    const prefix = calendar.format?.millenniumPrefix ?? 'M';
    return `${year}.${prefix}${eraId} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // Standard calendar: DD.MM.YYYY [ERA] HH:MM
  const sep = calendar.format?.dateSeparator ?? '.';
  const day = '01';
  const month = '01';
  const eraShortName = calendar.eras?.find((e) => e.id === eraId)?.shortName;
  const eraPos = calendar.format?.eraPosition ?? 'suffix';

  let datePart = `${day}${sep}${month}${sep}${year}`;
  if (eraShortName && eraPos !== 'none') {
    if (eraPos === 'prefix') {
      datePart = `${eraShortName} ${datePart}`;
    } else {
      datePart = `${datePart} ${eraShortName}`;
    }
  }

  return `${datePart} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ============================================================================
// Calendar Generation
// ============================================================================

/**
 * Generate a calendar configuration appropriate for a universe.
 * Uses LLM to create a setting-appropriate calendar, with fallback to sensible defaults.
 *
 * @param sourceEraNotation - If provided, era names MUST use this exact notation (e.g., "Fourth Age" / "4A")
 */
export async function generateCalendar(
  universeName: string,
  universeDescription: string,
  dateString: string,
  hints?: UniverseGenerationHints,
  sourceEraNotation?: string,
): Promise<CalendarConfig> {
  logger.info('UniverseGenerator', `Generating calendar for universe: ${universeName}`);

  // Build era constraint if source notation provided
  const eraConstraint = sourceEraNotation
    ? `
CRITICAL: The source material uses this era notation: "${sourceEraNotation}"
You MUST use era names that match this EXACTLY. For example:
- If source says "Fourth Age" or "4A", use "Fourth Age" with shortName "4A"
- Do NOT invent alternative era names like "Age of Lexfall" or similar
- Include eras for First Age, Second Age, Third Age, Fourth Age if the source implies multiple ages`
    : '';

  try {
    const result = await queryLlm<CalendarGenerationResponse>({
      system: `You are creating a calendar system for a role-playing game universe.

Create a calendar that:
- Fits the setting's genre and era
- Has generic month names (seasons, numbers, or simple thematic names - NOT invented world-specific terms)
- Uses era notation from the source material if provided
- Has reasonable time divisions (hours per day, days per month)
${eraConstraint}

Guidelines for calendarType:
- Use "standard" for most settings with normal day/month/year tracking
- Use "year-only" for settings where only the year and era matter (like "Third Age 2940" or "19 BBY")
- Use "millennium" for far-future settings with notation like "999.M41" (year 999 of the 41st Millennium)

For backwards-counting eras (like Star Wars BBY):
- Set "backwards": true on the era
- Set "transitionEra" to the era ID that follows (e.g., BBY transitions to ABY)`,
      prompt: `Create a calendar for this universe:

Name: ${universeName}
Description: ${universeDescription}
Starting Date: ${dateString}
${hints?.genre ? `Genre: ${hints.genre}` : ''}
${hints?.era ? `Era/Period: ${hints.era}` : ''}

Generate a calendar configuration that fits this setting.`,
      complexity: 'reasoning',
      context: 'Calendar Generation',
      schema: {
        name: 'calendar_config',
        schema: CALENDAR_GENERATION_SCHEMA,
      },
    });

    const data = result.content;

    // Convert LLM response to CalendarConfig
    const calendar: CalendarConfig = {
      name: data.name,
      calendarType: data.calendarType,
      months: data.months,
      time: {
        hoursPerDay: data.hoursPerDay,
        minutesPerHour: 60,
      },
      eras: data.eras.map((e) => ({
        id: e.id,
        name: e.name,
        shortName: e.shortName,
        backwards: e.backwards ?? false,
        transitionEra: e.transitionEra ?? null,
      })),
      defaultEra: data.defaultEra,
      seasons: null,
      format: {
        dateSeparator: '.',
        timeSeparator: ':',
        eraPosition: data.eraPosition,
        monthDisplay: 'number',
        yearFirst: false,
        use24Hour: false,
        yearOnlyTemplate: data.yearOnlyTemplate ?? null,
        millenniumPrefix: data.millenniumPrefix ?? null,
      },
    };

    logger.info(
      'UniverseGenerator',
      `Generated calendar: ${calendar.name} (type: ${calendar.calendarType})`,
    );
    return calendar;
  } catch (error) {
    logger.warn(
      'UniverseGenerator',
      `Calendar generation failed, using fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
    return createFallbackCalendar(dateString, hints);
  }
}

/**
 * Create a fallback calendar when LLM generation fails.
 * Detects patterns in the date string to choose appropriate defaults.
 */
function createFallbackCalendar(
  dateString: string,
  _hints?: UniverseGenerationHints,
): CalendarConfig {
  // Detect calendar type from date string patterns
  const calendarType = detectCalendarType(dateString);

  logger.info('UniverseGenerator', `Using fallback calendar type: ${calendarType}`);

  if (calendarType === 'millennium') {
    // Extract millennium from pattern like "999.M41"
    const millenniumMatch = dateString.match(/\.M(\d+)/i);
    const millenniumNum = millenniumMatch ? parseInt(millenniumMatch[1], 10) : 41;

    return {
      name: 'Imperial Calendar',
      calendarType: 'millennium',
      months: [{ name: 'Year', days: 365 }],
      time: { hoursPerDay: 24, minutesPerHour: 60 },
      eras: [
        {
          id: millenniumNum,
          name: `${millenniumNum}${getOrdinalSuffix(millenniumNum)} Millennium`,
          shortName: `M${millenniumNum}`,
          backwards: false,
          transitionEra: null,
        },
      ],
      defaultEra: millenniumNum,
      seasons: null,
      format: {
        dateSeparator: '.',
        timeSeparator: ':',
        eraPosition: 'suffix',
        monthDisplay: null,
        yearFirst: false,
        use24Hour: false,
        yearOnlyTemplate: null,
        millenniumPrefix: 'M',
      },
    };
  }

  if (calendarType === 'year-only') {
    // Detect era patterns
    const bbyMatch = dateString.match(/(\d+)\s*BBY/i);
    const abyMatch = dateString.match(/(\d+)\s*ABY/i);
    const taMatch = dateString.match(/T\.?A\.?\s*(\d+)/i);

    if (bbyMatch || abyMatch) {
      // Star Wars style
      return {
        name: 'Galactic Standard Calendar',
        calendarType: 'year-only',
        months: [{ name: 'Year', days: 368 }],
        time: { hoursPerDay: 24, minutesPerHour: 60 },
        eras: [
          {
            id: 1,
            name: 'Before Battle of Yavin',
            shortName: 'BBY',
            backwards: true,
            transitionEra: 2,
          },
          {
            id: 2,
            name: 'After Battle of Yavin',
            shortName: 'ABY',
            backwards: false,
            transitionEra: null,
          },
        ],
        defaultEra: bbyMatch ? 1 : 2,
        seasons: null,
        format: {
          dateSeparator: '.',
          timeSeparator: ':',
          eraPosition: 'suffix',
          monthDisplay: null,
          yearFirst: false,
          use24Hour: false,
          yearOnlyTemplate: '${year} ${era}',
          millenniumPrefix: null,
        },
      };
    }

    if (taMatch) {
      // Middle-earth style
      return {
        name: 'Shire Reckoning',
        calendarType: 'year-only',
        months: [{ name: 'Year', days: 365 }],
        time: { hoursPerDay: 24, minutesPerHour: 60 },
        eras: [
          { id: 1, name: 'First Age', shortName: 'F.A.', backwards: false, transitionEra: null },
          { id: 2, name: 'Second Age', shortName: 'S.A.', backwards: false, transitionEra: null },
          { id: 3, name: 'Third Age', shortName: 'T.A.', backwards: false, transitionEra: null },
          { id: 4, name: 'Fourth Age', shortName: 'Fo.A.', backwards: false, transitionEra: null },
        ],
        defaultEra: 3,
        seasons: null,
        format: {
          dateSeparator: '.',
          timeSeparator: ':',
          eraPosition: 'prefix',
          monthDisplay: null,
          yearFirst: false,
          use24Hour: false,
          yearOnlyTemplate: '${era} ${year}',
          millenniumPrefix: null,
        },
      };
    }

    // Generic year-only fallback
    return {
      name: 'Standard Calendar',
      calendarType: 'year-only',
      months: [{ name: 'Year', days: 365 }],
      time: { hoursPerDay: 24, minutesPerHour: 60 },
      eras: [{ id: 1, name: 'Common Era', shortName: 'CE', backwards: false, transitionEra: null }],
      defaultEra: 1,
      seasons: null,
      format: {
        dateSeparator: '.',
        timeSeparator: ':',
        eraPosition: 'suffix',
        monthDisplay: null,
        yearFirst: false,
        use24Hour: false,
        yearOnlyTemplate: '${year} ${era}',
        millenniumPrefix: null,
      },
    };
  }

  // Standard calendar fallback with generic month names (Earth-like structure)
  const months = [
    { name: '1st Month', days: 31 },
    { name: '2nd Month', days: 28 },
    { name: '3rd Month', days: 31 },
    { name: '4th Month', days: 30 },
    { name: '5th Month', days: 31 },
    { name: '6th Month', days: 30 },
    { name: '7th Month', days: 31 },
    { name: '8th Month', days: 31 },
    { name: '9th Month', days: 30 },
    { name: '10th Month', days: 31 },
    { name: '11th Month', days: 30 },
    { name: '12th Month', days: 31 },
  ];

  return {
    name: 'Standard Calendar',
    calendarType: 'standard',
    months,
    time: { hoursPerDay: 24, minutesPerHour: 60 },
    eras: [],
    defaultEra: 0,
    seasons: null,
    format: {
      dateSeparator: '.',
      timeSeparator: ':',
      eraPosition: 'none',
      monthDisplay: 'number',
      yearFirst: false,
      use24Hour: false,
      yearOnlyTemplate: null,
      millenniumPrefix: null,
    },
  };
}

/**
 * Detect the likely calendar type from a date string.
 */
function detectCalendarType(dateString: string): 'standard' | 'year-only' | 'millennium' {
  const normalized = dateString.toUpperCase();

  // Millennium notation (e.g., "999.M41")
  if (/\d+\.M\d+/i.test(normalized)) {
    return 'millennium';
  }

  // Year-only patterns
  if (/\d+\s*BBY/i.test(normalized) || /\d+\s*ABY/i.test(normalized)) {
    return 'year-only';
  }
  if (/T\.?A\.?\s*\d+/i.test(normalized) || /\d+\s*T\.?A\.?/i.test(normalized)) {
    return 'year-only';
  }
  if (/F\.?A\.?\s*\d+/i.test(normalized) || /S\.?A\.?\s*\d+/i.test(normalized)) {
    return 'year-only';
  }
  // Pattern like "1A", "2A", "3A", "4A" etc. (age notation)
  if (/\d+\s+\d+A\b/i.test(normalized)) {
    return 'year-only';
  }

  return 'standard';
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// ============================================================================
// Universe Image Generation
// ============================================================================

export interface GenerateUniverseImageParams {
  /** The universe definition (for context) */
  universe: Partial<Universe>;
  /** Optional additional prompt instructions */
  instructions?: string;
}

/**
 * Generate a cover image for a universe.
 * Returns base64 image data.
 */
export async function generateUniverseImage(
  params: GenerateUniverseImageParams,
): Promise<string | null> {
  const { universe, instructions } = params;

  logger.info('UniverseGenerator', `Generating universe image for: ${universe.name || 'untitled'}`);

  // Check if image generation is disabled
  if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
    logger.info(
      'UniverseGenerator',
      'Image generation disabled via DISABLE_IMAGE_GENERATION env variable — skipping',
    );
    return null;
  }

  // Build the image prompt
  const promptParts: string[] = [];

  // Add base style
  promptParts.push('Stunning landscape artwork for a role-playing game universe.');

  // Add universe-specific context
  if (universe.description) {
    promptParts.push(`Setting: ${universe.description}`);
  }

  // Add style
  if (universe.style) {
    promptParts.push(`Art style: ${universe.style}`);
  }

  // Add custom instructions
  if (instructions) {
    promptParts.push(instructions);
  }

  // Add quality and format requirements
  promptParts.push('Wide panoramic view. No text, no UI elements, no watermarks.');
  promptParts.push('Cinematic composition, rich colors, atmospheric depth.');

  const fullPrompt = promptParts.join(' ');

  logger.info('UniverseGenerator', `Image prompt: ${fullPrompt.substring(0, 100)}...`);

  // Generate the image
  const result = await generateImage({
    prompt: fullPrompt,
    size: '1536x1024', // Landscape for universe cover
    context: 'Universe Image',
  });

  logger.info(
    'UniverseGenerator',
    `Generated universe image: ${result.base64.length} chars base64`,
  );

  return result.base64;
}

/**
 * Save a universe image from base64 data.
 * Returns the S3 URL for the saved image.
 */
export async function saveUniverseImage(universeId: string, imageBase64: string): Promise<string> {
  const filename = 'cover.png';
  const key = `universes/${universeId}/images/${filename}`;

  // Decode and save
  const buffer = Buffer.from(imageBase64, 'base64');

  const imageUrl = await storageService.uploadFile(key, buffer, 'image/png');
  logger.info('UniverseGenerator', `Saved universe image: ${imageUrl}`);

  return imageUrl;
}
