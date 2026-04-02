/**
 * Template Character Generator
 *
 * Generates template character definitions using AI.
 * Templates are character blueprints that can be instantiated across universes.
 */

import { queryLlm } from '@dmnpc/core/clients/openai-client.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { buildExistingTemplatesContext } from '@dmnpc/generation/generation-context.js';
import type { TemplateCharacterDefinition, TemplatePhysicalTraits } from '@dmnpc/types/npc';
import type { Fact } from '@dmnpc/types/entity';

export interface TemplateGenerationHints {
  /** Character archetype, e.g., "grizzled warrior", "cunning thief" */
  archetype?: string;
  /** Personality traits to emphasize */
  personality?: string;
  /** Gender preference */
  gender?: string;
  /** Backstory themes to incorporate */
  backstoryThemes?: string[];
  /** Name suggestion */
  name?: string;
}

function generateTemplateId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30);
  return `TEMPLATE_${slug}`;
}

async function buildTemplateGenerationPrompt(hints?: TemplateGenerationHints): Promise<string> {
  const sections: string[] = [];

  sections.push(`You are creating a CHARACTER TEMPLATE - a reusable character blueprint that can be instantiated across different universes (fantasy, sci-fi, modern, etc.).

The template should define:
1. Core identity (name, physical traits) that persists across all universes
2. Personality and behavioral patterns
3. Thematic backstory elements that can be adapted to any setting

IMPORTANT: Keep descriptions GENERIC enough to work in any genre. Avoid universe-specific details like "elvish" or "laser pistol". Instead use adaptable descriptions like "pointed features" or "signature weapon".`);

  // Add existing templates context to avoid duplicates
  const existingContext = await buildExistingTemplatesContext();
  if (existingContext) {
    sections.push(existingContext);
  }

  if (hints?.name) {
    sections.push(`Suggested name: ${hints.name}`);
  }

  if (hints?.archetype) {
    sections.push(`Character archetype: ${hints.archetype}`);
  }

  if (hints?.personality) {
    sections.push(`Personality focus: ${hints.personality}`);
  }

  if (hints?.gender) {
    sections.push(`Gender: ${hints.gender}`);
  }

  if (hints?.backstoryThemes && hints.backstoryThemes.length > 0) {
    sections.push(`Backstory themes to incorporate: ${hints.backstoryThemes.join(', ')}`);
  }

  sections.push(`Generate a compelling, memorable character template with:
- A distinctive name (different from existing templates)
- Vivid physical description (appearance, distinguishing features)
- Clear personality traits (avoid duplicating existing personality combinations)
- 3-5 thematic backstory elements
- Core physical traits (eye color, hair color, gender)
- A race adaptation hint (e.g., "human-like", "elvish", "robotic") for cross-universe mapping`);

  return sections.join('\n\n');
}

/**
 * Generate a complete template character definition using AI.
 */
export async function generateTemplateCharacter(
  hints?: TemplateGenerationHints,
): Promise<TemplateCharacterDefinition> {
  const startedAt = Date.now();

  logger.info(
    'TemplateGenerator',
    `Generating template with hints: ${JSON.stringify(hints || {})}`,
  );

  const prompt = await buildTemplateGenerationPrompt(hints);

  const schema = {
    name: 'template_character_generation',
    schema: {
      type: 'object' as const,
      properties: {
        label: {
          type: 'string' as const,
          description: 'Character full name',
        },
        description: {
          type: 'string' as const,
          description:
            'Full physical description (2-3 sentences). Focus on immutable traits that persist across universes.',
        },
        short_description: {
          type: 'string' as const,
          description:
            'Brief description when name unknown (e.g., "grizzled old warrior"). Max 30 chars.',
        },
        personality: {
          type: 'string' as const,
          description: 'Core personality traits and behavioral patterns (2-3 sentences)',
        },
        backstoryThemes: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Thematic elements of backstory (e.g., "redemption", "loss", "duty")',
        },
        physicalTraits: {
          type: 'object' as const,
          properties: {
            gender: { type: 'string' as const },
            eyeColor: { type: 'string' as const },
            hairColor: { type: 'string' as const },
            hairStyle: {
              type: 'string' as const,
              description:
                'Hair style pattern name (e.g., "ponytail", "bangs", "long", "mohawk", "pixie")',
            },
            skinTone: {
              type: 'string' as const,
              enum: [
                'amber',
                'black',
                'blue',
                'bright_green',
                'bronze',
                'brown',
                'dark_green',
                'fur_black',
                'fur_brown',
                'fur_copper',
                'fur_gold',
                'fur_grey',
                'fur_tan',
                'fur_white',
                'green',
                'lavender',
                'light',
                'olive',
                'pale_green',
                'taupe',
                'zombie',
                'zombie_green',
              ],
              description: 'Character skin tone for sprite generation',
            },
            race: {
              type: 'string' as const,
              description: 'Preferred race (generic, e.g., "human")',
            },
            raceAdaptation: {
              type: 'string' as const,
              description:
                'Race adaptation hint for cross-universe mapping (e.g., "human-like", "elvish", "robotic")',
            },
          },
          required: [
            'gender',
            'eyeColor',
            'hairColor',
            'hairStyle',
            'skinTone',
            'race',
            'raceAdaptation',
          ],
          additionalProperties: false,
        },
        keyEvents: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              subject: { type: 'string' as const },
              fact: { type: 'string' as const },
              category: {
                type: 'string' as const,
                enum: ['world', 'relationship', 'knowledge'],
              },
              significance: {
                type: 'string' as const,
                enum: ['minor', 'moderate', 'major'],
              },
            },
            required: ['subject', 'fact', 'category', 'significance'],
            additionalProperties: false,
          },
          description: 'Key backstory events (2-4 events). Keep generic/adaptable.',
        },
      },
      required: [
        'label',
        'description',
        'short_description',
        'personality',
        'backstoryThemes',
        'physicalTraits',
        'keyEvents',
      ],
      additionalProperties: false,
    },
  };

  interface GeneratedTemplate {
    label: string;
    description: string;
    short_description: string;
    personality: string;
    backstoryThemes: string[];
    physicalTraits: {
      gender: string;
      eyeColor: string;
      hairColor: string;
      hairStyle: string;
      skinTone: string;
      race?: string;
      raceAdaptation: string;
    };
    keyEvents: Array<{
      subject: string;
      fact: string;
      category: 'world' | 'relationship' | 'knowledge';
      significance: 'minor' | 'moderate' | 'major';
    }>;
  }

  const result = await queryLlm<GeneratedTemplate>({
    prompt,
    complexity: 'reasoning',
    context: 'Template Character Generation',
    maxTokensOverride: 2048,
    schema,
  });

  const generated = result.content;

  const physicalTraits: TemplatePhysicalTraits = {
    gender: generated.physicalTraits.gender,
    eyeColor: generated.physicalTraits.eyeColor,
    hairColor: generated.physicalTraits.hairColor,
    hairStyle: generated.physicalTraits.hairStyle,
    skinTone: generated.physicalTraits.skinTone,
    race: generated.physicalTraits.race ?? null,
    raceAdaptation: generated.physicalTraits.raceAdaptation,
  };

  const keyEvents: Fact[] = generated.keyEvents.map((event) => ({
    subject: event.subject,
    fact: event.fact,
    category: event.category,
    significance: event.significance,
    placeId: null,
    subjectId: null,
    important: false,
  }));

  // Ensure short_description is within limit
  const shortDesc =
    generated.short_description.length > 30
      ? generated.short_description.substring(0, 27) + '...'
      : generated.short_description;

  const template: TemplateCharacterDefinition = {
    id: generateTemplateId(generated.label),
    label: generated.label,
    description: generated.description,
    short_description: shortDesc,
    personality: generated.personality,
    backstoryThemes: generated.backstoryThemes,
    physicalTraits,
    keyEvents,
    verbosity: 3, // Default verbosity level
    image: null,
    voiceId: 'adam',
  };

  const durationMs = Date.now() - startedAt;
  logger.info(
    'TemplateGenerator',
    `Generated template: id=${template.id} label=${template.label} durationMs=${durationMs}`,
  );

  return template;
}
