/**
 * Document Storage Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DocumentData } from '@dmnpc/generation/document/document-parser.js';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const TEST_DIR = resolve(process.cwd(), 'test-universes-doc-storage');

// Mock @dmnpc/data to point UNIVERSES_DIR at our test directory
vi.mock('@dmnpc/data', () => ({
  UNIVERSES_DIR: resolve(process.cwd(), 'test-universes-doc-storage'),
  DATA_ROOT: resolve(process.cwd(), 'test-universes-doc-storage'),
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

// Static import — loads at collection time with mocks in place
import { saveDocuments } from '@dmnpc/generation/document/document-storage.js';

describe('document-storage', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('saveDocuments', () => {
    it('saves documents to the universe directory', async () => {
      const documents: DocumentData[] = [
        {
          filename: 'lore.txt',
          contentBase64: Buffer.from('Ancient lore content').toString('base64'),
          size: 19,
        },
      ];

      const result = await saveDocuments('test_universe', documents);

      expect(result).toEqual(['documents/lore.txt']);

      const filePath = join(TEST_DIR, 'test_universe', 'documents', 'lore.txt');
      expect(existsSync(filePath)).toBe(true);
    });

    it('saves multiple documents', async () => {
      const documents: DocumentData[] = [
        {
          filename: 'file1.txt',
          contentBase64: Buffer.from('Content 1').toString('base64'),
          size: 9,
        },
        {
          filename: 'file2.md',
          contentBase64: Buffer.from('# Content 2').toString('base64'),
          size: 11,
        },
      ];

      const result = await saveDocuments('test_universe', documents);

      expect(result).toEqual(['documents/file1.txt', 'documents/file2.md']);
    });

    it('creates the documents directory if it does not exist', async () => {
      const documents: DocumentData[] = [
        {
          filename: 'test.txt',
          contentBase64: Buffer.from('Test').toString('base64'),
          size: 4,
        },
      ];

      const docsDir = join(TEST_DIR, 'new_universe', 'documents');
      expect(existsSync(docsDir)).toBe(false);

      await saveDocuments('new_universe', documents);

      expect(existsSync(docsDir)).toBe(true);
    });

    it('returns empty array when no documents provided', async () => {
      const result = await saveDocuments('test_universe', []);

      expect(result).toEqual([]);
    });
  });
});
