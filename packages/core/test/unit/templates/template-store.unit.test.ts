/**
 * Unit tests for template-character-store functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

// Mock logger
vi.mock('@dmnpc/core/infra/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { existsSync } from 'fs';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import {
  listTemplateCharacters,
  getTemplateCharacter,
  saveTemplateCharacter,
  deleteTemplateCharacter,
  templateCharacterExists,
} from '@dmnpc/core/stores/template-character-store.js';

describe('template-character-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  const mockTemplate: TemplateCharacterDefinition = {
    id: 'TEMPLATE_aldric_blackwood',
    label: 'Aldric Blackwood',
    description: 'A tall, weathered man with deep-set grey eyes and a scar across his left cheek.',
    short_description: 'grizzled old warrior',
    personality: 'Stoic and duty-bound, with a hidden warmth for those he protects.',
    backstoryThemes: ['redemption', 'loss', 'duty'],
    physicalTraits: {
      gender: 'male',
      eyeColor: 'grey',
      hairColor: 'silver',
      race: 'human',
      raceAdaptation: 'human-like',
    },
  };

  describe('listTemplateCharacters', () => {
    it('returns all template definitions from the templates directory', async () => {
      const mockTemplates = [
        mockTemplate,
        { ...mockTemplate, id: 'TEMPLATE_second', label: 'Second' },
      ];

      vi.mocked(readdir).mockResolvedValue([
        'TEMPLATE_aldric_blackwood.json',
        'TEMPLATE_second.json',
      ] as any);

      vi.mocked(readFile).mockImplementation((path: any) => {
        const filename = path.toString().split(/[/\\]/).pop();
        const template = mockTemplates.find((t) => `${t.id}.json` === filename);
        return Promise.resolve(JSON.stringify(template));
      });

      const result = await listTemplateCharacters();

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(['TEMPLATE_aldric_blackwood', 'TEMPLATE_second']);
    });

    it('filters out non-JSON files', async () => {
      vi.mocked(readdir).mockResolvedValue([
        'TEMPLATE_aldric_blackwood.json',
        'readme.txt',
        '.gitkeep',
      ] as any);

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockTemplate));

      const result = await listTemplateCharacters();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('TEMPLATE_aldric_blackwood');
    });

    it('returns empty array when templates directory does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await listTemplateCharacters();

      expect(result).toEqual([]);
    });

    it('skips templates with missing required fields', async () => {
      vi.mocked(readdir).mockResolvedValue(['TEMPLATE_invalid.json'] as any);

      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          id: 'TEMPLATE_invalid',
          label: 'Invalid',
          // missing description, short_description, personality, physicalTraits
        })
      );

      const result = await listTemplateCharacters();

      expect(result).toHaveLength(0);
    });
  });

  describe('getTemplateCharacter', () => {
    it('returns the template by ID', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockTemplate));

      const result = await getTemplateCharacter('TEMPLATE_aldric_blackwood');

      expect(result).toEqual(mockTemplate);
    });

    it('returns null when template does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await getTemplateCharacter('TEMPLATE_nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('saveTemplateCharacter', () => {
    it('saves the template to the filesystem', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await saveTemplateCharacter(mockTemplate);

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('TEMPLATE_aldric_blackwood.json'),
        expect.stringContaining('"id": "TEMPLATE_aldric_blackwood"'),
        'utf-8'
      );
    });

    it('throws error for missing required fields', async () => {
      const invalidTemplate = {
        id: 'TEMPLATE_invalid',
        label: 'Invalid',
        // missing required fields
      } as TemplateCharacterDefinition;

      await expect(saveTemplateCharacter(invalidTemplate)).rejects.toThrow('Template must have');
    });

    it('throws error for invalid ID format', async () => {
      const invalidTemplate = {
        ...mockTemplate,
        id: 'invalid_id', // doesn't start with TEMPLATE_
      };

      await expect(saveTemplateCharacter(invalidTemplate)).rejects.toThrow(
        'Template ID must start with TEMPLATE_'
      );
    });
  });

  describe('deleteTemplateCharacter', () => {
    it('deletes the template file', async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);

      const result = await deleteTemplateCharacter('TEMPLATE_aldric_blackwood');

      expect(result).toBe(true);
      expect(unlink).toHaveBeenCalledWith(
        expect.stringContaining('TEMPLATE_aldric_blackwood.json')
      );
    });

    it('returns false when template does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await deleteTemplateCharacter('TEMPLATE_nonexistent');

      expect(result).toBe(false);
      expect(unlink).not.toHaveBeenCalled();
    });
  });

  describe('templateCharacterExists', () => {
    it('returns true when template file exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = templateCharacterExists('TEMPLATE_aldric_blackwood');

      expect(result).toBe(true);
    });

    it('returns false when template file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = templateCharacterExists('TEMPLATE_nonexistent');

      expect(result).toBe(false);
    });
  });
});
