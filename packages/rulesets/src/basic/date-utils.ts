/**
 * Pure date math utilities for BasicRuleset.
 *
 * Used by the death timer to compute elapsed minutes between
 * incapacitation onset and the current game date.
 */

/**
 * Get the number of minutes between two ISO date strings.
 * Returns a positive value when dateB is after dateA.
 */
export function getMinutesBetween(dateA: string, dateB: string): number {
  return (new Date(dateB).getTime() - new Date(dateA).getTime()) / 60000;
}
