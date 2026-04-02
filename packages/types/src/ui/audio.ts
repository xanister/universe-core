/**
 * Sound effect registry types.
 *
 * The sound registry is a data-driven JSON file listing all sound effects
 * with ElevenLabs generation prompts. The dev-tools CLI generates MP3 assets
 * from prompts; the client sound manager loads the registry and plays sounds.
 */

/** Sound effect categories for volume control. */
export type SoundCategory = 'ui' | 'combat' | 'interaction';

/** A single entry in the sound effects registry. */
export interface SoundRegistryEntry {
  /** Unique identifier, e.g. "ui_click", "combat_sword_swing" */
  soundId: string;
  /** Volume category for per-category volume control */
  category: SoundCategory;
  /** ElevenLabs generation prompt (required for CLI generation) */
  prompt: string;
  /** Duration in seconds for generation (0.5-30, default 1) */
  durationSeconds?: number;
  /** Prompt influence for generation (0-1, default 0.3) */
  promptInfluence?: number;
  /** Base volume for this sound (0-1, default 1) */
  volume?: number;
  /** Relative paths to generated MP3 files (e.g. ["ui_click.mp3"]) */
  files: string[];
}

/** Top-level shape of sound-registry.json. */
export interface SoundRegistryFile {
  version: string;
  sounds: SoundRegistryEntry[];
}
