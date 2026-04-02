/**
 * Signal Complete Tool Tests
 */

import { describe, it, expect } from 'vitest';
import { signalCompleteTool } from '../../src/tools/complete-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('signalCompleteTool', () => {
  it('returns complete: true', async () => {
    const context = createMockToolContext();

    const result = await signalCompleteTool.execute({}, { context });

    expect(result).toEqual({ complete: true });
  });

  it('has correct tool metadata', () => {
    expect(signalCompleteTool.name).toBe('signal_complete');
    expect(signalCompleteTool.description).toContain('complete');
  });

  it('has empty input schema', () => {
    const schema = signalCompleteTool.inputSchema;
    expect(() => schema.parse({})).not.toThrow();
  });
});
