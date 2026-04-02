/**
 * Music Generator Service
 *
 * Generates musical performances (lute melodies, hummed tunes, etc.) for player characters.
 * Used by the describe_creative response tool with creativeType='music'.
 */

import { generateSoundEffect } from '@dmnpc/core/clients/elevenlabs-client.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';

/** Default duration for generated music in seconds (ElevenLabs max is 30) */
const DEFAULT_MUSIC_DURATION_SECONDS = 30;

export interface GenerateMusicResult {
  success: boolean;
  /** The URL path to the generated audio */
  audioUrl: string | null;
  error?: string;
}

/** Map instruments that ElevenLabs doesn't handle well to similar alternatives */
const INSTRUMENT_MAP: Record<string, string> = {
  lute: 'mandolin',
};

/**
 * Build a prompt for music generation based on context.
 * Keeps it simple: solo character playing an instrument.
 */
function buildMusicPrompt(mood: string | undefined, instrument: string | undefined): string {
  // Default to a generic instrument if none specified
  const rawInst = instrument?.toLowerCase() || 'lute';
  const inst = INSTRUMENT_MAP[rawInst] || rawInst;

  // Build a simple, focused prompt
  if (mood) {
    return `A ${mood} ${inst} melody, solo performance`;
  }

  return `A ${inst} melody, solo performance`;
}

/**
 * Generate a musical performance for a character.
 *
 * @param ctx - Universe context
 * @param characterId - The player character ID
 * @param mood - Optional mood/emotion for the music (e.g., "happy", "melancholic", "triumphant")
 * @param instrument - Optional instrument being played (e.g., "lute", "flute", "drum")
 * @returns Result with audioUrl
 */
export async function generateCharacterMusic(
  ctx: UniverseContext,
  characterId: string,
  mood?: string,
  instrument?: string,
): Promise<GenerateMusicResult> {
  // Check if audio generation is disabled via environment variable
  if (process.env.DISABLE_AUDIO_GENERATION === 'true') {
    logger.info(
      'MusicGenerator',
      'Music generation disabled via DISABLE_AUDIO_GENERATION env variable',
    );
    return {
      success: false,
      audioUrl: null,
      error: 'Audio generation is disabled',
    };
  }

  try {
    const player = ctx.getCharacter(characterId);
    const universe = ctx.universe;
    const placeId = player.position.parent;
    if (!placeId) {
      throw new Error(`Character ${characterId} has no position.parent`);
    }
    const place = ctx.getPlace(placeId);

    logger.info(
      'MusicGenerator',
      `Generating music for ${characterId} at ${place.label}: mood=${mood}, instrument=${instrument}`,
    );

    // Build the prompt (kept concise to stay under ElevenLabs 450 char limit)
    const musicPrompt = buildMusicPrompt(mood, instrument);

    logger.info(
      'MusicGenerator',
      `Music prompt: ${musicPrompt.substring(0, 100)}${musicPrompt.length > 100 ? '...' : ''}`,
    );

    // Generate audio via ElevenLabs
    const result = await generateSoundEffect(musicPrompt, {
      durationSeconds: DEFAULT_MUSIC_DURATION_SECONDS,
      promptInfluence: 0.7, // Higher influence to stay close to the prompt
    });

    // Save the audio file to S3
    const timestamp = Date.now();
    const filename = `music_${characterId}_${timestamp}.mp3`;
    const key = `universes/${universe.id}/audio/music/${filename}`;

    const audioUrl = await storageService.uploadFile(key, result.audio, 'audio/mpeg');

    logger.info(
      'MusicGenerator',
      `Music generated successfully for ${characterId}: ${audioUrl} (${mood}/${instrument}, ${result.audio.length} bytes, ${result.durationMs}ms)`,
    );

    return {
      success: true,
      audioUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('MusicGenerator', 'Failed to generate music', {
      characterId,
      mood,
      instrument,
      error: errorMessage,
    });

    return {
      success: false,
      audioUrl: null,
      error: errorMessage,
    };
  }
}
