/**
 * Scene Image Generator Service
 *
 * Generates illustrated images of the current scene for a character.
 * Used by the describe_creative response tool.
 */

import type { BaseEntity } from '@dmnpc/types/entity';
import { generateImage } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { buildActionTranscript } from '@dmnpc/core/prompts/transcript-builder.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

export interface GenerateSceneImageResult {
  success: boolean;
  /** The URL path to the generated image */
  imageUrl: string | null;
  /** Formatted markdown with the image ready to include in response */
  imageMarkdown: string | null;
  error?: string;
}

/**
 * Generate an illustration of the current scene for a character.
 *
 * @param ctx - Universe context
 * @param characterId - The player character ID
 * @param focus - Optional description of what to focus on in the image
 * @returns Result with imageUrl and imageMarkdown
 */
export async function generateSceneImage(
  ctx: UniverseContext,
  characterId: string,
  focus?: string,
): Promise<GenerateSceneImageResult> {
  // Check if image generation is disabled via environment variable
  if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
    logger.info(
      'SceneImageGenerator',
      'Scene image generation disabled via DISABLE_IMAGE_GENERATION env variable',
    );
    return {
      success: false,
      imageUrl: null,
      imageMarkdown: null,
      error: 'Image generation is disabled',
    };
  }

  try {
    const universe = ctx.universe;
    const player = ctx.getCharacter(characterId);

    const placeId = player.position.parent;
    if (!placeId) {
      return { success: false, imageUrl: null, imageMarkdown: null };
    }
    const place = ctx.getPlace(placeId);
    const nearbyEntities = ctx.getEntitiesByPlace(placeId, characterId);

    logger.info(
      'SceneImageGenerator',
      `Generating scene image for ${characterId} at ${place.label}${focus ? ` focusing on ${focus}` : ''}`,
    );

    const universeStyle = universe.style || '';

    // Build the scene description
    const locationDesc = place.description || place.short_description || place.label;

    // Build character descriptions for nearby entities
    const characterDescs = nearbyEntities
      .filter(
        (e: BaseEntity): e is import('@dmnpc/types/entity').Character =>
          e.entityType === 'character',
      )
      .slice(0, 3) // Limit to 3 characters to avoid prompt overload
      .map((e) => {
        const info = e.info;
        const parts = [e.label];
        if (info.gender) parts.push(info.gender);
        if (info.race) parts.push(info.race);
        if (info.hairColor) parts.push(`${info.hairColor} hair`);
        if (e.short_description) parts.push(e.short_description);
        return parts.join(', ');
      });

    // Get recent conversation context for the scene
    const recentTranscript = buildActionTranscript(player.info.messages, 5);

    // Build the prompt
    const promptParts: string[] = [];

    if (universeStyle) {
      promptParts.push(`Art style: ${universeStyle}.`);
    }

    promptParts.push(`Scene illustration, dramatic lighting, atmospheric.`);
    promptParts.push(`Location: ${locationDesc}.`);

    if (characterDescs.length > 0) {
      promptParts.push(`Characters present: ${characterDescs.join('; ')}.`);
    }

    // Include recent events/actions for context
    if (recentTranscript) {
      promptParts.push(`Recent events: ${recentTranscript.slice(0, 300)}.`); // Limit length
    }

    if (focus) {
      promptParts.push(`Focus on: ${focus}.`);
    }

    promptParts.push(
      'Detailed illustration style, detailed environment, cinematic composition, no text or words.',
    );

    const imagePrompt = promptParts.join(' ');

    const imageResult = await generateImage({
      prompt: imagePrompt,
      size: '1536x1024', // Landscape for scenes
      context: 'Scene Image Generation',
    });

    const imageBuffer = Buffer.from(imageResult.base64, 'base64');

    const timestamp = Date.now();
    const filename = `scene_${characterId}_${timestamp}.png`;
    const key = `universes/${universe.id}/images/scenes/${filename}`;

    const imageUrl = await storageService.uploadFile(key, imageBuffer, 'image/png');

    logger.info(
      'SceneImageGenerator',
      `Scene image generated successfully for ${characterId}: ${imageUrl}${focus ? ` (focus: ${focus})` : ''}`,
    );

    // Return both URL and markdown
    const imageMarkdown = `![Scene illustration](${imageUrl})`;

    return {
      success: true,
      imageUrl,
      imageMarkdown,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('SceneImageGenerator', 'Failed to generate scene image', {
      characterId,
      error: errorMessage,
    });

    return {
      success: false,
      imageUrl: null,
      imageMarkdown: null,
      error: errorMessage,
    };
  }
}
