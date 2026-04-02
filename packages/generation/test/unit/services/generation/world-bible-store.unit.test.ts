/**
 * WorldBible Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { vi } from 'vitest';
import type { WorldBible } from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

const TEST_DIR = resolve(process.cwd(), 'test-universes-world-bible');

// Mock @dmnpc/data to point UNIVERSES_DIR at our test directory
vi.mock('@dmnpc/data', () => ({
  UNIVERSES_DIR: resolve(process.cwd(), 'test-universes-world-bible'),
  DATA_ROOT: resolve(process.cwd(), 'test-universes-world-bible'),
}));

// Static import from subpath — lightweight, mocks handle UNIVERSES_DIR
import {
  saveWorldBible,
  loadWorldBible,
  deleteWorldBible,
  hasWorldBible,
} from '@dmnpc/core/stores/world-bible-store.js';

// Sample WorldBible for testing
const createSampleWorldBible = (): WorldBible => ({
  themes: ['redemption', 'conflict'],
  characters: [
    {
      name: 'Test Character',
      description: 'A test character',
      temporalStatus: 'contemporary',
      activeEra: 'Current Era',
    },
  ],
  places: [
    {
      name: 'Test City',
      description: 'A bustling city',
      isSuitableStart: false,
      environment: ENVIRONMENT_PRESETS.exterior(),
      purpose: 'settlement',
      parentName: 'The Planet',
    },
  ],
  lore: 'Ancient lore of the world',
  rules: ['Magic requires sacrifice'],
  tone: 'dark fantasy',
  overview: 'A world of magic and mystery',
  keyConflicts: ['War between nations'],
  atmosphere: 'Tense and mysterious',
  narrativePresent: 'Year 1000',
  historicalLore: 'Long ago, the world was different',
  historicalEvents: [],
});

describe('world-bible-store', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('saveWorldBible', () => {
    it('saves WorldBible to the universe directory', async () => {
      const universeDir = join(TEST_DIR, 'test_universe');
      await mkdir(universeDir, { recursive: true });

      const worldBible = createSampleWorldBible();
      await saveWorldBible('test_universe', worldBible);

      const filePath = join(TEST_DIR, 'test_universe', 'world-bible.json');
      expect(existsSync(filePath)).toBe(true);

      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.themes).toEqual(['redemption', 'conflict']);
      expect(parsed.characters).toHaveLength(1);
      expect(parsed.places).toHaveLength(1);
    });
  });

  describe('loadWorldBible', () => {
    it('loads existing WorldBible', async () => {
      const universeDir = join(TEST_DIR, 'test_universe');
      await mkdir(universeDir, { recursive: true });

      const worldBible = createSampleWorldBible();
      await saveWorldBible('test_universe', worldBible);

      const loaded = await loadWorldBible('test_universe');

      expect(loaded).not.toBeNull();
      expect(loaded?.themes).toEqual(['redemption', 'conflict']);
      expect(loaded?.characters).toHaveLength(1);
      expect(loaded?.characters[0].name).toBe('Test Character');
      expect(loaded?.tone).toBe('dark fantasy');
    });

    it('returns null for non-existent WorldBible', async () => {
      const loaded = await loadWorldBible('non_existent_universe');
      expect(loaded).toBeNull();
    });
  });

  describe('deleteWorldBible', () => {
    it('deletes existing WorldBible', async () => {
      const universeDir = join(TEST_DIR, 'test_universe');
      await mkdir(universeDir, { recursive: true });
      await saveWorldBible('test_universe', createSampleWorldBible());

      const filePath = join(TEST_DIR, 'test_universe', 'world-bible.json');
      expect(existsSync(filePath)).toBe(true);

      const result = await deleteWorldBible('test_universe');
      expect(result).toBe(true);
      expect(existsSync(filePath)).toBe(false);
    });

    it('returns false for non-existent WorldBible', async () => {
      const result = await deleteWorldBible('non_existent_universe');
      expect(result).toBe(false);
    });
  });

  describe('hasWorldBible', () => {
    it('returns true when WorldBible exists', async () => {
      const universeDir = join(TEST_DIR, 'test_universe');
      await mkdir(universeDir, { recursive: true });
      await saveWorldBible('test_universe', createSampleWorldBible());

      const result = hasWorldBible('test_universe');
      expect(result).toBe(true);
    });

    it('returns false when WorldBible does not exist', async () => {
      const result = hasWorldBible('non_existent_universe');
      expect(result).toBe(false);
    });
  });
});
