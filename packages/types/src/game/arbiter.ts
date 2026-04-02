/**
 * Arbiter types shared between game engine and agent tools.
 */

/**
 * Outcome of an arbitrated action.
 */
export type ArbiterOutcome =
  | 'success' // Action succeeded as intended
  | 'partial_success' // Action partially succeeded with complications
  | 'failure' // Action failed
  | 'interrupted' // Action was interrupted by an event
  | 'pending'; // Action requires more context/resolution

/**
 * Information about an exit created during processing.
 * Used to pass exit info from arbiter to response generators.
 */
export interface CreatedExitInfo {
  exitId: string;
  label: string;
  exitType: string;
}

/**
 * Information about a character created during processing.
 * Used to pass character info from arbiter to response generators.
 */
export interface CreatedCharacterInfo {
  characterId: string;
  characterName: string;
  role: string;
}
