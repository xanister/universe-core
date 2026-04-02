/**
 * Document Storage
 *
 * Service for saving and loading reference documents to/from universe directories.
 */

import { UNIVERSES_DIR } from '@dmnpc/data';
import { writeFile, mkdir, readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '@dmnpc/core/infra/logger.js';
import type { DocumentData } from '../document/document-parser.js';

/**
 * Save documents to a universe's documents directory.
 * Returns an array of relative paths to the saved documents.
 */
export async function saveDocuments(
  universeId: string,
  documents: DocumentData[],
): Promise<string[]> {
  const docsDir = join(UNIVERSES_DIR, universeId, 'documents');
  await mkdir(docsDir, { recursive: true });

  const savedPaths: string[] = [];

  for (const doc of documents) {
    try {
      const filePath = join(docsDir, doc.filename);
      const buffer = Buffer.from(doc.contentBase64, 'base64');
      await writeFile(filePath, buffer);
      savedPaths.push(`documents/${doc.filename}`);
      logger.info('DocumentStorage', `Saved document: ${universeId}/documents/${doc.filename}`);
    } catch (error) {
      logger.error('DocumentStorage', `Failed to save ${doc.filename}`, {
        universeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return savedPaths;
}

/**
 * Load existing documents from a universe's documents directory.
 * Returns an array of DocumentData with filename and base64 content.
 */
export async function loadDocuments(universeId: string): Promise<DocumentData[]> {
  const docsDir = join(UNIVERSES_DIR, universeId, 'documents');

  if (!existsSync(docsDir)) {
    logger.info('DocumentStorage', `No documents directory found for ${universeId}`);
    return [];
  }

  const documents: DocumentData[] = [];

  try {
    const files = await readdir(docsDir);

    for (const filename of files) {
      try {
        const filePath = join(docsDir, filename);
        const content = await readFile(filePath);
        const contentBase64 = content.toString('base64');

        documents.push({
          filename,
          contentBase64,
          size: content.length,
        });

        logger.info('DocumentStorage', `Loaded document: ${universeId}/documents/${filename}`);
      } catch (error) {
        logger.error('DocumentStorage', `Failed to load ${filename}`, {
          universeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('DocumentStorage', `Loaded ${documents.length} documents for ${universeId}`);
  } catch (error) {
    logger.error('DocumentStorage', `Failed to read documents directory for ${universeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return documents;
}

/**
 * List document filenames in a universe's documents directory.
 * Returns just the filenames without loading content.
 */
export async function listDocuments(universeId: string): Promise<string[]> {
  const docsDir = join(UNIVERSES_DIR, universeId, 'documents');

  if (!existsSync(docsDir)) {
    return [];
  }

  try {
    return await readdir(docsDir);
  } catch (error) {
    logger.error('DocumentStorage', `Failed to list documents for ${universeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
