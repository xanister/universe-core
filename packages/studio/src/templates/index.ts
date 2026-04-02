/**
 * Templates Service
 *
 * Provides CRUD operations and generation for template character definitions.
 */

export {
  listTemplateCharacters,
  getTemplateCharacter,
  saveTemplateCharacter,
  deleteTemplateCharacter,
  templateCharacterExists,
} from '@dmnpc/core/stores/template-character-store.js';

export { generateTemplateCharacter, type TemplateGenerationHints } from './template-generator.js';

export { generateTemplateImage, saveTemplateImage } from './template-image-generator.js';
