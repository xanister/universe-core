/**
 * Unit tests for Template-to-Character Generator
 *
 * Tests generating universe-specific characters from template definitions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCharacterFromTemplate,
  generateCharactersFromTemplates,
  generateCharactersFromMergedDefinitions,
} from '@dmnpc/generation/character/template-character-generator.js';
import * as templateStore from '@dmnpc/core/stores/template-character-store.js';
import * as universeStore from '@dmnpc/core/universe/universe-store.js';
import * as entityImageService from '@dmnpc/generation/media/entity-image-service.js';
import * as idGenerator from '@dmnpc/generation/id-generator.js';
import * as openaiClient from '@dmnpc/core/clients/openai-client.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { Universe } from '@dmnpc/types/entity';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';

// Mock dependencies
vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  uploadFile: vi.fn().mockImplementation((key: string) =>
    Promise.resolve(`https://test-bucket.s3.us-east-1.amazonaws.com/${key}`)
  ),
  getPublicUrl: vi.fn((key: string) => `https://test-bucket.s3.us-east-1.amazonaws.com/${key}`),
  exists: vi.fn().mockResolvedValue(false),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
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

vi.mock('@dmnpc/core/stores/template-character-store.js', () => ({
  getTemplateCharacter: vi.fn(),
}));

vi.mock('@dmnpc/core/universe/universe-store.js', () => ({
  loadUniverse: vi.fn(),
  upsertUniverseEntity: vi.fn(),
  generateEventId: vi.fn().mockReturnValue('EVENT_test_123'),
}));

// Mock for UniverseContext.upsertEntity
const mockUpsertEntity = vi.fn();

// Mock for UniverseContext.persistAll
const mockPersistAll = vi.fn().mockResolvedValue(undefined);

// Mock UniverseContext.loadAtEntryPoint - required by template-character-generator
vi.mock('@dmnpc/core/universe/universe-context.js', () => ({
  UniverseContext: {
    loadAtEntryPoint: vi.fn().mockImplementation(() =>
      Promise.resolve({
        universeId: 'test_universe',
        universe: {
          id: 'test_universe',
          name: 'Test Universe',
          version: '1.0.0',
          description: 'A fantasy test universe.',
          races: [
            { id: 'human', label: 'Human', description: 'Regular humans', rarity: 'common' },
            { id: 'elf', label: 'Elf', description: 'Pointy-eared folk', rarity: 'uncommon' },
          ],
          rootPlaceId: 'PLACE_root',
        },
        characters: [],
        places: [],
        objects: [],
        upsertEntity: mockUpsertEntity,
        upsertEvent: vi.fn(),
        persistAll: mockPersistAll,
      })
    ),
  },
}));

vi.mock('@dmnpc/generation/media/entity-image-service.js', () => ({
  generateEntityImage: vi.fn(),
  savePortraitFromBase64: vi.fn(),
}));

vi.mock('@dmnpc/generation/id-generator.js', () => ({
  generateEntityId: vi.fn(),
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: vi.fn(),
}));

// Mock logger to avoid loading the real module
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock heavy transitive deps loaded by character-generator.ts
vi.mock('@dmnpc/sprites', () => ({
  EYE_COLORS: ['blue', 'brown', 'green'],
  HAIR_COLORS: ['black', 'brown', 'blonde'],
  SKIN_TONES: ['light', 'amber', 'bronze'],
  SKIN_COLORS: ['light', 'amber', 'bronze'],
  getSpriteArchetype: vi.fn().mockReturnValue({
    id: 'human',
    allowedHeadTypes: ['human_male', 'human_female'],
    genderHeadMap: { male: 'human_male', female: 'human_female' },
  }),
  resolveHeadType: vi.fn().mockReturnValue('human_male'),
  loadSpriteArchetypes: vi.fn(),
  loadCharacterBasesManifest: vi.fn(),
  loadSlotRegistry: vi.fn().mockReturnValue({
    version: 2,
    slots: [
      { id: 'behind_body', region: 'back', subOrder: 0, container: { capacity: 1, allowedTypes: ['weapon'] } },
      { id: 'belt', region: 'waist', subOrder: 0, container: { capacity: 3, allowedTypes: ['weapon', 'clothing', 'consumable', 'generic'] } },
      { id: 'feet', region: 'feet', subOrder: 0 },
      { id: 'legs', region: 'legs', subOrder: 0 },
      { id: 'torso_mid', region: 'torso', subOrder: 1 },
      { id: 'hands', region: 'hands', subOrder: 0 },
      { id: 'head', region: 'head', subOrder: 0 },
      { id: 'weapon', region: 'weapon', subOrder: 0 },
    ],
  }),
}));

vi.mock('@dmnpc/generation/character/character-sprite-helper.js', () => ({
  generateCharacterSprite: vi.fn().mockResolvedValue({
    spriteUrl: 'https://test/sprite.png',
    spriteS3Key: 'sprites/test.png',
  }),
  findRaceOrFallback: vi.fn().mockReturnValue({
    id: 'human',
    label: 'Human',
    description: 'Test',
    rarity: 'common',
    spriteHints: { humanoidBody: true, spriteArchetype: 'human', defaultSkinColor: 'light', allowedSkinColors: ['light'], allowedEyeColors: null, allowedHairColors: null, spriteScale: 1, featureLayers: null },
  }),
  normalizeSkinToneForRace: vi.fn((skinTone: string | null | undefined) => skinTone ?? 'light'),
  resolveAutoGenOverlayLayers: vi.fn().mockReturnValue(['eyes']),
}));

vi.mock('@dmnpc/generation/character/voice-matcher.js', () => ({
  getAvailableVoices: vi.fn().mockResolvedValue([]),
  formatVoicesForPrompt: vi.fn().mockReturnValue(''),
}));

// Note: deleteEntityWithCleanup was replaced with ctx.deleteEntity in template-character-builder

const mockTemplate: TemplateCharacterDefinition = {
  id: 'TEMPLATE_test_character',
  label: 'Test Character',
  description: 'A test character with distinctive features.',
  short_description: 'test person',
  personality: 'Curious and adventurous.',
  backstoryThemes: ['discovery', 'mystery'],
  physicalTraits: {
    gender: 'female',
    eyeColor: 'green',
    hairColor: 'red',
    race: 'human',
    raceAdaptation: 'human-like',
  },
  keyEvents: [
    {
      subject: 'Test Character',
      fact: 'Discovered an ancient artifact',
      category: 'world',
      significance: 'major',
    },
  ],
};

const mockUniverse: Universe = {
  id: 'test_universe',
  name: 'Test Universe',
  version: '1.0.0',
  description: 'A fantasy test universe.',
  custom: {},
  rules: 'Standard fantasy rules.',
  tone: 'High fantasy adventure',
  style: 'Epic fantasy',
  voice: 'alloy',
  date: 'Year 1',
  races: [
    { id: 'human', label: 'Human', description: 'Regular humans', rarity: 'common' },
    { id: 'elf', label: 'Elf', description: 'Pointy-eared folk', rarity: 'uncommon' },
    { id: 'immortal', label: 'Immortal', description: 'Ageless beings', rarity: 'rare' },
  ],
  rootPlaceId: 'PLACE_root',
  characters: [],
  places: [],
  objects: [],
};

describe('generateCharacterFromTemplate', () => {
  let mockCtx: any;

  beforeEach(() => {
    vi.mocked(idGenerator.generateEntityId).mockReturnValue('CHAR_test_character');
    vi.mocked(entityImageService.generateEntityImage).mockResolvedValue('/api/media/test.png');

    mockCtx = {
      universeId: 'test_universe',
      universe: mockUniverse,
      characters: [],
      places: [],
      objects: [],
      upsertEntity: mockUpsertEntity,
      upsertEvent: vi.fn(),
      persistAll: mockPersistAll,
      getCharacter: vi.fn(),
      getPlace: vi.fn(),
      findCharacter: vi.fn(),
    };
  });

  it('generates a character from template using the provided universe ID', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: mockTemplate.keyEvents },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const result = await generateCharacterFromTemplate(mockCtx, {
      templateId: 'TEMPLATE_test_character',
      universe: mockUniverse,
    });

    expect(result.success).toBe(true);
    expect(result.character).toBeDefined();
    expect(result.character.id).toBe('CHAR_test_character');
    expect(result.character.label).toBe('Test Character');

    // Verify upsertEntity was called on the context
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      'character',
      expect.objectContaining({
        id: 'CHAR_test_character',
        label: 'Test Character',
      })
    );
  });

  it('throws error when template is not found', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(null);

    await expect(
      generateCharacterFromTemplate(mockCtx, {
        templateId: 'TEMPLATE_nonexistent',
        universe: mockUniverse,
      })
    ).rejects.toThrow('Template not found: TEMPLATE_nonexistent');
  });

  it('preserves physical traits from template', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const result = await generateCharacterFromTemplate(mockCtx, {
      templateId: 'TEMPLATE_test_character',
      universe: mockUniverse,
    });

    expect(result.character.info.eyeColor).toBe('green');
    expect(result.character.info.hairColor).toBe('red');
    expect(result.character.info.gender).toBe('female');
    expect(result.character.info.isPlayer).toBe(true);
  });

  it('maps race based on template raceAdaptation', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const result = await generateCharacterFromTemplate(mockCtx, {
      templateId: 'TEMPLATE_test_character',
      universe: mockUniverse,
    });

    // Should map to a universe race
    expect(result.character.info.race).toBeDefined();
  });

  it('applies guidance to description and short description', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm)
      .mockResolvedValueOnce({
        content: { events: [] },
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })
      .mockResolvedValueOnce({
        content: {
          description: 'A desert-worn wanderer shaped by the dunes.',
          shortDescription: 'desert wanderer',
        },
        usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
      });

    const result = await generateCharacterFromTemplate(mockCtx, {
      templateId: 'TEMPLATE_test_character',
      universe: mockUniverse,
      guidance: 'Adapt her to the desert culture of this universe.',
    });

    expect(result.character.description).toBe('A desert-worn wanderer shaped by the dunes.');
    expect(result.character.short_description).toBe('desert wanderer');
    expect(openaiClient.queryLlm).toHaveBeenCalledTimes(2);
  });

  it('uses guidance to select universe race when mentioned', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const result = await generateCharacterFromTemplate(mockCtx, {
      templateId: 'TEMPLATE_test_character',
      universe: mockUniverse,
      guidance: 'The character should be an Immortal in this world.',
    });

    expect(result.character.info.race).toBe('immortal');
  });

  it('deletes existing character with matching label before generation', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const existingCharacter = {
      id: 'CHAR_existing',
      label: mockTemplate.label,
      description: 'Old character',
      short_description: 'old',
      entityType: 'character',
      tags: [],
      info: {
        aliases: [],
        birthdate: '',
        birthPlace: '',
        gender: 'female',
        eyeColor: 'green',
        hairColor: 'red',
        personality: 'Curious',
        race: 'human',
        voice: { voiceId: 'test-voice', voiceName: 'Test Voice', settings: {} },
        isPlayer: true,
      },
      position: { x: null, y: null, parent: null },
      relationships: [],
    };

    // Set up mockCtx to have the existing character initially
    // The function uses ctx.characters.find() to locate the character
    const charactersArray = [existingCharacter];
    mockCtx.characters = charactersArray;
    mockCtx.findCharacter = vi.fn((id) => (id === existingCharacter.id ? existingCharacter : null));

    // Mock ctx.deleteEntity to actually remove from array
    mockCtx.deleteEntity = vi.fn((_type: string, entityId: string) => {
      const index = charactersArray.findIndex((c: any) => c.id === entityId);
      if (index >= 0) {
        charactersArray.splice(index, 1);
      }
      return true;
    });

    await generateCharacterFromTemplate(mockCtx, {
      templateId: 'TEMPLATE_test_character',
      universe: mockUniverse,
    });

    // After deletion, the character should be removed from the array
    expect(charactersArray).not.toContain(existingCharacter);

    expect(mockCtx.deleteEntity).toHaveBeenCalledWith(
      'character',
      'CHAR_existing'
    );
  });
});

describe('generateCharactersFromTemplates', () => {
  let mockCtx: any;

  beforeEach(() => {
    vi.mocked(idGenerator.generateEntityId).mockReturnValue('CHAR_test_character');
    vi.mocked(entityImageService.generateEntityImage).mockResolvedValue('/api/media/test.png');

    mockCtx = {
      universeId: 'test_universe',
      universe: mockUniverse,
      characters: [],
      places: [],
      objects: [],
      upsertEntity: mockUpsertEntity,
      upsertEvent: vi.fn(),
      persistAll: mockPersistAll,
      getCharacter: vi.fn(),
      getPlace: vi.fn(),
      findCharacter: vi.fn(),
    };
  });

  it('generates multiple characters from templates', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const templateIds = ['TEMPLATE_char1', 'TEMPLATE_char2'];
    const result = await generateCharactersFromTemplates(mockCtx, templateIds);

    expect(result).toHaveLength(2);
    // Each character: upsert after build + upsert after ensureCharacterMedia (sprite)
    expect(mockUpsertEntity).toHaveBeenCalledTimes(4);
  });

  it('continues generating other characters if one fails', async () => {
    vi.mocked(templateStore.getTemplateCharacter)
      .mockResolvedValueOnce(null) // First template not found
      .mockResolvedValueOnce(mockTemplate); // Second template exists

    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { adaptedEvents: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const templateIds = ['TEMPLATE_missing', 'TEMPLATE_exists'];
    const result = await generateCharactersFromTemplates(mockCtx, templateIds);

    // Should have 1 character (the second one that succeeded)
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', async () => {
    const result = await generateCharactersFromTemplates(mockCtx, []);
    expect(result).toEqual([]);
  });
});

describe('generateCharactersFromMergedDefinitions', () => {
  let mockCtx: any;

  beforeEach(() => {
    vi.mocked(idGenerator.generateEntityId).mockReturnValue('CHAR_merged');
    vi.mocked(entityImageService.generateEntityImage).mockResolvedValue('/api/media/test.png');

    mockCtx = {
      universeId: 'test_universe',
      universe: mockUniverse,
      characters: [],
      places: [],
      objects: [],
      upsertEntity: mockUpsertEntity,
      upsertEvent: vi.fn(),
      persistAll: mockPersistAll,
      getCharacter: vi.fn(),
      getPlace: vi.fn(),
      findCharacter: vi.fn(),
    };
  });

  it('generates characters from merged definitions', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const mergedDefs = [
      { template: mockTemplate, enhancedDescription: 'Enhanced desc 1' },
      { template: { ...mockTemplate, id: 'TEMPLATE_char2' }, enhancedDescription: 'Enhanced desc 2' },
    ];

    const result = await generateCharactersFromMergedDefinitions(mockCtx, mergedDefs as any);

    expect(result).toHaveLength(2);
  });

  it('continues when one merged definition fails', async () => {
    vi.mocked(templateStore.getTemplateCharacter).mockResolvedValue(mockTemplate);
    vi.mocked(openaiClient.queryLlm).mockResolvedValue({
      content: { events: [] },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    // Make generateEntityId throw on the first call to simulate a generation failure
    vi.mocked(idGenerator.generateEntityId)
      .mockImplementationOnce(() => {
        throw new Error('ID generation failed');
      })
      .mockReturnValue('CHAR_merged');

    const mergedDefs = [
      { template: { ...mockTemplate, id: 'TEMPLATE_failing' }, enhancedDescription: 'Desc' },
      { template: mockTemplate, enhancedDescription: 'Desc' },
    ];

    const result = await generateCharactersFromMergedDefinitions(mockCtx, mergedDefs as any);

    // First fails, second succeeds -- batch is not aborted
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', async () => {
    const result = await generateCharactersFromMergedDefinitions(mockCtx, []);
    expect(result).toEqual([]);
  });
});
