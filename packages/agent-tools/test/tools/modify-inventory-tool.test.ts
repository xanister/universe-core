/**
 * Modify Inventory Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modifyInventoryTool } from '../../src/tools/modify-inventory-tool.js';
import { createMockToolContext } from '../helpers/mock-context.js';

describe('modifyInventoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds item to inventory and returns success', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.inventory.addItem).mockReturnValue(['sword', 'new_key']);

    const result = await modifyInventoryTool.execute(
      {
        characterId: 'CHAR_player',
        action: 'add',
        item: 'new_key',
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      characterId: 'CHAR_player',
      action: 'add',
      item: 'new_key',
      inventory: ['sword', 'new_key'],
    });
  });

  it('removes item from inventory successfully', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.inventory.removeItem).mockReturnValue(true);

    const result = await modifyInventoryTool.execute(
      {
        characterId: 'CHAR_player',
        action: 'remove',
        item: 'old_key',
      },
      { context },
    );

    expect(result).toEqual({
      success: true,
      characterId: 'CHAR_player',
      action: 'remove',
      item: 'old_key',
      removed: true,
    });
  });

  it('returns failure when item not found for removal', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.inventory.removeItem).mockReturnValue(false);

    const result = await modifyInventoryTool.execute(
      {
        characterId: 'CHAR_player',
        action: 'remove',
        item: 'nonexistent',
      },
      { context },
    );

    expect(result).toEqual({
      success: false,
      characterId: 'CHAR_player',
      action: 'remove',
      item: 'nonexistent',
      removed: false,
      message: 'Item not found in inventory',
    });
  });

  it('calls addItem with correct parameters', async () => {
    const context = createMockToolContext();

    await modifyInventoryTool.execute(
      {
        characterId: 'CHAR_a',
        action: 'add',
        item: 'gold coins',
      },
      { context },
    );

    expect(context.services.inventory.addItem).toHaveBeenCalledWith(
      context.universe,
      'CHAR_a',
      'gold coins',
    );
  });

  it('calls removeItem with correct parameters', async () => {
    const context = createMockToolContext();

    await modifyInventoryTool.execute(
      {
        characterId: 'CHAR_a',
        action: 'remove',
        item: 'torch',
      },
      { context },
    );

    expect(context.services.inventory.removeItem).toHaveBeenCalledWith(
      context.universe,
      'CHAR_a',
      'torch',
    );
  });

  it('logs inventory modification', async () => {
    const context = createMockToolContext();

    await modifyInventoryTool.execute(
      {
        characterId: 'CHAR_a',
        action: 'add',
        item: 'potion',
      },
      { context },
    );

    expect(context.services.logger.info).toHaveBeenCalledWith(
      'ModifyInventoryTool',
      expect.stringContaining('Added'),
    );
  });

  it('throws when operation fails', async () => {
    const context = createMockToolContext();
    vi.mocked(context.services.inventory.addItem).mockImplementation(() => {
      throw new Error('Character not found');
    });

    await expect(
      modifyInventoryTool.execute(
        {
          characterId: 'CHAR_invalid',
          action: 'add',
          item: 'item',
        },
        { context },
      ),
    ).rejects.toThrow('Character not found');
  });

  it('has correct tool metadata', () => {
    expect(modifyInventoryTool.name).toBe('modify_inventory');
    expect(modifyInventoryTool.description).toContain('inventory');
  });

  it('validates input with Zod schema', () => {
    const schema = modifyInventoryTool.inputSchema;

    // Valid add
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        action: 'add',
        item: 'sword',
      }),
    ).not.toThrow();

    // Valid remove
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        action: 'remove',
        item: 'key',
      }),
    ).not.toThrow();

    // Invalid action
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        action: 'drop',
        item: 'item',
      }),
    ).toThrow();

    // Missing item
    expect(() =>
      schema.parse({
        characterId: 'CHAR_a',
        action: 'add',
      }),
    ).toThrow();
  });
});
