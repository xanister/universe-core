/**
 * Voice Matcher Service
 *
 * Provides utilities for loading and formatting voices from the registry.
 * Voice selection is now integrated directly into character generation.
 */

import type { VoiceRegistryEntry } from '@dmnpc/types/ui';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { VOICE_REGISTRY_PATH } from '@dmnpc/data';

/**
 * Get available (enabled) voices from the registry.
 */
export function getAvailableVoices(): VoiceRegistryEntry[] {
  const registry = readJsonFileSync<VoiceRegistryEntry[]>(VOICE_REGISTRY_PATH);
  return registry.filter((v) => v.enabled);
}

/**
 * Format available voices for the LLM prompt using rich metadata.
 */
export function formatVoicesForPrompt(voices: VoiceRegistryEntry[]): string {
  return voices
    .map((v) => {
      const meta = v.metadata;
      const traitsStr = meta.traits.length > 0 ? ` traits: [${meta.traits.join(', ')}]` : '';
      const suitStr =
        meta.suitableFor.length > 0 ? ` suitableFor: [${meta.suitableFor.join(', ')}]` : '';
      return `- ${v.id}: "${v.name}" (${meta.gender}, ${meta.ageRange}${meta.accent ? `, ${meta.accent}` : ''})${traitsStr}${suitStr} — ${v.description}`;
    })
    .join('\n');
}
