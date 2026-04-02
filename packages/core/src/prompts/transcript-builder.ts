/**
 * Transcript Building (Shared)
 *
 * Utilities for building formatted transcripts of chat messages.
 * Extracted for use by generation/ layer (scene-image-generator, journal-entry-generator).
 */

import { type GameMessage, getMessageText } from '@dmnpc/types/game';

/**
 * Build a transcript of recent messages with speaker information and timestamps.
 *
 * Messages with `omitFromTranscript: true` are excluded (e.g., error messages).
 *
 * Format:
 * - [date] PLAYER: {content}
 * - [date] DM: {content}
 * - [date] DM [{speakerLabel}]: {content}  (when speaker label is available)
 *
 * NOTE: Speaker IDs are intentionally excluded to prevent leaking character names
 * that the player hasn't learned yet.
 */
export function buildActionTranscript(
  messages: GameMessage[] | null | undefined,
  limit = 12,
): string {
  if (!messages || !Array.isArray(messages)) {
    return '';
  }
  return messages
    .filter((m) => {
      if (m.role !== 'user' && m.role !== 'assistant') return false;
      if (m.omitFromTranscript) return false;
      return true;
    })
    .slice(-Math.max(0, limit))
    .map((m) => {
      const content = (getMessageText(m) ?? '').trim();
      if (!content) return '';

      const datePrefix = m.date ? `[${m.date}] ` : '';

      if (m.role === 'user') {
        return `${datePrefix}PLAYER: ${content}`;
      }

      // For dialog messages, could include character label if available from opts.characterId
      // For now use generic DM prefix to avoid needing universe context here
      return `${datePrefix}DM: ${content}`;
    })
    .filter(Boolean)
    .join('\n');
}
