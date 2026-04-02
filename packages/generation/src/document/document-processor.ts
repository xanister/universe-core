/**
 * Document Processor
 *
 * LLM-based service for extracting structured world-building elements
 * from documents and consolidating them into a unified "World Bible".
 */

import { addQuestions } from '@dmnpc/core/clarification/clarification-store.js';
import type { ClarificationQuestion } from '@dmnpc/core/clarification/clarification-types.js';
import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { ParsedDocument } from '../document/document-parser.js';
import {
  ENVIRONMENT_PRESET_NAMES,
  environmentFromPreset,
  type WorldBible,
  type WorldBibleCharacterRef,
  type WorldBiblePlaceRef,
  type WorldBibleHistoricalEvent,
} from '@dmnpc/types/world';
import { loadPlacePurposeIds } from '../purpose-loader.js';
import { createTemporalStatusQuestion } from '../document/document-clarification-provider.js';

export type { WorldBible };

type CharacterRef = WorldBibleCharacterRef;
type PlaceRef = WorldBiblePlaceRef;

/** Raw place from LLM output — environment is a preset name string, not yet converted */
interface RawLlmPlaceRef extends Omit<PlaceRef, 'environment'> {
  environment: string;
}

/** Raw extraction content from LLM — places have string environments before conversion */
interface RawDocumentExtractionContent extends Omit<DocumentExtraction, 'filename' | 'places'> {
  places: RawLlmPlaceRef[];
}

/** Raw world bible from LLM — places have string environments before conversion */
interface RawWorldBibleContent extends Omit<WorldBible, 'places'> {
  places: RawLlmPlaceRef[];
}

interface DocumentExtraction {
  filename: string;
  themes: string[];
  characters: CharacterRef[];
  places: PlaceRef[];
  loreElements: string[];
  rules: string[];
  tone: string;
  summary: string;
  /** Historical figures who are deceased - to be folded into lore, not character entities */
  historicalFigures: string[];
  /** The latest date/era mentioned - the "current time" of the narrative */
  narrativePresent?: string;
  /** Historical events mentioned in the document - common knowledge */
  historicalEvents: WorldBibleHistoricalEvent[];
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Major themes and motifs (e.g., "redemption", "cosmic horror", "political intrigue")',
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Character proper name ONLY - no titles, no nicknames (e.g., "Meiloria" not "Queen Meiloria", "James" not "Jimmy")',
          },
          title: {
            type: 'string',
            description:
              'Rank or honorific title (e.g., "Queen", "Lord", "Captain", "Dr."). Leave empty if no title.',
          },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Alternative names: nicknames, informal names, epithets (e.g., ["Jimmy", "The Iron Queen", "Old Tom"])',
          },
          description: {
            type: 'string',
            description:
              'Brief OBJECTIVE description (role, actions, significance). Avoid value judgments from narrative POV.',
          },
          temporalStatus: {
            type: 'string',
            enum: ['contemporary', 'historical', 'uncertain'],
            description:
              'Whether the character is alive at the narrative present: "contemporary" (alive), "historical" (dead/ancient), "uncertain" (unclear)',
          },
          activeEra: {
            type: 'string',
            description:
              'The era or time period when the character was active (e.g., "Third Age", "2nd Century", "Before the Cataclysm")',
          },
        },
        required: ['name', 'title', 'aliases', 'description', 'temporalStatus', 'activeEra'],
        additionalProperties: false,
      },
      description:
        'Named characters who are alive at the narrative present (contemporary or uncertain)',
    },
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Location name' },
          description: {
            type: 'string',
            description: 'Brief description of the place',
          },
          isSuitableStart: {
            type: 'boolean',
            description:
              'True ONLY for specific places where a character can physically be (e.g., a specific tavern, a dock, a town square). False for large-scale places (cities, regions, wilderness areas) and dangerous/inaccessible places.',
          },
          environment: {
            type: 'string',
            enum: [...ENVIRONMENT_PRESET_NAMES],
            description:
              '"interior" for enclosed spaces (buildings, caves, rooms). "exterior" for open spaces (docks, clearings, town squares, cities, wilderness). "space" for vacuum environments. "underwater" for submerged environments.',
          },
          purpose: {
            type: 'string',
            enum: loadPlacePurposeIds().filter((t) => t !== 'cosmos'),
            description:
              'Place purpose. Do NOT include a cosmos/universe-level place — the system determines the root structure. Use "planet" for planets, continents, and large regions/kingdoms; "tavern", "inn", "shop", etc. for structures; "forest", "ruins" for outdoor areas.',
          },
          parentName: {
            type: 'string',
            description:
              'Exact label of the parent place for hierarchy. Required. Top-level places (direct children of the world root, e.g., continents on a planet) use "Cosmos" or "Root" as their parentName. All other places use the label of their parent location (e.g., "Western Muraii", "Gaardia").',
          },
        },
        required: [
          'name',
          'description',
          'isSuitableStart',
          'environment',
          'purpose',
          'parentName',
        ],
        additionalProperties: false,
      },
      description: 'Named locations mentioned in the document',
    },
    loreElements: {
      type: 'array',
      items: { type: 'string' },
      description: 'History, myths, magic systems, technology, customs',
    },
    rules: {
      type: 'array',
      items: { type: 'string' },
      description:
        'World constraints or rules (e.g., "magic requires sacrifice", "FTL travel is impossible")',
    },
    tone: {
      type: 'string',
      description: 'Detected tone/mood (e.g., "dark and gritty", "whimsical", "epic and heroic")',
    },
    summary: {
      type: 'string',
      description: 'A 2-3 paragraph narrative summary of the document content',
    },
    historicalFigures: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Brief descriptions of clearly historical/deceased characters (ancient kings, legendary founders, etc.) to be folded into lore',
    },
    narrativePresent: {
      type: 'string',
      description:
        'The latest date, year, or era mentioned in the narrative - the "current time" where the story takes place (e.g., "Year 3019 of the Third Age", "19 BBY", "2847 CE")',
    },
    historicalEvents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description: 'What happened (1-2 sentences, objective description)',
          },
          eventType: {
            type: 'string',
            enum: [
              'founding',
              'war',
              'treaty',
              'catastrophe',
              'ruler_change',
              'discovery',
              'historical',
            ],
            description:
              'Type of event: founding (city/nation founded), war (conflict/battle), treaty (peace/alliance), catastrophe (disaster/plague), ruler_change (coronation/death/coup), discovery (invention/discovery), historical (other)',
          },
          scope: {
            type: 'string',
            enum: ['global', 'regional', 'local'],
            description:
              'How widely known: global (everyone in the world), regional (people in an area), local (people in a specific place)',
          },
          significance: {
            type: 'string',
            enum: ['minor', 'moderate', 'major'],
            description: 'How significant this event is to the world',
          },
          approximateDate: {
            type: 'string',
            description: 'When it happened (e.g., "500 years ago", "Third Age", "Year 1200")',
          },
          relevantPlaces: {
            type: 'array',
            items: { type: 'string' },
            description: 'Place names where this event occurred or is particularly relevant',
          },
        },
        required: [
          'fact',
          'eventType',
          'scope',
          'significance',
          'approximateDate',
          'relevantPlaces',
        ],
        additionalProperties: false,
      },
      description:
        'Historical events mentioned in the document that would be common knowledge: wars, foundings, catastrophes, treaties, regime changes, major discoveries. Extract 5-15 events per document, prioritizing major world-shaping events.',
    },
  },
  required: [
    'themes',
    'characters',
    'places',
    'loreElements',
    'rules',
    'tone',
    'summary',
    'historicalFigures',
    'narrativePresent',
    'historicalEvents',
  ],
  additionalProperties: false,
};

const WORLD_BIBLE_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Consolidated major themes across all documents',
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Proper name only - no titles, no nicknames',
          },
          title: {
            type: 'string',
            description: 'Rank or honorific (e.g., "Queen", "Lord", "Captain")',
          },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description: 'Alternative names: nicknames, epithets, informal names',
          },
          description: {
            type: 'string',
            description: 'Objective description of the character by their actions and role',
          },
          temporalStatus: {
            type: 'string',
            enum: ['contemporary', 'historical', 'uncertain'],
          },
          activeEra: { type: 'string' },
        },
        required: ['name', 'title', 'aliases', 'description', 'temporalStatus', 'activeEra'],
        additionalProperties: false,
      },
      description:
        'Key CONTEMPORARY characters who are alive at the narrative present (deduplicated and merged)',
    },
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          isSuitableStart: {
            type: 'boolean',
            description:
              'True ONLY for specific places (taverns, docks, squares) where characters can physically be. False for large-scale places and dangerous/inaccessible places.',
          },
          environment: {
            type: 'string',
            enum: [...ENVIRONMENT_PRESET_NAMES],
            description:
              '"interior" for enclosed spaces. "exterior" for open spaces. "space" for vacuum. "underwater" for submerged.',
          },
          purpose: {
            type: 'string',
            enum: loadPlacePurposeIds().filter((t) => t !== 'cosmos'),
            description:
              'Place purpose. Do NOT include a cosmos/universe-level place — the system determines the root structure. Use "planet" for planets, continents, and large regions/kingdoms; "tavern", "inn", "shop", etc. for structures; "forest", "ruins" for outdoor areas.',
          },
          parentName: {
            type: 'string',
            description:
              'Exact label of the parent. Top-level places (direct children of root) use "Cosmos" or "Root". All other places use the label of their parent location.',
          },
        },
        required: [
          'name',
          'description',
          'isSuitableStart',
          'environment',
          'purpose',
          'parentName',
        ],
        additionalProperties: false,
      },
      description:
        'Key locations (deduplicated and merged). Do not include a cosmos place — system adds it.',
    },
    lore: {
      type: 'string',
      description: 'Unified lore narrative synthesized from all documents',
    },
    rules: {
      type: 'array',
      items: { type: 'string' },
      description: 'Consolidated world rules and constraints',
    },
    tone: {
      type: 'string',
      description: 'Overall tone determined from all documents',
    },
    overview: {
      type: 'string',
      description: 'High-level overview of the world/setting',
    },
    keyConflicts: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Major tensions, conflicts, or plot hooks - described objectively showing all sides',
    },
    atmosphere: {
      type: 'string',
      description: 'Overall feel and atmosphere of the world',
    },
    narrativePresent: {
      type: 'string',
      description:
        'The consolidated "current time" of the world - the latest date/era from all documents where the narrative takes place',
    },
    historicalLore: {
      type: 'string',
      description:
        'Synthesized narrative about historical figures and events - characters who are deceased at the narrative present',
    },
    historicalEvents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description: 'What happened (1-2 sentences, objective description)',
          },
          eventType: {
            type: 'string',
            enum: [
              'founding',
              'war',
              'treaty',
              'catastrophe',
              'ruler_change',
              'discovery',
              'historical',
            ],
          },
          scope: {
            type: 'string',
            enum: ['global', 'regional', 'local'],
          },
          significance: {
            type: 'string',
            enum: ['minor', 'moderate', 'major'],
          },
          approximateDate: { type: 'string' },
          relevantPlaces: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'fact',
          'eventType',
          'scope',
          'significance',
          'approximateDate',
          'relevantPlaces',
        ],
        additionalProperties: false,
      },
      description:
        'Consolidated historical events (10-20 total). Deduplicate similar events from different documents, keeping the most detailed version. Include a mix of scopes: 2-4 global, 4-8 regional, 4-8 local.',
    },
  },
  required: [
    'themes',
    'characters',
    'places',
    'lore',
    'rules',
    'tone',
    'overview',
    'keyConflicts',
    'atmosphere',
    'narrativePresent',
    'historicalLore',
    'historicalEvents',
  ],
  additionalProperties: false,
};

/**
 * Extract structured world-building elements from a single document.
 */
async function extractFromDocument(doc: ParsedDocument): Promise<DocumentExtraction> {
  logger.info('DocumentProcessor', `Extracting from ${doc.filename} (${doc.charCount} chars)`);

  const content = doc.content.slice(0, 30000);

  const result = await queryLlm<RawDocumentExtractionContent>({
    system: `You are a world-building analyst extracting structured information from source material.
Your goal is to extract elements useful for creating a role-playing game universe.

## CRITICAL: OBJECTIVITY REQUIREMENT

You are extracting world-building information as an OMNISCIENT, NEUTRAL observer.
Do NOT inherit biases from the narrative's point-of-view character(s).

- Describe characters by their ACTIONS and ROLES, not how POV characters perceive them
- Avoid value judgments inherited from the narrative ("evil", "villain", "hero", "heroic", "tyrannical")
- If the source shows conflict, describe BOTH sides' motivations objectively
- Historical events should note multiple perspectives where relevant

BAD: "The Dark Lord Sauron, an evil being who seeks to dominate all life"
GOOD: "Sauron, a Maia who seeks to impose order through domination and the One Ring"

BAD: "The heroic rebels fighting against the tyrannical Empire"
GOOD: "The Rebel Alliance, a coalition seeking to restore the Republic; The Galactic Empire, a centralized government maintaining order through military force"

## TEMPORAL CLASSIFICATION

Determine the "narrative present" - the latest date/time where the story takes place.
- Look for explicit dates, years, or era references (e.g., "In the year 3019...", "19 BBY", "Third Age")
- If multiple time periods are mentioned, the narrative present is the LATEST one

Classify each character's temporal status:
- "contemporary": Alive and active at the narrative present
- "historical": Clearly deceased, ancient, or from a past era (kings from ancient dynasties, legendary founders, etc.)
- "uncertain": Cannot determine from the text

Historical figures (clearly dead/ancient characters) should go in "historicalFigures" as brief descriptions, not in "characters".
The "characters" array should contain only those who could plausibly be NPCs in the world at the narrative present.

## CHARACTER NAMING CONVENTIONS

For each character, extract names with proper structure:
- **name**: The character's PROPER NAME only - no titles, no nicknames
  - GOOD: "Meiloria", "James Johnson", "Marcus Vale"
  - BAD: "Queen Meiloria", "Jimmy Johnson", "Marcus 'The Shadow' Vale"
- **title**: Rank or honorific (e.g., "Queen", "Lord", "Captain", "Dr.") - leave empty string if none
- **aliases**: Array of alternative names - nicknames, epithets, informal names
  - Examples: ["Jimmy", "The Iron Queen", "Old Tom", "The Shadow"]

Examples:
- "Queen Meiloria the Wise" → name: "Meiloria", title: "Queen", aliases: ["The Wise", "Meiloria the Wise"]
- "Jimmy 'Two-Fingers' Malone" → name: "James Malone", title: "", aliases: ["Jimmy", "Two-Fingers", "Jimmy Two-Fingers"]
- "Captain Marcus Vale" → name: "Marcus Vale", title: "Captain", aliases: []

## PLACE HIERARCHY

Do NOT extract a cosmos/universe-level place — the system determines the root structure automatically. parentName is the exact label of the containing place:
- Top-level places (direct children of root, e.g. continents on a planet, or planets in space): parentName "Cosmos" or "Root".
- All other places: parentName = exact label of the parent (e.g. "Western Muraii", "Gaardia", "Guardia Castle").
- Use "planet" purpose for planets AND continents/large kingdoms/regions (they share the same template).

## PLACE NAMING CONVENTIONS

Places are SPACES you can be inside (rooms, buildings, areas). Exits are CONNECTION FEATURES (doors, gates, stairs).
NEVER name a place after an exit type - transform the name to describe the space:
- BAD: "Barracks Door", "Stage Door 3", "Market Gate", "Tower Entrance"
- GOOD: "The Barracks", "The Callsheet Hall", "Market Gatehouse", "Tower Entry Hall"
If source material names a location like an exit, extract the DESTINATION space, not the exit itself.
A "Stage Door" would lead to an intake hall or lobby - extract that space with an appropriate name.

## EXTRACTION FOCUS

Extract:
- Themes and motifs that define the world
- Named characters (ONLY contemporary/uncertain - with objective descriptions, using naming conventions above)
- Named places/locations with brief descriptions (no cosmos — system adds it)
- Lore elements (history, myths, magic systems, technology, customs)
- Rules or constraints of the world
- Overall tone/mood
- Historical figures (as brief descriptions for lore)
- The narrative present (latest date/era)
- Historical events (see below)

## HISTORICAL EVENTS

Extract historical events that would be COMMON KNOWLEDGE in the world - events that ordinary people would know about.

Prioritize (in order):
1. **Catastrophes**: Natural disasters, magical cataclysms, plagues, celestial events
2. **Wars**: Major conflicts, battles, invasions, civil wars
3. **Ruler changes**: Deaths of rulers, coronations, coups, dynasty changes
4. **Foundings**: Cities founded, nations established, organizations created
5. **Treaties**: Peace agreements, major alliances, trade pacts
6. **Discoveries**: Major inventions, magical discoveries, exploration achievements

For each event:
- **fact**: Objective 1-2 sentence description of what happened
- **eventType**: founding, war, treaty, catastrophe, ruler_change, discovery, or historical
- **scope**: global (everyone knows), regional (people in an area know), local (specific place)
- **significance**: major (world-changing), moderate (notable), minor (local importance)
- **approximateDate**: When it happened (e.g., "500 years ago", "Third Age", "Year 1200")
- **relevantPlaces**: Place names where event occurred or is remembered

Extract 5-15 events per document, focusing on events that would shape how people understand their world.

## STARTING LOCATION SUITABILITY

For each place, determine if it would be suitable as a starting location for a player character:

Starting locations can be any place.

- SUITABLE (isSuitableStart: true): Specific indoor/outdoor places:
  - Taverns, inns, guild halls, temples, shops (indoor)
  - Docks, marketplaces, town squares, specific districts (outdoor)
  - Small villages/hamlets where everyone could share a scene (outdoor)
  
- NOT SUITABLE (isSuitableStart: false):
  - Large-scale places: Cities, towns, large settlements, wilderness regions (players start in SPECIFIC local locations, not abstract areas)
  - Dangerous places: Dungeons, monster lairs, active battlefields
  - Inaccessible places: Secret hideouts, heavily guarded fortresses, underwater depths

Key rule: Large-scale places (cities, regions, wilderness) MUST have isSuitableStart: false.

Provide a 2-3 paragraph narrative summary of the document.

If the document doesn't contain certain elements, return empty arrays for those fields.`,
    prompt: `Extract world-building elements from this document:\n\n${content}`,
    complexity: 'orchestration',
    context: `Document Extraction: ${doc.filename}`,
    maxTokensOverride: 16384,
    schema: {
      name: 'document_extraction',
      schema: EXTRACTION_SCHEMA,
    },
  });

  const rawContent = result.content;
  const mappedPlaces: PlaceRef[] = rawContent.places.map((p) => ({
    ...p,
    environment: environmentFromPreset(p.environment),
  }));

  return { filename: doc.filename, ...rawContent, places: mappedPlaces };
}

/**
 * Consolidate multiple document extractions into a unified World Bible.
 */
async function consolidateExtractions(extractions: DocumentExtraction[]): Promise<WorldBible> {
  logger.info('DocumentProcessor', `Consolidating ${extractions.length} document extractions`);

  const extractionsSummary = extractions.map((e) => ({
    filename: e.filename,
    themes: e.themes,
    characters: e.characters.slice(0, 15),
    places: e.places.slice(0, 10),
    loreElements: e.loreElements.slice(0, 10),
    rules: e.rules.slice(0, 5),
    tone: e.tone,
    summary: e.summary,
    historicalFigures: e.historicalFigures.slice(0, 10),
    narrativePresent: e.narrativePresent,
    historicalEvents: e.historicalEvents.slice(0, 15),
  }));

  const result = await queryLlm<RawWorldBibleContent>({
    system: `You are a world-building consolidator. Merge multiple document extractions into a unified "World Bible".

## CRITICAL: OBJECTIVITY

Maintain an OMNISCIENT, NEUTRAL perspective throughout consolidation.
- When the same character appears differently across documents (due to different POVs), synthesize an OBJECTIVE description
- Remove value judgments ("evil", "heroic", "villain") - describe by actions and goals instead
- Present conflicts objectively, showing all sides' motivations

## TEMPORAL FILTERING

The "narrativePresent" values from each document tell you the "current time" in each source.
- Determine the LATEST narrativePresent across all documents - this becomes the world's current time
- ONLY include characters in the output who are ALIVE at this narrative present
- Characters with temporalStatus "historical" should NOT appear in the characters array
- Historical figures should be synthesized into "historicalLore" as background/lore

## CHARACTER NAMING CONVENTIONS

Ensure all character entries follow these conventions:
- **name**: Proper name ONLY - no titles, no nicknames (e.g., "Meiloria" not "Queen Meiloria")
- **title**: Rank or honorific (e.g., "Queen", "Lord", "Captain") - empty string if none
- **aliases**: Array of alternative names - nicknames, epithets, informal names

When merging characters, consolidate all aliases found across documents.

## PLACE NAMING CONVENTIONS

Places are SPACES you can be inside (rooms, buildings, areas). Exits are CONNECTION FEATURES (doors, gates, stairs).
When consolidating places, fix any names that sound like exits:
- BAD: "Barracks Door", "Stage Door 3", "Market Gate", "Tower Entrance"  
- GOOD: "The Barracks", "The Callsheet Hall", "Market Gatehouse", "Tower Entry Hall"
If a place is named like an exit, rename it to describe the space it represents.

## YOUR TASKS

1. **Determine narrativePresent**: Find the latest date/era across all documents
2. **Filter characters**: Only include contemporary characters (alive at narrative present)
3. **Deduplicate**: Merge similar characters and places (same name = same entity)
4. **Normalize names**: Ensure all character names follow the naming conventions above
5. **Reconcile objectively**: If contradictions exist due to POV bias, synthesize a neutral description
6. **Synthesize lore**: Combine lore elements into a coherent narrative
7. **Synthesize historicalLore**: Combine historical figures into a narrative about the world's history
8. **Identify themes**: Determine the overarching themes across all documents
9. **Find conflicts**: Identify major tensions, conflicts, or plot hooks (described objectively)
10. **Set tone**: Determine the overall tone and atmosphere
11. **Preserve starting suitability**: When merging places, preserve isSuitableStart=true if ANY source marked it as suitable
12. **Preserve place hierarchy**: When merging places, preserve purpose and parentName. Do NOT add a cosmos/universe-level place — the system determines the root. Top-level places use parentName "Cosmos" or "Root"; others use their parent's label. Use "planet" for continents/large regions too.
13. **Set place scale**: Determine if each place is 'local' or 'regional' based on description
14. **Consolidate historicalEvents**: Merge historical events from all documents (see below)

## HISTORICAL EVENTS CONSOLIDATION

Merge historical events from all document extractions:
- **Deduplicate**: Same event mentioned in multiple documents → keep most detailed version
- **Objective descriptions**: Ensure event facts are neutral and objective
- **Target count**: 10-20 total events
- **Scope mix**: Include 2-4 global, 4-8 regional, 4-8 local events
- **Prioritize significance**: Keep major events over minor ones when consolidating
- **Preserve relevance tags**: Merge relevantPlaces from duplicate events

## PLACE STARTING LOCATION

CRITICAL: Starting locations must be local-scale places where a character can PHYSICALLY BE.

For each consolidated place, set isSuitableStart based on environment and scale:
- Large-scale places (cities, towns, wilderness, regions): ALWAYS isSuitableStart: false
- Interior places (taverns, inns, guild halls): isSuitableStart: true if safe/accessible
- Exterior local places (docks, squares, small villages): isSuitableStart: true if safe/accessible

Set isSuitableStart to false for dangerous places (dungeons, monster lairs, battlefields) regardless of environment.

## PLACE ENVIRONMENT CLASSIFICATION (Genre-Agnostic)

Use the environment field to classify places. These rules work for fantasy, sci-fi, and modern settings:

- **"interior"**: Enclosed spaces sheltered from weather
  - Buildings: taverns, inns, temples, houses, shops, station quarters
  - Caves, dungeons, cellars, rooms, chambers
  
- **"exterior"**: Open spaces affected by weather
  - Docks, marketplaces, town squares, clearings, landing pads
  - Cities, towns, wilderness, roads, oceans
  
- **"space"**: Vacuum environments (cosmos, exterior of space stations)
  - Fantasy: cities, towns, settlements, castles, fortresses
  - Sci-Fi: space stations, starbases, starships, colonies, habitats, orbitals
  - Modern: cities, campuses, complexes
  - Characters can be at any place
  
- **"region"**: Large TRAVEL areas you move THROUGH (not reside in)
  - Fantasy: kingdoms, realms, empires, duchies
  - Sci-Fi: sectors, star systems, quadrants, nebulae
  - Modern: countries, nations, states, provinces
  - Natural: forests, deserts, oceans, wilderness, mountains, roads

CRITICAL DISTINCTION:
- **Settlements** are places you can be IN (city, town, station, ship)
- **Regions** are areas you TRAVEL THROUGH (kingdom contains cities, sector contains stations)

Political/geographic units (kingdoms, countries, sectors, systems) are ALWAYS regions.

The result should feel like a cohesive, objective world bible that could be used to create a role-playing game universe where players could choose to play characters from any faction.`,
    prompt: `Consolidate these document extractions into a unified World Bible:\n\n${JSON.stringify(extractionsSummary, null, 2)}`,
    complexity: 'orchestration',
    context: 'World Bible Consolidation',
    maxTokensOverride: 16384,
    schema: {
      name: 'world_bible',
      schema: WORLD_BIBLE_SCHEMA,
    },
  });

  const rawBible = result.content;
  const mappedPlaces: WorldBiblePlaceRef[] = rawBible.places.map((p) => ({
    ...p,
    environment: environmentFromPreset(p.environment),
  }));

  return { ...rawBible, places: mappedPlaces };
}

/**
 * Generate clarification questions for uncertain elements in the World Bible.
 * This includes:
 * - Characters with uncertain temporal status
 * - Places with ambiguous classification
 *
 * @param worldBible - The consolidated World Bible
 * @param universeId - Universe ID for storing questions
 * @returns Array of created question IDs
 */
export async function generateWorldBibleClarifications(
  worldBible: WorldBible,
  universeId: string,
): Promise<string[]> {
  const questions: ClarificationQuestion[] = [];

  for (const character of worldBible.characters) {
    if (character.temporalStatus === 'uncertain') {
      const question = createTemporalStatusQuestion(character);
      questions.push(question);
    }
  }

  if (questions.length > 0) {
    await addQuestions(universeId, questions);
    logger.info(
      'DocumentProcessor',
      `Created ${questions.length} clarification questions for ${universeId}`,
    );
  }

  return questions.map((q) => q.id);
}

/** Number of documents to process concurrently */
const EXTRACTION_BATCH_SIZE = 8;

/**
 * Process documents through the extraction and consolidation pipeline.
 * Returns a unified World Bible for universe generation.
 * Documents are extracted in parallel batches for improved performance.
 *
 * @param documents - Parsed documents to process
 * @param universeId - Optional universe ID for storing clarification questions
 */
export async function processDocuments(
  documents: ParsedDocument[],
  universeId?: string,
): Promise<WorldBible> {
  logger.info('DocumentProcessor', `Processing ${documents.length} documents`);

  const extractions: DocumentExtraction[] = [];

  for (let i = 0; i < documents.length; i += EXTRACTION_BATCH_SIZE) {
    const batch = documents.slice(i, i + EXTRACTION_BATCH_SIZE);
    const batchNum = Math.floor(i / EXTRACTION_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(documents.length / EXTRACTION_BATCH_SIZE);

    logger.info(
      'DocumentProcessor',
      `Processing batch ${batchNum}/${totalBatches} (${batch.length} documents)`,
    );

    const results = await Promise.all(
      batch.map((doc) =>
        extractFromDocument(doc).catch((error) => {
          logger.error('DocumentProcessor', `Failed to extract from ${doc.filename}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
      ),
    );

    extractions.push(...results.filter((r): r is DocumentExtraction => r !== null));
  }

  if (extractions.length === 0) {
    throw new Error('No documents could be processed');
  }

  const worldBible = await consolidateExtractions(extractions);

  logger.info(
    'DocumentProcessor',
    `Created World Bible with ${worldBible.characters.length} characters, ${worldBible.places.length} places`,
  );

  if (universeId) {
    await generateWorldBibleClarifications(worldBible, universeId);
  }

  return worldBible;
}
