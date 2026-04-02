/**
 * Repair Function Registry
 *
 * Exports all repair functions for fixing validation issues.
 */

export { applyDeterministicRepair } from './deterministic-repairs.js';
export { applyLlmRepair } from './llm-repairs.js';
export { applyDuplicateMerge } from './duplicate-merge.js';
export { applyCharacterSpriteRepair } from './character-sprite-repairs.js';
export { applyLayoutRepair } from './layout-repairs.js';
