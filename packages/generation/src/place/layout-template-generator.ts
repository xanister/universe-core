/**
 * Layout Template Generator
 *
 * Uses a 2-pass LLM pipeline to generate LayoutTemplates from user prompts.
 *
 * Pass 1 (Structure): Generates the full template skeleton — layers, slots,
 * algorithms, dimensions — with category-level aesthetic choices
 * (wallStyleCategory, floorType) instead of specific IDs.
 *
 * Pass 2 (Aesthetics): Resolves category-level choices to specific IDs from
 * filtered catalogs (e.g. "brick" → "brick_herringbone_red", "wood_planks" → [0, 1, 2]).
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { WALL_STYLES_FULL_PATH, ACTIVITIES_REGISTRY_PATH } from '@dmnpc/data';
import { loadPurposeIds, loadPurposeDefinition } from '../purpose-loader.js';
import type { LayoutTemplate } from '@dmnpc/types/world';
import {
  PLACEMENT_ALGORITHMS,
  SLOT_DISTRIBUTIONS,
  TERRAIN_TAGS,
  LAYER_TYPES,
  LAYER_TYPE_META,
  PLACE_SCALES,
  ENVIRONMENT_PRESET_NAMES,
  isEnclosed,
} from '@dmnpc/types/world';

export interface GenerateLayoutTemplateParams {
  /** User's description of the desired layout (required). */
  prompt: string;
  /** Optional environment type hint. */
  environmentType?: 'interior' | 'exterior' | 'space' | 'underwater';
  /** Optional size hint. */
  size?: 'small' | 'medium' | 'large';
}

export interface GenerateLayoutTemplateResult {
  /** The generated LayoutTemplate (without id). */
  template: LayoutTemplate;
  /** Suggested template ID (snake_case). */
  suggestedId: string;
}

/** Per-variant aesthetic hint from Pass 1. */
interface AestheticHint {
  variantId: string;
  wallStyleCategory: string | null;
  floorType: string | null;
}

/** Intermediate result from Pass 1 — includes category-level aesthetic hints. */
interface Pass1Result {
  suggestedId: string;
  template: LayoutTemplate;
  /** Category-level aesthetic choices per variant. */
  aestheticHints: AestheticHint[];
}

// ============================================================================
// Reference Data
// ============================================================================

/**
 * Terrain tileset IDs commonly used in templates, grouped by environment.
 * These are the IDs the LLM should choose from for terrain layers.
 */
const TERRAIN_TILESETS = {
  interior: {
    floors: 'floor-interior',
    scifiFloors: 'floor-scifi',
    scifiWalls: 'wall-scifi',
  },
  exterior: {
    ocean: 'terrain-ocean',
    grass: 'terrain-grass',
    grassDark: 'terrain-grass-dark',
    cobbleDark: 'terrain-cobble-dark',
    cobbleTan: 'terrain-cobble-tan',
    cobbleSlate: 'terrain-cobble-slate',
    cobbleBrownDark: 'terrain-cobble-brown-dark',
    cobbleBlack: 'terrain-cobble-black',
    cobbleGray: 'terrain-cobble-gray',
    dirtPath: 'terrain-dirt-path',
    beach: 'terrain-beach',
  },
  space: {
    starfield: 'terrain-grass-dark',
    nebulaPurple: 'terrain-nebula-purple',
    nebulaBlue: 'terrain-nebula-blue',
    scifiSpace: 'space-void-scifi',
  },
};

/** Common entrance sprite IDs the LLM can choose from. */
const ENTRANCE_SPRITE_IDS = [
  'door_wooden',
  'village_house_tan_thatch',
  'small_walled_town',
  'stone_arch_ruins',
  'world_map_pond',
  'world_map_mountain',
  'world_map_temple',
  'world_map_dock',
  'world_map_fortress',
  'star_sun',
  'planet_terran',
  'asteroid',
  'spaceport',
  'space_station_hub',
  'space_station_outpost',
];

// ============================================================================
// Character Slot Dependencies
// ============================================================================

interface ActivityEntry {
  id: string;
  steps: Array<{ targetPurpose: string; weight: number }>;
}

interface ActivitiesRegistry {
  activities: ActivityEntry[];
}

/**
 * Build a map of character purpose → required object purpose.
 * For each character purpose with a defaultActivityId, find the highest-weight
 * non-_wander step's targetPurpose. That's the object slot the character needs.
 */
export function loadCharacterSlotDependencies(): Map<string, string> {
  const registry = readJsonFileSync<ActivitiesRegistry>(ACTIVITIES_REGISTRY_PATH);
  const activityMap = new Map(registry.activities.map((a) => [a.id, a]));
  const deps = new Map<string, string>();

  const purposeIds = loadPurposeIds();
  for (const pid of purposeIds) {
    const def = loadPurposeDefinition(pid);
    if (!def || def.category !== 'character' || !def.defaultActivityId) continue;
    const activity = activityMap.get(def.defaultActivityId);
    if (!activity) continue;
    const nonWander = activity.steps.filter((s) => s.targetPurpose !== '_wander');
    if (nonWander.length === 0) continue;
    const primary = nonWander.reduce((best, s) => (s.weight > best.weight ? s : best));
    deps.set(pid, primary.targetPurpose);
  }

  return deps;
}

// ============================================================================
// Wall Style Catalog
// ============================================================================

interface WallStyleEntry {
  id: string;
  name: string;
  category: string;
}

let cachedWallStyleCatalog: WallStyleEntry[] | null = null;

/** Load wall style catalog (id, name, category) from wall-styles-full.json. */
export function loadWallStyleCatalog(): WallStyleEntry[] {
  if (cachedWallStyleCatalog && process.env['NODE_ENV'] === 'production')
    return cachedWallStyleCatalog;

  const raw =
    readJsonFileSync<Array<{ id: string; name: string; category: string }>>(WALL_STYLES_FULL_PATH);
  cachedWallStyleCatalog = raw.map((s) => ({ id: s.id, name: s.name, category: s.category }));
  return cachedWallStyleCatalog;
}

/** Get all unique wall style categories with representative example IDs. */
export function getWallStyleCategories(): Array<{
  category: string;
  count: number;
  examples: string[];
}> {
  const catalog = loadWallStyleCatalog();
  const byCategory = new Map<string, string[]>();
  for (const entry of catalog) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry.id);
    byCategory.set(entry.category, list);
  }
  return [...byCategory.entries()]
    .map(([category, ids]) => ({
      category,
      count: ids.length,
      examples: ids.slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Get all wall style IDs for a given category. */
export function getWallStyleIdsForCategory(category: string): string[] {
  return loadWallStyleCatalog()
    .filter((s) => s.category === category)
    .map((s) => s.id);
}

// ============================================================================
// Floor Tile Catalog
// ============================================================================

/**
 * Interior floor tile types with their tile indices per tileset.
 * Sourced from lpc-interior manifest and scifi-interior manifest.
 */
const LPC_FLOOR_TYPES: Record<string, { description: string; indices: number[] }> = {
  wood_planks: { description: 'Light wooden plank flooring', indices: [0, 1, 2, 3] },
  wood_dark: { description: 'Dark stained wooden planks', indices: [4, 5] },
  stone_floor: { description: 'Gray stone slab flooring', indices: [16, 17, 18] },
  brick_floor: { description: 'Red/brown brick flooring', indices: [32, 33] },
  tile_floor: { description: 'Ceramic or clay tile', indices: [48, 49] },
  carpet_red: { description: 'Rich red carpet', indices: [64] },
  carpet_blue: { description: 'Blue carpet', indices: [65] },
  carpet_green: { description: 'Green carpet', indices: [66] },
};

const SCIFI_FLOOR_TYPES: Record<string, { description: string; indices: number[] }> = {
  metal_deck: {
    description: 'Standard gray/brown metal deck plates — rooms, hangars, cargo bays',
    indices: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  },
  blue_panel: {
    description: 'Blue-tinted steel panels — corridors, hallways',
    indices: [0, 1, 2, 3, 14, 15, 16, 17],
  },
  teal_panel: {
    description: 'Teal/cyan checkered panels — medical bays, laboratories',
    indices: [51, 52, 53],
  },
  dark_metal: {
    description: 'Very dark metal panels — engineering, maintenance tunnels',
    indices: [66, 67, 83, 84, 85],
  },
  light_panel: {
    description: 'Light-colored panels — offices, bridge, crew quarters',
    indices: [70, 71, 72, 73, 74, 75],
  },
};

/** Get floor tile indices for a given floor type and tileset. */
export function getFloorTileIndices(tilesetId: string, floorType: string): number[] | null {
  if (tilesetId === 'floor-interior') {
    if (!(floorType in LPC_FLOOR_TYPES)) return null;
    return LPC_FLOOR_TYPES[floorType].indices;
  }
  if (tilesetId === 'floor-scifi') {
    if (!(floorType in SCIFI_FLOOR_TYPES)) return null;
    return SCIFI_FLOOR_TYPES[floorType].indices;
  }
  return null;
}

// ============================================================================
// Size presets
// ============================================================================

const SIZE_PRESETS = {
  small: {
    interior: { width: { min: 18, max: 40 }, height: { min: 16, max: 35 } },
    exterior: { width: { min: 40, max: 100 }, height: { min: 35, max: 90 } },
  },
  medium: {
    interior: { width: { min: 25, max: 70 }, height: { min: 22, max: 60 } },
    exterior: { width: { min: 80, max: 200 }, height: { min: 70, max: 180 } },
  },
  large: {
    interior: { width: { min: 40, max: 100 }, height: { min: 35, max: 90 } },
    exterior: { width: { min: 150, max: 350 }, height: { min: 130, max: 300 } },
  },
} as const;

// ============================================================================
// Pass 1: Structure Prompt
// ============================================================================

function buildStructureSystemPrompt(): string {
  const purposeIds = loadPurposeIds();
  const wallCategories = getWallStyleCategories();
  const charDeps = loadCharacterSlotDependencies();

  const wallCategoryGuide = wallCategories
    .map((c) => `- "${c.category}" (${c.count} styles) — e.g. ${c.examples.join(', ')}`)
    .join('\n');

  const lpcFloorGuide = Object.entries(LPC_FLOOR_TYPES)
    .map(([key, val]) => `- "${key}" — ${val.description} (tiles: ${val.indices.join(', ')})`)
    .join('\n');

  const scifiFloorGuide = Object.entries(SCIFI_FLOOR_TYPES)
    .map(([key, val]) => `- "${key}" — ${val.description} (tiles: ${val.indices.join(', ')})`)
    .join('\n');

  return `You are a layout template designer for a 2D top-down RPG game engine. You generate JSON layout template definitions that describe how to procedurally build places in the game world.

## AVAILABLE PURPOSES
These are the valid purpose IDs you may use in slot definitions and the template's purposes array:
${purposeIds.join(', ')}

Purpose categories:
- Object purposes: seating, sleeping, storage, table, decoration, workspace, anchor, exit, vessel_helm, airlock, gangplank, staging_hire, staging_construction, staging_construction_door
- Place purposes: cosmos, star_system, planet, asteroid, tavern, shop, weapon_shop, temple, harbor, station, spaceport, residence, workshop, warehouse, forest, mountain, cave, lake, ruins, bedroom, kitchen, storage_room, cabin, cargo_hold, spaceship, sailing_ship
- Character purposes: player, bartender, guard, merchant, captain, helmsman

## PLACEMENT ALGORITHMS
${(PLACEMENT_ALGORITHMS as readonly string[]).join(', ')}

Algorithm guide:
- "in_wall" — doors/exits placed on wall segments
- "random_valid" — scattered on passable floor tiles (general purpose)
- "against_wall" — floor tiles adjacent to walls (beds, shelves)
- "near_slot" — within 2 tiles of another slot (requires nearPurpose)
- "center_floor" — non-wall tiles weighted toward room center (rugs, focal points)
- "on_land" — land tiles (for outdoor maps)
- "on_coast" — land tiles adjacent to water
- "on_water" — water tiles
- "along_road" — non-road tiles adjacent to road/path tiles, facing toward road (buildings, stalls in villages/cities)
- "road_intersection" — near road junction nodes (town squares, signposts)
- "road_end" — near road endpoint/branch nodes (gates, wells)

## TERRAIN LAYER TYPES
${(LAYER_TYPES as readonly string[]).join(', ')}

For most templates you only need these:
- "fill" — base layer covering entire map (use for ground, ocean, void)
- "rectangle" — rectangular room shape (interiors)
- "l_shape" — L-shaped room (interiors, for variety)
- "wall" — auto-generates walls around room shapes. Uses "wall-interior" tileset with fill=[] (tiles come from wallStyle).
- "wall_face" — south-facing wall texture (decorative). Requires wallLayerId (ID of the "wall" layer) and roomLayerId (ID of the room shape layer).
- "noise_patch" — organic noise-based terrain patches (continents, clearings, forests)
- "coastline" — beach/shore transition strip at the boundary between a water layer and adjacent land. Requires sourceLayerId (ID of the water layer) and beachWidth (1-3 tiles). Uses blob-47 autotile. Set autotileAgainst to the land layer ID so edges only appear on the water side (inland edge blends seamlessly). Place AFTER the water layer. Good for harbors, coastal towns, docks. Use tilesetId "terrain-beach".
- "road" — connected road network with spine + branches. Requires roadWidth (2-5), branchCount (0-6), curvature (0-1). Uses blob-47 autotile. Use for villages, cities, towns.
- "path" — single winding trail, always 1-tile wide. Requires curvature (0-1). Uses blob-47 autotile.
- "town_center" — circular clearing at the primary road intersection. Requires radius (3-6). Must have a road/path layer before it. Uses blob-47 autotile.

## RENDER ORDER CONVENTIONS
Layer renderOrder determines visual stacking. Follow these conventions:
- fill, rectangle, l_shape, t_shape: 0
- noise_patch (terrain): 0, 1, or 2 (higher layers draw over lower)
- road, path: 1 (above base terrain)
- town_center: 2 (above roads)
- wall_face: 1
- wall: 2000 (north-facing overhead passthrough is automatic)
- sprite_backdrop: 1
- noise_patch (space nebulas): 5000-5001

## TERRAIN TAGS
${(TERRAIN_TAGS as readonly string[]).join(', ')}

Common patterns:
- Interior rooms: "land" terrain with "unblocks", walls with "wall" terrain and "blocks"
- Exterior (planet): "water" fill that "blocks", "land" noise_patch that "unblocks"
- Forest: "dense_forest" fill that "blocks", "land" clearing that "unblocks"
- Space: "void" fill, nebula noise patches

## TERRAIN TILESETS
Interior floor/wall tilesets:
- "floor-interior" — standard interior floors (see FLOOR TYPES below for tile indices)
- "wall-interior" — interior wall autotile tileset (used with "wall" layer type, fill=[], wallStyle picks the visual)
- "floor-scifi" — sci-fi styled floors (see FLOOR TYPES below for tile indices)
- "wall-scifi" — sci-fi styled walls (tile 0 for wall)

Exterior terrain tilesets (blob47 autotile format, use fill=[46,47,48] for variation):
- "terrain-ocean" — deep water
- "terrain-grass" — green grass
- "terrain-grass-dark" — dark forest grass
- "terrain-cobble-dark" — dark stone (ruins)
- "terrain-cobble-tan" — tan stone paths
- "terrain-cobble-slate" — slate rock (mountains, caves)
- "terrain-cobble-brown-dark" — brown rock (caves)
- "terrain-cobble-black" — black rock (asteroids)
- "terrain-cobble-gray" — gray rock
- "terrain-dirt-path" — dirt paths
- "terrain-beach" — sandy beach

Space tilesets:
- "terrain-grass-dark" — space background
- "terrain-nebula-purple" — purple nebula patches
- "terrain-nebula-blue" — blue nebula patches

## WALL STYLE CATEGORIES
Wall styles control the visual appearance of "wall" layers. Pick a CATEGORY that fits the place. A second pass will select a specific style from the category.
${wallCategoryGuide}

## INTERIOR FLOOR TYPES
Floor types control the tile indices used in room shape layers (rectangle, l_shape). Pick a TYPE that fits the place. A second pass will finalize indices.

For "floor-interior" tileset:
${lpcFloorGuide}

For "floor-scifi" tileset:
${scifiFloorGuide}

For exterior/blob47 tilesets: always use fill=[46,47,48] (autotile center tiles with variation). No floorType needed.

## ENVIRONMENT PRESETS
${(ENVIRONMENT_PRESET_NAMES as readonly string[]).join(', ')}

Each environment type maps to a config:
- interior: { type: "interior", hasWeather: false, temperature: { enabled: true, base: 18, modifiersApply: false } }
- exterior: { type: "exterior", hasWeather: true, temperature: { enabled: true, base: null, modifiersApply: true } }
- space: { type: "space", hasWeather: false, temperature: { enabled: false, base: null, modifiersApply: false } }
- underwater: { type: "underwater", hasWeather: false, temperature: { enabled: true, base: 4, modifiersApply: false } }

## ENTRANCE SPRITES
Choose from: ${ENTRANCE_SPRITE_IDS.join(', ')}
Pick the sprite that best represents what this place looks like from outside.

## SCALE
${(PLACE_SCALES as readonly string[]).join(', ')}
- "feet" — interior rooms, buildings (typical: 20-100 tiles)
- "miles" — outdoor areas, planets (typical: 80-350 tiles)
- "au" — star systems
- "lightyears" — cosmos/galaxy scale

## RULES
1. Every variant SHOULD have a slot with purpose "exit" and algorithm "in_wall" (this is the entrance/exit). Use "min": 0 since exits are optional.
2. Terrain layers MUST include at least one layer that "unblocks" (the walkable floor).
3. Interior templates: use "rectangle" or "l_shape" for room + "wall" for walls. Add "wall_face" for south-facing wall texture.
4. Exterior templates: use "fill" for base terrain (blocks) + "noise_patch" for walkable areas (unblocks).
5. Slot min/max: BOTH are required. min is minimum count (use 0 for optional slots, 1 for required slots), max is maximum count. Set to null when not applicable.
6. nearPurpose is REQUIRED on every slot — set to the target purpose string when algorithm is "near_slot", set to null otherwise.
7. The template's "purposes" array should contain the place-category purpose ID(s) this template serves.
8. Variant weights control selection probability. Higher weight = more likely.
9. characterScale defaults to 1. timeScale defaults to 1.
10. defaultBlocked: set to true when the layout should start fully blocked (e.g. exterior maps where floor layers carve out walkable areas). Set to false for interiors where room shapes define the walkable area. Most templates use false.
11. ALL terrain layer fields are required including shapePreset, autotilePreset, autotileAgainst, withinTerrain. For NON-noise_patch layers, set all four to null.
12. For noise_patch layers: set shapePreset to one of: "continent", "island", "clearing", "patches", "scattered", "nebula", "sub_nebula". Set autotilePreset to "canonical" and autotileAgainst to the ID of a sibling layer defined in the SAME variant (typically the fill/base layer). WRONG: autotileAgainst: "land" (that's a terrain TAG). RIGHT: autotileAgainst: "canopy" (that's a layer ID).
13. For noise_patch layers: set withinTerrain to null unless the patch should only appear within another layer. When set, withinTerrain MUST be the ID of a sibling layer defined in the SAME variant. WRONG: withinTerrain: "land" (terrain tag). RIGHT: withinTerrain: "continent" (layer ID).
14. "wall" layers: use tilesetId "wall-interior" (or "wall-scifi"), fill=[] (wall tiles come from wallStyle autotile, not fill array). Set wallStyle to null — a second pass will assign it from the wallStyleCategory.
15. "wall_face" layers REQUIRE wallLayerId (the ID of your "wall" layer) and roomLayerId (the ID of your room shape layer). Set renderOrder to 1.
16. autotileAgainst MUST reference a layer ID defined in the same variant (typically the "fill" or base layer).
17. Variant IDs must be generic labels: use "A", "B", "C", etc. Variants are cosmetic alternatives to avoid repetition — every variant of a template MUST be interchangeable in the same context. All variants must share the same slot types/counts, dimension ranges, and overall character. They differ only in arrangement (road layout, room shape, furniture positions) so generated places don't all look identical. Do NOT give variants different wealth levels, different building compositions, or different slot types — that would produce incongruent results when the world builder expects a specific kind of place. Do NOT use semantic names like "sloop", "shuttle", "captains_quarters" — the place type belongs in the template's name/purposes, not in variant IDs.
18. Character slots REQUIRE matching object slots for their work activities. If you add a character slot, you MUST also add the object slot it needs (see CHARACTER SLOT DEPENDENCIES below).
19. For "road" layers: set roadWidth (2-5), branchCount (0-6), curvature (0-1), autotilePreset to "canonical", autotileAgainst to the fill/base layer ID. Use tilesetId "terrain-dirt-path" or "terrain-cobble-tan". Set avoidLayerIds to the IDs of any sibling layers with terrain "water" (e.g. ["ocean", "river"]) — use [] if no water layers exist. Set shapePreset, withinTerrain, wallStyle, wallLayerId, roomLayerId, radius to null.
20. For "path" layers: set curvature (0-1), autotilePreset to "canonical", autotileAgainst to the fill/base layer ID. Same tileset guidance as road. Set avoidLayerIds to the IDs of any sibling layers with terrain "water" — use [] if no water layers exist. Set shapePreset, withinTerrain, wallStyle, wallLayerId, roomLayerId, roadWidth, branchCount, radius to null.
21. For "town_center" layers: set radius (3-6), autotilePreset to "canonical", autotileAgainst to the fill/base layer ID. Same tileset guidance as road. Requires a road or path layer before it. Set shapePreset, withinTerrain, wallStyle, wallLayerId, roomLayerId, roadWidth, branchCount, curvature to null.
22. Village/city/town templates SHOULD use "road" or "path" layers with "along_road" placement for buildings and stalls, and "road_intersection" or "road_end" for focal points.
23. For "coastline" layers: set sourceLayerId to the ID of the water layer (must be defined in the SAME variant), beachWidth (1-3), autotilePreset to "canonical", autotileAgainst to the land/ground layer ID (so the inland edge blends seamlessly — edges only appear on the water side). Use tilesetId "terrain-beach". Set shapePreset, withinTerrain, wallStyle, wallLayerId, roomLayerId, roadWidth, branchCount, curvature, radius to null. The coastline layer should appear AFTER the water layer. Coastal templates need: fill(blocks) → noise_patch water(blocks) → noise_patch land(unblocks) → coastline(unblocks, autotileAgainst=land layer).

## CHARACTER SLOT DEPENDENCIES
When you include a character-purpose slot, you MUST also include the object-purpose slot it needs for its work activity in the same variant:
${[...charDeps.entries()].map(([char, obj]) => `- "${char}" requires a "${obj}" object slot`).join('\n')}
If a character slot's required object slot is missing, the template will fail validation.

## EXAMPLE TEMPLATES

IMPORTANT: All terrain layer fields (including shapePreset, autotilePreset, autotileAgainst, withinTerrain) are REQUIRED. Set them to null for non-noise_patch layers.
IMPORTANT: All slot fields (including min, max) are REQUIRED. Set them to null when not applicable. Use min=1 for guaranteed slots, min=0 for optional slots.

### Interior (Tavern)
{
  "name": "Tavern",
  "description": "A drinking establishment",
  "purposes": ["tavern"],
  "spriteId": "village_house_tan_thatch",
  "characterScale": 1,
  "timeScale": 1,
  "variants": [{
    "id": "A",
    "scale": "feet",
    "environment": { "type": "interior", "hasWeather": false, "temperature": { "enabled": true, "base": 18, "modifiersApply": false } },
    "width": { "min": 30, "max": 40 },
    "height": { "min": 25, "max": 50 },
    "description": "A small tavern with wooden floors and brick walls",
    "weight": 2,
    "defaultBlocked": false,
    "terrainLayers": [
      { "id": "room", "type": "l_shape", "tilesetId": "floor-interior", "renderOrder": 0, "blocking": "unblocks", "terrain": "land", "fill": [0, 1, 2, 3], "procedural": false, "shapePreset": null, "autotilePreset": null, "autotileAgainst": null, "withinTerrain": null, "wallStyle": null },
      { "id": "walls", "type": "wall", "tilesetId": "wall-interior", "renderOrder": 2000, "blocking": "blocks", "terrain": "wall", "fill": [], "procedural": false, "shapePreset": null, "autotilePreset": null, "autotileAgainst": null, "withinTerrain": null, "wallStyle": null },
      { "id": "wall_face", "type": "wall_face", "tilesetId": "wall-interior", "renderOrder": 1, "blocking": null, "terrain": "wall", "fill": [], "procedural": false, "shapePreset": null, "autotilePreset": null, "autotileAgainst": null, "withinTerrain": null, "wallStyle": null, "wallLayerId": "walls", "roomLayerId": "room" }
    ],
    "slots": [
      { "purpose": "exit", "positionAlgorithm": "in_wall", "distribution": "even", "min": 0, "max": 1, "nearPurpose": null, "requiredTags": null, "forbiddenTags": null, "inheritableTags": null },
      { "purpose": "table", "positionAlgorithm": "random_valid", "distribution": "even", "min": 0, "max": 3, "nearPurpose": null, "requiredTags": null, "forbiddenTags": null, "inheritableTags": null },
      { "purpose": "seating", "positionAlgorithm": "random_valid", "distribution": "even", "min": 0, "max": 6, "nearPurpose": null, "requiredTags": null, "forbiddenTags": null, "inheritableTags": null },
      { "purpose": "workspace", "positionAlgorithm": "random_valid", "distribution": "even", "min": 1, "max": 1, "nearPurpose": null, "requiredTags": null, "forbiddenTags": null, "inheritableTags": null },
      { "purpose": "bartender", "positionAlgorithm": "near_slot", "distribution": "even", "min": 1, "max": 1, "nearPurpose": "workspace", "requiredTags": null, "forbiddenTags": null, "inheritableTags": null }
    ]
  }]
}

aestheticHints for the above: [{ "variantId": "A", "wallStyleCategory": "brick", "floorType": "wood_planks" }]

### Exterior (Forest)
{
  "name": "Forest",
  "description": "A wooded wilderness",
  "purposes": ["forest"],
  "spriteId": "tree_canopy_small",
  "characterScale": 1,
  "timeScale": 1,
  "variants": [{
    "id": "A",
    "scale": "feet",
    "environment": { "type": "exterior", "hasWeather": true, "temperature": { "enabled": true, "base": null, "modifiersApply": true } },
    "width": { "min": 80, "max": 200 },
    "height": { "min": 70, "max": 180 },
    "description": "A dense forest with clearings",
    "weight": 1,
    "defaultBlocked": true,
    "terrainLayers": [
      { "id": "canopy", "type": "fill", "tilesetId": "terrain-grass-dark", "renderOrder": 0, "blocking": "blocks", "terrain": "dense_forest", "fill": [46, 47, 48], "procedural": false, "shapePreset": null, "autotilePreset": null, "autotileAgainst": null, "withinTerrain": null, "wallStyle": null },
      { "id": "clearing", "type": "noise_patch", "tilesetId": "terrain-grass", "renderOrder": 1, "blocking": "unblocks", "terrain": "land", "fill": [46, 47, 48], "procedural": false, "shapePreset": "clearing", "autotilePreset": "canonical", "autotileAgainst": "canopy", "withinTerrain": null, "wallStyle": null }
    ],
    "slots": [
      { "purpose": "exit", "positionAlgorithm": "in_wall", "distribution": "even", "min": 0, "max": 1, "nearPurpose": null, "requiredTags": null, "forbiddenTags": null, "inheritableTags": null },
      { "purpose": "decoration", "positionAlgorithm": "random_valid", "distribution": "even", "min": 0, "max": 4, "nearPurpose": null, "requiredTags": null, "forbiddenTags": null, "inheritableTags": null }
    ]
  }]
}

aestheticHints for the above: [{ "variantId": "A", "wallStyleCategory": null, "floorType": null }]

Generate a LayoutTemplate that matches the user's description. Be creative with slot composition — think about what objects, NPCs, and child places belong in this type of location. Also provide aestheticHints for each variant to guide visual style selection.`;
}

function buildStructureUserPrompt(params: GenerateLayoutTemplateParams): string {
  let prompt = params.prompt;

  if (params.environmentType) {
    prompt += `\n\nEnvironment type: ${params.environmentType}`;
  }
  if (params.size) {
    prompt += `\nApproximate size: ${params.size}`;
  }

  return prompt;
}

// ============================================================================
// Pass 1: Structure Schema
// ============================================================================

function buildStructureSchema(): object {
  const placementAlgorithms = [...PLACEMENT_ALGORITHMS];
  const slotDistributions = [...SLOT_DISTRIBUTIONS];
  const terrainTags = [...TERRAIN_TAGS];
  const layerTypes = [
    'fill',
    'rectangle',
    'l_shape',
    't_shape',
    'wall',
    'wall_face',
    'noise_patch',
    'coastline',
    'road',
    'path',
    'town_center',
  ];
  const scales = [...PLACE_SCALES];
  const envTypes = [...ENVIRONMENT_PRESET_NAMES];

  const allTerrainTilesetIds = [
    ...Object.values(TERRAIN_TILESETS.interior),
    ...Object.values(TERRAIN_TILESETS.exterior),
    ...Object.values(TERRAIN_TILESETS.space),
  ];

  const noisePresets = [
    'continent',
    'island',
    'clearing',
    'patches',
    'scattered',
    'nebula',
    'sub_nebula',
  ];
  const autotilePresets = ['canonical'];

  const wallStyleCategories = getWallStyleCategories().map((c) => c.category);

  const lpcFloorTypeKeys = Object.keys(LPC_FLOOR_TYPES);
  const scifiFloorTypeKeys = Object.keys(SCIFI_FLOOR_TYPES);
  const allFloorTypes = [...lpcFloorTypeKeys, ...scifiFloorTypeKeys];

  return {
    type: 'object',
    properties: {
      suggestedId: {
        type: 'string',
        description: 'Snake_case ID for this template (e.g. "blacksmith_shop", "space_hangar")',
      },
      template: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable display name' },
          description: { type: 'string', description: 'Brief description of this place type' },
          purposes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Place-category purpose IDs this template serves',
          },
          spriteId: {
            type: 'string',
            enum: ENTRANCE_SPRITE_IDS,
            description: 'Sprite ID for the place entrance/icon',
          },
          characterScale: { type: 'number' },
          timeScale: { type: 'number' },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                scale: { type: 'string', enum: scales },
                environment: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: envTypes },
                    hasWeather: { type: 'boolean' },
                    temperature: {
                      type: 'object',
                      properties: {
                        enabled: { type: 'boolean' },
                        base: { type: ['number', 'null'] },
                        modifiersApply: { type: 'boolean' },
                      },
                      required: ['enabled', 'base', 'modifiersApply'],
                      additionalProperties: false,
                    },
                  },
                  required: ['type', 'hasWeather', 'temperature'],
                  additionalProperties: false,
                },
                width: {
                  type: 'object',
                  properties: {
                    min: { type: 'number' },
                    max: { type: 'number' },
                  },
                  required: ['min', 'max'],
                  additionalProperties: false,
                },
                height: {
                  type: 'object',
                  properties: {
                    min: { type: 'number' },
                    max: { type: 'number' },
                  },
                  required: ['min', 'max'],
                  additionalProperties: false,
                },
                description: { type: 'string' },
                weight: { type: 'number' },
                defaultBlocked: {
                  type: 'boolean',
                  description:
                    'Initial blocked state. true = all tiles start blocked (exterior maps). false = all tiles start unblocked (interiors).',
                },
                padding: {
                  type: 'number',
                  description:
                    'Minimum distance in tiles from the map edge for slot placement. 0 = no extra buffer (default). Use 1-3 for layouts that need breathing room at edges.',
                },
                terrainLayers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string', enum: layerTypes },
                      tilesetId: { type: 'string', enum: allTerrainTilesetIds },
                      renderOrder: { type: 'number' },
                      blocking: { type: ['string', 'null'], enum: ['blocks', 'unblocks', null] },
                      terrain: { type: 'string', enum: terrainTags },
                      fill: { type: 'array', items: { type: 'number' } },
                      procedural: { type: 'boolean' },
                      // noise_patch fields — nullable for non-noise layers
                      shapePreset: { type: ['string', 'null'], enum: [...noisePresets, null] },
                      autotilePreset: {
                        type: ['string', 'null'],
                        enum: [...autotilePresets, null],
                      },
                      autotileAgainst: { type: ['string', 'null'] },
                      withinTerrain: { type: ['string', 'null'] },
                      wallStyle: { type: ['string', 'null'] },
                      // wall_face layer dependencies
                      wallLayerId: { type: ['string', 'null'] },
                      roomLayerId: { type: ['string', 'null'] },
                      // coastline fields — nullable for non-coastline layers
                      sourceLayerId: {
                        type: ['string', 'null'],
                        description:
                          'ID of the water layer to trace boundary of. Only for "coastline" layers.',
                      },
                      beachWidth: {
                        type: ['number', 'null'],
                        description:
                          'Beach strip width in tiles from water boundary (1-3). Only for "coastline" layers.',
                      },
                      // road/path/town_center fields — nullable for non-road layers
                      roadWidth: {
                        type: ['number', 'null'],
                        description: 'Road width in tiles (2-5). Only for "road" layers.',
                      },
                      branchCount: {
                        type: ['number', 'null'],
                        description:
                          'Number of branches off main spine (0-6). Only for "road" layers.',
                      },
                      curvature: {
                        type: ['number', 'null'],
                        description: 'Noise curvature (0-1). For "road" and "path" layers.',
                      },
                      radius: {
                        type: ['number', 'null'],
                        description:
                          'Clearing radius in tiles (3-6). Only for "town_center" layers.',
                      },
                      avoidLayerIds: {
                        type: ['array', 'null'],
                        items: { type: 'string' },
                        description:
                          'Layer IDs the road/path must not overwrite. Set to the IDs of any sibling layers with terrain: "water". Use [] if no water layers exist. Only for "road" and "path" layers; set null for all other layer types.',
                      },
                    },
                    required: [
                      'id',
                      'type',
                      'tilesetId',
                      'renderOrder',
                      'blocking',
                      'terrain',
                      'fill',
                      'procedural',
                      'shapePreset',
                      'autotilePreset',
                      'autotileAgainst',
                      'withinTerrain',
                      'wallStyle',
                      'wallLayerId',
                      'roomLayerId',
                      'sourceLayerId',
                      'beachWidth',
                      'roadWidth',
                      'branchCount',
                      'curvature',
                      'radius',
                      'avoidLayerIds',
                    ],
                    additionalProperties: false,
                  },
                },
                slots: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      purpose: {
                        type: 'string',
                        description:
                          'The single purpose this slot serves (e.g. "exit", "table", "bartender")',
                      },
                      positionAlgorithm: { type: 'string', enum: placementAlgorithms },
                      distribution: {
                        type: 'string',
                        enum: slotDistributions,
                        description:
                          'Spatial distribution mode: even (spread out), random (no bias), clumped (group together). Default: even.',
                      },
                      min: { type: ['number', 'null'] },
                      max: { type: ['number', 'null'] },
                      nearPurpose: { type: ['string', 'null'] },
                      requiredTags: {
                        type: ['array', 'null'],
                        items: { type: 'string' },
                        description:
                          'Tags that candidate entities must ALL have (AND logic). Null = no tag filtering.',
                      },
                      forbiddenTags: {
                        type: ['array', 'null'],
                        items: { type: 'string' },
                        description:
                          'Tags that EXCLUDE candidate entities (NOR logic — entities with ANY of these tags are rejected). Null = no exclusion.',
                      },
                      inheritableTags: {
                        type: ['array', 'null'],
                        items: { type: 'string' },
                        description:
                          'Tags that cascade to all descendant layout slots when this slot produces a child place. Null = no inheritance.',
                      },
                      slotSize: {
                        type: ['object', 'null'],
                        properties: {
                          width: { type: 'number', description: 'Width in tiles' },
                          height: { type: 'number', description: 'Height in tiles' },
                        },
                        required: ['width', 'height'],
                        additionalProperties: false,
                        description:
                          'Multi-tile footprint for this slot (e.g. buildings). Null = default 2×2 occupancy.',
                      },
                    },
                    required: [
                      'purpose',
                      'positionAlgorithm',
                      'distribution',
                      'min',
                      'max',
                      'nearPurpose',
                      'requiredTags',
                      'forbiddenTags',
                      'inheritableTags',
                      'slotSize',
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: [
                'id',
                'scale',
                'environment',
                'width',
                'height',
                'description',
                'weight',
                'defaultBlocked',
                'terrainLayers',
                'slots',
              ],
              additionalProperties: false,
            },
          },
        },
        required: [
          'name',
          'description',
          'purposes',
          'spriteId',
          'characterScale',
          'timeScale',
          'variants',
        ],
        additionalProperties: false,
      },
      aestheticHints: {
        type: 'array',
        description:
          'Category-level aesthetic choices, one entry per variant. Set wallStyleCategory/floorType to null for exterior/space variants that do not use interior tilesets.',
        items: {
          type: 'object',
          properties: {
            variantId: {
              type: 'string',
              description: 'The variant ID this hint applies to',
            },
            wallStyleCategory: {
              type: ['string', 'null'],
              enum: [...wallStyleCategories, null],
              description: 'Wall style category for this variant (null for exterior/space)',
            },
            floorType: {
              type: ['string', 'null'],
              enum: [...allFloorTypes, null],
              description:
                'Floor tile type for this variant (null for exterior/space/blob47 tilesets)',
            },
          },
          required: ['variantId', 'wallStyleCategory', 'floorType'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestedId', 'template', 'aestheticHints'],
    additionalProperties: false,
  };
}

// ============================================================================
// Pass 2: Aesthetic Resolution
// ============================================================================

/**
 * Resolve category-level aesthetic choices to specific wall style IDs and floor tile indices.
 * Uses a focused LLM call with filtered catalogs per variant.
 */
async function resolveAesthetics(
  template: LayoutTemplate,
  aestheticHints: Pass1Result['aestheticHints'],
): Promise<LayoutTemplate> {
  // Collect all unique wall style categories and floor types across variants
  const categoriesToResolve = new Map<string, { variantIds: string[]; category: string }>();
  const floorTypesToResolve = new Map<
    string,
    { variantIds: string[]; floorType: string; tilesetId: string }
  >();

  for (const variant of template.variants) {
    const hints = aestheticHints.find((h) => h.variantId === variant.id);
    if (!hints) continue;

    if (hints.wallStyleCategory) {
      const key = hints.wallStyleCategory;
      const entry = categoriesToResolve.get(key) ?? {
        variantIds: [],
        category: key,
      };
      entry.variantIds.push(variant.id);
      categoriesToResolve.set(key, entry);
    }

    if (hints.floorType) {
      // Find the tileset used by the room shape layer
      const roomLayer = variant.terrainLayers.find(
        (l) => l.type === 'rectangle' || l.type === 'l_shape' || l.type === 't_shape',
      );
      const tilesetId = roomLayer?.tilesetId ?? 'floor-interior';
      const key = `${tilesetId}:${hints.floorType}`;
      const entry = floorTypesToResolve.get(key) ?? {
        variantIds: [],
        floorType: hints.floorType,
        tilesetId,
      };
      entry.variantIds.push(variant.id);
      floorTypesToResolve.set(key, entry);
    }
  }

  // If nothing to resolve, return as-is
  if (categoriesToResolve.size === 0 && floorTypesToResolve.size === 0) {
    return template;
  }

  // Build the aesthetic resolution prompt
  const wallStyleSelections: Array<{
    variantIds: string[];
    category: string;
    availableStyles: Array<{ id: string; name: string }>;
  }> = [];

  for (const [, entry] of categoriesToResolve) {
    const catalog = loadWallStyleCatalog();
    const available = catalog
      .filter((s) => s.category === entry.category)
      .map((s) => ({ id: s.id, name: s.name }));
    wallStyleSelections.push({
      variantIds: entry.variantIds,
      category: entry.category,
      availableStyles: available,
    });
  }

  const floorSelections: Array<{
    variantIds: string[];
    floorType: string;
    tilesetId: string;
    availableIndices: number[];
  }> = [];

  for (const [, entry] of floorTypesToResolve) {
    const indices = getFloorTileIndices(entry.tilesetId, entry.floorType);
    if (indices) {
      floorSelections.push({
        variantIds: entry.variantIds,
        floorType: entry.floorType,
        tilesetId: entry.tilesetId,
        availableIndices: indices,
      });
    }
  }

  // Build descriptions of the template for context
  const templateSummary = `Template: "${template.name}" — ${template.description}\nPurposes: ${template.purposes.join(', ')}`;
  const variantSummaries = template.variants
    .map((v) => `- Variant "${v.id}": ${v.description} (${v.environment.type}, ${v.scale})`)
    .join('\n');

  const wallStyleBlock =
    wallStyleSelections.length > 0
      ? wallStyleSelections
          .map(
            (ws) =>
              `Wall style for variant(s) [${ws.variantIds.join(', ')}] — category "${ws.category}":\n` +
              `Available styles:\n${ws.availableStyles.map((s) => `  - "${s.id}" (${s.name})`).join('\n')}`,
          )
          .join('\n\n')
      : 'No wall styles to resolve.';

  const floorBlock =
    floorSelections.length > 0
      ? floorSelections
          .map(
            (fs) =>
              `Floor tiles for variant(s) [${fs.variantIds.join(', ')}] — type "${fs.floorType}" (${fs.tilesetId}):\n` +
              `Available tile indices: ${fs.availableIndices.join(', ')}`,
          )
          .join('\n\n')
      : 'No floor tiles to resolve.';

  // Build schema for Pass 2 output
  const resolutionProperties: Record<string, object> = {};

  for (const ws of wallStyleSelections) {
    for (const variantId of ws.variantIds) {
      resolutionProperties[`wallStyle_${variantId}`] = {
        type: 'string',
        enum: ws.availableStyles.map((s) => s.id),
        description: `Wall style ID for variant "${variantId}"`,
      };
    }
  }

  for (const fs of floorSelections) {
    for (const variantId of fs.variantIds) {
      resolutionProperties[`floorIndices_${variantId}`] = {
        type: 'array',
        items: { type: 'number', enum: fs.availableIndices },
        description: `Floor tile indices for variant "${variantId}". Pick 2-4 for visual variety.`,
      };
    }
  }

  // If nothing made it through filtering, return as-is
  if (Object.keys(resolutionProperties).length === 0) {
    return template;
  }

  const resolutionSchema = {
    type: 'object',
    properties: resolutionProperties,
    required: Object.keys(resolutionProperties),
    additionalProperties: false,
  };

  logger.info(
    'LayoutTemplateGenerator',
    `Pass 2: resolving aesthetics — ${wallStyleSelections.length} wall style(s), ${floorSelections.length} floor type(s)`,
  );

  const pass2Result = await queryLlm<Record<string, string | number[]>>({
    system: `You are an interior designer selecting specific materials for a game layout template. Given a template's theme and available options, pick the most fitting wall style and floor tiles. Choose options that create visual coherence — the wall material and floor should complement each other and match the place's atmosphere.`,
    prompt: `${templateSummary}\nVariants:\n${variantSummaries}\n\n## WALL STYLES TO RESOLVE\n${wallStyleBlock}\n\n## FLOOR TILES TO RESOLVE\n${floorBlock}\n\nPick the specific wall style ID and floor tile indices (2-4 tiles for visual variety) that best fit each variant's theme and atmosphere.`,
    complexity: 'simple',
    context: 'LayoutTemplateAesthetics',
    schema: {
      name: 'aesthetic_resolution',
      schema: resolutionSchema,
    },
  });

  // Apply resolved values back to the template
  const resolvedTemplate = {
    ...template,
    variants: template.variants.map((v) => {
      const wallStyleKey = `wallStyle_${v.id}`;
      const floorIndicesKey = `floorIndices_${v.id}`;
      const rawWallStyle = pass2Result.content[wallStyleKey];
      const resolvedWallStyle = typeof rawWallStyle === 'string' ? rawWallStyle : undefined;
      const rawFloorIndices = pass2Result.content[floorIndicesKey];
      const resolvedFloorIndices = Array.isArray(rawFloorIndices) ? rawFloorIndices : undefined;

      return {
        ...v,
        terrainLayers: v.terrainLayers.map((layer) => {
          // Apply wall style to wall and wall_face layers
          if (resolvedWallStyle && (layer.type === 'wall' || layer.type === 'wall_face')) {
            return { ...layer, wallStyle: resolvedWallStyle };
          }

          // Apply floor indices to room shape layers
          if (
            resolvedFloorIndices &&
            (layer.type === 'rectangle' || layer.type === 'l_shape' || layer.type === 't_shape')
          ) {
            return { ...layer, fill: resolvedFloorIndices };
          }

          return layer;
        }),
      };
    }),
  };

  logger.info('LayoutTemplateGenerator', 'Pass 2: aesthetic resolution complete');

  return resolvedTemplate;
}

// ============================================================================
// Post-Processing
// ============================================================================

/**
 * Apply size hints to the generated template dimensions if a size was requested.
 */
function applySizeHints(
  template: LayoutTemplate,
  size: 'small' | 'medium' | 'large' | undefined,
  environmentType: string | undefined,
): LayoutTemplate {
  if (!size) return template;

  const envKey =
    environmentType === 'interior' || environmentType === undefined
      ? template.variants[0] && isEnclosed(template.variants[0].environment)
        ? 'interior'
        : 'exterior'
      : environmentType === 'exterior' ||
          environmentType === 'space' ||
          environmentType === 'underwater'
        ? 'exterior'
        : 'interior';

  const preset = SIZE_PRESETS[size][envKey];

  return {
    ...template,
    variants: template.variants.map((v) => ({
      ...v,
      width: preset.width,
      height: preset.height,
    })),
  };
}

// ============================================================================
// Layer Reference Validation
// ============================================================================

/** Layer types that have autotileAgainst fields. */
const AUTOTILE_LAYER_TYPES = new Set(['noise_patch', 'coastline', 'road', 'path', 'town_center']);

/** Normalize autotileAgainst: LLM may send a string, runtime expects string[]. */
function normalizeAutotileAgainst(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Validate and fix `autotileAgainst` and `withinTerrain` on layers that reference sibling IDs.
 *
 * The LLM sometimes confuses terrain tags ("land", "wall") with layer IDs.
 * This post-processing step cross-checks references against actual sibling
 * layer IDs and fixes invalid ones:
 * - Invalid `withinTerrain` → null (noise_patch only)
 * - Invalid `autotileAgainst` → first fill/base layer ID (noise_patch, road, path, town_center)
 */
export function validateLayerReferences(template: LayoutTemplate): LayoutTemplate {
  return {
    ...template,
    variants: template.variants.map((v) => {
      const layerIds = new Set(v.terrainLayers.map((l) => l.id));
      const fallbackLayerId =
        v.terrainLayers.find((l) => !AUTOTILE_LAYER_TYPES.has(l.type))?.id ?? null;
      const waterLayerIds = new Set(
        v.terrainLayers.filter((l) => l.terrain === 'water').map((l) => l.id),
      );

      return {
        ...v,
        terrainLayers: v.terrainLayers.map((layer) => {
          if (!AUTOTILE_LAYER_TYPES.has(layer.type)) return layer;

          const patched = structuredClone(layer);

          // sourceLayerId only exists on coastline
          if (patched.type === 'coastline') {
            const srcId = patched.sourceLayerId;
            if (srcId && !layerIds.has(srcId)) {
              logger.warn(
                'LayoutTemplateGenerator',
                `Layer "${patched.id}": sourceLayerId "${srcId}" is not a sibling layer ID — clearing`,
              );
              patched.sourceLayerId = '';
            }
          }

          // withinTerrain only exists on noise_patch
          if (patched.type === 'noise_patch' && patched.withinTerrain != null) {
            if (!layerIds.has(patched.withinTerrain)) {
              logger.warn(
                'LayoutTemplateGenerator',
                `Layer "${patched.id}": withinTerrain "${patched.withinTerrain}" is not a sibling layer ID — nullifying`,
              );
              patched.withinTerrain = null;
            }
          }

          // autotileAgainst exists on noise_patch, road, path, town_center
          // LLM schema outputs as string, runtime type is string[]
          if ('autotileAgainst' in patched) {
            const againstIds = normalizeAutotileAgainst(patched.autotileAgainst);
            if (againstIds.length > 0) {
              const invalid = againstIds.filter((id) => !layerIds.has(id));
              if (invalid.length > 0) {
                logger.warn(
                  'LayoutTemplateGenerator',
                  `Layer "${patched.id}": autotileAgainst contains invalid layer IDs [${invalid.join(', ')}] — replacing with "${fallbackLayerId}"`,
                );
                patched.autotileAgainst = fallbackLayerId ? [fallbackLayerId] : [];
              } else {
                patched.autotileAgainst = againstIds;
              }
            }
          }

          // avoidLayerIds exists on road and path layers
          // Normalize, validate, and auto-inject any sibling water-terrain layer IDs
          if (patched.type === 'road' || patched.type === 'path') {
            const raw = (patched as { avoidLayerIds?: unknown }).avoidLayerIds;
            const provided: string[] = Array.isArray(raw)
              ? raw.filter((id): id is string => typeof id === 'string')
              : [];
            const invalid = provided.filter((id) => !layerIds.has(id));
            if (invalid.length > 0) {
              logger.warn(
                'LayoutTemplateGenerator',
                `Layer "${patched.id}": avoidLayerIds contains invalid layer IDs [${invalid.join(', ')}] — removing`,
              );
            }
            const valid = provided.filter((id) => layerIds.has(id));
            const validSet = new Set(valid);
            const missing = [...waterLayerIds].filter((id) => !validSet.has(id));
            patched.avoidLayerIds = [...valid, ...missing];
          }

          return patched;
        }),
      };
    }),
  };
}

/**
 * Ensure character slots have matching object slots for their work activities.
 * If a character slot's required object slot is missing, auto-add it.
 */
export function validateSlotDependencies(template: LayoutTemplate): LayoutTemplate {
  const charDeps = loadCharacterSlotDependencies();
  if (charDeps.size === 0) return template;

  return {
    ...template,
    variants: template.variants.map((v) => {
      const existingPurposes = new Set(v.slots.map((s) => s.purpose));
      const missingSlots: LayoutTemplate['variants'][0]['slots'] = [];

      for (const slot of v.slots) {
        const requiredObj = charDeps.get(slot.purpose);
        if (requiredObj && !existingPurposes.has(requiredObj)) {
          logger.warn(
            'LayoutTemplateGenerator',
            `Variant "${v.id}": character slot "${slot.purpose}" requires "${requiredObj}" object slot — auto-adding`,
          );
          missingSlots.push({
            purpose: requiredObj,
            positionAlgorithm: 'random_valid',
            distribution: 'even',
            min: 1,
            max: 1,
            nearPurpose: null,
            requiredTags: null,
            forbiddenTags: null,
            inheritableTags: null,
            slotSize: null,
            visualClearanceAbove: null,
            preferDistrict: null,
            distributionGroup: null,
            flags: { isStructural: false, facesAnchor: false, useLlmSelection: false },
          });
          existingPurposes.add(requiredObj);
        }
      }

      if (missingSlots.length === 0) return v;
      return { ...v, slots: [...v.slots, ...missingSlots] };
    }),
  };
}

/**
 * Reorder slots so that near_slot anchors appear before their dependents.
 * Uses the same priority sort the placement engine uses: in_wall=0, default=1, under=2.
 * Within the same priority, ensures nearPurpose targets come first via topological sort.
 */
export function reorderSlots(template: LayoutTemplate): LayoutTemplate {
  return {
    ...template,
    variants: template.variants.map((v) => {
      const slotPriority = (algo: string) => {
        if (algo === 'in_wall') return 0;
        if (algo === 'under') return 2;
        return 1;
      };

      // Group slots by priority
      const grouped = new Map<number, typeof v.slots>();
      for (const slot of v.slots) {
        const pri = slotPriority(slot.positionAlgorithm);
        const list = grouped.get(pri) ?? [];
        list.push(slot);
        grouped.set(pri, list);
      }

      // Within each priority group, topological sort: anchors before dependents
      for (const [pri, slots] of grouped) {
        const ordered: typeof slots = [];
        const remaining = [...slots];
        const placed = new Set<string>();

        // Keep pulling slots whose nearPurpose is already placed (or null)
        let changed = true;
        while (changed && remaining.length > 0) {
          changed = false;
          for (let i = remaining.length - 1; i >= 0; i--) {
            const s = remaining[i];
            if (!s.nearPurpose || placed.has(s.nearPurpose)) {
              ordered.push(s);
              if (s.purpose) placed.add(s.purpose);
              remaining.splice(i, 1);
              changed = true;
            }
          }
        }
        // Append any remaining (circular deps — unlikely but safe)
        ordered.push(...remaining);
        grouped.set(pri, ordered);
      }

      // Reassemble in priority order
      const sorted = [...grouped.entries()].sort(([a], [b]) => a - b).flatMap(([, slots]) => slots);

      return { ...v, slots: sorted };
    }),
  };
}

// ============================================================================
// Cleanup
// ============================================================================

const TERRAIN_LAYER_BASE_FIELDS = new Set([
  'id',
  'type',
  'tilesetId',
  'renderOrder',
  'blocking',
  'terrain',
  'fill',
  'procedural',
  'inheritable',
  'altCenterCount',
]);

/**
 * Clean up LLM-generated template to match the runtime shape expected by the editor.
 *
 * The LLM schema requires all fields on every terrain layer (OpenAI structured output
 * demands all properties be in `required`), so non-applicable layers get extra fields
 * set to null. The editor and runtime expect these fields to be absent, so we strip
 * any field not in `TERRAIN_LAYER_BASE_FIELDS ∪ LAYER_TYPE_META[type].extraFields`.
 */
export function cleanGeneratedTemplate(template: LayoutTemplate): LayoutTemplate {
  return {
    ...template,
    variants: template.variants.map((v) => ({
      ...v,
      terrainLayers: v.terrainLayers.map((layer) => {
        const meta = LAYER_TYPE_META[layer.type];
        const allowed = new Set([...TERRAIN_LAYER_BASE_FIELDS, ...meta.extraFields]);
        const cleaned = { ...layer };
        const record = cleaned as Record<string, unknown>;
        for (const key of Object.keys(record)) {
          if (!allowed.has(key)) delete record[key];
        }
        return cleaned;
      }),
    })),
  };
}

// ============================================================================
// Main Generator (2-Pass Pipeline)
// ============================================================================

/**
 * Generate a LayoutTemplate from a user description using a 2-pass LLM pipeline.
 *
 * Pass 1: Structure — generates the full template with category-level aesthetic hints.
 * Pass 2: Aesthetics — resolves categories to specific wall style IDs and floor tile indices.
 *
 * @param params - Generation parameters (prompt, optional hints)
 * @returns Generated template and suggested ID
 */
export async function generateLayoutTemplate(
  params: GenerateLayoutTemplateParams,
): Promise<GenerateLayoutTemplateResult> {
  // Pass 1: Structure generation
  logger.info('LayoutTemplateGenerator', 'Pass 1: generating template structure...');

  const system = buildStructureSystemPrompt();
  const prompt = buildStructureUserPrompt(params);
  const schema = buildStructureSchema();

  const pass1Result = await queryLlm<Pass1Result>({
    system,
    prompt,
    complexity: 'reasoning',
    maxTokensOverride: 16384,
    context: 'LayoutTemplateGenerator',
    schema: {
      name: 'layout_template_generation',
      schema,
    },
    retries: 1,
  });

  const { suggestedId, template: rawTemplate, aestheticHints } = pass1Result.content;

  logger.info(
    'LayoutTemplateGenerator',
    `Pass 1 complete: "${rawTemplate.name}" (${rawTemplate.variants.length} variant(s)), hints: ${JSON.stringify(aestheticHints)}`,
  );

  // Pass 2: Aesthetic resolution
  const resolvedTemplate = await resolveAesthetics(rawTemplate, aestheticHints);

  // Post-processing: validate references, fix slot deps, reorder, clean up, apply size hints
  const validated = validateLayerReferences(resolvedTemplate);
  const slotFixed = validateSlotDependencies(validated);
  const reordered = reorderSlots(slotFixed);
  const cleaned = cleanGeneratedTemplate(reordered);
  const template = applySizeHints(cleaned, params.size, params.environmentType);

  return {
    suggestedId,
    template,
  };
}
