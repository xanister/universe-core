/**
 * Generator Agent Prompts
 *
 * System and user prompt construction for the agentic universe generator.
 */

import type { WorldBible } from '@dmnpc/types/world';
import type { DataCatalog, GeneratorToolContext, TemplateSummary } from './types.js';
import type { InferredRootPlace } from '../universe-generator.js';

/** Group templates by scale category for readability. */
function categorizeTemplate(t: TemplateSummary): string {
  const cosmicPurposes = ['cosmos', 'star_system', 'planet'];
  const regionPurposes = [
    'city',
    'district',
    'forest',
    'desert',
    'mountain',
    'lake',
    'beach',
    'ruins',
    'harbor',
  ];
  const buildingPurposes = [
    'tavern',
    'inn',
    'shop',
    'residence',
    'castle',
    'fortress',
    'cave',
    'spaceport',
    'harbor',
  ];
  const vesselPurposes = ['sailing_ship', 'asteroid'];
  const roomPurposes = ['cabin', 'kitchen', 'bedroom', 'marketplace'];

  if (t.purposes.some((p) => cosmicPurposes.includes(p))) return 'Cosmic (universe structure)';
  if (t.purposes.some((p) => regionPurposes.includes(p))) return 'Regional (outdoor areas)';
  if (t.purposes.some((p) => buildingPurposes.includes(p))) return 'Buildings (structures)';
  if (t.purposes.some((p) => vesselPurposes.includes(p))) return 'Vessels & special';
  if (t.purposes.some((p) => roomPurposes.includes(p))) return 'Rooms & interiors';
  return 'Other';
}

function formatTemplateLine(t: TemplateSummary): string {
  const desc = t.description ? ` — ${t.description}` : '';
  const slotInfo = t.slotSummary ? ` [${t.slotSummary}]` : '';
  const variants = `${t.variantCount} variant${t.variantCount !== 1 ? 's' : ''}`;
  return `  - "${t.id}": ${t.name} (purposes: [${t.purposes.join(', ')}], ${variants})${desc}${slotInfo}`;
}

function groupTemplatesByCategory(templates: TemplateSummary[]): Map<string, TemplateSummary[]> {
  const groups = new Map<string, TemplateSummary[]>();
  for (const t of templates) {
    const category = categorizeTemplate(t);
    const list = groups.get(category) ?? [];
    list.push(t);
    groups.set(category, list);
  }
  return groups;
}

function formatCatalog(catalog: DataCatalog): string {
  const groups = groupTemplatesByCategory(catalog.templates);

  const templateSections = [...groups.entries()].map(
    ([category, templates]) => `**${category}**\n${templates.map(formatTemplateLine).join('\n')}`,
  );

  const placePurposes = catalog.placePurposes.map((p) => `${p.id} ("${p.label}")`).join(', ');

  return `## DATA CATALOG

### Layout Templates
${templateSections.join('\n\n')}

### Place Purposes
${placePurposes}`;
}

function formatWorldBible(worldBible: WorldBible): string {
  const sections: string[] = ['## WORLD BIBLE'];

  if (worldBible.overview) sections.push(`Overview: ${worldBible.overview}`);
  if (worldBible.themes.length) sections.push(`Themes: ${worldBible.themes.join(', ')}`);
  if (worldBible.tone) sections.push(`Tone: ${worldBible.tone}`);
  if (worldBible.atmosphere) sections.push(`Atmosphere: ${worldBible.atmosphere}`);
  if (worldBible.lore) sections.push(`Lore: ${worldBible.lore}`);

  if (worldBible.places.length > 0) {
    const placeLines = worldBible.places
      .map(
        (p) => `- ${p.name} (purpose: ${p.purpose}, parent: "${p.parentName}"): ${p.description}`,
      )
      .join('\n');
    sections.push(`### Places from Source Material\n${placeLines}`);
  }

  if (worldBible.keyConflicts.length > 0) {
    sections.push(`### Key Conflicts\n${worldBible.keyConflicts.join('; ')}`);
  }

  return sections.join('\n\n');
}

function formatRootInfo(rootInfo: InferredRootPlace): string {
  return `## ROOT PLACE (pre-determined)
- Purpose: ${rootInfo.purpose}
- Label: "${rootInfo.label}"
- Description: ${rootInfo.description}
- Template: "${rootInfo.templateId}"

You MUST create this as your first place using create_place with isRoot true.`;
}

export function buildGeneratorSystemPrompt(ctx: GeneratorToolContext): string {
  const sections: string[] = [];

  sections.push(`You are a world-builder generating a universe for the DMNPC game engine.

A universe has already been created with its metadata (name, races, calendar, etc.). Your job is to build the world structure by creating places (the physical hierarchy).

## HOW GENERATION WORKS

1. **Call plan_generation** first — declare what place hierarchy you intend to build and whether custom templates are needed.
2. **Call create_place** to create places. Start with the root place (isRoot: true), then create additional places as children of existing ones.
3. **Call list_places, find_place, or get_place_details** at any time to inspect what has been created.
4. **Call create_layout_template** only if no existing template fits a place you want to create. This is expensive — prefer existing templates.
5. **Call signal_complete** when done.

## HOW AUTO-GENERATION WORKS

When you call create_place, the layout template automatically generates content from its slot definitions:

- **Child place slots**: Some templates auto-create child places. For example, a "city" template may auto-create a tavern, shops, and residences. These appear in the create_place response as childrenCreated.
- **Object slots**: Templates auto-populate objects (furniture, decorations, containers, exits) based on the place type. You never need to create objects manually.
- **Character slots**: Templates with character-purpose slots (bartender, guard, shopkeeper, etc.) will auto-generate NPCs with appropriate activities, routines, and appearances. Characters are populated after all places are created.

**Key principle**: You only create the structural places that templates DON'T auto-generate. If a city template already creates a tavern child, don't create another tavern manually. Use query_universe to check what was auto-generated before creating additional places.

## IMPORTANT RULES

- The root place and its template are pre-determined (see ROOT PLACE below). Create it first.
- Use existing layout templates whenever possible. Only create new templates for truly novel place types.
- Keep the hierarchy reasonable (3-6 top-level places for a first generation).
- After creating each place, check the childrenCreated response to see what was auto-generated. Use list_places or get_place_details if you need to review the full hierarchy.
- Do NOT duplicate auto-generated places. If create_place already created a tavern as a child, don't create another one.`);

  sections.push(formatCatalog(ctx.catalog));
  sections.push(formatRootInfo(ctx.rootInfo));

  if (ctx.worldBible) {
    sections.push(formatWorldBible(ctx.worldBible));
  }

  if (ctx.templateIds && ctx.templateIds.length > 0) {
    sections.push(
      `## PRE-SELECTED TEMPLATE CHARACTERS\nTemplate character IDs that will be created automatically after generation: ${ctx.templateIds.join(', ')}. You do not need to create these.`,
    );
  }

  return sections.join('\n\n');
}

export function buildUserPrompt(ctx: GeneratorToolContext): string {
  const universeName = ctx.universeContext.universe.name;
  const universeDesc = ctx.universeContext.universe.description;

  const hintParts: string[] = [];
  if (ctx.hints.genre) hintParts.push(`Genre: ${ctx.hints.genre}`);
  if (ctx.hints.era) hintParts.push(`Era: ${ctx.hints.era}`);
  if (ctx.hints.tone) hintParts.push(`Tone: ${ctx.hints.tone}`);
  if (ctx.hints.keyElements?.length)
    hintParts.push(`Key elements: ${ctx.hints.keyElements.join(', ')}`);

  const hintsSection = hintParts.length > 0 ? `\n\nCreation hints:\n${hintParts.join('\n')}` : '';

  return `Generate the world for "${universeName}".

${universeDesc}${hintsSection}

Start by calling plan_generation, then create the root place, then any additional structural places. Use list_places to check what was auto-generated before adding more places. Signal complete when done.`;
}
