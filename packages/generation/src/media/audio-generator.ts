import { generateSoundEffect } from '@dmnpc/core/clients/elevenlabs-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import type { Place } from '@dmnpc/types/entity';
import type { WeatherCondition } from '@dmnpc/types/world';
import { isEnclosed } from '@dmnpc/types/world';

/**
 * Activity level for ambient audio.
 * Inferred from time of day only (music/context assumes by place type).
 */
export type ActivityLevel = 'quiet' | 'moderate' | 'crowded';

/**
 * Context for determining the ambient audio situation.
 */
export interface SituationContext {
  /** The place entity. */
  place: Place;
  /** Time of day from GameDate (dawn, morning, midday, afternoon, evening, dusk, night). */
  timeOfDay: string;
  /** Weather condition from universe state. */
  weather?: WeatherCondition;
}

/**
 * Simplify time of day for ambient audio purposes.
 * Combines similar periods to reduce the number of unique situations.
 */
function simplifyTimeOfDay(timeOfDay: string): string {
  switch (timeOfDay) {
    case 'dawn':
    case 'morning':
      return 'morning';
    case 'midday':
    case 'afternoon':
      return 'day';
    case 'evening':
    case 'dusk':
      return 'evening';
    case 'night':
    default:
      return 'night';
  }
}

/**
 * Infer activity level from time of day only.
 * Place type is assumed by the music/context; no mapping table.
 */
export function inferActivityLevel(context: SituationContext): ActivityLevel {
  const time = simplifyTimeOfDay(context.timeOfDay);
  if (time === 'night' || time === 'morning') return 'quiet';
  if (time === 'evening') return 'moderate';
  return 'moderate';
}

/**
 * Build a situation signature from context.
 *
 * Format: {purpose}_{interior|exterior}_{timeOfDay}[_{weather}]
 *
 * @example
 * buildSituationSignature({
 *   place: { info: { purpose: 'tavern', environment: 'interior' } },
 *   timeOfDay: 'evening',
 *   weather: 'rain',
 * })
 * // Returns: 'tavern_interior_evening_rain'
 */
export function buildSituationSignature(context: SituationContext): string {
  const purpose = context.place.info.purpose;
  const interiorExterior = isEnclosed(context.place.info.environment) ? 'interior' : 'exterior';
  const time = simplifyTimeOfDay(context.timeOfDay);

  const parts = [purpose, interiorExterior, time];

  if (context.weather && context.weather !== 'clear') {
    parts.push(context.weather.toLowerCase());
  }

  return parts.join('_');
}

/**
 * Get the S3 key for an ambient audio file.
 */
export function getAmbientAudioKey(universeId: string, situation: string): string {
  return `universes/${universeId}/audio/ambient/${situation}.mp3`;
}

/**
 * Get the S3 URL for an ambient audio file.
 */
function getAmbientAudioUrl(universeId: string, situation: string): string {
  const key = getAmbientAudioKey(universeId, situation);
  return storageService.getPublicUrl(key);
}

/**
 * Check if ambient audio exists for a situation and return its URL.
 *
 * @param universeId - The universe ID
 * @param situation - The situation signature
 * @returns URL if audio exists, null otherwise
 */
export async function getAmbientAudio(
  universeId: string,
  situation: string,
): Promise<string | null> {
  const key = getAmbientAudioKey(universeId, situation);

  if (await storageService.exists(key)) {
    return getAmbientAudioUrl(universeId, situation);
  }

  return null;
}

/**
 * Build a descriptive prompt for ambient audio generation.
 * Passes purpose directly; no mapping tables.
 */
function buildAmbientPrompt(situation: string, _context: SituationContext): string {
  const parts = situation.split('_');
  const [purpose, interiorExterior, time, ...weatherParts] = parts;
  const weather = weatherParts.length > 0 ? weatherParts.join('_') : undefined;

  const isInterior = interiorExterior === 'interior';

  let prompt = `Ambient background audio for a ${purpose}`;
  prompt += isInterior ? ', interior space' : ', outdoor space';
  prompt += `, ${time}`;
  if (weather && weather !== 'clear') {
    prompt += ` with ${weather}`;
  }
  prompt += '.';

  return prompt;
}

/**
 * Generate ambient audio for a situation and save it.
 *
 * @param universeId - The universe ID
 * @param situation - The situation signature
 * @param context - The situation context for prompt building
 * @param instructions - Optional user instructions to append to the prompt
 * @returns URL to the generated audio file
 */
export async function generateAmbientAudio(
  universeId: string,
  situation: string,
  context: SituationContext,
  instructions?: string,
): Promise<string> {
  logger.info('Audio Generator', `Generating ambient audio for situation: ${situation}`);

  let prompt = buildAmbientPrompt(situation, context);

  if (instructions?.trim()) {
    prompt += ` Additional guidance: ${instructions.trim()}`;
  }

  logger.info('Audio Generator', `Generated prompt for "${situation}": ${prompt.length} chars`);

  try {
    const result = await generateSoundEffect(prompt, {
      durationSeconds: 22,
      loop: true,
    });

    const key = getAmbientAudioKey(universeId, situation);
    const url = await storageService.uploadFile(key, result.audio, 'audio/mpeg');

    logger.info(
      'Audio Generator',
      `Ambient audio generated and saved for "${situation}": ${url} (${result.audio.length} bytes, ${result.durationMs}ms)`,
    );

    return url;
  } catch (error) {
    logger.error('Audio Generator', 'Failed to generate ambient audio', {
      situation,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
