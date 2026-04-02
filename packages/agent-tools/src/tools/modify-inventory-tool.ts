/**
 * Modify Inventory Tool
 *
 * Adds or removes items from a character's inventory.
 * This is a granular state change tool for item transactions.
 */

import { tool } from '@xanister/reagent';
import { z } from 'zod';
import type { ToolContext } from '../types.js';

export const modifyInventoryTool = tool({
  name: 'modify_inventory',
  description:
    "Add or remove an item from a character's inventory. " +
    'Use for picking up items, giving items, dropping items, or trading.',
  inputSchema: z.object({
    characterId: z.string().describe('Character ID (CHAR_xxx) whose inventory changes'),
    action: z.enum(['add', 'remove']).describe('Whether to add or remove the item'),
    item: z
      .string()
      .describe('Name of the item (e.g., "rusty key", "healing potion", "gold coins")'),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await -- reagent tool() requires async execute, all service calls are sync
  async execute(
    input: { characterId: string; action: 'add' | 'remove'; item: string },
    { context }: { context: ToolContext },
  ) {
    const { universe, services } = context;
    const { inventory, logger } = services;

    if (input.action === 'add') {
      const newInventory = inventory.addItem(universe, input.characterId, input.item);
      logger.info('ModifyInventoryTool', `Added "${input.item}" to ${input.characterId}`);
      return {
        success: true,
        characterId: input.characterId,
        action: 'add' as const,
        item: input.item,
        inventory: newInventory,
      };
    } else {
      const removed = inventory.removeItem(universe, input.characterId, input.item);
      if (removed) {
        logger.info('ModifyInventoryTool', `Removed "${input.item}" from ${input.characterId}`);
        return {
          success: true,
          characterId: input.characterId,
          action: 'remove' as const,
          item: input.item,
          removed: true,
        };
      } else {
        logger.warn(
          'ModifyInventoryTool',
          `Item "${input.item}" not found in ${input.characterId}'s inventory`,
        );
        return {
          success: false,
          characterId: input.characterId,
          action: 'remove' as const,
          item: input.item,
          removed: false,
          message: 'Item not found in inventory',
        };
      }
    }
  },
});
