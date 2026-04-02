/**
 * Document Parser
 *
 * Service for extracting text content from various document formats.
 * Supports TXT, MD, PDF, and DOCX files.
 */

// pdf-parse-new types don't correctly expose the default export as callable
import pdfParseModule from 'pdf-parse-new';
import mammoth from 'mammoth';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- pdf-parse-new third-party typing gap
const pdfParse = pdfParseModule as unknown as (buffer: Buffer) => Promise<{ text: string }>;
import { logger } from '@dmnpc/core/infra/logger.js';

/**
 * Document data received from the frontend (base64 encoded).
 */
export interface DocumentData {
  filename: string;
  contentBase64: string;
  size: number;
}

/**
 * Parsed document with extracted text content.
 */
export interface ParsedDocument {
  filename: string;
  content: string;
  charCount: number;
}

/**
 * Parse a single document and extract its text content.
 * Supports TXT, MD, PDF, and DOCX formats.
 */
export async function parseDocument(doc: DocumentData): Promise<ParsedDocument> {
  const buffer = Buffer.from(doc.contentBase64, 'base64');
  const ext = doc.filename.toLowerCase().split('.').pop();

  let content: string;

  switch (ext) {
    case 'txt':
    case 'md':
      content = buffer.toString('utf-8');
      break;

    case 'pdf': {
      const pdfData = await pdfParse(buffer);
      content = pdfData.text;
      break;
    }

    case 'docx': {
      const docxResult = await mammoth.extractRawText({ buffer });
      content = docxResult.value;
      break;
    }

    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }

  logger.info('DocumentParser', `Parsed ${doc.filename}: ${content.length} chars`);

  return {
    filename: doc.filename,
    content,
    charCount: content.length,
  };
}

/**
 * Parse multiple documents and extract their text content.
 * Continues processing even if individual documents fail.
 */
export async function parseDocuments(documents: DocumentData[]): Promise<ParsedDocument[]> {
  const results: ParsedDocument[] = [];

  for (const doc of documents) {
    try {
      results.push(await parseDocument(doc));
    } catch (error) {
      logger.error('DocumentParser', `Failed to parse ${doc.filename}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
