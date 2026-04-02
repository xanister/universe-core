/**
 * Plot Validators Index
 *
 * Exports all plot validators and provides the ordered list for validation.
 */

import type { PlotValidator } from '../../plot-validation-types.js';
import { plotStructureValidator } from './plot-structure.js';
import { plotFlagsValidator } from './plot-flags.js';
import { plotProgressValidator } from './plot-progress.js';
import { plotConsistencyValidator } from './plot-consistency.js';
import { plotDescriptionsValidator } from './plot-descriptions.js';
import { plotQualityValidator } from './plot-quality.js';

/**
 * All plot validators in execution order.
 *
 * Order matters - earlier validators may detect issues that
 * later validators depend on being fixed.
 *
 * 1. Consistency - basic structure and required fields
 * 2. Structure - dramatic roles (climax, inciting_incident)
 * 3. Progress - progress target values and ordering
 * 4. Flags - flag definitions and references
 * 5. Quality - narrative quality checks (stakes, escalation, branching, breadcrumbs)
 *    - Runs after structure/progress/flags because it assumes those are valid
 *    - Uses shared heuristics from plot-quality-heuristics.ts
 * 6. Descriptions - scene-based vs vague descriptions
 *
 * NOTE: Goal timing validation was removed - the keyword-matching heuristic
 * produced too many false positives. Goal timing is handled via prompt guidance.
 */
export const PLOT_VALIDATORS: PlotValidator[] = [
  plotConsistencyValidator,
  plotStructureValidator,
  plotProgressValidator,
  plotFlagsValidator,
  plotQualityValidator,
  plotDescriptionsValidator,
];
