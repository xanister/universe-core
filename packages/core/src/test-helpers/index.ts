/**
 * Barrel export for shared test helpers.
 *
 * Usage from other packages:
 *   import { createTestPlace, createMockUniverseContext } from '@dmnpc/core/test-helpers/index.js';
 */

export {
  createTestRace,
  createTestVoiceId,
  createTestPlace,
  createTestCharacter,
  createTestExit,
  createTestObjectEntity,
  createOpenAIMock,
} from './fixtures.js';

export {
  getTestUniverseDir,
  setupTestUniverse,
  cleanupTestUniverse,
  setupAndLoadTestUniverse,
  createMockUniverseContext,
  defaultMockUniverse,
  type TestUniverseData,
} from './mock-context.js';

export { mockQueryLlmResponse, mockQueryLlmSchemaResponse } from './mock-openai.js';
