/**
 * Document Parser Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are available when vi.mock factory runs
const { pdfParseMock, mammothExtractMock } = vi.hoisted(() => ({
  pdfParseMock: vi.fn((buffer: Buffer) => Promise.resolve({ text: 'PDF content here' })),
  mammothExtractMock: vi.fn((options: { buffer: Buffer }) => Promise.resolve({ value: 'DOCX content here' })),
}));

// Mock pdf-parse-new - the source imports it as default and casts it
// The source does: import pdfParseModule from 'pdf-parse-new';
// Then: const pdfParse = pdfParseModule as unknown as (buffer: Buffer) => Promise<{ text: string }>;
vi.mock('pdf-parse-new', () => ({
  __esModule: true,
  default: pdfParseMock,
}));

// Mock mammoth - the source imports it as default and accesses extractRawText
// The source does: import mammoth from 'mammoth';
// Then: mammoth.extractRawText({ buffer })
vi.mock('mammoth', () => ({
  __esModule: true,
  default: {
    extractRawText: mammothExtractMock,
  },
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

// Import after mocks are set up
import {
  parseDocument,
  parseDocuments,
  type DocumentData,
} from '@dmnpc/generation/document/document-parser.js';

describe('document-parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseDocument', () => {
    it('parses TXT files directly', async () => {
      const doc: DocumentData = {
        filename: 'test.txt',
        contentBase64: Buffer.from('Hello, world!').toString('base64'),
        size: 13,
      };

      const result = await parseDocument(doc);

      expect(result.filename).toBe('test.txt');
      expect(result.content).toBe('Hello, world!');
      expect(result.charCount).toBe(13);
    });

    it('parses MD files directly', async () => {
      const doc: DocumentData = {
        filename: 'readme.md',
        contentBase64: Buffer.from('# Heading\n\nSome markdown content').toString('base64'),
        size: 30,
      };

      const result = await parseDocument(doc);

      expect(result.filename).toBe('readme.md');
      expect(result.content).toBe('# Heading\n\nSome markdown content');
    });

    it('throws error for unsupported file types', async () => {
      const doc: DocumentData = {
        filename: 'image.jpg',
        contentBase64: Buffer.from('fake image').toString('base64'),
        size: 500,
      };

      await expect(parseDocument(doc)).rejects.toThrow('Unsupported file type: jpg');
    });
  });

  describe('parseDocuments', () => {
    it('parses multiple documents', async () => {
      const docs: DocumentData[] = [
        {
          filename: 'file1.txt',
          contentBase64: Buffer.from('Content 1').toString('base64'),
          size: 9,
        },
        {
          filename: 'file2.txt',
          contentBase64: Buffer.from('Content 2').toString('base64'),
          size: 9,
        },
      ];

      const results = await parseDocuments(docs);

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe('file1.txt');
      expect(results[1].filename).toBe('file2.txt');
    });

    it('continues processing even if one document fails', async () => {
      const docs: DocumentData[] = [
        {
          filename: 'good.txt',
          contentBase64: Buffer.from('Good content').toString('base64'),
          size: 12,
        },
        {
          filename: 'bad.xyz',
          contentBase64: Buffer.from('Bad content').toString('base64'),
          size: 11,
        },
        {
          filename: 'another.txt',
          contentBase64: Buffer.from('Another content').toString('base64'),
          size: 15,
        },
      ];

      const results = await parseDocuments(docs);

      expect(results).toHaveLength(2);
      expect(results[0].filename).toBe('good.txt');
      expect(results[1].filename).toBe('another.txt');
    });

    it('returns empty array when all documents fail', async () => {
      const docs: DocumentData[] = [
        {
          filename: 'bad1.xyz',
          contentBase64: Buffer.from('Bad').toString('base64'),
          size: 3,
        },
        {
          filename: 'bad2.abc',
          contentBase64: Buffer.from('Bad').toString('base64'),
          size: 3,
        },
      ];

      const results = await parseDocuments(docs);

      expect(results).toHaveLength(0);
    });
  });
});
