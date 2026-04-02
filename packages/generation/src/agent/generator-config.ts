/**
 * Generator Agent Config
 *
 * Model selection, execution limits, and stuck detection thresholds
 * for the agentic universe generator.
 */

import { MODELS } from '@dmnpc/core/infra/models.js';

export const GENERATOR_MODEL = MODELS.FLAGSHIP;

export const GENERATOR_MAX_STEPS = 25;

export const GENERATOR_TEMPERATURE = 0.7;

/** Abort if the same tool is called this many times consecutively with no new places. */
export const STUCK_REPEATED_TOOL_THRESHOLD = 3;

/** Abort if this many steps pass with no new places created. */
export const STUCK_NO_PROGRESS_THRESHOLD = 5;

/** Abort if the same tool errors this many times consecutively. */
export const STUCK_ERROR_LOOP_THRESHOLD = 2;

/** Abort generation after this many milliseconds (2 minutes). */
export const GENERATOR_TIMEOUT_MS = 120_000;

/** Minimum number of places for a valid generated universe. */
export const MIN_VIABLE_PLACES = 1;
