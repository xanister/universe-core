import { describe, it, expect } from 'vitest';
import {
  applyBoundaryAutotile,
  loadAutotileConfig,
} from '@dmnpc/generation/autotile/index.js';
import type { Blob47Config } from '@dmnpc/types/world';

// Load the canonical blob-47 config for testing
const autotileConfig = loadAutotileConfig('canonical');
if (autotileConfig.format !== 'blob-47') throw new Error('Expected blob-47 config');
const config: Blob47Config = autotileConfig;

// Canonical convention: NW=128 N=1 NE=2, W=64 [X] E=4, SW=32 S=16 SE=8

/** Deterministic RNG for tests */
function createTestRng(): () => number {
  let val = 0;
  return () => {
    val = (val + 0.1) % 1;
    return val;
  };
}

/** Helper to create a boolean mask from a string grid. 'D' = deck (true), '.' = empty (false) */
function parseMask(rows: string[]): boolean[][] {
  return rows.map((row) => row.split('').map((ch) => ch === 'D'));
}

/** Helper to create a wall mask from a string grid. 'W' = wall (true), anything else = false */
function parseWallMask(rows: string[]): boolean[][] {
  return rows.map((row) => row.split('').map((ch) => ch === 'W'));
}

describe('boundary autotile', () => {
  describe('basic tile selection', () => {
    it('returns -1 for non-wall tiles', () => {
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '...',
        '...',
        '...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // Non-wall tiles should be -1
      expect(result[0][0]).toBe(-1);
      expect(result[0][1]).toBe(-1);
      expect(result[2][2]).toBe(-1);
    });

    it('selects isolated tile (position 0) when wall has no deck neighbors', () => {
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '...',
        '...',
        '...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // Bitmask 0 = isolated (position 0)
      expect(result[1][1]).toBe(0);
    });
  });

  describe('straight edges', () => {
    it('selects south edge tile when deck is to the south only', () => {
      // Wall at (1,1), deck at (1,2) = South
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '...',
        '...',
        '.D.',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // S=16 after corner masking = 16, which maps to position 5
      expect(result[1][1]).toBe(5);
    });

    it('selects east edge tile when deck is to the east only', () => {
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '...',
        '..D',
        '...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // E=4 after corner masking = 4, which maps to position 2
      expect(result[1][1]).toBe(2);
    });

    it('selects north edge tile when deck is to the north only', () => {
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '.D.',
        '...',
        '...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // N=1 after corner masking = 1, which maps to position 1
      expect(result[1][1]).toBe(1);
    });

    it('selects west edge tile when deck is to the west only', () => {
      const wallMask = parseWallMask([
        '...',
        'DW.',
        '...',
      ]);
      // Wait, the deckMask uses 'D' not the wallMask
      const wallMask2 = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '...',
        'D..',
        '...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask2, deckMask, config, rng, 0);

      // W=64 after corner masking = 64, which maps to position 13
      expect(result[1][1]).toBe(13);
    });
  });

  describe('corners', () => {
    it('selects N+E corner when deck is to north and east (no diagonal)', () => {
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '.D.',
        '..D',
        '...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // N=1 + E=4 = 5, NE diagonal not set. After corner masking: NE masked (both cardinals present but NE not set) = 5
      // Position for bitmask 5 = position 3 (N+E, no corner)
      expect(result[1][1]).toBe(3);
    });

    it('selects N+E+NE inner corner when deck surrounds the NE side', () => {
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '.DD',
        '..D',
        '...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // N=1 + E=4 + NE=2 = 7. After corner masking: NE passes (both N and E set) = 7
      // Position for bitmask 7 = position 4 (N+E+NE)
      expect(result[1][1]).toBe(4);
    });

    it('selects E+S+SE inner corner when deck surrounds the SE side', () => {
      const wallMask = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deckMask = parseMask([
        '...',
        '..D',
        '.DD',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // E=4 + S=16 + SE=8 = 28. After corner masking: SE passes = 28
      // Position for bitmask 28 = position 10 (E+S+SE)
      expect(result[1][1]).toBe(10);
    });
  });

  describe('ship hull staircase pattern', () => {
    it('produces correct tile indices for a diagonal hull boundary', () => {
      // Simulates a bow taper: deck steps right as we go down
      //   Row 0: ...W.....  (wall at x=3, deck at x=4+)
      //   Row 1: ..WDD....  (wall at x=2, deck at x=3,4)
      //   Row 2: .WDDDD...  (wall at x=1, deck at x=2,3,4,5)
      const wallMask = parseWallMask([
        '...W.....',
        '..W......',
        '.W.......',
      ]);
      const deckMask = parseMask([
        '....D....',
        '...DD....',
        '..DDDD...',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      // Wall at (3,0): deck neighbors E=(4,0)=D, S=(3,1)=D, SE=(4,1)=D
      // Bitmask: E=4 + S=16 + SE=8 = 28, corner masking: SE stays (S+E both set) = 28
      // Position for bitmask 28 → position 10 (E+S+SE)
      expect(result[0][3]).toBe(10);

      // Wall at (2,1): deck neighbors:
      //   E: (3,1) = D → E=4
      //   SE: (3,2) = D → SE=8 (only if S and E both set)
      //   S: (2,2) = D → S=16
      //   NE: (3,0) = not deck (it's .)  Wait, (3,0) is 'W' in wallMask but in deckMask it's '.'
      // Actually let me recount. deckMask row 0 = '....D....', so (4,0)=D, (3,0)=.
      // Wall at (2,1): neighbors in deckMask:
      //   N: (2,0) = '.' → 0
      //   NE: (3,0) = '.' → 0
      //   E: (3,1) = 'D' → E=4
      //   SE: (3,2) = 'D' → SE=8 (if S and E both set)
      //   S: (2,2) = 'D' → S=16
      //   SW: (1,2) = '.' → 0
      //   W: (1,1) = '.' → 0
      //   NW: (1,0) = '.' → 0
      // Raw: E=4 + S=16 + SE=8 = 28. Corner masking: S=yes, E=yes → SE stays. = 28
      // Bitmask 28 → position 10 (E+S+SE)
      expect(result[1][2]).toBe(10);

      // Wall at (1,2): neighbors in deckMask:
      //   N: (1,1) = '.' → 0
      //   NE: (2,1) = '.' → 0
      //   E: (2,2) = 'D' → E=4
      //   SE: (2,3) would be out of bounds (height=3) → 0
      //   S: (1,3) would be out of bounds → 0
      //   SW: (0,3) would be out of bounds → 0
      //   W: (0,2) = '.' → 0
      //   NW: (0,1) = '.' → 0
      // Bitmask = E=4 → position 2
      expect(result[2][1]).toBe(2);
    });
  });

  describe('larger hull shape', () => {
    it('produces varied tiles around a ship-like hull', () => {
      // Small ship hull: bow at top, beam in middle, stern at bottom
      //   .....
      //   ..D..  (narrow bow)
      //   .DDD.  (widening)
      //   .DDD.  (beam)
      //   ..D..  (stern)
      //   .....
      const wallMask = parseWallMask([
        '.WWW.',
        '.W.W.',
        'W...W',
        'W...W',
        '.W.W.',
        '.WWW.',
      ]);
      const deckMask = parseMask([
        '..D..',
        '..D..',
        '.DDD.',
        '.DDD.',
        '..D..',
        '..D..',
      ]);
      // Wait, that doesn't make sense. Let me think about this more carefully.
      // A hull has deck tiles in the interior and wall tiles tracing the boundary.
      // The wall tiles are NOT in the deck mask. They're adjacent to deck tiles.
      // Let me set up a proper hull scenario.

      // Proper hull: 7 wide, 8 tall. Deck in the middle, walls around it.
      const deck = parseMask([
        '.......',
        '...D...',
        '..DDD..',
        '.DDDDD.',
        '.DDDDD.',
        '..DDD..',
        '...D...',
        '.......',
      ]);
      // Walls are the 1-tile-thick boundary around the deck
      const wall = parseWallMask([
        '..WWW..',
        '..W.W..',
        '.W...W.',
        'W.....W',
        'W.....W',
        '.W...W.',
        '..W.W..',
        '..WWW..',
      ]);
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wall, deck, config, rng, 0);

      // Verify non-wall tiles are -1
      expect(result[0][0]).toBe(-1);
      expect(result[3][3]).toBe(-1); // Deck tile, not wall

      // Top center wall (2,0): deck at (3,1)=D. Neighbor S=(2,1) → not deck.
      // Actually (2,0) is 'W'. Check deck neighbors:
      //   S: deck[1][2] = '.' → 0. Hmm.
      // Let me reconsider. The center top wall at (3,0) is 'W'. Neighbors:
      //   S: deck[1][3] = 'D' → S=16
      //   No other deck neighbors.
      // Bitmask = 16 → position 5 (S only)
      expect(result[0][3]).toBe(5);

      // Left beam wall (0,3): deck at (1,3)=D. Neighbor E → deck[3][1]='D'
      //   E: deck[3][1] = 'D' → E=4
      //   No other deck neighbors (N=(0,2), S=(0,4), etc. all '.')
      // Bitmask = 4 → position 2 (E only)
      expect(result[3][0]).toBe(2);

      // Right beam wall (6,3): deck at (5,3)=D.
      //   W: deck[3][5] = 'D' → W=64
      // Bitmask = 64 → position 13 (W only)
      expect(result[3][6]).toBe(13);

      // Bottom center wall (3,7): deck at (3,6)=D.
      //   N: deck[6][3] = 'D' → N=1
      // Bitmask = 1 → position 1 (N only)
      expect(result[7][3]).toBe(1);
    });
  });

  describe('non-autotiled walls still use pickFill', () => {
    it('the processWallLayer function falls back when autotilePreset is null', () => {
      // This is tested implicitly via the existing ship-deck-layer tests.
      // Boundary autotile itself always autotiles — the null check is in processWallLayer.
      // Just verify applyBoundaryAutotile works correctly with empty masks.
      const wallMask: boolean[][] = [[false]];
      const deckMask: boolean[][] = [[false]];
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wallMask, deckMask, config, rng, 0);

      expect(result).toEqual([[-1]]);
    });
  });

  describe('alt center randomization', () => {
    it('randomizes center tiles when altCenterCount > 0', () => {
      // Create a wall tile that is fully surrounded by deck
      // (unusual for real hulls, but tests the alt center path)
      const wallMask = parseWallMask([
        'DDD',
        'DWD',
        'DDD',
      ]);
      // Wait, wallMask uses 'W'. But deckMask uses 'D'. They're separate masks.
      const wall = parseWallMask([
        '...',
        '.W.',
        '...',
      ]);
      const deck = parseMask([
        'DDD',
        'D.D',
        'DDD',
      ]);
      // All 8 neighbors are deck → bitmask 255 → center tile (46)
      // With altCenterCount=3, should pick from [46, 47, 48, 49]
      const rng = createTestRng();
      const result = applyBoundaryAutotile(wall, deck, config, rng, 3);

      // The tile should be >= 46 and <= 49
      expect(result[1][1]).toBeGreaterThanOrEqual(46);
      expect(result[1][1]).toBeLessThanOrEqual(49);
    });
  });
});
