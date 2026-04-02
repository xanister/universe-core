/**
 * Centralized model configuration.
 *
 * Use these constants instead of hardcoding model names.
 * This allows easy model swaps and ensures consistency across the codebase.
 *
 * Model Selection Guide:
 * - FLAGSHIP: Complex reasoning, player-facing narrative, entity generation
 * - MINI: Simple tasks, short generation, background processing, speed/cost savings
 * - NANO: Trivial tasks, minimal latency critical (not yet used)
 * - PRO: Agent orchestration, multi-step reasoning, important non-time-sensitive tasks
 * - IMAGE: Image generation (OpenAI only)
 */

export const MODELS = {
  FLAGSHIP: 'gpt-5.2',
  MINI: 'gpt-5-mini',
  NANO: 'gpt-5-nano',
  PRO: 'gpt-5.2-pro',
  IMAGE: 'gpt-image-1.5',
} as const;

export const CLAUDE_MODELS = {
  FLAGSHIP: 'claude-sonnet-4-6',
  MINI: 'claude-haiku-4-5',
  NANO: 'claude-haiku-4-5',
  PRO: 'claude-opus-4-6',
} as const;
