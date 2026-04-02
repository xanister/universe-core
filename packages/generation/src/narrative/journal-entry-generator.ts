import { queryLlm, generateImage } from '@dmnpc/core/clients/openai-client.js';
import { storageService } from '@dmnpc/core/clients/storage-service.js';
import { logger } from '@dmnpc/core/infra/logger.js';
import { formatFactForReader } from '@dmnpc/core/prompts/fact-formatter.js';
import { buildActionTranscript } from '@dmnpc/core/prompts/transcript-builder.js';
import { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import type { JournalEntry, UniverseEvent } from '@dmnpc/types/entity';
import type { PlotState, PlotTurningPoint, PlotGoal } from '@dmnpc/types/npc';

/**
 * Build context from plot data for journal image subject extraction.
 * Prioritizes achieved goals, triggered turning points, and plot summaries.
 */
function buildPlotContext(plots: PlotState[]): string {
  const parts: string[] = [];

  for (const plot of plots) {
    const plan = plot.plan;
    const storyFlags = plot.storyFlags;

    // Achieved goals are highest priority - they represent completed story moments
    // Collect goals from plan level whose successFlags are set
    const achievedGoals: PlotGoal[] = (plan.goals ?? []).filter((goal) => {
      const isAchieved = goal.successFlags?.some((flag) => storyFlags.includes(flag)) ?? false;
      return isAchieved;
    });
    if (achievedGoals.length > 0) {
      parts.push(
        `ACHIEVED GOALS:\n${achievedGoals.map((g: PlotGoal) => `- ${g.description}`).join('\n')}`,
      );
    }

    // Triggered turning points show what actually happened
    const triggeredTPs = plan.turningPoints.filter((tp: PlotTurningPoint) => tp.triggered);
    if (triggeredTPs.length > 0) {
      parts.push(
        `STORY EVENTS:\n${triggeredTPs.map((tp: PlotTurningPoint) => `- ${tp.outcome || tp.essentialInformation.join('; ')}`).join('\n')}`,
      );
    }

    // Story flags can indicate significant moments
    if (plot.storyFlags.length > 0) {
      parts.push(`STORY FLAGS: ${plot.storyFlags.join(', ')}`);
    }

    // Plot summary for overall context
    if (plan.plot) {
      parts.push(`PLOT SUMMARY: ${plan.plot}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Generates a journal entry from the character's perspective based on their experiences.
 *
 * Uses two sources of context:
 * - conversationContext: Rolling summary of past conversations (deep history)
 * - Recent messages: Immediate context from current conversation
 *
 * Fact extraction is NOT done here - it's handled by the conversation summarizer
 * during message threshold pruning.
 *
 * @param ctx - UniverseContext to use (ensures latest in-memory state)
 * @param characterId - The character ID to generate the journal entry for
 * @returns Promise<JournalEntry> - A journal entry with content and optional image
 */
export async function generateJournalEntry(
  ctx: UniverseContext,
  characterId: string,
): Promise<JournalEntry> {
  logger.info('JournalEntryGenerator', 'generateJournalEntry called');
  try {
    const context = ctx;
    const character = context.getCharacter(characterId);
    const characterInfo = character.info;
    const { messages, conversationContext } = character.info;
    const universe = context.universe;

    // Get current location
    const placeId = character.position.parent;
    if (!placeId) {
      throw new Error(`Character ${characterId} has no position.parent`);
    }
    const currentPlace = context.getPlace(placeId);

    // Build transcript from recent messages (immediate context)
    const transcript = buildActionTranscript(messages, 20); // Use more messages for journal context (conversationContext captures broader history)

    logger.info(
      'JournalEntryGenerator',
      `Building journal context for ${characterId}: ${messages.length} messages, transcript ${transcript.length} chars`,
    );

    // Build character context - include recent events the character witnessed
    // Transform entity IDs in facts to readable names based on character's knowledge
    const formatEvent = (e: UniverseEvent) => {
      const fact = formatFactForReader(e.fact, characterId, context);
      return e.date ? `${e.date} – ${fact}` : fact;
    };
    const keyEvents = context.getEventsForCharacter(characterId).slice(-10); // Last 10 events
    const characterContext = [
      `Character: ${character.label}`,
      character.description ? `Description: ${character.description}` : null,
      characterInfo.race ? `Race: ${characterInfo.race}` : null,
      characterInfo.personality ? `Personality: ${characterInfo.personality}` : null,
      keyEvents.length > 0
        ? `Key Events in Character's Life: ${keyEvents.map(formatEvent).join('; ')}`
        : null,
      characterInfo.birthdate ? `Born: ${characterInfo.birthdate}` : null,
      characterInfo.birthPlace ? `Birthplace: ${characterInfo.birthPlace}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    // Build universe context
    const universeContext = [
      universe.name ? `World: ${universe.name}` : null,
      universe.description ? `World Description: ${universe.description}` : null,
      universe.tone ? `Tone: ${universe.tone}` : null,
      universe.rules ? `World Rules: ${universe.rules}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    // Build location context
    const locationContext = [
      `Current Location: ${currentPlace.label}`,
      currentPlace.description ? `Location Description: ${currentPlace.description}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const system = `You are writing a journal entry from the perspective of a character in a role-playing game.

CRITICAL RULES:
- Write in FIRST PERSON from the character's perspective (use "I", "me", "my", etc.)
- The tone, style, and voice MUST reflect the character's personality traits
- Write at least 3 paragraphs. Focus on key moments and feelings, not exhaustive detail.
- Be authentic to the character's personality - if they're optimistic, write optimistically; if they're cynical, write cynically
- Include the character's reflections on events, not just a dry summary
- Write as if the character is recording their thoughts at the end of the day
- Only reference events the character would actually know from the story context
- If no events are recorded, write about the character's thoughts on their current situation, location, or general reflections on their life and goals. NEVER return empty content.`;

    // Build story context: use conversationContext for deep history, transcript for recent events
    const storyContextParts: string[] = [];

    if (conversationContext) {
      storyContextParts.push(`Story so far (previous events summary):\n${conversationContext}`);
    }

    if (transcript) {
      storyContextParts.push(`Recent events (today's conversation):\n${transcript}`);
    }

    const storyContext =
      storyContextParts.length > 0
        ? storyContextParts.join('\n\n')
        : '(No events recorded - write about the character reflecting on their current situation and surroundings)';

    const prompt = `${characterContext}

${universeContext}

${locationContext}

${storyContext}

Write a journal entry (at least 3 paragraphs) from ${character.label}'s perspective. If events occurred, focus on key moments and feelings. If no events are recorded, write about the character's reflections on their current location, situation, or personal thoughts and goals.`;

    // Generate journal content
    const journalResult = await queryLlm({
      system,
      prompt,
      complexity: 'simple',
      context: 'Journal Entry Generation',
      maxTokensOverride: 2000,
    });

    const content = journalResult.content.trim();

    if (!content || content.trim().length === 0) {
      logger.error('JournalEntryGenerator', 'Empty journal content generated', {
        characterId,
        transcriptLength: transcript.length,
        truncated: journalResult.truncated,
      });
      return {
        content: `Today was uneventful. I find myself reflecting on the day, but little of note occurred.`,
        gameDate: universe.date,
        facts: [],
        image: null,
        context: null,
      };
    }

    // Use the universe's current date as the game date
    const gameDate = universe.date;

    // Generate image (optional - based on significant events/subjects from the day)
    let image: string | undefined;

    // Skip image generation if disabled via environment variable
    if (process.env.DISABLE_IMAGE_GENERATION === 'true') {
      logger.info(
        'JournalEntryGenerator',
        'Image generation disabled via DISABLE_IMAGE_GENERATION env variable',
      );
    } else {
      try {
        // Build rich context from plot data, conversation, and messages
        const storytellerState = characterInfo.storytellerState;
        const activePlots = storytellerState?.activePlots || [];

        // Build plot context (achieved goals, triggered turning points, story flags)
        const plotContext = buildPlotContext(activePlots);

        // Build image subject detection context
        const subjectDetectionParts: string[] = [];

        // Plot data is highest priority - it captures narrative significance
        if (plotContext) {
          subjectDetectionParts.push(`PLOT DATA:\n${plotContext}`);
        }

        // Conversation context provides rolling summary
        if (conversationContext) {
          subjectDetectionParts.push(`STORY SUMMARY:\n${conversationContext}`);
        }

        // Recent transcript for immediate events
        if (transcript) {
          subjectDetectionParts.push(`RECENT EVENTS:\n${transcript}`);
        }

        // Current location for setting context
        subjectDetectionParts.push(`CURRENT LOCATION: ${currentPlace.label}`);
        if (currentPlace.description) {
          subjectDetectionParts.push(`LOCATION DESCRIPTION: ${currentPlace.description}`);
        }

        const subjectDetectionContext = subjectDetectionParts.join('\n\n');

        const subjectSystem = `You are analyzing a character's day to identify the most significant subject to sketch in their journal.

CRITICAL RULES:
- Identify the SINGLE MOST SIGNIFICANT subject from the day's events
- This can be: an item, object, person, creature, place, or scene
- Prioritize ACHIEVED GOALS - these represent the story's key moments
- Look for emotionally significant objects or moments (e.g., "a cup of tea" if that was the focus)
- If nothing notable happened, return null
- Provide a brief, drawable description suitable for a pencil sketch`;

        const subjectPrompt = `Character: ${character.label}

${subjectDetectionContext}

Based on this context, identify the most significant subject that ${character.label} would sketch in their journal today. Focus on achieved goals, key moments, or emotionally significant objects/scenes.`;

        interface JournalSubjectResponse {
          subject: string | null;
          description: string | null;
        }

        const subjectResult = await queryLlm<JournalSubjectResponse>({
          system: subjectSystem,
          prompt: subjectPrompt,
          complexity: 'reasoning',
          context: 'Journal Subject Detection',
          maxTokensOverride: 200,
          schema: {
            name: 'journal_subject_schema',
            schema: {
              type: 'object',
              properties: {
                subject: {
                  type: ['string', 'null'],
                  description:
                    'Brief name of the subject to draw (e.g., "a cup of tea", "the merchant", "the ancient door")',
                },
                description: {
                  type: ['string', 'null'],
                  description:
                    'Visual description for sketching (e.g., "a steaming ceramic mug with wisps of steam rising")',
                },
              },
              required: ['subject', 'description'],
              additionalProperties: false,
            },
          },
        });

        const { subject, description } = subjectResult.content;

        if (subject && description) {
          const universeStyle = universe.style || '';
          const imagePrompt = `${universeStyle ? `Art style: ${universeStyle}. ` : ''}Simple pencil sketch, no text, no words, no letters, minimalist line drawing of ${subject}: ${description}. Journal entry style sketch, rough drawing, simple lines, black and white, sketchy style, rendered on parchment paper background, aged paper texture.`;

          const imageResult = await generateImage({
            prompt: imagePrompt,
            size: '1024x1536',
            context: 'Journal Entry Image',
          });
          const imageBase64 = imageResult.base64;

          const imageBuffer = Buffer.from(imageBase64, 'base64');

          const timestamp = Date.now();
          const filename = `journal_${characterId}_${timestamp}.png`;
          const key = `universes/${universe.id}/images/journal/${filename}`;

          image = await storageService.uploadFile(key, imageBuffer, 'image/png');

          logger.info(
            'JournalEntryGenerator',
            `Generated and saved journal image for ${characterId}: ${subject} - ${image}`,
          );
        } else {
          logger.info(
            'JournalEntryGenerator',
            'No significant subject detected for journal image, skipping image generation',
          );
        }
      } catch (error) {
        logger.error(
          'JournalEntryGenerator',
          `Image generation failed for ${characterId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Note: Fact extraction is NOT done here anymore.
    // Facts are extracted by the conversation summarizer during message threshold pruning.
    // The journal entry now focuses purely on narrative prose generation.

    logger.info(
      'JournalEntryGenerator',
      `Journal entry generated for ${characterId}: ${content.length} chars, date ${gameDate}, image: ${!!image}, context: ${!!conversationContext}`,
    );

    return {
      content: content.trim(),
      gameDate,
      facts: [], // Facts are now extracted separately by the summarizer
      image: image ?? null,
      context: null,
    };
  } catch (error: unknown) {
    logger.error('JournalEntryGenerator', 'Failed to generate journal entry', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Get universe date for fallback entry
    let fallbackGameDate = '';
    try {
      fallbackGameDate = ctx.universe.date;
    } catch (dateError) {
      logger.error(
        'JournalEntryGenerator',
        `Failed to load universe date for fallback journal entry`,
        {
          error: dateError instanceof Error ? dateError.message : String(dateError),
        },
      );
    }

    return {
      content: `I find myself unable to properly record the events of this day. My thoughts are scattered, and the memories seem unclear. Perhaps tomorrow will bring clarity.`,
      gameDate: fallbackGameDate,
      facts: [],
      image: null,
      context: null,
    };
  }
}
