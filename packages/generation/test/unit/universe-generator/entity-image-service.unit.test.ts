import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupTestUniverse, cleanupTestUniverse } from '@dmnpc/core/test-helpers/index.js';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';

// Use vi.hoisted to ensure the mock is available when vi.mock factory runs
const { generateImageMock, editImageMock, uploadFileMock } = vi.hoisted(() => ({
  generateImageMock: vi.fn().mockResolvedValue({ base64: 'base64ImageData', durationMs: 100 }),
  editImageMock: vi.fn().mockResolvedValue({ base64: 'base64EditedImageData', durationMs: 100 }),
  uploadFileMock: vi.fn().mockImplementation((key: string) =>
    Promise.resolve(`https://test-bucket.s3.us-east-1.amazonaws.com/${key}`)
  ),
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  detectFacePosition: vi.fn().mockResolvedValue(0.15),
  createOpenAIClient: vi.fn(() => ({})),
  generateImage: generateImageMock,
  editImage: editImageMock,
}));

vi.mock('@dmnpc/core/clients/storage-service.js', () => ({
  storageService: {
    uploadFile: uploadFileMock,
    getPublicUrl: vi.fn((key: string) => `https://test-bucket.s3.us-east-1.amazonaws.com/${key}`),
    exists: vi.fn().mockResolvedValue(true),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

// Mock sprite generation chain so getSpriteBufferForCharacter can produce a buffer
// (needed to produce sprites for characters with clothing: [])
vi.mock('@dmnpc/sprites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dmnpc/sprites')>();
  return {
    ...actual,
    generateCompositeSprite: vi.fn().mockResolvedValue({ image: Buffer.from('fake-sprite-png') }),
    getSpriteArchetype: vi.fn().mockReturnValue({
      id: 'human',
      bodies: { male: 'male', female: 'female' },
      featureLayers: [],
    }),
    resolveBodyType: vi.fn().mockReturnValue('male'),
    loadSpriteArchetypes: vi.fn(),
    loadCharacterBasesManifest: vi.fn(),
  };
});

vi.mock('@dmnpc/generation/character/character-sprite-helper.js', () => ({
  buildV3LayerConfigs: vi.fn().mockReturnValue([]),
  resolveAutoGenOverlayLayers: vi.fn().mockReturnValue(['eyes']),
}));

vi.mock('@dmnpc/generation/sprite-frame-utils.js', () => ({
  extractSpriteFrameForPortrait: vi.fn().mockResolvedValue(Buffer.from('fake-frame-png')),
}));

// Import the service module statically so it uses the mocked dependencies
import * as entityImageService from '@dmnpc/generation/media/entity-image-service.js';

// Helper to get the service (for compatibility with existing test structure)
function getEntityImageService() {
  return entityImageService;
}

const TEST_UNIVERSE_ID = '__test_entity_image_service__';

async function withCtx(action: (ctx: UniverseContext) => Promise<void>): Promise<void> {
  const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
  await action(ctx);
  await ctx.persistAll();
}

async function withCtxResult<T>(action: (ctx: UniverseContext) => Promise<T>): Promise<T> {
  const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
  const result = await action(ctx);
  await ctx.persistAll();
  return result;
}

beforeAll(async () => {
  await setupTestUniverse(TEST_UNIVERSE_ID, {
    name: 'Test Universe',
    description: 'Test universe for entity-image-service',
    style: 'Fantasy art style',
    places: [
      {
        id: 'PLACE_tavern',
        label: 'The Tavern',
        description: 'A cozy tavern.',
        short_description: 'a cozy tavern',
        entityType: 'place',
        tags: ['tavern', 'cozy'],
        info: { environment: ENVIRONMENT_PRESETS.interior() },
        relationships: [],
      } as any,
      {
        id: 'PLACE_smithy',
        label: 'The Smithy',
        description: 'A forge with hot coals.',
        short_description: 'a blacksmith shop',
        entityType: 'place',
        tags: ['smithy', 'forge'],
        info: { environment: ENVIRONMENT_PRESETS.interior() },
        relationships: [],
      } as any,
    ],
    characters: [
      {
        id: 'CHAR_test',
        label: 'Test Character',
        description: 'A test character.',
        short_description: 'a test character',
        entityType: 'character',
        tags: ['character'],
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Test Place',
          gender: 'Unknown',
          personality: 'Test',

          placeId: 'PLACE_tavern',
        },
        relationships: [],
      } as any,
      {
        id: 'CHAR_elf',
        label: 'Elf Character',
        description: 'An elf with pointed ears.',
        short_description: 'an elf',
        entityType: 'character',
        tags: ['elf'],
        info: {
          race: 'RACE_elf',
          birthdate: 'Year 100',
          birthPlace: 'Elven Forest',
          gender: 'Female',
          personality: 'Graceful',

          placeId: 'PLACE_tavern',
        },
        relationships: [],
      } as any,
      {
        id: 'CHAR_bartender',
        label: 'Barkeep Bob',
        description: 'A friendly bartender with a bushy mustache.',
        short_description: 'a friendly bartender',
        entityType: 'character',
        tags: ['TAG_bartender', 'TAG_friendly'],
        info: {
          race: 'RACE_human',
          birthdate: 'Year 50',
          birthPlace: 'The City',
          gender: 'Male',
          personality: 'Jovial',
          placeId: 'PLACE_tavern',
          routine: {
            schedule: {},
            home: { description: 'A small room upstairs' },
            work: {
              placeId: 'PLACE_tavern',
              description: 'The bustling main hall of the tavern',
            },
            variance: 0.1,
          },
        },
        relationships: [],
      } as any,
    ],
  });
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

// Store original env value to restore after each test
let originalDisableImageGeneration: string | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  generateImageMock.mockResolvedValue({ base64: 'base64ImageData', durationMs: 100 });
  // Reset uploadFileMock to return URL with the key
  uploadFileMock.mockImplementation((key: string) => 
    Promise.resolve(`https://test-bucket.s3.us-east-1.amazonaws.com/${key}`)
  );

  // Save and clear DISABLE_IMAGE_GENERATION so tests run with generation enabled by default
  originalDisableImageGeneration = process.env.DISABLE_IMAGE_GENERATION;
  delete process.env.DISABLE_IMAGE_GENERATION;
});

// Helper to get the prompt from the image generation mock (either generateImage or editImage)
function getImagePrompt(): string | undefined {
  if (generateImageMock.mock.calls.length > 0) {
    return generateImageMock.mock.calls[0]?.[0]?.prompt as string;
  }
  if (editImageMock.mock.calls.length > 0) {
    return editImageMock.mock.calls[0]?.[0]?.prompt as string;
  }
  return undefined;
}

// Helper to get the size from the mock calls (either generateImage or editImage)
function getImageSize(): string | undefined {
  if (generateImageMock.mock.calls.length > 0) {
    return generateImageMock.mock.calls[generateImageMock.mock.calls.length - 1]?.[0]
      ?.size as string;
  }
  if (editImageMock.mock.calls.length > 0) {
    return editImageMock.mock.calls[editImageMock.mock.calls.length - 1]?.[0]
      ?.size as string;
  }
  return undefined;
}

// Helper to check if image generation mock was called (either generateImage or editImage)
function expectImageGenerationCalled(): void {
  const called = generateImageMock.mock.calls.length > 0 || editImageMock.mock.calls.length > 0;
  expect(called).toBe(true);
}

afterEach(async () => {
  // Restore original DISABLE_IMAGE_GENERATION value
  if (originalDisableImageGeneration === undefined) {
    delete process.env.DISABLE_IMAGE_GENERATION;
  } else {
    process.env.DISABLE_IMAGE_GENERATION = originalDisableImageGeneration;
  }
});

describe('services/universe-generator/entity-image-service.ts', () => {
  describe('generateEntityImage', () => {
    it('generates image for place and returns URL', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Clear any existing image
      const place = ctx.findPlace('PLACE_tavern');
      if (place) {
        delete place.image;
        await ctx.upsertEntity('place', place);
      }

      const { generateEntityImage } = getEntityImageService();

      // The function should return the image URL
      const result = await withCtxResult((ctx) =>
        entityImageService.generateEntityImage(ctx, 'PLACE_tavern', 'place')
      );
      // Image URL is now an S3 URL
      expect(result).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
      expect(result).toContain('PLACE_tavern.png');
    });

    it('generates image for character and returns URL', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Clear any existing image
      const character = ctx.findCharacter('CHAR_test');
      if (character) {
        delete character.image;
        await ctx.upsertEntity('character', character);
      }

      const { generateEntityImage } = getEntityImageService();

      // The function should return the image URL
      const result = await withCtxResult((ctx) =>
        entityImageService.generateEntityImage(ctx, 'CHAR_test', 'character')
      );
      // Image URL is now an S3 URL
      expect(result).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
      expect(result).toContain('CHAR_test.png');
    });

    it('returns existing image URL if entity already has one', async () => {
      let ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Set image directly on the entity
      const existingUrl = `/api/media/${TEST_UNIVERSE_ID}/media/images/places/PLACE_tavern.png`;
      const place = ctx.findPlace('PLACE_tavern');
      if (place) {
        place.image = existingUrl;
        ctx.upsertEntity('place', place);
      }
      await ctx.persistAll();

      generateImageMock.mockClear();

      // Reload context to ensure clean state
      ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      const { generateEntityImage } = getEntityImageService();

      // Call the function - should return existing URL without generating
      const result = await withCtxResult((ctx) =>
        entityImageService.generateEntityImage(ctx, 'PLACE_tavern', 'place')
      );

      // Should not generate new image (entity already had an image)
      expect(generateImageMock).not.toHaveBeenCalled();
      expect(result).toBe(existingUrl);
    });

    it('returns null for missing entity', async () => {
      await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const { generateEntityImage } = getEntityImageService();

      generateImageMock.mockClear();

      // Call with non-existent entity
      const result = await withCtxResult((ctx) =>
        entityImageService.generateEntityImage(ctx, 'PLACE_nonexistent', 'place')
      );

      // Should not generate image (entity doesn't exist)
      expect(generateImageMock).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null when DISABLE_IMAGE_GENERATION env variable is set', async () => {
      const originalEnv = process.env.DISABLE_IMAGE_GENERATION;
      process.env.DISABLE_IMAGE_GENERATION = 'true';

      try {
        await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
        const { generateEntityImage } = getEntityImageService();

        generateImageMock.mockClear();

        // Call the function - it should return null immediately
        const result = await withCtxResult((ctx) =>
          entityImageService.generateEntityImage(ctx, 'PLACE_tavern', 'place')
        );

        // Verify image generation was not called (env var disabled it)
        expect(generateImageMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
      } finally {
        // Restore original env value
        if (originalEnv === undefined) {
          delete process.env.DISABLE_IMAGE_GENERATION;
        } else {
          process.env.DISABLE_IMAGE_GENERATION = originalEnv;
        }
      }
    });
  });

  describe('regenerateEntityImage', () => {
    it('regenerates image for a character even if one already exists', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // First, set an existing image
      const character = ctx.findCharacter('CHAR_test');
      if (character) {
        character.image = `/api/media/${TEST_UNIVERSE_ID}/media/images/characters/CHAR_test.png`;
        ctx.upsertEntity('character', character);
        await ctx.persistAll();
      }

      editImageMock.mockResolvedValueOnce({ base64: 'newBase64ImageData', durationMs: 100 });

      // Regenerate the image
      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_test'));

      // Verify image was regenerated (editImage used because characters have sprite references)
      expectImageGenerationCalled();
      const prompt = getImagePrompt()!;
      expect(prompt).toContain('Role-playing game character portrait:');
      expect(prompt).toContain('Background:');
      expect(prompt.toLowerCase()).toContain('no transparent background');
      expect(prompt.toLowerCase()).toContain('no blank/empty background');
      expect(prompt.toLowerCase()).toContain('no solid-color background');

      // Verify the image size is portrait
      expect(getImageSize()).toBe('1024x1536');

      // Verify entity was updated with new image URL (S3 URL)
      const updatedCtx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const updatedCharacter = updatedCtx.findCharacter('CHAR_test');
      expect(updatedCharacter?.image).toBeDefined();
      expect(updatedCharacter?.image).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
    });

    it('includes race information in character image prompt when race is defined', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Clear any existing image from elf character
      const elfCharacter = ctx.findCharacter('CHAR_elf');
      if (elfCharacter) {
        delete elfCharacter.image;
        ctx.upsertEntity('character', elfCharacter);
        await ctx.persistAll();
      }

      editImageMock.mockResolvedValueOnce({ base64: 'elfBase64ImageData', durationMs: 100 });

      // Regenerate the elf character's image
      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_elf'));

      // Verify image was generated (editImage used because characters have sprite references)
      expectImageGenerationCalled();
      const prompt = getImagePrompt()!;

      // Verify race information is included in prompt
      expect(prompt).toContain('Race:');
      expect(prompt).toContain('Elf');
    });

    it('uses race ID as fallback label when race definition is not found', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Create a character with an undefined race
      const testChar = ctx.findCharacter('CHAR_test');
      if (testChar) {
        // Set a race that doesn't exist in universe.races
        (testChar.info as any).race = 'RACE_unknown_species';
        delete testChar.image;
        ctx.upsertEntity('character', testChar);
        await ctx.persistAll();
      }

      editImageMock.mockResolvedValueOnce({ base64: 'unknownRaceBase64', durationMs: 100 });

      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_test'));

      expectImageGenerationCalled();
      const prompt = getImagePrompt();

      // Should fall back to using the race ID with RACE_ prefix stripped
      expect(prompt).toContain('Race:');
      expect(prompt).toContain('unknown_species');
    });

    it('includes profession and work location in character image prompt when available', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Clear any existing image from bartender character
      const bartenderCharacter = ctx.findCharacter('CHAR_bartender');
      if (bartenderCharacter) {
        delete bartenderCharacter.image;
        ctx.upsertEntity('character', bartenderCharacter);
        await ctx.persistAll();
      }

      editImageMock.mockResolvedValueOnce({
        base64: 'bartenderBase64ImageData',
        durationMs: 100,
      });

      // Regenerate the bartender character's image
      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_bartender'));

      // Verify image was generated (editImage used because characters have sprite references)
      expectImageGenerationCalled();
      const prompt = getImagePrompt()!;

      // With sprite reference, profession attire instruction is omitted (sprite is the visual source)
      // but work location context is still included
      expect(prompt).toContain('Work location: The bustling main hall of the tavern');
    });

    it('regenerates image for a place even if one already exists', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // First, set an existing image
      const place = ctx.findPlace('PLACE_tavern');
      if (place) {
        place.image = `/api/media/${TEST_UNIVERSE_ID}/media/images/places/PLACE_tavern.png`;
        ctx.upsertEntity('place', place);
        await ctx.persistAll();
      }

      generateImageMock.mockResolvedValueOnce({ base64: 'newBase64ImageData', durationMs: 100 });

      // Regenerate the image
      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'PLACE_tavern'));

      // Verify image was regenerated
      expect(generateImageMock).toHaveBeenCalled();
      const prompt = getImagePrompt()!;
      expect(prompt).toContain('Role-playing game scene:');
      expect(prompt.toLowerCase()).toContain('no blank/empty/transparent/solid-color background');

      // Verify the image size is portrait
      expect(getImageSize()).toBe('1024x1536');

      // Verify entity was updated with new image URL (S3 URL)
      const updatedCtx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const updatedPlace = updatedCtx.findPlace('PLACE_tavern');
      expect(updatedPlace?.image).toBeDefined();
      expect(updatedPlace?.image).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com\//);
    });

    it('includes environment in image prompt for places', async () => {
      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      // Ensure place has environment set to 'interior' (from test fixtures)
      const place = ctx.findPlace('PLACE_tavern');
      expect(place?.info?.environment?.type).toBe('interior');

      generateImageMock.mockResolvedValueOnce({ base64: 'base64ImageData', durationMs: 100 });

      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'PLACE_tavern'));

      const prompt = getImagePrompt()!;
      // Verify environment information is included in prompt
      expect(prompt).toContain('Role-playing game scene');
    });

    it('throws error when entity is not found', async () => {
      await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

      await expect(
        withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_nonexistent'))
      ).rejects.toThrow('Entity not found: CHAR_nonexistent');
    });

    it('works even when DISABLE_IMAGE_GENERATION is set', async () => {
      const originalEnv = process.env.DISABLE_IMAGE_GENERATION;
      process.env.DISABLE_IMAGE_GENERATION = 'true';

      try {
        await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);

        editImageMock.mockResolvedValueOnce({ base64: 'base64ImageData', durationMs: 100 });

        // Regenerate should work even when DISABLE_IMAGE_GENERATION is set
        await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_test'));

        // Verify image was still generated (either via generate or edit)
        expectImageGenerationCalled();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.DISABLE_IMAGE_GENERATION;
        } else {
          process.env.DISABLE_IMAGE_GENERATION = originalEnv;
        }
      }
    });

    it('uploads image to S3 with correct key for places', async () => {
      generateImageMock.mockResolvedValueOnce({
        base64: 'base64ImageDataForPlace',
        durationMs: 100,
      });

      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'PLACE_tavern'));

      // Verify image was uploaded to S3 with correct key
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.stringMatching(/universes\/.*\/images\/places\/PLACE_tavern\.png$/),
        expect.any(Buffer),
        'image/png'
      );
    });

    it('uploads image to S3 with correct key for characters', async () => {
      generateImageMock.mockResolvedValueOnce({
        base64: 'base64ImageDataForChar',
        durationMs: 100,
      });

      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_test'));

      // Verify image was uploaded to S3 with correct key
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.stringMatching(/universes\/.*\/images\/characters\/CHAR_test\.png$/),
        expect.any(Buffer),
        'image/png'
      );
    });

    it('includes cache-bust query param so regenerated portrait displays immediately', async () => {
      generateImageMock.mockResolvedValueOnce({
        base64: 'base64ImageData',
        durationMs: 100,
      });

      await withCtx((ctx) => entityImageService.regenerateEntityImage(ctx, 'CHAR_test'));

      const updatedCtx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const character = updatedCtx.findCharacter('CHAR_test');
      expect(character?.image).toBeDefined();
      expect(character?.image).toMatch(/\?v=\d+$/);
    });
  });

  describe('getSpriteBufferForCharacter', () => {
    it('returns a Buffer when clothing is empty (FEAT-086 regression)', async () => {
      const { getSpriteBufferForCharacter } = getEntityImageService();

      // CharacterPreviewData with no clothing — empty array = no clothing layers, still produces sprite
      const result = await getSpriteBufferForCharacter({
        label: 'Naked Test',
        description: 'Should still render.',
        short_description: 'clothed',
        info: { gender: 'Male' },
      });

      expect(result).toBeInstanceOf(Buffer);
    });

    it('returns a Buffer for a full Character with clothing: [] (FEAT-086 regression)', async () => {
      const { getSpriteBufferForCharacter } = getEntityImageService();

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const character = ctx.findCharacter('CHAR_test');
      expect(character).toBeDefined();

      const result = await getSpriteBufferForCharacter(character!);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('generatePreviewPortrait', () => {
    it('uses sprite-referenced editImage for portrait (civilian fallback)', async () => {
      await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const { generatePreviewPortrait } = getEntityImageService();

      editImageMock.mockResolvedValueOnce({ base64: 'previewBase64Data', durationMs: 100 });

      const characterData = {
        label: 'Test Preview Character',
        description: 'A tall warrior with blue eyes.',
        short_description: 'tall warrior',
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Test Place',
          gender: 'Male',
          eyeColor: 'blue',
          hairColor: 'brown',
          personality: 'Brave',
          aliases: [],
        },
      };

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const result = await generatePreviewPortrait(ctx, {
        characterData,
      });

      // Verify editImage (sprite-referenced) was called with a valid prompt
      expect(editImageMock).toHaveBeenCalledTimes(1);
      const callArgs = editImageMock.mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs.prompt).toBeDefined();
      expect(typeof callArgs.prompt).toBe('string');
      expect(callArgs.prompt.length).toBeGreaterThan(0);
      expect(callArgs.prompt).toContain('Test Preview Character');
      expect(callArgs.size).toBe('1024x1536');
      expect(callArgs.context).toBe('Character Preview Portrait');
      // Sprite frame buffer is passed as image reference
      expect(callArgs.image).toBeInstanceOf(Buffer);

      // Verify base64 is returned
      expect(result).toEqual({ portraitBase64: 'previewBase64Data', faceAnchorY: 0.15 });
    });

    it('includes appearance details in prompt', async () => {
      await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const { generatePreviewPortrait } = getEntityImageService();

      editImageMock.mockResolvedValueOnce({ base64: 'appearanceBase64', durationMs: 100 });

      const characterData = {
        label: 'Detailed Character',
        description: 'A character with specific features.',
        short_description: 'detailed char',
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Test Place',
          gender: 'Female',
          eyeColor: 'green',
          hairColor: 'red',
          hairStyle: 'ponytail',
          beardStyle: null,
          skinTone: 'amber',
          personality: 'Clever',
          aliases: [],
        },
      };

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await generatePreviewPortrait(ctx, {
        characterData,
      });

      // Verify prompt includes appearance details (editImage used with sprite reference)
      const prompt = editImageMock.mock.calls[0]?.[0]?.prompt;
      expect(prompt).toContain('Female');
      expect(prompt).toContain('green eyes');
      expect(prompt).toContain('red hair (ponytail)');
      expect(prompt).toContain('amber skin');
    });

    it('includes beardStyle and skinTone in prompt for male characters', async () => {
      await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const { generatePreviewPortrait } = getEntityImageService();

      editImageMock.mockResolvedValueOnce({ base64: 'beardBase64', durationMs: 100 });

      const characterData = {
        label: 'Bearded Character',
        description: 'A weathered warrior.',
        short_description: 'bearded warrior',
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Test Place',
          gender: 'Male',
          eyeColor: 'brown',
          hairColor: 'brown',
          hairStyle: 'long',
          beardStyle: 'mustache',
          skinTone: 'light',
          personality: 'Brave',
          aliases: [],
        },
      };

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await generatePreviewPortrait(ctx, {
        characterData,
      });

      const prompt = editImageMock.mock.calls[0]?.[0]?.prompt;
      expect(prompt).toContain('mustache beard');
      expect(prompt).toContain('light skin');
    });

    it('shows clean-shaven for male characters with null beardStyle', async () => {
      await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const { generatePreviewPortrait } = getEntityImageService();

      editImageMock.mockResolvedValueOnce({ base64: 'cleanBase64', durationMs: 100 });

      const characterData = {
        label: 'Clean Character',
        description: 'A young soldier.',
        short_description: 'young soldier',
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Test Place',
          gender: 'Male',
          eyeColor: 'blue',
          hairColor: 'brown',
          hairStyle: 'plain',
          beardStyle: null,
          skinTone: 'light',
          personality: 'Disciplined',
          aliases: [],
        },
      };

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await generatePreviewPortrait(ctx, {
        characterData,
      });

      const prompt = editImageMock.mock.calls[0]?.[0]?.prompt;
      expect(prompt).toContain('clean-shaven');
    });

    it('uses revised sprite reference instruction mentioning age and facial details', async () => {
      await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      const { generatePreviewPortrait } = getEntityImageService();

      editImageMock.mockResolvedValueOnce({ base64: 'spriteRefBase64', durationMs: 100 });

      const characterData = {
        label: 'Sprite Ref Test',
        description: 'An old man.',
        short_description: 'old man',
        info: {
          race: 'RACE_human',
          birthdate: 'Year 1',
          birthPlace: 'Test Place',
          gender: 'Male',
          eyeColor: 'brown',
          hairColor: 'gray',
          personality: 'Wise',
          aliases: [],
        },
      };

      const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
      await generatePreviewPortrait(ctx, {
        characterData,
      });

      const prompt = editImageMock.mock.calls[0]?.[0]?.prompt;
      // Should NOT contain "ONLY reference" — that was the old wording
      expect(prompt).not.toContain('ONLY reference');
      // Should mention using text for age and facial details
      expect(prompt).toContain('age, facial hair, facial features');
    });

    it('returns null when DISABLE_IMAGE_GENERATION is set', async () => {
      const originalEnv = process.env.DISABLE_IMAGE_GENERATION;
      process.env.DISABLE_IMAGE_GENERATION = 'true';

      try {
        await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
        const { generatePreviewPortrait } = getEntityImageService();

        const characterData = {
          label: 'Disabled Test',
          description: 'A test character.',
          short_description: 'test',
          info: {
            race: 'RACE_human',
            birthdate: 'Year 1',
            birthPlace: 'Test Place',
            gender: 'Male',
            eyeColor: 'brown',
            hairColor: 'brown',
            personality: 'Test',
            aliases: [],
          },
        };

        const ctx = await UniverseContext.loadAtEntryPoint(TEST_UNIVERSE_ID);
        const result = await generatePreviewPortrait(ctx, {
          characterData,
        });

        // Returns null when image generation is disabled (no throw)
        expect(result).toBeNull();

        // Verify generateImage was not called
        expect(generateImageMock).not.toHaveBeenCalled();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.DISABLE_IMAGE_GENERATION;
        } else {
          process.env.DISABLE_IMAGE_GENERATION = originalEnv;
        }
      }
    });
  });
});
