/**
 * Verbosity Utilities (Shared)
 *
 * Utilities for building verbosity guidance in prompts.
 * Extracted for use by generation/ layer (starting-situation-generator).
 */

/** Default verbosity level when not set on character */
export const DEFAULT_VERBOSITY = 3;

/**
 * Build verbosity guidance to include in the system prompt.
 * Uses strong qualitative guidance rather than fixed word counts to allow
 * flexibility across different response types.
 *
 * @param verbosity - Verbosity level 1-5 (defaults to 3)
 * @returns Prompt guidance string
 */
export function buildVerbosityGuidance(verbosity = DEFAULT_VERBOSITY): string {
  const level = Math.max(1, Math.min(5, verbosity));

  const guidance: Record<number, string> = {
    1: `VERBOSITY: Level 1 (TERSE)
- Extremely brief responses, one or two short sentences.
- Prioritize essential information over atmosphere or detail.
- Skip descriptions, scene-setting, and elaboration.`,

    2: `VERBOSITY: Level 2 (CONCISE)
- Short responses, around 2-3 sentences.
- Include minimal necessary description.
- Focus on actions and key dialogue, minimal atmosphere.`,

    3: `VERBOSITY: Level 3 (BALANCED)
- Medium responses, around 3-4 sentences.
- Balance action with appropriate description.
- Include some atmospheric detail when relevant.`,

    4: `VERBOSITY: Level 4 (DETAILED)
- Longer responses, around 4-5 sentences.
- Richer descriptions of scenes, characters, and atmosphere.
- Allow time for the scene to breathe.`,

    5: `VERBOSITY: Level 5 (ELABORATE)
- Full, immersive responses, 5+ sentences.
- Rich atmospheric descriptions and sensory details.
- Develop mood and character reactions fully.`,
  };

  return guidance[level];
}

/**
 * Calculate token limit based on verbosity level.
 * Uses gentle scaling (0.7x to 1.0x) with a floor to prevent truncation.
 *
 * @param baseTokens - Base token limit for the response type
 * @param verbosity - Verbosity level 1-5 (defaults to 3)
 * @param floor - Minimum token limit to prevent truncation (defaults to 800)
 * @returns Scaled token limit
 */
export function calculateVerbosityTokens(
  baseTokens: number,
  verbosity: number | undefined,
  floor: number = 800,
): number {
  const level = verbosity ?? DEFAULT_VERBOSITY;
  const clamped = Math.max(1, Math.min(5, level));

  // Scale from 0.7x at level 1 to 1.0x at level 5
  const multiplier = 0.7 + (clamped - 1) * 0.075;
  const scaled = Math.round(baseTokens * multiplier);

  return Math.max(floor, scaled);
}
