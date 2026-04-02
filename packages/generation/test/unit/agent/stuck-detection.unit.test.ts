/**
 * Unit tests for stuck detection logic.
 */

import { describe, it, expect } from 'vitest';
import { detectStuck } from '@dmnpc/generation/agent/generator-orchestrator.js';
import type { AgentStep } from '@xanister/reagent';

function makeStep(
  stepNumber: number,
  toolNames: string[],
  errorAll = false
): AgentStep<any> {
  return {
    stepNumber,
    toolCalls: toolNames.map((name) => ({ id: `call_${stepNumber}`, name, input: {} })),
    toolResults: toolNames.map((name) => (
      errorAll
        ? { type: 'tool-error' as const, toolCallId: `call_${stepNumber}`, toolName: name, error: 'fail' }
        : { type: 'tool-result' as const, toolCallId: `call_${stepNumber}`, toolName: name, output: {} }
    )),
    finishReason: 'tool-calls',
  };
}

describe('detectStuck', () => {
  it('returns undefined with no steps', () => {
    expect(detectStuck([], 0, 0)).toBeUndefined();
  });

  it('returns undefined when progress is being made', () => {
    const steps = [
      makeStep(1, ['plan_generation']),
      makeStep(2, ['create_place']),
      makeStep(3, ['create_place']),
    ];
    // 2 places created since last check
    expect(detectStuck(steps, 0, 2)).toBeUndefined();
  });

  it('detects repeated tool with no progress', () => {
    const steps = [
      makeStep(1, ['list_places']),
      makeStep(2, ['list_places']),
      makeStep(3, ['list_places']),
    ];
    const result = detectStuck(steps, 0, 0);
    expect(result).toContain('Repeated tool');
    expect(result).toContain('list_places');
  });

  it('does not flag repeated tool when places are being created', () => {
    const steps = [
      makeStep(1, ['create_place']),
      makeStep(2, ['create_place']),
      makeStep(3, ['create_place']),
    ];
    // Progress: 3 places created
    expect(detectStuck(steps, 0, 3)).toBeUndefined();
  });

  it('detects error loop', () => {
    const steps = [
      makeStep(1, ['create_place'], true),
      makeStep(2, ['create_place'], true),
    ];
    const result = detectStuck(steps, 0, 0);
    expect(result).toContain('errored');
    expect(result).toContain('create_place');
  });

  it('does not flag single error', () => {
    const steps = [
      makeStep(1, ['create_place'], true),
    ];
    expect(detectStuck(steps, 0, 0)).toBeUndefined();
  });

  it('detects no-progress after create attempts', () => {
    const steps = [
      makeStep(1, ['plan_generation']),
      makeStep(2, ['create_place']),
      makeStep(3, ['list_places']),
      makeStep(4, ['find_place']),
      makeStep(5, ['get_place_details']),
    ];
    // No new places in 5 steps, and at least one create was attempted
    const result = detectStuck(steps, 0, 0);
    expect(result).toContain('No new places');
  });

  it('does not flag no-progress during planning phase', () => {
    const steps = [
      makeStep(1, ['plan_generation']),
      makeStep(2, ['list_places']),
      makeStep(3, ['find_place']),
      makeStep(4, ['get_place_details']),
      makeStep(5, ['list_places']),
    ];
    // No create_place attempted yet — still in planning
    expect(detectStuck(steps, 0, 0)).toBeUndefined();
  });

  it('does not flag when under threshold count', () => {
    const steps = [
      makeStep(1, ['create_place']),
      makeStep(2, ['list_places']),
    ];
    // Only 2 steps, under the 5-step no-progress threshold
    expect(detectStuck(steps, 0, 0)).toBeUndefined();
  });
});
