/**
 * Generator Agent Types
 *
 * Context and session types for the agentic universe generator.
 */

import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { WorldBible } from '@dmnpc/types/world';
import type { UniverseGenerationHints, InferredRootPlace } from '../universe-generator.js';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  purposes: string[];
  variantCount: number;
  /** Human-readable summary of what slots auto-generate (e.g. "3 character slots, 5 object slots, 2 place slots") */
  slotSummary?: string;
}

export interface PurposeSummary {
  id: string;
  label: string;
}

export interface DataCatalog {
  templates: TemplateSummary[];
  placePurposes: PurposeSummary[];
}

export interface GenerationPlannedPlace {
  label: string;
  purpose: string;
  parentLabel: string | null;
  templateId: string;
  description: string;
}

export interface GenerationPlan {
  overview: string;
  places: GenerationPlannedPlace[];
  customTemplatesNeeded: boolean;
}

export interface GeneratorSession {
  plan?: GenerationPlan;
  complete: boolean;
}

export interface GeneratorToolContext {
  universeContext: UniverseContext;
  catalog: DataCatalog;
  hints: UniverseGenerationHints;
  worldBible?: WorldBible;
  templateIds?: string[];
  rootInfo: InferredRootPlace;
  session: GeneratorSession;
}
