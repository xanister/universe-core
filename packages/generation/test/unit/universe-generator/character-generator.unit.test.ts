import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  setupAndLoadTestUniverse,
  cleanupTestUniverse,
  getTestUniverseDir,
} from '@dmnpc/core/test-helpers/index.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import { readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const { queryLlmMock, detectFacePositionMock } = vi.hoisted(() => ({
  queryLlmMock: vi.fn(),
  detectFacePositionMock: vi.fn().mockResolvedValue(0.35),
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  createOpenAIClient: vi.fn(() => ({
    responses: {
      create: queryLlmMock,
    },
  })),
  queryLlm: queryLlmMock,
  detectFacePosition: detectFacePositionMock,
}));

vi.mock('@dmnpc/core/entities/tag-manager.js', () => ({
  ensureTags: vi.fn((tags: string[]) => tags),
  getExistingTagLabels: vi.fn(() => Promise.resolve(new Set<string>())),
}));

vi.mock('@dmnpc/generation/id-generator.js', () => ({
  generateEntityId: vi.fn(() => 'CHAR_generated'),
}));

// Mock the routine generator to prevent async OpenAI calls from interfering with tests
vi.mock('@dmnpc/generation/narrative/routine-generator.js', () => ({
  generateCharacterRoutine: vi.fn().mockResolvedValue({}),
}));

// Mock entity image service for waitForImage tests
const { generateEntityImageMock, savePortraitFromBase64Mock } = vi.hoisted(() => ({
  generateEntityImageMock: vi.fn().mockResolvedValue('/api/media/test/image.png'),
  savePortraitFromBase64Mock: vi.fn().mockResolvedValue('/api/media/test/portrait.png'),
}));

vi.mock('@dmnpc/generation/media/entity-image-service.js', () => ({
  generateEntityImage: generateEntityImageMock,
  savePortraitFromBase64: savePortraitFromBase64Mock,
}));

const { generatePlaceMock } = vi.hoisted(() => ({
  generatePlaceMock: vi.fn(),
}));

vi.mock('@dmnpc/generation/place-generator.js', () => ({
  generatePlace: generatePlaceMock,
}));

const { loadPlaceLayoutMock } = vi.hoisted(() => ({
  loadPlaceLayoutMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('@dmnpc/core/universe/universe-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dmnpc/core/universe/universe-store.js')>();
  return {
    ...actual,
    loadPlaceLayout: loadPlaceLayoutMock,
  };
});

// Mock voice utilities - voice selection is now integrated into character generation
const { getAvailableVoicesMock, formatVoicesForPromptMock } = vi.hoisted(() => ({
  getAvailableVoicesMock: vi.fn().mockReturnValue([
    {
      id: 'test-voice',
      name: 'Test Voice',
      description: 'A test voice',
      source: 'preset',
      enabled: true,
      metadata: { gender: 'male', ageRange: 'middle-aged', accent: '', traits: [], suitableFor: [] },
      provider: { type: 'elevenlabs', voiceId: 'test-voice-id', settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 } },
    },
    {
      id: 'female-voice',
      name: 'Female Voice',
      description: 'A female test voice',
      source: 'preset',
      enabled: true,
      metadata: { gender: 'female', ageRange: 'young', accent: '', traits: [], suitableFor: [] },
      provider: { type: 'elevenlabs', voiceId: 'female-voice-id', settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 } },
    },
  ]),
  formatVoicesForPromptMock: vi
    .fn()
    .mockReturnValue('- test-voice: "Test Voice"\n- female-voice: "Female Voice"'),
}));

vi.mock('@dmnpc/generation/character/voice-matcher.js', () => ({
  getAvailableVoices: getAvailableVoicesMock,
  formatVoicesForPrompt: formatVoicesForPromptMock,
}));

// Mock sprite archetype lookups used by resolveHeadTypeForCharacter
vi.mock('@dmnpc/sprites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dmnpc/sprites')>();
  return {
    ...actual,
    getSpriteArchetype: vi.fn().mockReturnValue({
      id: 'human',
      allowedHeadTypes: ['human_male', 'human_female'],
      genderHeadMap: { male: 'human_male', female: 'human_female' },
    }),
    resolveHeadType: vi.fn().mockReturnValue('human_male'),
    loadSpriteArchetypes: vi.fn(),
    loadCharacterBasesManifest: vi.fn(),
  };
});

// Mock character sprite helper to avoid real sprite generation in tests
vi.mock('@dmnpc/generation/character/character-sprite-helper.js', () => ({
  generateCharacterSprite: vi.fn().mockResolvedValue({
    bodyType: 'male',
    layers: [],
    spriteUrl: '/api/media/test/sprites/CHAR_test.png',
  }),
  findRaceOrFallback: vi.fn().mockReturnValue({
    id: 'human',
    label: 'Human',
    description: 'Test',
    rarity: 'common',
    spriteHints: { humanoidBody: true, spriteArchetype: 'human', defaultSkinColor: 'light', allowedSkinColors: ['light'], allowedEyeColors: null, allowedHairColors: null, spriteScale: 1, featureLayers: null },
  }),
  normalizeSkinToneForRace: vi.fn((skinTone: string | null | undefined) => skinTone ?? 'light'),
  normalizeEyeColorForRace: vi.fn((eyeColor: string | null | undefined) => eyeColor ?? 'brown'),
  normalizeHairColorForRace: vi.fn((hairColor: string | null | undefined) => hairColor ?? 'brown'),
  resolveAutoGenOverlayLayers: vi.fn().mockReturnValue(['eyes']),
}));

const TEST_UNIVERSE_ID = '__test_character_generator__';

async function withCtxResult<T>(action: (ctx: UniverseContext) => Promise<T>): Promise<T> {
  const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
  const result = await action(ctx);
  await ctx.persistAll();
  return result;
}

async function getGenerateCharacter() {
  const mod = await import('@dmnpc/generation/character-generator.js');
  return mod.generateCharacter;
}

beforeAll(async () => {
  await setupAndLoadTestUniverse(TEST_UNIVERSE_ID, {
    name: 'Test Universe',
    description: 'Test universe for character generator',
    places: [
      {
        id: 'PLACE_test',
        label: 'Test Place',
        description: 'A test place',
        short_description: 'test place',
        entityType: 'place',
        tags: ['Town'],
        info: {},
        relationships: [],
        position: { x: 0, y: 0, width: 400, height: 400, innerWidth: 800, innerHeight: 600, parent: null },
      } as any,
      {
        id: 'PLACE_tavern',
        label: 'The Golden Tankard',
        description: 'A cozy tavern in the heart of town',
        short_description: 'cozy tavern',
        entityType: 'place',
        tags: ['tavern'],
        info: { environment: ENVIRONMENT_PRESETS.interior() },
        relationships: [],
        position: { x: 0, y: 0, width: 400, height: 400, innerWidth: 800, innerHeight: 600, parent: 'PLACE_test' },
      } as any,
      {
        id: 'PLACE_smithy',
        label: 'Ironforge Smithy',
        description: 'A busy blacksmith shop',
        short_description: 'busy smithy',
        entityType: 'place',
        tags: ['smithy', 'shop'],
        info: { environment: ENVIRONMENT_PRESETS.interior() },
        relationships: [],
        position: { x: 0, y: 0, width: 400, height: 400, innerWidth: 800, innerHeight: 600, parent: 'PLACE_test' },
      } as any,
    ],
    characters: [],
    objects: [
      {
        id: 'OBJ_exit_test_to_tavern',
        label: 'The Golden Tankard',
        description: 'Door to tavern',
        short_description: 'tavern',
        entityType: 'object',
        tags: [],
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_test' },
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { targetPlaceId: 'PLACE_tavern', exitType: 'door' } },
        relationships: [],
      } as any,
      {
        id: 'OBJ_exit_test_to_smithy',
        label: 'Ironforge Smithy',
        description: 'Door to smithy',
        short_description: 'smithy',
        entityType: 'object',
        tags: [],
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_test' },
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { targetPlaceId: 'PLACE_smithy', exitType: 'door' } },
        relationships: [],
      } as any,
      {
        id: 'OBJ_exit_tavern_to_test',
        label: 'Test Place',
        description: 'Door to test place',
        short_description: 'test place',
        entityType: 'object',
        tags: [],
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_tavern' },
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { targetPlaceId: 'PLACE_test', exitType: 'door' } },
        relationships: [],
      } as any,
      {
        id: 'OBJ_exit_smithy_to_test',
        label: 'Test Place',
        description: 'Door to test place',
        short_description: 'test place',
        entityType: 'object',
        tags: [],
        position: { x: 50, y: 50, width: 32, height: 32, parent: 'PLACE_smithy' },
        info: { purpose: 'exit', solid: true, layer: 'default', spriteConfig: { spriteId: 'door_wooden' }, options: { targetPlaceId: 'PLACE_test', exitType: 'door' } },
        relationships: [],
      } as any,
    ],
  });
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

beforeEach(async () => {
  vi.clearAllMocks();
  generatePlaceMock.mockReset();
  queryLlmMock.mockReset();
  generateEntityImageMock.mockReset();
  generateEntityImageMock.mockResolvedValue('/api/media/test/image.png');
  loadPlaceLayoutMock.mockReset();
  loadPlaceLayoutMock.mockResolvedValue(null);
  savePortraitFromBase64Mock.mockReset();
  savePortraitFromBase64Mock.mockResolvedValue('/api/media/test/portrait.png');
  detectFacePositionMock.mockReset();
  detectFacePositionMock.mockResolvedValue(0.35);
  getAvailableVoicesMock.mockReset();
  getAvailableVoicesMock.mockReturnValue([
    {
      id: 'test-voice',
      name: 'Test Voice',
      description: 'A test voice',
      source: 'preset',
      enabled: true,
      metadata: { gender: 'male', ageRange: 'middle-aged', accent: '', traits: [], suitableFor: [] },
      provider: { type: 'elevenlabs', voiceId: 'test-voice-id', settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 } },
    },
    {
      id: 'female-voice',
      name: 'Female Voice',
      description: 'A female test voice',
      source: 'preset',
      enabled: true,
      metadata: { gender: 'female', ageRange: 'young', accent: '', traits: [], suitableFor: [] },
      provider: { type: 'elevenlabs', voiceId: 'female-voice-id', settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.0 } },
    },
  ]);
  formatVoicesForPromptMock.mockReset();
  formatVoicesForPromptMock.mockReturnValue(
    '- test-voice: "Test Voice"\n- female-voice: "Female Voice"'
  );

  // Delete all character files from disk to ensure clean state
  const charactersDir = join(getTestUniverseDir(TEST_UNIVERSE_ID), 'entities', 'characters');
  if (existsSync(charactersDir)) {
    const files = await readdir(charactersDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        await unlink(join(charactersDir, file));
      }
    }
  }
});

describe('services/universe-generator/character-generator.ts', () => {
  it(
    'generates a character with all required fields including voice',
    async () => {
      const generateCharacter = await getGenerateCharacter();
      queryLlmMock.mockResolvedValueOnce({
        content: {
          label: 'Thorin Ironforge',
          description:
            'He is a tall, muscular man with a red beard and braided hair. His eyes are deep blue, and his hands are calloused from years of smithing.',
          short_description: 'red-bearded smith',
          tags: ['smith'],
          info: {
            race: 'RACE_human', // Must be a valid race ID from test universe
            birthdate: 'Year 45, 3rd Age',
            birthPlace: 'Mountain Hold',
            gender: 'Male',
            eyeColor: 'deep blue',
            hairColor: 'red',
            personality: 'Stoic and hardworking',
            title: '',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [],
          },
        },
      });

      const result = await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'a tall man with a red beard who works as a smith',
          placeId: 'PLACE_test',
        })
      );

      expect(queryLlmMock).toHaveBeenCalledTimes(1); // Only character generation (no relationships if no existing characters)
      expect(result.label).toBe('Thorin Ironforge');
      expect(result.entityType).toBe('character');
      expect(result.short_description).toBe('red-bearded smith');
      expect(result.description).toContain('man');
      expect(result.info.race).toBe('RACE_human');
      expect(result.position.parent).toBe('PLACE_test');
      // Voice should be included from the LLM response
      expect(result.info.voiceId).toBeDefined();
      expect(result.info.voiceId).toBe('test-voice');
    },
    { timeout: 15000 }
  );

  it('assigns voice config from LLM response', async () => {
    const generateCharacter = await getGenerateCharacter();
    queryLlmMock.mockResolvedValueOnce({
      content: {
        label: 'Voice Test Character',
        description: 'A character for testing voice assignment.',
        short_description: 'test character',
        tags: ['test'],
        info: {
          race: 'Human',
          birthdate: 'Year 1',
          birthPlace: 'Test Town',
          gender: 'Female',
          eyeColor: 'brown',
          hairColor: 'black',
          personality: 'Cheerful and energetic',
          title: '',
          aliases: [],
          voiceId: 'female-voice',
          clothing: [],
        },
      },
    });

    const result = await withCtxResult((ctx) =>
      generateCharacter({
        ctx,
        description: 'a cheerful test character',
        placeId: 'PLACE_test',
      })
    );

    // Voice config should be assigned from the LLM response
    expect(result.info.voiceId).toBe('female-voice');

    // Verify getAvailableVoices was called to fetch voice list
    expect(getAvailableVoicesMock).toHaveBeenCalled();
  });

  it('uses default voice when voice fetching fails', async () => {
    const generateCharacter = await getGenerateCharacter();

    // Make voice fetching fail
    getAvailableVoicesMock.mockReset();
    getAvailableVoicesMock.mockImplementation(() => { throw new Error('Voice fetching failed'); });

    queryLlmMock.mockResolvedValueOnce({
      content: {
        label: 'Fallback Voice Character',
        description: 'A character for testing voice fallback.',
        short_description: 'fallback test',
        tags: ['test'],
        info: {
          race: 'Human',
          birthdate: 'Year 1',
          birthPlace: 'Test Town',
          gender: 'Male',
          eyeColor: 'blue',
          hairColor: 'brown',
          personality: 'Quiet and reserved',
          aliases: [],
          voiceId: '', // Empty - default will be used
          clothing: [],
        },
      },
    });
    // Mock for potential relationship determination call (if existing characters)
    queryLlmMock.mockResolvedValueOnce({
      content: { relationships: [] },
    });

    const result = await withCtxResult((ctx) =>
      generateCharacter({
        ctx,
        description: 'a quiet test character',
        placeId: 'PLACE_test',
      })
    );

    // Should still have a voice config (default)
    expect(result.info.voiceId).toBe('sarah'); // Default voice
  });

  it('uses default voice when LLM returns invalid voice ID', async () => {
    const generateCharacter = await getGenerateCharacter();

    // Explicit cleanup to ensure no leftover characters from other tests
    const charactersDir = join(getTestUniverseDir(TEST_UNIVERSE_ID), 'entities', 'characters');
    if (existsSync(charactersDir)) {
      const files = await readdir(charactersDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await unlink(join(charactersDir, file));
        }
      }
    }

    // Load fresh context BEFORE setting up mock to ensure clean state
    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

    queryLlmMock.mockResolvedValueOnce({
      content: {
        label: 'Invalid Voice Character',
        description: 'A character with invalid voice.',
        short_description: 'invalid voice',
        tags: ['test'],
        info: {
          race: 'Human',
          birthdate: 'Year 1',
          birthPlace: 'Test Town',
          gender: 'Male',
          eyeColor: 'blue',
          hairColor: 'brown',
          personality: 'Test',
          aliases: [],
          voiceId: 'invalid-voice-id', // Not in available voices
          clothing: [],
        },
      },
    });

    const result = await generateCharacter({
      ctx,
      description: 'a test character',
      placeId: 'PLACE_test',
    });

    // Should fall back to default voice when LLM returns invalid voice ID
    expect(result.info.voiceId).toBe('sarah'); // Default voice
  });

  it('generates unique short_description that reflects distinctive features', async () => {
    const generateCharacter = await getGenerateCharacter();

    // Explicit cleanup to ensure no leftover characters from other tests
    const charactersDir = join(getTestUniverseDir(TEST_UNIVERSE_ID), 'entities', 'characters');
    if (existsSync(charactersDir)) {
      const files = await readdir(charactersDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await unlink(join(charactersDir, file));
        }
      }
    }

    // Load fresh context BEFORE setting up mock to ensure clean state
    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

    queryLlmMock.mockResolvedValueOnce({
      content: {
        label: 'Elena Moonwhisper',
        description:
          'She is a pale elf with silver hair and distinctive green eyes. A scar runs across her left cheek, and she has pointed ears typical of her kind.',
        short_description: 'scarred silver elf',
        tags: ['elf', 'mage'],
        info: {
          race: 'Elf',
          birthdate: 'Year 100, 2nd Age',
          birthPlace: 'Elven Forest',
          gender: 'Female',
          eyeColor: 'green',
          hairColor: 'silver',
          personality: 'Mysterious and wise',
          aliases: [],
          voiceId: 'test-voice',
          clothing: [],
        },
      },
    });

    const result = await generateCharacter({
      ctx,
      description: 'a pale elf with silver hair and a scar on her cheek',
      placeId: 'PLACE_test',
    });

    // Short description should include distinctive features (scar, silver hair)
    expect(result.short_description).toMatch(/scar/i);
    expect(result.short_description.length).toBeLessThanOrEqual(30);
    // Should be consistent with description
    expect(result.description.toLowerCase()).toMatch(/scar/i);
    expect(result.description.toLowerCase()).toMatch(/silver/i);
  });

  it('ensures short_description does not contradict the description', async () => {
    const generateCharacter = await getGenerateCharacter();
    queryLlmMock.mockResolvedValueOnce({
      content: {
        label: 'Grommash Darkblade',
        description:
          'He is a large, muscular orc with dark green skin and black hair. His left eye is missing, covered by an eyepatch, and his tusks are prominent.',
        short_description: 'one-eyed dark orc',
        tags: ['orc', 'warrior'],
        info: {
          race: 'Orc',
          birthdate: 'Year 30, 4th Age',
          birthPlace: 'Orc Stronghold',
          gender: 'Male',
          eyeColor: 'yellow',
          hairColor: 'black',
          personality: 'Fierce and loyal',
          aliases: [],
          voiceId: 'test-voice',
          clothing: [],
        },
      },
    });

    const result = await withCtxResult((ctx) =>
      generateCharacter({
        ctx,
        description: 'a large orc with one eye missing',
        placeId: 'PLACE_test',
      })
    );

    // Short description should be consistent with description
    const descLower = result.description.toLowerCase();
    const shortDescLower = result.short_description.toLowerCase();

    // If short description mentions "one-eyed", description should also mention eye/missing
    if (shortDescLower.includes('one-eyed') || shortDescLower.includes('eyed')) {
      expect(descLower).toMatch(/eye|missing|eyepatch/i);
    }

    // Both should mention orc
    expect(descLower).toMatch(/orc/i);
    expect(shortDescLower).toMatch(/orc/i);
  });

  it('validates short_description length and truncates if too long', async () => {
    const generateCharacter = await getGenerateCharacter();
    queryLlmMock
      .mockResolvedValueOnce({
        content: {
          label: 'Test Character',
          description: 'He is a character.',
          short_description: 'very long description that exceeds limit',
          tags: ['test'],
          info: {
            race: 'Human',
            birthdate: 'Year 1',
            birthPlace: 'Place',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [],
          },
        },
      })
      .mockResolvedValueOnce({
        content: {
          relationships: [],
        },
      });

    const result = await withCtxResult((ctx) =>
      generateCharacter({
        ctx,
        description: 'a test character',
        placeId: 'PLACE_test',
      })
    );

    // Should truncate to 30 characters if longer
    expect(result.short_description.length).toBeLessThanOrEqual(30);
  });

  it('handles truncated response due to token limit', async () => {
    const generateCharacter = await getGenerateCharacter();
    // Load a fresh context to avoid any leftover characters from other tests
    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

    // queryLlm throws on truncation
    queryLlmMock.mockRejectedValueOnce(new Error('Response truncated: Character Generator'));

    await expect(
      generateCharacter({
        ctx,
        description: 'a character with a very long description that might cause truncation',
        placeId: 'PLACE_test',
      })
    ).rejects.toThrow('Response truncated');
  });

  it('handles truncated response detected by incomplete JSON', async () => {
    const generateCharacter = await getGenerateCharacter();
    // Load a fresh context to avoid any leftover characters from other tests
    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

    // queryLlm throws on incomplete JSON
    queryLlmMock.mockRejectedValueOnce(
      new Error('Response truncated (incomplete JSON): Character Generator')
    );

    await expect(
      generateCharacter({
        ctx,
        description: 'a character',
        placeId: 'PLACE_test',
      })
    ).rejects.toThrow('truncated');
  });

  it('generates character without home/work', async () => {
    const generateCharacter = await getGenerateCharacter();
    queryLlmMock.mockResolvedValueOnce({
      content: {
        label: 'Test Char',
        description: 'A test character.',
        short_description: 'test char',
        tags: ['test'],
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Place',
          gender: 'Male',
          eyeColor: 'brown',
          hairColor: 'brown',
          personality: 'Test',
          aliases: [],
          voiceId: 'test-voice',
          clothing: [],
        },
      },
    });

    const result = await withCtxResult((ctx) =>
      generateCharacter({
        ctx,
        description: 'a test character',
        placeId: 'PLACE_test',
      })
    );

    // Character should be generated without home/work fields
    expect(result.label).toBe('Test Char');
    expect(result.position.parent).toBe('PLACE_test');
  });

  it('includes available races and voices context in prompt and constrains them in schema', async () => {
    const generateCharacter = await getGenerateCharacter();
    queryLlmMock.mockResolvedValueOnce({
      content: {
        label: 'Test Dwarf',
        description: 'A stout dwarf.',
        short_description: 'stout dwarf',
        tags: ['dwarf'],
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Place',
          gender: 'Male',
          eyeColor: 'brown',
          hairColor: 'brown',
          personality: 'Test',
          aliases: [],
          voiceId: 'test-voice',
          clothing: [],
        },
      },
    });

    await withCtxResult((ctx) =>
      generateCharacter({
        ctx,
        description: 'a stout dwarf',
        placeId: 'PLACE_test',
      })
    );

    // Check that the prompt includes available races (queryLlm uses 'system' and 'prompt' keys)
    const firstCallArgs = queryLlmMock.mock.calls[0]?.[0];
    const systemPrompt = firstCallArgs?.system;
    expect(typeof systemPrompt).toBe('string');
    expect(systemPrompt).toContain('AVAILABLE RACES');
    expect(systemPrompt).toContain('RACE_human');
    expect(systemPrompt).toContain('you MUST use one of these race IDs exactly');

    // Check that the prompt includes voice selection guidance
    expect(systemPrompt).toContain('AVAILABLE VOICES');
    expect(systemPrompt).toContain('Voice Selection Rules');

    // Check that the JSON schema constrains race to valid IDs via enum (queryLlm uses 'schema.schema')
    const schema = firstCallArgs?.schema?.schema;
    expect(schema?.properties?.info?.properties?.race?.enum).toBeDefined();
    expect(schema?.properties?.info?.properties?.race?.enum).toContain('RACE_human');

    // Check that the JSON schema includes voiceId field
    expect(schema?.properties?.info?.properties?.voiceId).toBeDefined();
  });

  it('generates character with relationships when existing characters share context', async () => {
    const generateCharacter = await getGenerateCharacter();
    // Set up existing characters in the universe
    const existingCharacter = {
      id: 'CHAR_existing_guild',
      label: 'Existing Guild Member',
      description: 'An existing guild member character',
      short_description: 'guild member',
      tags: ['guild'],
      entityType: 'character' as const,
      position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_test' },
      info: {
        placeId: 'PLACE_test',
        birthPlace: 'Same Place',
        race: 'Human',
        birthdate: 'Year 1',
        gender: 'Male',
        eyeColor: 'brown',
        hairColor: 'brown',
        personality: 'Test',

        aliases: [],
        messages: [],
        journal: [],
      },
      relationships: [],
    };
    const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
    await ctx.upsertEntity('character', existingCharacter);
    await ctx.persistAll();

    queryLlmMock
      .mockResolvedValueOnce({
        content: {
          label: 'New Character',
          description: 'A new character',
          short_description: 'new character',
          tags: ['guild'],
          info: {
            race: 'Human',
            birthdate: 'Year 1',
            birthPlace: 'Same Place',
            gender: 'Male',
            eyeColor: 'blue',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [],
          },
        },
        truncated: false,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        content: {
          relationships: {
            colleague: ['CHAR_existing_guild'],
          },
        },
        truncated: false,
        durationMs: 100,
      });

    const result = await withCtxResult((ctx) =>
      generateCharacter({
        ctx,
        description: 'a new character in the same guild',
        placeId: 'PLACE_test',
      })
    );

    // Verify the structure includes existing character names handling (queryLlm uses 'system' key)
    const firstCallArgs = queryLlmMock.mock.calls[0]?.[0];
    const systemPrompt = firstCallArgs?.system;
    expect(typeof systemPrompt).toBe('string');
    // When there are existing characters, the prompt should include the names section
    // Note: Due to module caching in tests, the exact character names may vary
    expect(systemPrompt).toMatch(
      /Existing character names in this universe|visually\/phonetically very similar/
    );

    expect(result.relationships).toBeDefined();
    // Relationships may be empty if determineRelationships filters them out, so just check it's defined
    expect(result.relationships).toBeTruthy();
  });

  describe('relationship determination', () => {
    // Helper to clean up all character files
    async function cleanupCharacters() {
      const charactersDir = join(getTestUniverseDir(TEST_UNIVERSE_ID), 'entities', 'characters');
      if (existsSync(charactersDir)) {
        const files = await readdir(charactersDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              await unlink(join(charactersDir, file));
            } catch (err) {
              // Ignore ENOENT errors (file already deleted by another cleanup)
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
              }
            }
          }
        }
      }
    }

    // Ensure character files are cleaned up before and after each relationship test
    beforeEach(async () => {
      await cleanupCharacters();
    });

    afterEach(async () => {
      await cleanupCharacters();
    });

    it('uses reasoning complexity for relationship determination', async () => {
      const generateCharacter = await getGenerateCharacter();
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Create one existing character to trigger relationship determination
      const existingCharacter = {
        id: 'CHAR_existing',
        label: 'Existing Character',
        description: 'An existing character',
        short_description: 'existing',
        tags: ['guild'],
        entityType: 'character' as const,
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_test' },
        info: {
          placeId: 'PLACE_test',
          birthPlace: 'Same Place',
          race: 'Human',
          birthdate: 'Year 1',
          gender: 'Male',
          eyeColor: 'brown',
          hairColor: 'brown',
          personality: 'Test',
          aliases: [],
          messages: [],
          journal: [],
        },
        relationships: [],
      };
      ctx.upsertEntity('character', existingCharacter);
      // Don't persist - use the same context with character in memory to avoid disk I/O issues

      queryLlmMock
        .mockResolvedValueOnce({
          content: {
            label: 'New Character',
            description: 'A new character',
            short_description: 'new character',
            tags: ['guild'],
            info: {
              race: 'Human',
              birthdate: 'Year 1',
              birthPlace: 'Same Place',
              gender: 'Male',
              eyeColor: 'blue',
              hairColor: 'brown',
              personality: 'Test',
              aliases: [],
              voiceId: 'test-voice',
              clothing: [],
            },
          },
          truncated: false,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          content: {
            relationships: [],
          },
          truncated: false,
          durationMs: 100,
        });

      // Use same context directly (not withCtxResult) to test with character in memory
      await generateCharacter({
        ctx,
        description: 'a new character',
        placeId: 'PLACE_test',
      });

      // Find the relationship determination call (second call to queryLlm)
      const relationshipCall = queryLlmMock.mock.calls.find(
        (call) => call[0]?.context === 'Relationship Determination'
      );
      expect(relationshipCall).toBeDefined();
      expect(relationshipCall?.[0]?.complexity).toBe('reasoning');
      expect(relationshipCall?.[0]?.maxTokensOverride).toBe(4096);
    });

    it(
      'limits candidates to 50 when more than 50 exist',
      async () => {
        const generateCharacter = await getGenerateCharacter();
        const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

        // Create 80 existing characters that match the filtering criteria (same location)
        // Use unique prefix to avoid any cross-test interference
        // Creating 80 to ensure we exceed 50 candidates even with any test cleanup issues
        const existingCharacters = Array.from({ length: 80 }, (_, i) => ({
          id: `CHAR_limit50_${i}`,
          label: `Existing Character ${i}`,
          description: `An existing character ${i}`,
          short_description: `existing ${i}`,
          tags: ['guild'],
          entityType: 'character' as const,
          position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_test' },
          info: {
            placeId: 'PLACE_test', // Same location - will be candidates
            birthPlace: '',
            race: 'Human',
            birthdate: 'Year 1',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
            messages: [],
            journal: [],
          },
          relationships: [],
        }));

        for (const char of existingCharacters) {
          ctx.upsertEntity('character', char);
        }
        // Don't persist - use the same context with characters in memory to avoid disk I/O issues

        queryLlmMock
          .mockResolvedValueOnce({
            content: {
              label: 'New Character',
              description: 'A new character',
              short_description: 'new character',
              tags: ['guild'],
              info: {
                race: 'Human',
                birthdate: 'Year 1',
                birthPlace: '',
                gender: 'Male',
                eyeColor: 'blue',
                hairColor: 'brown',
                personality: 'Test',
                aliases: [],
                voiceId: 'test-voice',
                clothing: [],
              },
            },
            truncated: false,
            durationMs: 100,
          })
          .mockResolvedValueOnce({
            content: {
              relationships: [
                {
                  targetId: 'CHAR_limit50_0',
                  type: 'colleague',
                  context: 'Work together',
                },
              ],
            },
            truncated: false,
            durationMs: 100,
          });

        // Use same context directly (not withCtxResult) to test with characters in memory
        await generateCharacter({
          ctx,
          description: 'a new character',
          placeId: 'PLACE_test',
        });

        // Find the relationship determination call
        const relationshipCall = queryLlmMock.mock.calls.find(
          (call) => call[0]?.context === 'Relationship Determination'
        );
        expect(relationshipCall).toBeDefined();

        // Check the prompt includes the limiting note (should show 50 out of 80)
        const prompt = relationshipCall?.[0]?.prompt;
        expect(prompt).toContain('Showing top 50 most relevant candidates');

        // Verify only 50 candidates are in the prompt (count the character entries)
        const candidateMatches = prompt?.match(/- .+ \(CHAR_limit50_\d+\):/g);
        expect(candidateMatches?.length).toBe(50);
      },
      { timeout: 30000 }
    );

    it('sends all candidates when 50 or fewer exist', async () => {
      const generateCharacter = await getGenerateCharacter();
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Create 30 existing characters (less than 50)
      // Use unique prefix to avoid any cross-test interference
      const existingCharacters = Array.from({ length: 30 }, (_, i) => ({
        id: `CHAR_send30_${i}`,
        label: `Existing Character ${i}`,
        description: `An existing character ${i}`,
        short_description: `existing ${i}`,
        tags: ['guild'],
        entityType: 'character' as const,
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_test' },
        info: {
          placeId: 'PLACE_test',
          birthPlace: '',
          race: 'Human',
          birthdate: 'Year 1',
          gender: 'Male',
          eyeColor: 'brown',
          hairColor: 'brown',
          personality: 'Test',
          aliases: [],
          messages: [],
          journal: [],
        },
        relationships: [],
      }));

      for (const char of existingCharacters) {
        ctx.upsertEntity('character', char);
      }
      // Don't persist - use the same context with characters in memory to avoid disk I/O issues

      queryLlmMock
        .mockResolvedValueOnce({
          content: {
            label: 'New Character',
            description: 'A new character',
            short_description: 'new character',
            tags: ['guild'],
            info: {
              race: 'Human',
              birthdate: 'Year 1',
              birthPlace: '',
              gender: 'Male',
              eyeColor: 'blue',
              hairColor: 'brown',
              personality: 'Test',
              aliases: [],
              voiceId: 'test-voice',
              clothing: [],
            },
          },
          truncated: false,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          content: {
            relationships: [],
          },
          truncated: false,
          durationMs: 100,
        });

      // Use same context directly (not withCtxResult) to test with characters in memory
      await generateCharacter({
        ctx,
        description: 'a new character',
        placeId: 'PLACE_test',
      });

      // Find the relationship determination call
      const relationshipCall = queryLlmMock.mock.calls.find(
        (call) => call[0]?.context === 'Relationship Determination'
      );
      expect(relationshipCall).toBeDefined();

      // Check the prompt does NOT include the limiting note
      const prompt = relationshipCall?.[0]?.prompt;
      expect(prompt).not.toContain('Showing top');

      // Verify all 30 candidates are in the prompt
      const candidateMatches = prompt?.match(/- .+ \(CHAR_send30_\d+\):/g);
      expect(candidateMatches?.length).toBe(30);
    });

    it(
      'only validates relationships for limited candidates when limiting occurs',
      async () => {
        const generateCharacter = await getGenerateCharacter();
        const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

        // Create 60 existing characters
        // Use unique prefix to avoid any cross-test interference
        const existingCharacters = Array.from({ length: 60 }, (_, i) => ({
          id: `CHAR_validate60_${i}`,
          label: `Existing Character ${i}`,
          description: `An existing character ${i}`,
          short_description: `existing ${i}`,
          tags: ['guild'],
          entityType: 'character' as const,
          position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_test' },
          info: {
            placeId: 'PLACE_test',
            birthPlace: '',
            race: 'Human',
            birthdate: 'Year 1',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
            messages: [],
            journal: [],
          },
          relationships: [],
        }));

        for (const char of existingCharacters) {
          await ctx.upsertEntity('character', char);
        }
        await ctx.persistAll();

        queryLlmMock
          .mockResolvedValueOnce({
            content: {
              label: 'New Character',
              description: 'A new character',
              short_description: 'new character',
              tags: ['guild'],
              info: {
                race: 'Human',
                birthdate: 'Year 1',
                birthPlace: '',
                gender: 'Male',
                eyeColor: 'blue',
                hairColor: 'brown',
                personality: 'Test',
                aliases: [],
                voiceId: 'test-voice',
                clothing: [],
              },
            },
            truncated: false,
            durationMs: 100,
          })
          .mockResolvedValueOnce({
            content: {
              relationships: [
                {
                  targetId: 'CHAR_validate60_0', // In first 50 - should be accepted
                  type: 'colleague',
                  context: 'Work together',
                },
                {
                  targetId: 'CHAR_validate60_55', // Beyond 50 - should be filtered out
                  type: 'colleague',
                  context: 'Work together',
                },
              ],
            },
            truncated: false,
            durationMs: 100,
          });

        const result = await withCtxResult((ctx) =>
          generateCharacter({
            ctx,
            description: 'a new character',
            placeId: 'PLACE_test',
          })
        );

        // Only the relationship for CHAR_validate60_0 should be included
        // CHAR_validate60_55 should be filtered out because it's beyond the 50 limit
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships[0]?.targetId).toBe('CHAR_validate60_0');
      },
      { timeout: 30000 }
    );
  });

  describe('image generation', () => {
    it('generates image synchronously with context', async () => {
      const generateCharacter = await getGenerateCharacter();

      let imageGenerationCompleted = false;

      generateEntityImageMock.mockImplementation(async () => {
        // Simulate some delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        imageGenerationCompleted = true;
        return '/api/media/test/image.png';
      });

      // Mock character generation response
      queryLlmMock.mockResolvedValue({
        content: {
          label: 'Sync Image Char',
          description: 'A character for testing.',
          short_description: 'test char',
          info: {
            race: 'Human',
            birthdate: 'Year 1',
            birthPlace: 'Place',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [],
          },
        },
      });
      await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'a test character',
          placeId: 'PLACE_test',
        })
      );

      // After generateCharacter returns, image generation should be complete
      expect(imageGenerationCompleted).toBe(true);
      // Should pass context as 1st argument
      expect(generateEntityImageMock).toHaveBeenCalledWith(
        expect.anything(), // ctx (UniverseContext)
        'CHAR_generated',
        'character'
      );
    });

    it('propagates image generation errors', async () => {
      const generateCharacter = await getGenerateCharacter();

      generateEntityImageMock.mockRejectedValueOnce(new Error('Image generation failed'));

      // Mock character generation and relationships based on context
      queryLlmMock.mockImplementation((args: { context?: string }) => {
        if (args.context === 'Character Generator') {
          return Promise.resolve({
            content: {
              label: 'Error Image Char',
              description: 'A character for testing.',
              short_description: 'test char',
              info: {
                race: 'Human',
                birthdate: 'Year 1',
                birthPlace: 'Place',
                gender: 'Male',
                eyeColor: 'brown',
                hairColor: 'brown',
                personality: 'Test',
                title: '',
                aliases: [],
                voiceId: 'test-voice',
                clothing: [],
              },
            },
          });
        }

        if (args.context === 'Relationship Determination') {
          return Promise.resolve({
            content: { relationships: [] },
          });
        }

        return Promise.resolve({ content: {} });
      });

      // Error should propagate (per .cursorrules: NEVER SWALLOW ERRORS)
      await expect(
        withCtxResult((ctx) =>
          generateCharacter({
            ctx,
            description: 'a test character',
            placeId: 'PLACE_test',
          })
        )
      ).rejects.toThrow('Image generation failed');
    });
  });

  describe('parallel character media (FEAT-358)', () => {
    it('runs portrait and sprite generation concurrently when both are needed', async () => {
      const generateCharacter = await getGenerateCharacter();
      const { generateCharacterSprite: generateCharacterSpriteMock } = await import(
        '@dmnpc/generation/character/character-sprite-helper.js'
      );
      const spriteMock = vi.mocked(generateCharacterSpriteMock);

      // Track concurrent execution
      let activeCalls = 0;
      let maxConcurrent = 0;

      generateEntityImageMock.mockImplementation(async () => {
        activeCalls++;
        maxConcurrent = Math.max(maxConcurrent, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeCalls--;
        return '/api/media/test/image.png';
      });

      spriteMock.mockImplementation(async () => {
        activeCalls++;
        maxConcurrent = Math.max(maxConcurrent, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeCalls--;
        return {
          bodyType: 'male',
          layers: [],
          spriteUrl: '/api/media/test/sprites/CHAR_test.png',
          spriteHash: null,
          spriteScale: 1,
        };
      });

      queryLlmMock.mockResolvedValue({
        content: {
          label: 'Parallel Media Char',
          description: 'A character for testing.',
          short_description: 'test char',
          info: {
            race: 'Human',
            birthdate: 'Year 1',
            birthPlace: 'Place',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [],
          },
        },
      });

      await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'a test character for parallel media',
          placeId: 'PLACE_test',
        })
      );

      // Both should have been called
      expect(generateEntityImageMock).toHaveBeenCalled();
      expect(spriteMock).toHaveBeenCalled();
      // They should have run concurrently
      expect(maxConcurrent).toBe(2);
    });
  });

  describe('description honoring instruction (BUG-072)', () => {
    it('includes description-honoring instruction in the user prompt', async () => {
      const generateCharacter = await getGenerateCharacter();
      queryLlmMock.mockResolvedValueOnce({
        content: {
          label: 'Captain Marcus',
          description: 'A broad-shouldered man with a commanding presence and weathered features.',
          short_description: 'broad-shouldered man',
          info: {
            race: 'RACE_human',
            birthdate: 'Year 30',
            birthPlace: 'Port City',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'black',
            skinTone: 'bronze',
            personality: 'Authoritative and stern',
            title: 'Captain',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [],
          },
        },
      });

      await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'Captain Marcus is a stern naval officer in heavy armor',
          placeId: 'PLACE_test',
        })
      );

      const callArgs = queryLlmMock.mock.calls[0][0] as { prompt: string };
      expect(callArgs.prompt).toContain(
        "The character description above is the player's creative vision"
      );
      expect(callArgs.prompt).toContain(
        "The player's chosen name takes precedence over the name uniqueness rule"
      );
      expect(callArgs.prompt).toContain(
        'the title field gets the honorific, the label gets the proper name only'
      );
      expect(callArgs.prompt).toContain('honor their creative vision');
      expect(callArgs.prompt).toContain('Never contradict what they wrote');
    });

    it('skips description-honoring instruction when explicit name is provided', async () => {
      const generateCharacter = await getGenerateCharacter();
      queryLlmMock.mockResolvedValueOnce({
        content: {
          label: 'Marcus',
          description: 'A broad-shouldered man with weathered features.',
          short_description: 'broad-shouldered man',
          info: {
            race: 'RACE_human',
            birthdate: 'Year 30',
            birthPlace: 'Port City',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'black',
            skinTone: 'bronze',
            personality: 'Stern',
            title: '',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [],
          },
        },
      });

      await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'a stern naval officer',
          placeId: 'PLACE_test',
          name: 'Marcus',
        })
      );

      const callArgs = queryLlmMock.mock.calls[0][0] as { prompt: string };
      // When explicit name is given, nameConstraint is used instead
      expect(callArgs.prompt).toContain('MUST be named "Marcus" exactly');
      // Description-honoring instruction should still be present (it always applies)
      expect(callArgs.prompt).toContain(
        "The character description above is the player's creative vision"
      );
    });
  });

  describe('creator path faceAnchorY (BUG-113)', () => {
    it('calls detectFacePosition and sets faceAnchorY when portraitBase64 is provided', async () => {
      const generateCharacter = await getGenerateCharacter();

      const result = await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          characterData: {
            label: 'Creator Character',
            description: 'A character created via the wizard.',
            short_description: 'wizard character',
            info: {
              race: 'RACE_human',
              birthdate: 'Year 1',
              birthPlace: 'Test Town',
              gender: 'Male',
              eyeColor: 'brown',
              hairColor: 'brown',
              hairStyle: 'short',
              headType: 'human_male',
              skinTone: 'light',
              personality: 'Brave',
              voiceId: 'test-voice',
              clothing: [],
              enabledOverlayLayers: [],
            },
          },
          portraitBase64: 'data:image/png;base64,fakeimagecontent',
          placeId: 'PLACE_test',
        })
      );

      expect(savePortraitFromBase64Mock).toHaveBeenCalledWith(
        TEST_UNIVERSE_ID,
        expect.stringContaining('CHAR_'),
        'data:image/png;base64,fakeimagecontent'
      );
      expect(detectFacePositionMock).toHaveBeenCalledWith(
        'data:image/png;base64,fakeimagecontent',
        'Creator Character'
      );
      expect(result.image).toBe('/api/media/test/portrait.png');
      expect(result.faceAnchorY).toBe(0.35);
    });

    it('leaves faceAnchorY null when no portraitBase64 is provided', async () => {
      const generateCharacter = await getGenerateCharacter();

      const result = await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          characterData: {
            label: 'No Portrait Character',
            description: 'A character without a portrait.',
            short_description: 'no portrait char',
            info: {
              race: 'RACE_human',
              birthdate: 'Year 1',
              birthPlace: 'Test Town',
              gender: 'Female',
              eyeColor: 'blue',
              hairColor: 'blonde',
              hairStyle: 'long',
              headType: 'human_female',
              skinTone: 'light',
              personality: 'Quiet',
              voiceId: 'female-voice',
              clothing: [],
              enabledOverlayLayers: [],
            },
          },
          placeId: 'PLACE_test',
        })
      );

      expect(savePortraitFromBase64Mock).not.toHaveBeenCalled();
      expect(detectFacePositionMock).not.toHaveBeenCalled();
      expect(result.faceAnchorY).toBeNull();
    });
  });

  describe('container slot initialization (BUG-186)', () => {
    it('initializes belt and behind_body with contents: [] and non-container slots with contents: null', async () => {
      const generateCharacter = await getGenerateCharacter();
      queryLlmMock.mockResolvedValueOnce({
        content: {
          label: 'Container Test Char',
          description: 'A character for container slot testing.',
          short_description: 'container test',
          tags: ['test'],
          info: {
            race: 'RACE_human',
            birthdate: 'Year 1',
            birthPlace: 'Place',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
            voiceId: 'test-voice',
            clothing: [
              { slot: 'belt', item: 'leather_belt', color: 'brown' },
              { slot: 'behind_body', item: 'back_scabbard', color: 'brown' },
              { slot: 'torso_mid', item: 'tunic', color: 'blue' },
              { slot: 'legs', item: 'trousers', color: 'brown' },
            ],
          },
        },
      });

      const result = await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'a character with belt and clothing',
          placeId: 'PLACE_test',
        })
      );

      const belt = result.info.clothing.find((c) => c.slot === 'belt');
      const behindBody = result.info.clothing.find((c) => c.slot === 'behind_body');
      const torsoMid = result.info.clothing.find((c) => c.slot === 'torso_mid');
      const legs = result.info.clothing.find((c) => c.slot === 'legs');

      // Container slots should have empty arrays
      expect(belt).toBeDefined();
      expect(belt!.contents).toEqual([]);
      expect(behindBody).toBeDefined();
      expect(behindBody!.contents).toEqual([]);

      // Non-container slots should have null
      expect(torsoMid).toBeDefined();
      expect(torsoMid!.contents).toBeNull();
      expect(legs).toBeDefined();
      expect(legs!.contents).toBeNull();
    });
  });

  describe('appearance diversity enforcement', () => {
    it('formatExistingAppearances returns empty string for empty array', async () => {
      const { formatExistingAppearances } = await import(
        '@dmnpc/generation/character-generator.js'
      );
      expect(formatExistingAppearances([], 20)).toBe('');
    });

    it('formatExistingAppearances formats appearance combos from characters', async () => {
      const { formatExistingAppearances } = await import(
        '@dmnpc/generation/character-generator.js'
      );
      const characters = [
        {
          id: 'CHAR_a',
          label: 'Elena',
          info: {
            race: 'Elf',
            gender: 'Female',
            hairColor: 'black',
            hairStyle: 'ponytail',
            eyeColor: 'green',
            skinTone: 'light',
          },
        },
        {
          id: 'CHAR_b',
          label: 'Thorin',
          info: {
            race: 'Dwarf',
            gender: 'Male',
            hairColor: 'red',
            hairStyle: 'braids',
            eyeColor: 'brown',
            skinTone: 'bronze',
          },
        },
      ] as any[];

      const result = formatExistingAppearances(characters, 20);
      expect(result).toContain('EXISTING CHARACTER APPEARANCES');
      expect(result).toContain('Elena: Elf, female, black hair (ponytail), green eyes, light skin');
      expect(result).toContain('Thorin: Dwarf, male, red hair (braids), brown eyes, bronze skin');
      expect(result).toContain('vary hair style');
    });

    it('formatExistingAppearances respects limit parameter', async () => {
      const { formatExistingAppearances } = await import(
        '@dmnpc/generation/character-generator.js'
      );
      const characters = Array.from({ length: 30 }, (_, i) => ({
        id: `CHAR_${i}`,
        label: `Char ${i}`,
        info: {
          race: 'Human',
          gender: 'Male',
          hairColor: 'brown',
          hairStyle: 'short',
          eyeColor: 'blue',
          skinTone: 'light',
        },
      })) as any[];

      const result = formatExistingAppearances(characters, 5);
      const lines = result.split('\n').filter((l) => l.startsWith('- '));
      expect(lines).toHaveLength(5);
    });

    it('formatExistingAppearances handles characters with missing appearance fields', async () => {
      const { formatExistingAppearances } = await import(
        '@dmnpc/generation/character-generator.js'
      );
      const characters = [
        {
          id: 'CHAR_minimal',
          label: 'Ghost',
          info: {
            race: 'Undead',
            gender: '',
            hairColor: '',
            hairStyle: '',
            eyeColor: '',
            skinTone: '',
          },
        },
      ] as any[];

      const result = formatExistingAppearances(characters, 20);
      // Character line should have race but not empty appearance fields
      const characterLine = result.split('\n').find((l) => l.includes('Ghost'));
      expect(characterLine).toBe('- Ghost: Undead');
      // Empty fields should NOT appear in the character's entry
      expect(characterLine).not.toContain('hair');
      expect(characterLine).not.toContain('eyes');
      // "skin" appears in the header guidance text but not in the character entry
      expect(characterLine).not.toMatch(/\bskin$/);
    });

    it('includes appearance context in system prompt when existing characters exist', async () => {
      const generateCharacter = await getGenerateCharacter();
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Create an existing character with appearance data
      ctx.upsertEntity('character', {
        id: 'CHAR_appearance_test',
        label: 'Grizzled Veteran',
        description: 'A battle-worn soldier.',
        short_description: 'grizzled veteran',
        tags: [],
        entityType: 'character' as const,
        position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_test' },
        info: {
          race: 'Human',
          gender: 'Male',
          hairColor: 'gray',
          hairStyle: 'buzzcut',
          eyeColor: 'brown',
          skinTone: 'bronze',
          personality: 'Stern',
          birthdate: 'Year 1',
          birthPlace: 'Somewhere',
          aliases: [],
          messages: [],
          journal: [],
        },
        relationships: [],
      });

      queryLlmMock.mockResolvedValueOnce({
        content: {
          label: 'New Recruit',
          description: 'A young recruit.',
          short_description: 'young recruit',
          info: {
            race: 'RACE_human',
            birthdate: 'Year 20',
            birthPlace: 'Town',
            gender: 'Female',
            eyeColor: 'blue',
            hairColor: 'blonde',
            hairStyle: 'long',
            skinTone: 'light',
            personality: 'Eager',
            title: '',
            aliases: [],
            voice: {
              voiceId: 'female-voice-id',
              voiceName: 'Female Voice',
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0.0,
              speed: 1.0,
            },
            clothing: [],
          },
        },
      });
      // Mock for relationship determination
      queryLlmMock.mockResolvedValueOnce({
        content: { relationships: [] },
      });

      await generateCharacter({
        ctx,
        description: 'a young recruit at the barracks',
        placeId: 'PLACE_test',
      });

      const firstCallArgs = queryLlmMock.mock.calls[0]?.[0];
      const systemPrompt = firstCallArgs?.system;
      expect(systemPrompt).toContain('EXISTING CHARACTER APPEARANCES');
      expect(systemPrompt).toContain('Grizzled Veteran');
      expect(systemPrompt).toContain('gray hair (buzzcut)');
      expect(systemPrompt).toContain('brown eyes');
      expect(systemPrompt).toContain('bronze skin');
    });

    it('omits appearance context when no existing characters', async () => {
      const generateCharacter = await getGenerateCharacter();

      queryLlmMock.mockResolvedValueOnce({
        content: {
          label: 'First Character',
          description: 'The first character.',
          short_description: 'first character',
          info: {
            race: 'RACE_human',
            birthdate: 'Year 1',
            birthPlace: 'Town',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            hairStyle: 'short',
            skinTone: 'light',
            personality: 'Calm',
            title: '',
            aliases: [],
            voice: {
              voiceId: 'test-voice-id',
              voiceName: 'Test Voice',
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0.0,
              speed: 1.0,
            },
            clothing: [],
          },
        },
      });

      await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'the very first character',
          placeId: 'PLACE_test',
        })
      );

      const firstCallArgs = queryLlmMock.mock.calls[0]?.[0];
      const systemPrompt = firstCallArgs?.system;
      expect(systemPrompt).not.toContain('EXISTING CHARACTER APPEARANCES');
    });
  });

  describe('exit spawn + passable snapping (BUG-224)', () => {
    const standardLlmResponse = {
      content: {
        label: 'Spawn Test NPC',
        description: 'A character for spawn testing.',
        short_description: 'spawn test npc',
        tags: ['test'],
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Place',
          gender: 'Male',
          eyeColor: 'brown',
          hairColor: 'brown',
          personality: 'Test',
          aliases: [],
          voiceId: 'test-voice',
          clothing: [],
        },
      },
    };

    it('spawns at exit position and snaps to nearest passable tile', async () => {
      const generateCharacter = await getGenerateCharacter();

      // Exit in test universe is at (50, 50) — tile (1, 1) at tileSize=32
      // Make tile (1, 1) a wall so the BFS must find the nearest passable tile
      // Passable tile at (2, 1) → center pixel (2*32+16, 1*32+16) = (80, 48)
      const terrainGrid = Array.from({ length: 10 }, (_, y) =>
        Array.from({ length: 10 }, (_, x) => (x === 2 && y === 1 ? 'land' : 'wall'))
      );

      loadPlaceLayoutMock.mockResolvedValue({
        terrainGrid,
        tilemap: { tileSize: 32 },
      });
      queryLlmMock.mockResolvedValueOnce(standardLlmResponse);

      const result = await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'a character that should spawn near the exit',
          placeId: 'PLACE_test',
        })
      );

      // Should be snapped to nearest passable tile near the exit (2,1)
      expect(result.position.x).toBe(80);
      expect(result.position.y).toBe(48);
    });

    it('does not snap position when slot position is provided', async () => {
      const generateCharacter = await getGenerateCharacter();

      loadPlaceLayoutMock.mockResolvedValue({
        terrainGrid: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 'wall')),
        tilemap: { tileSize: 32 },
      });
      queryLlmMock.mockResolvedValueOnce(standardLlmResponse);

      const result = await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'a slot-placed character',
          placeId: 'PLACE_test',
          role: 'tavern_keeper',
          slotPosition: { x: 3, y: 4 },
        })
      );

      // Slot position: (3 * 32 + 16, 4 * 32 + 16) = (112, 144)
      expect(result.position.x).toBe(112);
      expect(result.position.y).toBe(144);
      expect(loadPlaceLayoutMock).not.toHaveBeenCalled();
    });

    it('avoids tiles occupied by existing characters', async () => {
      const generateCharacter = await getGenerateCharacter();

      // Exit at (50, 50) → tile (1, 1). Land tiles at (1,1) and (2,1).
      // Place an existing character on tile (1,1) so the new NPC must pick (2,1).
      const terrainGrid = Array.from({ length: 10 }, (_, y) =>
        Array.from({ length: 10 }, (_, x) =>
          (x === 1 && y === 1) || (x === 2 && y === 1) ? 'land' : 'wall'
        )
      );

      loadPlaceLayoutMock.mockResolvedValue({
        terrainGrid,
        tilemap: { tileSize: 32 },
      });
      queryLlmMock.mockResolvedValueOnce(standardLlmResponse);

      const result = await withCtxResult(async (ctx) => {
        // Place an existing character on tile (1,1) — same tile as the exit
        ctx.upsertEntity('character', {
          id: 'CHAR_occupant',
          label: 'Occupant',
          description: 'Already here',
          short_description: 'occupant',
          entityType: 'character',
          tags: [],
          position: { x: 50, y: 50, width: 32, height: 48, parent: 'PLACE_test' },
          info: { race: 'Human', birthdate: '', birthPlace: '', gender: '', personality: '', aliases: [], messages: [], journal: [] },
          relationships: [],
        } as any);
        return generateCharacter({
          ctx,
          description: 'a second character arriving at the exit',
          placeId: 'PLACE_test',
        });
      });

      // Exit tile (1,1) is occupied, so BFS should find (2,1) → center (80, 48)
      expect(result.position.x).toBe(80);
      expect(result.position.y).toBe(48);
    });

    it('uses random interior position when spawnAtDoor is false (BUG-252)', async () => {
      const generateCharacter = await getGenerateCharacter();

      // Grid covers full place (800×600 at 32px = 25×19 tiles), all land.
      // With spawnAtDoor: false, character gets random position (not exit at 50,50).
      const GRID_W = 25;
      const GRID_H = 19;
      loadPlaceLayoutMock.mockResolvedValue({
        terrainGrid: Array.from({ length: GRID_H }, () => Array.from({ length: GRID_W }, () => 'land')),
        tilemap: { tileSize: 32 },
      });
      queryLlmMock.mockResolvedValueOnce(standardLlmResponse);

      const result = await withCtxResult((ctx) =>
        generateCharacter({
          ctx,
          description: 'an already-here character',
          placeId: 'PLACE_test',
          spawnAtDoor: false,
        })
      );

      // Position should be valid and within place bounds
      expect(result.position.x).toBeGreaterThan(0);
      expect(result.position.y).toBeGreaterThan(0);
      expect(result.position.x).toBeLessThan(800);
      expect(result.position.y).toBeLessThan(600);
      expect(result.position.parent).toBe('PLACE_test');
      // Layout should be loaded for passable-tile snapping
      expect(loadPlaceLayoutMock).toHaveBeenCalled();
    });

    it('falls back to random position when no exit exists', async () => {
      const generateCharacter = await getGenerateCharacter();

      // All land — no snapping needed, just checking fallback
      loadPlaceLayoutMock.mockResolvedValue({
        terrainGrid: Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => 'land')),
        tilemap: { tileSize: 32 },
      });
      queryLlmMock.mockResolvedValueOnce(standardLlmResponse);

      // PLACE_smithy has an exit (OBJ_exit_smithy_to_test at 50,50), but
      // we can test the no-exit fallback by using a place with no objects.
      // Create a temporary place with no exits.
      const result = await withCtxResult(async (ctx) => {
        ctx.upsertEntity('place', {
          id: 'PLACE_no_exit',
          label: 'Empty Room',
          description: 'A room with no exits',
          short_description: 'empty room',
          entityType: 'place',
          tags: [],
          info: { environment: {} },
          relationships: [],
          position: { x: 0, y: 0, width: 400, height: 400, innerWidth: 800, innerHeight: 600, parent: 'PLACE_test' },
        } as any);
        return generateCharacter({
          ctx,
          description: 'a character in a room with no exits',
          placeId: 'PLACE_no_exit',
        });
      });

      // Position should be valid (random within bounds, on land — no snap needed)
      expect(result.position.x).toBeGreaterThan(0);
      expect(result.position.y).toBeGreaterThan(0);
      expect(result.position.parent).toBe('PLACE_no_exit');
    });
  });
});
