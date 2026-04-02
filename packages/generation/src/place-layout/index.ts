/**
 * Place Layout Generation System
 *
 * Procedural generation system for place layouts:
 * - Layer 1: Shape Generation (BSP, parameterized rooms)
 * - Layer 2: Slot Placement (template-driven positioning via algorithms)
 * - Layer 3: Object Population (LLM-guided object selection from Entity Registry)
 *
 * All slots come from the layout template (LayoutSlot -> GeneratedSlot).
 * The catalog determines which slot purposes have matching objects.
 */

export {
  generatePlaceLayout,
  resolveBackdropSlots,
  mergeTagArrays,
  entityMatchesSlotTags,
  placeGroupedSlotsRoundRobin,
} from './generator.js';
export { detectContext } from './classifier.js';

// Layer exports
export { generateShapeFromTemplate, processLayers } from './layers/shape-generator.js';
export { populateSlots } from './layers/context-populator.js';

// Entity registry
export { loadEntityRegistry, getEntityDefinition, getEntitiesByPurpose } from './object-catalog.js';
export type { EntityWithId } from './object-catalog.js';

// Layout templates
export {
  loadLayoutTemplates,
  getLayoutTemplate,
  getTemplatesForPurpose,
  selectLayoutVariant,
  getChildPlaceSlotsForPurpose,
} from './layout-templates.js';
export type { LayoutSlot, LayoutVariant, LayoutTemplate } from './layout-templates.js';

// Object selector
export { selectObjectForSlot, selectObjectWithoutLlm } from './object-selector.js';

// Type re-exports from @dmnpc/types
export type {
  PlaceLayout,
  GeneratedShape,
  PlaceContext,
  GenerationResult,
  GeneratedSlot,
} from '@dmnpc/types';
