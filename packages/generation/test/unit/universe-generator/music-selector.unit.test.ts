import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// Use vi.hoisted so mock fns are available before vi.mock() factories run
const {
  getAudioEntriesMock,
  queryLlmMock,
  getOrGenerateBackgroundMusicMock,
  mockUniverseContext,
} = vi.hoisted(() => ({
  getAudioEntriesMock: vi.fn(),
  queryLlmMock: vi.fn(),
  getOrGenerateBackgroundMusicMock: vi.fn(),
  mockUniverseContext: {
    universeId: 'test_universe',
    universe: null as any,
    getCharacter: vi.fn(),
    getPlace: vi.fn(),
    findCharacter: vi.fn(),
    findPlace: vi.fn(),
    getEntitiesByPlace: vi.fn(),
  },
}));

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@dmnpc/core/universe/universe-context.js', () => ({
  UniverseContext: {
    loadAtEntryPoint: vi.fn(async () => mockUniverseContext),
  },
}));

vi.mock('@dmnpc/generation/media-helpers.js', () => ({
  getAudioEntries: getAudioEntriesMock,
}));

vi.mock('@dmnpc/core/clients/openai-client.js', () => ({
  queryLlm: queryLlmMock,
}));

vi.mock('@dmnpc/core/game-time/game-date.js', () => ({
  GameDate: {
    parse: vi.fn(() => ({
      formatLong: () => '1st of First Month, Year 1477',
      timeOfDay: 'evening',
    })),
    tryParse: vi.fn(() => ({
      formatLong: () => '1st of First Month, Year 1477',
      timeOfDay: 'evening',
    })),
  },
}));

vi.mock('@dmnpc/generation/media/audio-generator.js', () => ({
  inferActivityLevel: vi.fn(() => 'crowded'),
}));

vi.mock('@dmnpc/generation/media/background-music-generator.js', () => ({
  getOrGenerateBackgroundMusic: getOrGenerateBackgroundMusicMock,
  DRAMATIC_STATES: [
    'exploration',
    'calm',
    'progress',
    'combat',
    'victory',
    'mystery',
    'melancholy',
  ] as const,
  isDramaticState: (val: string) =>
    ['exploration', 'calm', 'progress', 'combat', 'victory', 'mystery', 'melancholy'].includes(
      val
    ),
  isMusicPace: (val: string) => ['fast', 'medium', 'slow'].includes(val),
}));

// Test data
const mockCharacter = {
  id: 'CHAR_test',
  label: 'Test Character',
  position: { x: null, y: null, parent: 'PLACE_tavern' },
  info: {
    placeId: 'PLACE_tavern',
    storytellerState: {
      progressLevel: 30,
    },
  },
};

const mockPlace = {
  id: 'PLACE_tavern',
  label: 'The Golden Tankard',
  description: 'A cozy tavern with warm firelight',
  short_description: 'A cozy tavern',
  tags: ['TAG_tavern', 'TAG_lively'],
  position: { x: null, y: null, parent: null },
  info: {
    environment: ENVIRONMENT_PRESETS.interior(),
  },
};

const mockUniverse = {
  id: 'test_universe',
  date: '01.01.1477 4A 12:00',
  calendar: {
    name: 'test',
    months: [{ name: 'First', days: 30 }],
    daysPerWeek: 7,
    hoursPerDay: 24,
    minutesPerHour: 60,
    startYear: 1,
    era: '4A',
  },
  weather: 'clear',
};

const mockTracks = [
  {
    filename: 'tavern_lively.mp3',
    url: '/api/media/test/audio/tavern_lively.mp3',
    tags: ['TAG_tavern', 'TAG_lively', 'TAG_exploration', 'TAG_pace_medium'],
    description: 'Upbeat tavern music with lute and drums',
  },
  {
    filename: 'ruins_eerie.mp3',
    url: '/api/media/test/audio/ruins_eerie.mp3',
    tags: ['TAG_ruins', 'TAG_eerie', 'TAG_mystery', 'TAG_pace_slow'],
    description: 'Haunting melody for ancient ruins',
  },
  {
    filename: 'street_peaceful.mp3',
    url: '/api/media/test/audio/street_peaceful.mp3',
    tags: ['TAG_street', 'TAG_peaceful', 'TAG_calm', 'TAG_pace_slow'],
    description: 'Calm ambient music for town streets',
  },
];

const TEST_UNIVERSE_ID = 'test_universe';
const baseMusicOptions = {
  reason: 'scene_change' as const,
  eventType: 'scene_change',
  recentTranscript: '',
};

// Static import — loads at collection time with mocks already in place
import {
  evaluateMusicForScene,
  clearMusicTracking,
  clearAllMusicTracking,
} from '@dmnpc/generation/media/music-selector.js';

describe('generation/music-selector.ts', () => {
  beforeEach(() => {
    // Clear mutable music tracking state between tests
    clearAllMusicTracking();

    // Set up default mocks — spread mockUniverse to avoid cross-test mutation
    mockUniverseContext.universe = { ...mockUniverse };
    mockUniverseContext.getCharacter.mockReturnValue(mockCharacter);
    mockUniverseContext.getPlace.mockReturnValue(mockPlace);
    mockUniverseContext.findCharacter.mockReturnValue(mockCharacter);
    mockUniverseContext.findPlace.mockReturnValue(mockPlace);
    mockUniverseContext.getEntitiesByPlace.mockReturnValue([]);
    getAudioEntriesMock.mockResolvedValue(mockTracks);
    getOrGenerateBackgroundMusicMock.mockResolvedValue(null);
  });

  function getContext() {
    // Return the mock directly - no need to import and call the mocked function
    return mockUniverseContext;
  }

  describe('evaluateMusicForScene', () => {
    // Note: "exits early when no subscribers" test removed - music-selector now returns data
    // and the caller is responsible for checking subscribers before emitting

    it('triggers generation when no tracks available', async () => {
      // evaluateMusicForScene from static import
      getAudioEntriesMock.mockResolvedValue([]);
      getOrGenerateBackgroundMusicMock.mockResolvedValue({
        url: '/api/media/test/audio/music/bg_calm_tavern_medium.mp3',
        filename: 'bg_calm_tavern_medium.mp3',
        signature: 'calm_tavern_medium',
        description: 'Peaceful tavern music',
        generated: true,
      });

      const ctx = await getContext();
      const result = await evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions);

      expect(queryLlmMock).not.toHaveBeenCalled();
      expect(getOrGenerateBackgroundMusicMock).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          music: expect.objectContaining({
            url: '/api/media/test/audio/music/bg_calm_tavern_medium.mp3',
            filename: 'bg_calm_tavern_medium.mp3',
          }),
          reason: 'scene_change',
          changed: true,
        })
      );
    });

    it('handles generation failure when no tracks available', async () => {
      // evaluateMusicForScene from static import
      getAudioEntriesMock.mockResolvedValue([]);
      getOrGenerateBackgroundMusicMock.mockRejectedValue(new Error('Generation failed'));

      const ctx = await getContext();
      await expect(evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions)).rejects.toThrow(
        'Generation failed'
      );

      expect(getOrGenerateBackgroundMusicMock).toHaveBeenCalled();
    });

    it('selects music when no current track is playing', async () => {
      // evaluateMusicForScene from static import

      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'No music playing, tavern music fits the scene',
        },
      });

      const ctx = await getContext();
      const result = await evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions);

      expect(queryLlmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'Music Selector',
          prompt: expect.stringContaining('No music currently playing'),
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          music: expect.objectContaining({
            url: mockTracks[0].url,
            filename: mockTracks[0].filename,
          }),
          reason: 'scene_change',
          changed: true,
        })
      );
    });

    it('does not change music when LLM says shouldChange is false', async () => {
      clearAllMusicTracking();

      // First call to set initial music
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Initial selection',
        },
      });
      const ctx = await getContext();
      const result1 = await evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions);
      expect(result1?.changed).toBe(true);

      // Second call - music is appropriate, don't change (NOT a scene_change, so no sync)
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 2,
          shouldChange: false,
          reasoning: 'Current music is still appropriate',
        },
      });
      const result2 = await evaluateMusicForScene(ctx, 'CHAR_test', {
        ...baseMusicOptions,
        reason: 'storyteller_event',
      });

      // Should return null (not a scene_change, so no sync needed)
      expect(result2).toBeNull();
    });

    it('syncs existing music to client on scene_change even when shouldChange is false', async () => {
      clearAllMusicTracking();

      // First call to set initial music
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Initial selection',
        },
      });
      const ctx = await getContext();
      const result1 = await evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions);
      expect(result1?.changed).toBe(true);

      // Second call with scene_change - music is appropriate but should sync
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: false,
          reasoning: 'Current music is still appropriate',
        },
      });
      const ctx2 = await getContext();
      const result2 = await evaluateMusicForScene(ctx2, 'CHAR_test', baseMusicOptions);

      // Should return a sync result with the current track info
      expect(result2).toEqual(
        expect.objectContaining({
          music: expect.objectContaining({
            url: mockTracks[0].url,
            filename: mockTracks[0].filename,
          }),
          reason: 'sync',
          changed: false,
        })
      );
    });

    it('changes music when LLM says shouldChange is true', async () => {
      clearAllMusicTracking();

      // First call to set initial music
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Initial selection',
        },
      });
      const ctx = await getContext();
      const result1 = await evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions);
      expect(result1?.changed).toBe(true);

      // Second call - music needs to change
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'mystery',
          pace: 'slow',
          trackNumber: 2,
          shouldChange: true,
          reasoning: 'Moved to ruins, need eerie music',
        },
      });
      const ctx2 = await getContext();
      const result2 = await evaluateMusicForScene(ctx2, 'CHAR_test', baseMusicOptions);

      expect(result2).toEqual(
        expect.objectContaining({
          music: expect.objectContaining({
            url: mockTracks[1].url,
            filename: mockTracks[1].filename,
          }),
          reason: 'scene_change',
          changed: true,
        })
      );
    });

    it('throws error when LLM call fails', async () => {
      // evaluateMusicForScene from static import

      queryLlmMock.mockRejectedValue(new Error('LLM API error'));

      const ctx = await getContext();
      await expect(evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions)).rejects.toThrow(
        'LLM API error'
      );
    });

    it('throws error when LLM returns invalid track number', async () => {
      // evaluateMusicForScene from static import

      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 999, // Invalid
          shouldChange: true,
          reasoning: 'Test',
        },
      });

      const ctx = await getContext();
      await expect(evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions)).rejects.toThrow(
        'Invalid track number returned by LLM'
      );
    });

    it('includes current track in LLM prompt when music is playing', async () => {
      clearAllMusicTracking();

      // First call to set initial music
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Initial',
        },
      });
      const ctx = await getContext();
      await evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions);

      // Second call should include current track in prompt
      queryLlmMock.mockResolvedValueOnce({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: false,
          reasoning: 'Still good',
        },
      });
      const ctx2 = await getContext();
      await evaluateMusicForScene(ctx2, 'CHAR_test', baseMusicOptions);

      expect(queryLlmMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('tavern_lively.mp3'),
        })
      );
    });
  });

  describe('clearMusicTracking', () => {
    it('clears tracking for specific character', async () => {
      // evaluateMusicForScene, clearMusicTracking from static import

      // Set initial music
      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Initial',
        },
      });
      const ctx = await getContext();
      await evaluateMusicForScene(ctx, 'CHAR_test', baseMusicOptions);

      // Clear tracking
      clearMusicTracking('CHAR_test');

      // Next call should see "No music currently playing"
      const ctx2 = await getContext();
      await evaluateMusicForScene(ctx2, 'CHAR_test', baseMusicOptions);

      expect(queryLlmMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('No music currently playing'),
        })
      );
    });
  });

  describe('clearAllMusicTracking', () => {
    it('clears tracking for all characters', async () => {
      // evaluateMusicForScene, clearAllMusicTracking from static import

      // Set initial music for two characters
      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Initial',
        },
      });
      const ctx = await getContext();
      await evaluateMusicForScene(ctx, 'CHAR_test1', baseMusicOptions);
      await evaluateMusicForScene(ctx, 'CHAR_test2', baseMusicOptions);

      // Clear all tracking
      clearAllMusicTracking();

      // Both should see "No music currently playing"
      const ctx2 = await getContext();
      await evaluateMusicForScene(ctx2, 'CHAR_test1', baseMusicOptions);
      expect(queryLlmMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('No music currently playing'),
        })
      );

      await evaluateMusicForScene(ctx2, 'CHAR_test2', baseMusicOptions);
      expect(queryLlmMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('No music currently playing'),
        })
      );
    });
  });

  describe('context building', () => {
    const defaultOptions = {
      eventType: 'scene_change',
      recentTranscript: 'PLAYER: I look around.\nDM: You see a cozy tavern.',
    };

    it('includes place information in context', async () => {
      // evaluateMusicForScene from static import

      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Test',
        },
      });

      const ctx = await getContext();
      await evaluateMusicForScene(ctx, 'CHAR_test', defaultOptions);

      expect(queryLlmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringMatching(/Location: The Golden Tankard \(interior\)/),
        })
      );
    });

    it('includes weather in context when available', async () => {
      // evaluateMusicForScene from static import

      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Test',
        },
      });

      const ctx = await getContext();
      await evaluateMusicForScene(ctx, 'CHAR_test', defaultOptions);

      expect(queryLlmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Weather: clear'),
        })
      );
    });

    it('handles missing calendar gracefully', async () => {
      // evaluateMusicForScene from static import

      mockUniverseContext.universe = {
        ...mockUniverse,
        calendar: undefined,
      };

      queryLlmMock.mockResolvedValue({
        content: {
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Test',
        },
      });

      // Should throw because calendar is required
      const ctx = await getContext();
      await expect(evaluateMusicForScene(ctx, 'CHAR_test', defaultOptions)).rejects.toThrow(
        'Universe calendar missing'
      );
    });

    it('handles context building errors gracefully', async () => {
      // evaluateMusicForScene from static import

      mockUniverseContext.getCharacter.mockImplementation(() => {
        throw new Error('Character not found');
      });

      // Should throw because character is not found
      const ctx = await getContext();
      await expect(evaluateMusicForScene(ctx, 'CHAR_nonexistent', defaultOptions)).rejects.toThrow(
        'Character not found'
      );
    });

    it('includes recent transcript in context when provided', async () => {
      // evaluateMusicForScene from static import

      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Test',
        },
      });

      const ctx = await getContext();
      await evaluateMusicForScene(ctx, 'CHAR_test', {
        reason: 'scene_change',
        eventType: 'combat',
        recentTranscript: 'PLAYER: I draw my sword!\nDM: The bandit charges at you.',
      });

      expect(queryLlmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('CURRENT SITUATION:'),
        })
      );
      expect(queryLlmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('I draw my sword'),
        })
      );
      expect(queryLlmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('bandit charges'),
        })
      );
    });

    it('handles empty transcript', async () => {
      // evaluateMusicForScene from static import

      queryLlmMock.mockResolvedValue({
        content: {
          mood: 'exploration',
          pace: 'medium',
          trackNumber: 1,
          shouldChange: true,
          reasoning: 'Test',
        },
      });

      const ctx = await getContext();
      await evaluateMusicForScene(ctx, 'CHAR_test', {
        reason: 'scene_change',
        eventType: 'exploration',
        recentTranscript: '',
      });

      expect(queryLlmMock).toHaveBeenCalled();
    });
  });
});
