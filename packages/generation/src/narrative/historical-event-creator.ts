/**
 * Historical Event Creator
 *
 * Converts WorldBible historical events to UniverseEvent entities.
 * Called during universe creation after places have been generated.
 */

import { logger } from '@dmnpc/core/infra/logger.js';
import type { UniverseContext } from '@dmnpc/core/universe/universe-context.js';
import { generateEventId } from '@dmnpc/core/universe/universe-store.js';
import type { WorldBible, HistoricalEventType } from '@dmnpc/types/world';
import type { UniverseEvent } from '@dmnpc/types/entity';

/**
 * Convert WorldBible historical events to UniverseEvent entities.
 * Resolves place names to place IDs where possible.
 *
 * @param ctx - Universe context (must have places already loaded)
 * @param worldBible - WorldBible containing historical events
 * @returns Number of events created
 */
export function createHistoricalEventsFromWorldBible(
  ctx: UniverseContext,
  worldBible: WorldBible,
): number {
  const events = worldBible.historicalEvents;

  if (events.length === 0) {
    logger.info(
      'HistoricalEventCreator',
      `No historical events to create for universe ${ctx.universeId}`,
    );
    return 0;
  }

  logger.info(
    'HistoricalEventCreator',
    `Creating ${events.length} historical events for universe ${ctx.universeId}`,
  );

  let createdCount = 0;

  for (const wbEvent of events) {
    try {
      // Generate unique event ID
      const eventId = generateEventId(wbEvent.fact);

      // Resolve place names to place IDs
      const relevantPlaceIds = resolvePlaceNames(ctx, wbEvent.relevantPlaces ?? undefined);

      // Create the universe event
      const event: UniverseEvent = {
        id: eventId,
        date: null,
        placeId: null,
        eventType: wbEvent.eventType,
        category: 'world',
        subject: getSubjectFromEventType(wbEvent.eventType),
        subjectId: null,
        fact: wbEvent.fact,
        significance: wbEvent.significance,
        important: wbEvent.significance === 'major', // Major events survive universe reset
        witnessIds: null,
        importanceScore: null,
        scope: wbEvent.scope,
        relevantPlaceIds: relevantPlaceIds.length > 0 ? relevantPlaceIds : null,
        // No witnessIds = public knowledge (everyone knows about it)
        // No date = historical event (no specific game date)
      };

      ctx.upsertEvent(event);
      createdCount++;

      logger.info(
        'HistoricalEventCreator',
        `Created historical event: ${eventId} (${wbEvent.eventType}, ${wbEvent.scope}, ${wbEvent.significance})`,
      );
    } catch (error) {
      logger.error('HistoricalEventCreator', `Failed to create historical event: ${wbEvent.fact}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  logger.info(
    'HistoricalEventCreator',
    `Created ${createdCount} historical events for universe ${ctx.universeId}`,
  );

  return createdCount;
}

/**
 * Resolve place names from WorldBible to place IDs in the universe.
 * Uses label matching with case-insensitive comparison.
 */
function resolvePlaceNames(ctx: UniverseContext, placeNames?: string[]): string[] {
  if (!placeNames || placeNames.length === 0) {
    return [];
  }

  const resolvedIds: string[] = [];

  for (const name of placeNames) {
    const normalizedName = name.toLowerCase().trim();

    // Find place by label (case-insensitive) or alias
    const place = ctx.places.find((p) => {
      if (p.label.toLowerCase() === normalizedName) {
        return true;
      }
      // Check aliases
      if (p.aliases?.some((alias) => alias.toLowerCase() === normalizedName)) {
        return true;
      }
      return false;
    });

    if (place) {
      resolvedIds.push(place.id);
    }
  }

  return resolvedIds;
}

/**
 * Get a subject label based on event type.
 */
function getSubjectFromEventType(eventType: HistoricalEventType): string {
  switch (eventType) {
    case 'founding':
      return 'Founding';
    case 'war':
      return 'War';
    case 'treaty':
      return 'Treaty';
    case 'catastrophe':
      return 'Catastrophe';
    case 'ruler_change':
      return 'Succession';
    case 'discovery':
      return 'Discovery';
    case 'historical':
    default:
      return 'History';
  }
}
