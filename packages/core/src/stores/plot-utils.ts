/**
 * Plot utility helpers shared across game and studio.
 */

/**
 * Patterns that indicate a flag name is negative (describing something that didn't happen).
 * Negative flags should be avoided because they can be prematurely set.
 * Flags should describe affirmative events (things that happened).
 */
const NEGATIVE_FLAG_PATTERNS = [
  /^(un|not_|no_|never_|avoided_|didnt_|didn't_|without_)/i,
  /(unsigned|undetected|unharmed|unseen|unnoticed|avoided)$/i,
];

/**
 * Validate that flag names are affirmative (describe events that happened).
 * Returns warnings for any flags that appear to be negative.
 *
 * Good flags: "call_sheet_signed", "guard_alerted", "checkpoint_passed"
 * Bad flags: "call_sheet_unsigned", "avoided_detection", "not_captured"
 */
export function validateFlagNames(flags: string[]): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  for (const flag of flags) {
    for (const pattern of NEGATIVE_FLAG_PATTERNS) {
      if (pattern.test(flag)) {
        warnings.push(
          `Flag "${flag}" appears to be negative. Use affirmative flags (e.g., "document_signed" not "document_unsigned").`,
        );
        break;
      }
    }
  }
  return { valid: warnings.length === 0, warnings };
}
