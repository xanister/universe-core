/**
 * Schema compliance: OpenAI Responses API requires every key in `properties`
 * to be in `required`. So agent tool inputSchema must not use .optional() —
 * use sentinel values (e.g. "" or "unspecified") and map to undefined in execute.
 *
 * This test fails if any tool has optional fields, so we catch regressions in CI.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  classifyInputTool,
  checkStorytellerTool,
  arbitrateActionsTool,
  executeStateChangesTool,
  describeNarrativeTool,
  runExtractionTool,
  signalCompleteTool,
  determineActionOutcomeTool,
  advanceTimeTool,
  moveCharacterTool,
  createCharacterTool,
  setStoryFlagsTool,
  createPlaceTool,
  createExitTool,
  updateDispositionTool,
  modifyInventoryTool,
  createEventTool,
  triggerStorytellerTool,
  queryNearbyTool,
  queryEventsTool,
  queryFlagsTool,
  searchPlacesTool,
  searchCharactersTool,
} from '../src/tools/index.js';

const ALL_TOOLS = [
  classifyInputTool,
  checkStorytellerTool,
  arbitrateActionsTool,
  executeStateChangesTool,
  describeNarrativeTool,
  runExtractionTool,
  signalCompleteTool,
  determineActionOutcomeTool,
  advanceTimeTool,
  moveCharacterTool,
  createCharacterTool,
  setStoryFlagsTool,
  createPlaceTool,
  createExitTool,
  updateDispositionTool,
  modifyInventoryTool,
  createEventTool,
  triggerStorytellerTool,
  queryNearbyTool,
  queryEventsTool,
  queryFlagsTool,
  searchPlacesTool,
  searchCharactersTool,
];

function getOptionalKeys(schema: z.ZodTypeAny): string[] {
  const def = (schema as { _def?: { shape?: () => Record<string, z.ZodTypeAny> } })._def;
  if (!def?.shape) return [];
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  if (!shape || typeof shape !== 'object') return [];
  const optional: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const v = value as { _def?: { typeName?: string } };
    if (v?._def?.typeName === 'ZodOptional') optional.push(key);
  }
  return optional;
}

describe('OpenAI schema compliance: no optional tool params', () => {
  for (const tool of ALL_TOOLS) {
    it(`${tool.name} has no optional fields in inputSchema`, () => {
      const schema = (tool as { inputSchema?: z.ZodTypeAny }).inputSchema;
      if (!schema) return;
      const optional = getOptionalKeys(schema);
      expect(
        optional,
        `Tool ${tool.name} has optional fields (${optional.join(', ')}). ` +
          `OpenAI Responses API requires every key in properties to be in required. ` +
          `Use a sentinel value (e.g. "" or "unspecified") and map to undefined in execute().`,
      ).toEqual([]);
    });
  }
});
