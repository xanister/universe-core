/**
 * Unit tests for Generation Context
 *
 * Tests the context building functions that provide available entities
 * to generator prompts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildStorytellerContext,
  buildTemplateCharacterContext,
  buildExistingStorytellersContext,
  buildExistingTemplatesContext,
  buildGenerationContext,
  getTemplateCharacterList,
  getStorytellerList,
} from '@dmnpc/generation/generation-context.js';
import * as storytellerDefs from '@dmnpc/core/stores/storyteller-store.js';
import * as templateStore from '@dmnpc/core/stores/template-character-store.js';
import type { StorytellerDefinition, TemplateCharacterDefinition } from '@dmnpc/types/npc';

// Mock dependencies
vi.mock('@dmnpc/core/stores/storyteller-store.js', () => ({
  listStorytellers: vi.fn(),
}));

vi.mock('@dmnpc/core/stores/template-character-store.js', () => ({
  listTemplateCharacters: vi.fn(),
}));

const mockStorytellers: StorytellerDefinition[] = [
  {
    id: 'STORYTELLER_action_adventure',
    label: 'Action Adventure',
    description: 'A fast-paced storyteller that throws the player into the action immediately.',
    pacing: 'very-fast',
    eventTypes: ['ambush', 'chase', 'threat'],
    arcStructure: { acts: 3, tensionCurve: 'rising' },
    storyStyle: 'Action, danger, and urgency at every turn.',
    tone: 'action',
    verbosity: 1,
  },
  {
    id: 'STORYTELLER_classic_adventure',
    label: 'Classic Adventure',
    description: 'A traditional fantasy adventure storyteller with balanced pacing.',
    pacing: 'moderate',
    eventTypes: ['rumor', 'discovery', 'threat'],
    arcStructure: { acts: 3, tensionCurve: 'rising' },
    storyStyle: 'Heroism, discovery, and conflict in balanced measure.',
    tone: 'heroic',
    verbosity: 2,
  },
  {
    id: 'STORYTELLER_slow_burn',
    label: 'Slow Burn',
    description: 'A slow-paced storyteller focused on character development.',
    pacing: 'slow',
    eventTypes: ['conversation', 'revelation', 'milestone'],
    arcStructure: { acts: 5, tensionCurve: 'wave' },
    storyStyle: 'Focus on introspection, relationships, and growth.',
    tone: 'contemplative',
    verbosity: 4,
  },
];

const mockTemplates: TemplateCharacterDefinition[] = [
  {
    id: 'TEMPLATE_pipras_pennyroyal',
    label: 'Pipras Pennyroyal',
    description: 'A wiry, quick-witted wanderer.',
    short_description: 'wiry clever wanderer',
    personality: 'Quick-witted and charming.',
    backstoryThemes: ['debt', 'found family', 'past mistakes'],
    physicalTraits: {
      gender: 'male',
      eyeColor: 'blue',
      hairColor: 'blonde',
      race: 'Elf',
      raceAdaptation: 'elf-like',
    },
  },
  {
    id: 'TEMPLATE_xanister_majere',
    label: 'Xanister Majere',
    description: 'A mysterious jester.',
    short_description: 'mysterious jester',
    personality: 'Hedonistic and charming.',
    backstoryThemes: ['reinvention', 'manipulation', 'escape'],
    physicalTraits: {
      gender: 'male',
      eyeColor: 'green',
      hairColor: 'silver',
      race: 'humanoid',
      raceAdaptation: 'elvish-leaning',
    },
  },
];

describe('buildStorytellerContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns formatted storyteller context sorted by pacing', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue(mockStorytellers);

    const result = await buildStorytellerContext();

    expect(result).toContain('AVAILABLE STORYTELLERS');
    expect(result).toContain('STORYTELLER_action_adventure');
    expect(result).toContain('Action Adventure');
    expect(result).toContain('pacing: very-fast');
    expect(result).toContain('PACING GUIDANCE');

    // Verify sorting: very-fast should appear before moderate, which appears before slow
    const veryFastIndex = result.indexOf('very-fast');
    const moderateIndex = result.indexOf('moderate');
    const slowIndex = result.indexOf('slow');
    expect(veryFastIndex).toBeLessThan(moderateIndex);
    expect(moderateIndex).toBeLessThan(slowIndex);
  });

  it('returns empty string when no storytellers exist', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue([]);

    const result = await buildStorytellerContext();

    expect(result).toBe('');
  });

  it('limits results to maxCount parameter', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue(mockStorytellers);

    const result = await buildStorytellerContext(2);

    // Should contain only 2 storytellers
    const matches = result.match(/STORYTELLER_/g);
    expect(matches).toHaveLength(2);
  });

  it('handles errors gracefully', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockRejectedValue(new Error('Database error'));

    const result = await buildStorytellerContext();

    expect(result).toBe('');
  });
});

describe('buildTemplateCharacterContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns formatted template character context', async () => {
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue(mockTemplates);

    const result = await buildTemplateCharacterContext();

    expect(result).toContain('AVAILABLE TEMPLATE CHARACTERS');
    expect(result).toContain('TEMPLATE_pipras_pennyroyal');
    expect(result).toContain('Pipras Pennyroyal');
    expect(result).toContain('wiry clever wanderer');
    expect(result).toContain('themes: debt, found family, past mistakes');
    expect(result).toContain('TEMPLATE CHARACTER GUIDANCE');
  });

  it('returns empty string when no templates exist', async () => {
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue([]);

    const result = await buildTemplateCharacterContext();

    expect(result).toBe('');
  });

  it('limits results to maxCount parameter', async () => {
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue(mockTemplates);

    const result = await buildTemplateCharacterContext(1);

    // Should contain only 1 template
    const matches = result.match(/TEMPLATE_/g);
    expect(matches).toHaveLength(1);
  });

  it('handles errors gracefully', async () => {
    vi.mocked(templateStore.listTemplateCharacters).mockRejectedValue(new Error('Database error'));

    const result = await buildTemplateCharacterContext();

    expect(result).toBe('');
  });
});

describe('buildExistingStorytellersContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns context for avoiding duplicates', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue(mockStorytellers);

    const result = await buildExistingStorytellersContext();

    expect(result).toContain('EXISTING STORYTELLERS');
    expect(result).toContain('create something distinct');
    expect(result).toContain('Avoid duplicating');
  });
});

describe('buildExistingTemplatesContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns context for avoiding duplicates', async () => {
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue(mockTemplates);

    const result = await buildExistingTemplatesContext();

    expect(result).toContain('EXISTING TEMPLATE CHARACTERS');
    expect(result).toContain('create something distinct');
    expect(result).toContain('Avoid duplicating');
  });
});

describe('buildGenerationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('combines storyteller and template context when both requested', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue(mockStorytellers);
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue(mockTemplates);

    const result = await buildGenerationContext({
      includeStorytellers: true,
      includeTemplateCharacters: true,
    });

    expect(result).toContain('AVAILABLE STORYTELLERS');
    expect(result).toContain('AVAILABLE TEMPLATE CHARACTERS');
  });

  it('returns only storyteller context when only storytellers requested', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue(mockStorytellers);
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue(mockTemplates);

    const result = await buildGenerationContext({
      includeStorytellers: true,
      includeTemplateCharacters: false,
    });

    expect(result).toContain('AVAILABLE STORYTELLERS');
    expect(result).not.toContain('AVAILABLE TEMPLATE CHARACTERS');
  });

  it('returns only template context when only templates requested', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue(mockStorytellers);
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue(mockTemplates);

    const result = await buildGenerationContext({
      includeStorytellers: false,
      includeTemplateCharacters: true,
    });

    expect(result).not.toContain('AVAILABLE STORYTELLERS');
    expect(result).toContain('AVAILABLE TEMPLATE CHARACTERS');
  });

  it('returns empty string when nothing requested', async () => {
    const result = await buildGenerationContext({
      includeStorytellers: false,
      includeTemplateCharacters: false,
    });

    expect(result).toBe('');
  });
});

describe('getTemplateCharacterList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns simplified template list', async () => {
    vi.mocked(templateStore.listTemplateCharacters).mockResolvedValue(mockTemplates);

    const result = await getTemplateCharacterList();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'TEMPLATE_pipras_pennyroyal',
      label: 'Pipras Pennyroyal',
      shortDescription: 'wiry clever wanderer',
    });
  });

  it('returns empty array on error', async () => {
    vi.mocked(templateStore.listTemplateCharacters).mockRejectedValue(new Error('Error'));

    const result = await getTemplateCharacterList();

    expect(result).toEqual([]);
  });
});

describe('getStorytellerList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns simplified storyteller list', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockResolvedValue(mockStorytellers);

    const result = await getStorytellerList();

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      id: 'STORYTELLER_action_adventure',
      label: 'Action Adventure',
      pacing: 'very-fast',
    });
  });

  it('returns empty array on error', async () => {
    vi.mocked(storytellerDefs.listStorytellers).mockRejectedValue(new Error('Error'));

    const result = await getStorytellerList();

    expect(result).toEqual([]);
  });
});
