/**
 * Run Extraction Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runExtractionTool } from '../../src/tools/extraction-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('runExtractionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls extraction service', async () => {
    const context = createMockToolContext();

    await runExtractionTool.execute({}, { context });

    expect(context.services.extraction.runTurnExtraction).toHaveBeenCalledWith(context);
  });

  it('returns success after extraction', async () => {
    const context = createMockToolContext();

    const result = await runExtractionTool.execute({}, { context });

    expect(result).toEqual({ extracted: true });
  });

  it('has correct tool metadata', () => {
    expect(runExtractionTool.name).toBe('run_extraction');
    expect(runExtractionTool.description).toContain('Extract');
  });

  it('has empty input schema', () => {
    const schema = runExtractionTool.inputSchema;
    expect(() => schema.parse({})).not.toThrow();
  });
});
