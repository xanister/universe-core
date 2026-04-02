/**
 * Background Music Generator Service
 *
 * Generates background music tracks on-demand using ElevenLabs Music API.
 * Uses a three-dimension signature system (DramaticState × Purpose × Pace).
 * Purpose comes from the place; LLM picks dramatic state and pace.
 *
 * Features:
 * - 7 dramatic states for emotional tone
 * - 3 pace options (fast, medium, slow)
 * - LLM-based mood/pace determination; purpose from context
 * - Universe-level instrumentation overrides (optional)
 * - Place-specific music hints passed to LLM
 *
 * Generated tracks are cached and registered in media.json for future selection.
 */

import { generateMusic } from '@dmnpc/core/clients/elevenlabs-client.js';
import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { registerMediaEntry } from '../media-helpers.js';
import type {
  DramaticState,
  MusicPace,
  MusicContext,
  UniverseMusicConfig,
  PlaceMusicHints,
} from '@dmnpc/types/ui';
import type { Purpose } from '@dmnpc/types/world';
export type { DramaticState };

/** Default duration for generated background music in seconds */
const DEFAULT_MUSIC_DURATION_SECONDS = 90;

/**
 * Music requirement: purpose from context, dramatic state and pace from LLM.
 */
export interface MusicRequirement {
  dramaticState: DramaticState;
  purpose: Purpose;
  pace: MusicPace;
}

/**
 * Result of background music generation.
 */
export interface BackgroundMusicResult {
  url: string;
  filename: string;
  signature: string;
  description: string;
  generated: boolean;
}

/** All valid dramatic states */
export const DRAMATIC_STATES: readonly DramaticState[] = [
  'exploration',
  'calm',
  'progress',
  'combat',
  'victory',
  'mystery',
  'melancholy',
] as const;

/** Type guard for DramaticState */
export function isDramaticState(val: string): val is DramaticState {
  return (DRAMATIC_STATES as readonly string[]).includes(val);
}

/** Type guard for MusicPace */
export function isMusicPace(val: string): val is MusicPace {
  return val === 'fast' || val === 'medium' || val === 'slow';
}

/** Mood descriptions for each dramatic state */
const MOOD_DESCRIPTIONS: Record<DramaticState, string> = {
  exploration: 'curious, adventurous, forward-moving',
  calm: 'peaceful, reflective, serene',
  progress: 'suspenseful, uneasy, building anticipation',
  combat: 'intense, urgent, dangerous',
  victory: 'triumphant, celebratory, heroic',
  mystery: 'eerie, otherworldly, magical',
  melancholy: 'sad, somber, mournful',
};

/** Pace descriptions for each pacing option */
const PACE_DESCRIPTIONS: Record<MusicPace, string> = {
  fast: 'urgent, energetic tempo',
  medium: 'steady, balanced tempo',
  slow: 'deliberate, contemplative tempo',
};

/**
 * Build a music signature from a requirement.
 * Format: {dramaticState}_{purpose}_{pace}
 *
 * @example
 * buildMusicSignature({ dramaticState: 'combat', purpose: 'tavern', pace: 'fast' })
 * // Returns: 'combat_tavern_fast'
 */
export function buildMusicSignature(requirement: MusicRequirement): string {
  return `${requirement.dramaticState}_${requirement.purpose}_${requirement.pace}`;
}

/**
 * Parse a music signature back into a requirement.
 * Format: {dramaticState}_{purpose}_{pace}
 */
export function parseMusicSignature(signature: string): MusicRequirement | null {
  const parts = signature.split('_');
  if (parts.length < 3) return null;

  const state = parts[0];
  const pace = parts[parts.length - 1];
  const purpose = parts.slice(1, -1).join('_');

  if (!state || !isDramaticState(state) || !purpose) {
    return null;
  }

  if (!pace || !isMusicPace(pace)) {
    return null;
  }

  return {
    dramaticState: state,
    purpose,
    pace,
  };
}

/**
 * Use LLM to determine the best music requirement for a scene.
 * Purpose comes from context; LLM picks dramatic state and pace.
 *
 * @param context - Scene context including purpose, place description, time, weather, etc.
 * @param options - Optional configuration including universe config and hints
 * @returns Music requirement with dramatic state, purpose, and pace
 */
export async function determineMusicRequirement(
  context: MusicContext,
  options?: {
    universeConfig?: UniverseMusicConfig;
    placeHints?: PlaceMusicHints;
    targetMood?: DramaticState;
    targetPace?: MusicPace;
  },
): Promise<MusicRequirement> {
  const statesList = DRAMATIC_STATES.map((s) => `- ${s}: ${MOOD_DESCRIPTIONS[s]}`).join('\n');

  const hintsSection = options?.placeHints?.hints
    ? `\nPLACE-SPECIFIC HINTS:\n${options.placeHints.hints}`
    : '';

  const targetSection =
    options?.targetMood || options?.targetPace
      ? `\nCALLER SUGGESTIONS (consider strongly but can override if scene context contradicts):
${options.targetMood ? `- Suggested mood: ${options.targetMood}` : ''}
${options.targetPace ? `- Suggested pace: ${options.targetPace}` : ''}`
      : '';

  const prompt = `Analyze this RPG scene and determine the appropriate background music.

SCENE CONTEXT:
- Location: ${context.placeLabel} (${context.purpose}, ${context.isInterior ? 'interior' : 'exterior'})
- Description: ${context.placeDescription}
- Time of day: ${context.timeOfDay}
- Weather: ${context.weather || 'clear'}
- Activity level: ${context.activityLevel}
- Event type: ${context.eventType || 'none'}
${context.recentTranscript ? `\nRECENT EVENTS:\n${context.recentTranscript}` : ''}
${hintsSection}
${targetSection}

DRAMATIC STATES (choose one based on emotional tone):
${statesList}

PACE OPTIONS (choose one based on scene tempo and urgency):
- fast: Urgent, energetic, action-oriented (combat, chases, intense moments)
- medium: Balanced, steady, forward-moving (exploration, travel, moderate activity)
- slow: Deliberate, contemplative, relaxed (calm moments, reflection, peaceful scenes)

Based on the scene description, location, time, weather, and recent events, choose the most appropriate dramatic state and pace for this scene's background music.`;

  interface RequirementResponse {
    dramaticState: string;
    pace: string;
    reasoning: string;
  }

  try {
    const result = await queryLlm<RequirementResponse>({
      prompt,
      complexity: 'simple',
      context: 'Music Requirement',
      schema: {
        name: 'music_requirement',
        schema: {
          type: 'object',
          properties: {
            dramaticState: {
              type: 'string',
              enum: [...DRAMATIC_STATES],
              description: 'The emotional state of the scene',
            },
            pace: {
              type: 'string',
              enum: ['fast', 'medium', 'slow'],
              description:
                'The pacing/tempo of the music (fast for urgent/action, slow for contemplative, medium for balanced)',
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation (1 sentence)',
            },
          },
          required: ['dramaticState', 'pace', 'reasoning'],
          additionalProperties: false,
        },
      },
    });

    const rawState = result.content.dramaticState;
    const rawPace = result.content.pace;

    if (!isDramaticState(rawState)) {
      throw new Error(`Invalid LLM dramatic state: ${rawState}`);
    }
    if (!isMusicPace(rawPace)) {
      throw new Error(`Invalid LLM music pace: ${rawPace}`);
    }

    logger.info(
      'Background Music',
      `LLM determined requirement: ${rawState}_${context.purpose}_${rawPace} - ${result.content.reasoning}`,
    );

    return { dramaticState: rawState, purpose: context.purpose, pace: rawPace };
  } catch (error) {
    logger.error(
      'Background Music',
      `Failed to determine music requirement: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * Get the S3 key for a background music file.
 */
export function getBackgroundMusicKey(universeId: string, signature: string): string {
  return `universes/${universeId}/audio/music/bg_${signature}.mp3`;
}

/**
 * Get the S3 URL for a background music file.
 */
function getBackgroundMusicUrl(universeId: string, signature: string): string {
  const key = getBackgroundMusicKey(universeId, signature);
  return storageService.getPublicUrl(key);
}

/**
 * Check if background music exists for a signature and return its URL.
 */
export async function getBackgroundMusic(
  universeId: string,
  signature: string,
): Promise<string | null> {
  const key = getBackgroundMusicKey(universeId, signature);

  if (await storageService.exists(key)) {
    return getBackgroundMusicUrl(universeId, signature);
  }

  return null;
}

/**
 * Build a human-readable description for the music track.
 */
export function buildMusicDescription(requirement: MusicRequirement): string {
  const mood = MOOD_DESCRIPTIONS[requirement.dramaticState];
  const pace = PACE_DESCRIPTIONS[requirement.pace];
  return `${mood.charAt(0).toUpperCase() + mood.slice(1)}, ${pace} RPG music for a ${requirement.purpose} setting.`;
}

/**
 * Build a prompt for ElevenLabs music generation.
 * Instrumentation derived from purpose (natural language); optional universe override.
 */
export function buildMusicPrompt(
  requirement: MusicRequirement,
  universeConfig?: UniverseMusicConfig,
): string {
  const mood = MOOD_DESCRIPTIONS[requirement.dramaticState];
  const pace = PACE_DESCRIPTIONS[requirement.pace];
  const instrumentation =
    universeConfig?.instrumentationOverrides?.[requirement.purpose] ??
    `appropriate for a ${requirement.purpose} setting`;

  return `Instrumental RPG background music.
Mood: ${mood}
Pace: ${pace}
Instrumentation: ${instrumentation}
Style: Cinematic, no vocals, suitable for looping.
Create a cohesive ${DEFAULT_MUSIC_DURATION_SECONDS}-second track that maintains the mood and pace throughout.`;
}

/**
 * Generate background music for a signature and save it.
 *
 * @param signature - The music signature (dramaticState_purpose_pace)
 * @param requirement - The music requirement with dramatic state and setting flavor
 * @param options - Optional configuration for generation
 */
export async function generateBackgroundMusic(
  universeId: string,
  signature: string,
  requirement: MusicRequirement,
  options?: {
    instructions?: string;
    universeConfig?: UniverseMusicConfig;
  },
): Promise<BackgroundMusicResult> {
  logger.info('Background Music', `Generating music for signature: ${signature}`);

  let prompt = buildMusicPrompt(requirement, options?.universeConfig);

  if (options?.instructions?.trim()) {
    prompt += `\nAdditional guidance: ${options.instructions.trim()}`;
  }

  logger.info('Background Music', `Generated prompt for "${signature}": ${prompt.length} chars`);

  try {
    if (process.env.DISABLE_AUDIO_GENERATION === 'true') {
      throw new Error('Audio generation is disabled');
    }

    const result = await generateMusic(prompt, {
      durationSeconds: DEFAULT_MUSIC_DURATION_SECONDS,
      instrumental: true,
    });

    const filename = `bg_${signature}.mp3`;
    const key = getBackgroundMusicKey(universeId, signature);
    const url = await storageService.uploadFile(key, result.audio, 'audio/mpeg');
    const description = buildMusicDescription(requirement);

    await registerMediaEntry(universeId, {
      entityType: 'music',
      mediaType: 'audio',
      extension: 'mp3',
      filename: `music/${filename}`,
      url,
      size: result.audio.length,
      tags: [
        `TAG_${requirement.dramaticState}`,
        `TAG_${requirement.purpose}`,
        `TAG_pace_${requirement.pace}`,
      ],
      description,
    });

    logger.info(
      'Background Music',
      `Music generated and saved for "${signature}": ${url} (${result.audio.length} bytes, ${result.durationMs}ms)`,
    );

    return {
      url,
      filename,
      signature,
      description,
      generated: true,
    };
  } catch (error) {
    logger.error('Background Music', 'Failed to generate music', {
      signature,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get background music for a scene context, generating if necessary.
 *
 * This is the main entry point for the background music system.
 * It determines the appropriate music requirement, checks for cached tracks,
 * and generates new music if needed.
 *
 * @param context - The music context from the scene
 * @param options - Optional configuration including universe config and hints
 * @returns Music result if successful
 */
export async function getOrGenerateBackgroundMusic(
  universeId: string,
  context: MusicContext,
  options?: {
    universeConfig?: UniverseMusicConfig;
    placeHints?: PlaceMusicHints;
    targetMood?: DramaticState;
    targetPace?: MusicPace;
  },
): Promise<BackgroundMusicResult> {
  try {
    const requirement = await determineMusicRequirement(context, options);
    const signature = buildMusicSignature(requirement);

    const existingUrl = await getBackgroundMusic(universeId, signature);
    if (existingUrl) {
      logger.info('Background Music', `Using cached music for "${signature}": ${existingUrl}`);
      return {
        url: existingUrl,
        filename: `bg_${signature}.mp3`,
        signature,
        description: buildMusicDescription(requirement),
        generated: false,
      };
    }

    return await generateBackgroundMusic(universeId, signature, requirement, {
      universeConfig: options?.universeConfig,
    });
  } catch (error) {
    logger.error(
      'Background Music',
      `Failed to get or generate music: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}
