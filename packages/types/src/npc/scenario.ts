/**
 * Scenario types for game setup.
 */

import type { Place, Character } from '../entity/entities.js';
import type { UniverseEvent, Fact } from '../entity/events.js';
import type { PlotGoal, PlotGenerationHints } from './plot.js';
import type { StorytellerDefinition } from './storyteller.js';

/**
 * Starting situation for a scenario - injected onto the player character at creation.
 * Provides structured opening context that the agent and storyteller can reference.
 */
export interface StartingSituation {
  /** The prose narrative for the opening (displayed/used by agent). Optional - if absent, use Layout B (character/place info). */
  narrative: string | null;
  /**
   * Character's emotional/psychological state at start (e.g., "confused, disoriented").
   * This is guidance for scenario authors - the state should be reflected in the events
   * and narrative rather than stored separately on the character.
   */
  characterState: string | null;
  /**
   * Initial universe events to create for this scenario.
   * These are formative events/background that happened (objective facts stored at universe level).
   * Characters can query these events via witnessIds.
   * Example: "Materialized aboard this starship through unknown means"
   */
  initialEvents: UniverseEvent[] | null;
  /**
   * Initial journal entry facts for the player.
   * These represent what the character KNOWS or UNDERSTANDS (subjective interpretation).
   * Example: "This is a spaceship, though I don't know how I got here"
   */
  initialKnowledge: Fact[] | null;
}

/**
 * Configuration for which fields should be auto-randomized in a scenario.
 * Only applies to fields not already fixed in the scenario definition.
 */
export interface ScenarioRandomizeConfig {
  /** Auto-randomize universe selection */
  universe: boolean;
  /** Auto-generate a random character */
  character: boolean;
  /** Auto-randomize storyteller selection */
  storyteller: boolean;
  /** Auto-select a random compatible plot */
  plot: boolean;
  /** Auto-generate contextual starting situation */
  situation: boolean;
}

/**
 * A pre-configured scenario that bundles universe, character, and storyteller selections.
 * Stored in scenarios/definitions/ with ID format SCENARIO_{snake_case_label}
 *
 * Scenarios provide a "quick start" experience by preselecting game configuration.
 * Any unspecified fields will show the normal picker UI.
 */
export interface ScenarioDefinition {
  /** Unique identifier, e.g., "SCENARIO_farsreach_intro" */
  id: string;
  /** Display name for the scenario */
  label: string;
  /** Player-facing description of the scenario */
  description: string;
  /** Custom background image URL for the selector card */
  backgroundImage: string | null;

  // Preselections (all optional - show picker for unspecified)
  /** Universe to preselect, e.g., "farsreach" */
  universeId?: string;
  /**
   * Character to preselect, e.g., "CHAR_pipras_pennyroyal"
   * Mutually exclusive with characterDescription and templateCharacterId.
   */
  characterId?: string;
  /**
   * Description for generating a new character when the scenario is selected.
   * Mutually exclusive with characterId and templateCharacterId.
   */
  characterDescription?: string;
  /**
   * Template character to use. When scenario starts, generates the character
   * from this template if one with the same name doesn't exist in the universe.
   * Mutually exclusive with characterId and characterDescription.
   */
  templateCharacterId?: string;
  /**
   * ID of a player_start ObjectEntity to spawn at.
   * The place is derived from the object's position.parent.
   * Falls back to a random player_start object in the universe.
   */
  playerStartId?: string;
  /** Storyteller to preselect, e.g., "STORYTELLER_classic_adventure" */
  storytellerId?: string;

  // Plot selection (one of these, or neither to show picker/generate)
  /** Pre-authored plot to use, e.g., "PLOT_merchant_escort" */
  plotId?: string;
  /** If true, generate a new plot at scenario start (instead of using plotId) */
  generatePlot: boolean;
  /** Hints for plot generation (only used if generatePlot is true) */
  plotHints: PlotGenerationHints | null;

  /**
   * Starting situation that sets up the opening narrative context.
   * Injected onto the player character at creation time.
   */
  startingSituation: StartingSituation | null;

  /**
   * Default randomization settings for unfixed fields.
   *
   * Field states:
   * - Fixed: Value provided in scenario (e.g., universeId) → locked, no user input
   * - Auto-random: Not fixed AND randomize.X === true → auto-generated, no user input
   * - Requires input: Not fixed AND randomize.X is false/undefined → show picker
   *
   * If all fields are either Fixed or Auto-random, clicking the scenario
   * immediately starts it without showing a configuration UI.
   */
  randomize: ScenarioRandomizeConfig | null;

  /** Extensibility for future features */
  custom: Record<string, unknown> | null;

  // Populated from plot when available (for display in scenario listings)
  /** Goals from the associated plot (populated from plotId when loading scenarios) */
  goals: PlotGoal[] | null;
}

/**
 * Request body for POST /api/scenarios/:scenarioId/start
 * Player's configuration choices for unfixed fields.
 */
export interface ScenarioStartRequest {
  /** Universe selection - either specific ID or randomize */
  universe?: { id: string } | { randomize: true };
  /** Character selection - specific ID, description to generate, or randomize */
  character?: { id: string } | { description: string } | { randomize: true };
  /** Player start object selection — specific ID of a player_start ObjectEntity to spawn at */
  playerStart?: { id: string };
  /** Storyteller selection - either specific ID or randomize */
  storyteller?: { id: string } | { randomize: true };
  /** Plot selection - specific ID, generate new, or randomize from compatible */
  plot?: { id: string } | { generate: true; hints?: PlotGenerationHints } | { randomize: true };
  /** Starting situation - randomize to generate contextual situation */
  situation?: { randomize: true };
}

/**
 * Response from POST /api/scenarios/:scenarioId/start
 * Complete ready-to-play state after scenario setup.
 */
export interface ScenarioStartResponse {
  /** The resolved universe ID */
  universeId: string;
  /** The created/selected player character */
  character: Character;
  /** The selected storyteller definition */
  storyteller: StorytellerDefinition;
  /** The starting situation (fixed or generated) */
  startingSituation: StartingSituation;
  /** The starting place */
  place: Place;
}
