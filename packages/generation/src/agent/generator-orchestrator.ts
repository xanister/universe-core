/**
 * Generator Orchestrator
 *
 * Entry point for agentic universe generation. Runs a pre-loop setup
 * (procedural), an agent loop (LLM-driven), and post-loop finalization.
 */

import { runAgentLoop } from '@xanister/reagent';
import type {
  PrepareStepInfo,
  PrepareStepResult,
  AgentStep,
  ToolCall,
  ToolResult,
} from '@xanister/reagent';
import { createAgentProvider } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { saveWorldBible } from '@dmnpc/core/stores/world-bible-store.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { createUniverse, updateUniverse } from '@dmnpc/core/universe/universe-store.js';
import type { Universe } from '@dmnpc/types/entity';
import type { WorldBible } from '@dmnpc/types/world';

import {
  generateUniverse,
  generateUniverseImage,
  saveUniverseImage,
  inferRootPlace,
  type UniverseGenerationHints,
} from '../universe-generator.js';
import { parseDocuments } from '../document/document-parser.js';
import {
  processDocuments,
  generateWorldBibleClarifications,
} from '../document/document-processor.js';
import { saveDocuments } from '../document/document-storage.js';
import type { DocumentData } from '../document/document-parser.js';
import { matchCharactersToTemplates } from '../template-matcher.js';
import {
  mergeAllMatches,
  type MergedCharacterDefinition,
} from '../document/template-document-merger.js';
import {
  generateCharactersFromTemplates,
  generateCharactersFromMergedDefinitions,
} from '../character/template-character-generator.js';
import { createHistoricalEventsFromWorldBible } from '../narrative/historical-event-creator.js';
import { loadAllTemplates } from '../place-layout/layout-templates.js';
import { loadPurposeDefinition, loadPurposeIds } from '../purpose-loader.js';

import type { GeneratorToolContext, DataCatalog, TemplateSummary } from './types.js';
import { GENERATOR_TOOLS } from './tool-registry.js';
import { validateGeneratedUniverse } from './validation.js';
import { auditWorldPopulation } from '../document/world-population-audit.js';
import { buildGeneratorSystemPrompt, buildUserPrompt } from './generator-prompts.js';
import {
  GENERATOR_MODEL,
  GENERATOR_MAX_STEPS,
  GENERATOR_TEMPERATURE,
  GENERATOR_TIMEOUT_MS,
  STUCK_REPEATED_TOOL_THRESHOLD,
  STUCK_NO_PROGRESS_THRESHOLD,
  STUCK_ERROR_LOOP_THRESHOLD,
} from './generator-config.js';

export interface GenerateUniverseAgenticParams {
  hints?: UniverseGenerationHints;
  documents?: DocumentData[];
  templateIds?: string[];
}

export interface GenerationStats {
  totalSteps: number;
  totalTimeMs: number;
  toolCounts: Record<string, number>;
  placesCreated: number;
  finishReason: string;
  abortReason?: string;
}

export interface GenerateUniverseAgenticResult {
  universe: Universe;
  stats: GenerationStats;
}

/**
 * Detect stuck patterns in the agent loop via prepareStep hook.
 * Returns an abort reason string if stuck, undefined otherwise.
 */
export function detectStuck(
  steps: AgentStep<GeneratorToolContext>[],
  placeCountAtLastProgress: number,
  currentPlaceCount: number,
): string | undefined {
  if (steps.length === 0) return undefined;

  // Check repeated tool pattern: same tool N times in a row with no new places
  if (steps.length >= STUCK_REPEATED_TOOL_THRESHOLD) {
    const recent = steps.slice(-STUCK_REPEATED_TOOL_THRESHOLD);
    const toolNames = recent.map((s) => s.toolCalls.map((t: ToolCall) => t.name).join(','));
    const allSame = toolNames.every((n) => n === toolNames[0] && n !== '');
    if (allSame && currentPlaceCount === placeCountAtLastProgress) {
      return `Repeated tool "${toolNames[0]}" ${STUCK_REPEATED_TOOL_THRESHOLD} times with no new places`;
    }
  }

  // Check error loop: same tool erroring N times in a row
  if (steps.length >= STUCK_ERROR_LOOP_THRESHOLD) {
    const recent = steps.slice(-STUCK_ERROR_LOOP_THRESHOLD);
    const allErrors = recent.every(
      (s) =>
        s.toolResults.length > 0 && s.toolResults.every((r: ToolResult) => r.type === 'tool-error'),
    );
    if (allErrors) {
      const toolName = recent[0].toolCalls[0]?.name ?? 'unknown';
      return `Tool "${toolName}" errored ${STUCK_ERROR_LOOP_THRESHOLD} times consecutively`;
    }
  }

  // Check no-progress: N steps with no new places
  if (
    steps.length >= STUCK_NO_PROGRESS_THRESHOLD &&
    currentPlaceCount === placeCountAtLastProgress
  ) {
    // Only trigger if we're past the planning phase (at least one create attempted)
    const hasCreateAttempt = steps.some((s) =>
      s.toolCalls.some((t: ToolCall) => t.name === 'create_place'),
    );
    if (hasCreateAttempt) {
      return `No new places created in ${STUCK_NO_PROGRESS_THRESHOLD} steps`;
    }
  }

  return undefined;
}

function buildSlotSummary(
  slots: Array<{ purpose: string }>,
  purposeCategory: (id: string) => string | null,
): string {
  let placeSlots = 0;
  let objectSlots = 0;
  let characterSlots = 0;

  for (const slot of slots) {
    const category = purposeCategory(slot.purpose);
    if (category === 'place') placeSlots++;
    else if (category === 'character') characterSlots++;
    else objectSlots++;
  }

  const parts: string[] = [];
  if (placeSlots > 0) parts.push(`${placeSlots} place`);
  if (characterSlots > 0) parts.push(`${characterSlots} character`);
  if (objectSlots > 0) parts.push(`${objectSlots} object`);
  return parts.length > 0 ? `auto-creates: ${parts.join(', ')} slots` : '';
}

function buildPurposeCategoryMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of loadPurposeIds()) {
    const def = loadPurposeDefinition(id);
    if (def) map.set(id, def.category);
  }
  return map;
}

function summarizeTemplate(
  entry: {
    id: string;
    template: {
      name: string;
      description: string;
      purposes: string[];
      variants: Array<{ slots?: Array<{ purpose: string }> }>;
    };
  },
  categoryMap: Map<string, string>,
): TemplateSummary {
  const slots = entry.template.variants[0]?.slots ?? [];
  const slotSummary = buildSlotSummary(slots, (id) => categoryMap.get(id) ?? null);
  return {
    id: entry.id,
    name: entry.template.name,
    description: entry.template.description,
    purposes: entry.template.purposes,
    variantCount: entry.template.variants.length,
    slotSummary: slotSummary || undefined,
  };
}

function loadDataCatalog(): DataCatalog {
  const categoryMap = buildPurposeCategoryMap();

  const templates = loadAllTemplates().map((t) => summarizeTemplate(t, categoryMap));

  const placePurposes = [...categoryMap.entries()]
    .filter(([, category]) => category === 'place')
    .map(([id]) => {
      const def = loadPurposeDefinition(id);
      return { id, label: def!.label };
    });

  return { templates, placePurposes };
}

/**
 * Generate a universe using the agentic pipeline.
 *
 * Pre-loop: document processing, universe metadata, root place inference.
 * Agent loop: plan → create entities → signal complete.
 * Post-loop: template characters, historical events, cover image, persist.
 */
export async function generateUniverseAgentic(
  params: GenerateUniverseAgenticParams,
): Promise<GenerateUniverseAgenticResult> {
  const { hints = {}, documents, templateIds } = params;

  logger.info(
    'GeneratorOrchestrator',
    `Starting agentic generation with hints: ${JSON.stringify(hints)}`,
  );

  // ── Pre-loop: document processing ──────────────────────────────────────
  let worldBible: WorldBible | undefined;
  let mergedCharacters: MergedCharacterDefinition[] = [];
  let matchedTemplateIds: string[] = [];

  if (documents?.length) {
    logger.info('GeneratorOrchestrator', `Processing ${documents.length} documents`);
    const parsedDocs = await parseDocuments(documents);
    if (parsedDocs.length > 0) {
      worldBible = await processDocuments(parsedDocs);
      const matchResult = await matchCharactersToTemplates(worldBible);
      if (matchResult.matched.length > 0) {
        matchedTemplateIds = matchResult.matched.map((m) => m.template.id);
      }
    }
  }

  // ── Pre-loop: universe metadata ────────────────────────────────────────
  const allTemplates = loadAllTemplates();
  const rootInfo = await inferRootPlace(worldBible, allTemplates, hints);

  logger.info(
    'GeneratorOrchestrator',
    `Inferred root: purpose=${rootInfo.purpose}, label="${rootInfo.label}", template=${rootInfo.templateId}`,
  );

  const genResult = await generateUniverse(hints, worldBible);
  const universeData = genResult.universe;

  // Merge template matches
  if (matchedTemplateIds.length > 0 && worldBible) {
    const matchResult = await matchCharactersToTemplates(worldBible);
    mergedCharacters = await mergeAllMatches(matchResult.matched, universeData);
  }

  // Create universe in store
  const universe = createUniverse({
    ...universeData,
    rootPlaceId: '',
  });

  const ctx = await UniverseContext.loadAtEntryPoint(universe.id);

  // ── Pre-loop: build agent context ──────────────────────────────────────
  const catalog = loadDataCatalog();

  const allTemplateIds = [...new Set([...(templateIds ?? []), ...matchedTemplateIds])];

  const toolContext: GeneratorToolContext = {
    universeContext: ctx,
    catalog,
    hints,
    worldBible,
    templateIds: allTemplateIds.length > 0 ? allTemplateIds : undefined,
    rootInfo,
    session: { complete: false },
  };

  // ── Agent loop ─────────────────────────────────────────────────────────
  const provider = createAgentProvider({
    model: GENERATOR_MODEL,
    maxTokens: 4096,
    temperature: GENERATOR_TEMPERATURE,
  });

  const systemPrompt = buildGeneratorSystemPrompt(toolContext);
  const userPrompt = buildUserPrompt(toolContext);

  logger.info(
    'GeneratorOrchestrator',
    `Starting agent loop (model=${GENERATOR_MODEL}, maxSteps=${GENERATOR_MAX_STEPS})`,
  );

  const loopStartTime = Date.now();
  const toolCounts: Record<string, number> = {};
  let placeCountAtLastProgress = 0;
  let abortReason: string | undefined;

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortReason = `Generation timeout (${GENERATOR_TIMEOUT_MS}ms)`;
    abortController.abort();
  }, GENERATOR_TIMEOUT_MS);

  const prepareStep = (info: PrepareStepInfo<GeneratorToolContext>): PrepareStepResult | void => {
    const currentPlaceCount = info.context.universeContext.getAllPlaces().length;
    const stuck = detectStuck(info.previousSteps, placeCountAtLastProgress, currentPlaceCount);
    if (stuck) {
      abortReason = stuck;
      abortController.abort();
    }
    if (currentPlaceCount > placeCountAtLastProgress) {
      placeCountAtLastProgress = currentPlaceCount;
    }
  };

  let finishReason: string;
  let steps: AgentStep<GeneratorToolContext>[] = [];

  try {
    const result = await runAgentLoop<GeneratorToolContext>({
      provider,
      tools: GENERATOR_TOOLS,
      context: toolContext,
      systemPrompt,
      userPrompt,
      maxSteps: GENERATOR_MAX_STEPS,
      abortSignal: abortController.signal,
      prepareStep,
      onStepFinish: (step: AgentStep<GeneratorToolContext>) => {
        const toolNames = step.toolCalls.map((t: ToolCall) => t.name).join(', ');
        for (const tc of step.toolCalls) {
          toolCounts[tc.name] = (toolCounts[tc.name] ?? 0) + 1;
        }
        logger.info('GeneratorOrchestrator', `Step ${step.stepNumber}: ${toolNames}`);
      },
    });

    finishReason = result.finishReason;
    steps = result.steps;

    if (result.finishReason === 'error') {
      const msg = result.error instanceof Error ? result.error.message : String(result.error);
      logger.error('GeneratorOrchestrator', `Agent loop error: ${msg}`);
      finishReason = 'error';
    }
  } catch (err) {
    // Aborted (stuck detection or timeout) or unexpected error
    finishReason = abortReason ? 'aborted' : 'error';
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('GeneratorOrchestrator', `Agent loop stopped: ${abortReason ?? msg}`);
  } finally {
    clearTimeout(timeout);
  }

  const loopTimeMs = Date.now() - loopStartTime;
  const placesCreated = ctx.getAllPlaces().length;

  const stats: GenerationStats = {
    totalSteps: steps.length,
    totalTimeMs: loopTimeMs,
    toolCounts,
    placesCreated,
    finishReason,
    abortReason,
  };

  logger.info(
    'GeneratorOrchestrator',
    `Agent loop finished: ${steps.length} steps, ${placesCreated} places, ${loopTimeMs}ms (${finishReason}${abortReason ? `: ${abortReason}` : ''})`,
  );

  // On error/abort with no usable results, throw
  if (finishReason !== 'complete' && finishReason !== 'max-steps' && placesCreated === 0) {
    throw new Error(
      `Agent generation failed (${finishReason}${abortReason ? `: ${abortReason}` : ''}). No places created.`,
    );
  }

  if (finishReason === 'max-steps') {
    logger.warn(
      'GeneratorOrchestrator',
      `Agent hit max steps (${GENERATOR_MAX_STEPS}). Persisting partial results.`,
    );
  }

  // ── Post-loop: update root place ID ────────────────────────────────────
  const rootPlace = ctx.getAllPlaces().find((p) => p.position.parent === null);
  if (rootPlace) {
    await updateUniverse(universe.id, { rootPlaceId: rootPlace.id });
    ctx.universe.rootPlaceId = rootPlace.id;
  }

  await ctx.persistAll();

  // ── Post-loop: validate ─────────────────────────────────────────────────
  const validation = validateGeneratedUniverse(ctx);
  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      logger.warn('GeneratorOrchestrator', `Validation warning: ${w}`);
    }
  }
  if (!validation.valid) {
    const errorSummary = validation.errors.join('; ');
    logger.error('GeneratorOrchestrator', `Validation failed: ${errorSummary}`);
    throw new Error(`Generated universe failed validation: ${errorSummary}`);
  }

  // ── Post-loop: template characters ─────────────────────────────────────
  const ctxForCharacters = await UniverseContext.loadAtEntryPoint(universe.id);

  if (mergedCharacters.length > 0) {
    logger.info('GeneratorOrchestrator', `Generating ${mergedCharacters.length} merged characters`);
    await generateCharactersFromMergedDefinitions(ctxForCharacters, mergedCharacters);
    await ctxForCharacters.persistAll();

    const unmatchedTemplateIds = allTemplateIds.filter((id) => !matchedTemplateIds.includes(id));
    if (unmatchedTemplateIds.length > 0) {
      await generateCharactersFromTemplates(ctxForCharacters, unmatchedTemplateIds);
      await ctxForCharacters.persistAll();
    }
  } else if (allTemplateIds.length > 0) {
    logger.info('GeneratorOrchestrator', `Generating ${allTemplateIds.length} template characters`);
    await generateCharactersFromTemplates(ctxForCharacters, allTemplateIds);
    await ctxForCharacters.persistAll();
  }

  // ── Post-loop: historical events ───────────────────────────────────────
  if (worldBible?.historicalEvents && worldBible.historicalEvents.length > 0) {
    const ctxWithPlaces = await UniverseContext.loadAtEntryPoint(universe.id);
    const eventsCreated = createHistoricalEventsFromWorldBible(ctxWithPlaces, worldBible);
    await ctxWithPlaces.persistAll();
    logger.info('GeneratorOrchestrator', `Created ${eventsCreated} historical events`);
  }

  // ── Post-loop: cover image ─────────────────────────────────────────────
  const imageBase64 = await generateUniverseImage({ universe: universeData });
  if (imageBase64) {
    const imageUrl = await saveUniverseImage(universe.id, imageBase64);
    await updateUniverse(universe.id, { image: imageUrl });
    logger.info('GeneratorOrchestrator', `Saved cover image: ${imageUrl}`);
  }

  // ── Post-loop: save world bible & documents ────────────────────────────
  if (worldBible) {
    await saveWorldBible(universe.id, worldBible);
    const questionIds = await generateWorldBibleClarifications(worldBible, universe.id);
    if (questionIds.length > 0) {
      logger.info('GeneratorOrchestrator', `Created ${questionIds.length} clarification questions`);
    }
  }

  if (documents?.length) {
    await saveDocuments(universe.id, documents);
  }

  logger.info('GeneratorOrchestrator', `Agentic generation complete for universe: ${universe.id}`);

  // ── Post-loop: population audit (fresh context, after all persistence) ────
  const finalCtx = await UniverseContext.loadAtEntryPoint(universe.id);
  const auditResult = auditWorldPopulation(finalCtx);
  if (!auditResult.isHealthy) {
    logger.error(
      'GeneratorOrchestrator',
      `Population audit UNHEALTHY: ${auditResult.warnings.length} warnings`,
    );
  } else {
    logger.info(
      'GeneratorOrchestrator',
      `Population audit healthy: ${auditResult.warnings.length} warnings, ${auditResult.infos.length} infos`,
    );
  }
  for (const w of auditResult.warnings) {
    logger.warn('GeneratorOrchestrator', `  [${w.code}] ${w.message}`);
  }
  for (const info of auditResult.infos) {
    logger.info('GeneratorOrchestrator', `  [${info.code}] ${info.message}`);
  }

  return { universe: finalCtx.universe, stats };
}
