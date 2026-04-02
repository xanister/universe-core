/**
 * Unit tests for cosmos template selection: loadAllTemplates,
 * inferRootPlace, and createRootPlace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadAllTemplates,
  clearLayoutTemplatesCache,
} from '@dmnpc/generation/place-layout/layout-templates.js';
import { inferRootPlace } from '@dmnpc/generation/universe-generator.js';
import type { LayoutTemplate } from '@dmnpc/types/world';

// Mock LLM for inferRootPlace multi-template path
vi.mock('@dmnpc/core/clients/openai-client.js', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    queryLlm: vi.fn().mockResolvedValue({
      content: { templateId: 'cosmos_alt' },
      truncated: false,
      durationMs: 10,
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure fresh load each test
  clearLayoutTemplatesCache();
});

// ---------------------------------------------------------------------------
// loadAllTemplates
// ---------------------------------------------------------------------------
describe('loadAllTemplates', () => {
  it('returns the cosmos template for purpose "cosmos"', () => {
    const results = loadAllTemplates();
    const cosmosTemplates = results.filter((r) => r.template.purposes.includes('cosmos'));
    expect(cosmosTemplates.length).toBeGreaterThanOrEqual(1);
    const ids = cosmosTemplates.map((r) => r.id);
    expect(ids).toContain('cosmos');
  });

  it('returns non-empty array of templates', () => {
    const results = loadAllTemplates();
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns tavern template for purpose "tavern"', () => {
    const results = loadAllTemplates();
    const tavernTemplates = results.filter((r) => r.template.purposes.includes('tavern'));
    expect(tavernTemplates.length).toBeGreaterThanOrEqual(1);
    expect(tavernTemplates[0].id).toBe('tavern');
  });
});

// ---------------------------------------------------------------------------
// inferRootPlace
// ---------------------------------------------------------------------------
describe('inferRootPlace', () => {
  const cosmosTemplate: LayoutTemplate = {
    name: 'Cosmos',
    description: 'Space cosmos',
    purposes: ['cosmos'],
    spriteId: 'star_sun',
    variants: [],
  };

  const cosmosAltTemplate: LayoutTemplate = {
    name: 'Cosmos Alt',
    description: 'An alternate cosmos layout',
    purposes: ['cosmos'],
    spriteId: 'small_walled_town',
    variants: [],
  };

  const available = [
    { id: 'cosmos', template: cosmosTemplate },
    { id: 'cosmos_alt', template: cosmosAltTemplate },
  ];

  it('throws when no templates available', async () => {
    await expect(inferRootPlace(undefined, [])).rejects.toThrow(
      /No cosmos layout templates found/
    );
  });

  it('returns the only template when one exists (no LLM call)', async () => {
    const result = await inferRootPlace(undefined, [
      { id: 'cosmos', template: cosmosTemplate },
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        purpose: 'cosmos',
        label: 'Cosmos',
        description: expect.any(String),
        templateId: 'cosmos',
      })
    );
  });

  it('returns explicit template when cosmosTemplateId hint is provided', async () => {
    const result = await inferRootPlace(undefined, available, {
      cosmosTemplateId: 'cosmos_alt',
    });
    expect(result.templateId).toBe('cosmos_alt');
  });

  it('throws when explicit cosmosTemplateId is not in available templates', async () => {
    await expect(
      inferRootPlace(undefined, available, { cosmosTemplateId: 'fantasy_realm' })
    ).rejects.toThrow(/not found/);
  });

  it('calls LLM when multiple templates and no explicit hint', async () => {
    const result = await inferRootPlace(undefined, available, {
      genre: 'dark fantasy',
    });
    // Mock returns 'cosmos_alt'
    expect(result.templateId).toBe('cosmos_alt');
  });
});
