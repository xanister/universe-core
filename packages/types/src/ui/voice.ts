/**
 * Voice registry and provider abstraction types.
 *
 * Characters, storytellers, templates, the LLM, and the player UI all
 * reference voices by registry ID only.  Provider details (ElevenLabs)
 * are encapsulated inside registry entries and internal to the TTS client.
 */

// ============================================================================
// Voice Registry Types
// ============================================================================

/** Rich metadata attached to a voice registry entry. */
export interface VoiceMetadata {
  gender: 'male' | 'female' | 'nonbinary';
  ageRange: 'young' | 'middle-aged' | 'elderly';
  /** e.g. "British", "American", "" (empty = neutral) */
  accent: string;
  /** e.g. ["warm", "authoritative", "mysterious"] */
  traits: string[];
  /** e.g. ["noble", "merchant", "warrior", "narrator"] */
  suitableFor: string[];
}

/** Provider-specific config. Admin UI edits this; player UI never sees it. */
export interface ElevenLabsProviderConfig {
  type: 'elevenlabs';
  /** ElevenLabs voice ID (e.g. "EXAVITQu4vr4xnSDxMaL") */
  voiceId: string;
  settings: {
    stability: number | null;
    similarityBoost: number | null;
    style: number | null;
    speed: number | null;
  };
}

/** Union type for future providers. */
export type VoiceProviderConfig = ElevenLabsProviderConfig;

/** A curated voice in the registry. */
export interface VoiceRegistryEntry {
  /** Stable slug ID (e.g. "sarah", "daniel", "cloned-nick") */
  id: string;
  /** Display name (e.g. "Sarah - Mature & Reassuring") */
  name: string;
  /** For LLM + player selection */
  description: string;
  /** How it was created */
  source: 'preset' | 'clone';
  /** Available to players/LLM when true */
  enabled: boolean;
  metadata: VoiceMetadata;
  provider: VoiceProviderConfig;
}
