/**
 * Plot Image Generator
 *
 * AI generation service for plot images.
 */

import { generateImage } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { PlotDefinition } from '@dmnpc/types/npc';

export interface GeneratePlotImageParams {
  plot: Partial<PlotDefinition>;
  universeStyle?: string;
  instructions?: string;
}

/**
 * Generate an image for a plot.
 * Returns base64 image data.
 */
export async function generatePlotImage(params: GeneratePlotImageParams): Promise<string | null> {
  const { plot, universeStyle, instructions } = params;

  // Check if image generation is disabled
  if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
    logger.info(
      'PlotImageGenerator',
      'Image generation disabled via DISABLE_IMAGE_GENERATION env variable — skipping',
    );
    return null;
  }

  logger.info('PlotImageGenerator', `Generating plot image for: ${plot.label || 'untitled'}`);

  const elements: string[] = [];

  if (plot.plot) elements.push(plot.plot.slice(0, 200));
  for (const place of (plot.places || []).slice(0, 2)) {
    if (place.storyRole) elements.push(place.storyRole.slice(0, 80));
  }
  for (const char of (plot.characters || []).slice(0, 2)) {
    if (char.description) elements.push(char.description.slice(0, 80));
  }

  let prompt = `A dramatic, cinematic scene depicting: ${elements.join('. ')}.${universeStyle ? `\nStyle: ${universeStyle}.` : ''}
Atmospheric, immersive, detailed illustration. Epic composition with dramatic lighting.
No text, no watermarks, no signatures.`;

  if (instructions) {
    prompt = `${prompt}\n\nAdditional instructions: ${instructions}`;
  }

  const result = await generateImage({
    prompt,
    context: 'Plot Image Generation',
    size: '1536x1024', // Landscape for plot images
  });

  return result.base64;
}

/**
 * Save a plot image from base64 data.
 * Returns the S3 URL for the saved image.
 */
export async function savePlotImage(plotId: string, imageBase64: string): Promise<string> {
  const filename = `${plotId}.png`;
  const key = `plots/images/${filename}`;
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  const imageUrl = await storageService.uploadFile(key, imageBuffer, 'image/png');

  logger.info('PlotImageGenerator', `Saved plot image: ${plotId} -> ${imageUrl}`);

  return imageUrl;
}
