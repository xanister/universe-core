/**
 * Template Image Generator
 *
 * AI generation service for template character images.
 */

import { generateImage } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';

export interface GenerateTemplateImageParams {
  template: Partial<TemplateCharacterDefinition>;
  instructions?: string;
}

/**
 * Generate an image for a template character.
 * Returns base64 image data.
 */
export async function generateTemplateImage(
  params: GenerateTemplateImageParams,
): Promise<string | null> {
  const { template, instructions } = params;

  // Check if image generation is disabled
  if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
    logger.info(
      'TemplateImageGenerator',
      'Image generation disabled via DISABLE_IMAGE_GENERATION env variable — skipping',
    );
    return null;
  }

  logger.info(
    'TemplateImageGenerator',
    `Generating template image for: ${template.label || 'untitled'}`,
  );

  const elements: string[] = [];

  // Add physical description
  if (template.description) {
    elements.push(template.description);
  }

  // Add physical traits
  if (template.physicalTraits) {
    const traits = template.physicalTraits;
    const traitParts: string[] = [];
    if (traits.gender) traitParts.push(traits.gender);
    if (traits.hairColor) traitParts.push(`${traits.hairColor} hair`);
    if (traits.eyeColor) traitParts.push(`${traits.eyeColor} eyes`);
    if (traitParts.length > 0) {
      elements.push(traitParts.join(', '));
    }
  }

  // Add personality hints for expression
  if (template.personality) {
    elements.push(`Expression reflecting: ${template.personality.slice(0, 100)}`);
  }

  let prompt = `Full body character portrait of ${template.label || 'a character'}.
${elements.join('. ')}.

Style: Detailed fantasy art illustration, genre-agnostic character design.
The character must be shown completely from head to feet, horizontally centered.
Head in the upper quarter of the image with small margin above.
Face clearly visible and well-lit.
Background should be atmospheric but neutral/generic (not tied to a specific setting).
No text, no watermarks, no signatures.`;

  if (instructions) {
    prompt = `${prompt}\n\nAdditional instructions: ${instructions}`;
  }

  const result = await generateImage({
    prompt,
    context: 'Template Character Image Generation',
    size: '1024x1536', // Portrait for character images
  });

  logger.info(
    'TemplateImageGenerator',
    `Generated template image: ${result.base64.length} chars base64`,
  );

  return result.base64;
}

/**
 * Save a template image from base64 data.
 * Returns the S3 URL for the saved image.
 */
export async function saveTemplateImage(templateId: string, imageBase64: string): Promise<string> {
  const filename = `${templateId}.png`;
  const key = `templates/images/${filename}`;
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  const imageUrl = await storageService.uploadFile(key, imageBuffer, 'image/png');

  logger.info('TemplateImageGenerator', `Saved template image: ${templateId} -> ${imageUrl}`);

  return imageUrl;
}
