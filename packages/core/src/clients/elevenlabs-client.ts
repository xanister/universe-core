import { config } from '../infra/config.js';
import { logger } from '../infra/logger.js';

/**
 * ElevenLabs voice settings for fine-tuning speech output.
 * Internal to the TTS client — not exposed in public types.
 */
export interface ElevenLabsVoiceSettings {
  stability: number | null;
  similarityBoost: number | null;
  style: number | null;
  speed: number | null;
}

/** Counter for generating unique request IDs. */
let requestCounter = 0;

/** ElevenLabs API base URL. */
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

/**
 * Options for sound effect generation.
 */
export interface GenerateSoundEffectOptions {
  /** Duration in seconds (0.5 to 30). Defaults to automatic. */
  durationSeconds?: number;
  /** Influence of the prompt on generation (0-1). Higher = more literal. */
  promptInfluence?: number;
  /** If true, generates audio that loops seamlessly. */
  loop?: boolean;
}

/**
 * Result from sound effect generation.
 */
export interface SoundEffectResult {
  /** The generated audio as a Buffer. */
  audio: Buffer;
  /** Duration in milliseconds for the API call. */
  durationMs: number;
}

/**
 * Options for music generation.
 */
export interface GenerateMusicOptions {
  /** Duration in seconds (60-180). Defaults to 90 for good looping. */
  durationSeconds?: number;
  /** If true, generates instrumental music without vocals. Defaults to true. */
  instrumental?: boolean;
}

/**
 * Result from music generation.
 */
export interface MusicResult {
  /** The generated audio as a Buffer. */
  audio: Buffer;
  /** Duration in milliseconds for the API call. */
  durationMs: number;
}

/**
 * Error response from ElevenLabs API.
 */
export interface ElevenLabsErrorResponse {
  status: number;
  message: string;
}

/**
 * Voice metadata from ElevenLabs API.
 */
export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string;
  preview_url?: string;
}

/**
 * Extract a human-readable error message from an API error response body.
 */
function extractApiErrorMessage(errorText: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(errorText);
    if (typeof parsed !== 'object' || parsed === null) return fallback;

    if ('detail' in parsed) {
      const { detail } = parsed;
      if (typeof detail === 'object' && detail !== null && 'message' in detail) {
        const { message } = detail;
        if (typeof message === 'string') return message;
      }
    }

    if ('message' in parsed) {
      const { message } = parsed;
      if (typeof message === 'string') return message;
    }
  } catch {
    // Use fallback if JSON parsing fails
  }
  return fallback;
}

/**
 * Generate a unique correlation ID for tracking requests.
 * Format: `el-{timestamp}-{counter}`
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const counter = (++requestCounter).toString(36).padStart(4, '0');
  return `el-${timestamp}-${counter}`;
}

/**
 * Generate a sound effect from a text prompt using ElevenLabs API.
 *
 * @param prompt - Text description of the sound effect to generate
 * @param options - Optional generation parameters
 * @returns The generated audio as a Buffer
 *
 * @example
 * ```typescript
 * const result = await generateSoundEffect(
 *   'Ambient tavern sounds: crackling fireplace, distant chatter, clinking glasses',
 *   { durationSeconds: 10 }
 * );
 * await writeFile('tavern_ambient.mp3', result.audio);
 * ```
 */
export async function generateSoundEffect(
  prompt: string,
  options?: GenerateSoundEffectOptions,
): Promise<SoundEffectResult> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  if (!config.elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  const requestBody: Record<string, unknown> = {
    text: prompt,
  };

  if (options?.durationSeconds !== undefined) {
    requestBody.duration_seconds = options.durationSeconds;
  }

  if (options?.promptInfluence !== undefined) {
    requestBody.prompt_influence = options.promptInfluence;
  }

  if (options?.loop !== undefined) {
    requestBody.loop = options.loop;
  }

  logger.info(
    'ElevenLabs',
    `[${correlationId}] Calling sound-generation API: prompt="${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}", duration=${String(requestBody.duration_seconds)}s`,
  );

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/sound-generation`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenLabsApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = extractApiErrorMessage(
        errorText,
        `ElevenLabs API error: ${response.status}`,
      );

      logger.error('ElevenLabs', `[${correlationId}] API error`, {
        status: response.status,
        error: errorMessage,
        durationMs,
      });

      throw new Error(errorMessage);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    logger.info(
      'ElevenLabs',
      `[${correlationId}] Sound effect generated: ${audio.length} bytes in ${durationMs}ms`,
    );

    return { audio, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof Error && error.message.includes('ElevenLabs API error')) {
      throw error;
    }

    logger.error('ElevenLabs', `[${correlationId}] Failed to generate sound effect`, {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });

    throw error;
  }
}

/**
 * Generate music from a text prompt using ElevenLabs Music API.
 *
 * @param prompt - Text description of the music to generate
 * @param options - Optional generation parameters
 * @returns The generated audio as a Buffer
 *
 * @example
 * ```typescript
 * const result = await generateMusic(
 *   'Instrumental fantasy RPG background music. Mood: exploration. Instrumentation: lute, flute.',
 *   { durationSeconds: 90, instrumental: true }
 * );
 * await writeFile('exploration_tavern.mp3', result.audio);
 * ```
 */
export async function generateMusic(
  prompt: string,
  options?: GenerateMusicOptions,
): Promise<MusicResult> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  if (!config.elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  const durationMs = options?.durationSeconds ? options.durationSeconds * 1000 : undefined;

  const requestBody: Record<string, unknown> = {
    prompt,
    model_id: 'music_v1',
    force_instrumental: options?.instrumental ?? true,
  };

  if (durationMs !== undefined) {
    requestBody.music_length_ms = durationMs;
  }

  logger.info(
    'ElevenLabs',
    `[${correlationId}] Calling music API: prompt="${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}", duration=${options?.durationSeconds ?? 'auto'}s, instrumental=${String(requestBody.force_instrumental)}`,
  );

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/music`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenLabsApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = extractApiErrorMessage(
        errorText,
        `ElevenLabs Music API error: ${response.status}`,
      );

      logger.error('ElevenLabs', `[${correlationId}] Music API error`, {
        status: response.status,
        error: errorMessage,
        durationMs,
      });

      throw new Error(errorMessage);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);

    logger.info(
      'ElevenLabs',
      `[${correlationId}] Music generated: ${audio.length} bytes in ${durationMs}ms`,
    );

    return { audio, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof Error && error.message.includes('ElevenLabs Music API error')) {
      throw error;
    }

    logger.error('ElevenLabs', `[${correlationId}] Failed to generate music`, {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });

    throw error;
  }
}

/**
 * Handle ElevenLabs API errors with specific messages.
 */
export function handleElevenLabsError(error: unknown): ElevenLabsErrorResponse {
  const status = getErrorStatus(error);
  const message = getErrorMessageString(error);

  if (status === 401) {
    return {
      status: 401,
      message: 'Invalid API key. Please check your ELEVENLABS_API_KEY environment variable.',
    };
  }

  if (status === 429) {
    return {
      status: 429,
      message: 'Rate limit exceeded. Please wait and try again.',
    };
  }

  if (status === 422) {
    return {
      status: 422,
      message: 'Invalid request parameters. Check prompt length and duration.',
    };
  }

  return {
    status: status || 500,
    message: message || 'Failed to generate sound effect',
  };
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function getErrorMessageString(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

/**
 * Response shape from GET /v1/voices.
 */
interface ListVoicesResponse {
  voices: ElevenLabsVoice[];
}

/**
 * Lists all available voices from ElevenLabs.
 *
 * @param apiKey - ElevenLabs API key (pass explicitly to allow route-level control)
 * @returns Array of voice metadata
 */
export async function listElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  logger.info('ElevenLabs', `[${correlationId}] Fetching voices list`);

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'xi-api-key': apiKey,
    },
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('ElevenLabs', `[${correlationId}] Failed to list voices`, {
      status: response.status,
      error: errorText,
      durationMs,
    });
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ElevenLabs REST API response; no SDK types available
  const data = (await response.json()) as ListVoicesResponse;
  logger.info(
    'ElevenLabs',
    `[${correlationId}] Fetched ${data.voices.length} voices in ${durationMs}ms`,
  );

  return data.voices;
}

/**
 * Create a cloned voice on ElevenLabs via the IVC API.
 *
 * @param apiKey - ElevenLabs API key
 * @param name - Display name for the cloned voice
 * @param audioBuffer - Audio sample buffer (webm, mp3, or wav)
 * @param options - Optional clone settings
 * @returns The ElevenLabs voice_id of the created clone
 */
export async function createVoiceClone(
  apiKey: string,
  name: string,
  audioBuffer: Buffer,
  options?: { removeBackgroundNoise?: boolean },
): Promise<string> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  logger.info('ElevenLabs', `[${correlationId}] Creating voice clone: name="${name}"`);

  const boundary = `----ElevenLabsBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`),
  );

  if (options?.removeBackgroundNoise) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="remove_background_noise"\r\n\r\ntrue\r\n`,
      ),
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`,
    ),
  );
  parts.push(audioBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const response = await fetch(`${ELEVENLABS_API_URL}/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    const errorMessage = extractApiErrorMessage(
      errorText,
      `ElevenLabs clone API error: ${response.status}`,
    );
    logger.error('ElevenLabs', `[${correlationId}] Clone API error`, {
      status: response.status,
      error: errorMessage,
      durationMs,
    });
    throw new Error(errorMessage);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ElevenLabs REST API response
  const data = (await response.json()) as { voice_id: string };
  logger.info(
    'ElevenLabs',
    `[${correlationId}] Voice clone created: voiceId=${data.voice_id} in ${durationMs}ms`,
  );

  return data.voice_id;
}

/**
 * Delete a voice from ElevenLabs.
 *
 * @param apiKey - ElevenLabs API key
 * @param voiceId - ElevenLabs voice ID to delete
 */
export async function deleteElevenLabsVoice(apiKey: string, voiceId: string): Promise<void> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  logger.info('ElevenLabs', `[${correlationId}] Deleting voice: voiceId=${voiceId}`);

  const response = await fetch(`${ELEVENLABS_API_URL}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: {
      'xi-api-key': apiKey,
    },
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    const errorMessage = extractApiErrorMessage(
      errorText,
      `ElevenLabs delete API error: ${response.status}`,
    );
    logger.error('ElevenLabs', `[${correlationId}] Delete API error`, {
      status: response.status,
      error: errorMessage,
      durationMs,
    });
    throw new Error(errorMessage);
  }

  logger.info('ElevenLabs', `[${correlationId}] Voice deleted in ${durationMs}ms`);
}

/**
 * Default ElevenLabs model for speech generation.
 */
const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';

/**
 * Default voice settings if none provided.
 */
const DEFAULT_VOICE_SETTINGS: Required<ElevenLabsVoiceSettings> = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1.0,
};

/**
 * Generates speech audio using ElevenLabs TTS.
 *
 * @param apiKey - ElevenLabs API key (pass explicitly to allow route-level control)
 * @param voiceId - ElevenLabs voice ID
 * @param text - Text to synthesize
 * @param settings - Optional voice settings
 * @returns Audio buffer (MP3 format)
 *
 * @example
 * ```typescript
 * const audio = await generateElevenLabsSpeech(
 *   process.env.ELEVENLABS_API_KEY,
 *   '21m00Tcm4TlvDq8ikWAM',
 *   'Hello, world!',
 *   { stability: 0.3, similarityBoost: 0.8 }
 * );
 * ```
 */
export async function generateElevenLabsSpeech(
  apiKey: string,
  voiceId: string,
  text: string,
  settings?: ElevenLabsVoiceSettings,
): Promise<Buffer> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  logger.info(
    'ElevenLabs',
    `[${correlationId}] Generating TTS: length=${text.length} voiceId=${voiceId}`,
  );

  const mergedSettings = { ...DEFAULT_VOICE_SETTINGS, ...settings };

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_TTS_MODEL,
        voice_settings: {
          stability: mergedSettings.stability,
          similarity_boost: mergedSettings.similarityBoost,
          style: mergedSettings.style,
          speed: mergedSettings.speed,
        },
      }),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('ElevenLabs', `[${correlationId}] TTS API error`, {
        status: response.status,
        voiceId,
        textLength: text.length,
        error: errorText,
        durationMs,
      });
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    logger.info(
      'ElevenLabs',
      `[${correlationId}] TTS generated: ${audioBuffer.length} bytes in ${durationMs}ms`,
    );

    return audioBuffer;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof Error && error.message.includes('ElevenLabs API error')) {
      throw error;
    }

    logger.error('ElevenLabs', `[${correlationId}] Failed to generate TTS`, {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });

    throw error;
  }
}
