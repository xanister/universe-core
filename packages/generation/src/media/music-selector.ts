/**
 * Music Selector Service
 *
 * Selects appropriate background music based on scene context.
 * Uses LLM to match available tracks to the current situation.
 * Only changes music when the current track is significantly inappropriate for the scene.
 * All operations run async (fire-and-forget) to avoid blocking the main response.
 *
 * Supports:
 * - Universe-level instrumentation overrides
 * - Place-specific music hints
 * - Weather and time-of-day modifiers
 * - Atmosphere tag inference
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { getAudioEntries, type MediaEntry } from '../media-helpers.js';
import { GameDate } from '@dmnpc/core/game-time/game-date.js';
import {
  getOrGenerateBackgroundMusic,
  DRAMATIC_STATES,
  isDramaticState,
  isMusicPace,
} from '../media/background-music-generator.js';
import { inferActivityLevel } from '../media/audio-generator.js';
import type {
  UniverseMusicConfig,
  PlaceMusicHints,
  MusicPace,
  DramaticState,
  MusicContext,
} from '@dmnpc/types/ui';
import type { DramaticRole } from '@dmnpc/types/npc';
import { isEnclosed } from '@dmnpc/types/world';

// Re-export MusicUpdateReason for callers who need it
export type MusicUpdateReason = 'storyteller_event' | 'scene_change' | 'progress_shift' | 'sync';

// ============================================================================
// Types
// ============================================================================

// MusicContext is now imported from types/index.ts

/**
 * Track info for LLM selection.
 */
interface TrackInfo {
  filename: string;
  url: string;
  tags: string[];
  description: string;
}

/** Mood descriptions for each dramatic state (used in selector prompt) */
const MOOD_DESCRIPTIONS: Record<DramaticState, string> = {
  exploration: 'curious, adventurous, forward-moving',
  calm: 'peaceful, reflective, serene',
  progress: 'suspenseful, uneasy, building anticipation',
  combat: 'intense, urgent, dangerous',
  victory: 'triumphant, celebratory, heroic',
  mystery: 'eerie, otherworldly, magical',
  melancholy: 'sad, somber, mournful',
};

/**
 * Music data for playback.
 */
export interface MusicSelection {
  url: string;
  filename: string;
  description?: string;
}

/**
 * Result of evaluating music for a scene.
 * Returned instead of emitting directly - caller decides whether to emit.
 */
export interface MusicSelectionResult {
  /** The selected music (null if music should stop) */
  music: MusicSelection | null;
  /** The reason for the change */
  reason: MusicUpdateReason;
  /** True if music changed (or should be synced), false if unchanged */
  changed: boolean;
}

// Track current music per character to avoid unnecessary changes
const currentMusicByCharacter = new Map<string, string>();

// ============================================================================
// Music Selection Logic
// ============================================================================

/**
 * Get available music tracks from the universe's media.json.
 * Filters to only audio entries that are suitable for background music.
 */
async function getAvailableTracks(universeId: string): Promise<TrackInfo[]> {
  const audioEntries = await getAudioEntries(universeId);

  return audioEntries
    .filter(
      (entry): entry is MediaEntry & { url: string; description: string } =>
        !!entry.url && !!entry.description,
    )
    .map((entry) => ({
      filename: entry.filename,
      url: entry.url,
      tags: entry.tags ?? [],
      description: entry.description,
    }));
}

/**
 * Result of LLM track selection.
 */
interface TrackSelectionResult {
  track: TrackInfo;
  shouldChange: boolean;
  requiredMood: DramaticState;
  requiredPace: MusicPace;
}

/**
 * Use LLM to evaluate if music should change and select the best track.
 * Only recommends changing if the current track is significantly inappropriate.
 */
async function selectTrackWithLlm(
  context: MusicContext,
  tracks: TrackInfo[],
  currentTrack: TrackInfo | null,
): Promise<TrackSelectionResult | null> {
  if (tracks.length === 0) {
    return null;
  }

  // Build track list for the LLM
  const trackList = tracks
    .map(
      (t, i) =>
        `${i + 1}. "${t.filename}" - ${t.description} [tags: ${t.tags.join(', ') || 'none'}]`,
    )
    .join('\n');

  // Build scene context
  const sceneDesc = [
    `Location: ${context.placeLabel} (${context.isInterior ? 'interior' : 'exterior'})`,
    `Description: ${context.placeDescription}`,
    `Tags: ${context.placeTags.join(', ') || 'none'}`,
    `Time: ${context.timeOfDay}`,
    `Weather: ${context.weather}`,
    `Current event: ${context.eventType}`,
    `Activity level: ${context.activityLevel}`,
  ].join('\n');

  // Build current situation context from transcript
  const situationContext = `CURRENT SITUATION:\n${context.recentTranscript}`;

  // Build current track context
  const currentTrackDesc = currentTrack
    ? `"${currentTrack.filename}" - ${currentTrack.description}`
    : 'No music currently playing';

  // Build mood options list
  const moodsList = DRAMATIC_STATES.map((s) => `- ${s}: ${MOOD_DESCRIPTIONS[s]}`).join('\n');

  const prompt = `You are evaluating background music for an RPG scene.

SCENE CONTEXT:
${sceneDesc}

${situationContext}

CURRENTLY PLAYING:
${currentTrackDesc}

AVAILABLE TRACKS:
${trackList}

MOOD OPTIONS (choose one that best fits the current scene):
${moodsList}

PACE OPTIONS (choose one that best fits the scene's tempo):
- fast: Urgent, energetic, action-oriented (combat, chases, intense moments)
- medium: Balanced, steady, forward-moving (exploration, travel, moderate activity)
- slow: Deliberate, contemplative, relaxed (calm moments, reflection, peaceful scenes)

Your task:
1. First, determine the appropriate mood for the scene based on what's happening
2. Determine the appropriate pace (fast/medium/slow) based on scene urgency and energy
3. Evaluate if the current track matches that mood and pace
4. Only recommend changing if the current track is clearly inappropriate for the mood or pace
5. Select the best available track that matches the mood and pace (check track tags like TAG_calm, TAG_tension, etc.)
   - If no tracks match the required mood, select the closest available option
   - The system will generate appropriate music if your selection doesn't match the mood

Consider:
- What is happening RIGHT NOW in the scene (from the transcript)
- Are there immediate threats, chases, or dangers? → progress/combat mood, fast pace
- Is there a performance, celebration, or victory? → victory mood, fast/medium pace
- Is the scene mysterious, magical, or eerie? → mystery mood, slow/medium pace
- Is it a quiet moment of reflection or rest? → calm/melancholy mood, slow pace
- Is the player exploring or traveling? → exploration mood, medium pace
- Continuity matters - avoid jarring changes for minor scene shifts
- Match track tags to the mood: TAG_calm for calm, TAG_tension for progress, TAG_combat for combat, etc.
- Pace should match scene urgency: fast for action, slow for contemplation, medium for normal activity

If no music is playing, always recommend a track (shouldChange: true).`;

  interface SelectionResponse {
    mood: string;
    pace: string;
    trackNumber: number;
    shouldChange: boolean;
    reasoning: string;
  }

  try {
    const result = await queryLlm<SelectionResponse>({
      prompt,
      complexity: 'simple', // Use mini for reliable structured output
      context: 'Music Selector',
      schema: {
        name: 'music_selection',
        schema: {
          type: 'object',
          properties: {
            mood: {
              type: 'string',
              enum: [...DRAMATIC_STATES],
              description: 'The mood that best fits the current scene',
            },
            pace: {
              type: 'string',
              enum: ['fast', 'medium', 'slow'],
              description:
                'The pacing/tempo that best fits the current scene (fast for urgent/action, slow for contemplative, medium for balanced)',
            },
            trackNumber: {
              type: 'number',
              description: `Best matching track number (1-${tracks.length})`,
            },
            shouldChange: {
              type: 'boolean',
              description:
                'True only if current track is inappropriate for the mood or pace. False if current track is acceptable.',
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation for the decision (1 sentence)',
            },
          },
          required: ['mood', 'pace', 'trackNumber', 'shouldChange', 'reasoning'],
          additionalProperties: false,
        },
      },
    });

    const trackIndex = result.content.trackNumber - 1;

    if (trackIndex < 0 || trackIndex >= tracks.length) {
      const error = new Error(
        `Invalid track number returned by LLM: ${result.content.trackNumber} (valid range: 1-${tracks.length})`,
      );
      logger.error(
        'Music Selector',
        `LLM returned invalid track number: ${result.content.trackNumber}`,
        {
          trackNumber: result.content.trackNumber,
          tracksLength: tracks.length,
          validRange: `1-${tracks.length}`,
        },
      );
      throw error;
    }

    const selectedTrack = tracks[trackIndex];

    // Validate pace and mood from LLM response
    const rawPace = result.content.pace;
    const rawMood = result.content.mood;

    if (!isMusicPace(rawPace)) {
      throw new Error(`Invalid LLM music pace: ${rawPace}`);
    }
    if (!isDramaticState(rawMood)) {
      throw new Error(`Invalid LLM dramatic state: ${rawMood}`);
    }

    logger.info(
      'Music Selector',
      `Evaluation: mood=${rawMood} pace=${rawPace} shouldChange=${result.content.shouldChange} reasoning="${result.content.reasoning}"`,
    );

    return {
      track: selectedTrack,
      shouldChange: result.content.shouldChange,
      requiredMood: rawMood,
      requiredPace: rawPace,
    };
  } catch (error) {
    logger.error(
      'Music Selector',
      `LLM selection failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }
}

/**
 * Extended music context including universe config and place hints.
 */
interface ExtendedMusicContext {
  universeId: string;
  context: MusicContext;
  universeConfig?: UniverseMusicConfig;
  placeHints?: PlaceMusicHints;
}

/**
 * Build music context from character state.
 * Returns both the context and optional universe/place configuration.
 */
function buildMusicContext(
  ctx: UniverseContext,
  characterId: string,
  options: { eventType: string; recentTranscript: string },
): ExtendedMusicContext {
  try {
    const character = ctx.getCharacter(characterId);
    const placeId = character.position.parent;
    if (!placeId) {
      throw new Error(`Character has no parent place: characterId=${characterId}`);
    }
    const place = ctx.getPlace(placeId);
    const universe = ctx.universe;

    if (!universe.calendar) {
      throw new Error(`Universe calendar missing for music context: universeId=${ctx.universeId}`);
    }
    const gameDate = GameDate.tryParse(universe.calendar, universe.date);
    if (!gameDate) {
      throw new Error(
        `Failed to parse universe date for music context: universeId=${ctx.universeId} date=${universe.date}`,
      );
    }
    const timeOfDay = gameDate.timeOfDay;

    // Infer activity level from place characteristics, time, and weather
    if (!options.eventType) {
      throw new Error(`Event type missing for music context: characterId=${characterId}`);
    }

    const activityLevel = inferActivityLevel({
      place,
      timeOfDay,
      weather: universe.weather ?? undefined,
    });

    const context: MusicContext = {
      purpose: place.info.purpose,
      placeTags: place.tags,
      placeLabel: place.label,
      placeDescription: place.description || place.short_description,
      isInterior: isEnclosed(place.info.environment),
      timeOfDay,
      weather: universe.weather ?? null,
      eventType: options.eventType,
      activityLevel,
      recentTranscript: options.recentTranscript,
    };

    return {
      universeId: ctx.universeId,
      context,
      universeConfig: universe.music ?? undefined,
      placeHints: place.info.musicHints ?? undefined,
    };
  } catch (error) {
    logger.error(
      'Music Selector',
      `Failed to build music context: ${error instanceof Error ? error.message : String(error)}`,
      {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Evaluate and potentially update music for a scene.
 * Returns the music selection result - caller decides whether to emit via WebSocket.
 * Only changes music if the current track is significantly inappropriate for the scene.
 *
 * Uses universe config for instrumentation overrides and place hints for
 * location-specific music preferences.
 *
 * @param ctx - Universe context (required - caller must load context)
 * @param characterId - The character to evaluate music for
 * @param options - Additional context for selection
 * @returns MusicSelectionResult if music should change or sync, null if no action needed
 */
export async function evaluateMusicForScene(
  ctx: UniverseContext,
  characterId: string,
  options: {
    reason?: MusicUpdateReason;
    eventType: string;
    recentTranscript: string;
  },
): Promise<MusicSelectionResult | null> {
  const startTime = Date.now();
  const reason = options.reason ?? 'scene_change';

  try {
    // Build context first (needed for both selection and generation)
    const extendedContext = buildMusicContext(ctx, characterId, {
      eventType: options.eventType,
      recentTranscript: options.recentTranscript,
    });

    const { context, universeConfig, placeHints } = extendedContext;

    // Get available tracks
    const tracks = await getAvailableTracks(ctx.universeId);

    // If no tracks available, generate one
    if (tracks.length === 0) {
      logger.info('Music Selector', 'No music tracks available, triggering generation');
      const generated = await getOrGenerateBackgroundMusic(ctx.universeId, context, {
        universeConfig,
        placeHints,
      });
      const durationMs = Date.now() - startTime;
      currentMusicByCharacter.set(characterId, generated.url);

      logger.info(
        'Music Selector',
        `Music generated and playing: filename=${generated.filename} signature=${generated.signature} reason=${reason} durationMs=${durationMs}`,
      );

      return {
        music: {
          url: generated.url,
          filename: generated.filename,
          description: generated.description,
        },
        reason,
        changed: true,
      };
    }

    // Find current track info (if any)
    const currentMusicUrl = currentMusicByCharacter.get(characterId);
    const currentTrack = currentMusicUrl
      ? (tracks.find((t) => t.url === currentMusicUrl) ?? null)
      : null;

    // Evaluate and select track
    const result = await selectTrackWithLlm(context, tracks, currentTrack);
    if (!result) {
      return null;
    }

    const { track: selectedTrack, shouldChange, requiredMood, requiredPace } = result;
    const durationMs = Date.now() - startTime;

    // Only update if LLM determined a change is warranted
    if (!shouldChange) {
      logger.info(
        'Music Selector',
        `Music unchanged (appropriate for scene): filename=${currentTrack?.filename ?? 'none'} durationMs=${durationMs}`,
      );

      // On scene_change (subscribe), always sync client with current music even if unchanged
      if (reason === 'scene_change' && currentTrack) {
        logger.info(
          'Music Selector',
          `Synced existing music to client: filename=${currentTrack.filename}`,
        );
        return {
          music: {
            url: currentTrack.url,
            filename: currentTrack.filename,
            description: currentTrack.description,
          },
          reason: 'sync',
          changed: false,
        };
      }
      return null;
    }

    // Check if the selected track actually matches the required mood and pace
    // If it doesn't match, generate new music instead of using an inappropriate track
    const trackMoodTag = `TAG_${requiredMood}`;
    const trackPaceTag = `TAG_pace_${requiredPace}`;
    const trackMatchesMood = selectedTrack.tags.includes(trackMoodTag);
    const trackMatchesPace = selectedTrack.tags.includes(trackPaceTag);

    if (!trackMatchesMood || !trackMatchesPace) {
      logger.info(
        'Music Selector',
        `Selected track does not match required mood/pace: requiredMood=${requiredMood} requiredPace=${requiredPace} trackTags=${selectedTrack.tags.join(', ')} triggering generation`,
      );
      const generated = await getOrGenerateBackgroundMusic(ctx.universeId, context, {
        universeConfig,
        placeHints,
        targetMood: requiredMood,
        targetPace: requiredPace,
      });
      const generationDurationMs = Date.now() - startTime;
      currentMusicByCharacter.set(characterId, generated.url);

      logger.info(
        'Music Selector',
        `Music generated and playing: filename=${generated.filename} mood=${requiredMood} reason=${reason} durationMs=${generationDurationMs}`,
      );

      return {
        music: {
          url: generated.url,
          filename: generated.filename,
          description: generated.description,
        },
        reason,
        changed: true,
      };
    }

    // Update tracking and return
    currentMusicByCharacter.set(characterId, selectedTrack.url);

    logger.info(
      'Music Selector',
      `Music changed: filename=${selectedTrack.filename} reason=${reason} durationMs=${durationMs}`,
    );

    return {
      music: {
        url: selectedTrack.url,
        filename: selectedTrack.filename,
        description: selectedTrack.description,
      },
      reason,
      changed: true,
    };
  } catch (error) {
    logger.error(
      'Music Selector',
      `Failed to evaluate music: ${error instanceof Error ? error.message : String(error)}`,
      {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }
}

/**
 * Maps DramaticRole to the target { mood, pace } for music selection.
 * Used by selectMusicForDramaticRole to bypass LLM evaluation.
 */
const DRAMATIC_ROLE_MUSIC: Record<DramaticRole, { mood: DramaticState; pace: MusicPace }> = {
  inciting_incident: { mood: 'progress', pace: 'medium' },
  rising_action: { mood: 'progress', pace: 'medium' },
  midpoint: { mood: 'mystery', pace: 'slow' },
  crisis: { mood: 'combat', pace: 'fast' },
  climax: { mood: 'combat', pace: 'fast' },
  resolution: { mood: 'calm', pace: 'slow' },
};

/**
 * Forces a music change keyed to the narrative weight of a turning point.
 * Bypasses LLM evaluation — maps dramaticRole to { mood, pace } and picks the
 * best available tagged track without an LLM call.
 *
 * If no matching track is found, logs a warning and returns null so the regular
 * evaluateMusicForScene call can handle it.
 *
 * Updates currentMusicByCharacter on success so that the subsequent
 * evaluateMusicForScene sees the new track as "current" and avoids overwriting it.
 *
 * Caller (in packages/game) is responsible for emitting the result via emitMusicUpdated
 * and handling errors via .catch().
 *
 * @returns MusicSelectionResult if a track was selected, null if no match found.
 */
export async function selectMusicForDramaticRole(
  ctx: UniverseContext,
  characterId: string,
  role: DramaticRole,
): Promise<MusicSelectionResult | null> {
  const { mood, pace } = DRAMATIC_ROLE_MUSIC[role];
  const moodTag = `TAG_${mood}`;
  const paceTag = `TAG_pace_${pace}`;

  const tracks = await getAvailableTracks(ctx.universeId);
  const match = tracks.find((t) => t.tags.includes(moodTag) && t.tags.includes(paceTag));

  if (!match) {
    logger.warn(
      'Music Selector',
      `No track found for dramaticRole=${role} (mood=${mood}, pace=${pace}) — skipping forced music`,
    );
    return null;
  }

  currentMusicByCharacter.set(characterId, match.url);

  logger.info(
    'Music Selector',
    `Forced music for dramaticRole=${role}: filename=${match.filename}`,
  );

  return {
    music: { url: match.url, filename: match.filename, description: match.description },
    reason: 'storyteller_event',
    changed: true,
  };
}

/**
 * Clear tracked music for a character.
 * Call when character is reset or unloaded.
 */
export function clearMusicTracking(characterId: string): void {
  currentMusicByCharacter.delete(characterId);
}

/**
 * Clear all music tracking.
 * Call on universe reset.
 */
export function clearAllMusicTracking(): void {
  currentMusicByCharacter.clear();
}
