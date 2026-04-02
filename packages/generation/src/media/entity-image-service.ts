import { generateImage, editImage, detectFacePosition } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { isCharacter, isPlace } from '@dmnpc/core/entities/type-guards.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { resolveReferencesWithContext } from '@dmnpc/core/universe/universe-store.js';
import createHttpError from 'http-errors';
import type {
  Character,
  BaseEntity,
  CharacterPreviewData,
  CharacterInfo,
  ClothingSlot,
} from '@dmnpc/types/entity';
import {
  generateCompositeSprite,
  HEAD_TYPES,
  SKIN_COLORS,
  type HeadType,
  type SkinColor,
} from '@dmnpc/sprites';
import {
  buildV3LayerConfigs,
  type SpriteCharacterInfo,
} from '../character/character-sprite-helper.js';

function isHeadType(val: string): val is HeadType {
  return (HEAD_TYPES as readonly string[]).includes(val);
}

function isSkinColor(val: string): val is SkinColor {
  return (SKIN_COLORS as readonly string[]).includes(val);
}
import { extractSpriteFrameForPortrait } from '../sprite-frame-utils.js';
import { getCharacterOccupation } from '../job-matching.js';
import { loadPurposeDefinition } from '../purpose-loader.js';
import { tryAssignFromPool, addToPool } from '../character/portrait-pool.js';

type EntityType = 'character' | 'place';

function dedent(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  const raw = strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''),
    '',
  );
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // Drop leading/trailing empty lines so indentation is computed on meaningful content.
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();

  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^\s+/)?.[0]?.length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines
    .map((l) => l.slice(minIndent))
    .join('\n')
    .trim();
}

function compactPrompt(parts: Array<string | null | undefined>, separator = '\n'): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim())
    .join(separator);
}

function buildTagLine(tags: string[]): string | null {
  return tags.length > 0 ? `This is ${tags.join(', ').toLowerCase()}.` : null;
}

const CHARACTER_COMPOSITION_CONSTRAINTS = dedent`
  Full body character portrait, detailed art illustration.
  The character must be shown completely from head to feet, horizontally centered.

  Consistent head positioning for avatar cropping:
  - Head in the upper quarter of the image
  - Small margin of space above the head
  - Face clearly visible and well-lit

  Full body composition with proper vertical framing, no cropping or truncation.
  No text, no watermarks, no signatures.
`;

const CHARACTER_BACKGROUND_CONSTRAINTS = dedent`
  The background must be fully rendered and non-empty, with clear environmental context.
  No transparent background, no blank/empty background, no studio backdrop, no solid-color background.
`;

const PLACE_SCENE_CONSTRAINTS = dedent`
  Atmospheric, immersive, detailed illustration.
  No characters or people visible in the scene.
  The environment must fill the frame: no blank/empty/transparent/solid-color background.
`;

function buildEntityImagePrompt(params: {
  entityType: EntityType;
  label: string;
  description: string;
  tags: string[];
  style: string;
  instructions?: string;
  raceLabel?: string;
  raceDescription?: string;
  // Character-specific appearance details
  gender?: string;
  hairColor?: string;
  eyeColor?: string;
  hairStyle?: string;
  beardStyle?: string | null;
  skinTone?: string;
  occupation?: string;
  workDescription?: string;
  // Place-specific details
  environment?: string;
  // Option B: when true, prompt instructs to use attached sprite as sole appearance reference
  spriteReference?: boolean;
}): string {
  const {
    entityType,
    label,
    description,
    tags,
    style,
    instructions,
    raceLabel,
    raceDescription,
    gender,
    hairColor,
    eyeColor,
    hairStyle,
    beardStyle,
    skinTone,
    occupation,
    workDescription,
    environment,
    spriteReference,
  } = params;

  const tagLine = buildTagLine(tags);
  const styleLine = style ? `Art style: ${style}.` : null;

  if (entityType === 'character') {
    // Build race line for character portraits
    const raceLine = raceLabel
      ? raceDescription
        ? `Race: ${raceLabel}. ${raceDescription}`
        : `Race: ${raceLabel}.`
      : null;

    // Build appearance details line from character info fields
    const appearanceDetails: string[] = [];
    if (gender) appearanceDetails.push(gender);
    if (hairColor && hairStyle) {
      appearanceDetails.push(`${hairColor} hair (${hairStyle})`);
    } else if (hairColor) {
      appearanceDetails.push(`${hairColor} hair`);
    }
    if (eyeColor) appearanceDetails.push(`${eyeColor} eyes`);
    if (skinTone) appearanceDetails.push(`${skinTone} skin`);
    if (beardStyle) {
      appearanceDetails.push(beardStyle.replace(/_/g, ' ') + ' beard');
    } else if (beardStyle === null && gender?.toLowerCase() === 'male') {
      appearanceDetails.push('clean-shaven');
    }
    const appearanceLine =
      appearanceDetails.length > 0 ? `Physical appearance: ${appearanceDetails.join(', ')}.` : null;

    // Option B: sprite as reference - sprite image is attached; text covers details the sprite can't convey
    const spriteRefLine = spriteReference
      ? 'Image 1 (attached) is a pixel-art game sprite of this character. Use the sprite as your primary reference for clothing, colors, and body proportions. However, the sprite is low-resolution pixel art and cannot convey fine details — use the physical appearance details and character description below for age, facial hair, facial features, and other details the sprite cannot represent.'
      : null;

    const professionLine =
      !spriteReference && occupation
        ? `Profession: ${occupation}. Depict the character in attire appropriate to their profession.`
        : null;

    const workLocationLine = workDescription ? `Work location: ${workDescription}.` : null;

    return compactPrompt(
      [
        `Role-playing game character portrait: ${label}.`,
        styleLine,
        raceLine,
        appearanceLine,
        spriteRefLine,
        professionLine,
        workLocationLine,
        description ? description : null,
        tagLine,
        CHARACTER_COMPOSITION_CONSTRAINTS,
        `Background: Choose an appropriate environment that fits the character and art style. ${CHARACTER_BACKGROUND_CONSTRAINTS}`,
        `The character must remain the focal point; keep the background soft-focus and non-distracting while still clearly present.`,
        instructions
          ? `Additional instructions (must not request or produce blank/transparent/solid-color backgrounds): ${instructions}`
          : null,
      ],
      '\n',
    );
  }

  // Build place kind line for scene context
  const environmentLine = environment ? buildEnvironmentLine(environment) : null;

  return compactPrompt(
    [
      `Role-playing game scene: ${label}.`,
      styleLine,
      environmentLine,
      description ? description : null,
      tagLine,
      PLACE_SCENE_CONSTRAINTS,
      instructions
        ? `Additional instructions (must not request or produce blank/transparent/solid-color backgrounds): ${instructions}`
        : null,
    ],
    '\n',
  );
}

/**
 * Builds a descriptive line for the place environment to guide image generation.
 */
function buildEnvironmentLine(environmentType: string): string {
  switch (environmentType) {
    case 'interior':
      return 'Setting: Interior space (indoor environment, enclosed room or building).';
    case 'exterior':
      return 'Setting: Outdoor terrestrial environment (open sky, natural lighting, landscape visible).';
    case 'space':
      return 'Setting: Space environment (stars, void, cosmic backdrop, spacecraft or station interior with space visible).';
    case 'underwater':
      return 'Setting: Underwater environment (submerged, aquatic life, filtered light, water visible).';
    default:
      return `Setting: ${environmentType} environment.`;
  }
}

/**
 * Gets the S3 key for an entity's image.
 */
function getEntityImageKey(universeId: string, entityId: string, entityType: EntityType): string {
  const entityTypeDir = entityType === 'character' ? 'characters' : 'places';
  return `universes/${universeId}/images/${entityTypeDir}/${entityId}.png`;
}

/**
 * Get sprite buffer for a character (for Option B portrait reference).
 * Fetches from spriteUrl if present, else generates in-memory from clothing items.
 *
 * @param subject - Character entity or CharacterPreviewData
 * @returns Sprite PNG buffer (empty clothing = no clothing layers)
 */
export async function getSpriteBufferForCharacter(
  subject: Character | { info: CharacterInfo } | CharacterPreviewData,
): Promise<Buffer | null> {
  // Extract spriteUrl safely — only CharacterInfo has spriteConfig
  const infoField = 'info' in subject ? subject.info : undefined;
  const spriteUrl =
    infoField && 'spriteConfig' in infoField ? infoField.spriteConfig.spriteUrl : null;

  if (typeof spriteUrl === 'string') {
    const res = await fetch(spriteUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch sprite from ${spriteUrl}: ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Extract appearance fields with defaults for sprite generation.
  // CharacterInfo (from Character or {info}) has all fields; CharacterPreviewData.info is partial.
  const clothing: ClothingSlot[] =
    (infoField && 'clothing' in infoField ? infoField.clothing : undefined) ?? [];
  const rawHeadType: string =
    (infoField && 'headType' in infoField && typeof infoField.headType === 'string'
      ? infoField.headType
      : undefined) ?? 'human_male';
  const rawSkinTone: string =
    (infoField && 'skinTone' in infoField && typeof infoField.skinTone === 'string'
      ? infoField.skinTone
      : undefined) ?? 'light';
  const gender: string =
    (infoField && 'gender' in infoField && typeof infoField.gender === 'string'
      ? infoField.gender
      : undefined) ?? 'Unknown';
  const enabledOverlayLayers: string[] =
    (infoField && 'enabledOverlayLayers' in infoField
      ? infoField.enabledOverlayLayers
      : undefined) ?? [];
  const eyeColor: string =
    (infoField && 'eyeColor' in infoField && typeof infoField.eyeColor === 'string'
      ? infoField.eyeColor
      : undefined) ?? '';
  const hairColor: string =
    (infoField && 'hairColor' in infoField && typeof infoField.hairColor === 'string'
      ? infoField.hairColor
      : undefined) ?? '';
  const hairStyle: string =
    (infoField && 'hairStyle' in infoField && typeof infoField.hairStyle === 'string'
      ? infoField.hairStyle
      : undefined) ?? 'long';
  const beardStyle: string | null =
    (infoField && 'beardStyle' in infoField && typeof infoField.beardStyle === 'string'
      ? infoField.beardStyle
      : undefined) ?? null;
  const spriteInfo: SpriteCharacterInfo = {
    clothing,
    enabledOverlayLayers,
    eyeColor,
    hairColor,
    hairStyle,
    beardStyle,
  };

  // Use v3 pipeline with human archetype as default for portraits
  const { getSpriteArchetype, resolveBodyType, loadSpriteArchetypes, loadCharacterBasesManifest } =
    await import('@dmnpc/sprites');
  const { LPC_SPRITES_DIR } = await import('@dmnpc/data');
  loadCharacterBasesManifest(LPC_SPRITES_DIR);
  loadSpriteArchetypes(LPC_SPRITES_DIR);

  const archetype = getSpriteArchetype('human');
  if (!archetype) throw new Error('Human archetype not found');
  if (!isHeadType(rawHeadType)) {
    throw new Error(`Invalid head type "${rawHeadType}" for sprite generation`);
  }
  const headType = rawHeadType;
  const bodyType = resolveBodyType(archetype, gender);
  if (!isSkinColor(rawSkinTone)) {
    throw new Error(`Invalid skin color "${rawSkinTone}" for sprite generation`);
  }
  const skinColor = rawSkinTone;

  const layers = buildV3LayerConfigs(spriteInfo, archetype, headType, bodyType, skinColor);
  const spriteData = await generateCompositeSprite(layers);
  return spriteData.image;
}

async function generateAndPersistEntityImage(params: {
  ctx: UniverseContext;
  entityId: string;
  entityType: EntityType;
  prompt: string;
  /** Sprite buffer for Option B: use editImage with sprite frame as reference (characters only) */
  spriteBuffer?: Buffer | null;
  /** If true, uses existing S3 image as reference for edit (regenerate flow) */
  useExistingImage?: boolean;
}): Promise<{ imageUrl: string; imageBuffer: Buffer }> {
  const { ctx, entityId, entityType, prompt, spriteBuffer, useExistingImage } = params;
  const universeId = ctx.universeId;

  let imageBase64: string;

  // Option B: sprite as reference - extract frame, use editImage
  if (spriteBuffer && entityType === 'character') {
    const frameBuffer = await extractSpriteFrameForPortrait(spriteBuffer);
    logger.info(
      'Entity Image Service',
      `Using sprite reference for portrait: entityId=${entityId}`,
    );
    const editResult = await editImage({
      image: frameBuffer,
      prompt,
      size: '1024x1536',
      context: `Entity Image Generation (${entityType})`,
    });
    imageBase64 = editResult.base64;
  } else if (useExistingImage) {
    const existingKey = getEntityImageKey(universeId, entityId, entityType);
    const existingBuffer = await storageService.downloadFile(existingKey);

    if (existingBuffer) {
      logger.info(
        'Entity Image Service',
        `Editing existing image with reference: entityId=${entityId}`,
      );
      const genResult = await generateImage({
        prompt,
        size: '1024x1536',
        context: `Entity Image Generation (${entityType})`,
      });
      imageBase64 = genResult.base64;
    } else {
      const genResult = await generateImage({
        prompt,
        size: '1024x1536',
        context: `Entity Image Generation (${entityType})`,
      });
      imageBase64 = genResult.base64;
    }
  } else {
    const genResult = await generateImage({
      prompt,
      size: '1024x1536',
      context: `Entity Image Generation (${entityType})`,
    });
    imageBase64 = genResult.base64;
  }

  // Decode base64 image data
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  // Save image to S3
  const key = getEntityImageKey(universeId, entityId, entityType);
  const imageUrl = await storageService.uploadFile(key, imageBuffer, 'image/png');
  // Cache-bust: append timestamp so browsers fetch fresh after regeneration (same S3 path = cached)
  const imageUrlWithCacheBust = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;

  const latestEntity =
    entityType === 'character' ? ctx.findCharacter(entityId) : ctx.findPlace(entityId);
  if (!latestEntity) {
    throw createHttpError.NotFound(`Entity ${entityId} not found when saving image`);
  }

  // Update entity with image URL (cache-busted so regenerated portraits display immediately)
  latestEntity.image = imageUrlWithCacheBust;

  // For character portraits, detect face position for proper avatar cropping
  if (entityType === 'character') {
    const faceAnchorY = await detectFacePosition(imageBase64, latestEntity.label);
    latestEntity.faceAnchorY = faceAnchorY;
  }

  ctx.upsertEntity(entityType, latestEntity);

  return { imageUrl: imageUrlWithCacheBust, imageBuffer };
}

/**
 * Generates an image for a character or place.
 *
 * For characters with a purpose that has `portraitPoolSize > 0`, the portrait pool
 * is checked first. If the pool is full, a random portrait is assigned without an
 * OpenAI call. If the pool is still filling, a new portrait is generated normally
 * and also added to the pool.
 *
 * @param ctx - Universe context for mutations
 * @param entityId - The ID of the entity (character or place)
 * @param entityType - 'character' or 'place'
 * @param purpose - Optional purpose ID for character portrait pooling
 * @returns The image URL if generated, null if skipped (e.g., already has image or disabled)
 */
export async function generateEntityImage(
  ctx: UniverseContext,
  entityId: string,
  entityType: EntityType,
  purpose?: string,
): Promise<string | null> {
  logger.info('Entity Image Service', `Generating image for ${entityType}: entityId=${entityId}`);

  // Check if image generation is disabled via environment variable
  if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
    logger.info(
      'Entity Image Service',
      'Image generation disabled via DISABLE_IMAGE_GENERATION env variable',
    );
    return null;
  }

  const universe = ctx.universe;

  // Find the entity
  const entity = entityType === 'character' ? ctx.findCharacter(entityId) : ctx.findPlace(entityId);

  if (!entity) {
    logger.warn('Entity Image Service', `Entity not found: ${entityId} (${entityType})`);
    return null;
  }

  // Check if entity already has an image
  if (entity.image) {
    return entity.image;
  }

  // Portrait pool: check if this character's purpose supports pooling.
  // Purpose can come from explicit param (background queue) or from the entity itself.
  const resolvedPurpose =
    purpose ??
    (entityType === 'character' && isCharacter(entity) ? entity.info.purpose : undefined);
  const poolSize = resolvedPurpose
    ? (loadPurposeDefinition(resolvedPurpose)?.portraitPoolSize ?? 0)
    : 0;

  if (entityType === 'character' && poolSize > 0 && resolvedPurpose) {
    const poolPortrait = await tryAssignFromPool(ctx.universeId, resolvedPurpose, poolSize);
    if (poolPortrait) {
      // Pool is full — assign a random portrait without generating
      entity.image = poolPortrait.url;
      entity.faceAnchorY = poolPortrait.faceAnchorY;
      ctx.upsertEntity(entityType, entity);
      return poolPortrait.url;
    }
    // Pool not full — fall through to generate, then add to pool below
  }

  const entityDesc = entity.description
    ? resolveReferencesWithContext(ctx, entity.description)
    : '';
  const tags = entity.tags;
  const style = universe.style || '';

  // For characters, look up race information and appearance details from character info
  let raceLabel: string | undefined;
  let raceDescription: string | undefined;
  let gender: string | undefined;
  let hairColor: string | undefined;
  let eyeColor: string | undefined;
  let occupation: string | undefined;
  let workDescription: string | undefined;
  // For places, extract environment type
  let environment: string | undefined;

  if (entityType === 'character' && isCharacter(entity)) {
    const character = entity;
    const raceId = character.info.race;
    if (raceId) {
      const raceDef = ctx.universe.races.find((r) => r.id === raceId);
      if (raceDef) {
        raceLabel = raceDef.label;
        raceDescription = raceDef.description;
      } else {
        // Fallback: use race ID as label if not found in definitions
        raceLabel = raceId.replace(/^RACE_/, '');
      }
    }
    // Extract appearance details
    gender = character.info.gender || undefined;
    hairColor = character.info.hairColor || undefined;
    eyeColor = character.info.eyeColor || undefined;
    // Extract occupation from character tags
    const occupationTag = getCharacterOccupation(character);
    occupation = occupationTag?.replace(/^TAG_/, '');
    // Extract work location description for context
    workDescription = character.info.routine?.work?.description || undefined;
  } else if (isPlace(entity)) {
    // Place entity - extract environment type for image prompt
    const place = entity;
    environment = place.info.environment.type;
  }

  // Extract additional appearance fields for characters
  let skinTone: string | undefined;
  let hairStyle: string | undefined;
  let beardStyle: string | null | undefined;
  if (entityType === 'character' && isCharacter(entity)) {
    skinTone = entity.info.skinTone || undefined;
    hairStyle = entity.info.hairStyle || undefined;
    beardStyle = entity.info.beardStyle;
  }

  let spriteBuffer: Buffer | null = null;
  if (entityType === 'character' && isCharacter(entity)) {
    spriteBuffer = await getSpriteBufferForCharacter(entity);
  }

  const prompt = buildEntityImagePrompt({
    entityType,
    label: entity.label,
    description: entityDesc,
    tags,
    style,
    raceLabel,
    raceDescription,
    gender,
    hairColor,
    eyeColor,
    hairStyle,
    beardStyle,
    skinTone,
    occupation,
    workDescription,
    environment,
    spriteReference: !!spriteBuffer,
  });

  const { imageUrl, imageBuffer } = await generateAndPersistEntityImage({
    ctx,
    entityId,
    entityType,
    prompt,
    spriteBuffer: spriteBuffer ?? undefined,
  });

  // If this character's purpose has portrait pooling, add the generated portrait to the pool
  if (entityType === 'character' && poolSize > 0 && resolvedPurpose) {
    const latestEntity = ctx.findCharacter(entityId);
    const faceAnchorY = latestEntity?.faceAnchorY ?? 0.25;
    await addToPool(ctx.universeId, resolvedPurpose, poolSize, imageBuffer, faceAnchorY);
  }

  return imageUrl;
}

/**
 * Regenerates an image for a character or place, even if one already exists.
 * This function runs synchronously and returns when the image is generated.
 *
 * @param ctx - Universe context for mutations
 * @param entityId - The ID of the entity (character or place)
 * @param instructions - Optional additional instructions for the image generation
 * @param usePreviousImage - If true, uses the existing image as a reference for generation
 */
export async function regenerateEntityImage(
  ctx: UniverseContext,
  entityId: string,
  instructions?: string,
  usePreviousImage?: boolean,
): Promise<void> {
  try {
    const universe = ctx.universe;

    // Find the entity and determine its type
    const character = ctx.findCharacter(entityId);
    const place = ctx.findPlace(entityId);

    let entity: BaseEntity;
    let entityType: 'character' | 'place';

    if (character) {
      entity = character;
      entityType = 'character';
    } else if (place) {
      entity = place;
      entityType = 'place';
    } else {
      logger.warn('Entity Image Service', `Entity not found: ${entityId}`);
      throw createHttpError.NotFound(`Entity not found: ${entityId}`);
    }

    // Generate new image (force regeneration)
    const entityDesc = entity.description
      ? resolveReferencesWithContext(ctx, entity.description)
      : '';
    const tags = entity.tags;
    const style = universe.style || '';

    // For characters, look up race information and appearance details from character info
    let raceLabel: string | undefined;
    let raceDescription: string | undefined;
    let gender: string | undefined;
    let hairColor: string | undefined;
    let eyeColor: string | undefined;
    let occupation: string | undefined;
    let workDescription: string | undefined;
    // For places, extract environment type
    let environment: string | undefined;

    if (entityType === 'character' && isCharacter(entity)) {
      const charEntity = entity;
      const raceId = charEntity.info.race;
      if (raceId) {
        const raceDef = ctx.universe.races.find((r) => r.id === raceId);
        if (raceDef) {
          raceLabel = raceDef.label;
          raceDescription = raceDef.description;
        } else {
          // Fallback: use race ID as label if not found in definitions
          raceLabel = raceId.replace(/^RACE_/, '');
        }
      }
      // Extract appearance details
      gender = charEntity.info.gender || undefined;
      hairColor = charEntity.info.hairColor || undefined;
      eyeColor = charEntity.info.eyeColor || undefined;
      // Extract occupation from character tags
      const occupationTag = getCharacterOccupation(charEntity);
      occupation = occupationTag?.replace(/^TAG_/, '');
      // Extract work location description for context
      workDescription = charEntity.info.routine?.work?.description || undefined;
    } else {
      // Place entity - extract environment type for image prompt
      environment = place?.info.environment.type;
    }

    // Extract additional appearance fields for characters
    let skinTone: string | undefined;
    let hairStyle: string | undefined;
    let beardStyle: string | null | undefined;
    if (entityType === 'character' && isCharacter(entity)) {
      skinTone = entity.info.skinTone || undefined;
      hairStyle = entity.info.hairStyle || undefined;
      beardStyle = entity.info.beardStyle;
    }

    let spriteBuffer: Buffer | null = null;
    if (entityType === 'character' && isCharacter(entity)) {
      spriteBuffer = await getSpriteBufferForCharacter(entity);
    }

    const prompt = buildEntityImagePrompt({
      entityType,
      label: entity.label,
      description: entityDesc,
      tags,
      style,
      instructions,
      raceLabel,
      raceDescription,
      gender,
      hairColor,
      eyeColor,
      hairStyle,
      beardStyle,
      skinTone,
      occupation,
      workDescription,
      environment,
      spriteReference: !!spriteBuffer,
    });

    await generateAndPersistEntityImage({
      ctx,
      entityId,
      entityType,
      prompt,
      spriteBuffer: spriteBuffer ?? undefined,
      useExistingImage: usePreviousImage,
    });
  } catch (error: unknown) {
    logger.error('Entity Image Service', `Failed to regenerate image for entity ${entityId}`, {
      entityId,
      error,
    });
    throw error;
  }
}

/** Parameters for generating a preview portrait */
export interface GeneratePreviewPortraitParams {
  /** Character preview data (label, description, info fields) */
  characterData: CharacterPreviewData;
}

/** Result from generating a preview portrait */
export interface PreviewPortraitResult {
  /** Base64-encoded image data */
  portraitBase64: string;
  /** Normalized Y position of face center (0.0 = top, 1.0 = bottom) for avatar cropping */
  faceAnchorY: number;
}

/**
 * Generates a portrait for a character preview and returns base64 image data.
 * Does NOT save to disk - used for preview before character is created.
 */
export async function generatePreviewPortrait(
  ctx: UniverseContext,
  { characterData }: Omit<GeneratePreviewPortraitParams, 'universeId'>,
): Promise<PreviewPortraitResult | null> {
  logger.info('Entity Image Service', `Generating preview portrait: ${characterData.label}`);

  // Check if image generation is disabled
  if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
    logger.info(
      'Entity Image Service',
      'Image generation disabled via DISABLE_IMAGE_GENERATION env variable — skipping',
    );
    return null;
  }
  const style = ctx.universe.style || '';

  // Look up race information
  let raceLabel: string | undefined;
  let raceDescription: string | undefined;
  const raceId = characterData.info?.race;
  if (raceId) {
    const raceDef = ctx.universe.races.find((r) => r.id === raceId);
    if (raceDef) {
      raceLabel = raceDef.label;
      raceDescription = raceDef.description;
    } else {
      raceLabel = raceId.replace(/^RACE_/, '');
    }
  }

  const spriteBuffer = await getSpriteBufferForCharacter(characterData);

  const prompt = buildEntityImagePrompt({
    entityType: 'character',
    label: characterData.label,
    description: characterData.description,
    tags: [],
    style,
    raceLabel,
    raceDescription,
    gender: characterData.info?.gender,
    hairColor: characterData.info?.hairColor,
    eyeColor: characterData.info?.eyeColor,
    hairStyle: characterData.info?.hairStyle,
    beardStyle: characterData.info?.beardStyle,
    skinTone: characterData.info?.skinTone,
    spriteReference: !!spriteBuffer,
  });

  const startedAt = Date.now();
  const result = spriteBuffer
    ? await editImage({
        image: await extractSpriteFrameForPortrait(spriteBuffer),
        prompt,
        size: '1024x1536',
        context: 'Character Preview Portrait',
      })
    : await generateImage({
        prompt,
        size: '1024x1536',
        context: 'Character Preview Portrait',
      });

  // Detect face position for avatar cropping
  const faceAnchorY = await detectFacePosition(result.base64, characterData.label);

  const durationMs = Date.now() - startedAt;

  logger.info(
    'Entity Image Service',
    `Generated preview portrait: ${characterData.label} durationMs=${durationMs} faceAnchorY=${faceAnchorY.toFixed(3)}`,
  );

  return { portraitBase64: result.base64, faceAnchorY };
}

/**
 * Saves a portrait from base64 data to S3 for a created character.
 * Used when a character is saved after preview.
 *
 * @returns The S3 URL for the saved portrait
 */
export async function savePortraitFromBase64(
  universeId: string,
  entityId: string,
  base64: string,
): Promise<string> {
  logger.info('Entity Image Service', `Saving portrait from base64: entityId=${entityId}`);

  const imageBuffer = Buffer.from(base64, 'base64');
  const key = `universes/${universeId}/images/characters/${entityId}.png`;

  const imageUrl = await storageService.uploadFile(key, imageBuffer, 'image/png');

  logger.info('Entity Image Service', `Saved portrait from base64: entityId=${entityId}`);
  return imageUrl;
}
