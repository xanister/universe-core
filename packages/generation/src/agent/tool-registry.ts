/**
 * Generator Tool Registry
 *
 * Exports all generator agent tools as a typed array.
 */

import { planGenerationTool } from './tools/plan-generation.js';
import { generatorCreatePlaceTool } from './tools/create-entity.js';
import { createLayoutTemplateTool } from './tools/create-layout-template.js';
import { listPlacesTool, findPlaceTool, getPlaceDetailsTool } from './tools/query-universe.js';
import { generatorSignalCompleteTool } from './tools/signal-complete.js';

export const GENERATOR_TOOLS = [
  planGenerationTool,
  generatorCreatePlaceTool,
  createLayoutTemplateTool,
  listPlacesTool,
  findPlaceTool,
  getPlaceDetailsTool,
  generatorSignalCompleteTool,
];
