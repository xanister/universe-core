/**
 * Template Character Builder
 *
 * Builds a character entity from a template (no upsert, no media).
 * Used by character-generator when options.templateId is set.
 * No dependency on character-generator to avoid circular dependency.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
// Note: Uses ctx.deleteEntity directly instead of deleteEntityWithCleanup
// since we're rebuilding the character (no need for relationship cleanup).
import type { Character, CharacterInfo, Universe, Fact, UniverseEvent } from '@dmnpc/types/entity';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';
import { generateEventId } from '@dmnpc/core/universe/universe-store.js';
import { generateEntityId } from '../id-generator.js';
import { getTemplateCharacter } from '@dmnpc/core/stores/template-character-store.js';
import { findRaceOrFallback, resolveAutoGenOverlayLayers } from './character-sprite-helper.js';
import {
  getSpriteArchetype,
  resolveHeadType,
  loadSpriteArchetypes,
  loadCharacterBasesManifest,
} from '@dmnpc/sprites';
import { LPC_SPRITES_DIR } from '@dmnpc/data';
import type { MergedCharacterDefinition } from '../document/template-document-merger.js';

/** Ensure archetypes are loaded */
let _archetypesLoaded = false;
function ensureArchetypesLoaded(): void {
  if (!_archetypesLoaded) {
    loadCharacterBasesManifest(LPC_SPRITES_DIR);
    loadSpriteArchetypes(LPC_SPRITES_DIR);
    _archetypesLoaded = true;
  }
}

/** Resolve head type from race and gender via archetype lookup */
function resolveHeadTypeFromRace(raceId: string, gender: string, ctx: UniverseContext): string {
  ensureArchetypesLoaded();
  const raceDef = findRaceOrFallback(ctx.universe.races, raceId);
  const archetypeId = raceDef.spriteHints?.spriteArchetype ?? 'human';
  const archetype = getSpriteArchetype(archetypeId);
  if (archetype) return resolveHeadType(archetype, gender);
  return gender.toLowerCase().includes('female') ? 'human_female' : 'human_male';
}

export interface BuildCharacterFromTemplateParams {
  templateId: string;
  guidance?: string;
  mergedDef?: MergedCharacterDefinition;
}

function mapRaceToUniverse(
  template: TemplateCharacterDefinition,
  universe: Universe,
): string | undefined {
  const races = universe.races;
  if (races.length === 0) return undefined;

  if (template.physicalTraits.race) {
    const exactMatch = races.find(
      (r) => r.id.toLowerCase() === template.physicalTraits.race?.toLowerCase(),
    );
    if (exactMatch) return exactMatch.id;
  }

  const hint = template.physicalTraits.raceAdaptation?.toLowerCase() || 'human-like';

  const hintMappings: Record<string, string[]> = {
    'human-like': ['human', 'terran', 'earthling', 'mundane'],
    elvish: ['elf', 'elven', 'high_elf', 'wood_elf', 'fae'],
    dwarven: ['dwarf', 'dwarven', 'stout'],
    orcish: ['orc', 'orcish', 'half_orc'],
    robotic: ['android', 'robot', 'synthetic', 'cyborg', 'automaton'],
    alien: ['alien', 'xeno', 'extraterrestrial'],
  };

  const candidates = hintMappings[hint] ?? hintMappings['human-like'];

  for (const candidate of candidates) {
    const match = races.find(
      (r) => r.id.toLowerCase().includes(candidate) || r.label.toLowerCase().includes(candidate),
    );
    if (match) return match.id;
  }

  const commonRace = races.find((r) => r.rarity === 'common');
  if (commonRace) return commonRace.id;

  return races[0]?.id;
}

function resolveGuidedRace(universe: Universe, guidance: string): string | undefined {
  const races = universe.races;
  if (!guidance.trim() || races.length === 0) return undefined;

  const normalized = guidance.toLowerCase();
  const sortedRaces = [...races].sort((a, b) => b.label.length - a.label.length);

  for (const race of sortedRaces) {
    const raceId = race.id.toLowerCase();
    const raceLabel = race.label.toLowerCase();
    if (normalized.includes(raceId) || normalized.includes(raceLabel)) {
      return race.id;
    }
  }

  return undefined;
}

async function adaptKeyEvents(
  events: Fact[],
  universe: Universe,
  characterName: string,
  guidance?: string,
): Promise<UniverseEvent[]> {
  if (events.length === 0) return [];

  const guidanceLine = guidance?.trim() ? `\nAdditional guidance: ${guidance.trim()}` : '';

  const systemPrompt = `You are adapting character backstory events to fit a new universe's style and tone.

Universe: ${universe.name}
Tone: ${universe.tone || 'neutral'}
Rules: ${universe.rules || 'none specified'}
${guidanceLine}

Rephrase each event to fit this universe while preserving:
- The core meaning and significance of the event
- The emotional impact
- The character's role in the event

Adapt terminology, locations, and cultural references to feel native to this universe.`;

  const userPrompt = `Adapt these backstory events for ${characterName}:

${events.map((e, i) => `${i + 1}. ${e.fact} (${e.category}, ${e.significance})`).join('\n')}

Return the adapted events in the same order.`;

  interface AdaptedEvent {
    fact: string;
    category: 'world' | 'relationship' | 'knowledge' | 'constraint';
    significance: 'minor' | 'moderate' | 'major';
  }

  try {
    const result = await queryLlm<{ events: AdaptedEvent[] }>({
      system: systemPrompt,
      prompt: userPrompt,
      complexity: 'simple',
      context: 'Key Events Adaptation',
      maxTokensOverride: 2048,
      schema: {
        name: 'adapted_events',
        schema: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fact: { type: 'string' },
                  category: {
                    type: 'string',
                    enum: ['world', 'relationship', 'knowledge', 'constraint'],
                  },
                  significance: {
                    type: 'string',
                    enum: ['minor', 'moderate', 'major'],
                  },
                },
                required: ['fact', 'category', 'significance'],
                additionalProperties: false,
              },
            },
          },
          required: ['events'],
          additionalProperties: false,
        },
      },
    });

    return result.content.events.map((adapted, i) => ({
      id: generateEventId(adapted.fact),
      ...events[i],
      fact: adapted.fact,
      category: adapted.category,
      significance: adapted.significance,
      date: null,
      placeId: null,
      eventType: null,
      subjectId: null,
      witnessIds: null,
      importanceScore: null,
      scope: null,
      relevantPlaceIds: null,
      important: true,
    }));
  } catch (error) {
    logger.warn(
      'Template Character Builder',
      `Failed to adapt key events, using originals: ${error instanceof Error ? error.message : String(error)}`,
    );
    return events.map((e) => ({
      id: generateEventId(e.fact),
      ...e,
      date: null,
      placeId: null,
      eventType: null,
      subjectId: null,
      witnessIds: null,
      importanceScore: null,
      scope: null,
      relevantPlaceIds: null,
      important: true,
    }));
  }
}

interface GuidedDescriptionResponse {
  description: string;
  shortDescription: string;
}

const GUIDED_DESCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    description: {
      type: 'string',
      description:
        'Enhanced character description that respects the template and guidance, in the universe tone.',
    },
    shortDescription: {
      type: 'string',
      description: 'Brief 3-5 word description for unknown-name references.',
    },
  },
  required: ['description', 'shortDescription'],
  additionalProperties: false,
};

async function adaptDescriptionWithGuidance(params: {
  template: TemplateCharacterDefinition;
  universe: Universe;
  baseDescription: string;
  baseShortDescription: string;
  guidance: string;
}): Promise<GuidedDescriptionResponse> {
  const { template, universe, baseDescription, baseShortDescription, guidance } = params;

  const systemPrompt = `You are refining a template character for a specific universe.

Preserve the template's physical traits and core personality.
Incorporate the user's guidance to make the character feel native to this universe.

Universe: ${universe.name}
Tone: ${universe.tone || 'neutral'}
Rules: ${universe.rules || 'none specified'}`;

  const userPrompt = `Template Name: ${template.label}
Template Personality: ${template.personality}
Template Physical Traits: ${JSON.stringify(template.physicalTraits)}

Base Description: ${baseDescription}
Base Short Description: ${baseShortDescription}

Guidance: ${guidance}

Return an updated description and short description that integrate the guidance without contradicting the template.`;

  const result = await queryLlm<GuidedDescriptionResponse>({
    system: systemPrompt,
    prompt: userPrompt,
    complexity: 'reasoning',
    context: 'Template Guidance Adaptation',
    maxTokensOverride: 2048,
    schema: {
      name: 'guided_description',
      schema: GUIDED_DESCRIPTION_SCHEMA,
    },
  });

  return {
    description: result.content.description,
    shortDescription: result.content.shortDescription,
  };
}

/**
 * Builds a character entity from a template. Does not upsert or generate media.
 * Caller is responsible for ctx.upsertEntity and portrait/sprite generation.
 */
export async function buildCharacterFromTemplate(
  ctx: UniverseContext,
  { templateId, mergedDef, guidance }: BuildCharacterFromTemplateParams,
): Promise<Character> {
  const universe = ctx.universe;
  logger.info(
    'Template Character Builder',
    `Building character from template: templateId=${templateId} universeId=${universe.id}${mergedDef ? ' (with merged document context)' : ''}`,
  );

  if (guidance?.trim()) {
    logger.info(
      'Template Character Builder',
      `Applying template guidance: templateId=${templateId} length=${guidance.trim().length}`,
    );
  }

  const template = mergedDef?.template ?? (await getTemplateCharacter(templateId));
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const guidedRace = guidance ? resolveGuidedRace(universe, guidance) : undefined;
  const mappedRace = guidedRace ?? mapRaceToUniverse(template, universe);

  if (guidedRace) {
    logger.info(
      'Template Character Builder',
      `Guidance selected race: templateId=${templateId} raceId=${guidedRace}`,
    );
  }

  const templateEvents = template.keyEvents
    ? await adaptKeyEvents(template.keyEvents, universe, template.label, guidance)
    : [];

  const additionalEvents: UniverseEvent[] = (mergedDef?.additionalEvents ?? []).map((e) => ({
    id: generateEventId(e.fact),
    date: null,
    placeId: null,
    eventType: null,
    fact: e.fact,
    category: e.category,
    subject: e.subject,
    subjectId: null,
    significance: e.significance,
    important: true,
    witnessIds: null,
    importanceScore: null,
    scope: null,
    relevantPlaceIds: null,
  }));

  const allEvents = [...templateEvents, ...additionalEvents];

  for (const event of allEvents) {
    ctx.upsertEvent(event);
  }

  const existingCharacter = ctx.characters.find(
    (character) => character.label.toLowerCase() === template.label.toLowerCase(),
  );
  if (existingCharacter) {
    logger.info(
      'Template Character Builder',
      `Deleting existing character before template build: characterId=${existingCharacter.id}`,
    );
    ctx.deleteEntity('character', existingCharacter.id);
  }

  const gender = template.physicalTraits.gender;
  const characterInfo: CharacterInfo = {
    purpose: 'player',
    aliases: [],
    birthdate: 'Unknown',
    deathdate: null,
    title: null,
    birthPlace: 'Unknown',
    eyeColor: template.physicalTraits.eyeColor,
    gender,
    hairColor: template.physicalTraits.hairColor,
    hairStyle: template.physicalTraits.hairStyle,
    beardStyle: template.physicalTraits.beardStyle ?? null,
    headType: resolveHeadTypeFromRace(
      mappedRace || template.physicalTraits.race || 'Unknown',
      gender,
      ctx,
    ),
    skinTone: template.physicalTraits.skinTone,
    personality: template.personality,
    race: mappedRace || template.physicalTraits.race || 'Unknown',
    messages: [],
    journal: [],
    sketches: [],
    verbosity: template.verbosity,
    voiceId: template.voiceId,
    conversationContext: null,
    storytellerState: null,
    isPlayer: true,
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
    spriteConfig: {
      bodyType: gender.toLowerCase().includes('female') ? 'female' : 'male',
      layers: [],
      spriteHash: null,
      spriteUrl: null,
      spriteScale: 1,
    },
    clothing: [],
    enabledOverlayLayers: resolveAutoGenOverlayLayers(
      findRaceOrFallback(
        ctx.universe.races,
        mappedRace || template.physicalTraits.race || 'Unknown',
      ),
    ),
    helmingVesselId: null,
    storytellerDisabled: false,
    rulesetState: {
      stats: {},
      conditions: [],
      statUsage: {},
      incapacitation: null,
      incapacitatedSince: null,
    },
  };

  const characterId = generateEntityId(ctx, template.label, 'character');

  const baseDescription = mergedDef?.enhancedDescription ?? template.description;
  const baseShortDescription = mergedDef?.enhancedShortDescription ?? template.short_description;
  let description = baseDescription;
  let shortDescription = baseShortDescription;

  if (guidance?.trim()) {
    const guided = await adaptDescriptionWithGuidance({
      template,
      universe,
      baseDescription,
      baseShortDescription,
      guidance: guidance.trim(),
    });
    description = guided.description;
    shortDescription = guided.shortDescription;
  }

  const character: Character = {
    id: characterId,
    label: template.label,
    description,
    short_description: shortDescription,
    tags: [],
    entityType: 'character',
    info: characterInfo,
    position: {
      x: 0,
      y: 0,
      width: 32,
      height: 48,
      parent: null,
    },
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
    important: true,
  };

  return character;
}
