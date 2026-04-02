/**
 * LLM-Based Repairs
 *
 * Generate missing content using LLM:
 * - Infer race from description
 * - Generate missing personality, birthPlace, etc.
 * - Generate missing descriptions for places/exits
 * - Generate missing routines for NPCs
 */

import type { BaseEntity, Character, Place } from '@dmnpc/types/entity';
import type { DistanceUnit } from '@dmnpc/types';
import { DISTANCE_UNITS } from '@dmnpc/types';
import { ENVIRONMENT_PRESET_NAMES, environmentFromPreset } from '@dmnpc/types/world';
import type { ValidationContext } from '../integrity-types.js';
import type { ValidationIssue } from '../integrity-types.js';
import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { isRecord } from '@dmnpc/core/entities/type-guards.js';
import { getNestedValue, setNestedValue } from '@dmnpc/core/entities/nested-access.js';
import { getPlaceInnerDimensions } from '@dmnpc/core/entities/position-utils.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { repairPlaceLabel } from '../validators/place-label.js';
import { generateCharacterRoutine } from '@dmnpc/generation/narrative/routine-generator.js';
import { validateAndComplete, findCosmos } from '@dmnpc/generation/universe-validator.js';
import { generateExitObject } from '@dmnpc/generation/object-generator.js';
import { generatePlace, DEFAULT_CREATION_HINT } from '@dmnpc/generation/place-generator.js';
import { isCharacter, isPlace } from '@dmnpc/core/entities/type-guards.js';
import { isVessel } from '@dmnpc/core/entities/vessel-utils.js';
import { populateSlotCharacters } from '@dmnpc/generation/character/slot-character-populator.js';

/**
 * Type guard for DistanceUnit values.
 */
function isDistanceUnit(value: string): value is DistanceUnit {
  return (DISTANCE_UNITS as readonly string[]).includes(value);
}

/**
 * Apply an LLM-based repair to an entity.
 * Returns true if the repair was applied, false otherwise.
 */
export async function applyLlmRepair(
  entity: BaseEntity,
  issue: ValidationIssue,
  ctx: ValidationContext,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  if (!issue.suggestedFix || issue.suggestedFix.method !== 'llm') {
    return false;
  }

  const { field } = issue.suggestedFix;

  // Special handling for parent chain repair (builds missing chain to cosmos)
  if (
    field === 'position.parent' &&
    issue.validatorId === 'parent-chain' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairParentChain(entity, universeCtx);
  }

  // Special handling for routine generation
  if (field === 'info.routine' && entity.id.startsWith('CHAR_') && isCharacter(entity)) {
    return await generateRoutineForCharacter(entity, universeCtx);
  }

  // Special handling for parent-exit (generate exit to parent)
  if (
    field === 'exits' &&
    issue.validatorId === 'parent-exit' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairParentExit(entity, ctx, universeCtx);
  }

  // Special handling for place label (improve generic region names)
  if (
    field === 'label' &&
    issue.validatorId === 'place-label' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairPlaceLabel(entity, ctx, universeCtx);
  }

  // Special handling for missing character position
  if (
    field === 'position' &&
    issue.validatorId === 'missing-fields' &&
    entity.id.startsWith('CHAR_') &&
    isCharacter(entity)
  ) {
    return await repairCharacterPosition(entity, ctx, universeCtx);
  }

  // Special handling for missing place position
  if (
    field === 'position' &&
    issue.validatorId === 'missing-fields' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairPlacePosition(entity, ctx, universeCtx);
  }

  // Special handling for place-kind inference
  if (
    field === 'info.environment' &&
    issue.validatorId === 'place-kind' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairPlaceEnvironment(entity, ctx, universeCtx);
  }

  // Special handling for region scale repair
  if (
    field === 'info.scale' &&
    issue.validatorId === 'region-scale' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairRegionScale(entity, ctx, universeCtx);
  }

  // Special handling for empty place - generate child places
  if (
    field === 'children' &&
    issue.validatorId === 'place-kind' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairEmptyLocationGroup(entity, ctx, universeCtx);
  }

  // Special handling for vessel crew repair
  if (
    (field === 'crew' || field === 'info.tags') &&
    issue.validatorId === 'vessel-crew-consistency' &&
    entity.id.startsWith('PLACE_') &&
    isPlace(entity)
  ) {
    return await repairVesselCrew(entity, ctx, universeCtx);
  }

  // Special handling for position.parent fixes (location-consistency, orphaned-refs)
  if (
    field === 'position.parent' &&
    (issue.validatorId === 'location-consistency' || issue.validatorId === 'orphaned-refs')
  ) {
    if (entity.id.startsWith('CHAR_') && isCharacter(entity)) {
      return await repairCharacterPosition(entity, ctx, universeCtx);
    }
    if (entity.id.startsWith('PLACE_') && isPlace(entity)) {
      return await repairPlacePosition(entity, ctx, universeCtx);
    }
  }

  try {
    const generatedValue = await generateFieldValue(entity, field, ctx);

    if (generatedValue === null || generatedValue === undefined) {
      logger.error(
        'IntegrityRepair',
        `LLM repair returned no value for ${entity.id} field ${field}`,
      );
      return false;
    }

    if (!isRecord(entity)) {
      return false;
    }

    // Validate the generated value if it's a race
    if (
      field === 'info.race' &&
      typeof generatedValue === 'string' &&
      !ctx.validRaceIds.has(generatedValue)
    ) {
      logger.error(
        'IntegrityRepair',
        `LLM generated invalid race for ${entity.id}: "${JSON.stringify(generatedValue)}" is not a valid race ID`,
      );
      return false;
    }

    const oldValue = getNestedValue(entity, field);
    setNestedValue(entity, field, generatedValue);

    logger.info(
      'IntegrityRepair',
      `Applied LLM repair for ${entity.id}: ${field} changed from "${String(oldValue)}" to "${JSON.stringify(generatedValue)}"`,
    );

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', 'Failed to apply LLM repair', {
      entityId: entity.id,
      field,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Generate a value for a missing field using LLM.
 */
async function generateFieldValue(
  entity: BaseEntity,
  field: string,
  ctx: ValidationContext,
): Promise<unknown> {
  const entityType = entity.id.startsWith('CHAR_')
    ? 'character'
    : entity.id.startsWith('PLACE_')
      ? 'place'
      : 'object';

  const entityContext = buildEntityContext(entity, entityType);
  const universeContext = buildUniverseContext(ctx);

  const prompt = buildFieldPrompt(field, entityContext, universeContext, ctx);

  try {
    const result = await queryLlm<{ value: string }>({
      system: `You are a data repair assistant. Generate a single missing field value that is consistent with the existing entity data. Be concise and consistent with the entity's established characteristics. Output only the requested value.`,
      prompt,
      complexity: 'simple',
      context: 'IntegrityRepair',
      schema: {
        name: 'field_value',
        schema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
          additionalProperties: false,
        },
      },
    });

    return result.content.value;
  } catch (error) {
    logger.error('IntegrityRepair', 'LLM query failed', {
      entityId: entity.id,
      field,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Build context string for the entity.
 */
function buildEntityContext(entity: BaseEntity, entityType: string): string {
  const lines: string[] = [`Entity Type: ${entityType}`, `Label: ${entity.label}`];

  if (entity.description) {
    lines.push(`Description: ${entity.description}`);
  }

  if (entity.tags.length > 0) {
    lines.push(`Tags: ${entity.tags.join(', ')}`);
  }

  if (entityType === 'character' && isCharacter(entity)) {
    if (entity.info.gender) lines.push(`Gender: ${entity.info.gender}`);
    if (entity.info.race) lines.push(`Race: ${entity.info.race}`);
    if (entity.info.personality) lines.push(`Personality: ${entity.info.personality}`);
  }

  return lines.join('\n');
}

/**
 * Build universe context string.
 */
function buildUniverseContext(ctx: ValidationContext): string {
  const lines: string[] = [`Universe: ${ctx.universe.name || 'Unknown'}`];

  if (ctx.universe.tone) {
    lines.push(`Tone: ${ctx.universe.tone}`);
  }

  if (ctx.universe.races.length > 0) {
    const raceList = ctx.universe.races.map((r) => `${r.id} (${r.label})`).join(', ');
    lines.push(`Available Races: ${raceList}`);
  }

  return lines.join('\n');
}

/**
 * Build the prompt for generating a specific field.
 */
function buildFieldPrompt(
  field: string,
  entityContext: string,
  universeContext: string,
  ctx: ValidationContext,
): string {
  const fieldName = field.split('.').pop() || field;

  let instructions = '';
  switch (fieldName) {
    case 'race': {
      const raceIds = Array.from(ctx.validRaceIds).join(', ');
      instructions = `Generate a race ID for this character. MUST be one of: ${raceIds}. Infer from the description.`;
      break;
    }
    case 'birthdate':
      instructions =
        'Generate a plausible birthdate for this character. Use the format from the universe calendar if known.';
      break;
    case 'birthPlace':
      instructions =
        'Generate a plausible birthplace for this character. Can be a specific location or region.';
      break;
    case 'eyeColor':
      instructions =
        'Generate an eye color for this character. Infer from description if possible, otherwise choose something fitting.';
      break;
    case 'gender':
      instructions =
        'Generate a gender for this character. Infer from description, pronouns, or name.';
      break;
    case 'hairColor':
      instructions =
        'Generate a hair color for this character. Infer from description if possible.';
      break;
    case 'personality':
      instructions = 'Generate a brief personality description for this character (1-2 sentences).';
      break;
    case 'description':
      instructions = 'Generate a description for this entity (2-3 sentences).';
      break;
    case 'short_description':
      instructions = `Generate a very brief description (under 30 characters) for this entity.
For characters: MUST include gender. VISIBLE professions evident from clothing/equipment are PREFERRED (e.g., "uniformed guard", "aproned bartender", "robed clerk").
NEVER include: (1) HIDDEN professions requiring knowledge to identify (thief, spy, assassin, smuggler, con artist), (2) personality traits (procedural, methodical, cheerful, stern, keen, harried), (3) meta-terms describing behavior rather than appearance.
Focus on PHYSICAL APPEARANCE only - what someone would see at a glance.`;
      break;
    case 'exitType':
      instructions =
        'Generate an exit type for this exit (e.g., "door", "stairs", "path", "gate").';
      break;
    case 'environment':
      instructions = `Generate an environment preset name for this place. Must be one of: ${ENVIRONMENT_PRESET_NAMES.join(', ')}. Infer from the description and context.`;
      break;
    default:
      instructions = `Generate a value for the "${fieldName}" field.`;
  }

  return `${universeContext}\n\n${entityContext}\n\n${instructions}`;
}

/**
 * Generate a routine for a character using the routine generator.
 */
async function generateRoutineForCharacter(
  character: Character,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    const routine = await generateCharacterRoutine(universeCtx, {
      universeId: universeCtx.universeId,
      characterId: character.id,
    });

    // Update the entity object passed to us (repair system handles persistence)
    character.info.routine = routine;
    logger.info(
      'IntegrityRepair',
      `Generated routine for ${character.id}: hasWork=${!!routine.work}, variance=${routine.variance}`,
    );
    return true;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to generate routine for ${character.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Repair a broken/incomplete parent chain for a place using template validation.
 * Uses validateAndComplete to generate any missing places.
 */
async function repairParentChain(
  place: Place,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    logger.info('IntegrityRepair', `Validating and completing place ${place.id}`);

    const cosmos = findCosmos(universeCtx);
    if (!cosmos) {
      logger.error('IntegrityRepair', `No cosmos found in universe`);
      return false;
    }

    const result = await validateAndComplete(universeCtx, cosmos.id, {
      generate: true,
      maxDepth: 5,
    });

    if (result.errors.length === 0) {
      logger.info(
        'IntegrityRepair',
        `Successfully validated place hierarchy: ${result.placesGenerated} places generated`,
      );
      return true;
    } else {
      logger.error('IntegrityRepair', `Validation completed with errors for ${place.id}`, {
        errors: result.errors,
        placesGenerated: result.placesGenerated,
      });
      return result.placesGenerated > 0; // Partial success if some places generated
    }
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to repair parent chain for ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Repair a character's missing or invalid position by determining parent from context.
 * Characters can be at any place.
 */
async function repairCharacterPosition(
  character: Character,
  ctx: ValidationContext,
  _universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    const allPlaces = Array.from(ctx.places.values());

    const currentParentId = character.position.parent;
    if (currentParentId && ctx.places.get(currentParentId)) {
      // Character is at a valid place - no repair needed
      return true;
    }

    // Character has no position or orphaned reference - use LLM to determine appropriate parent

    const schema = {
      type: 'object',
      properties: {
        parentPlaceId: {
          type: 'string',
          description: 'ID of the place where this character should be located',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of why this place was chosen',
        },
      },
      required: ['parentPlaceId', 'reasoning'],
      additionalProperties: false,
    };

    // Include all places (characters can be at any place)
    const placesContext = allPlaces
      .slice(0, 20)
      .map(
        (p) =>
          `- ${p.label} (${p.id}): ${p.short_description || p.description.substring(0, 100) || 'No description'}`,
      )
      .join('\n');

    const prompt = `A character "${character.label}" is missing a position (parent place).

Character Description: ${character.description || 'No description available'}
Character Info: ${JSON.stringify(character.info, null, 2)}

Available Places:
${placesContext}

Determine the most appropriate place where this character should be located based on:
1. Character description and background
2. Character's role or purpose
3. Logical location based on the character's characteristics

Note: Characters can be at any place.

Return the place ID where this character should be positioned.`;

    const result = await queryLlm<{
      parentPlaceId: string;
      reasoning: string;
    }>({
      system: `You are a world-building assistant. Determine appropriate locations for characters based on their descriptions and the available places in the universe. Only select from the provided list of valid places.`,
      prompt,
      complexity: 'reasoning',
      context: 'IntegrityRepair',
      schema: {
        name: 'character_position',
        schema,
      },
    });

    const { parentPlaceId, reasoning } = result.content;

    const parentPlace = ctx.places.get(parentPlaceId);
    if (!parentPlace) {
      logger.error(
        'IntegrityRepair',
        `Parent place ${parentPlaceId} not found for character ${character.id}`,
      );
      return false;
    }

    const parentSize = getPlaceInnerDimensions(parentPlace);
    character.position = {
      parent: parentPlaceId,
      x: parentSize.width / 2,
      y: parentSize.height / 2,
      width: 32,
      height: 48,
    };

    logger.info(
      'IntegrityRepair',
      `Repaired character position for ${character.id}: ${parentPlaceId} (${reasoning})`,
    );

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to repair character position for ${character.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Repair a place's missing position by determining parent from hierarchy context.
 */
async function repairPlacePosition(
  place: Place,
  ctx: ValidationContext,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    // Find cosmos as fallback parent
    const cosmos = findCosmos(universeCtx);
    if (!cosmos) {
      logger.error('IntegrityRepair', `No cosmos found in universe`);
      return false;
    }

    const schema = {
      type: 'object',
      properties: {
        parentPlaceId: {
          type: 'string',
          description: 'ID of the parent place in the hierarchy',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of why this parent was chosen',
        },
      },
      required: ['parentPlaceId', 'reasoning'],
      additionalProperties: false,
    };

    const placesContext = Array.from(ctx.places.values())
      .slice(0, 20)
      .map(
        (p) =>
          `- ${p.label} (${p.id}): ${p.short_description || p.description.substring(0, 100) || 'No description'}`,
      )
      .join('\n');

    const prompt = `A place "${place.label}" is missing a position (parent place in the hierarchy).

Place Description: ${place.description || 'No description available'}
Environment: ${place.info.environment.type}

Available Places:
${placesContext}

Determine the most appropriate parent place for this place in the hierarchy based on:
1. Place description and purpose
2. Place environment (interior/exterior/space/underwater) and scale
3. Logical hierarchy relationships

Return the place ID that should be the parent of this place. Default to cosmos if no better parent exists.`;

    const result = await queryLlm<{
      parentPlaceId: string;
      reasoning: string;
    }>({
      system: `You are a world-building assistant. Determine appropriate parent places in the hierarchy based on place descriptions and logical spatial relationships.`,
      prompt,
      complexity: 'reasoning', // Use 'reasoning' tier for reliable structured outputs
      context: 'IntegrityRepair',
      schema: {
        name: 'place_position',
        schema,
      },
    });

    const { parentPlaceId, reasoning } = result.content;

    let parentId = parentPlaceId;
    if (!ctx.places.has(parentPlaceId)) {
      logger.warn(
        'IntegrityRepair',
        `Parent place ${parentPlaceId} not found for place ${place.id}, defaulting to cosmos`,
      );
      parentId = 'PLACE_the_cosmos';
    }

    const resolvedParent = ctx.places.get(parentId);
    if (!resolvedParent) {
      logger.error(
        'IntegrityRepair',
        `Resolved parent ${parentId} not found for place ${place.id}`,
      );
      return false;
    }
    const parentSize = getPlaceInnerDimensions(resolvedParent);
    place.position = {
      ...place.position,
      parent: parentId,
      x: parentSize.width / 2,
      y: parentSize.height / 2,
      width: place.position.width,
      height: place.position.height,
    };

    logger.info(
      'IntegrityRepair',
      `Repaired place position for ${place.id}: ${parentId} (${reasoning})`,
    );

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to repair place position for ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Repair a place's missing environment by inferring from description using LLM.
 */
async function repairPlaceEnvironment(
  place: Place,
  _ctx: ValidationContext,
  _universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    const schema = {
      type: 'object',
      properties: {
        environment: {
          type: 'string',
          enum: ENVIRONMENT_PRESET_NAMES,
          description: 'The inferred environment for this place',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of why this environment was chosen',
        },
      },
      required: ['environment', 'reasoning'],
      additionalProperties: false,
    };

    const placeSizeDesc = (() => {
      const d = getPlaceInnerDimensions(place);
      return d.width > 0 && d.height > 0 ? `${d.width}x${d.height}` : 'Not specified';
    })();
    const prompt = `A place "${place.label}" needs its environment field determined.

Place Description: ${place.description || 'No description available'}
Place Short Description: ${place.short_description || 'No short description'}
Place Tags: ${place.tags.join(', ')}
Place Size: ${placeSizeDesc}
Place Scale: ${place.info.scale}

Determine the appropriate environment for this place. Valid values are:
- interior: Enclosed space sheltered from weather (rooms, cabins, cargo holds, engine rooms, taverns, caves, dungeons, ship interiors, bridges)
- exterior: Open space affected by weather (courtyards, plazas, fields, ship decks, weatherdecks, landing pads, docks, cities, wilderness)
- space: Vacuum environment (cosmos, space between stars, exterior of space stations)
- underwater: Submerged environment (ocean floor, underwater caves)

Consider the atmosphere/weather context: Is the place enclosed (interior) or open to elements (exterior)?`;

    const result = await queryLlm<{
      environment: string;
      reasoning: string;
    }>({
      system: `You are a world-building assistant. Classify places by their environment type for weather effects. Interior places are sheltered, exterior places are open to weather, space is vacuum, underwater is submerged.`,
      prompt,
      complexity: 'simple',
      context: 'IntegrityRepair',
      schema: {
        name: 'place_environment',
        schema,
      },
    });

    const { environment, reasoning } = result.content;

    if (!(ENVIRONMENT_PRESET_NAMES as readonly string[]).includes(environment)) {
      logger.error(
        'IntegrityRepair',
        `LLM generated invalid environment for ${place.id}: "${environment}"`,
      );
      return false;
    }

    place.info.environment = environmentFromPreset(environment);

    logger.info(
      'IntegrityRepair',
      `Repaired environment for ${place.id}: ${environment} (${reasoning})`,
    );

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to repair environment for ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Repair a region's scale using LLM to determine the appropriate distance unit.
 */
async function repairRegionScale(
  place: Place,
  ctx: ValidationContext,
  _universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    // Get parent place for context
    const parentPlace = place.position.parent ? ctx.places.get(place.position.parent) : null;

    const schema = {
      type: 'object',
      properties: {
        scale: {
          type: 'string',
          enum: ['feet', 'meters', 'miles', 'kilometers', 'au', 'lightyears'],
          description: 'The appropriate distance scale for this region',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of why this scale was chosen',
        },
      },
      required: ['scale', 'reasoning'],
      additionalProperties: false,
    };

    const prompt = `A region "${place.label}" needs its distance scale verified/determined.

Current Scale: ${place.info.scale}
Place Description: ${place.description}
Place Short Description: ${place.short_description}
Place Environment: ${place.info.environment.type}
Place Tags: ${place.tags.join(', ')}
Parent Place: ${parentPlace?.label || 'None'} (scale: ${parentPlace?.info.scale || 'unknown'})

Determine the appropriate distance scale for this region:
- feet: Indoor spaces, small outdoor areas (rooms, buildings, courtyards)
- meters: Metric alternative to feet
- miles: Regions, wilderness, seas, countries, continents (MOST terrestrial regions)
- kilometers: Metric alternative to miles
- au: Astronomical units - solar system scale (distance between planets)
- lightyears: Interstellar/galactic scale (distance between stars, galaxies)

IMPORTANT:
- Maritime regions (straits, seas, oceans, harbors) should use 'miles', NOT cosmic scales
- Planetary regions, countries, continents should use 'miles' or 'kilometers'
- Only use 'au' for actual solar system distances
- Only use 'lightyears' for interstellar/galactic distances`;

    const result = await queryLlm<{
      scale: string;
      reasoning: string;
    }>({
      system: `You are a world-building assistant. Determine appropriate distance scales for geographic regions. Be precise about when cosmic scales (au, lightyears) are appropriate vs terrestrial scales (miles, kilometers).`,
      prompt,
      complexity: 'simple',
      context: 'IntegrityRepair',
      schema: {
        name: 'region_scale',
        schema,
      },
    });

    const { scale, reasoning } = result.content;

    if (!isDistanceUnit(scale)) {
      logger.error('IntegrityRepair', `LLM generated invalid scale for ${place.id}: "${scale}"`);
      return false;
    }

    const oldScale = place.info.scale;
    place.info.scale = scale;

    logger.info(
      'IntegrityRepair',
      `Repaired scale for ${place.id}: ${oldScale} -> ${scale} (${reasoning})`,
    );

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to repair scale for ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Repair an empty place by generating child places.
 * Used for cities, polities, and other places that need interior locations.
 */
async function repairEmptyLocationGroup(
  place: Place,
  _ctx: ValidationContext,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    // Determine what kind of child places to generate based on the parent's characteristics
    const schema = {
      type: 'object',
      properties: {
        childPlaces: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Description for generating this child place',
              },
              environment: {
                type: 'string',
                enum: ['interior', 'exterior'],
                description: 'The environment type of the place',
              },
            },
            required: ['description', 'environment'],
            additionalProperties: false,
          },
          minItems: 1,
          maxItems: 5,
          description: 'Child places to generate',
        },
      },
      required: ['childPlaces'],
      additionalProperties: false,
    };

    const prompt = `A large-scale place "${place.label}" needs child places generated.

Parent Place Details:
- Label: ${place.label}
- Description: ${place.description}
- Scale: ${place.info.scale}
- Tags: ${place.tags.join(', ')}

Based on this place, suggest 2-4 appropriate child places that would exist within it.
For a city/polity, this might include: main square, market district, harbor, palace, temple, residential area.
For a building complex, this might include: main hall, courtyard, private chambers.

Each child place should have:
- A brief description suitable for generation
- An environment: "interior" (enclosed spaces) or "exterior" (open areas)

Focus on places that are important for gameplay - where characters might be, where events might happen.`;

    const result = await queryLlm<{
      childPlaces: Array<{
        description: string;
        environment: string;
      }>;
    }>({
      system: `You are a world-building assistant. Generate appropriate child locations for a parent place based on its description and scale. Focus on interesting, gameplay-relevant locations.`,
      prompt,
      complexity: 'reasoning',
      context: 'IntegrityRepair',
      schema: {
        name: 'child_places',
        schema,
      },
    });

    const { childPlaces } = result.content;

    if (childPlaces.length === 0) {
      logger.error('IntegrityRepair', `LLM returned no child places for ${place.id}`);
      return false;
    }

    let generatedCount = 0;
    for (const childSpec of childPlaces) {
      try {
        const parentOneLine =
          place.short_description.trim() || place.description.split('.')[0]?.trim() || place.label;
        const creationHint = `${DEFAULT_CREATION_HINT}\n\nThis place is a child of ${place.label}. (${place.label}: ${parentOneLine}).`;

        const childPlace = await generatePlace(universeCtx, {
          description: childSpec.description,
          creationHint,
          parentId: place.id,
          purpose: 'tavern',
          environment: environmentFromPreset(childSpec.environment),
        });

        logger.info(
          'IntegrityRepair',
          `Generated child place ${childPlace.id} (${childPlace.label}) for ${place.id}`,
        );
        generatedCount++;
      } catch (error) {
        logger.error('IntegrityRepair', `Failed to generate child place for ${place.id}`, {
          description: childSpec.description,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other children even if one fails
      }
    }

    if (generatedCount === 0) {
      logger.error('IntegrityRepair', `Failed to generate any child places for ${place.id}`);
      return false;
    }

    logger.info('IntegrityRepair', `Generated ${generatedCount} child places for ${place.id}`);

    return true;
  } catch (error) {
    logger.error('IntegrityRepair', `Failed to repair empty place ${place.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Repair a dead-end place by generating an exit to its parent.
 * Always creates a vertical connection (child -> parent) for clean hierarchy.
 * Uses shared generateExitObject which handles naming (label = target place label).
 * Target is derived from place's position.parent.
 */
async function repairParentExit(
  place: Place,
  _ctx: ValidationContext,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  try {
    // Verify parent exists - generateExitObject will derive target from hierarchy
    const parentPlaceId = place.position.parent;

    // Early exit if no parent (direct cosmos child or orphan)
    if (!parentPlaceId) {
      throw new Error(
        `IntegrityRepair: Place ${place.id} has no parent - cannot create parent exit`,
      );
    }

    // Early exit if parent is self-referential (data corruption)
    if (parentPlaceId === place.id) {
      logger.error(
        'IntegrityRepair',
        `Place ${place.id} has self-referential parent - cannot create parent exit. Fix position.parent first.`,
      );
      return false;
    }

    // Generate the exit to parent (target derived from hierarchy)
    const exitObj = await generateExitObject(universeCtx, {
      placeId: place.id,
    });

    logger.info('IntegrityRepair', `Generated parent exit ${exitObj.id} for place ${place.id}`);

    return true;
  } catch (error) {
    logger.error(
      'IntegrityRepair',
      `Failed to repair parent exit for ${place.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * Repair vessel crew by populating unfilled character slots.
 * Uses populateSlotCharacters which generates characters from layout template slots
 * (captain/helmsman character-category slots defined in vessel templates).
 */
async function repairVesselCrew(
  place: Place,
  _ctx: ValidationContext,
  universeCtx: import('@dmnpc/core/universe/universe-context.js').UniverseContext,
): Promise<boolean> {
  const vessel = universeCtx.findPlace(place.id);
  if (!vessel || !isVessel(universeCtx, vessel)) {
    throw new Error(`Vessel not found or is not a vessel: ${place.id}`);
  }

  await populateSlotCharacters(universeCtx, vessel.id);
  logger.info('IntegrityRepair', `Populated character slots for vessel ${vessel.id}`);
  return true;
}
