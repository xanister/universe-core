/**
 * Object Type Generator
 *
 * Uses LLM to generate a complete ObjectTypeDefinition from a user prompt.
 * Provides the LLM with reference data (valid purposes, sprite IDs, layers)
 * so it can produce valid output.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';
import { loadPurposeIds } from '../purpose-loader.js';
import { SPRITE_REGISTRY_PATH, ENTITIES_DIR } from '@dmnpc/data';
import { SpriteRegistry } from '@dmnpc/types/world';
import { join } from 'path';
import { readdirSync } from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface GenerateObjectTypeParams {
  /** User's description of the desired object type (required). */
  prompt: string;
}

interface ObjectTypeDefinition {
  name: string;
  description: string;
  purposes: string[];
  solid: boolean;
  layer: 'floor' | 'default' | 'overhead';
  spriteId: string;
  materials: string[];
  tintable: boolean;
  animated?: boolean;
  canContain?: boolean;
  supportedOrientations: string[];
}

export interface GenerateObjectTypeResult {
  /** The generated object type definition. */
  objectType: ObjectTypeDefinition & { id: string };
  /** Suggested object type ID (snake_case). */
  suggestedId: string;
}

// ============================================================================
// Reference Data Loaders
// ============================================================================

function loadSpriteIds(): string[] {
  const registry = readJsonFileSync<SpriteRegistry>(SPRITE_REGISTRY_PATH);
  return Object.keys(registry.sprites);
}

function loadExistingObjectIds(): string[] {
  const objectsDir = join(ENTITIES_DIR, 'objects');
  return readdirSync(objectsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildSystemPrompt(): string {
  const purposeIds = loadPurposeIds();
  const spriteIds = loadSpriteIds();
  const existingIds = loadExistingObjectIds();

  return `You are an object type designer for a 2D top-down RPG game engine. You generate JSON object type definitions that describe objects placed in the game world (furniture, containers, decorations, interactive items, etc.).

## AVAILABLE PURPOSES
These are the valid purpose IDs you may assign to objects:
${purposeIds.join(', ')}

Common object purposes: seating, sleeping, storage, table, decoration, workspace, anchor, lighting

## AVAILABLE SPRITE IDS
These are the registered sprite IDs you may use for the object's visual appearance:
${spriteIds.join(', ')}

Pick the sprite that best matches the described object. If no sprite matches well, pick the closest one.

## EXISTING OBJECT TYPE IDS
These IDs are already taken — do NOT reuse them:
${existingIds.join(', ')}

## LAYERS
- "floor" — flat items rendered below characters (rugs, floor markings)
- "default" — standard objects at character level (tables, chairs, barrels)
- "overhead" — items rendered above characters (chandeliers, signs)

## FIELDS
- id: snake_case unique identifier (e.g. "round_table", "iron_chandelier")
- name: Human-readable display name
- description: Brief description of the object
- purposes: Array of purpose IDs this object can fulfill for slot matching (at least one required)
- solid: Whether the object blocks character movement (true for furniture, false for rugs/decorations)
- layer: Rendering layer ("floor", "default", or "overhead")
- spriteId: ID from the sprite registry for the visual appearance
- materials: Array of material strings (e.g. ["wood", "oak"], ["iron", "steel"])
- tintable: Whether the sprite can be color-tinted (true for simple colored objects)
- animated: Whether the sprite has animation frames (optional, default false)
- canContain: Whether the object can hold items inside it (optional, for containers like chests/barrels)
- supportedOrientations: Array of directions this sprite visually supports (["south"] for single-direction, ["north","south","east","west"] for symmetric). Omit for south-only default.

## EXAMPLES

### Simple furniture
{
  "suggestedId": "chair",
  "objectType": {
    "id": "chair",
    "name": "Chair",
    "description": "A simple wooden chair",
    "purposes": ["seating"],
    "solid": true,
    "layer": "default",
    "spriteId": "chair",
    "materials": ["wood", "oak", "pine"],
    "tintable": true
  }
}

### Container
{
  "suggestedId": "barrel",
  "objectType": {
    "id": "barrel",
    "name": "Barrel",
    "description": "A sturdy wooden barrel",
    "purposes": ["storage"],
    "solid": true,
    "layer": "default",
    "spriteId": "barrel",
    "materials": ["wood", "oak"],
    "tintable": true,
    "canContain": true
  }
}

### Light source
{
  "suggestedId": "wall_torch",
  "objectType": {
    "id": "wall_torch",
    "name": "Wall Torch",
    "description": "A flickering torch mounted on a wall bracket",
    "purposes": ["lighting"],
    "solid": false,
    "layer": "default",
    "spriteId": "torch_lpc",
    "materials": ["wood", "iron"],
    "tintable": false,
    "animated": true
  }
}

Generate an object type that matches the user's description. Be creative but realistic — think about what materials it would be made of, whether characters can walk through it, and what purpose it serves in a game world.`;
}

// ============================================================================
// JSON Schema for Structured Output
// ============================================================================

function buildObjectTypeSchema(): object {
  return {
    type: 'object',
    properties: {
      suggestedId: {
        type: 'string',
        description: 'Snake_case ID for this object type (e.g. "round_table", "iron_chandelier")',
      },
      objectType: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Same as suggestedId' },
          name: { type: 'string', description: 'Human-readable display name' },
          description: { type: 'string', description: 'Brief description of the object' },
          purposes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Purpose IDs this object fulfills',
          },
          solid: { type: 'boolean', description: 'Whether it blocks movement' },
          layer: {
            type: 'string',
            enum: ['floor', 'default', 'overhead'],
            description: 'Rendering layer',
          },
          spriteId: { type: 'string', description: 'Sprite registry ID for visual appearance' },
          materials: {
            type: 'array',
            items: { type: 'string' },
            description: 'Material strings',
          },
          tintable: { type: 'boolean', description: 'Whether sprite can be color-tinted' },
          animated: { type: 'boolean', description: 'Whether sprite has animation frames' },
          canContain: { type: 'boolean', description: 'Whether object can hold items' },
          supportedOrientations: {
            type: 'array',
            items: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
            description: 'Directions this sprite visually supports. Omit for south-only default.',
          },
        },
        required: [
          'id',
          'name',
          'description',
          'purposes',
          'solid',
          'layer',
          'spriteId',
          'materials',
          'tintable',
          'animated',
          'canContain',
          'supportedOrientations',
        ],
        additionalProperties: false,
      },
    },
    required: ['suggestedId', 'objectType'],
    additionalProperties: false,
  };
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate an ObjectTypeDefinition from a user description using LLM.
 *
 * @param params - Generation parameters (prompt)
 * @returns Generated object type and suggested ID
 */
export async function generateObjectType(
  params: GenerateObjectTypeParams,
): Promise<GenerateObjectTypeResult> {
  const system = buildSystemPrompt();
  const schema = buildObjectTypeSchema();

  const result = await queryLlm<GenerateObjectTypeResult>({
    system,
    prompt: params.prompt,
    complexity: 'reasoning',
    context: 'ObjectTypeGenerator',
    schema: {
      name: 'object_type_generation',
      schema,
    },
    retries: 1,
  });

  return result.content;
}
