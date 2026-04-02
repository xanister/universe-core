/**
 * Speech Generator Service
 *
 * Generates speech audio from text using ElevenLabs TTS.
 * Caches results by fingerprint to avoid redundant API calls.
 * Resolves voice configuration from character or storyteller state via the voice registry.
 */

import { createHash } from 'crypto';
import createHttpError from 'http-errors';
import type { VoiceRegistryEntry } from '@dmnpc/types/ui';
import {
  generateElevenLabsSpeech,
  type ElevenLabsVoiceSettings,
} from '@dmnpc/core/clients/elevenlabs-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { VOICE_REGISTRY_PATH } from '@dmnpc/data';

/** Resolved voice ready for TTS synthesis. */
export interface ResolvedVoice {
  voiceId: string;
  settings: ElevenLabsVoiceSettings;
}

/**
 * Generates a fingerprint for a speech request.
 * SHA-256 hash of the normalized text, voice ID, and settings.
 */
function generateFingerprint(text: string, voice: ResolvedVoice): string {
  const normalizedText = text.trim().normalize('NFC').replace(/\s+/g, ' ');

  const s = voice.settings;
  const settingsStr = `:${s.stability ?? ''}:${s.similarityBoost ?? ''}:${s.style ?? ''}:${s.speed ?? ''}`;
  const voiceKey = `elevenlabs:${voice.voiceId}${settingsStr}`;

  const input = `${voiceKey}:${normalizedText}`;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function getCacheKey(fingerprint: string): string {
  return `cache/speech/${fingerprint}.mp3`;
}

async function getCachedAudio(fingerprint: string): Promise<Buffer | null> {
  const key = getCacheKey(fingerprint);
  return await storageService.downloadFile(key);
}

async function cacheAudio(fingerprint: string, audioBuffer: Buffer): Promise<void> {
  const key = getCacheKey(fingerprint);
  await storageService.uploadFile(key, audioBuffer, 'audio/mpeg');
}

export type GenerateSpeechResult = {
  audio: Buffer;
  cached: boolean;
};

/**
 * Look up a voice registry entry by its slug ID.
 */
export function findVoiceEntry(registryId: string): VoiceRegistryEntry {
  const registry = readJsonFileSync<VoiceRegistryEntry[]>(VOICE_REGISTRY_PATH);
  const entry = registry.find((v) => v.id === registryId);
  if (!entry) {
    throw createHttpError.BadRequest(`Voice "${registryId}" not found in registry`);
  }
  return entry;
}

/**
 * Resolves a voice registry ID to provider-specific config for TTS synthesis.
 *
 * @param ctx - Universe context
 * @param speakerId - Character ID (e.g., "CHAR_xanister") or "storyteller" for narration
 * @param playerCharacterId - Required when speakerId is "storyteller" to access storyteller state
 * @returns Resolved voice ready for ElevenLabs
 * @throws Error if speaker not found or voice not configured
 */
export function resolveVoiceForTTS(
  ctx: UniverseContext,
  speakerId: string,
  playerCharacterId?: string,
): ResolvedVoice {
  let registryId: string;

  if (speakerId === 'storyteller') {
    if (!playerCharacterId) {
      throw createHttpError.BadRequest(
        'playerCharacterId is required when speakerId is "storyteller"',
      );
    }

    const playerCharacter = ctx.findCharacter(playerCharacterId);
    if (!playerCharacter) {
      throw createHttpError.NotFound(`Player character ${playerCharacterId} not found`);
    }

    const storytellerState = playerCharacter.info.storytellerState;
    if (!storytellerState) {
      throw createHttpError.BadRequest(
        `Player character ${playerCharacterId} has no storyteller state`,
      );
    }

    registryId = storytellerState.voiceId;
  } else {
    const character = ctx.findCharacter(speakerId);
    if (!character) {
      throw createHttpError.NotFound(`Character ${speakerId} not found`);
    }
    registryId = character.info.voiceId;
  }

  const entry = findVoiceEntry(registryId);
  return {
    voiceId: entry.provider.voiceId,
    settings: entry.provider.settings,
  };
}

/**
 * Generates speech audio for the given text and resolved voice.
 * Returns cached audio if available.
 *
 * @param text - Text to synthesize
 * @param voice - Resolved voice (from resolveVoiceForTTS or direct)
 */
export async function generateSpeech(
  text: string,
  voice: ResolvedVoice,
): Promise<GenerateSpeechResult> {
  const fingerprint = generateFingerprint(text, voice);

  // Check cache first
  const cachedAudio = await getCachedAudio(fingerprint);
  if (cachedAudio) {
    logger.info(
      'Speech',
      `Cache hit: fingerprint=${fingerprint.slice(0, 12)}... size=${cachedAudio.length}`,
    );
    return { audio: cachedAudio, cached: true };
  }

  // Generate via ElevenLabs
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY environment variable is not set');
  }

  const audio = await generateElevenLabsSpeech(apiKey, voice.voiceId, text, voice.settings);

  // Cache in background
  void cacheAudio(fingerprint, audio);

  return { audio, cached: false };
}
