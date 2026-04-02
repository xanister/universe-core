import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { generateJournalEntry } from '@dmnpc/generation/narrative/journal-entry-generator.js';
import { setupTestUniverse, cleanupTestUniverse } from '@dmnpc/core/test-helpers/index.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

const TEST_UNIVERSE_ID = '__test_journal__';

// Hoisted mocks for queryLlm and generateImage
const { queryLlmMock, generateImageMock } = vi.hoisted(() => ({
  queryLlmMock: vi.fn(),
  generateImageMock: vi.fn().mockResolvedValue({
    base64: Buffer.from('fake image data').toString('base64'),
    durationMs: 100,
  }),
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  createOpenAIClient: vi.fn(() => ({})),
  queryLlm: queryLlmMock,
  generateImage: generateImageMock,
}));

vi.mock('@dmnpc/core/prompts/transcript-builder.js', () => ({
  buildActionTranscript: vi.fn(() => 'PLAYER: hi\nDM: hello'),
}));

vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock formatFactForReader to avoid potential issues with incomplete context
vi.mock('@dmnpc/core/prompts/fact-formatter.js', () => ({
  formatFactForReader: vi.fn((fact: string) => fact),
}));

// Mock storage service for S3 uploads - returns URL with the key included
vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  storageService: {
    uploadFile: vi.fn().mockImplementation((key: string) => 
      Promise.resolve(`https://test-bucket.s3.us-east-1.amazonaws.com/${key}`)
    ),
    getPublicUrl: vi.fn((key: string) => `https://test-bucket.s3.us-east-1.amazonaws.com/${key}`),
    exists: vi.fn().mockResolvedValue(false),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

const mockCharacter = {
  id: 'CHAR_player',
  label: 'Player',
  description: 'A test player character',
  short_description: 'a player',
  tags: [],
  position: { x: null, y: null, parent: 'PLACE_city' },
  info: {
    placeId: 'PLACE_city',
    aliases: [],
    birthdate: 'Year 1',
    birthPlace: 'City',
    gender: 'Male',

    personality: 'Brave',
    race: 'Human',
    journal: [],
    messages: [
      { role: 'user', content: 'I greet the NPC.' },
      { role: 'assistant', content: 'The NPC greets you back.' },
    ],
    storytellerState: {
      storytellerId: 'STORYTELLER_test',
      activePlots: [
        {
          id: 'plot_test',
          plan: {
            plot: 'A test plot about meeting an NPC.',
            characters: [],
            places: [],
            items: [],
            turningPoints: [
              {
                id: 'TP_greeting',
                essentialInformation: ['Player greets the NPC'],
                progressTarget: 10,
                dramaticRole: 'inciting_incident',
                triggered: true,
                possibleFlags: [{ id: 'greeted_npc', triggerDescription: 'Greeted NPC' }],
              },
            ],
            goals: [
              {
                id: 'GOAL_greet',
                description: 'Greet the NPC',
                progressBoost: 10,
                revealOnFlags: ['greeted_npc'],
                successFlags: ['greeted_npc'],
                revealedAt: '2024-01-01',
                status: 'success', // Goal is achieved
              },
            ],
          },
          progressLevel: 10,
          storyFlags: ['greeted_npc'], // Goal is achieved because flag is set
          openingEventAt: '2024-01-01',
          status: 'active',
          events: [],
        },
      ],
      generationInProgress: false,
      eventHistory: [],
      storytellerSelectedAt: '2024-01-01',
      custom: {},
    },
  },
  entityType: 'character',
  relationships: [],
};

const mockUniverse = {
  id: TEST_UNIVERSE_ID,
  name: 'Test Universe',
  version: '1.0.0',
  description: 'A test universe',
  custom: {},
  rules: 'Test rules',
  tone: 'Test tone',
  style: 'Test style',
  voice: 'alloy',
  date: '2024-01-01',
  characters: [mockCharacter],
  places: [
    {
      id: 'PLACE_city',
      label: 'City',
      description: 'A bustling city',
      entityType: 'place',
      tags: [],
      position: { x: null, y: null, parent: null },
      info: {},
      relationships: [],
    },
  ],
};

vi.mock('@dmnpc/core/universe/universe-context.js', () => ({
  UniverseContext: {
    loadAtEntryPoint: vi.fn(async () => ({
      universeId: TEST_UNIVERSE_ID,
      universe: mockUniverse,
      getCharacter: vi.fn(() => mockCharacter),
      getPlace: vi.fn(() => mockUniverse.places[0]),
      findCharacter: vi.fn(() => mockCharacter),
      findPlace: vi.fn(() => mockUniverse.places[0]),
      upsertEntity: vi.fn(),
      getEventsForCharacter: vi.fn(() => []),
      isKnown: vi.fn(() => true),
    })),
  },
}));

describe('services/journal.ts', () => {
  // Save and restore the env variable since we need image generation for these tests
  const savedImageGeneration = process.env.DISABLE_IMAGE_GENERATION;

  beforeAll(async () => {
    // Enable image generation for these tests
    delete process.env.DISABLE_IMAGE_GENERATION;

    await setupTestUniverse(TEST_UNIVERSE_ID, {
      name: 'Test Universe',
      version: '1.0.0',
    });
  });

  afterAll(async () => {
    // Restore the env variable
    if (savedImageGeneration !== undefined) {
      process.env.DISABLE_IMAGE_GENERATION = savedImageGeneration;
    }
    await cleanupTestUniverse(TEST_UNIVERSE_ID);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mockResolvedValueOnce queue by calling mockReset on the queryLlm mock
    queryLlmMock.mockReset();
  });

  it('generates journal entry with content', async () => {
    // Mock journal content generation (first call - plain text)
    // Then mock subject detection (second call - JSON schema response)
    queryLlmMock
      .mockResolvedValueOnce({
        content: 'Today I met an interesting person.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: null, description: null },
        truncated: false,
        durationMs: 100,
      });

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry.content).toBe('Today I met an interesting person.');
    expect(entry.gameDate).toBeDefined();
    expect(entry.image).toBeNull();
    expect(entry.facts).toEqual([]); // Facts are no longer extracted in journal.ts
  });

  it('generates journal entry with image when significant subject is detected', async () => {
    // Mock journal content generation (first call - plain text)
    // Then mock subject detection (second call - JSON schema response)
    queryLlmMock
      .mockResolvedValueOnce({
        content: 'Today I met an interesting person.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: 'a friendly NPC', description: 'a smiling person waving hello' },
        truncated: false,
        durationMs: 100,
      });

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry.content).toBe('Today I met an interesting person.');
    expect(entry.image).toBeDefined();
    // Image is now an S3 URL
    expect(entry.image).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
    expect(entry.image).toContain('journal_');
    expect(entry.image).toContain('.png');

    // Verify queryLlm was called for journal generation and subject detection
    expect(queryLlmMock).toHaveBeenCalledTimes(2);
  });

  it('generates journal entry without image when no significant subject is detected', async () => {
    // Mock journal content generation (first call - plain text)
    // Then mock subject detection to return null (second call - JSON schema response)
    queryLlmMock
      .mockResolvedValueOnce({
        content: 'Today was uneventful.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: null, description: null },
        truncated: false,
        durationMs: 100,
      });

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry.content).toBe('Today was uneventful.');
    expect(entry.image).toBeNull();

    // Verify queryLlm was called for journal generation and subject detection
    expect(queryLlmMock).toHaveBeenCalledTimes(2);
  });

  it('saves journal image as file with correct URL format', async () => {
    // Mock journal content generation (first call - plain text)
    // Then mock subject detection (second call - JSON schema response)
    queryLlmMock
      .mockResolvedValueOnce({
        content: 'Today I met someone.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: 'an NPC', description: 'a friendly person' },
        truncated: false,
        durationMs: 100,
      });

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry.content).toBe('Today I met someone.');
    expect(entry.image).toBeDefined();
    // Image is now an S3 URL
    expect(entry.image).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
    expect(entry.image).toMatch(/journal_CHAR_player_\d+\.png$/);

    // Verify the image is a URL, not a base64 data URI
    expect(entry.image).not.toMatch(/^data:image/);
  });

  it('handles image generation failure gracefully', async () => {
    // Mock journal content generation (first call - plain text)
    // Then mock subject detection (second call - JSON schema response)
    queryLlmMock
      .mockResolvedValueOnce({
        content: 'Today I met someone.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: 'an NPC', description: 'a friendly person' },
        truncated: false,
        durationMs: 100,
      });

    // Mock image generation to fail
    generateImageMock.mockRejectedValueOnce(new Error('Image generation failed'));

    // Should not throw, but entry may not have image
    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry.content).toBe('Today I met someone.');
    // Image may or may not be present depending on error handling
  });

  it('returns fallback content when journal generation fails', async () => {
    queryLlmMock.mockRejectedValueOnce(new Error('OpenAI error'));

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry.content).toContain('unable to properly record');
  });

  it('generates unique filenames for journal images', async () => {
    // Mock journal generation and subject detection for first entry
    queryLlmMock
      .mockResolvedValueOnce({
        content: 'First entry.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: 'an NPC', description: 'a friendly person' },
        truncated: false,
        durationMs: 100,
      })
      // Mock for second entry
      .mockResolvedValueOnce({
        content: 'Second entry.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: 'an NPC', description: 'a friendly person' },
        truncated: false,
        durationMs: 100,
      });

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry1 = await generateJournalEntry(ctx, 'CHAR_player');
    // Wait a bit to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));
    const entry2 = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry1.content).toBe('First entry.');
    expect(entry2.content).toBe('Second entry.');
    expect(entry1.image).toBeDefined();
    expect(entry2.image).toBeDefined();
    expect(entry1.image).not.toBe(entry2.image);
  });

  it('uses conversationContext when available', async () => {
    // Update mock character to have conversationContext
    const characterWithContext = {
      ...mockCharacter,
      info: {
        ...mockCharacter.info,
        conversationContext: 'Previously, the player explored the forest.',
      },
    };

    const { UniverseContext } = await import('@dmnpc/core/universe/universe-context.js');
    vi.mocked(UniverseContext.loadAtEntryPoint).mockResolvedValueOnce({
      universeId: TEST_UNIVERSE_ID,
      universe: mockUniverse,
      getCharacter: vi.fn(() => characterWithContext as any),
      getPlace: vi.fn(() => mockUniverse.places[0]),
      findCharacter: vi.fn(() => characterWithContext as any),
      findPlace: vi.fn(() => mockUniverse.places[0]),
      upsertEntity: vi.fn(),
      getEventsForCharacter: vi.fn(() => []),
    } as any);

    queryLlmMock
      .mockResolvedValueOnce({
        content: 'Today I continued my adventure.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: null, description: null },
        truncated: false,
        durationMs: 100,
      });

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    const entry = await generateJournalEntry(ctx, 'CHAR_player');

    expect(entry.content).toBe('Today I continued my adventure.');
    // Verify the prompt included conversation context
    const firstCall = queryLlmMock.mock.calls[0][0];
    expect(firstCall.prompt).toContain('Story so far');
    expect(firstCall.prompt).toContain('Previously, the player explored the forest.');
  });

  it('includes plot data in subject detection context', async () => {
    // Mock journal generation and subject detection
    queryLlmMock
      .mockResolvedValueOnce({
        content: 'Today I achieved my goal.',
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: { subject: 'a goal achievement', description: 'the moment of success' },
        truncated: false,
        durationMs: 100,
      });

    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    await generateJournalEntry(ctx, 'CHAR_player');

    // Verify the subject detection prompt includes plot data
    const secondCall = queryLlmMock.mock.calls[1][0];
    expect(secondCall.prompt).toContain('PLOT DATA');
    expect(secondCall.prompt).toContain('ACHIEVED GOALS');
    expect(secondCall.prompt).toContain('Greet the NPC'); // From the mock character's storytellerState
  });
});
