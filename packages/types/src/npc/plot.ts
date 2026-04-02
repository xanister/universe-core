/**
 * Plot and story types.
 */

import type { StorytellerEvent } from './storyteller.js';
import type { TimePeriod } from './npc.js';

/**
 * A key character in the story plan.
 * Stored with descriptions for consistent generation when they appear in scenes.
 *
 * The presence of `entityId` indicates whether the character has been generated.
 *
 * NAMING:
 * - Use `name` ONLY when referencing a known existing character by their proper noun name
 * - Use `matchHint` for role-based descriptions that should be semantically matched
 * - At least one of `name` or `matchHint` must be provided
 */
export interface PlannedCharacter {
  /**
   * Exact character name - ONLY use if referencing a known existing character.
   * If provided, requires exact match to an existing entity.
   */
  name?: string;
  /**
   * Role-based hint for semantic matching (e.g., "weathered travel broker", "scarred informant").
   * Used to find matching existing characters or generate new ones with unique names.
   */
  matchHint?: string;
  /** Role in the story: villain, accomplice, victim, witness, client, informant, etc. */
  role: string;
  /** Physical appearance and personality for consistent generation */
  description: string;
  /** How they appear to the player initially (their cover/facade) */
  publicFace: string;
  /** Their true nature/agenda (secret - never reveal to player) */
  hiddenTruth: string;
  /** Where they can typically be found (description, not ID) */
  locationHint: string;
  /** When they should first appear (progress 0-100) */
  introductionProgress: number;
  /** The generated entity ID - presence indicates character has been created */
  entityId: string | null;
}

/**
 * A key location in a pre-authored plot definition.
 * Universe-agnostic - uses matchHint/description for place selection at runtime.
 *
 * At runtime, these are converted to PlannedPlace (with resolved placeId) using
 * two-stage LLM selection to find the best matching place in the current universe.
 */
export interface PlotDefinitionPlace {
  /**
   * If provided, uses this exact place ID (must exist in universe).
   * Used for universe-specific plots or when a place has already been selected.
   */
  placeId?: string;
  /**
   * Semantic hint for finding a matching place (used if placeId not provided).
   * Example: "crowded dockside bazaar where cursed trinkets change hands"
   */
  matchHint?: string;
  /**
   * Description of what kind of place is needed (used for selection context).
   * Example: "A choking maze of tar, incense, and wet wood where illicit relics sit beside ordinary goods"
   */
  description?: string;
  /** What this place is used for in the story (REQUIRED) */
  storyRole: string;
}

/**
 * A key location in the runtime story plan.
 * Has a resolved placeId that is guaranteed to exist in the universe.
 *
 * Created from PlotDefinitionPlace by selecting a matching place using two-stage LLM selection.
 * No generation occurs - all places must already exist in the universe.
 */
export interface PlannedPlace {
  /** Place ID selected from existing places via two-stage selection */
  placeId: string;
  /** What this place is used for in the story */
  storyRole: string;
}

/**
 * A key item referenced by the story plan.
 * Items reference the unified item catalog by ID.
 * Unlike PlannedCharacter/PlannedPlace, items don't need intermediate resolution —
 * they reference catalog IDs directly and are always "available" (no filtering).
 */
export interface PlannedItem {
  /** Item catalog ID (e.g., "golden_key", "sealed_letter"). Must exist in the unified item registry. */
  itemId: string;
  /** Optional tint override (hex number, e.g., 0xFF0000 for red). Null = use catalog default. */
  tint: number | null;
  /** Where to place this item in the world (description, not ID). Resolved to a PlannedPlace at spawn time. */
  locationHint: string;
  /**
   * How to place this item at the resolved location:
   * - 'ground': spawn as a standalone pickup object on the floor (default)
   * - 'container': place inside an existing container object (chest, barrel, crate) at the location.
   *   Falls back to 'ground' if no containers exist at the resolved location.
   */
  placement: 'ground' | 'container';
}

/**
 * Get the display identifier for a PlannedCharacter.
 * Returns name if available, otherwise matchHint, otherwise 'unknown'.
 */
export function getPlannedCharacterIdentifier(char: PlannedCharacter): string {
  return char.name || char.matchHint || 'unknown';
}

/**
 * Dramatic role of a turning point in the story arc.
 */
export type DramaticRole =
  | 'inciting_incident'
  | 'rising_action'
  | 'midpoint'
  | 'crisis'
  | 'climax'
  | 'resolution';

/**
 * Conditions that must be met before a turning point can fire.
 * When multiple conditions are present on a TP, ALL must be met (AND logic).
 * Within each condition, arrays provide OR logic (e.g., purposes: ["tavern", "market"]).
 */
export type TriggerCondition =
  | TriggerConditionMinHours
  | TriggerConditionTimeOfDay
  | TriggerConditionLocationPurpose
  | TriggerConditionSpecificLocation
  | TriggerConditionCharacterPresent
  | TriggerConditionNotInCombat;

/** At least N game hours since the last storyteller event for this plot. Primary pacing control. */
export interface TriggerConditionMinHours {
  type: 'min_hours_since_last_event';
  hours: number;
}

/** Current time period matches one of the listed periods. */
export interface TriggerConditionTimeOfDay {
  type: 'time_of_day';
  periods: TimePeriod[];
}

/** Player is at a place whose purpose matches any in the list. */
export interface TriggerConditionLocationPurpose {
  type: 'location_purpose';
  purposes: string[];
}

/** Player is at the place assigned to this storyRole in the plot's plan.places array. */
export interface TriggerConditionSpecificLocation {
  type: 'specific_location';
  placeStoryRole: string;
}

/** A named plot character (from plan.characters) is at the player's current location. */
export interface TriggerConditionCharacterPresent {
  type: 'character_present';
  characterName: string;
}

/** Player is not currently in combat. */
export interface TriggerConditionNotInCombat {
  type: 'not_in_combat';
}

/**
 * A turning point in the story that can be triggered.
 */
export interface PlotTurningPoint {
  /** Unique identifier for this turning point */
  id: string;
  /** Story progress threshold when this might trigger (0-100). Higher = later in story. */
  progressTarget: number;
  /** Dramatic role in the story arc */
  dramaticRole: DramaticRole;
  /**
   * Preferred character to deliver this turning point (by character name).
   * This is a suggestion, not a requirement - if unavailable, delivery adapts to current scene.
   */
  involvedCharacter: string | null;
  /**
   * Flags that trigger this turning point immediately when set.
   * Alternative to progressTarget - triggers on player action same turn.
   * Example: ["searched_area", "followed_tracks"] - TP triggers when either flag is set.
   */
  triggerOnFlags: string[] | null;
  /**
   * Facts the player MUST learn from this turning point.
   * This is the PRIMARY DRIVER of the turning point - defines WHAT the player learns.
   * The system adapts HOW these facts are delivered based on current scene context.
   * Should be abstract and player-centric (e.g., "The player learns X" not "Character Y reveals X").
   * Example: ["The sealed package must reach the Hidden Archive", "Time is limited"]
   * REQUIRED: Every turning point must define what the player needs to learn.
   */
  essentialInformation: string[];
  /**
   * Conditions that must ALL be met before this turning point can fire.
   * When present, the TP defers until all conditions are satisfied.
   * Combine min_hours_since_last_event with context conditions for natural pacing.
   * TPs without triggerConditions behave as before (pure progress/flag/time).
   */
  triggerConditions: TriggerCondition[] | null;
  /**
   * Game hours after becoming eligible (progress met) before firing regardless of conditions.
   * Prevents conditions from blocking the story indefinitely.
   * Default behavior when null: 48 game hours.
   */
  conditionTimeoutHours: number | null;

  // Runtime state (not in definition file, set during play)
  /** Has this turning point occurred? */
  triggered: boolean;
  /** Game date when this turning point was triggered */
  triggeredAt: string | null;
  /** Event ID that triggered this turning point (links to StorytellerEvent.id) */
  triggeredByEventId: string | null;
  /** LLM-determined outcome description */
  outcome: string | null;
  /** Flags that were actually set when triggered */
  flagsSet: string[] | null;
  /** Game date when this TP first became eligible but conditions prevented firing. Used for timeout. */
  conditionsEligibleSince: string | null;
}

/** Goal status indicating whether the goal is still active or has been resolved */
export type GoalStatus = 'pending' | 'success' | 'failure';

/** Goal type indicating scope and visibility behavior */
export type GoalType = 'long_term' | 'short_term' | 'immediate';

/**
 * A goal that can be achieved or failed during gameplay.
 * Goals are defined at the plot level and revealed when specific flags are set.
 * Goals check story flags to determine their status (flags are conditions, not set by goals).
 * Both achievement and failure increase progress (drama rises either way).
 */
export interface PlotGoal {
  /** Unique identifier for the goal */
  id: string;
  /** Natural language description of the goal (e.g., "The character obtains a cup of tea") */
  description: string;
  /** Progress to add when achieved or failed (0-100). Advances the plot when goal resolves. */
  progressBoost: number;
  /**
   * Flags that reveal this goal to the player. Goal becomes visible when ANY flag is set.
   * This allows goals to be revealed based on narrative context delivery rather than TP triggers.
   */
  revealOnFlags: string[];
  /** Array of flags - goal succeeds if ANY flag exists in plot.storyFlags */
  successFlags: string[] | null;
  /** Array of flags - goal fails if ANY flag exists in plot.storyFlags */
  failureFlags: string[] | null;
  /** Hours after goal is revealed before it automatically fails (time-based failure, alternative to flag-based) */
  failureDeadlineHours: number | null;
  /** If true, goal is tracked but not shown to the player */
  hidden: boolean;
  /**
   * Place ID of a PlannedPlace that is this goal's destination.
   * UI will look up the place to display destination hint.
   */
  destinationPlaceId: string | null;

  // Goal hierarchy and motivation fields
  /**
   * Goal type indicating scope:
   * - 'long_term': Quest-level goal (visible from inciting_incident)
   * - 'short_term': Chapter-level goal (revealed when relevant TP fires)
   * - 'immediate': Scene-level goal (always one visible per active short_term)
   */
  goalType: GoalType | null;
  /** What happens if you fail this goal? Raises stakes and player investment. */
  stakes: string | null;
  /** Why does THIS character care? Only relevant if plot is characterCentric. */
  personalHook: string | null;
  /** What dramatic question does pursuing this goal help answer? */
  dramaticQuestion: string | null;
  /** Concrete next action suggestion (e.g., "Speak to locals about recent disturbances") */
  immediateHint: string | null;
  /**
   * Flags that make this goal impossible. Goal becomes blocked if ANY of these flags are set.
   * Used for branching: mutually exclusive goals block each other via successFlags.
   * Example: "save_village" has blockedByFlags: ["pursued_necromancer"]
   */
  blockedByFlags: string[] | null;

  // Runtime state (set during play, not in definition files)
  /** Current status of the goal. Once set to 'success' or 'failure', goal cannot change. */
  status: GoalStatus | null;
  /** Game date when goal was revealed. Set when any revealOnFlags is set. Used for deadline calculation. */
  revealedAt: string | null;
}

/**
 * Definition of a story flag with its trigger condition.
 * Flags represent player actions/outcomes, not world state discoveries.
 */
export interface FlagDefinition {
  /** Unique identifier for this flag (used in successFlags/failureFlags) */
  id: string;
  /** Description of when this flag should be set (player action/outcome) */
  triggerDescription: string;
}

/**
 * Credits to display at the end of a story.
 */
export interface EndingCredits {
  /** Credits section title */
  title: string;
  /** Credit entries */
  entries: Array<{ role: string; name: string }>;
}

/**
 * Condition for displaying an ending card.
 */
export interface EndingCardCondition {
  type: 'flag_set' | 'flag_not_set' | 'always';
  /** The flag to check (required for flag_set and flag_not_set) */
  flag: string | null;
}

/**
 * An ending card displayed after the climax.
 * Cards are shown in sequence based on their conditions matching the story flags.
 */
export interface EndingCard {
  /** Condition that must be met to show this card */
  condition: EndingCardCondition;
  /** Title for the card */
  title: string | null;
  /** The card text */
  text: string;
  /** Image URL */
  image: string | null;
}

/**
 * Payload returned when the story reaches its ending (climax turning point).
 */
export interface EndingPayload {
  /** Ending cards that matched the story flags */
  cards: EndingCard[];
  /** Credits to display after cards */
  credits: EndingCredits;
}

/**
 * Metadata for a plot (used in listings).
 */
export interface PlotMetadata {
  id: string;
  label: string;
  description: string;
  /** If set, plot is only compatible with this universe */
  universeId: string | null;
  /** Path to plot image */
  image: string | null;
}

/**
 * Hints for LLM plot generation.
 */
export interface PlotGenerationHints {
  /** Loose plot description */
  description: string | null;
  /** Themes to incorporate */
  themes: string[] | null;
  /** Type of antagonist */
  antagonistType: string | null;
  /** What's at stake */
  stakes: string | null;
  /** Include an existing character in the plot (character ID) */
  includeCharacterId: string | null;
}

/**
 * A pre-authored or generated plot definition.
 * Stored in plots/definitions/ with ID format PLOT_{snake_case_label}
 *
 * Plots define the story content (characters, turning points, ending cards)
 * while Storytellers define the style (pacing, tone, prompts).
 */
export interface PlotDefinition {
  /** Unique identifier, e.g., "PLOT_merchant_escort" */
  id: string;
  /** Display name for the plot */
  label: string;
  /** Player-facing description */
  description: string;

  // Constraints
  /** If set, plot is only compatible with this universe */
  universeId: string | null;
  /** Tags that the universe must have (for universal plots) */
  requiredPlaceTags: string[] | null;

  // Story content (confidential to player)
  /** The complete overarching plot summary */
  plot: string;
  /** Key characters with descriptions for lazy generation */
  characters: PlannedCharacter[];
  /** Key locations - universe-agnostic, resolved at runtime via place selection */
  places: PlotDefinitionPlace[];
  /** Key items from the unified catalog, spawned as world objects during plot activation */
  items: PlannedItem[];
  /** Key turning points in dramatic order */
  turningPoints: PlotTurningPoint[];
  /** Goals that can be achieved or failed during gameplay, revealed via flags */
  goals: PlotGoal[];
  /**
   * All possible flags for this plot with trigger descriptions.
   * Flags are plot-wide and can be set at any point during gameplay.
   * All flags referenced in goals (successFlags/failureFlags/revealOnFlags) must exist here.
   */
  possibleFlags: FlagDefinition[];

  // Plot timing
  /** Hours before opening event fires (default: 0, overridden by storyteller range for generated plots) */
  plotStartDelay: number | null;
  /** Path to plot image */
  image: string | null;

  // Vessel configuration (for travel-focused plots)
  /**
   * Vessel configuration for travel-focused plots.
   * When set and player starts on a vessel, configures the vessel's travel state.
   * Destinations are resolved to actual places at scenario start time.
   */
  vesselConfig: {
    /** Hints for finding/generating a destination place */
    destinationHints: {
      /** Tags the destination should have (e.g., ["sanctuary", "port", "fortress"]) */
      tags: string[] | null;
      /** Description hint for place matching/generation */
      description: string | null;
      /** Minimum distance from origin in miles (ensures meaningful journey) */
      minDistance: number | null;
    };
    /** Hints for origin place (where voyage started) - defaults to nearest port */
    originHints: {
      /** Tags to match for origin (e.g., ["port", "harbor"]) */
      tags: string[] | null;
      /** Description hint for origin matching */
      description: string | null;
    } | null;
    /** Journey progress 0-1 (0 = just departed, 1 = arriving) */
    journeyProgress: number;
    /** Whether vessel is traveling or will be docked at origin - defaults to 'traveling' */
    travelState: 'traveling' | 'docked' | null;
  } | null;

  // Ending content
  /** Cards shown after the climax based on story flags */
  endingCards: EndingCard[];
  /** Credits displayed after ending cards */
  credits: EndingCredits;
}

/**
 * A dramatic sub-question that the player will want answered during the story.
 * Used in phased plot generation to ensure player engagement and curiosity.
 */
export interface DramaticSubQuestion {
  /** The question the player will want answered */
  question: string;
  /** When this question gets answered (maps to a turning point's dramatic role) */
  answerPhase: DramaticRole;
}

/**
 * The storyteller's plan for a narrative.
 * Generated when a plot is created or copied from a PlotDefinition.
 * Self-contained with all data needed for the plot lifecycle.
 *
 * CONFIDENTIAL: This plan should NEVER be revealed to the player.
 */
export interface StorytellerPlan {
  /** Display label for the plot (short title for UI display) */
  label: string;

  /** Player-facing briefing description (shown in plot progress UI) */
  description: string | null;

  /**
   * The complete overarching plot (4-8 sentences).
   * Must include:
   * - The core conflict/mystery
   * - The antagonist and their method
   * - At least one twist or story turn
   * - Key characters by name with their roles
   */
  plot: string;

  /** Key characters with descriptions for lazy generation */
  characters: PlannedCharacter[];

  /** Key locations with descriptions for lazy generation */
  places: PlannedPlace[];

  /** Key items from the unified catalog, spawned as world objects during plot activation */
  items: PlannedItem[];

  /** Key turning points that can trigger as progress increases */
  turningPoints: PlotTurningPoint[];

  /** Goals that can be achieved or failed during gameplay, revealed via flags */
  goals: PlotGoal[] | null;

  /**
   * All possible flags for this plot with trigger descriptions.
   * Flags are plot-wide and can be set at any point during gameplay.
   */
  possibleFlags: FlagDefinition[] | null;

  // Plot image
  /** Path to generated plot image (e.g., "/api/media/{universeId}/plots/{plotId}.png") */
  image: string | null;

  // Per-plot timing
  /** Hours before opening event fires (default: 0) */
  plotStartDelay: number | null;

  // Endings (copied from PlotDefinition, making plan self-contained)
  /** Cards shown after the climax based on story flags */
  endingCards: EndingCard[] | null;
  /** Credits displayed after ending cards */
  credits: EndingCredits | null;

  // Phased generation outputs (plan-only, not in PlotDefinition)
  /**
   * Whether this plot should tie into the player character's motivations.
   * When true, goals may include personalHook fields.
   * Set during Phase 0 of phased generation or from storyteller config.
   */
  characterCentric: boolean;
  /**
   * The overarching dramatic question that drives the plot.
   * Example: "Can the player stop the necromancer before the ritual is complete?"
   */
  centralDramaticQuestion: string | null;
  /**
   * Sub-questions the player will want answered, mapped to dramatic phases.
   * Used to ensure player engagement through curiosity and mystery.
   */
  dramaticSubQuestions: DramaticSubQuestion[] | null;
}

/**
 * Plot lifecycle status.
 */
export type PlotStatus = 'active' | 'complete' | 'pending';

/**
 * Per-plot state tracking progression, introduction, and lifecycle.
 * Stored in StorytellerInstanceState.activePlots.
 */
export interface PlotState {
  /** Unique instance ID for this plot (e.g., "plot_1704567890") */
  id: string;
  /** The plot plan (self-contained with all data) */
  plan: StorytellerPlan;

  // Progression
  /** Current story progress for this plot (0-100). Higher = closer to resolution. */
  progressLevel: number;
  /** Story flags accumulated for this plot */
  storyFlags: string[];

  // Event Scheduling
  /** Game date when next storyteller event should fire. null = not scheduled (backup plot waiting for activation) */
  nextEventAtGameDate: string | null;

  // Lifecycle
  /** Game date when plot completed */
  endedAt: string | null;

  // Events
  /** Events that have occurred for this plot */
  events: StorytellerEvent[];
}
