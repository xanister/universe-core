/**
 * Unit tests for the agentic generator orchestrator.
 * Verifies the pre-loop → agent loop → post-loop flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRunAgentLoop,
  mockCreateAgentProvider,
  mockGenerateUniverse,
  mockInferRootPlace,
  mockCreateUniverse,
  mockUpdateUniverse,
  mockLoadAtEntryPoint,
  mockParseDocuments,
  mockProcessDocuments,
  mockMatchCharacters,
  mockMergeAllMatches,
  mockGenCharsFromTemplates,
  mockGenCharsFromMerged,
  mockCreateHistoricalEvents,
  mockGenerateUniverseImage,
  mockSaveUniverseImage,
  mockSaveWorldBible,
  mockGenWorldBibleClarifications,
  mockSaveDocuments,
  mockLoadAllTemplates,
  mockLoadPurposeIds,
  mockLoadPurposeDefinition,
  mockLoadSpriteArchetypes,
  mockLoadCharacterBasesManifest,
  mockLoadClothingData,
  mockRootPlace,
  mockProvider,
  mockUniverse,
  mockCtx,
} = vi.hoisted(() => {
  const mockProvider = { chat: vi.fn() };

  const mockUniverse = {
    id: 'test_universe',
    name: 'Test Universe',
    description: 'A test universe',
    version: '1.0.0',
    rootPlaceId: '',
    races: [],
    tone: 'epic',
    style: 'fantasy',
    rules: 'none',
    date: '01.01.1000',
    calendar: { name: 'Standard', calendarType: 'standard', months: [], time: { hoursPerDay: 24, minutesPerHour: 60 }, eras: [], defaultEra: 0, seasons: null, format: null },
    custom: {},
    image: null,
    weather: null,
    weatherSeverity: null,
    climate: null,
    music: null,
    events: null,
    objects: null,
    mapStyle: null,
    defaultStartPlaceId: null,
    stagingSpriteTheme: 'fantasy',
    hungerFatigueEnabled: false,
    rulesetId: null,
    characters: [],
    places: [],
  };

  const mockRootPlace = { id: 'place_root', label: 'Root', position: { parent: null }, info: { purpose: 'cosmos' }, tags: [] };

  const mockCtx = {
    universe: mockUniverse,
    getAllPlaces: vi.fn().mockReturnValue([mockRootPlace]),
    getAllCharacters: vi.fn().mockReturnValue([]),
    getPlace: vi.fn().mockImplementation((id: string) => id === 'place_root' ? mockRootPlace : null),
    findPlace: vi.fn().mockImplementation((id: string) => id === 'place_root' ? mockRootPlace : null),
    getChildPlaces: vi.fn().mockReturnValue([]),
    persistAll: vi.fn().mockResolvedValue(undefined),
    getObjectsByPlace: vi.fn().mockReturnValue([]),
  };

  return {
    mockRunAgentLoop: vi.fn().mockResolvedValue({
      finishReason: 'complete',
      steps: [{ stepNumber: 1, toolCalls: [{ name: 'signal_complete' }], toolResults: [] }],
    }),
    mockCreateAgentProvider: vi.fn().mockReturnValue(mockProvider),
    mockGenerateUniverse: vi.fn().mockResolvedValue({
      universe: mockUniverse,
      rootPlaceName: 'Test Root',
      rootPlaceDescription: 'A test root place',
    }),
    mockInferRootPlace: vi.fn().mockResolvedValue({
      purpose: 'cosmos',
      label: 'Test Cosmos',
      description: 'The test cosmos',
      templateId: 'cosmos',
    }),
    mockCreateUniverse: vi.fn().mockReturnValue(mockUniverse),
    mockUpdateUniverse: vi.fn().mockResolvedValue(undefined),
    mockLoadAtEntryPoint: vi.fn().mockResolvedValue(mockCtx),
    mockParseDocuments: vi.fn().mockResolvedValue([]),
    mockProcessDocuments: vi.fn().mockResolvedValue(undefined),
    mockMatchCharacters: vi.fn().mockResolvedValue({ matched: [], unmatched: [] }),
    mockMergeAllMatches: vi.fn().mockResolvedValue([]),
    mockGenCharsFromTemplates: vi.fn().mockResolvedValue([]),
    mockGenCharsFromMerged: vi.fn().mockResolvedValue([]),
    mockCreateHistoricalEvents: vi.fn().mockReturnValue(0),
    mockGenerateUniverseImage: vi.fn().mockResolvedValue(null),
    mockSaveUniverseImage: vi.fn().mockResolvedValue('https://s3/cover.png'),
    mockSaveWorldBible: vi.fn().mockResolvedValue(undefined),
    mockGenWorldBibleClarifications: vi.fn().mockResolvedValue([]),
    mockSaveDocuments: vi.fn().mockResolvedValue([]),
    mockLoadAllTemplates: vi.fn().mockReturnValue([
      {
        id: 'cosmos',
        template: {
          name: 'Cosmos',
          description: 'A cosmos template',
          purposes: ['cosmos'],
          variants: [{ id: 'default' }],
        },
      },
    ]),
    mockLoadPurposeIds: vi.fn().mockReturnValue(['cosmos', 'tavern', 'guard']),
    mockLoadPurposeDefinition: vi.fn().mockImplementation((id: string) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      category: id === 'guard' ? 'character' : 'place',
    })),
    mockRootPlace,
    mockProvider,
    mockUniverse,
    mockCtx,
  };
});

vi.mock('@xanister/reagent', () => ({
  runAgentLoop: mockRunAgentLoop,
  tool: vi.fn().mockImplementation((config) => config),
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  createAgentProvider: mockCreateAgentProvider,
}));

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@dmnpc/core/infra/models.js', () => ({
  MODELS: { FLAGSHIP: 'gpt-5.2', MINI: 'gpt-5-mini', NANO: 'gpt-5-nano', PRO: 'gpt-5.2-pro' },
}));

vi.mock('@dmnpc/core/stores/world-bible-store.js', () => ({
  saveWorldBible: mockSaveWorldBible,
}));

vi.mock('@dmnpc/core/universe/universe-context.js', () => ({
  UniverseContext: { loadAtEntryPoint: mockLoadAtEntryPoint },
}));

vi.mock('@dmnpc/core/universe/universe-store.js', () => ({
  createUniverse: mockCreateUniverse,
  updateUniverse: mockUpdateUniverse,
}));


vi.mock('@dmnpc/generation/universe-generator.js', () => ({
  generateUniverse: mockGenerateUniverse,
  generateUniverseImage: mockGenerateUniverseImage,
  saveUniverseImage: mockSaveUniverseImage,
  inferRootPlace: mockInferRootPlace,
}));

vi.mock('@dmnpc/generation/document/document-parser.js', () => ({
  parseDocuments: mockParseDocuments,
}));

vi.mock('@dmnpc/generation/document/document-processor.js', () => ({
  processDocuments: mockProcessDocuments,
  generateWorldBibleClarifications: mockGenWorldBibleClarifications,
}));

vi.mock('@dmnpc/generation/document/document-storage.js', () => ({
  saveDocuments: mockSaveDocuments,
}));

vi.mock('@dmnpc/generation/template-matcher.js', () => ({
  matchCharactersToTemplates: mockMatchCharacters,
}));

vi.mock('@dmnpc/generation/document/template-document-merger.js', () => ({
  mergeAllMatches: mockMergeAllMatches,
}));

vi.mock('@dmnpc/generation/character/template-character-generator.js', () => ({
  generateCharactersFromTemplates: mockGenCharsFromTemplates,
  generateCharactersFromMergedDefinitions: mockGenCharsFromMerged,
}));

vi.mock('@dmnpc/generation/narrative/historical-event-creator.js', () => ({
  createHistoricalEventsFromWorldBible: mockCreateHistoricalEvents,
}));

vi.mock('@dmnpc/generation/place-layout/layout-templates.js', () => ({
  loadAllTemplates: mockLoadAllTemplates,
}));

vi.mock('@dmnpc/generation/purpose-loader.js', () => ({
  loadPurposeIds: mockLoadPurposeIds,
  loadPurposeDefinition: mockLoadPurposeDefinition,
}));

import { generateUniverseAgentic } from '@dmnpc/generation/agent/generator-orchestrator.js';

beforeEach(() => {
  mockCtx.universe = { ...mockUniverse, rootPlaceId: '' };
  mockCtx.getAllPlaces.mockReturnValue([mockRootPlace]);
  mockCtx.getAllCharacters.mockReturnValue([]);
});

describe('generateUniverseAgentic', () => {
  it('runs pre-loop setup, agent loop, and post-loop in order', async () => {
    const result = await generateUniverseAgentic({ hints: { genre: 'fantasy' } });

    expect(result.universe).toBeDefined();
    expect(result.universe.id).toBe('test_universe');

    expect(mockInferRootPlace).toHaveBeenCalledOnce();
    expect(mockGenerateUniverse).toHaveBeenCalledWith({ genre: 'fantasy' }, undefined);
    expect(mockCreateUniverse).toHaveBeenCalledOnce();

    expect(mockRunAgentLoop).toHaveBeenCalledOnce();
    const loopArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(loopArgs.tools).toHaveLength(7);
    expect(loopArgs.maxSteps).toBe(25);
    expect(loopArgs.systemPrompt).toContain('DATA CATALOG');
    expect(loopArgs.userPrompt).toContain('Test Universe');

    expect(mockGenerateUniverseImage).toHaveBeenCalledOnce();
  });

  it('handles max-steps finish reason without throwing', async () => {
    mockRunAgentLoop.mockResolvedValueOnce({
      finishReason: 'max-steps',
      steps: Array.from({ length: 25 }, (_, i) => ({
        stepNumber: i + 1,
        toolCalls: [{ name: 'create_entity' }],
      })),
    });

    const result = await generateUniverseAgentic({ hints: {} });
    expect(result.universe).toBeDefined();
  });

  it('throws on agent loop error when no places created', async () => {
    mockCtx.getAllPlaces.mockReturnValue([]);
    mockRunAgentLoop.mockResolvedValueOnce({
      finishReason: 'error',
      steps: [],
      error: new Error('LLM failed'),
    });

    await expect(generateUniverseAgentic({ hints: {} })).rejects.toThrow('Agent generation failed');
  });

  it('proceeds gracefully on agent loop error when places exist', async () => {
    mockRunAgentLoop.mockResolvedValueOnce({
      finishReason: 'error',
      steps: [{ stepNumber: 1, toolCalls: [{ name: 'create_place' }], toolResults: [] }],
      error: new Error('LLM failed'),
    });

    const result = await generateUniverseAgentic({ hints: {} });
    expect(result.universe).toBeDefined();
  });

  it('skips document processing when no documents provided', async () => {
    await generateUniverseAgentic({ hints: {} });
    expect(mockParseDocuments).not.toHaveBeenCalled();
    expect(mockProcessDocuments).not.toHaveBeenCalled();
  });

  it('processes documents and passes worldBible to agent context', async () => {
    const worldBible = {
      overview: 'Test world',
      themes: ['adventure'],
      tone: 'epic',
      atmosphere: 'dark',
      lore: 'Ancient',
      rules: [],
      characters: [],
      places: [],
      keyConflicts: [],
      historicalEvents: [],
      historicalLore: null,
      narrativePresent: null,
    };
    mockParseDocuments.mockResolvedValueOnce([{ filename: 'test.txt', content: 'test' }]);
    mockProcessDocuments.mockResolvedValueOnce(worldBible);

    await generateUniverseAgentic({
      hints: {},
      documents: [{ filename: 'test.txt', contentBase64: 'dGVzdA==' }],
    });

    expect(mockParseDocuments).toHaveBeenCalledOnce();
    expect(mockProcessDocuments).toHaveBeenCalledOnce();

    const loopArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(loopArgs.systemPrompt).toContain('WORLD BIBLE');
  });

  it('generates template characters in post-loop when templateIds provided', async () => {
    await generateUniverseAgentic({
      hints: {},
      templateIds: ['template_hero'],
    });

    expect(mockGenCharsFromTemplates).toHaveBeenCalledWith(
      mockCtx,
      ['template_hero']
    );
  });

  it('saves cover image when generation succeeds', async () => {
    mockGenerateUniverseImage.mockResolvedValueOnce('base64imagedata');

    await generateUniverseAgentic({ hints: {} });

    expect(mockSaveUniverseImage).toHaveBeenCalledWith('test_universe', 'base64imagedata');
    expect(mockUpdateUniverse).toHaveBeenCalledWith('test_universe', {
      image: 'https://s3/cover.png',
    });
  });

  it('includes catalog data in system prompt', async () => {
    await generateUniverseAgentic({ hints: {} });

    const loopArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(loopArgs.systemPrompt).toContain('Cosmos');
    expect(loopArgs.systemPrompt).toContain('cosmos');
    expect(loopArgs.systemPrompt).toContain('Place Purposes');
  });

  it('uses correct model and max steps from config', async () => {
    await generateUniverseAgentic({ hints: {} });

    expect(mockCreateAgentProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.2',
        maxTokens: 4096,
      })
    );

    const loopArgs = mockRunAgentLoop.mock.calls[0][0];
    expect(loopArgs.maxSteps).toBe(25);
  });
});
