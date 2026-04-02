/**
 * Action classification types for player input processing.
 */

import type { Place } from '../entity/entities.js';
import type { DifficultyClass } from '../combat/ruleset.js';

/**
 * Action types for player input classification.
 * Determines how the arbiter processes the action.
 */
export type ActionType = 'Dialogue' | 'Transition' | 'Action' | 'Sleep' | 'Creative' | 'Yell';

/**
 * A single classified action from player input.
 * Compound inputs (e.g., "I go to the tavern and order a drink") produce multiple actions.
 *
 * The structure is uniform across all action types:
 * - type: What kind of action (determines arbiter processing)
 * - intent: Full description of what the player wants to do
 * - targetRef: Fuzzy reference from player's words (optional)
 * - targetId: Resolved entity ID if matched (optional)
 */
export interface ClassifiedAction {
  /** Action type - determines how the arbiter processes this action */
  type: ActionType;
  /** Full description of the player's intent (e.g., "ask about rumors", "go to the market") */
  intent: string;
  /** Fuzzy reference from player's words (e.g., "the barkeep", "outside", "the key") */
  targetRef: string | null;
  /** Resolved entity ID if matched against nearby entities (e.g., "CHAR_barkeep", "OBJ_exit_door") */
  targetId: string | null;
  /** Ruleset-suggested difficulty for this action. Trivial when no ruleset or routine/conversational. */
  suggestedDifficulty: DifficultyClass;
  /** Ruleset-suggested stat ID for this action. Null when no ruleset or not applicable. */
  suggestedStat: string | null;
  /** Entity ID of the character actively opposing this action. Null when no opposition. */
  opposedBy: string | null;
  /** Matched action registry ID. Null when no registered action matches (ad-hoc behavior). */
  actionId: string | null;
  /** Whether this action initiates combat (e.g., "I punch the guard"). */
  combatInitiated: boolean;
}

/**
 * Result of classifying player input.
 * Contains an ordered sequence of actions (for compound inputs) or rejection info.
 */
export interface ClassificationResult {
  /** Ordered sequence of actions to execute (empty if rejected) */
  actions: ClassifiedAction[];
  /** Rejection info if the input was invalid */
  rejection: {
    reason: string;
  } | null;
}

/**
 * Context for "I leave" commands - helps the LLM infer the correct destination.
 * Simple hierarchy model: "I leave" means go to parent.
 */
export interface LeaveContext {
  /** The immediate parent place - where "I leave" goes */
  parent: Place | null;
  /** Other children of the parent (places at the same level) */
  siblings: Place[];
  /** If inside a vessel, its state */
  vesselState: {
    isInVessel: boolean;
    vesselId: string | null;
    travelState: 'docked' | 'traveling' | null;
  };
  /** Whether GENERIC "I leave" is allowed (false if vessel traveling) */
  genericLeaveAllowed: boolean;
}
