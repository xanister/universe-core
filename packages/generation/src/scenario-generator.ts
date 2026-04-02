/**
 * Scenario Generator
 *
 * AI generation service for scenario components:
 * - Full scenario (label, description, character, situation)
 * - Starting situation (narrative + characterState)
 * - Scenario description
 * - Background image
 */

import { queryLlm, generateImage } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

import type { StartingSituation, ScenarioDefinition } from '@dmnpc/types/npc';
import type { Universe, Place } from '@dmnpc/types/entity';
import { buildGenerationContext } from './generation-context.js';

// ============================================================================
// Starting Situation Generation
// ============================================================================

export interface GenerateStartingSituationParams {
  /** User's prompt describing the situation */
  prompt: string;
  /** Universe ID for context (optional - if not provided, generates generic situation) */
  universeId?: string;
  /** Starting place ID for context */
  placeId?: string;
  /** Character name for context */
  characterName?: string;
  /** Character description for context */
  characterDescription?: string;
}

interface StartingSituationResponse {
  narrative: string;
  characterState: string;
}

const STARTING_SITUATION_SCHEMA = {
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      description:
        'The prose narrative for the opening scene, 1-2 paragraphs. Written in second person ("you"). Sets the scene, describes what the character sees/feels, and establishes the immediate context.',
    },
    characterState: {
      type: 'string',
      description:
        'Brief emotional/psychological state at start (e.g., "confused, disoriented" or "eager, optimistic"). Comma-separated descriptors.',
    },
  },
  required: ['narrative', 'characterState'],
  additionalProperties: false,
};

/**
 * Generate a starting situation from a user prompt.
 * If no universeId is provided, generates a generic situation suitable for any universe.
 */
export async function generateStartingSituation(
  params: GenerateStartingSituationParams,
  ctx?: UniverseContext,
): Promise<StartingSituation> {
  const { prompt, universeId, placeId, characterName, characterDescription } = params;

  logger.info(
    'ScenarioGenerator',
    `Generating starting situation: universe=${universeId ?? 'generic'}`,
  );

  // Use provided context if available
  let universe: Universe | undefined;
  let place: Place | undefined;
  if (ctx) {
    universe = ctx.universe;
    if (placeId) {
      place = ctx.findPlace(placeId);
    }
  }

  const systemPrompt = buildStartingSituationSystemPrompt(
    universe,
    place,
    characterName,
    characterDescription,
  );

  const result = await queryLlm<StartingSituationResponse>({
    system: systemPrompt,
    prompt: `Generate a starting situation based on this description:\n\n${prompt}`,
    complexity: 'reasoning',
    context: 'Scenario Starting Situation',
    schema: {
      name: 'starting_situation',
      schema: STARTING_SITUATION_SCHEMA,
    },
  });

  logger.info(
    'ScenarioGenerator',
    `Generated starting situation: ${result.content.characterState}`,
  );

  return {
    narrative: result.content.narrative,
    characterState: result.content.characterState,
    initialEvents: null,
    initialKnowledge: null,
  };
}

function buildStartingSituationSystemPrompt(
  universe?: Universe,
  place?: Place,
  characterName?: string,
  characterDescription?: string,
): string {
  const parts: string[] = [
    'You are a creative writer for a role-playing game. Generate an immersive opening scene for a scenario.',
    '',
    'Write the narrative in second person ("you") and present tense.',
    'Create vivid, atmospheric prose that sets the scene.',
    'The narrative should be 1-2 paragraphs.',
    'Do NOT include dialogue or character names if the character is meant to be newly generated.',
  ];

  if (universe) {
    // Universe-specific context
    parts.push('');
    parts.push(`Universe: ${universe.name}`);
    if (universe.tone) parts.push(`Tone: ${universe.tone}`);
    if (universe.description) parts.push(`Setting: ${universe.description}`);
  } else {
    // Generic instructions for scenarios that work across universes
    parts.push('');
    parts.push('IMPORTANT: This scenario must work across ANY universe/setting.');
    parts.push('- Do NOT mention specific world names, places, or setting-specific details.');
    parts.push(
      '- Use generic terms like "the city", "the tavern", "the road" instead of named locations.',
    );
    parts.push(
      '- Avoid genre-specific elements (no magic, technology, etc.) unless the prompt specifies.',
    );
    parts.push('- Focus on universal human experiences: emotions, relationships, challenges.');
    parts.push(
      '- The situation should be adaptable to fantasy, sci-fi, historical, or modern settings.',
    );
  }

  if (place) {
    parts.push('');
    parts.push(`Location: ${place.label}`);
    if (place.description) {
      parts.push(`Location Description: ${place.description}`);
    }
  }

  if (characterName) {
    parts.push('');
    parts.push(`Character: ${characterName}`);
    if (characterDescription) {
      parts.push(`Character Description: ${characterDescription}`);
    }
  }

  return parts.join('\n');
}

// ============================================================================
// Scenario Description Generation
// ============================================================================

export interface GenerateScenarioDescriptionParams {
  /** Universe ID for context */
  universeId: string;
  /** Scenario label/title */
  label?: string;
  /** Character name if known */
  characterName?: string;
  /** Character description */
  characterDescription?: string;
  /** Starting place ID */
  placeId?: string;
  /** Starting situation narrative */
  situationNarrative?: string;
}

/**
 * Generate a scenario description from context.
 */
export async function generateScenarioDescription(
  params: GenerateScenarioDescriptionParams,
  ctx: UniverseContext,
): Promise<string> {
  const { label, characterName, characterDescription, placeId, situationNarrative } = params;

  logger.info(
    'ScenarioGenerator',
    `Generating scenario description for universe=${ctx.universeId}`,
  );
  const universe = ctx.universe;
  let place: Place | undefined;
  if (placeId) {
    place = ctx.findPlace(placeId);
  }

  const contextParts: string[] = [
    `Universe: ${universe.name}`,
    universe.description ? `Setting: ${universe.description}` : null,
  ].filter((x): x is string => x !== null);

  if (label) {
    contextParts.push(`Scenario Title: ${label}`);
  }

  if (place) {
    contextParts.push(`Starting Location: ${place.label}`);
  }

  if (characterName) {
    contextParts.push(`Character: ${characterName}`);
    if (characterDescription) {
      contextParts.push(`Character Background: ${characterDescription}`);
    }
  }

  if (situationNarrative) {
    contextParts.push(`Opening Situation: ${situationNarrative.substring(0, 300)}...`);
  }

  const result = await queryLlm({
    system: `You are a creative writer for a role-playing game. Write a compelling scenario description that will entice players to start this adventure.

The description should:
- Be 2-3 sentences long
- Capture the essence and hook of the scenario
- Hint at the adventure or mystery without spoiling it
- Be written in second person ("you") or third person perspective

Do NOT include character stats, mechanics, or meta-information.`,
    prompt: `Generate a scenario description based on this context:\n\n${contextParts.join('\n')}`,
    complexity: 'reasoning',
    context: 'Scenario Description',
  });

  logger.info(
    'ScenarioGenerator',
    `Generated scenario description: ${result.content.length} chars`,
  );

  return result.content.trim();
}

// ============================================================================
// Scenario Image Generation
// ============================================================================

export interface GenerateScenarioImageParams {
  /** The scenario definition (for context) */
  scenario: Partial<ScenarioDefinition>;
  /** Universe ID (optional, for style lookup) */
  universeId?: string;
  /** Optional additional prompt instructions */
  instructions?: string;
}

/**
 * Generate a background image for a scenario.
 * Returns base64 image data.
 */
export async function generateScenarioImage(
  params: GenerateScenarioImageParams,
  ctx?: UniverseContext,
): Promise<string | null> {
  const { scenario, instructions } = params;

  logger.info(
    'ScenarioGenerator',
    `Generating scenario image for: ${scenario.label || 'untitled'}`,
  );

  // Check if image generation is disabled
  if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
    logger.info(
      'ScenarioGenerator',
      'Image generation disabled via DISABLE_IMAGE_GENERATION env variable — skipping',
    );
    return null;
  }

  // Use provided context if available
  let universe: Universe | undefined;
  let place: Place | undefined;
  if (ctx) {
    universe = ctx.universe;
    if (scenario.playerStartId) {
      place = ctx.findPlace(scenario.playerStartId);
    }
  }

  const prompt = buildScenarioImagePrompt(scenario, universe, place, instructions);

  const result = await generateImage({
    prompt,
    size: '1536x1024', // Landscape for scenario cards
    context: 'Scenario Background Image',
  });

  logger.info('ScenarioGenerator', `Generated scenario image for: ${scenario.label || 'untitled'}`);

  return result.base64;
}

function buildScenarioImagePrompt(
  scenario: Partial<ScenarioDefinition>,
  universe?: Universe,
  place?: Place,
  instructions?: string,
): string {
  const parts: string[] = ['Scene illustration for a role-playing game scenario.'];

  // Add universe style if available
  if (universe?.style) {
    parts.push(`Art style: ${universe.style}.`);
  }

  // Add scenario context
  if (scenario.label) {
    parts.push(`Scene title: "${scenario.label}".`);
  }

  if (scenario.description) {
    // Truncate description for prompt
    const desc =
      scenario.description.length > 200
        ? scenario.description.substring(0, 200) + '...'
        : scenario.description;
    parts.push(`Scene context: ${desc}`);
  }

  // Add place context
  if (place) {
    parts.push(`Location: ${place.label}.`);
    if (place.description) {
      const placeDesc =
        place.description.length > 150
          ? place.description.substring(0, 150) + '...'
          : place.description;
      parts.push(`Environment: ${placeDesc}`);
    }
    if (place.tags.length > 0) {
      parts.push(`Setting is ${place.tags.slice(0, 5).join(', ').toLowerCase()}.`);
    }
  }

  // Add starting situation context
  if (scenario.startingSituation?.narrative) {
    const narrative =
      scenario.startingSituation.narrative.length > 200
        ? scenario.startingSituation.narrative.substring(0, 200) + '...'
        : scenario.startingSituation.narrative;
    parts.push(`Opening scene: ${narrative}`);
  }

  // Composition constraints
  parts.push('');
  parts.push('Atmospheric, cinematic composition with depth and mood.');
  parts.push('Wide establishing shot showing the environment and atmosphere.');
  parts.push('Dramatic lighting appropriate to the scene mood.');
  parts.push('No characters or people visible in the scene - environment only.');
  parts.push('No text, no watermarks, no signatures, no UI elements.');
  parts.push(
    'The environment must fill the frame: no blank/empty/transparent/solid-color background.',
  );

  // Add custom instructions
  if (instructions) {
    parts.push('');
    parts.push(`Additional instructions: ${instructions}`);
  }

  return parts.join('\n');
}

// ============================================================================
// Full Scenario Generation
// ============================================================================

export interface ScenarioGenerationHints {
  /** Theme or mood for the scenario */
  theme?: string;
  /** Character archetype description (mutually exclusive with templateCharacterId) */
  characterType?: string;
  /** Template character ID to use (mutually exclusive with characterType) */
  templateCharacterId?: string;
  /** Type of opening situation */
  situationType?: string;
}

interface GeneratedScenarioResponse {
  label: string;
  description: string;
  characterDescription: string;
  startingSituation: {
    narrative: string;
    characterState: string;
  };
}

const SCENARIO_GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: {
      type: 'string',
      description: 'A short evocative title for the scenario (2-5 words)',
    },
    description: {
      type: 'string',
      description: 'Player-facing description that entices without spoiling (2-3 sentences)',
    },
    characterDescription: {
      type: 'string',
      description:
        'Description for generating a new character. Include archetype, background, and motivation (2-3 sentences)',
    },
    startingSituation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        narrative: {
          type: 'string',
          description:
            'The prose narrative for the opening scene, 1-2 paragraphs. Written in second person ("you"). Sets the scene and establishes immediate context.',
        },
        characterState: {
          type: 'string',
          description:
            'Emotional/psychological state at start. Comma-separated descriptors (e.g., "curious, hopeful, slightly anxious").',
        },
      },
      required: ['narrative', 'characterState'],
    },
  },
  required: ['label', 'description', 'characterDescription', 'startingSituation'],
};

export interface GenerateScenarioParams {
  /** Universe ID. If not provided, generates a universal (genre-agnostic) scenario. */
  universeId?: string;
  /** Starting place ID (optional, only used with universeId) */
  placeId?: string;
  /** Optional hints for generation */
  hints?: ScenarioGenerationHints;
}

/**
 * Generate a complete scenario definition using LLM.
 * Creates label, description, character description, and starting situation.
 *
 * If `universeId` is not provided, generates a genre-agnostic scenario
 * that works in any setting (fantasy, sci-fi, modern, etc.).
 */
export async function generateScenario(
  params: GenerateScenarioParams,
  ctx?: UniverseContext,
): Promise<ScenarioDefinition> {
  const startedAt = Date.now();
  const { universeId, placeId, hints } = params;

  // No universe = generate universal (genre-agnostic) scenario
  if (!universeId) {
    logger.info('ScenarioGenerator', 'Generating universal scenario (genre-agnostic)');
    return generateUniversalScenario(hints, startedAt);
  }

  logger.info('ScenarioGenerator', `Generating full scenario for universe=${universeId}`);

  // Require context when universeId is provided
  if (!ctx) {
    throw new Error('UniverseContext is required when universeId is provided');
  }
  const universeCtx = ctx;
  const universe = universeCtx.universe;
  let place: Place | undefined;
  if (placeId) {
    place = universeCtx.findPlace(placeId);
  }

  // Load all places from the universe for context
  const allPlaces = Array.from(universeCtx.places);
  logger.info('ScenarioGenerator', `Loaded ${allPlaces.length} places for context`);

  const prompt = await buildScenarioGenerationPrompt(universe, place, allPlaces, hints);

  const result = await queryLlm<GeneratedScenarioResponse>({
    prompt,
    complexity: 'reasoning',
    context: 'Full Scenario Generation',
    schema: {
      name: 'scenario_generation',
      schema: SCENARIO_GENERATION_SCHEMA,
    },
  });

  const scenarioData = result.content;

  // Generate scenario ID from label
  const slug = scenarioData.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30);

  const scenario: ScenarioDefinition = {
    id: `SCENARIO_${slug}`,
    label: scenarioData.label,
    description: scenarioData.description,
    backgroundImage: null,
    universeId,
    playerStartId: placeId,
    // Use template character if provided, otherwise use generated character description
    ...(hints?.templateCharacterId
      ? { templateCharacterId: hints.templateCharacterId }
      : { characterDescription: scenarioData.characterDescription }),
    generatePlot: false,
    plotHints: null,
    startingSituation: {
      narrative: scenarioData.startingSituation.narrative,
      characterState: scenarioData.startingSituation.characterState,
      initialEvents: null,
      initialKnowledge: null,
    },
    randomize: null,
    custom: null,
    goals: null,
  };

  logger.info(
    'ScenarioGenerator',
    `Generated scenario: id=${scenario.id} durationMs=${Date.now() - startedAt}`,
  );

  return scenario;
}

/**
 * Generate a universal scenario that works in any setting.
 * The scenario will use generic descriptions that adapt to any genre.
 */
async function generateUniversalScenario(
  hints: ScenarioGenerationHints | undefined,
  startedAt: number,
): Promise<ScenarioDefinition> {
  const prompt = await buildUniversalScenarioPrompt(hints);

  const result = await queryLlm<GeneratedScenarioResponse>({
    prompt,
    complexity: 'reasoning',
    context: 'Universal Scenario Generation',
    schema: {
      name: 'scenario_generation',
      schema: SCENARIO_GENERATION_SCHEMA,
    },
  });

  const scenarioData = result.content;

  // Generate scenario ID from label
  const slug = scenarioData.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30);

  const scenario: ScenarioDefinition = {
    id: `SCENARIO_${slug}`,
    label: scenarioData.label,
    description: scenarioData.description,
    backgroundImage: null,
    // No universeId - this scenario works with any universe
    // Use template character if provided, otherwise use generated character description
    ...(hints?.templateCharacterId
      ? { templateCharacterId: hints.templateCharacterId }
      : { characterDescription: scenarioData.characterDescription }),
    generatePlot: false,
    plotHints: null,
    startingSituation: {
      narrative: scenarioData.startingSituation.narrative,
      characterState: scenarioData.startingSituation.characterState,
      initialEvents: null,
      initialKnowledge: null,
    },
    // Mark for random universe selection at runtime
    randomize: {
      universe: true,
      character: false,
      storyteller: false,
      plot: false,
      situation: false,
    },
    custom: null,
    goals: null,
  };

  logger.info(
    'ScenarioGenerator',
    `Generated universal scenario: id=${scenario.id} durationMs=${Date.now() - startedAt}`,
  );

  return scenario;
}

/**
 * Build prompt for generating a universal (genre-agnostic) scenario.
 */
async function buildUniversalScenarioPrompt(hints?: ScenarioGenerationHints): Promise<string> {
  const parts: string[] = [];

  parts.push('Generate a UNIVERSAL scenario for a role-playing game.');
  parts.push('');
  parts.push(
    'CRITICAL: This scenario must work in ANY setting - fantasy, sci-fi, modern, historical, etc.',
  );
  parts.push('Do NOT use genre-specific terminology, technology, or magic systems.');
  parts.push('Use abstract, adaptable language that translates to any world.');

  // Add available storytellers and template characters context
  const generationContext = await buildGenerationContext({
    includeStorytellers: true,
    includeTemplateCharacters: true,
  });
  if (generationContext) {
    parts.push('');
    parts.push(generationContext);
  }

  if (hints) {
    parts.push('');
    parts.push('Generation Hints (incorporate these in a genre-neutral way):');
    if (hints.theme) parts.push(`- Theme/Mood: ${hints.theme}`);
    if (hints.characterType) parts.push(`- Character Archetype: ${hints.characterType}`);
    if (hints.situationType) parts.push(`- Opening Situation Type: ${hints.situationType}`);
    if (hints.templateCharacterId)
      parts.push(`- Template Character ID: ${hints.templateCharacterId} (use this character)`);
  }

  parts.push(`

REQUIREMENTS FOR UNIVERSAL SCENARIOS:

1. LABEL: A short, evocative title (2-5 words) that works in any genre
   - GOOD: "The Missing Heir", "Shadows in the Market", "A Debt Unpaid"
   - BAD: "The Dragon's Lair" (fantasy-specific), "Space Station Chaos" (sci-fi-specific)

2. DESCRIPTION: A player-facing teaser (2-3 sentences) that:
   - Uses genre-neutral language
   - Creates intrigue without assuming a specific setting
   - Mentions "the city", "the settlement", "the community" - not specific place types
   - GOOD: "Someone important has vanished, and the trail leads to the underbelly of society."
   - BAD: "The wizard has disappeared from the magical academy."

3. CHARACTER DESCRIPTION: A description for generating a new character (2-3 sentences):
   - If a template character was specified, build on their established personality and themes
   - Otherwise, use universal archetypes: "investigator", "healer", "trader", "guard", "scholar"
   - NOT: "wizard", "space marine", "hacker", "knight"
   - Background should be adaptable to any setting

4. STARTING SITUATION: The opening scene:
   - narrative: 1-2 paragraphs in second person ("you") present tense
   - Use ONLY setting-neutral descriptions:
     * "a bustling market" not "a medieval bazaar" or "a space station promenade"
     * "the local authority" not "the king's guard" or "station security"
     * "a message arrives" not "a letter" or "a hologram"
     * "weapons" not "swords" or "blasters"
     * "transportation" not "horses" or "ships"
   - The scene should feel vivid but adaptable
   - characterState: comma-separated emotional descriptors

Make the scenario compelling and unique while remaining completely genre-agnostic.
The same scenario should feel natural whether placed in a fantasy kingdom, a space station, or a modern city.
`);

  return parts.join('\n');
}

async function buildScenarioGenerationPrompt(
  universe: Universe,
  place: Place | undefined,
  allPlaces: Place[],
  hints?: ScenarioGenerationHints,
): Promise<string> {
  const parts: string[] = [];

  parts.push('Generate a complete scenario for a role-playing game.');
  parts.push('');
  parts.push(`Universe: ${universe.name}`);
  if (universe.description) {
    parts.push(`Setting: ${universe.description}`);
  }
  if (universe.tone) {
    parts.push(`Tone: ${universe.tone}`);
  }

  // Add available storytellers and template characters context
  const generationContext = await buildGenerationContext({
    includeStorytellers: true,
    includeTemplateCharacters: true,
  });
  if (generationContext) {
    parts.push('');
    parts.push(generationContext);
  }

  // Include places that exist in the universe
  if (allPlaces.length > 0) {
    parts.push('');
    parts.push('EXISTING LOCATIONS IN THIS UNIVERSE (use these, do not invent new ones):');
    // Include up to 20 places to avoid token limits
    const placesToInclude = allPlaces.slice(0, 20);
    for (const p of placesToInclude) {
      const tags = p.tags.length ? ` [${p.tags.slice(0, 3).join(', ')}]` : '';
      parts.push(
        `- ${p.label}${tags}: ${p.short_description || p.description.substring(0, 100) || ''}`,
      );
    }
    if (allPlaces.length > 20) {
      parts.push(`... and ${allPlaces.length - 20} more locations`);
    }
  }

  if (place) {
    parts.push('');
    parts.push(`STARTING LOCATION (use this specific place): ${place.label}`);
    if (place.description) {
      parts.push(`Location Description: ${place.description}`);
    }
  }

  if (hints) {
    parts.push('');
    parts.push('Generation Hints (incorporate these):');
    if (hints.theme) parts.push(`- Theme/Mood: ${hints.theme}`);
    if (hints.characterType) parts.push(`- Character Archetype: ${hints.characterType}`);
    if (hints.situationType) parts.push(`- Opening Situation Type: ${hints.situationType}`);
    if (hints.templateCharacterId)
      parts.push(`- Template Character ID: ${hints.templateCharacterId} (use this character)`);
  }

  parts.push(`

CRITICAL: Only reference locations that exist in the universe list above. Do NOT invent new place names.

REQUIREMENTS:

1. LABEL: A short, evocative title (2-5 words) that captures the scenario's essence

2. DESCRIPTION: A player-facing teaser (2-3 sentences) that:
   - Hints at adventure without spoiling
   - Creates intrigue and excitement
   - Matches the universe's tone
   - References only existing locations from the list above

3. CHARACTER DESCRIPTION: A description for generating a new character (2-3 sentences):
   - If a template character was specified, build on their established personality and themes
   - Otherwise, include archetype or profession
   - Brief background or motivation
   - Should fit naturally in the starting location

4. STARTING SITUATION: The opening scene:
   - narrative: 1-2 paragraphs in second person ("you") present tense
   - Vivid, atmospheric prose that immerses the player
   - Sets up an interesting moment or hook
   - ONLY mention locations that exist in the universe list above
   - characterState: comma-separated emotional descriptors

Make the scenario feel unique and memorable, not generic.
`);

  return parts.join('\n');
}

/**
 * Save a scenario image from base64 to S3.
 * Returns the S3 URL for the image.
 */
export async function saveScenarioImage(scenarioId: string, base64: string): Promise<string> {
  logger.info('ScenarioGenerator', `Saving scenario image: ${scenarioId}`);

  const imageBuffer = Buffer.from(base64, 'base64');
  const filename = `${scenarioId}.png`;
  const key = `scenarios/images/${filename}`;

  const imageUrl = await storageService.uploadFile(key, imageBuffer, 'image/png');

  logger.info('ScenarioGenerator', `Saved scenario image: ${scenarioId} -> ${imageUrl}`);

  return imageUrl;
}
