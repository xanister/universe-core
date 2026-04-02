/**
 * Interaction Context Types
 *
 * Defines the movement/state contexts that determine which entity interactions
 * are available to the player. Extensible to mounted, swimming, flying, etc.
 */

/**
 * Valid interaction context values.
 * Determines which interactions are available based on the player's movement mode.
 */
export const INTERACTION_CONTEXTS = [
  'on_foot', // Walking, default state
  'vessel', // Helming/piloting a vessel
] as const;

/**
 * Movement/state context for filtering available interactions.
 * Extensible: add 'mounted', 'swimming', 'flying' etc. as needed.
 */
export type InteractionContext = (typeof INTERACTION_CONTEXTS)[number];
