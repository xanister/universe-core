/**
 * Template Character Store
 *
 * Handles CRUD operations for template character definitions.
 * Templates are persistent character blueprints stored independently of universes.
 */

import { readdir, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { TemplateCharacterDefinition } from '@dmnpc/types/npc';
import { TEMPLATES_DIR } from '@dmnpc/data';
import { logger } from '../infra/logger.js';
import { readJsonFile } from '../infra/read-json-file.js';

/**
 * Load all template character definitions from the templates/characters directory.
 */
export async function listTemplateCharacters(): Promise<TemplateCharacterDefinition[]> {
  try {
    if (!existsSync(TEMPLATES_DIR)) {
      logger.warn('TemplateStore', `Templates directory does not exist: ${TEMPLATES_DIR}`);
      return [];
    }

    const files = await readdir(TEMPLATES_DIR);
    const templates: TemplateCharacterDefinition[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = join(TEMPLATES_DIR, file);
        const template = await readJsonFile<TemplateCharacterDefinition>(filePath);

        // Validate required fields
        if (
          template.id &&
          template.label &&
          template.description &&
          template.short_description &&
          template.personality
        ) {
          templates.push(template);
        } else {
          logger.warn('TemplateStore', `Template file missing required fields: ${file}`);
        }
      } catch (error) {
        logger.warn(
          'TemplateStore',
          `Failed to load template file: ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }

    logger.info('TemplateStore', `Loaded ${templates.length} template character definitions`);
    return templates;
  } catch (error) {
    logger.error('TemplateStore', 'Failed to list template characters', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get a specific template character definition by ID.
 */
export async function getTemplateCharacter(
  templateId: string,
): Promise<TemplateCharacterDefinition | null> {
  try {
    const filePath = join(TEMPLATES_DIR, `${templateId}.json`);

    if (!existsSync(filePath)) {
      return null;
    }

    return await readJsonFile<TemplateCharacterDefinition>(filePath);
  } catch (error) {
    logger.error('TemplateStore', `Failed to load template: ${templateId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Save a template character definition to the filesystem.
 * Creates or updates the template JSON file.
 */
export async function saveTemplateCharacter(template: TemplateCharacterDefinition): Promise<void> {
  if (
    !template.id ||
    !template.label ||
    !template.description ||
    !template.short_description ||
    !template.personality
  ) {
    throw new Error(
      'Template must have id, label, description, short_description, personality, and physicalTraits',
    );
  }

  // Validate ID format
  if (!template.id.startsWith('TEMPLATE_')) {
    throw new Error('Template ID must start with TEMPLATE_');
  }

  // Ensure templates directory exists
  if (!existsSync(TEMPLATES_DIR)) {
    await mkdir(TEMPLATES_DIR, { recursive: true });
  }

  const filePath = join(TEMPLATES_DIR, `${template.id}.json`);
  const content = JSON.stringify(template, null, 2) + '\n';

  await writeFile(filePath, content, 'utf-8');
  logger.info('TemplateStore', `Saved template character: ${template.id}`);
}

/**
 * Delete a template character definition from the filesystem.
 */
export async function deleteTemplateCharacter(templateId: string): Promise<boolean> {
  const filePath = join(TEMPLATES_DIR, `${templateId}.json`);

  if (!existsSync(filePath)) {
    logger.warn('TemplateStore', `Template not found for deletion: ${templateId}`);
    return false;
  }

  await unlink(filePath);
  logger.info('TemplateStore', `Deleted template character: ${templateId}`);
  return true;
}

/**
 * Check if a template character exists.
 */
export function templateCharacterExists(templateId: string): boolean {
  const filePath = join(TEMPLATES_DIR, `${templateId}.json`);
  return existsSync(filePath);
}
