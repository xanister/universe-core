/**
 * Move Character Tool
 *
 * Moves a character (player or NPC) to a new location.
 * Handles exit resolution, milestones, and location tracking.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const moveCharacterTool = tool({
  name: 'move_character',
  description:
    'Move a character to a new location. For player movement, use the player character ID. ' +
    'Can accept a place ID (PLACE_xxx) or exit ID (EXIT_xxx). ' +
    'Use null as toPlaceId to have an NPC leave the scene.',
  inputSchema: z.object({
    characterId: z.string().describe('The character ID to move (CHAR_xxx)'),
    toPlaceId: z
      .string()
      .nullable()
      .describe('Target place ID (PLACE_xxx), exit ID (EXIT_xxx), or null to leave scene'),
  }),
  async execute(
    input: { characterId: string; toPlaceId: string | null },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { character: charService, event: eventService, logger } = services;
    const { characterId, toPlaceId } = input;

    const character = universe.findCharacter(characterId);
    if (!character) {
      throw new Error(`Character not found: ${characterId}`);
    }

    const previousLocation = character.position.parent;

    if (toPlaceId === null) {
      if (charService.isPlayerCharacter(character)) {
        throw new Error('Cannot remove player character from scene');
      }

      if (previousLocation) {
        const playersAtLocation = universe.characters.filter(
          (c) => charService.isPlayerCharacter(c) && c.position.parent === previousLocation,
        );

        for (const player of playersAtLocation) {
          const displayName = charService.computeDisplayName(character, player, universe);
          eventService.addMessageForCharacter(
            { character: player, universe },
            {
              role: 'system',
              content: `${displayName} departed`,
              speaker: 'system',
              milestone: {
                type: 'character_departed',
                label: displayName,
                subtext: null,
                entityId: character.id,
                checkDetail: null,
                combatData: null,
              },
            },
            previousLocation,
          );
        }
      }

      character.info.abstractLocation = {
        state: 'away',
        reference: { description: 'left the area', placeId: null, areaHint: null },
        since: new Date().toISOString(),
      };
      character.position.parent = null;
      character.destinationPlaceId = null;
      universe.upsertEntity('character', character);

      logger.info('MoveCharacterTool', `Character left scene: ${character.label}`);
      return {
        success: true,
        characterId,
        characterLabel: character.label,
        previousLocation,
        newLocation: null,
        action: 'left_scene',
      };
    }

    let targetPlaceId: string;
    let exitObject;

    if (toPlaceId.startsWith('EXIT_') || toPlaceId.startsWith('OBJ_exit_')) {
      const exit = universe.findExit(toPlaceId);
      if (!exit) {
        throw new Error(`Exit not found: ${toPlaceId}`);
      }
      exitObject = exit;

      const exitPlaceId = exit.position.parent;
      if (!exitPlaceId) {
        throw new Error(`Exit has no parent place: ${toPlaceId}`);
      }
      const exitPlace = universe.findPlace(exitPlaceId);
      if (!exitPlace?.position.parent) {
        throw new Error(`Exit's place has no parent (cannot derive target): ${toPlaceId}`);
      }
      targetPlaceId = exitPlace.position.parent;
    } else if (toPlaceId.startsWith('PLACE_')) {
      targetPlaceId = toPlaceId;
    } else {
      throw new Error(
        `Invalid target ID format: ${toPlaceId}. Must be PLACE_xxx or EXIT_xxx/OBJ_exit_xxx`,
      );
    }

    const targetPlace = universe.findPlace(targetPlaceId);
    if (!targetPlace) {
      throw new Error(`Target place not found: ${targetPlaceId}`);
    }

    if (character.position.parent === targetPlaceId) {
      logger.info(
        'MoveCharacterTool',
        `Character already at target location: ${character.label} at ${targetPlaceId}`,
      );
      return {
        success: true,
        characterId,
        characterLabel: character.label,
        previousLocation: targetPlaceId,
        newLocation: targetPlaceId,
        action: 'already_there',
      };
    }

    await charService.setCharacterLocation({ character, targetPlaceId, ctx: universe, exitObject });

    if (charService.isPlayerCharacter(character)) {
      const gameDate = universe.universe.date;
      universe.recordVisit(characterId, targetPlaceId, gameDate);

      eventService.addMessageForCharacter(
        { character, universe },
        {
          role: 'system',
          content: `Entered ${targetPlace.label}`,
          speaker: 'system',
          milestone: {
            type: 'location_entered',
            label: targetPlace.label,
            subtext: null,
            entityId: targetPlace.id,
            checkDetail: null,
            combatData: null,
          },
        },
        targetPlaceId,
      );
    } else {
      const playersAtDestination = universe.characters.filter(
        (c) =>
          (charService.isPlayerCharacter(c) || charService.isDesignatedPlayerCharacter(c)) &&
          c.position.parent === targetPlaceId,
      );

      for (const player of playersAtDestination) {
        const displayName = charService.computeDisplayName(character, player, universe);
        eventService.addMessageForCharacter(
          { character: player, universe },
          {
            role: 'system',
            content: `${displayName} arrived`,
            speaker: 'system',
            milestone: {
              type: 'character_arrived',
              label: displayName,
              subtext: null,
              entityId: character.id,
              checkDetail: null,
              combatData: null,
            },
          },
          targetPlaceId,
        );
      }
    }

    eventService.emitLocationUpdated(universe, characterId, 'movement');

    logger.info('MoveCharacterTool', `Character moved: ${character.label} -> ${targetPlace.label}`);

    return {
      success: true,
      characterId,
      characterLabel: character.label,
      previousLocation,
      newLocation: targetPlaceId,
      newLocationLabel: targetPlace.label,
      action: 'moved',
    };
  },
});
