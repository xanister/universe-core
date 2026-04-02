/**
 * Unit tests for slot placement algorithms.
 *
 * Tests the extensible placement system including:
 * - Placement algorithm registry
 * - Built-in placement algorithms (in_wall, random_valid, random, clustered, open_space, on_land, on_water)
 * - Slot positioning within generated shapes
 */

import { describe, it, expect, vi } from 'vitest';

const { mockGetAnyAllowedFacingsForPurpose, mockGetRandomSupportedFacing } = vi.hoisted(() => ({
  mockGetAnyAllowedFacingsForPurpose: vi.fn<
    (purpose: string, requiredTags?: string[], forbiddenTags?: string[]) => ('north' | 'south' | 'east' | 'west')[]
  >(() => ['north', 'south', 'east', 'west']),
  mockGetRandomSupportedFacing: vi.fn<
    (
      purpose: string,
      rng: () => number,
      requiredTags?: string[]
    ) => 'north' | 'south' | 'east' | 'west' | null
  >(() => null),
}));

vi.mock('@dmnpc/generation/place-layout/object-catalog.js', () => ({
  getAnyAllowedFacingsForPurpose: mockGetAnyAllowedFacingsForPurpose,
  getRandomSupportedFacing: mockGetRandomSupportedFacing,
}));

import {
  registerPlacementAlgorithm,
  getPlacementAlgorithm,
  getWalkableLayerIds,
  selectByDistribution,
  selectByDistributionWithDistrict,
  PLACEMENT_ALGORITHM_REGISTRY,
  type PlacementAlgorithmFn,
  type PlacementContext,
  type PositionedSlot,
} from '@dmnpc/generation/place-layout/algorithms/index.js';
import { computeFacingToward } from '@dmnpc/generation/place-layout/algorithms/placement-utils.js';
import type { LayoutSlot } from '@dmnpc/generation/place-layout/layout-templates.js';
import type {
  GeneratedShape,
  TerrainLayer,
  TerrainLayerConfig,
  LayoutVariant,
  ResolvedDistrict
} from '@dmnpc/types/world';
import { ENVIRONMENT_PRESETS } from '@dmnpc/types/world';

// Dummy variant with a room floor layer (needed by in_wall to identify floor tiles)
const DUMMY_VARIANT: LayoutVariant = {
  id: 'test',
  scale: 'feet',
  environment: ENVIRONMENT_PRESETS.interior(),
  width: { min: 20, max: 20 },
  height: { min: 20, max: 20 },
  terrainLayers: [
    {
      id: 'room',
      tilesetId: 'interior',
      type: 'rectangle',
      blocking: 'unblocks',
      terrain: 'land',
      renderOrder: 0,
      fill: [0],
      procedural: false,
    },
    {
      id: 'walls',
      tilesetId: 'lpc-interior-walls',
      type: 'wall',
      blocking: 'blocks',
      terrain: 'wall',
      renderOrder: 100,
      fill: [],
      procedural: false,
      wallStyle: 'brick_brown',
      inheritable: false,
    },
  ],
  slots: [],
  description: 'test variant',
  weight: 1,
  defaultBlocked: false,
};

// Helper to create a simple test shape
function createTestShape(width: number, height: number): GeneratedShape {
  const blockedMask: boolean[][] = [];
  const wallTiles: number[][] = [];

  for (let y = 0; y < height; y++) {
    blockedMask[y] = [];
    wallTiles[y] = [];
    for (let x = 0; x < width; x++) {
      // Create blocked mask: walls on the perimeter are blocked, interior is passable
      const isWall = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      blockedMask[y][x] = isWall; // walls are blocked, interior is passable
      wallTiles[y][x] = isWall ? 1 : -1; // 1 = wall tile
    }
  }

  // Convert wallTiles to a TerrainLayer
  const layers: TerrainLayer[] = [];
  const hasWalls = wallTiles.some((row) => row.some((tile) => tile >= 0));
  if (hasWalls) {
    layers.push({
      id: 'walls',
      tilesetId: 'interior',
      tilesetOffset: 0,
      tiles: wallTiles,
      depth: 100,
    });
  }

  // Build wall mask and floor mask for layer-aware placement
  const wallMask: boolean[][] = [];
  const floorMask: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    wallMask[y] = [];
    floorMask[y] = [];
    for (let x = 0; x < width; x++) {
      const isWall = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      wallMask[y][x] = isWall;
      floorMask[y][x] = !isWall;
    }
  }

  return {
    blockedMask,
    layers,
    bounds: { x: 0, y: 0, width, height },
    terrainGrid: null,
    layerMasks: { walls: wallMask, room: floorMask },
    roadGraph: null,
    caveGraph: null,
    districts: null,
  };
}

// Helper to create slot with purpose string
function createSlot(
  purpose: string,
  options: {
    min?: number;
    max?: number;
    positionAlgorithm?: string;
    nearPurpose?: string;
    distribution?: string;
    facesAnchor?: boolean;
  } = {}
): LayoutSlot {
  return {
    purpose,
    positionAlgorithm: (options.positionAlgorithm ??
      'random_valid') as LayoutSlot['positionAlgorithm'],
    distribution: (options.distribution ?? 'even') as LayoutSlot['distribution'],
    requiredTags: null,
    forbiddenTags: null,
    inheritableTags: null,
    min: options.min ?? null,
    max: options.max ?? null,
    nearPurpose: options.nearPurpose ?? null,
    slotSize: { width: 1, height: 1 },
    visualClearanceAbove: null,
    preferDistrict: null,
    distributionGroup: null,
    flags: {
      isStructural: false,
      facesAnchor: options.facesAnchor ?? false,
      useLlmSelection: false,
    },
  };
}

// Helper to build a PlacementContext from common test parameters
function createCtx(
  shape: GeneratedShape,
  slots: LayoutSlot[],
  seed: number,
  variant: LayoutVariant,
  occupiedTiles: Set<string>,
  placedSlots: PositionedSlot[] = [],
  placementBounds?: { x: number; y: number; width: number; height: number }
): PlacementContext {
  return {
    shape,
    slots,
    seed,
    variant,
    occupiedTiles,
    placedSlots,
    placementBounds: placementBounds ?? shape.bounds,
  };
}

describe('Placement Algorithm Registry', () => {
  describe('registerPlacementAlgorithm', () => {
    it('registers a custom placement algorithm', () => {
      const customPlacement: PlacementAlgorithmFn = (ctx) => {
        return ctx.slots.map((slot, i) => ({
          slot,
          x: i * 10,
          y: i * 10,
          width: 32,
          height: 32,
        }));
      };

      registerPlacementAlgorithm('test_custom' as 'random', customPlacement);

      expect(getPlacementAlgorithm('test_custom' as 'random')).toBeDefined();
    });
  });

  describe('getPlacementAlgorithm', () => {
    it('returns registered built-in algorithms', () => {
      expect(getPlacementAlgorithm('in_wall')).toBeDefined();
      expect(getPlacementAlgorithm('random_valid')).toBeDefined();
      expect(getPlacementAlgorithm('random')).toBeDefined();
      expect(getPlacementAlgorithm('clustered')).toBeDefined();
      expect(getPlacementAlgorithm('open_space')).toBeDefined();
      expect(getPlacementAlgorithm('on_land')).toBeDefined();
      expect(getPlacementAlgorithm('on_water')).toBeDefined();
      expect(getPlacementAlgorithm('on_coast')).toBeDefined();
      expect(getPlacementAlgorithm('against_wall')).toBeDefined();
      expect(getPlacementAlgorithm('near_slot')).toBeDefined();
      expect(getPlacementAlgorithm('center_floor')).toBeDefined();
    });

    it('does not have zone_based registered', () => {
      expect(getPlacementAlgorithm('zone_based' as 'random')).toBeUndefined();
    });
  });
});

describe('Built-in Placement Algorithms', () => {
  const testShape = createTestShape(20, 20);

  const testSlots: LayoutSlot[] = [
    createSlot('seating', { min: 2, max: 4 }),
    createSlot('table', { min: 1, max: 2 }),
    createSlot('lighting', { min: 1, max: 3 }),
  ];

  describe('in_wall algorithm', () => {
    it('places slots on floor-edge tiles', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      expect(algorithm).toBeDefined();

      const exitSlots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];
      const positioned = algorithm!(
        createCtx(testShape, exitSlots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(1);

      // Position should be at the edge of the floor area (20x20 shape, floor rows 1-18 cols 1-18)
      const pos = positioned[0];
      const isFloorEdge = pos.x === 1 || pos.x === 18 || pos.y === 18;
      expect(isFloorEdge).toBe(true);
    });

    it('respects slot min/max counts', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      const slots: LayoutSlot[] = [createSlot('exit', { min: 2, max: 2 })];
      const positioned = algorithm!(
        createCtx(testShape, slots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(2);

      for (const pos of positioned) {
        const isFloorEdge = pos.x === 1 || pos.x === 18 || pos.y === 18;
        expect(isFloorEdge).toBe(true);
      }
    });

    it('generates consistent results with same seed', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      const slots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];
      const result1 = algorithm!(createCtx(testShape, slots, 42, DUMMY_VARIANT, new Set<string>()));
      const result2 = algorithm!(createCtx(testShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(result1.length).toBe(result2.length);
      expect(result1[0].x).toBe(result2[0].x);
      expect(result1[0].y).toBe(result2[0].y);
    });

    it('throws when variant has no wall-type terrain layer (BUG-121)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      // Variant with no wall-type layer
      const noWallVariant: LayoutVariant = {
        ...DUMMY_VARIANT,
        terrainLayers: [DUMMY_VARIANT.terrainLayers[0]], // floor only, no wall
      };

      const noWallShape: GeneratedShape = {
        blockedMask: Array.from({ length: 10 }, () => Array(10).fill(false) as boolean[]),
        layers: [],
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        terrainGrid: null,
        layerMasks: {},
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      const slots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];
      expect(() =>
        algorithm!(createCtx(noWallShape, slots, 12345, noWallVariant, new Set<string>()))
      ).toThrow('in_wall placement requires a terrain layer with type: "wall"');
    });

    // BUG-121 / BUG-135: in_wall must resolve wall layer by type, not hardcoded id
    it('resolves wall layer by type when wall layer id is not "walls" (BUG-121)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      const width = 10;
      const height = 10;
      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];

      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        for (let x = 0; x < width; x++) {
          const isWall = x === 0 || y === 0 || x === width - 1 || y === height - 1;
          wallMask[y][x] = isWall;
          floorMask[y][x] = !isWall;
        }
      }

      // Wall layer uses non-standard id "bulkhead_walls"
      const bulkheadVariant: LayoutVariant = {
        ...DUMMY_VARIANT,
        terrainLayers: [
          DUMMY_VARIANT.terrainLayers[0],
          { ...DUMMY_VARIANT.terrainLayers[1], id: 'bulkhead_walls' },
        ],
      };

      const shape: GeneratedShape = {
        blockedMask: wallMask.map((row) => row.map((v) => v)),
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { bulkhead_walls: wallMask, room: floorMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      const slots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];
      const positioned = algorithm!(
        createCtx(shape, slots, 12345, bulkheadVariant, new Set<string>())
      );

      expect(positioned.length).toBe(1);

      // Should be on a floor-edge tile (10x10 shape, floor rows 1-8 cols 1-8)
      const pos = positioned[0];
      const isFloorEdge = pos.x === 1 || pos.x === 8 || pos.y === 8;
      expect(isFloorEdge).toBe(true);
    });

    it('throws when required slots exceed available wall tiles', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      // 3x3 shape: walls are perimeter, interior is 1 tile. Wall tiles adjacent to passable = 4 (N/S/E/W of center)
      const tinyShape = createTestShape(3, 3);

      // Request more exit slots than wall boundary tiles
      const slots: LayoutSlot[] = [createSlot('exit', { min: 5, max: 5 })];

      expect(() =>
        algorithm!(createCtx(tinyShape, slots, 12345, DUMMY_VARIANT, new Set<string>()))
      ).toThrow('Cannot place required in_wall slot');
    });

    it('ignores blocking background layers when finding wall boundary tiles (FEAT-111)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      // Shape with both floor mask (room) and a full-coverage background mask (ocean)
      const width = 10;
      const height = 10;
      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];
      const oceanMask: boolean[][] = [];

      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        oceanMask[y] = [];
        for (let x = 0; x < width; x++) {
          const isWall = x === 0 || y === 0 || x === width - 1 || y === height - 1;
          wallMask[y][x] = isWall;
          floorMask[y][x] = !isWall;
          oceanMask[y][x] = true; // Ocean covers everything
        }
      }

      const shape: GeneratedShape = {
        blockedMask: Array.from({ length: height }, (_, y) =>
          Array.from(
            { length: width },
            (_, x) => x === 0 || y === 0 || x === width - 1 || y === height - 1
          )
        ),
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { walls: wallMask, room: floorMask, ocean: oceanMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      // Variant with a blocking ocean fill layer AND an unblocking room layer
      const variantWithOcean: LayoutVariant = {
        ...DUMMY_VARIANT,
        terrainLayers: [
          {
            id: 'ocean',
            tilesetId: 'blob47-ocean',
            tilesetOffset: null,
            type: 'fill',
            blocking: 'blocks',
            terrain: 'water',
            renderOrder: 0,
            fill: [0],
            procedural: false,
          },
          {
            id: 'room',
            tilesetId: 'interior',
            tilesetOffset: null,
            type: 'rectangle',
            blocking: 'unblocks',
            terrain: 'land',
            renderOrder: 1,
            fill: [0],
            procedural: false,
          },
          {
            id: 'walls',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            type: 'wall',
            blocking: 'blocks',
            terrain: 'wall',
            renderOrder: 2,
            fill: [],
            procedural: false,
            wallStyle: 'brick_brown',
            inheritable: false,
          },
        ],
      };

      const exitSlots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];

      // Should NOT throw — the ocean layer should be ignored when computing floor tiles
      const positioned = algorithm!(
        createCtx(shape, exitSlots, 12345, variantWithOcean, new Set<string>())
      );
      expect(positioned.length).toBe(1);
      // Exit should be on a floor-edge tile (10x10, floor rows 1-8 cols 1-8)
      const pos = positioned[0];
      const isFloorEdge = pos.x === 1 || pos.x === 8 || pos.y === 8;
      expect(isFloorEdge).toBe(true);
    });

    it('places north-wall doors on floor below face when wall_face layer exists (FEAT-270)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      const width = 20;
      const height = 20;

      // Standard room with perimeter wall + wall_face.
      // North wall candidates appear at northPlacementRow (row 4).
      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];
      const wallFaceMask: boolean[][] = [];
      const blockedMask: boolean[][] = [];

      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        wallFaceMask[y] = [];
        blockedMask[y] = [];
        for (let x = 0; x < width; x++) {
          const isPerimeter = x === 0 || y === 0 || x === width - 1 || y === height - 1;
          wallMask[y][x] = isPerimeter;
          floorMask[y][x] = !isPerimeter;
          blockedMask[y][x] = isPerimeter;
          wallFaceMask[y][x] = !isPerimeter && y >= 1 && y <= 3;
        }
      }

      const variantWithFace: LayoutVariant = {
        ...DUMMY_VARIANT,
        terrainLayers: [
          DUMMY_VARIANT.terrainLayers[0],
          DUMMY_VARIANT.terrainLayers[1],
          {
            id: 'wall_faces',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            type: 'wall_face' as const,
            blocking: 'blocks' as const,
            terrain: 'wall' as const,
            renderOrder: 1,
            wallLayerId: 'walls',
            roomLayerId: 'room',
            wallStyle: 'brick_brown',
          },
        ],
      };

      const shape: GeneratedShape = {
        blockedMask,
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { walls: wallMask, room: floorMask, wall_faces: wallFaceMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      // Place enough to ensure spread; verify at least one is on north wall
      const slots: LayoutSlot[] = [createSlot('exit', { min: 6, max: 6 })];
      const positioned = algorithm!(createCtx(shape, slots, 1, variantWithFace, new Set<string>()));

      expect(positioned.length).toBe(6);
      const northWallSlots = positioned.filter((p) => p.y === 4 && p.facing === 'south');
      expect(northWallSlots.length).toBeGreaterThan(0);
      for (const s of northWallSlots) {
        expect(s.layer).toBe('default');
      }
    });

    it('assigns wall layer to non-north-wall doors, default to north-wall doors (BUG-171)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      const width = 20;
      const height = 20;

      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];
      const wallFaceMask: boolean[][] = [];
      const blockedMask: boolean[][] = [];

      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        wallFaceMask[y] = [];
        blockedMask[y] = [];
        for (let x = 0; x < width; x++) {
          const isPerimeter = x === 0 || y === 0 || x === width - 1 || y === height - 1;
          wallMask[y][x] = isPerimeter;
          floorMask[y][x] = !isPerimeter;
          blockedMask[y][x] = isPerimeter;
          wallFaceMask[y][x] = !isPerimeter && y >= 1 && y <= 3;
        }
      }

      const variantWithFace: LayoutVariant = {
        ...DUMMY_VARIANT,
        terrainLayers: [
          DUMMY_VARIANT.terrainLayers[0],
          DUMMY_VARIANT.terrainLayers[1],
          {
            id: 'wall_faces',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            type: 'wall_face' as const,
            blocking: 'blocks' as const,
            terrain: 'wall' as const,
            renderOrder: 1,
            wallLayerId: 'walls',
            roomLayerId: 'room',
            wallStyle: 'brick_brown',
          },
        ],
      };

      const shape: GeneratedShape = {
        blockedMask,
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { walls: wallMask, room: floorMask, wall_faces: wallFaceMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      const slots: LayoutSlot[] = [createSlot('exit', { min: 6, max: 6 })];
      const positioned = algorithm!(createCtx(shape, slots, 1, variantWithFace, new Set<string>()));

      expect(positioned.length).toBe(6);

      // South, east, and west wall doors use 'wall' layer (fixed depth above player).
      // Both object and child-place pipelines fall back to slot.layer when the sprite
      // has no defaultLayer, so this propagates to both (BUG-171).
      const nonNorthSlots = positioned.filter((p) => p.facing !== 'south');
      expect(nonNorthSlots.length).toBeGreaterThan(0);
      for (const s of nonNorthSlots) {
        expect(s.layer).toBe('wall');
      }

      // North wall doors (south-facing) keep Y-sorted 'default' layer for
      // correct top-down perspective.
      const northSlots = positioned.filter((p) => p.facing === 'south');
      for (const s of northSlots) {
        expect(s.layer).toBe('default');
      }
    });

    it('does not produce north-wall candidates without wall_face layer (FEAT-270)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      const width = 20;
      const height = 20;

      // Standard room with perimeter wall but NO wall_face.
      // North wall check uses wallMask which has no tiles at row 3 interior.
      // South/east/west still produce candidates via floor boundaries.
      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];
      const blockedMask: boolean[][] = [];

      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        blockedMask[y] = [];
        for (let x = 0; x < width; x++) {
          const isPerimeter = x === 0 || y === 0 || x === width - 1 || y === height - 1;
          wallMask[y][x] = isPerimeter;
          floorMask[y][x] = !isPerimeter;
          blockedMask[y][x] = isPerimeter;
        }
      }

      const shape: GeneratedShape = {
        blockedMask,
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { walls: wallMask, room: floorMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      const slots: LayoutSlot[] = [createSlot('exit', { min: 4, max: 4 })];
      const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned.length).toBe(4);
      // No north wall candidates (no face mask, wallMask interior row 3 is false)
      const northWallSlots = positioned.filter((p) => p.y === 4 && p.facing === 'south');
      expect(northWallSlots.length).toBe(0);
    });

    it('spreads doors across multiple walls when all walls have candidates (FEAT-270)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      const width = 20;
      const height = 20;

      // Standard rectangular room with perimeter wall + wall_face.
      // All 4 walls should produce candidates.
      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];
      const wallFaceMask: boolean[][] = [];
      const blockedMask: boolean[][] = [];

      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        wallFaceMask[y] = [];
        blockedMask[y] = [];
        for (let x = 0; x < width; x++) {
          const isPerimeter = x === 0 || y === 0 || x === width - 1 || y === height - 1;
          wallMask[y][x] = isPerimeter;
          floorMask[y][x] = !isPerimeter;
          blockedMask[y][x] = isPerimeter;
          // Face tiles: 3 rows below the north wall edge (rows 1-3, interior cols)
          wallFaceMask[y][x] = !isPerimeter && y >= 1 && y <= 3;
        }
      }

      const variantWithFace: LayoutVariant = {
        ...DUMMY_VARIANT,
        terrainLayers: [
          DUMMY_VARIANT.terrainLayers[0],
          DUMMY_VARIANT.terrainLayers[1],
          {
            id: 'wall_faces',
            tilesetId: 'lpc-interior-walls',
            tilesetOffset: null,
            type: 'wall_face' as const,
            blocking: 'blocks' as const,
            terrain: 'wall' as const,
            renderOrder: 1,
            wallLayerId: 'walls',
            roomLayerId: 'room',
            wallStyle: 'brick_brown',
          },
        ],
      };

      const shape: GeneratedShape = {
        blockedMask,
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { walls: wallMask, room: floorMask, wall_faces: wallFaceMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      // Place 4 doors — 'even' distribution should spread them across walls
      const slots: LayoutSlot[] = [createSlot('exit', { min: 4, max: 4 })];
      const positioned = algorithm!(
        createCtx(shape, slots, 42, variantWithFace, new Set<string>())
      );

      expect(positioned.length).toBe(4);

      // Categorize by wall: north (facing south, layer default), south (facing north),
      // east (facing west), west (facing east)
      const walls = positioned.map((p) => p.facing);
      const uniqueWalls = new Set(walls);
      // With 4 doors and 'even' distribution, at least 2 different walls should be used
      expect(uniqueWalls.size).toBeGreaterThanOrEqual(2);
    });

    it('produces candidates on all walls in L-shape rooms (FEAT-270)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      const width = 16;
      const height = 16;

      // L-shape with inset=1, NE cutout. Floor-based boundary detection
      // should find east (left edge), west (right edge), and south candidates.
      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];
      const blockedMask: boolean[][] = [];

      const cutWidth = 5;
      const cutHeight = 4;
      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        blockedMask[y] = [];
        for (let x = 0; x < width; x++) {
          const inInterior = x >= 1 && x <= width - 2 && y >= 1 && y <= height - 2;
          const inCutout = x >= width - 1 - cutWidth && y < 1 + cutHeight;
          floorMask[y][x] = inInterior && !inCutout;
          blockedMask[y][x] = !floorMask[y][x];
          // Wall mask only needed for initial layer check; floor-based
          // detection doesn't use it for boundary scanning
          wallMask[y][x] =
            !floorMask[y][x] &&
            ((floorMask[y - 1]?.[x] ?? false) ||
              (floorMask[y + 1]?.[x] ?? false) ||
              (floorMask[y]?.[x - 1] ?? false) ||
              (floorMask[y]?.[x + 1] ?? false));
        }
      }

      const shape: GeneratedShape = {
        blockedMask,
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { walls: wallMask, room: floorMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      const slots: LayoutSlot[] = [createSlot('exit', { min: 6, max: 6 })];
      const positioned = algorithm!(createCtx(shape, slots, 100, DUMMY_VARIANT, new Set<string>()));

      expect(positioned.length).toBe(6);
      // With floor-based detection and 'even' distribution, 6 doors across
      // ~33 candidates should spread to at least 2 different walls.
      const facings = new Set(positioned.map((p) => p.facing));
      expect(facings.size).toBeGreaterThanOrEqual(2);
    });

    it('excludes L-shape step boundaries via straight-segment check (FEAT-270)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      const width = 14;
      const height = 14;

      // L-shape: NE cutout. The west (right) wall edge shifts at the step
      // boundary. Floor-based straight-segment check rejects those rows.
      const wallMask: boolean[][] = [];
      const floorMask: boolean[][] = [];

      const cutWidth = 4;
      const cutHeight = 4;
      for (let y = 0; y < height; y++) {
        wallMask[y] = [];
        floorMask[y] = [];
        for (let x = 0; x < width; x++) {
          const inInterior = x >= 1 && x <= 12 && y >= 1 && y <= 12;
          const inCutout = x >= 9 && y < 1 + cutHeight;
          floorMask[y][x] = inInterior && !inCutout;
          wallMask[y][x] =
            !floorMask[y][x] &&
            ((floorMask[y - 1]?.[x] ?? false) ||
              (floorMask[y + 1]?.[x] ?? false) ||
              (floorMask[y]?.[x - 1] ?? false) ||
              (floorMask[y]?.[x + 1] ?? false));
        }
      }

      const shape: GeneratedShape = {
        blockedMask: floorMask.map((row) => row.map((v) => !v)),
        layers: [],
        bounds: { x: 0, y: 0, width, height },
        terrainGrid: null,
        layerMasks: { walls: wallMask, room: floorMask },
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };

      const slots: LayoutSlot[] = [createSlot('exit', { min: 4, max: 4 })];
      const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned.length).toBe(4);

      // West wall rightmost floor col shifts at the L-step (row 4/5 boundary).
      // Above step: rightFloorCol = 8. Below step: rightFloorCol = 12.
      // Rows where edge shifts should NOT have west-wall placements.
      // (facing 'east' = west wall candidate via OPPOSITE_WALL)
      const westWallSlots = positioned.filter((p) => p.facing === 'east');
      for (const slot of westWallSlots) {
        // West wall candidates should be on a straight section, not the step rows
        const localY = slot.y;
        const rightAbove = floorMask[localY - 1] ? floorMask[localY - 1].lastIndexOf(true) : -1;
        const rightHere = floorMask[localY] ? floorMask[localY].lastIndexOf(true) : -1;
        const rightBelow = floorMask[localY + 1] ? floorMask[localY + 1].lastIndexOf(true) : -1;
        expect(rightAbove).toBe(rightHere);
        expect(rightBelow).toBe(rightHere);
      }
    });

    it('skips walls whose facing is not supported by candidate sprites (BUG-175)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      // Mock: candidate sprites only support south and east (no north or west)
      // South wall facing = north → excluded
      // West wall facing = east → allowed
      // East wall facing = west → excluded
      // North wall facing = south → allowed
      mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['south', 'east']);

      const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 4 })];
      const positioned = algorithm!(
        createCtx(testShape, slots, 99, DUMMY_VARIANT, new Set<string>())
      );

      // All placed slots should only have facings in the allowed set
      for (const pos of positioned) {
        expect(['south', 'east']).toContain(pos.facing);
      }

      // Restore mock
      mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);
    });

    it('places zero slots when no wall facing is supported (BUG-175)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      // Mock: candidate sprites only support north — no wall produces north facing
      // (north wall → south, south wall → north is excluded, east wall → west is excluded,
      //  west wall → east is excluded). Only north wall → south, which is also excluded.
      // Actually: north facing means facing toward the top of screen. OPPOSITE_WALL
      // doesn't map any wall side to 'north' except south wall. But we return only
      // 'north' so only south wall candidates survive... wait: south wall → facing north.
      // So supporting only 'north' means only south wall tiles pass the filter.
      // Let's use a facing that no wall produces instead.
      // Actually, all four wall sides are covered. Let's just use an empty set.
      mockGetAnyAllowedFacingsForPurpose.mockReturnValue([]);

      const slots: LayoutSlot[] = [createSlot('decoration', { min: 0, max: 4 })];
      const positioned = algorithm!(
        createCtx(testShape, slots, 42, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(0);

      // Restore mock
      mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);
    });

    // BUG-121: in_wall must apply defaultRequiredTags: ['wall'] when slot.requiredTags is null
    it('applies defaultRequiredTags wall when slot.requiredTags is null (BUG-121)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      // Slot with requiredTags: null — effective required tags should be ['wall']
      const slots: LayoutSlot[] = [createSlot('decoration', { min: 0, max: 2 })];
      mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['south', 'east', 'west']);

      algorithm!(createCtx(testShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      // Must be called with effective required tags ['wall'], not undefined
      expect(mockGetAnyAllowedFacingsForPurpose).toHaveBeenCalledWith('decoration', ['wall']);

      mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);
    });

    it('uses slot.requiredTags when explicitly set, not the default (BUG-121)', () => {
      const algorithm = getPlacementAlgorithm('in_wall');

      const slot = createSlot('decoration', { min: 0, max: 2 });
      slot.requiredTags = ['ship', 'wall']; // explicit override
      const slots: LayoutSlot[] = [slot];
      mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['south', 'east', 'west']);

      algorithm!(createCtx(testShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      // Uses slot's explicit requiredTags, not the default ['wall']
      expect(mockGetAnyAllowedFacingsForPurpose).toHaveBeenCalledWith('decoration', ['ship', 'wall']);

      mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);
    });
  });

  describe('random_valid algorithm', () => {
    it('places slots on passable tiles', () => {
      const algorithm = getPlacementAlgorithm('random_valid');
      expect(algorithm).toBeDefined();

      const positioned = algorithm!(
        createCtx(testShape, testSlots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBeGreaterThan(0);

      // All positioned slots should be on passable tiles (not walls)
      for (const pos of positioned) {
        const lx = pos.x - testShape.bounds.x;
        const ly = pos.y - testShape.bounds.y;
        expect(testShape.blockedMask[ly]?.[lx]).toBe(false);
      }
    });

    it('respects slot min/max counts', () => {
      const algorithm = getPlacementAlgorithm('random_valid');

      const singleSlot: LayoutSlot[] = [createSlot('anchor', { min: 1, max: 1 })];
      const positioned = algorithm!(
        createCtx(testShape, singleSlot, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(1);
    });

    it('generates consistent results with same seed', () => {
      const algorithm = getPlacementAlgorithm('random_valid');

      const result1 = algorithm!(
        createCtx(testShape, testSlots, 42, DUMMY_VARIANT, new Set<string>())
      );
      const result2 = algorithm!(
        createCtx(testShape, testSlots, 42, DUMMY_VARIANT, new Set<string>())
      );

      expect(result1.length).toBe(result2.length);

      for (let i = 0; i < result1.length; i++) {
        expect(result1[i].x).toBe(result2[i].x);
        expect(result1[i].y).toBe(result2[i].y);
      }
    });

    it('throws when required slots exceed passable tiles', () => {
      const algorithm = getPlacementAlgorithm('random_valid');
      const smallShape = createTestShape(3, 3); // Only 1 interior tile

      const manySlots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];

      expect(() =>
        algorithm!(createCtx(smallShape, manySlots, 12345, DUMMY_VARIANT, new Set<string>()))
      ).toThrow('Cannot place required slot');
    });
  });

  describe('random algorithm', () => {
    it('places slots on passable floor tiles (not walls or void)', () => {
      const algorithm = getPlacementAlgorithm('random');
      expect(algorithm).toBeDefined();

      const positioned = algorithm!(
        createCtx(testShape, testSlots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBeGreaterThan(0);

      // All slots must be on passable tiles (blockedMask === false)
      for (const pos of positioned) {
        const lx = pos.x - testShape.bounds.x;
        const ly = pos.y - testShape.bounds.y;
        expect(testShape.blockedMask[ly]?.[lx]).toBe(false);
      }
    });

    it('produces different results with different seeds', () => {
      const algorithm = getPlacementAlgorithm('random');

      const result1 = algorithm!(
        createCtx(testShape, testSlots, 100, DUMMY_VARIANT, new Set<string>())
      );
      const result2 = algorithm!(
        createCtx(testShape, testSlots, 200, DUMMY_VARIANT, new Set<string>())
      );

      // Just verify both produce valid output
      expect(result1.length).toBeGreaterThan(0);
      expect(result2.length).toBeGreaterThan(0);
    });

    it('is an alias for random_valid (same implementation after BUG-046)', () => {
      const random = getPlacementAlgorithm('random');
      const randomValid = getPlacementAlgorithm('random_valid');
      expect(random).toBe(randomValid);
    });
  });

  describe('clustered algorithm', () => {
    it('groups slots by purpose', () => {
      const algorithm = getPlacementAlgorithm('clustered');
      expect(algorithm).toBeDefined();

      const positioned = algorithm!(
        createCtx(testShape, testSlots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBeGreaterThan(0);

      // All positioned slots should be valid
      for (const pos of positioned) {
        expect(pos.slot).toBeDefined();
        expect(pos.slot.purpose).toBeDefined();
        expect(pos.slot.purpose).toBeTruthy();
      }
    });

    it('handles slots with same purpose by clustering them', () => {
      const algorithm = getPlacementAlgorithm('clustered');

      const sameTypeSlots: LayoutSlot[] = [
        createSlot('seating', { min: 4, max: 4 }),
        createSlot('seating', { min: 4, max: 4 }),
      ];

      const positioned = algorithm!(
        createCtx(testShape, sameTypeSlots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      const seatingPositions = positioned.filter((p) => p.slot.purpose === 'seating');

      // Should have placed multiple seating slots
      expect(seatingPositions.length).toBeGreaterThan(0);
    });
  });
});

describe('Placement Edge Cases', () => {
  describe('empty slots', () => {
    it('returns empty array for no slots', () => {
      const algorithm = getPlacementAlgorithm('random_valid');
      const shape = createTestShape(10, 10);

      const positioned = algorithm!(createCtx(shape, [], 12345, DUMMY_VARIANT, new Set<string>()));

      expect(positioned).toEqual([]);
    });
  });

  describe('small shapes', () => {
    it('handles very small shapes gracefully', () => {
      const algorithm = getPlacementAlgorithm('random');
      const tinyShape = createTestShape(5, 5);

      const slots: LayoutSlot[] = [createSlot('anchor', { min: 1, max: 1 })];

      const positioned = algorithm!(
        createCtx(tinyShape, slots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      // Should still place what it can
      expect(positioned.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('more slots than space', () => {
    it('throws when required slots exceed available space', () => {
      const algorithm = getPlacementAlgorithm('random_valid');
      const smallShape = createTestShape(3, 3); // Only 1 interior tile

      const manySlots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];

      expect(() =>
        algorithm!(createCtx(smallShape, manySlots, 12345, DUMMY_VARIANT, new Set<string>()))
      ).toThrow('Cannot place required slot');
    });
  });
});

describe('PositionedSlot structure', () => {
  it('includes slot reference with purpose string', () => {
    const algorithm = getPlacementAlgorithm('random_valid');
    const shape = createTestShape(15, 15);

    const slots: LayoutSlot[] = [createSlot('anchor', { min: 1, max: 1 })];

    const positioned = algorithm!(createCtx(shape, slots, 12345, DUMMY_VARIANT, new Set<string>()));

    if (positioned.length > 0) {
      const first = positioned[0];

      expect(first).toHaveProperty('slot');
      expect(first).toHaveProperty('x');
      expect(first).toHaveProperty('y');
      expect(first).toHaveProperty('width');
      expect(first).toHaveProperty('height');
      expect(first.slot.purpose).toBe('anchor');
    }
  });
});

describe('Slot min/max Guarantee System', () => {
  // Use a larger shape to ensure enough tiles are available
  const largeShape = createTestShape(30, 30);

  describe('min guarantees placement', () => {
    it('places exactly min when min === max', () => {
      const algorithm = getPlacementAlgorithm('random');

      const slots: LayoutSlot[] = [createSlot('seating', { min: 2, max: 2 })];

      const positioned = algorithm!(
        createCtx(largeShape, slots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(2);
    });

    it('exit slots with min=1 always place exactly one', () => {
      const algorithm = getPlacementAlgorithm('in_wall');
      const testShape = createTestShape(20, 20);

      const slots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];

      // Test multiple seeds to ensure consistency
      for (const seed of [1, 100, 999, 12345]) {
        const positioned = algorithm!(
          createCtx(testShape, slots, seed, DUMMY_VARIANT, new Set<string>())
        );
        expect(positioned.length).toBe(1);
      }
    });
  });

  describe('max limits placements', () => {
    it('places up to max when tiles available', () => {
      const algorithm = getPlacementAlgorithm('random');

      const slots: LayoutSlot[] = [createSlot('decoration', { min: 1, max: 3 })];

      const positioned = algorithm!(
        createCtx(largeShape, slots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(3);
    });
  });

  describe('default values', () => {
    it('places all slots up to max by default', () => {
      const algorithm = getPlacementAlgorithm('random');

      const slots: LayoutSlot[] = [createSlot('lighting', { min: 2, max: 2 })];

      const positioned = algorithm!(
        createCtx(largeShape, slots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(2);
    });

    it('with no min, places up to max when tiles available', () => {
      const algorithm = getPlacementAlgorithm('random');

      const slots: LayoutSlot[] = [createSlot('decoration', { max: 5 })];

      const positioned = algorithm!(
        createCtx(largeShape, slots, 12345, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned.length).toBe(5);
    });
  });
});

describe('Purpose String', () => {
  it('slot has a single purpose string', () => {
    const algorithm = getPlacementAlgorithm('random_valid');
    const shape = createTestShape(15, 15);

    // Slot that could be either a tavern or inn
    const slots: LayoutSlot[] = [createSlot('tavern', { min: 1, max: 1 })];

    const positioned = algorithm!(createCtx(shape, slots, 12345, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(1);
    expect(positioned[0].slot.purpose).toBe('tavern');
  });

  it('positioned slot retains purpose for later selection', () => {
    const algorithm = getPlacementAlgorithm('random');
    const shape = createTestShape(15, 15);

    const slots: LayoutSlot[] = [createSlot('forest', { min: 2, max: 2 })];

    const positioned = algorithm!(createCtx(shape, slots, 12345, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(2);
    // Each positioned slot retains the purpose assigned to it
    for (const pos of positioned) {
      expect(pos.slot.purpose).toBe('forest');
    }
  });
});

// ============================================================================
// Layer-Aware Placement Algorithm Tests
// ============================================================================

/**
 * Create a space-like shape with a starfield fill + nebula features.
 */
function createSpaceShape(
  width: number,
  height: number
): {
  shape: GeneratedShape;
  variant: LayoutVariant;
} {
  // terrainGrid: starfield everywhere, nebula in the top-left quadrant
  const terrainGrid: string[][] = [];
  const blockedMask: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    terrainGrid[y] = [];
    blockedMask[y] = [];
    for (let x = 0; x < width; x++) {
      const isNebula = x < width / 4 && y < height / 4;
      terrainGrid[y][x] = isNebula ? 'nebula' : 'starfield';
      blockedMask[y][x] = false; // nothing blocks in space
    }
  }

  const variant: LayoutVariant = {
    id: 'space-test',
    scale: 'lightyears',
    environment: ENVIRONMENT_PRESETS.space(),
    width: { min: width, max: width },
    height: { min: height, max: height },
    terrainLayers: [
      {
        id: 'starfield',
        tilesetId: 'blob47-starfield',
        tilesetOffset: null,
        type: 'starfield',
        blocking: null,
        terrain: 'space',
        renderOrder: 4999,
        fill: [0],
      },
      {
        id: 'nebula',
        tilesetId: 'blob47-nebula_purple',
        tilesetOffset: null,
        type: 'noise_patch',
        shapePreset: 'nebula',
        blocking: null,
        terrain: 'nebula',
        withinTerrain: null,
        autotileAgainst: ['nebula'],
        autotilePreset: 'canonical',
        renderOrder: 5000,
        fill: [],
      },
    ],
    slots: [],
    description: 'test space variant',
    weight: 1,
    defaultBlocked: false,
  };

  return {
    shape: {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width, height },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    },
    variant,
  };
}

/**
 * Create a land-like shape with ocean fill + grass continent.
 */
function createLandShape(
  width: number,
  height: number
): {
  shape: GeneratedShape;
  variant: LayoutVariant;
} {
  // terrainGrid: ocean everywhere, continent (grass) in the center.
  // Add 2x2 peninsulas (land extending into ocean) so coastline has 2x2 blocks for OCCUPANCY.
  const terrainGrid: string[][] = [];
  const blockedMask: boolean[][] = [];
  const inset = Math.floor(width / 4);
  const peninsulaEast = { x: width - inset, y: inset };
  const peninsulaSouth = { x: inset, y: height - inset };
  const peninsulaSouthEast = { x: width - inset, y: height - inset };
  const peninsulaWest = { x: inset - 2, y: inset };
  const peninsulaNorthEast = { x: width - inset, y: inset - 2 };
  const peninsulaSouthWest = { x: inset - 2, y: height - inset };
  const inPeninsula = (x: number, y: number, p: { x: number; y: number }) =>
    x >= p.x && x < p.x + 2 && y >= p.y && y < p.y + 2;
  for (let y = 0; y < height; y++) {
    terrainGrid[y] = [];
    blockedMask[y] = [];
    for (let x = 0; x < width; x++) {
      const inMainLand = x >= inset && x < width - inset && y >= inset && y < height - inset;
      const isLand =
        inMainLand ||
        inPeninsula(x, y, peninsulaEast) ||
        inPeninsula(x, y, peninsulaSouth) ||
        inPeninsula(x, y, peninsulaSouthEast) ||
        inPeninsula(x, y, peninsulaWest) ||
        inPeninsula(x, y, peninsulaNorthEast) ||
        inPeninsula(x, y, peninsulaSouthWest);
      terrainGrid[y][x] = isLand ? 'grass' : 'ocean';
      blockedMask[y][x] = !isLand; // ocean blocks
    }
  }

  const variant: LayoutVariant = {
    id: 'land-test',
    scale: 'miles',
    environment: ENVIRONMENT_PRESETS.exterior(),
    width: { min: width, max: width },
    height: { min: height, max: height },
    terrainLayers: [
      {
        id: 'ocean',
        tilesetId: 'blob47-ocean',
        tilesetOffset: null,
        type: 'fill',
        blocking: 'blocks',
        terrain: 'water',
        renderOrder: -1,
        fill: [0],
      },
      {
        id: 'grass',
        tilesetId: 'blob47-grass',
        tilesetOffset: null,
        type: 'noise_patch',
        shapePreset: 'continent',
        blocking: 'unblocks',
        terrain: 'land',
        autotileAgainst: [],
        withinTerrain: null,
        autotilePreset: 'canonical',
        renderOrder: 0,
        fill: [],
      },
    ],
    slots: [],
    description: 'test land variant',
    weight: 1,
    defaultBlocked: false,
  };

  return {
    shape: {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width, height },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    },
    variant,
  };
}

describe('open_space algorithm', () => {
  it('places slots on fill-layer tiles (starfield), not on feature tiles (nebula)', () => {
    const algorithm = getPlacementAlgorithm('open_space');
    expect(algorithm).toBeDefined();

    const { shape, variant } = createSpaceShape(40, 40);
    const slots: LayoutSlot[] = [
      createSlot('star_system', { min: 1, max: 1 }),
      createSlot('exit', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // All slots should land on starfield tiles, not nebula
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('starfield');
    }
  });

  it('clusters space-urban purposes near nebula boundaries', () => {
    const algorithm = getPlacementAlgorithm('open_space');
    const { shape, variant } = createSpaceShape(80, 80);

    // Place multiple cluster-type slots
    const slots: LayoutSlot[] = [
      createSlot('star_system', { min: 1, max: 1 }),
      createSlot('spaceport', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // Both should be on starfield
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('starfield');
    }
  });

  it('falls back to getValidTiles when no terrainGrid', () => {
    const algorithm = getPlacementAlgorithm('open_space');

    // Shape with no terrainGrid (like star_system with no layers)
    const shape = createTestShape(20, 20);
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [],
    };

    const slots: LayoutSlot[] = [createSlot('planet', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    // Should still place using fallback
    expect(positioned.length).toBe(1);
  });

  it('returns empty when no fill-layer tiles exist', () => {
    const algorithm = getPlacementAlgorithm('open_space');

    // All nebula, no starfield
    const terrainGrid: string[][] = Array.from(
      { length: 10 },
      () => Array(10).fill('nebula') as string[]
    );
    const shape: GeneratedShape = {
      blockedMask: Array.from({ length: 10 }, () => Array(10).fill(false) as boolean[]),
      layers: [],
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'nebula',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'noise_patch',
          shapePreset: 'nebula',
          blocking: null,
          terrain: 'nebula',
          withinTerrain: null,
          autotileAgainst: [],
          autotilePreset: 'canonical',
          renderOrder: 0,
          fill: [],
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(0);
  });
});

describe('on_land algorithm', () => {
  it('places slots on continent-layer tiles (grass), not on fill tiles (ocean)', () => {
    const algorithm = getPlacementAlgorithm('on_land');
    expect(algorithm).toBeDefined();

    const { shape, variant } = createLandShape(40, 40);
    const slots: LayoutSlot[] = [
      createSlot('tavern', { min: 1, max: 1 }),
      createSlot('exit', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // All slots should land on grass tiles, not ocean
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('grass');
    }
  });

  it('clusters urban purposes near coastline', () => {
    const algorithm = getPlacementAlgorithm('on_land');
    const { shape, variant } = createLandShape(60, 60);

    const slots: LayoutSlot[] = [
      createSlot('tavern', { min: 1, max: 1 }),
      createSlot('shop', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // Both should be on grass
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('grass');
    }
  });

  it('falls back to getValidTiles when no terrainGrid', () => {
    const algorithm = getPlacementAlgorithm('on_land');

    const shape = createTestShape(20, 20);
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [],
    };

    const slots: LayoutSlot[] = [createSlot('tavern', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(1);
  });

  it('returns empty when no continent-layer tiles exist', () => {
    const algorithm = getPlacementAlgorithm('on_land');

    // All ocean, no continent
    const terrainGrid: string[][] = Array.from(
      { length: 10 },
      () => Array(10).fill('ocean') as string[]
    );
    const shape: GeneratedShape = {
      blockedMask: Array.from({ length: 10 }, () => Array(10).fill(true) as boolean[]),
      layers: [],
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'ocean',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'fill',
          blocking: 'blocks',
          terrain: 'water',
          renderOrder: -1,
          fill: [0],
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('tavern', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(0);
  });
});

// ============================================================================
// Non-Rectangular Room Placement Tests (BUG-046)
// ============================================================================

/**
 * Create an L-shaped room with walls tracing the boundary.
 * NE corner is cut out. The void area is blocked but has no wall tiles.
 */
function createLShapeRoom(width: number, height: number): GeneratedShape {
  const inset = 1;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  const cutWidth = Math.floor(innerW * 0.4);
  const cutHeight = Math.floor(innerH * 0.4);

  const blockedMask: boolean[][] = [];
  const floorMask: boolean[][] = [];
  const wallMask: boolean[][] = [];

  // Pass 1: determine floor tiles (L-shaped interior)
  for (let y = 0; y < height; y++) {
    blockedMask[y] = [];
    floorMask[y] = [];
    wallMask[y] = [];
    for (let x = 0; x < width; x++) {
      const inInner = x >= inset && x < width - inset && y >= inset && y < height - inset;
      const rx = x - inset;
      const ry = y - inset;
      // NE cut-out
      const isCutOut = inInner && rx >= innerW - cutWidth && ry < cutHeight;
      const isFloor = inInner && !isCutOut;

      floorMask[y][x] = isFloor;
      wallMask[y][x] = false;
      blockedMask[y][x] = !isFloor;
    }
  }

  // Pass 2: wall tiles are non-floor tiles adjacent (incl. diagonal) to floor tiles
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (floorMask[y][x]) continue;
      const hasAdjacentFloor =
        (y > 0 && floorMask[y - 1][x]) ||
        (y < height - 1 && floorMask[y + 1][x]) ||
        (x > 0 && floorMask[y][x - 1]) ||
        (x < width - 1 && floorMask[y][x + 1]) ||
        (y > 0 && x > 0 && floorMask[y - 1][x - 1]) ||
        (y > 0 && x < width - 1 && floorMask[y - 1][x + 1]) ||
        (y < height - 1 && x > 0 && floorMask[y + 1][x - 1]) ||
        (y < height - 1 && x < width - 1 && floorMask[y + 1][x + 1]);
      if (hasAdjacentFloor) {
        wallMask[y][x] = true;
      }
    }
  }

  return {
    blockedMask,
    layers: [],
    bounds: { x: 0, y: 0, width, height },
    terrainGrid: null,
    layerMasks: { room: floorMask, walls: wallMask },
    roadGraph: null,
    caveGraph: null,
    districts: null,
  };
}

/**
 * Create a T-shaped room with walls tracing the boundary.
 * Top bar spans full width, bottom stem is narrower and centered.
 */
function createTShapeRoom(width: number, height: number): GeneratedShape {
  const inset = 1;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  const stemWidth = Math.floor(innerW * 0.4);
  const stemStart = Math.floor((innerW - stemWidth) / 2);
  const barHeight = Math.floor(innerH * 0.4);

  const blockedMask: boolean[][] = [];
  const floorMask: boolean[][] = [];
  const wallMask: boolean[][] = [];

  // Pass 1: determine floor tiles (T-shaped interior)
  for (let y = 0; y < height; y++) {
    blockedMask[y] = [];
    floorMask[y] = [];
    wallMask[y] = [];
    for (let x = 0; x < width; x++) {
      const inInner = x >= inset && x < width - inset && y >= inset && y < height - inset;
      const rx = x - inset;
      const ry = y - inset;
      const inBar = ry < barHeight;
      const inStem = ry >= barHeight && rx >= stemStart && rx < stemStart + stemWidth;
      const isFloor = inInner && (inBar || inStem);

      floorMask[y][x] = isFloor;
      wallMask[y][x] = false;
      blockedMask[y][x] = !isFloor;
    }
  }

  // Pass 2: wall tiles
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (floorMask[y][x]) continue;
      const hasAdjacentFloor =
        (y > 0 && floorMask[y - 1][x]) ||
        (y < height - 1 && floorMask[y + 1][x]) ||
        (x > 0 && floorMask[y][x - 1]) ||
        (x < width - 1 && floorMask[y][x + 1]) ||
        (y > 0 && x > 0 && floorMask[y - 1][x - 1]) ||
        (y > 0 && x < width - 1 && floorMask[y - 1][x + 1]) ||
        (y < height - 1 && x > 0 && floorMask[y + 1][x - 1]) ||
        (y < height - 1 && x < width - 1 && floorMask[y + 1][x + 1]);
      if (hasAdjacentFloor) {
        wallMask[y][x] = true;
      }
    }
  }

  return {
    blockedMask,
    layers: [],
    bounds: { x: 0, y: 0, width, height },
    terrainGrid: null,
    layerMasks: { room: floorMask, walls: wallMask },
    roadGraph: null,
    caveGraph: null,
    districts: null,
  };
}

describe('L-shape room placement (BUG-046)', () => {
  const lShape = createLShapeRoom(15, 15);

  it('random_valid places all objects on passable floor tiles (none in void cut-out)', () => {
    const algorithm = getPlacementAlgorithm('random_valid');
    const slots: LayoutSlot[] = [
      createSlot('seating', { min: 5, max: 5 }),
      createSlot('table', { min: 3, max: 3 }),
    ];

    const positioned = algorithm!(createCtx(lShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(8);
    for (const pos of positioned) {
      const lx = pos.x - lShape.bounds.x;
      const ly = pos.y - lShape.bounds.y;
      expect(lShape.blockedMask[ly]?.[lx]).toBe(false);
    }
  });

  it('random places all objects on passable floor tiles (none in void cut-out)', () => {
    const algorithm = getPlacementAlgorithm('random');
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 5, max: 5 })];

    const positioned = algorithm!(createCtx(lShape, slots, 99, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(5);
    for (const pos of positioned) {
      const lx = pos.x - lShape.bounds.x;
      const ly = pos.y - lShape.bounds.y;
      expect(lShape.blockedMask[ly]?.[lx]).toBe(false);
    }
  });

  it('in_wall places doors on wall boundary or adjacent floor', () => {
    const algorithm = getPlacementAlgorithm('in_wall');
    const slots: LayoutSlot[] = [createSlot('exit', { min: 2, max: 2 })];

    const positioned = algorithm!(createCtx(lShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(2);
    for (const pos of positioned) {
      const onWall = lShape.layerMasks['walls'][pos.y]?.[pos.x] === true;
      const floorMask = lShape.layerMasks['room'];
      const onFloor = floorMask[pos.y]?.[pos.x] === true;

      // Door is on a wall tile (north face, east/west edge) or on a floor
      // tile at the south boundary (character walks behind south wall)
      expect(onWall || onFloor).toBe(true);

      // Door must have at least one floor neighbor (reachable from interior)
      const hasFloorNeighbor =
        floorMask[pos.y - 1]?.[pos.x] === true ||
        floorMask[pos.y + 1]?.[pos.x] === true ||
        floorMask[pos.y]?.[pos.x - 1] === true ||
        floorMask[pos.y]?.[pos.x + 1] === true;
      expect(hasFloorNeighbor).toBe(true);
    }
  });
});

describe('T-shape room placement (BUG-046)', () => {
  const tShape = createTShapeRoom(15, 15);

  it('random_valid places all objects on passable floor tiles', () => {
    const algorithm = getPlacementAlgorithm('random_valid');
    const slots: LayoutSlot[] = [
      createSlot('seating', { min: 5, max: 5 }),
      createSlot('table', { min: 3, max: 3 }),
    ];

    const positioned = algorithm!(createCtx(tShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(8);
    for (const pos of positioned) {
      const lx = pos.x - tShape.bounds.x;
      const ly = pos.y - tShape.bounds.y;
      expect(tShape.blockedMask[ly]?.[lx]).toBe(false);
    }
  });

  it('random places all objects on passable floor tiles', () => {
    const algorithm = getPlacementAlgorithm('random');
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 5, max: 5 })];

    const positioned = algorithm!(createCtx(tShape, slots, 99, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(5);
    for (const pos of positioned) {
      const lx = pos.x - tShape.bounds.x;
      const ly = pos.y - tShape.bounds.y;
      expect(tShape.blockedMask[ly]?.[lx]).toBe(false);
    }
  });

  it('in_wall places doors on wall boundary or adjacent floor', () => {
    const algorithm = getPlacementAlgorithm('in_wall');
    const slots: LayoutSlot[] = [createSlot('exit', { min: 2, max: 2 })];

    const positioned = algorithm!(createCtx(tShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(2);
    for (const pos of positioned) {
      const onWall = tShape.layerMasks['walls'][pos.y]?.[pos.x] === true;
      const floorMask = tShape.layerMasks['room'];
      const onFloor = floorMask[pos.y]?.[pos.x] === true;

      // Door is on a wall tile (north face, east/west edge) or on a floor
      // tile at the south boundary (character walks behind south wall)
      expect(onWall || onFloor).toBe(true);

      // Door must have at least one floor neighbor (reachable from interior)
      const hasFloorNeighbor =
        floorMask[pos.y - 1]?.[pos.x] === true ||
        floorMask[pos.y + 1]?.[pos.x] === true ||
        floorMask[pos.y]?.[pos.x - 1] === true ||
        floorMask[pos.y]?.[pos.x + 1] === true;
      expect(hasFloorNeighbor).toBe(true);
    }
  });
});

describe('Cross-slot overlap prevention (BUG-046)', () => {
  it('no two objects share the same tile across separate algorithm calls', () => {
    const shape = createTestShape(10, 10);
    const algorithm = getPlacementAlgorithm('random_valid');

    // Shared set simulates what generatePositionedSlots does
    const occupiedTiles = new Set<string>();

    const slots1: LayoutSlot[] = [createSlot('seating', { min: 4, max: 4 })];
    const slots2: LayoutSlot[] = [createSlot('table', { min: 4, max: 4 })];

    const result1 = algorithm!(createCtx(shape, slots1, 42, DUMMY_VARIANT, occupiedTiles));
    const result2 = algorithm!(createCtx(shape, slots2, 42, DUMMY_VARIANT, occupiedTiles));

    expect(result1.length).toBe(4);
    expect(result2.length).toBe(4);

    // Collect all positions and verify uniqueness
    const allPositions = new Set<string>();
    for (const pos of [...result1, ...result2]) {
      const key = `${pos.x},${pos.y}`;
      expect(allPositions.has(key)).toBe(false);
      allPositions.add(key);
    }
    expect(allPositions.size).toBe(8);
  });

  it('overlap prevention works across different algorithm types', () => {
    const shape = createTestShape(15, 15);

    const occupiedTiles = new Set<string>();

    const inWall = getPlacementAlgorithm('in_wall');
    const randomValid = getPlacementAlgorithm('random_valid');

    const doorSlots: LayoutSlot[] = [createSlot('exit', { min: 2, max: 2 })];
    const furnitureSlots: LayoutSlot[] = [createSlot('seating', { min: 5, max: 5 })];

    const doors = inWall!(createCtx(shape, doorSlots, 42, DUMMY_VARIANT, occupiedTiles));
    const furniture = randomValid!(
      createCtx(shape, furnitureSlots, 42, DUMMY_VARIANT, occupiedTiles)
    );

    expect(doors.length).toBe(2);
    expect(furniture.length).toBe(5);

    // No overlaps between doors and furniture
    const allPositions = new Set<string>();
    for (const pos of [...doors, ...furniture]) {
      const key = `${pos.x},${pos.y}`;
      expect(allPositions.has(key)).toBe(false);
      allPositions.add(key);
    }
    expect(allPositions.size).toBe(7);
  });

  it('in_wall produces slots with 2-tile spacing along wall (BUG-059)', () => {
    const shape = createTestShape(20, 20);
    const inWall = getPlacementAlgorithm('in_wall');
    const occupiedTiles = new Set<string>();

    const slots: LayoutSlot[] = [createSlot('exit', { min: 3, max: 3 })];
    const result = inWall!(createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles));
    expect(result.length).toBe(3);

    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const dx = Math.abs(result[i].x - result[j].x);
        const dy = Math.abs(result[i].y - result[j].y);
        expect(dx < 2 && dy < 2).toBe(false);
      }
    }
  });

  it('throws when shared occupied tiles exhaust available space for required slots', () => {
    // 15x15 shape: 13x13 interior = 169 tiles. With 1x1 occupancy, use 160 for first call
    const shape = createTestShape(15, 15);
    const algorithm = getPlacementAlgorithm('random_valid');

    const occupiedTiles = new Set<string>();

    // First call takes 160 of 169 available 1x1 slots
    const slots1: LayoutSlot[] = [createSlot('seating', { min: 160, max: 160 })];
    const result1 = algorithm!(createCtx(shape, slots1, 42, DUMMY_VARIANT, occupiedTiles));
    expect(result1.length).toBe(160);

    // Second call needs 15 slots but only 9 are left
    const slots2: LayoutSlot[] = [createSlot('table', { min: 15, max: 15 })];
    expect(() => algorithm!(createCtx(shape, slots2, 42, DUMMY_VARIANT, occupiedTiles))).toThrow(
      'Cannot place required slot'
    );
  });
});

// ============================================================================
// On-Water Placement Algorithm Tests
// ============================================================================

/**
 * Create a water-dominant shape with ocean fill + a small land continent.
 * Water tiles surround the land, providing coastline boundary tiles.
 */
function createWaterShape(
  width: number,
  height: number
): {
  shape: GeneratedShape;
  variant: LayoutVariant;
} {
  // terrainGrid: ocean everywhere, land in the center
  const terrainGrid: string[][] = [];
  const blockedMask: boolean[][] = [];
  const inset = Math.floor(width / 4);
  for (let y = 0; y < height; y++) {
    terrainGrid[y] = [];
    blockedMask[y] = [];
    for (let x = 0; x < width; x++) {
      const isLand = x >= inset && x < width - inset && y >= inset && y < height - inset;
      terrainGrid[y][x] = isLand ? 'grass' : 'ocean';
      blockedMask[y][x] = false; // nothing blocks for water placement
    }
  }

  const variant: LayoutVariant = {
    id: 'water-test',
    scale: 'miles',
    environment: ENVIRONMENT_PRESETS.exterior(),
    width: { min: width, max: width },
    height: { min: height, max: height },
    terrainLayers: [
      {
        id: 'ocean',
        tilesetId: 'blob47-ocean',
        tilesetOffset: null,
        type: 'fill',
        blocking: null,
        terrain: 'water',
        renderOrder: -1,
        fill: [0],
        procedural: false,
      },
      {
        id: 'grass',
        tilesetId: 'blob47-grass',
        tilesetOffset: null,
        type: 'noise_patch',
        shapePreset: 'continent',
        blocking: 'unblocks',
        terrain: 'land',
        autotileAgainst: [],
        withinTerrain: null,
        autotilePreset: 'canonical',
        renderOrder: 0,
        fill: [],
        procedural: false,
      },
    ],
    slots: [],
    description: 'test water variant',
    weight: 1,
    defaultBlocked: false,
  };

  return {
    shape: {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width, height },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    },
    variant,
  };
}

describe('on_water algorithm', () => {
  it('places slots on water-tagged tiles, not on land tiles', () => {
    const algorithm = getPlacementAlgorithm('on_water');
    expect(algorithm).toBeDefined();

    const { shape, variant } = createWaterShape(40, 40);
    const slots: LayoutSlot[] = [
      createSlot('dock', { min: 1, max: 1 }),
      createSlot('buoy', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // All slots should land on ocean (water) tiles, not grass (land)
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('ocean');
    }
  });

  it('clusters coastal purposes near land-water boundary', () => {
    const algorithm = getPlacementAlgorithm('on_water');
    const { shape, variant } = createWaterShape(80, 80);

    // Place cluster-type slots (ports cluster near coastline)
    const slots: LayoutSlot[] = [
      createSlot('dock', { min: 1, max: 1 }),
      createSlot('harbor', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // Both should be on ocean tiles
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('ocean');
    }
  });

  it('spreads open-water purposes across the water surface', () => {
    const algorithm = getPlacementAlgorithm('on_water');
    const { shape, variant } = createWaterShape(80, 80);

    const slots: LayoutSlot[] = [
      createSlot('reef', { min: 1, max: 1 }),
      createSlot('wreck', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('ocean');
    }
  });

  it('returns empty when no water-tagged tiles exist', () => {
    const algorithm = getPlacementAlgorithm('on_water');

    // All land, no water
    const terrainGrid: string[][] = Array.from(
      { length: 10 },
      () => Array(10).fill('grass') as string[]
    );
    const shape: GeneratedShape = {
      blockedMask: Array.from({ length: 10 }, () => Array(10).fill(false) as boolean[]),
      layers: [],
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'grass',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'noise_patch',
          shapePreset: 'continent',
          blocking: 'unblocks',
          terrain: 'land',
          autotileAgainst: [],
          withinTerrain: null,
          autotilePreset: 'canonical',
          renderOrder: 0,
          fill: [],
          procedural: false,
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('dock', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(0);
  });

  it('works with mixed terrain grids (land + water + wall)', () => {
    const algorithm = getPlacementAlgorithm('on_water');

    // 20x20 grid: water edges, land center, wall ring between
    const terrainGrid: string[][] = [];
    const blockedMask: boolean[][] = [];
    for (let y = 0; y < 20; y++) {
      terrainGrid[y] = [];
      blockedMask[y] = [];
      for (let x = 0; x < 20; x++) {
        const isWall = x === 5 || x === 14 || y === 5 || y === 14;
        const isLand = x > 5 && x < 14 && y > 5 && y < 14;
        if (isWall) {
          terrainGrid[y][x] = 'wall_layer';
        } else if (isLand) {
          terrainGrid[y][x] = 'grass';
        } else {
          terrainGrid[y][x] = 'ocean';
        }
        blockedMask[y][x] = false;
      }
    }

    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'ocean',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'fill',
          blocking: null,
          terrain: 'water',
          renderOrder: -1,
          fill: [0],
          procedural: false,
        },
        {
          id: 'grass',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'noise_patch',
          shapePreset: 'continent',
          blocking: 'unblocks',
          terrain: 'land',
          autotileAgainst: [],
          withinTerrain: null,
          autotilePreset: 'canonical',
          renderOrder: 0,
          fill: [],
          procedural: false,
        },
        {
          id: 'wall_layer',
          tilesetId: 'lpc-interior-walls',
          tilesetOffset: null,
          type: 'wall',
          blocking: 'blocks',
          terrain: 'wall',
          renderOrder: 100,
          fill: [],
          procedural: false,
          wallStyle: 'brick_brown',
          inheritable: false,
        },
      ],
    };

    const shape: GeneratedShape = {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width: 20, height: 20 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    const slots: LayoutSlot[] = [
      createSlot('dock', { min: 2, max: 2 }),
      createSlot('buoy', { min: 1, max: 1 }),
    ];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(3);

    // All should be on ocean tiles, not land or wall
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('ocean');
    }
  });

  it('handles water-only map with no coastlines (spreads evenly)', () => {
    const algorithm = getPlacementAlgorithm('on_water');

    // All water, no land -- no coastline to cluster near
    const terrainGrid: string[][] = Array.from(
      { length: 20 },
      () => Array(20).fill('ocean') as string[]
    );
    const shape: GeneratedShape = {
      blockedMask: Array.from({ length: 20 }, () => Array(20).fill(false) as boolean[]),
      layers: [],
      bounds: { x: 0, y: 0, width: 20, height: 20 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'ocean',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'fill',
          blocking: null,
          terrain: 'water',
          renderOrder: -1,
          fill: [0],
          procedural: false,
        },
      ],
    };

    const slots: LayoutSlot[] = [
      createSlot('dock', { min: 1, max: 1 }),
      createSlot('reef', { min: 1, max: 1 }),
    ];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // All on ocean (only option)
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('ocean');
    }
  });

  it('generates consistent results with same seed', () => {
    const algorithm = getPlacementAlgorithm('on_water');
    const { shape, variant } = createWaterShape(40, 40);

    const slots: LayoutSlot[] = [createSlot('dock', { min: 2, max: 2 })];

    const result1 = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));
    const result2 = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(result1.length).toBe(result2.length);
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i].x).toBe(result2[i].x);
      expect(result1[i].y).toBe(result2[i].y);
    }
  });

  it('falls back to getValidTiles when no terrainGrid', () => {
    const algorithm = getPlacementAlgorithm('on_water');

    const shape = createTestShape(20, 20);
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'ocean',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'fill',
          blocking: null,
          terrain: 'water',
          renderOrder: -1,
          fill: [0],
          procedural: false,
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('dock', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    // Should still place using fallback
    expect(positioned.length).toBe(1);
  });
});

// ============================================================================
// On-Coast Placement Algorithm Tests
// ============================================================================

describe('on_coast algorithm', () => {
  it('places slots only on coastline boundary tiles (land adjacent to non-land)', () => {
    const algorithm = getPlacementAlgorithm('on_coast');
    expect(algorithm).toBeDefined();

    const { shape, variant } = createLandShape(40, 40);
    const slots: LayoutSlot[] = [
      createSlot('dock', { min: 1, max: 1 }),
      createSlot('pier', { min: 1, max: 1 }),
    ];

    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(2);

    // All slots should be on grass (land) tiles
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('grass');
    }

    // All slots should be on boundary tiles (adjacent to ocean)
    for (const pos of positioned) {
      const hasOceanNeighbor =
        (pos.y > 0 && shape.terrainGrid![pos.y - 1]?.[pos.x] === 'ocean') ||
        (pos.y < 39 && shape.terrainGrid![pos.y + 1]?.[pos.x] === 'ocean') ||
        (pos.x > 0 && shape.terrainGrid![pos.y]?.[pos.x - 1] === 'ocean') ||
        (pos.x < 39 && shape.terrainGrid![pos.y]?.[pos.x + 1] === 'ocean');
      expect(hasOceanNeighbor).toBe(true);
    }
  });

  it('returns empty when no coastline tiles exist (all land, no ocean)', () => {
    const algorithm = getPlacementAlgorithm('on_coast');

    // All grass, no ocean -- no coastline boundary
    const terrainGrid: string[][] = Array.from(
      { length: 10 },
      () => Array(10).fill('grass') as string[]
    );
    const shape: GeneratedShape = {
      blockedMask: Array.from({ length: 10 }, () => Array(10).fill(false) as boolean[]),
      layers: [],
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'grass',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'noise_patch',
          shapePreset: 'continent',
          blocking: 'unblocks',
          terrain: 'land',
          autotileAgainst: [],
          withinTerrain: null,
          autotilePreset: 'canonical',
          renderOrder: 0,
          fill: [],
          procedural: false,
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('dock', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(0);
  });

  it('returns empty when no continent-layer tiles exist (all ocean)', () => {
    const algorithm = getPlacementAlgorithm('on_coast');

    // All ocean, no continent -- no coastline
    const terrainGrid: string[][] = Array.from(
      { length: 10 },
      () => Array(10).fill('ocean') as string[]
    );
    const shape: GeneratedShape = {
      blockedMask: Array.from({ length: 10 }, () => Array(10).fill(false) as boolean[]),
      layers: [],
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'ocean',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'fill',
          blocking: null,
          terrain: 'water',
          renderOrder: -1,
          fill: [0],
          procedural: false,
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('dock', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBe(0);
  });

  it('generates consistent results with same seed', () => {
    const algorithm = getPlacementAlgorithm('on_coast');
    const { shape, variant } = createLandShape(40, 40);

    const slots: LayoutSlot[] = [createSlot('dock', { min: 2, max: 2 })];

    const result1 = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));
    const result2 = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(result1.length).toBe(result2.length);
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i].x).toBe(result2[i].x);
      expect(result1[i].y).toBe(result2[i].y);
    }
  });

  it('respects occupiedTiles for cross-slot overlap prevention', () => {
    const algorithm = getPlacementAlgorithm('on_coast');
    const { shape, variant } = createLandShape(40, 40);

    const occupiedTiles = new Set<string>();

    const slots1: LayoutSlot[] = [createSlot('dock', { min: 2, max: 2 })];
    const slots2: LayoutSlot[] = [createSlot('pier', { min: 2, max: 2 })];

    const result1 = algorithm!(createCtx(shape, slots1, 42, variant, occupiedTiles));
    const result2 = algorithm!(createCtx(shape, slots2, 42, variant, occupiedTiles));

    expect(result1.length).toBe(2);
    expect(result2.length).toBe(2);

    // No overlaps
    const allPositions = new Set<string>();
    for (const pos of [...result1, ...result2]) {
      const key = `${pos.x},${pos.y}`;
      expect(allPositions.has(key)).toBe(false);
      allPositions.add(key);
    }
    expect(allPositions.size).toBe(4);
  });

  it('random_valid produces non-overlapping slots (occupancy from slotSize)', () => {
    const algorithm = getPlacementAlgorithm('random_valid');
    const shape = createTestShape(25, 25); // 23x23 interior

    const occupiedTiles = new Set<string>();
    const slots: LayoutSlot[] = [createSlot('workspace', { min: 12, max: 12 })];

    const result = algorithm!(createCtx(shape, slots, 12345, DUMMY_VARIANT, occupiedTiles));
    expect(result.length).toBe(12);

    // No two slots should overlap (same tile)
    const allPositions = new Set<string>();
    for (const pos of result) {
      const key = `${pos.x},${pos.y}`;
      expect(allPositions.has(key)).toBe(false);
      allPositions.add(key);
    }
    expect(allPositions.size).toBe(12);
  });

  it('returns empty when no terrainGrid exists', () => {
    const algorithm = getPlacementAlgorithm('on_coast');

    // No terrainGrid means getBoundaryTiles returns []
    const shape = createTestShape(20, 20);
    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'grass',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'noise_patch',
          shapePreset: 'continent',
          blocking: 'unblocks',
          terrain: 'land',
          autotileAgainst: [],
          withinTerrain: null,
          autotilePreset: 'canonical',
          renderOrder: 0,
          fill: [],
          procedural: false,
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('dock', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    // getBoundaryTiles returns [] when no terrainGrid, so on_coast returns empty
    expect(positioned.length).toBe(0);
  });

  it('works with mixed terrain grids (land + water + wall)', () => {
    const algorithm = getPlacementAlgorithm('on_coast');

    // 20x20 grid: water edges, land center, wall ring between.
    // 3x 2x2 peninsulas along east edge so coastline has 2x2 blocks for OCCUPANCY.
    const terrainGrid: string[][] = [];
    const blockedMask: boolean[][] = [];
    const inPeninsula = (tx: number, ty: number, px: number, py: number) =>
      tx >= px && tx < px + 2 && ty >= py && ty < py + 2;
    for (let y = 0; y < 20; y++) {
      terrainGrid[y] = [];
      blockedMask[y] = [];
      for (let x = 0; x < 20; x++) {
        const inAnyPeninsula =
          inPeninsula(x, y, 14, 3) || inPeninsula(x, y, 14, 9) || inPeninsula(x, y, 14, 15);
        const isWall = !inAnyPeninsula && (x === 5 || x === 14 || y === 5 || y === 14);
        const isLand = inAnyPeninsula || (x > 5 && x < 14 && y > 5 && y < 14);
        if (isWall) {
          terrainGrid[y][x] = 'wall_layer';
        } else if (isLand) {
          terrainGrid[y][x] = 'grass';
        } else {
          terrainGrid[y][x] = 'ocean';
        }
        blockedMask[y][x] = false;
      }
    }

    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        {
          id: 'ocean',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'fill',
          blocking: null,
          terrain: 'water',
          renderOrder: -1,
          fill: [0],
          procedural: false,
        },
        {
          id: 'grass',
          tilesetId: 'x',
          tilesetOffset: null,
          type: 'noise_patch',
          shapePreset: 'continent',
          blocking: 'unblocks',
          terrain: 'land',
          autotileAgainst: [],
          withinTerrain: null,
          autotilePreset: 'canonical',
          renderOrder: 0,
          fill: [],
          procedural: false,
        },
        {
          id: 'wall_layer',
          tilesetId: 'lpc-interior-walls',
          tilesetOffset: null,
          type: 'wall',
          blocking: 'blocks',
          terrain: 'wall',
          renderOrder: 100,
          fill: [],
          procedural: false,
          wallStyle: 'brick_brown',
          inheritable: false,
        },
      ],
    };

    const shape: GeneratedShape = {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width: 20, height: 20 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    const slots: LayoutSlot[] = [
      createSlot('dock', { min: 2, max: 2 }),
      createSlot('lighthouse', { min: 1, max: 1 }),
    ];
    const positioned = algorithm!(createCtx(shape, slots, 12345, variant, new Set<string>()));

    expect(positioned.length).toBeGreaterThanOrEqual(2);

    // All should be on grass tiles (continent boundary adjacent to wall or ocean)
    for (const pos of positioned) {
      expect(shape.terrainGrid![pos.y][pos.x]).toBe('grass');
    }

    // All should be boundary tiles (adjacent to non-grass)
    for (const pos of positioned) {
      const hasNonGrassNeighbor =
        (pos.y > 0 && shape.terrainGrid![pos.y - 1]?.[pos.x] !== 'grass') ||
        (pos.y < 19 && shape.terrainGrid![pos.y + 1]?.[pos.x] !== 'grass') ||
        (pos.x > 0 && shape.terrainGrid![pos.y]?.[pos.x - 1] !== 'grass') ||
        (pos.x < 19 && shape.terrainGrid![pos.y]?.[pos.x + 1] !== 'grass');
      expect(hasNonGrassNeighbor).toBe(true);
    }
  });
});

// ============================================================================
// Against-Wall Placement Algorithm Tests (FEAT-040)
// ============================================================================

describe('against_wall algorithm', () => {
  it('places slots on floor tiles adjacent to walls', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    expect(algorithm).toBeDefined();

    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('sleeping', { min: 3, max: 3 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(3);

    // All positions should be on floor tiles (not wall, not void)
    for (const pos of positioned) {
      const lx = pos.x - shape.bounds.x;
      const ly = pos.y - shape.bounds.y;
      expect(shape.blockedMask[ly]?.[lx]).toBe(false);
    }

    // All positions should have at least one wall cardinal neighbor
    const wallMask = shape.layerMasks['walls'] as boolean[][];
    for (const pos of positioned) {
      const lx = pos.x - shape.bounds.x;
      const ly = pos.y - shape.bounds.y;
      const hasWallNeighbor =
        (ly > 0 && wallMask[ly - 1]?.[lx] === true) ||
        (ly < shape.bounds.height - 1 && wallMask[ly + 1]?.[lx] === true) ||
        (lx > 0 && wallMask[ly]?.[lx - 1] === true) ||
        (lx < shape.bounds.width - 1 && wallMask[ly]?.[lx + 1] === true);
      expect(hasWallNeighbor).toBe(true);
    }
  });

  it('does not place in room center (non-wall-adjacent tiles)', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('storage', { min: 5, max: 5 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(5);

    // Room center tiles (far from walls) should not be used
    for (const pos of positioned) {
      const lx = pos.x - shape.bounds.x;
      const ly = pos.y - shape.bounds.y;
      // If 5+ tiles from any wall, it shouldn't be placed there
      const distFromWall = Math.min(
        lx,
        ly,
        shape.bounds.width - 1 - lx,
        shape.bounds.height - 1 - ly
      );
      // Wall-adjacent means distance to wall perimeter is exactly 1 (floor right next to wall)
      expect(distFromWall).toBeLessThanOrEqual(2); // within occupancy range of wall
    }
  });

  it('respects min/max', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(20, 20);

    const slots: LayoutSlot[] = [createSlot('storage', { min: 3, max: 3 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));
    expect(positioned.length).toBe(3);
  });

  it('respects occupiedTiles', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(15, 15);
    const occupiedTiles = new Set<string>();

    const slots1: LayoutSlot[] = [createSlot('sleeping', { min: 3, max: 3 })];
    const slots2: LayoutSlot[] = [createSlot('storage', { min: 3, max: 3 })];

    const result1 = algorithm!(createCtx(shape, slots1, 42, DUMMY_VARIANT, occupiedTiles));
    const result2 = algorithm!(createCtx(shape, slots2, 42, DUMMY_VARIANT, occupiedTiles));

    expect(result1.length).toBe(3);
    expect(result2.length).toBe(3);

    // No overlaps
    const allPositions = new Set<string>();
    for (const pos of [...result1, ...result2]) {
      const key = `${pos.x},${pos.y}`;
      expect(allPositions.has(key)).toBe(false);
      allPositions.add(key);
    }
  });

  it('generates consistent results with same seed', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('sleeping', { min: 2, max: 2 })];

    const result1 = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));
    const result2 = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(result1.length).toBe(result2.length);
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i].x).toBe(result2[i].x);
      expect(result1[i].y).toBe(result2[i].y);
    }
  });

  it('returns empty when no wall layer exists', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const noWallShape: GeneratedShape = {
      blockedMask: Array.from({ length: 10 }, () => Array(10).fill(false) as boolean[]),
      layers: [],
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      terrainGrid: null,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    const slots: LayoutSlot[] = [createSlot('storage', { min: 1, max: 1 })];
    const positioned = algorithm!(
      createCtx(noWallShape, slots, 42, DUMMY_VARIANT, new Set<string>())
    );
    expect(positioned.length).toBe(0);
  });

  it('works in L-shaped rooms', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const lShape = createLShapeRoom(15, 15);
    const slots: LayoutSlot[] = [createSlot('storage', { min: 3, max: 3 })];
    const positioned = algorithm!(createCtx(lShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(3);

    // All should be on floor tiles
    for (const pos of positioned) {
      expect(lShape.blockedMask[pos.y]?.[pos.x]).toBe(false);
    }

    // All should be wall-adjacent
    const wallMask = lShape.layerMasks['walls'] as boolean[][];
    for (const pos of positioned) {
      const hasWallNeighbor =
        (pos.y > 0 && wallMask[pos.y - 1]?.[pos.x] === true) ||
        (pos.y < lShape.bounds.height - 1 && wallMask[pos.y + 1]?.[pos.x] === true) ||
        (pos.x > 0 && wallMask[pos.y]?.[pos.x - 1] === true) ||
        (pos.x < lShape.bounds.width - 1 && wallMask[pos.y]?.[pos.x + 1] === true);
      expect(hasWallNeighbor).toBe(true);
    }
  });

  it('excludes wall_face tiles from placement candidates (FEAT-276)', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const width = 20;
    const height = 20;

    const baseShape = createTestShape(width, height);

    // wall_face mask: rows 1–3 are the 3-tile face strip below the north wall edge
    const wallFaceMask: boolean[][] = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, () => y >= 1 && y <= 3)
    );

    const shapeWithFace: GeneratedShape = {
      ...baseShape,
      layerMasks: { ...baseShape.layerMasks, wall_faces: wallFaceMask },
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    const variantWithFace: LayoutVariant = {
      ...DUMMY_VARIANT,
      terrainLayers: [
        ...DUMMY_VARIANT.terrainLayers,
        {
          id: 'wall_faces',
          tilesetId: 'lpc-interior-walls',
          tilesetOffset: null,
          type: 'wall_face' as const,
          blocking: 'blocks' as const,
          terrain: 'wall' as const,
          renderOrder: 1,
          wallLayerId: 'walls',
          roomLayerId: 'room',
          wallStyle: 'brick_brown',
        },
      ],
    };

    const slots: LayoutSlot[] = [createSlot('storage', { min: 5, max: 5 })];
    const positioned = algorithm!(
      createCtx(shapeWithFace, slots, 42, variantWithFace, new Set<string>())
    );

    expect(positioned.length).toBe(5);

    // No item should land on a wall_face tile
    for (const pos of positioned) {
      expect(wallFaceMask[pos.y]?.[pos.x]).toBe(false);
    }
  });

  it('is unaffected when no wall_face layer exists (FEAT-276)', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(20, 20);

    // Without a wall_face layer, north-wall-adjacent tiles (y=1) are valid candidates
    const slots: LayoutSlot[] = [createSlot('storage', { min: 5, max: 5 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(5);

    // All should be wall-adjacent
    const wallMask = shape.layerMasks['walls'] as boolean[][];
    for (const pos of positioned) {
      const hasWallNeighbor =
        (pos.y > 0 && wallMask[pos.y - 1]?.[pos.x] === true) ||
        (pos.y < shape.bounds.height - 1 && wallMask[pos.y + 1]?.[pos.x] === true) ||
        (pos.x > 0 && wallMask[pos.y]?.[pos.x - 1] === true) ||
        (pos.x < shape.bounds.width - 1 && wallMask[pos.y]?.[pos.x + 1] === true);
      expect(hasWallNeighbor).toBe(true);
    }
  });
});

// ============================================================================
// Against-Wall Direction Filtering (BUG-128)
// ============================================================================

describe('against_wall direction filtering (BUG-128)', () => {
  it('restricts single-direction sprites to north wall only (facing south)', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(15, 15);
    const slots: LayoutSlot[] = [createSlot('storage', { min: 3, max: 3 })];

    // Mock: purpose has only south-facing sprites (no directions in registry)
    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['south']);

    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(3);
    // All placements should face south (against north wall)
    for (const pos of positioned) {
      expect(pos.facing).toBe('south');
    }
  });

  it('allows multi-direction sprites on all walls', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('seating', { min: 8, max: 8 })];

    // Mock: purpose has sprites with all 4 directions
    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);

    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(8);
    const facings = new Set(positioned.map((p) => p.facing));
    // With enough placements and all facings allowed, expect multiple different facings
    expect(facings.size).toBeGreaterThan(1);
  });

  it('filters to only north and south facings when sprites support those two', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 5, max: 5 })];

    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south']);

    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(5);
    for (const pos of positioned) {
      expect(['north', 'south']).toContain(pos.facing);
    }
  });

  it('passes slot purpose and requiredTags to getAnyAllowedFacingsForPurpose', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(15, 15);
    const slot = createSlot('lighting');
    slot.requiredTags = ['ship'];
    // slot.forbiddenTags is null — effective forbidden defaults to ['wall'] (BUG-121)
    const slots: LayoutSlot[] = [slot];

    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['south']);

    algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(mockGetAnyAllowedFacingsForPurpose).toHaveBeenCalledWith('lighting', ['ship'], ['wall']);
  });

  it('includes allowed facings in error message when no tiles available', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    // Small 5x5 room — with only 'east' facing allowed, the east-wall-adjacent tiles
    // are very few and may not satisfy occupancy requirements.
    const shape = createTestShape(5, 5);
    const slots: LayoutSlot[] = [createSlot('storage', { min: 5, max: 5 })];

    // Only east facing allowed, very restricted
    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['east']);

    expect(() => algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()))).toThrow(
      /allowed facings.*east/
    );

    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);
  });

  // BUG-121: against_wall must apply defaultForbiddenTags: ['wall'] when slot.forbiddenTags is null
  it('applies defaultForbiddenTags wall when slot.forbiddenTags is null (BUG-121)', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(15, 15);
    const slots: LayoutSlot[] = [createSlot('storage', { min: 0, max: 2 })];
    // slot.requiredTags and slot.forbiddenTags are both null by default

    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['south']);

    algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    // Must be called with effective forbidden tags ['wall'], not undefined
    expect(mockGetAnyAllowedFacingsForPurpose).toHaveBeenCalledWith('storage', undefined, ['wall']);

    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);
  });

  it('uses slot.forbiddenTags when explicitly set, not the default (BUG-121)', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    const shape = createTestShape(15, 15);
    const slot = createSlot('storage', { min: 0, max: 2 });
    slot.forbiddenTags = ['ship']; // explicit override — should NOT use default ['wall']
    const slots: LayoutSlot[] = [slot];

    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['south']);

    algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(mockGetAnyAllowedFacingsForPurpose).toHaveBeenCalledWith('storage', undefined, ['ship']);

    mockGetAnyAllowedFacingsForPurpose.mockReturnValue(['north', 'south', 'east', 'west']);
  });
});

// ============================================================================
// Near-Slot Placement Algorithm Tests (FEAT-040)
// ============================================================================

describe('near_slot algorithm', () => {
  it('places slots within 2 tiles of anchor slot', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    expect(algorithm).toBeDefined();

    const shape = createTestShape(20, 20);
    // Simulate a previously placed sleeping slot at (5, 5)
    const anchorSlot: PositionedSlot = {
      slot: createSlot('sleeping'),
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    };

    const slots: LayoutSlot[] = [
      createSlot('lighting', { min: 1, max: 1, nearPurpose: 'sleeping' }),
    ];
    const positioned = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>(), [anchorSlot])
    );

    expect(positioned.length).toBe(1);

    // Should be within Chebyshev distance 2 of anchor
    const dx = Math.abs(positioned[0].x - anchorSlot.x);
    const dy = Math.abs(positioned[0].y - anchorSlot.y);
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(2);
  });

  it('throws when required and no anchor exists', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(20, 20);

    const slots: LayoutSlot[] = [
      createSlot('lighting', { min: 1, max: 1, nearPurpose: 'sleeping' }),
    ];

    expect(() =>
      algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>(), []))
    ).toThrow('no placed slot with purpose "sleeping" found');
  });

  it('skips gracefully when optional and no anchor exists', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(20, 20);

    // min=0 (optional), no anchor
    const slots: LayoutSlot[] = [
      createSlot('lighting', { min: 0, max: 1, nearPurpose: 'sleeping' }),
    ];
    const positioned = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>(), [])
    );

    expect(positioned.length).toBe(0);
  });

  it('works with multiple anchors', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(30, 30);

    // Two sleeping anchors at different positions
    const anchor1: PositionedSlot = {
      slot: createSlot('sleeping'),
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    };
    const anchor2: PositionedSlot = {
      slot: createSlot('sleeping'),
      x: 15,
      y: 15,
      width: 1,
      height: 1,
    };

    const slots: LayoutSlot[] = [
      createSlot('lighting', { min: 2, max: 2, nearPurpose: 'sleeping' }),
    ];
    const positioned = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>(), [anchor1, anchor2])
    );

    expect(positioned.length).toBe(2);

    // Each should be near at least one anchor
    for (const pos of positioned) {
      const nearAnchor1 = Math.max(Math.abs(pos.x - anchor1.x), Math.abs(pos.y - anchor1.y)) <= 2;
      const nearAnchor2 = Math.max(Math.abs(pos.x - anchor2.x), Math.abs(pos.y - anchor2.y)) <= 2;
      expect(nearAnchor1 || nearAnchor2).toBe(true);
    }
  });

  it('respects occupiedTiles', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(20, 20);

    const anchor: PositionedSlot = {
      slot: createSlot('sleeping'),
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    };

    // Pre-occupy some tiles near the anchor
    const occupiedTiles = new Set<string>();
    const preOccupied = ['4,4', '5,4', '6,4', '4,5', '5,5'];
    for (const key of preOccupied) occupiedTiles.add(key);

    const slots: LayoutSlot[] = [
      createSlot('lighting', { min: 1, max: 1, nearPurpose: 'sleeping' }),
    ];
    const positioned = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles, [anchor])
    );

    expect(positioned.length).toBe(1);
    // Should not overlap with pre-existing occupied tiles
    expect(preOccupied.includes(`${positioned[0].x},${positioned[0].y}`)).toBe(false);
  });

  it('generates consistent results with same seed', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(20, 20);

    const anchor: PositionedSlot = {
      slot: createSlot('sleeping'),
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    };
    const slots: LayoutSlot[] = [
      createSlot('lighting', { min: 1, max: 1, nearPurpose: 'sleeping' }),
    ];

    const result1 = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );
    const result2 = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );

    expect(result1.length).toBe(result2.length);
    expect(result1[0].x).toBe(result2[0].x);
    expect(result1[0].y).toBe(result2[0].y);
  });

  it('expands search radius when initial radius is fully occupied (BUG-077)', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(20, 20);

    // Anchor at (5, 5)
    const anchor: PositionedSlot = {
      slot: createSlot('workspace'),
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    };

    // Pre-occupy ALL floor tiles within Chebyshev distance 2 of the anchor
    // (the initial 5x5 search box). This simulates the tight layout scenario.
    const occupiedTiles = new Set<string>();
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        occupiedTiles.add(`${5 + dx},${5 + dy}`);
      }
    }

    // Required slot should still succeed by expanding to a larger radius
    const slots: LayoutSlot[] = [
      createSlot('bartender', { min: 1, max: 1, nearPurpose: 'workspace' }),
    ];
    const positioned = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles, [anchor])
    );

    expect(positioned.length).toBe(1);

    // The placed tile should be beyond initial radius 2 but within max radius 5
    const dx = Math.abs(positioned[0].x - anchor.x);
    const dy = Math.abs(positioned[0].y - anchor.y);
    const chebyshev = Math.max(dx, dy);
    expect(chebyshev).toBeGreaterThan(2);
    expect(chebyshev).toBeLessThanOrEqual(5);
  });

  it('still throws when all radii are exhausted for required slot (BUG-077)', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    // Very small room: 7x7 = 5x5 interior. Anchor in center at (3,3).
    // Max search radius 5 extends well beyond the room bounds.
    const shape = createTestShape(7, 7);

    const anchor: PositionedSlot = {
      slot: createSlot('workspace'),
      x: 3,
      y: 3,
      width: 1,
      height: 1,
    };

    // Occupy ALL interior floor tiles (the entire 5x5 interior of the 7x7 room)
    const occupiedTiles = new Set<string>();
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) {
        occupiedTiles.add(`${x},${y}`);
      }
    }

    const slots: LayoutSlot[] = [
      createSlot('bartender', { min: 1, max: 1, nearPurpose: 'workspace' }),
    ];

    expect(() =>
      algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles, [anchor]))
    ).toThrow('no available unblocked tiles near "workspace"');
  });

  it('optional slot skips gracefully when all radii are exhausted (BUG-077)', () => {
    const algorithm = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(7, 7);

    const anchor: PositionedSlot = {
      slot: createSlot('workspace'),
      x: 3,
      y: 3,
      width: 1,
      height: 1,
    };

    // Occupy ALL interior floor tiles
    const occupiedTiles = new Set<string>();
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) {
        occupiedTiles.add(`${x},${y}`);
      }
    }

    // Optional (min=0) should skip without throwing
    const slots: LayoutSlot[] = [
      createSlot('bartender', { min: 0, max: 1, nearPurpose: 'workspace' }),
    ];
    const positioned = algorithm!(
      createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles, [anchor])
    );

    expect(positioned.length).toBe(0);
  });
});

// ============================================================================
// Center-Floor Placement Algorithm Tests (FEAT-040)
// ============================================================================

describe('center_floor algorithm', () => {
  it('places slots away from walls, toward room center', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    expect(algorithm).toBeDefined();

    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(1);

    const pos = positioned[0];
    const lx = pos.x - shape.bounds.x;
    const ly = pos.y - shape.bounds.y;

    // Should be on a floor tile
    expect(shape.blockedMask[ly]?.[lx]).toBe(false);

    // Should NOT be wall-adjacent (distance to wall perimeter > 1)
    const distFromWall = Math.min(
      lx,
      ly,
      shape.bounds.width - 1 - lx,
      shape.bounds.height - 1 - ly
    );
    expect(distFromWall).toBeGreaterThan(1);
  });

  it('placements cluster near centroid', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    const shape = createTestShape(30, 30);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 3, max: 3 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(3);

    // Centroid of a 30x30 room interior (1..28) is approximately (14.5, 14.5)
    const centroidX = 14.5;
    const centroidY = 14.5;

    for (const pos of positioned) {
      const dx = Math.abs(pos.x - centroidX);
      const dy = Math.abs(pos.y - centroidY);
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Should be in the inner portion of the room, not near edges
      expect(dist).toBeLessThan(10);
    }
  });

  it('respects min/max', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    const shape = createTestShape(20, 20);

    const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));
    expect(positioned.length).toBe(2);
  });

  it('works in L-shaped rooms', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    const lShape = createLShapeRoom(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];
    const positioned = algorithm!(createCtx(lShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(2);

    // All should be on floor tiles (not blocked)
    for (const pos of positioned) {
      expect(lShape.blockedMask[pos.y]?.[pos.x]).toBe(false);
    }
  });

  it('works in T-shaped rooms', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    const tShape = createTShapeRoom(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];
    const positioned = algorithm!(createCtx(tShape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(2);

    for (const pos of positioned) {
      expect(tShape.blockedMask[pos.y]?.[pos.x]).toBe(false);
    }
  });

  it('falls back to all floor tiles when room is too small for center tiles', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    // 5x5 room: 3x3 interior, all interior tiles are wall-adjacent
    const smallShape = createTestShape(5, 5);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 1, max: 1 })];
    const positioned = algorithm!(
      createCtx(smallShape, slots, 42, DUMMY_VARIANT, new Set<string>())
    );

    // Should still place (falls back to all floor tiles)
    expect(positioned.length).toBe(1);
  });

  it('generates consistent results with same seed', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];

    const result1 = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));
    const result2 = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(result1.length).toBe(result2.length);
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i].x).toBe(result2[i].x);
      expect(result1[i].y).toBe(result2[i].y);
    }
  });

  it('respects occupiedTiles', () => {
    const algorithm = getPlacementAlgorithm('center_floor');
    const shape = createTestShape(20, 20);
    const occupiedTiles = new Set<string>();

    const slots1: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];
    const slots2: LayoutSlot[] = [createSlot('table', { min: 2, max: 2 })];

    const result1 = algorithm!(createCtx(shape, slots1, 42, DUMMY_VARIANT, occupiedTiles));
    const result2 = algorithm!(createCtx(shape, slots2, 42, DUMMY_VARIANT, occupiedTiles));

    expect(result1.length).toBe(2);
    expect(result2.length).toBe(2);

    const allPositions = new Set<string>();
    for (const pos of [...result1, ...result2]) {
      const key = `${pos.x},${pos.y}`;
      expect(allPositions.has(key)).toBe(false);
      allPositions.add(key);
    }
  });
});

// ============================================================================
// in_wall floor adjacency filter (BUG-180)
// ============================================================================

describe('in_wall floor adjacency filter (BUG-180)', () => {
  /**
   * Create a room where room and wall masks overlap at the boundary (mimics
   * production Wang 2-corner autotiling). A 2-tile-thick wall segment on the
   * east side creates boundary tiles with no adjacent walkable floor.
   */
  function createOverlappingMaskRoom(width: number, height: number): GeneratedShape {
    const roomMask: boolean[][] = [];
    const wallMask: boolean[][] = [];
    const blockedMask: boolean[][] = [];

    for (let y = 0; y < height; y++) {
      roomMask[y] = [];
      wallMask[y] = [];
      blockedMask[y] = [];
      for (let x = 0; x < width; x++) {
        // Room layer covers interior (1..W-2, 1..H-2) — includes perimeter overlap
        const inRoom = x >= 1 && x < width - 1 && y >= 1 && y < height - 1;
        roomMask[y][x] = inRoom;

        // Wall: standard 1-tile perimeter ring (inner boundary of room)
        const isPerimeter = inRoom && (x === 1 || x === width - 2 || y === 1 || y === height - 2);
        // Extra: 2-tile-thick wall on east side (column width-3 also wall)
        const isThickEastWall = inRoom && x === width - 3 && y >= 1 && y < height - 1;
        wallMask[y][x] = isPerimeter || isThickEastWall;

        blockedMask[y][x] = !inRoom;
      }
    }

    return {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width, height },
      terrainGrid: null,
      layerMasks: { room: roomMask, walls: wallMask },
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
  }

  it('rejects east-wall boundary tiles with no adjacent floor', () => {
    const algorithm = getPlacementAlgorithm('in_wall');
    // 10x10 room: east wall is 2 tiles thick (columns 7 and 8 are both wall).
    // Column 8 boundary tiles have only column 7 as cardinal room neighbor,
    // but column 7 is also wall — so no adjacent floor tile.
    const shape = createOverlappingMaskRoom(10, 10);

    const slots: LayoutSlot[] = [createSlot('exit', { min: 0, max: 6 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    // Build floorTileSet (roomTileSet minus wall) to verify placements
    const floorTiles = new Set<string>();
    const roomMask = shape.layerMasks['room'] as boolean[][];
    const wallMask = shape.layerMasks['walls'] as boolean[][];
    for (let y = 0; y < shape.bounds.height; y++) {
      for (let x = 0; x < shape.bounds.width; x++) {
        if (roomMask[y][x] && !wallMask[y][x]) {
          floorTiles.add(`${x},${y}`);
        }
      }
    }

    // Every placed slot must have at least one cardinal floor neighbor
    for (const pos of positioned) {
      const hasFloor =
        floorTiles.has(`${pos.x},${pos.y - 1}`) ||
        floorTiles.has(`${pos.x},${pos.y + 1}`) ||
        floorTiles.has(`${pos.x - 1},${pos.y}`) ||
        floorTiles.has(`${pos.x + 1},${pos.y}`);
      expect(hasFloor, `in_wall slot at (${pos.x},${pos.y}) has no adjacent floor`).toBe(true);
    }

    // None should be placed at x=8 (the outer east boundary with thick wall)
    const eastEdgePlacements = positioned.filter((p) => p.x === 8);
    expect(eastEdgePlacements.length).toBe(0);
  });

  it('still places objects in standard rectangular rooms', () => {
    const algorithm = getPlacementAlgorithm('in_wall');
    const shape = createTestShape(20, 20);

    const slots: LayoutSlot[] = [createSlot('exit', { min: 4, max: 4 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(4);
  });
});

// ============================================================================
// in_wall + against_wall interaction (BUG-064)
// ============================================================================

describe('in_wall door buffer prevents against_wall overlap (BUG-064)', () => {
  /**
   * Helper to get the floor tiles adjacent to a wall-placed door.
   * Mirrors the logic in occupyDoorBuffer using wall-direction occupancy.
   */
  function getDoorBufferTiles(
    doorX: number,
    doorY: number,
    facing: string,
    shape: GeneratedShape,
    variant: LayoutVariant
  ): string[] {
    const floorTiles = new Set<string>();
    const bounds = shape.bounds;
    for (const layerConfig of variant.terrainLayers) {
      if (layerConfig.type === 'wall') continue;
      const mask = shape.layerMasks[layerConfig.id] as boolean[][] | undefined;
      if (!mask) continue;
      for (let ly = 0; ly < bounds.height; ly++) {
        for (let lx = 0; lx < bounds.width; lx++) {
          if (mask[ly]?.[lx]) {
            floorTiles.add(`${bounds.x + lx},${bounds.y + ly}`);
          }
        }
      }
    }

    // Wall direction from facing (facing is OPPOSITE_WALL[wall])
    const isHorizontal = facing === 'south' || facing === 'north';

    const buffer: string[] = [];
    if (isHorizontal) {
      if (floorTiles.has(`${doorX},${doorY + 1}`)) {
        buffer.push(`${doorX},${doorY + 1}`, `${doorX + 1},${doorY + 1}`);
      } else if (floorTiles.has(`${doorX},${doorY - 1}`)) {
        buffer.push(`${doorX},${doorY - 1}`, `${doorX + 1},${doorY - 1}`);
      }
    } else {
      if (floorTiles.has(`${doorX + 1},${doorY}`)) {
        buffer.push(`${doorX + 1},${doorY}`, `${doorX + 1},${doorY + 1}`);
      } else if (floorTiles.has(`${doorX - 1},${doorY}`)) {
        buffer.push(`${doorX - 1},${doorY}`, `${doorX - 1},${doorY + 1}`);
      }
    }
    return buffer;
  }

  it('in_wall reserves adjacent floor tiles as buffer zones', () => {
    const shape = createTestShape(15, 15);
    const inWall = getPlacementAlgorithm('in_wall');
    const occupiedTiles = new Set<string>();

    const doorSlots: LayoutSlot[] = [createSlot('exit', { min: 2, max: 2 })];
    const doors = inWall!(createCtx(shape, doorSlots, 42, DUMMY_VARIANT, occupiedTiles));
    expect(doors.length).toBe(2);

    // Each door should have reserved its adjacent floor tiles
    for (const door of doors) {
      const bufferTiles = getDoorBufferTiles(door.x, door.y, door.facing, shape, DUMMY_VARIANT);
      for (const tile of bufferTiles) {
        expect(occupiedTiles.has(tile)).toBe(true);
      }
    }
  });

  it('against_wall does not place furniture on door buffer tiles', () => {
    const shape = createTestShape(15, 15);
    const inWall = getPlacementAlgorithm('in_wall');
    const againstWall = getPlacementAlgorithm('against_wall');
    const occupiedTiles = new Set<string>();

    // Place doors first (as the generator now does via sorting)
    const doorSlots: LayoutSlot[] = [createSlot('exit', { min: 2, max: 2 })];
    const doors = inWall!(createCtx(shape, doorSlots, 42, DUMMY_VARIANT, occupiedTiles));
    expect(doors.length).toBe(2);

    // Collect all door buffer tiles
    const bufferTileSet = new Set<string>();
    for (const door of doors) {
      for (const tile of getDoorBufferTiles(door.x, door.y, door.facing, shape, DUMMY_VARIANT)) {
        bufferTileSet.add(tile);
      }
    }

    // Place furniture against walls
    const furnitureSlots: LayoutSlot[] = [createSlot('sleeping', { min: 3, max: 3 })];
    const furniture = againstWall!(
      createCtx(shape, furnitureSlots, 99, DUMMY_VARIANT, occupiedTiles)
    );
    expect(furniture.length).toBe(3);

    // No furniture placed on buffer tiles
    for (const f of furniture) {
      // Check 2x2 occupancy block of each furniture piece
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          expect(bufferTileSet.has(`${f.x + dx},${f.y + dy}`)).toBe(false);
        }
      }
    }
  });

  it('against_wall still places furniture when doors leave enough space', () => {
    // Larger room ensures plenty of wall-adjacent tiles remain after door buffer
    const shape = createTestShape(20, 20);
    const inWall = getPlacementAlgorithm('in_wall');
    const againstWall = getPlacementAlgorithm('against_wall');
    const occupiedTiles = new Set<string>();

    const doorSlots: LayoutSlot[] = [createSlot('exit', { min: 1, max: 1 })];
    const doors = inWall!(createCtx(shape, doorSlots, 42, DUMMY_VARIANT, occupiedTiles));
    expect(doors.length).toBe(1);

    const furnitureSlots: LayoutSlot[] = [createSlot('sleeping', { min: 5, max: 5 })];
    const furniture = againstWall!(
      createCtx(shape, furnitureSlots, 99, DUMMY_VARIANT, occupiedTiles)
    );
    expect(furniture.length).toBe(5);
  });
});

// =============================================================================
// BUG-106: Terrain passability filtering
// =============================================================================

describe('BUG-106: Terrain Passability Filtering', () => {
  /**
   * Variant where a fill layer (water, blocks) covers everything and a
   * small rectangle layer (land, unblocks) carves out walkable ground.
   * Some tiles are unblocked by the rectangle but a third layer paints
   * impassable terrain (void, blocking: none) on a subset — making them
   * look passable in blockedMask but impassable in terrainGrid.
   */
  const TERRAIN_VARIANT: LayoutVariant = {
    id: 'terrain-test',
    scale: 'feet',
    environment: ENVIRONMENT_PRESETS.interior(),
    width: { min: 20, max: 20 },
    height: { min: 20, max: 20 },
    terrainLayers: [
      {
        id: 'ocean_fill',
        tilesetId: 'ocean',
        tilesetOffset: null,
        type: 'fill',
        blocking: 'blocks',
        terrain: 'water',
        renderOrder: 0,
        fill: [0],
        procedural: false,
      },
      {
        id: 'land_patch',
        tilesetId: 'grass',
        tilesetOffset: null,
        type: 'rectangle',
        blocking: 'unblocks',
        terrain: 'land',
        renderOrder: 1,
        fill: [0],
        procedural: false,
      },
      {
        // A decorative layer that paints void terrain without changing blocking
        id: 'void_overlay',
        tilesetId: 'decoration',
        tilesetOffset: null,
        type: 'fill',
        blocking: 'none',
        terrain: 'void',
        renderOrder: 2,
        fill: [0],
        procedural: false,
      },
    ],
    slots: [],
    description: 'terrain passability test variant',
    weight: 1,
    defaultBlocked: false,
  };

  /**
   * Create a 20x20 shape where:
   * - blockedMask: perimeter blocked, interior unblocked (standard room)
   * - terrainGrid: interior rows 1-9 are land_patch (walkable),
   *   interior rows 10-18 are void_overlay (impassable terrain despite unblocked mask)
   */
  function createTerrainTestShape(): GeneratedShape {
    const width = 20;
    const height = 20;
    const blockedMask: boolean[][] = [];
    const terrainGrid: string[][] = [];

    for (let y = 0; y < height; y++) {
      blockedMask[y] = [];
      terrainGrid[y] = [];
      for (let x = 0; x < width; x++) {
        const isPerimeter = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        blockedMask[y][x] = isPerimeter;
        if (isPerimeter) {
          terrainGrid[y][x] = 'ocean_fill'; // water terrain
        } else if (y <= 9) {
          terrainGrid[y][x] = 'land_patch'; // land terrain — walkable
        } else {
          terrainGrid[y][x] = 'void_overlay'; // void terrain — impassable
        }
      }
    }

    return {
      blockedMask,
      bounds: { x: 0, y: 0, width, height },
      terrainGrid,
      layers: [],
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };
  }

  describe('getWalkableLayerIds', () => {
    it('returns only layers with walkable terrain tags', () => {
      const walkable = getWalkableLayerIds(TERRAIN_VARIANT);
      expect(walkable.has('land_patch')).toBe(true);
      expect(walkable.has('ocean_fill')).toBe(false);
      expect(walkable.has('void_overlay')).toBe(false);
    });
  });

  describe('random_valid avoids impassable terrain', () => {
    it('places slots only on walkable terrain tiles', () => {
      const shape = createTerrainTestShape();
      const randomValid = getPlacementAlgorithm('random_valid')!;
      const occupiedTiles = new Set<string>();

      // Place multiple slots — walkable area is y=1-9, x=1-18 (162 tiles).
      // With 2x2 occupancy, plenty of room for 8 slots.
      const slots = [createSlot('decoration', { min: 8, max: 8 })];
      const positioned = randomValid(createCtx(shape, slots, 42, TERRAIN_VARIANT, occupiedTiles));

      expect(positioned.length).toBe(8);

      // All placed slots must be on land_patch tiles (y <= 9, interior)
      for (const pos of positioned) {
        expect(pos.y).toBeGreaterThanOrEqual(1);
        expect(pos.y).toBeLessThanOrEqual(9);
        expect(pos.x).toBeGreaterThanOrEqual(1);
        expect(pos.x).toBeLessThanOrEqual(18);
      }
    });

    it('throws when not enough walkable tiles for required slots', () => {
      const shape = createTerrainTestShape();
      const randomValid = getPlacementAlgorithm('random_valid')!;
      const occupiedTiles = new Set<string>();

      // Request more required slots than available walkable tiles.
      // Walkable interior: y=1-9, x=1-18 = 162 tiles with 1x1 occupancy.
      const slots = [createSlot('decoration', { min: 200, max: 200 })];
      expect(() =>
        randomValid(createCtx(shape, slots, 42, TERRAIN_VARIANT, occupiedTiles))
      ).toThrow('no passable tiles available');
    });
  });

  describe('near_slot avoids impassable terrain', () => {
    it('places near-slot only on walkable terrain tiles', () => {
      const shape = createTerrainTestShape();
      const nearSlot = getPlacementAlgorithm('near_slot')!;
      const occupiedTiles = new Set<string>();

      // Place an anchor at a walkable tile (5,5) — on land_patch
      const anchorSlot = createSlot('workspace', { min: 1, max: 1 });
      const anchor: PositionedSlot = {
        slot: anchorSlot,
        x: 5,
        y: 5,
        width: 1,
        height: 1,
      };
      occupiedTiles.add('5,5');
      occupiedTiles.add('6,5');
      occupiedTiles.add('5,6');
      occupiedTiles.add('6,6');

      // Place near_slot character near the anchor
      const charSlots = [createSlot('bartender', { min: 1, max: 1, nearPurpose: 'workspace' })];
      const positioned = nearSlot(
        createCtx(shape, charSlots, 42, TERRAIN_VARIANT, occupiedTiles, [anchor])
      );

      expect(positioned.length).toBe(1);
      // Must be on a walkable tile (land_patch: y <= 9, interior)
      expect(positioned[0].y).toBeGreaterThanOrEqual(1);
      expect(positioned[0].y).toBeLessThanOrEqual(9);
      expect(positioned[0].x).toBeGreaterThanOrEqual(1);
      expect(positioned[0].x).toBeLessThanOrEqual(18);
    });

    it('does not place near-slot on impassable terrain even when close to anchor', () => {
      const shape = createTerrainTestShape();
      const nearSlot = getPlacementAlgorithm('near_slot')!;
      const occupiedTiles = new Set<string>();

      // Place anchor at y=9 (last walkable row) — near_slot searches y=7..11+
      // Tiles at y>=10 have void_overlay (impassable) — they should be excluded
      const anchorSlot = createSlot('workspace', { min: 1, max: 1 });
      const anchor: PositionedSlot = {
        slot: anchorSlot,
        x: 10,
        y: 9,
        width: 1,
        height: 1,
      };
      occupiedTiles.add('10,9');
      occupiedTiles.add('11,9');
      occupiedTiles.add('10,10');
      occupiedTiles.add('11,10');

      const charSlots = [createSlot('guard', { min: 1, max: 1, nearPurpose: 'workspace' })];
      const positioned = nearSlot(
        createCtx(shape, charSlots, 42, TERRAIN_VARIANT, occupiedTiles, [anchor])
      );

      expect(positioned.length).toBe(1);
      // Must NOT be on void_overlay tiles (y >= 10)
      expect(positioned[0].y).toBeLessThanOrEqual(9);
    });
  });
});

// FEAT-238: Supported Orientations — algorithms set facing
// ============================================================================

describe('FEAT-238: Non-wall algorithms set facing from supportedOrientations', () => {
  it('random_valid sets facing when getRandomSupportedFacing returns a direction', () => {
    mockGetRandomSupportedFacing.mockReturnValue('east');
    const algorithm = getPlacementAlgorithm('random_valid');
    const shape = createTestShape(10, 10);
    const slot = createSlot('decoration', { min: 1, max: 1 });
    const positioned = algorithm(createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>()));
    expect(positioned.length).toBe(1);
    expect(positioned[0].facing).toBe('east');
  });

  it('random_valid sets facing to south when getRandomSupportedFacing returns south', () => {
    mockGetRandomSupportedFacing.mockReturnValue('south');
    const algorithm = getPlacementAlgorithm('random_valid');
    const shape = createTestShape(10, 10);
    const slot = createSlot('sleeping', { min: 1, max: 1 });
    const positioned = algorithm(createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>()));
    expect(positioned.length).toBe(1);
    expect(positioned[0].facing).toBe('south');
  });

  it('clustered sets facing when getRandomSupportedFacing returns a direction', () => {
    mockGetRandomSupportedFacing.mockReturnValue('north');
    const algorithm = getPlacementAlgorithm('clustered');
    const shape = createTestShape(10, 10);
    const slot = createSlot('storage', { min: 2, max: 2 });
    const positioned = algorithm(createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>()));
    expect(positioned.length).toBe(2);
    positioned.forEach((p) => expect(p.facing).toBe('north'));
  });

  it('center_floor sets facing when getRandomSupportedFacing returns a direction', () => {
    mockGetRandomSupportedFacing.mockReturnValue('west');
    const algorithm = getPlacementAlgorithm('center_floor');
    const shape = createTestShape(15, 15);
    const slot = createSlot('decoration', { min: 1, max: 1 });
    const positioned = algorithm(createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>()));
    expect(positioned.length).toBe(1);
    expect(positioned[0].facing).toBe('west');
  });

  it('near_slot sets facing when getRandomSupportedFacing returns a direction', () => {
    mockGetRandomSupportedFacing.mockReturnValue('south');
    const nearSlot = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(15, 15);
    const anchorSlot = createSlot('sleeping', { min: 1, max: 1 });
    const anchor: PositionedSlot = { slot: anchorSlot, x: 7, y: 7, width: 1, height: 1 };
    const slot = createSlot('lighting', { min: 1, max: 1, nearPurpose: 'sleeping' });
    const positioned = nearSlot(
      createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );
    expect(positioned.length).toBe(1);
    expect(positioned[0].facing).toBe('south');
  });
});

// FEAT-421: computeFacingToward — cardinal direction from one tile toward another
// ============================================================================

describe('FEAT-421: computeFacingToward', () => {
  it('returns south when target is directly below', () => {
    expect(computeFacingToward(5, 5, 5, 8)).toBe('south');
  });

  it('returns north when target is directly above', () => {
    expect(computeFacingToward(5, 5, 5, 2)).toBe('north');
  });

  it('returns east when target is directly to the right', () => {
    expect(computeFacingToward(5, 5, 8, 5)).toBe('east');
  });

  it('returns west when target is directly to the left', () => {
    expect(computeFacingToward(5, 5, 2, 5)).toBe('west');
  });

  it('returns south for same tile (default facing)', () => {
    expect(computeFacingToward(5, 5, 5, 5)).toBe('south');
  });

  it('prefers east/west on exact diagonal (tiebreak)', () => {
    // NE diagonal: dx=3, dy=-3 — equal magnitudes, prefer horizontal
    expect(computeFacingToward(5, 5, 8, 2)).toBe('east');
    // SW diagonal: dx=-3, dy=3 — equal magnitudes, prefer horizontal
    expect(computeFacingToward(5, 5, 2, 8)).toBe('west');
  });

  it('returns correct facing for off-axis angles', () => {
    // Mostly east, slightly south: dx=5, dy=2
    expect(computeFacingToward(0, 0, 5, 2)).toBe('east');
    // Mostly south, slightly east: dx=2, dy=5
    expect(computeFacingToward(0, 0, 2, 5)).toBe('south');
    // Mostly north, slightly west: dx=-1, dy=-4
    expect(computeFacingToward(5, 5, 4, 1)).toBe('north');
    // Mostly west, slightly north: dx=-4, dy=-1
    expect(computeFacingToward(5, 5, 1, 4)).toBe('west');
  });
});

// FEAT-421: near_slot facesAnchor — orient placed slots toward anchor
// ============================================================================

describe('FEAT-421: near_slot with facesAnchor', () => {
  it('faces east when anchor is to the right', () => {
    mockGetRandomSupportedFacing.mockReturnValue('south');
    const nearSlot = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(15, 15);
    const anchorSlot = createSlot('table', { min: 1, max: 1 });
    // Anchor at (10, 7) — to the right of center
    const anchor: PositionedSlot = {
      slot: anchorSlot,
      x: 10,
      y: 7,
      width: 1,
      height: 1,
      facing: 'south',
      layer: 'default',
    };
    const slot = createSlot('seating', { min: 1, max: 1, nearPurpose: 'table', facesAnchor: true });
    const positioned = nearSlot(
      createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );
    expect(positioned.length).toBe(1);
    // The placed slot should face toward the anchor, not random
    const dx = anchor.x - positioned[0].x;
    const dy = anchor.y - positioned[0].y;
    // Verify facing is consistent with the direction to anchor
    if (Math.abs(dx) >= Math.abs(dy)) {
      expect(positioned[0].facing).toBe(dx > 0 ? 'east' : 'west');
    } else {
      expect(positioned[0].facing).toBe(dy > 0 ? 'south' : 'north');
    }
  });

  it('uses random facing when facesAnchor is not set', () => {
    mockGetRandomSupportedFacing.mockReturnValue('west');
    const nearSlot = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(15, 15);
    const anchorSlot = createSlot('table', { min: 1, max: 1 });
    const anchor: PositionedSlot = {
      slot: anchorSlot,
      x: 10,
      y: 7,
      width: 1,
      height: 1,
      facing: 'south',
      layer: 'default',
    };
    const slot = createSlot('seating', { min: 1, max: 1, nearPurpose: 'table' });
    const positioned = nearSlot(
      createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );
    expect(positioned.length).toBe(1);
    expect(positioned[0].facing).toBe('west');
  });

  it('places multiple slots all facing their nearest anchor', () => {
    mockGetRandomSupportedFacing.mockReturnValue('south');
    const nearSlot = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(20, 20);
    const anchorSlot = createSlot('table', { min: 1, max: 1 });
    const anchor: PositionedSlot = {
      slot: anchorSlot,
      x: 10,
      y: 10,
      width: 1,
      height: 1,
      facing: 'south',
      layer: 'default',
    };
    const slot = createSlot('seating', { min: 3, max: 3, nearPurpose: 'table', facesAnchor: true });
    const positioned = nearSlot(
      createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );
    expect(positioned.length).toBe(3);
    for (const p of positioned) {
      const dx = anchor.x - p.x;
      const dy = anchor.y - p.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        expect(p.facing).toBe(dx > 0 ? 'east' : 'west');
      } else {
        expect(p.facing).toBe(dy > 0 ? 'south' : 'north');
      }
    }
  });

  it('places at distance 1 (adjacent) when facesAnchor is true', () => {
    mockGetRandomSupportedFacing.mockReturnValue('south');
    const nearSlot = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(15, 15);
    const anchorSlot = createSlot('table', { min: 1, max: 1 });
    const anchor: PositionedSlot = {
      slot: anchorSlot,
      x: 7,
      y: 7,
      width: 1,
      height: 1,
      facing: 'south',
      layer: 'default',
    };
    const slot = createSlot('seating', { min: 1, max: 1, nearPurpose: 'table', facesAnchor: true });
    const positioned = nearSlot(
      createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );
    expect(positioned.length).toBe(1);
    // Chebyshev distance should be 1 (adjacent to anchor)
    const dist = Math.max(
      Math.abs(positioned[0].x - anchor.x),
      Math.abs(positioned[0].y - anchor.y)
    );
    expect(dist).toBe(1);
  });

  it('places at distance 2+ when facesAnchor is not set', () => {
    mockGetRandomSupportedFacing.mockReturnValue('south');
    const nearSlot = getPlacementAlgorithm('near_slot');
    const shape = createTestShape(15, 15);
    const anchorSlot = createSlot('table', { min: 1, max: 1 });
    const anchor: PositionedSlot = {
      slot: anchorSlot,
      x: 7,
      y: 7,
      width: 1,
      height: 1,
      facing: 'south',
      layer: 'default',
    };
    const slot = createSlot('seating', { min: 1, max: 1, nearPurpose: 'table' });
    const positioned = nearSlot(
      createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>(), [anchor])
    );
    expect(positioned.length).toBe(1);
    // Without facesAnchor, distance should be >= 2 (INITIAL_NEAR_DISTANCE)
    const dist = Math.max(
      Math.abs(positioned[0].x - anchor.x),
      Math.abs(positioned[0].y - anchor.y)
    );
    expect(dist).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// selectByDistribution Tests
// ============================================================================

describe('selectByDistribution', () => {
  function makeRng(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }

  const tiles = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 15, y: 0 },
    { x: 20, y: 0 },
  ];

  it('returns the only candidate when available.length === 1', () => {
    const result = selectByDistribution([{ x: 3, y: 4 }], [{ x: 0, y: 0 }], makeRng(1), 'even');
    expect(result).toEqual({ x: 3, y: 4 });
  });

  it('returns a candidate when no placed objects exist (any mode)', () => {
    const result = selectByDistribution(tiles, [], makeRng(1), 'even');
    expect(tiles).toContainEqual(result);
  });

  it('random mode produces uniform distribution (no spatial bias)', () => {
    const placed = [{ x: 0, y: 0 }];
    const counts = new Map<number, number>();
    for (let i = 0; i < 1000; i++) {
      const result = selectByDistribution(tiles, placed, makeRng(i * 7 + 13), 'random');
      counts.set(result.x, (counts.get(result.x) ?? 0) + 1);
    }
    // Each of the 5 tiles should get roughly 200 picks (20%). Accept 10-30%.
    for (const tile of tiles) {
      const count = counts.get(tile.x) ?? 0;
      expect(count).toBeGreaterThan(100);
      expect(count).toBeLessThan(300);
    }
  });

  it('even mode prefers tiles farther from placed objects', () => {
    const placed = [{ x: 0, y: 0 }];
    const counts = new Map<number, number>();
    for (let i = 0; i < 1000; i++) {
      const result = selectByDistribution(tiles, placed, makeRng(i * 7 + 13), 'even');
      counts.set(result.x, (counts.get(result.x) ?? 0) + 1);
    }
    const farCount = counts.get(20) ?? 0;
    const nearCount = counts.get(5) ?? 0;
    expect(farCount).toBeGreaterThan(nearCount);
  });

  it('clumped mode prefers tiles closer to placed objects', () => {
    const placed = [{ x: 0, y: 0 }];
    const counts = new Map<number, number>();
    for (let i = 0; i < 1000; i++) {
      const result = selectByDistribution(tiles, placed, makeRng(i * 7 + 13), 'clumped');
      counts.set(result.x, (counts.get(result.x) ?? 0) + 1);
    }
    const closestCount = counts.get(0) ?? 0;
    const farthestCount = counts.get(20) ?? 0;
    expect(closestCount).toBeGreaterThan(farthestCount);
  });

  it('even mode still produces valid candidates (no out-of-bounds)', () => {
    const placed = [{ x: 10, y: 10 }];
    for (let i = 0; i < 100; i++) {
      const result = selectByDistribution(tiles, placed, makeRng(i), 'even');
      expect(tiles).toContainEqual(result);
    }
  });

  it('random_valid algorithm uses distribution from slot', () => {
    const shape = createTestShape(20, 20);
    const randomValid = getPlacementAlgorithm('random_valid')!;

    const slotsRandom = [createSlot('decoration', { min: 1, max: 5, distribution: 'random' })];
    const ctxRandom = createCtx(shape, slotsRandom, 42, DUMMY_VARIANT, new Set());
    const resultRandom = randomValid(ctxRandom);
    expect(resultRandom.length).toBe(5);

    const slotsEven = [createSlot('decoration', { min: 1, max: 5, distribution: 'even' })];
    const ctxEven = createCtx(shape, slotsEven, 42, DUMMY_VARIANT, new Set());
    const resultEven = randomValid(ctxEven);
    expect(resultEven.length).toBe(5);

    for (const pos of [...resultRandom, ...resultEven]) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('small room with few tiles: all distribution modes succeed without throwing', () => {
    // 5x5 room → 3x3 floor (9 tiles), few candidates
    const shape = createTestShape(5, 5);
    const randomValid = getPlacementAlgorithm('random_valid')!;

    for (const distribution of ['even', 'random', 'clumped'] as const) {
      const slots = [createSlot('decoration', { min: 1, max: 3, distribution })];
      const ctx = createCtx(shape, slots, 99, DUMMY_VARIANT, new Set());
      const result = randomValid(ctx);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(3);
      for (const pos of result) {
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.x).toBeLessThan(shape.bounds.width);
        expect(pos.y).toBeGreaterThanOrEqual(0);
        expect(pos.y).toBeLessThan(shape.bounds.height);
      }
    }
  });
});

// ============================================================================
// under algorithm
// ============================================================================

describe('under algorithm', () => {
  it('prefers tiles already in occupiedTiles (furniture-occupied)', () => {
    const algorithm = getPlacementAlgorithm('under');
    expect(algorithm).toBeDefined();

    const shape = createTestShape(20, 20);
    // Pre-occupy a small cluster of tiles in the interior to simulate furniture
    const occupiedTiles = new Set<string>(['10,10', '11,10', '10,11', '11,11']);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles));

    expect(positioned.length).toBe(1);
    // Placed tile should be one of the pre-occupied floor tiles
    const key = `${positioned[0].x},${positioned[0].y}`;
    expect(occupiedTiles.has(key)).toBe(true);
  });

  it('falls back to non-wall-adjacent floor tiles when no occupied tiles exist', () => {
    const algorithm = getPlacementAlgorithm('under');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(1);

    const pos = positioned[0];
    const lx = pos.x - shape.bounds.x;
    const ly = pos.y - shape.bounds.y;

    // Should be on a floor tile
    expect(shape.blockedMask[ly]?.[lx]).toBe(false);
    // Should be away from the wall perimeter
    const distFromWall = Math.min(
      lx,
      ly,
      shape.bounds.width - 1 - lx,
      shape.bounds.height - 1 - ly
    );
    expect(distFromWall).toBeGreaterThan(1);
  });

  it('does not add to occupiedTiles after placing', () => {
    const algorithm = getPlacementAlgorithm('under');
    const shape = createTestShape(20, 20);
    const occupiedTiles = new Set<string>();
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];

    algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles));

    // occupiedTiles must remain empty — rugs must not block furniture placement
    expect(occupiedTiles.size).toBe(0);
  });

  it('does not place two rugs on the exact same tile', () => {
    const algorithm = getPlacementAlgorithm('under');
    const shape = createTestShape(20, 20);
    // Empty occupiedTiles → falls back to centerTiles (many positions available)
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(2);
    expect(positioned[0].x !== positioned[1].x || positioned[0].y !== positioned[1].y).toBe(true);
  });

  it('does not place rugs from separate slots with overlapping footprints', () => {
    const algorithm = getPlacementAlgorithm('under');
    const shape = createTestShape(20, 20);
    // Two separate slots simulates two floor_covering slots in a layout template.
    // Empty occupiedTiles → falls back to centerTiles (many positions available).
    const slots: LayoutSlot[] = [
      createSlot('decoration', { min: 1, max: 1 }),
      createSlot('decoration', { min: 1, max: 1 }),
    ];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(2);

    // With 1x1 slotSize, footprint is 1x1 tile at the anchor position.
    const key1 = `${positioned[0].x},${positioned[0].y}`;
    const key2 = `${positioned[1].x},${positioned[1].y}`;
    expect(key1).not.toBe(key2);
  });

  it('sets layer to floor', () => {
    const algorithm = getPlacementAlgorithm('under');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

    expect(positioned.length).toBe(1);
    expect(positioned[0].layer).toBe('floor');
  });

  it('respects min/max', () => {
    const algorithm = getPlacementAlgorithm('under');
    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('decoration', { min: 2, max: 2 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));
    expect(positioned.length).toBe(2);
  });
});

// ============================================================================
// BUG-174: Overlapping room/wall masks (Wang 2-corner autotiling)
// ============================================================================

describe('BUG-174: room/wall mask overlap regression', () => {
  /**
   * Wang 2-corner autotiling places wall tiles ON room boundary positions
   * (both room mask and wall mask are true). This helper creates a shape
   * simulating that overlap: the perimeter ring has both masks true.
   */
  function createOverlappingShape(
    width: number,
    height: number
  ): {
    shape: GeneratedShape;
    variant: LayoutVariant;
  } {
    const wallMask: boolean[][] = [];
    const floorMask: boolean[][] = [];
    const wallFaceMask: boolean[][] = [];
    const blockedMask: boolean[][] = [];

    for (let y = 0; y < height; y++) {
      wallMask[y] = [];
      floorMask[y] = [];
      wallFaceMask[y] = [];
      blockedMask[y] = [];
      for (let x = 0; x < width; x++) {
        const isPerimeter = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        const isInterior = !isPerimeter;
        const isFaceZone = isInterior && y >= 1 && y <= 3;

        // Key: room mask covers BOTH interior AND perimeter (Wang overlap)
        floorMask[y][x] = true;
        wallMask[y][x] = isPerimeter;
        wallFaceMask[y][x] = isFaceZone;
        blockedMask[y][x] = false; // defaultBlocked: false
      }
    }

    const variant: LayoutVariant = {
      ...DUMMY_VARIANT,
      defaultBlocked: false,
      terrainLayers: [
        DUMMY_VARIANT.terrainLayers[0],
        DUMMY_VARIANT.terrainLayers[1],
        {
          id: 'wall_faces',
          tilesetId: 'lpc-interior-walls',
          tilesetOffset: null,
          type: 'wall_face' as const,
          blocking: null,
          terrain: 'wall' as const,
          renderOrder: 1,
          wallLayerId: 'walls',
          roomLayerId: 'room',
          wallStyle: 'brick_brown',
        },
      ],
    };

    const shape: GeneratedShape = {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width, height },
      terrainGrid: null,
      layerMasks: { walls: wallMask, room: floorMask, wall_faces: wallFaceMask },
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    return { shape, variant };
  }

  it('against_wall places furniture in small rooms with overlapping masks', () => {
    const algorithm = getPlacementAlgorithm('against_wall');
    // 14x14 = minimum room size in templates
    const { shape, variant } = createOverlappingShape(14, 14);
    const slots: LayoutSlot[] = [createSlot('sleeping', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(positioned.length).toBe(1);
    // Object anchor should be on a non-wall tile (interior floor)
    const lx = positioned[0].x;
    const ly = positioned[0].y;
    const wallMask = shape.layerMasks['walls'] as boolean[][];
    // The anchor tile itself should be adjacent to a wall
    const hasWallNeighbor =
      (ly > 0 && wallMask[ly - 1]?.[lx] === true) ||
      (ly < shape.bounds.height - 1 && wallMask[ly + 1]?.[lx] === true) ||
      (lx > 0 && wallMask[ly]?.[lx - 1] === true) ||
      (lx < shape.bounds.width - 1 && wallMask[ly]?.[lx + 1] === true);
    expect(hasWallNeighbor).toBe(true);
  });

  it('in_wall places objects on wall boundary positions with overlapping masks', () => {
    const algorithm = getPlacementAlgorithm('in_wall');
    const { shape, variant } = createOverlappingShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('exit', { min: 4, max: 4 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(positioned.length).toBe(4);
    // in_wall objects should be on the room boundary (wall perimeter or face zone)
    for (const pos of positioned) {
      const lx = pos.x;
      const ly = pos.y;
      const wallMask = shape.layerMasks['walls'] as boolean[][];
      const wallFaceMask = shape.layerMasks['wall_faces'] as boolean[][];
      // Either on a wall tile, on a face tile, or directly adjacent to face/wall
      const onWall = wallMask[ly]?.[lx] === true;
      const onFace = wallFaceMask[ly]?.[lx] === true;
      const adjacentToWall =
        (ly > 0 && wallMask[ly - 1]?.[lx] === true) ||
        (ly < shape.bounds.height - 1 && wallMask[ly + 1]?.[lx] === true) ||
        (lx > 0 && wallMask[ly]?.[lx - 1] === true) ||
        (lx < shape.bounds.width - 1 && wallMask[ly]?.[lx + 1] === true);
      const adjacentToFace = ly > 0 && wallFaceMask[ly - 1]?.[lx] === true;
      expect(onWall || onFace || adjacentToWall || adjacentToFace).toBe(true);
    }
  });

  describe('multi-tile slot placement (slotSize)', () => {
    it('places a slot with custom slotSize and reserves the full footprint', () => {
      const algorithm = getPlacementAlgorithm('random_valid')!;
      const shape = createTestShape(15, 15); // 13x13 interior

      const buildingSlot: LayoutSlot = {
        ...createSlot('tavern', { min: 1, max: 1 }),
        slotSize: { width: 3, height: 4 },
      };
      const occupiedTiles = new Set<string>();
      const positioned = algorithm(
        createCtx(shape, [buildingSlot], 42, DUMMY_VARIANT, occupiedTiles)
      );

      expect(positioned).toHaveLength(1);
      const pos = positioned[0];

      // The positioned slot should have the full footprint dimensions
      expect(pos.width).toBe(3);
      expect(pos.height).toBe(4);

      // All tiles in the footprint should be occupied
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          expect(occupiedTiles.has(`${pos.x + dx},${pos.y + dy}`)).toBe(true);
        }
      }
    });

    it('does not overlap multi-tile slots with other placements', () => {
      const algorithm = getPlacementAlgorithm('random_valid')!;
      const shape = createTestShape(20, 20); // 18x18 interior

      const slots: LayoutSlot[] = [
        { ...createSlot('shop', { min: 1, max: 1 }), slotSize: { width: 3, height: 3 } },
        { ...createSlot('tavern', { min: 1, max: 1 }), slotSize: { width: 3, height: 3 } },
      ];
      const occupiedTiles = new Set<string>();
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles));

      expect(positioned).toHaveLength(2);

      // Collect all tiles from both placements
      const allTiles = new Set<string>();
      for (const pos of positioned) {
        for (let dy = 0; dy < pos.height; dy++) {
          for (let dx = 0; dx < pos.width; dx++) {
            const key = `${pos.x + dx},${pos.y + dy}`;
            expect(allTiles.has(key)).toBe(false); // No overlap
            allTiles.add(key);
          }
        }
      }
    });

    it('throws when slotSize is null (BUG-232: resolveSlotSizes must run first)', () => {
      const algorithm = getPlacementAlgorithm('random_valid')!;
      const shape = createTestShape(10, 10);

      const slot: LayoutSlot = {
        ...createSlot('table', { min: 1, max: 1 }),
        slotSize: null,
      };
      expect(() =>
        algorithm(createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set<string>()))
      ).toThrow('slotOccupancy');
    });
  });
});

// ============================================================================
// Road-Based Placement Algorithms (FEAT-385)
// ============================================================================

/**
 * Create a shape with a horizontal road stripe and open grass on either side.
 * Road runs across the middle rows (y=8..11 for width 2).
 */
function createRoadShape(
  width: number,
  height: number
): {
  shape: GeneratedShape;
  variant: LayoutVariant;
} {
  const blockedMask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false)
  );
  const roadMask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(false)
  );
  const groundMask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(true)
  );
  const terrainGrid: string[][] = Array.from({ length: height }, () =>
    new Array<string>(width).fill('ground')
  );

  // Paint road stripe across the middle
  const roadStartY = Math.floor(height / 2) - 1;
  const roadEndY = roadStartY + 1;
  for (let y = roadStartY; y <= roadEndY; y++) {
    for (let x = 0; x < width; x++) {
      roadMask[y][x] = true;
      groundMask[y][x] = false;
      terrainGrid[y][x] = 'road_layer';
    }
  }

  const variant: LayoutVariant = {
    id: 'road_test',
    scale: 'feet',
    environment: ENVIRONMENT_PRESETS.exterior(),
    width: { min: width, max: width },
    height: { min: height, max: height },
    terrainLayers: [
      {
        id: 'ground',
        tilesetId: 'grass',
        type: 'fill',
        blocking: 'unblocks',
        terrain: 'land',
        renderOrder: 0,
        fill: [0],
        procedural: false,
      },
      {
        id: 'road_layer',
        tilesetId: 'cobblestone',
        type: 'road',
        blocking: 'unblocks',
        terrain: 'road',
        renderOrder: 10,
        fill: [0],
        procedural: false,
        roadWidth: 2,
        branchCount: 0,
        curvature: 0,
        autotilePreset: 'canonical',
        autotileAgainst: ['road_layer'],
        altCenterCount: 0,
      } as TerrainLayerConfig,
    ],
    slots: [],
    description: 'road test variant',
    weight: 1,
    defaultBlocked: false,
  };

  const shape: GeneratedShape = {
    blockedMask,
    layers: [],
    bounds: { x: 0, y: 0, width, height },
    terrainGrid,
    layerMasks: { road_layer: roadMask, ground: groundMask },
    roadGraph: {
      nodes: [
        { x: 0, y: roadStartY, type: 'endpoint' },
        { x: width - 1, y: roadEndY, type: 'endpoint' },
        { x: Math.floor(width / 2), y: roadStartY, type: 'intersection' },
        { x: Math.floor(width / 2), y: 0, type: 'branch' },
      ],
      edges: [
        { from: 0, to: 2 },
        { from: 2, to: 1 },
        { from: 2, to: 3 },
      ],
    },
    caveGraph: null,
    districts: null,
  };

  return { shape, variant };
}

describe('Road-Based Placement Algorithms (FEAT-385)', () => {
  describe('along_road algorithm', () => {
    it('is registered', () => {
      expect(getPlacementAlgorithm('along_road')).toBeDefined();
    });

    it('places slots on non-road tiles adjacent to road tiles', () => {
      const algorithm = getPlacementAlgorithm('along_road')!;
      const { shape, variant } = createRoadShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('building', { min: 3, max: 3 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(3);

      // Road is at y = floor(20/2)-1 = 9 and y = 10
      const roadStartY = 9;
      const roadEndY = 10;

      for (const pos of positioned) {
        // Should NOT be on a road tile
        const isRoad = pos.y >= roadStartY && pos.y <= roadEndY;
        expect(isRoad).toBe(false);

        // Should be adjacent to a road tile (one tile above or below road stripe)
        const adjacentToRoad =
          pos.y === roadStartY - 1 || // one above
          pos.y === roadEndY + 1; // one below
        expect(adjacentToRoad).toBe(true);
      }
    });

    it('sets facing toward the nearest road tile', () => {
      const algorithm = getPlacementAlgorithm('along_road')!;
      const { shape, variant } = createRoadShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('shop', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(1);
      const pos = positioned[0];

      const roadStartY = 9;
      const roadEndY = 10;

      if (pos.y < roadStartY) {
        // Above road → should face south toward road
        expect(pos.facing).toBe('south');
      } else if (pos.y > roadEndY) {
        // Below road → should face north toward road
        expect(pos.facing).toBe('north');
      }
    });

    it('returns empty when no road layers exist', () => {
      const algorithm = getPlacementAlgorithm('along_road')!;
      // Use basic test shape with no road layers
      const shape = createTestShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('building', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned).toEqual([]);
    });

    it('respects occupiedTiles and does not overlap', () => {
      const algorithm = getPlacementAlgorithm('along_road')!;
      const { shape, variant } = createRoadShape(20, 20);

      // Road at y=9..10. Adjacent rows are y=8 (above) and y=11 (below).
      // Pre-occupy most of the adjacent row tiles.
      const occupiedTiles = new Set<string>();
      for (let x = 0; x < 15; x++) {
        occupiedTiles.add(`${x},8`); // row above road
        occupiedTiles.add(`${x},11`); // row below road
      }

      const preOccupied = new Set(occupiedTiles);
      const slots: LayoutSlot[] = [createSlot('building', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, occupiedTiles));

      expect(positioned.length).toBe(1);
      // Should not be placed on any pre-occupied tile
      expect(preOccupied.has(`${positioned[0].x},${positioned[0].y}`)).toBe(false);
    });

    it('uses slotSize for width/height and occupancy (BUG-231)', () => {
      const algorithm = getPlacementAlgorithm('along_road')!;
      const { shape, variant } = createRoadShape(30, 30);
      const slots: LayoutSlot[] = [
        { ...createSlot('tavern', { min: 1, max: 1 }), slotSize: { width: 3, height: 2 } },
      ];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(1);
      expect(positioned[0].width).toBe(3);
      expect(positioned[0].height).toBe(2);
    });

    it('multi-tile footprint does not overlap road tiles (BUG-231)', () => {
      const algorithm = getPlacementAlgorithm('along_road')!;
      // Use a large map so multi-tile buildings have room
      const { shape, variant } = createRoadShape(30, 30);
      const roadStartY = Math.floor(30 / 2) - 1; // 14
      const roadEndY = roadStartY + 1; // 15

      const slots: LayoutSlot[] = [
        { ...createSlot('shop', { min: 1, max: 1 }), slotSize: { width: 2, height: 2 } },
        { ...createSlot('tavern', { min: 1, max: 1 }), slotSize: { width: 3, height: 3 } },
      ];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(2);
      for (const pos of positioned) {
        // Verify NO tile in the footprint is on a road tile
        for (let dy = 0; dy < pos.height; dy++) {
          for (let dx = 0; dx < pos.width; dx++) {
            const ty = pos.y + dy;
            const isRoad = ty >= roadStartY && ty <= roadEndY;
            expect(isRoad).toBe(false);
          }
        }
      }
    });
  });

  describe('road_intersection algorithm', () => {
    it('is registered', () => {
      expect(getPlacementAlgorithm('road_intersection')).toBeDefined();
    });

    it('places slots near intersection nodes', () => {
      const algorithm = getPlacementAlgorithm('road_intersection')!;
      const { shape, variant } = createRoadShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('fountain', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(1);

      // The intersection node is at (10, 8). Placed tile should be nearby.
      const pos = positioned[0];
      const distToIntersection = Math.abs(pos.x - 10) + Math.abs(pos.y - 8);
      expect(distToIntersection).toBeLessThanOrEqual(10);
    });

    it('uses slotSize for width/height and occupancy (BUG-231)', () => {
      const algorithm = getPlacementAlgorithm('road_intersection')!;
      const { shape, variant } = createRoadShape(30, 30);
      const slots: LayoutSlot[] = [
        { ...createSlot('fountain', { min: 1, max: 1 }), slotSize: { width: 3, height: 2 } },
      ];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(1);
      expect(positioned[0].width).toBe(3);
      expect(positioned[0].height).toBe(2);
    });

    it('returns empty when no road graph exists', () => {
      const algorithm = getPlacementAlgorithm('road_intersection')!;
      const shape: GeneratedShape = {
        ...createTestShape(20, 20),
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };
      const slots: LayoutSlot[] = [createSlot('fountain', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned).toEqual([]);
    });

    it('returns empty when graph has no intersection nodes', () => {
      const algorithm = getPlacementAlgorithm('road_intersection')!;
      const shape: GeneratedShape = {
        ...createTestShape(20, 20),
        roadGraph: {
          nodes: [
            { x: 0, y: 10, type: 'endpoint' },
            { x: 19, y: 10, type: 'endpoint' },
          ],
          edges: [{ from: 0, to: 1 }],
        },
        districts: null,
      };
      const slots: LayoutSlot[] = [createSlot('fountain', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned).toEqual([]);
    });
  });

  describe('road_end algorithm', () => {
    it('is registered', () => {
      expect(getPlacementAlgorithm('road_end')).toBeDefined();
    });

    it('places slots near endpoint and branch nodes', () => {
      const algorithm = getPlacementAlgorithm('road_end')!;
      const { shape, variant } = createRoadShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('gate', { min: 2, max: 2 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(2);

      // Endpoints are at (0, 8), (19, 9), and branch at (10, 0)
      // Each placed slot should be near one of these
      for (const pos of positioned) {
        const distToEndpoint1 = Math.abs(pos.x - 0) + Math.abs(pos.y - 8);
        const distToEndpoint2 = Math.abs(pos.x - 19) + Math.abs(pos.y - 9);
        const distToBranch = Math.abs(pos.x - 10) + Math.abs(pos.y - 0);
        const nearAny = distToEndpoint1 <= 10 || distToEndpoint2 <= 10 || distToBranch <= 10;
        expect(nearAny).toBe(true);
      }
    });

    it('uses slotSize for width/height and occupancy (BUG-231)', () => {
      const algorithm = getPlacementAlgorithm('road_end')!;
      const { shape, variant } = createRoadShape(30, 30);
      const slots: LayoutSlot[] = [
        { ...createSlot('gate', { min: 1, max: 1 }), slotSize: { width: 3, height: 2 } },
      ];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(1);
      expect(positioned[0].width).toBe(3);
      expect(positioned[0].height).toBe(2);
    });

    it('returns empty when no road graph exists', () => {
      const algorithm = getPlacementAlgorithm('road_end')!;
      const shape: GeneratedShape = {
        ...createTestShape(20, 20),
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };
      const slots: LayoutSlot[] = [createSlot('gate', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned).toEqual([]);
    });

    it('returns empty when graph has no endpoints or branches', () => {
      const algorithm = getPlacementAlgorithm('road_end')!;
      const shape: GeneratedShape = {
        ...createTestShape(20, 20),
        roadGraph: {
          nodes: [
            { x: 5, y: 10, type: 'intersection' },
            { x: 15, y: 10, type: 'intersection' },
          ],
          edges: [{ from: 0, to: 1 }],
        },
        districts: null,
      };
      const slots: LayoutSlot[] = [createSlot('gate', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned).toEqual([]);
    });

    it('respects occupiedTiles', () => {
      const algorithm = getPlacementAlgorithm('road_end')!;
      const { shape, variant } = createRoadShape(20, 20);

      // Road at y=9..10. Endpoints at (0,9) and (19,10), branch at (10,0).
      // Pre-occupy tiles around first two endpoints.
      const occupiedTiles = new Set<string>();
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          occupiedTiles.add(`${0 + dx},${9 + dy}`);
          occupiedTiles.add(`${19 + dx},${10 + dy}`);
        }
      }

      const preOccupied = new Set(occupiedTiles);
      const slots: LayoutSlot[] = [createSlot('gate', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, occupiedTiles));

      expect(positioned.length).toBe(1);
      // Should not be placed on any pre-occupied tile
      expect(preOccupied.has(`${positioned[0].x},${positioned[0].y}`)).toBe(false);
    });

    it('returns world-space positions when bounds have non-zero offset (BUG-288)', () => {
      const algorithm = getPlacementAlgorithm('road_end')!;
      const ox = 5;
      const oy = 5;
      const { shape: baseShape, variant } = createRoadShape(20, 20);
      // Shift the shape's world origin without changing blockedMask or roadGraph
      const shape: GeneratedShape = {
        ...baseShape,
        bounds: { x: ox, y: oy, width: 20, height: 20 },
      };
      const slots: LayoutSlot[] = [createSlot('gate', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(1);
      // Returned position must be inside the world-space bounds
      expect(positioned[0].x).toBeGreaterThanOrEqual(ox);
      expect(positioned[0].y).toBeGreaterThanOrEqual(oy);
      expect(positioned[0].x).toBeLessThan(ox + 20);
      expect(positioned[0].y).toBeLessThan(oy + 20);
      // Must not land on a road tile (road rows in local space are floor(20/2)-1 = 9 and 10)
      const localY = positioned[0].y - oy;
      expect(localY === 9 || localY === 10).toBe(false);
    });
  });

  describe('road_intersection with non-zero bounds (BUG-288)', () => {
    it('returns world-space positions when bounds have non-zero offset', () => {
      const algorithm = getPlacementAlgorithm('road_intersection')!;
      const ox = 7;
      const oy = 3;
      const { shape: baseShape, variant } = createRoadShape(20, 20);
      const shape: GeneratedShape = {
        ...baseShape,
        bounds: { x: ox, y: oy, width: 20, height: 20 },
      };
      const slots: LayoutSlot[] = [createSlot('fountain', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, variant, new Set<string>()));

      expect(positioned.length).toBe(1);
      expect(positioned[0].x).toBeGreaterThanOrEqual(ox);
      expect(positioned[0].y).toBeGreaterThanOrEqual(oy);
      expect(positioned[0].x).toBeLessThan(ox + 20);
      expect(positioned[0].y).toBeLessThan(oy + 20);
    });
  });
});

// ============================================================================
// District-Weighted Selection (FEAT-386)
// ============================================================================

describe('selectByDistributionWithDistrict (FEAT-386)', () => {
  function createRng(seed: number): () => number {
    let state = seed;
    return () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('without district, behaves identically to selectByDistribution', () => {
    const available = [
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 15, y: 15 },
    ];
    const placed = [{ x: 0, y: 0 }];

    // Same seed, no district → should pick the same tile
    const result1 = selectByDistribution(available, placed, createRng(42), 'even');
    const result2 = selectByDistributionWithDistrict(
      available,
      placed,
      createRng(42),
      'even',
      null
    );
    expect(result2).toEqual(result1);
  });

  it('biases selection toward district center', () => {
    // Spread tiles across a line, district center at (50, 50)
    const available: { x: number; y: number }[] = [];
    for (let x = 0; x <= 100; x += 5) {
      available.push({ x, y: 50 });
    }

    const district: ResolvedDistrict = {
      id: 'market',
      center: { x: 50, y: 50 },
      influenceRadius: 20,
      weight: 1.0,
    };

    // Run 200 selections, compute average x
    let totalX = 0;
    for (let i = 0; i < 200; i++) {
      const tile = selectByDistributionWithDistrict(
        available,
        [],
        createRng(i),
        'random',
        district
      );
      totalX += tile.x;
    }
    const avgX = totalX / 200;

    // Without bias, average would be ~50 (center of 0-100 range).
    // With strong district bias at x=50, average should be close to 50.
    // The key test: it should be closer to 50 than without bias.
    // Run control without district
    let controlTotalX = 0;
    for (let i = 0; i < 200; i++) {
      const tile = selectByDistributionWithDistrict(available, [], createRng(i), 'random', null);
      controlTotalX += tile.x;
    }
    const controlAvgX = controlTotalX / 200;

    // District-biased average should be closer to center (50) than control
    expect(Math.abs(avgX - 50)).toBeLessThanOrEqual(Math.abs(controlAvgX - 50) + 5);
  });

  it('weight=0 produces no district bias', () => {
    const available = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
    ];
    const district: ResolvedDistrict = {
      id: 'market',
      center: { x: 50, y: 50 },
      influenceRadius: 20,
      weight: 0, // no bias
    };

    // Same seed → should match no-district selection
    const withDistrict = selectByDistributionWithDistrict(
      available,
      [],
      createRng(42),
      'random',
      district
    );
    const withoutDistrict = selectByDistribution(available, [], createRng(42), 'random');
    expect(withDistrict).toEqual(withoutDistrict);
  });

  it('single candidate returns that candidate regardless of district', () => {
    const available = [{ x: 99, y: 99 }];
    const district: ResolvedDistrict = {
      id: 'market',
      center: { x: 0, y: 0 },
      influenceRadius: 10,
      weight: 1.0,
    };
    const result = selectByDistributionWithDistrict(available, [], createRng(42), 'even', district);
    expect(result).toEqual({ x: 99, y: 99 });
  });
});

// ============================================================================
// Distribution Group: Interleaved Round-Robin (FEAT-391)
// ============================================================================

import { placeGroupedSlotsRoundRobin } from '@dmnpc/generation/place-layout/generator.js';

describe('Distribution Group: Interleaved Round-Robin (FEAT-391)', () => {
  // Large shape so placement doesn't run out of space
  const LARGE_SHAPE = createTestShape(40, 40);

  function createGroupSlot(
    purpose: string,
    group: string,
    options: { max?: number; positionAlgorithm?: string; distribution?: string } = {}
  ): LayoutSlot {
    return {
      purpose,
      positionAlgorithm: (options.positionAlgorithm ??
        'random_valid') as LayoutSlot['positionAlgorithm'],
      distribution: (options.distribution ?? 'even') as LayoutSlot['distribution'],
      requiredTags: null,
      forbiddenTags: null,
      inheritableTags: null,
      min: 1,
      max: options.max ?? 3,
      nearPurpose: null,
      slotSize: { width: 1, height: 1 },
      visualClearanceAbove: null,
      preferDistrict: null,
      distributionGroup: group,
      flags: { isStructural: false, facesAnchor: false, useLlmSelection: false },
    };
  }

  it('places all requested instances for each group member', () => {
    const slotA = createGroupSlot('table', 'furniture', { max: 2 });
    const slotB = createGroupSlot('chair', 'furniture', { max: 3 });
    const occupiedTiles = new Set<string>();
    const placedSlots: PositionedSlot[] = [];

    const results = placeGroupedSlotsRoundRobin(
      [slotA, slotB],
      LARGE_SHAPE,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      LARGE_SHAPE.bounds
    );

    const tableResults = results.filter((r) => r.slotDef.purpose === 'table');
    const chairResults = results.filter((r) => r.slotDef.purpose === 'chair');

    // Each result entry is one algorithm call (may produce 0 or 1 positioned slots)
    const tablePlaced = tableResults.reduce((sum, r) => sum + r.positioned.length, 0);
    const chairPlaced = chairResults.reduce((sum, r) => sum + r.positioned.length, 0);

    expect(tablePlaced).toBe(2);
    expect(chairPlaced).toBe(3);
  });

  it('interleaves placements (A, B, A, B, ...) instead of sequential (AAA, BBB)', () => {
    const slotA = createGroupSlot('table', 'furniture', { max: 3 });
    const slotB = createGroupSlot('chair', 'furniture', { max: 3 });
    const occupiedTiles = new Set<string>();
    const placedSlots: PositionedSlot[] = [];

    const results = placeGroupedSlotsRoundRobin(
      [slotA, slotB],
      LARGE_SHAPE,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      LARGE_SHAPE.bounds
    );

    // Verify interleaving: results should alternate between table and chair
    const purposeOrder = results
      .filter((r) => r.positioned.length > 0)
      .map((r) => r.slotDef.purpose);

    // With equal max=3, expect: table, chair, table, chair, table, chair
    expect(purposeOrder).toEqual(['table', 'chair', 'table', 'chair', 'table', 'chair']);
  });

  it('handles unequal max counts (shorter member finishes first)', () => {
    const slotA = createGroupSlot('table', 'furniture', { max: 1 });
    const slotB = createGroupSlot('chair', 'furniture', { max: 3 });
    const occupiedTiles = new Set<string>();
    const placedSlots: PositionedSlot[] = [];

    const results = placeGroupedSlotsRoundRobin(
      [slotA, slotB],
      LARGE_SHAPE,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      LARGE_SHAPE.bounds
    );

    const purposeOrder = results
      .filter((r) => r.positioned.length > 0)
      .map((r) => r.slotDef.purpose);

    // Round 1: table, chair. Round 2: chair (table exhausted). Round 3: chair.
    expect(purposeOrder).toEqual(['table', 'chair', 'chair', 'chair']);
  });

  it('single-member group behaves like ungrouped (places max instances)', () => {
    const slotA = createGroupSlot('table', 'solo', { max: 3 });
    const occupiedTiles = new Set<string>();
    const placedSlots: PositionedSlot[] = [];

    const results = placeGroupedSlotsRoundRobin(
      [slotA],
      LARGE_SHAPE,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      LARGE_SHAPE.bounds
    );

    const totalPlaced = results.reduce((sum, r) => sum + r.positioned.length, 0);
    expect(totalPlaced).toBe(3);
  });

  it('respects occupiedTiles from prior non-grouped placements', () => {
    // Use a small shape where pre-occupying tiles limits available space
    const shape = createTestShape(8, 8);
    const occupiedTiles = new Set<string>();
    // Block most of the 6×6 interior, leaving only a few tiles open
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 6; x++) {
        occupiedTiles.add(`${x},${y}`);
      }
    }

    // Use min=0 so the algorithm doesn't throw when space runs out
    const slotA = createGroupSlot('table', 'furniture', { max: 5 });
    slotA.min = 0;
    const slotB = createGroupSlot('chair', 'furniture', { max: 5 });
    slotB.min = 0;
    const placedSlots: PositionedSlot[] = [];

    const results = placeGroupedSlotsRoundRobin(
      [slotA, slotB],
      shape,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      shape.bounds
    );

    // Limited space means fewer placements than requested
    const totalPlaced = results.reduce((sum, r) => sum + r.positioned.length, 0);
    expect(totalPlaced).toBeLessThan(10); // Can't fit all 10
    expect(totalPlaced).toBeGreaterThan(0); // But some should fit
  });

  it('grouped placement has each member aware of other members positions', () => {
    // Verify the key property: in round-robin, each placement sees positions
    // from OTHER group members (not just its own prior placements).
    // Place two slots with even distribution. After round-robin, the second
    // instance of each slot should see the first instance of the OTHER slot.
    const slotA = createGroupSlot('table', 'furniture', { max: 2, distribution: 'even' });
    const slotB = createGroupSlot('chair', 'furniture', { max: 2, distribution: 'even' });
    const occupiedTiles = new Set<string>();
    const placedSlots: PositionedSlot[] = [];

    const results = placeGroupedSlotsRoundRobin(
      [slotA, slotB],
      LARGE_SHAPE,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      LARGE_SHAPE.bounds
    );

    // All 4 placements (2 table + 2 chair) should succeed
    const allPositioned = results.flatMap((r) => r.positioned);
    expect(allPositioned).toHaveLength(4);

    // placedSlots should accumulate in interleaved order
    // After placement, placedSlots contains all 4 positions
    expect(placedSlots).toHaveLength(4);

    // Key check: no two placements share the same position
    const posKeys = allPositioned.map((p) => `${p.x},${p.y}`);
    expect(new Set(posKeys).size).toBe(4);

    // Verify positions are spread out (all pairwise distances > 0)
    for (let i = 0; i < allPositioned.length; i++) {
      for (let j = i + 1; j < allPositioned.length; j++) {
        const dx = allPositioned[i].x - allPositioned[j].x;
        const dy = allPositioned[i].y - allPositioned[j].y;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(0);
      }
    }
  });

  it('multiple groups do not interfere with each other', () => {
    const groupA1 = createGroupSlot('table', 'furniture', { max: 2 });
    const groupA2 = createGroupSlot('chair', 'furniture', { max: 2 });
    const groupB1 = createGroupSlot('tree', 'nature', { max: 2 });
    const groupB2 = createGroupSlot('rock', 'nature', { max: 2 });

    const occupiedTiles = new Set<string>();
    const placedSlots: PositionedSlot[] = [];

    // Place furniture group
    const furnitureResults = placeGroupedSlotsRoundRobin(
      [groupA1, groupA2],
      LARGE_SHAPE,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      LARGE_SHAPE.bounds
    );

    // Place nature group (shares occupiedTiles and placedSlots)
    const natureResults = placeGroupedSlotsRoundRobin(
      [groupB1, groupB2],
      LARGE_SHAPE,
      DUMMY_VARIANT,
      42,
      occupiedTiles,
      placedSlots,
      LARGE_SHAPE.bounds
    );

    const furniturePlaced = furnitureResults.reduce((sum, r) => sum + r.positioned.length, 0);
    const naturePlaced = natureResults.reduce((sum, r) => sum + r.positioned.length, 0);

    // Both groups should place their instances
    expect(furniturePlaced).toBe(4); // 2 + 2
    expect(naturePlaced).toBe(4); // 2 + 2

    // No position overlap between groups
    const allPositions = [
      ...furnitureResults.flatMap((r) => r.positioned),
      ...natureResults.flatMap((r) => r.positioned),
    ];
    const positionKeys = allPositions.map((p) => `${p.x},${p.y}`);
    expect(new Set(positionKeys).size).toBe(positionKeys.length);
  });
});

// ============================================================================
// FEAT-412: Configurable Layout Padding
// ============================================================================

describe('Layout Padding (FEAT-412)', () => {
  it('padding shrinks placement bounds — no slots placed within padding zone', () => {
    // 20x20 shape with 1-tile wall perimeter (interior floor: x=1..18, y=1..18)
    const shape = createTestShape(20, 20);

    // Simulate what generatePositionedSlots does: compute padded placementBounds
    const padding = 3;
    const paddedBounds = {
      x: shape.bounds.x + padding,
      y: shape.bounds.y + padding,
      width: shape.bounds.width - padding * 2,
      height: shape.bounds.height - padding * 2,
    };

    const slot = createSlot('furniture', { min: 5, max: 5 });
    const ctx = createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set(), [], paddedBounds);

    const algo = getPlacementAlgorithm('random_valid')!;
    const results = algo(ctx);

    expect(results.length).toBeGreaterThan(0);
    for (const pos of results) {
      expect(pos.x).toBeGreaterThanOrEqual(padding);
      expect(pos.y).toBeGreaterThanOrEqual(padding);
      // 1x1 occupancy block must fit within padded bounds
      expect(pos.x).toBeLessThan(20 - padding);
      expect(pos.y).toBeLessThan(20 - padding);
    }
  });

  it('padding=0 places slots the same as no padding', () => {
    const shape = createTestShape(20, 20);

    const slot = createSlot('furniture', { min: 3, max: 3 });
    // Both use shape.bounds as placementBounds (default)
    const ctxOriginal = createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set());
    const ctxPadded = createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set(), [], shape.bounds);

    const algo = getPlacementAlgorithm('random_valid')!;
    const originalResults = algo(ctxOriginal);
    const paddedResults = algo(ctxPadded);

    expect(paddedResults.length).toBe(originalResults.length);
    for (let i = 0; i < originalResults.length; i++) {
      expect(paddedResults[i].x).toBe(originalResults[i].x);
      expect(paddedResults[i].y).toBe(originalResults[i].y);
    }
  });

  it('large padding that leaves no valid tiles places 0 slots without crashing', () => {
    const shape = createTestShape(10, 10);

    // padding=5 on a 10x10 shape → placementBounds width/height = 0 → no valid tiles
    const padding = 5;
    const paddedBounds = {
      x: shape.bounds.x + padding,
      y: shape.bounds.y + padding,
      width: shape.bounds.width - padding * 2,
      height: shape.bounds.height - padding * 2,
    };

    const slot = createSlot('furniture', { min: 0, max: 3 });
    const ctx = createCtx(shape, [slot], 42, DUMMY_VARIANT, new Set(), [], paddedBounds);

    const algo = getPlacementAlgorithm('random_valid')!;
    const results = algo(ctx);

    expect(results.length).toBe(0);
  });
});

// ============================================================================
// BUG-232 Regression Tests
// ============================================================================

describe('BUG-232: along_road placement on non-zero-origin shapes', () => {
  it('places buildings on a shape with non-zero bounds origin', () => {
    const ox = 5;
    const oy = 3;
    const width = 20;
    const height = 20;

    const blockedMask: boolean[][] = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(false)
    );
    const roadMask: boolean[][] = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(false)
    );
    const groundMask: boolean[][] = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(true)
    );
    const terrainGrid: string[][] = Array.from({ length: height }, () =>
      new Array<string>(width).fill('ground')
    );

    // Road stripe across the middle
    const roadStartY = Math.floor(height / 2) - 1;
    const roadEndY = roadStartY + 1;
    for (let y = roadStartY; y <= roadEndY; y++) {
      for (let x = 0; x < width; x++) {
        roadMask[y][x] = true;
        groundMask[y][x] = false;
        terrainGrid[y][x] = 'road_layer';
      }
    }

    const variant: LayoutVariant = {
      id: 'offset_test',
      scale: 'feet',
      environment: ENVIRONMENT_PRESETS.exterior(),
      width: { min: width, max: width },
      height: { min: height, max: height },
      terrainLayers: [
        {
          id: 'ground',
          tilesetId: 'grass',
          type: 'fill',
          blocking: 'unblocks',
          terrain: 'land',
          renderOrder: 0,
          fill: [0],
          procedural: false,
        },
        {
          id: 'road_layer',
          tilesetId: 'cobblestone',
          type: 'road',
          blocking: 'unblocks',
          terrain: 'road',
          renderOrder: 10,
          fill: [0],
          procedural: false,
          roadWidth: 2,
          branchCount: 0,
          curvature: 0,
          autotilePreset: 'canonical',
          autotileAgainst: ['road_layer'],
          altCenterCount: 0,
        } as TerrainLayerConfig,
      ],
      slots: [],
      description: 'offset road test variant',
      weight: 1,
      defaultBlocked: false,
    };

    const shape: GeneratedShape = {
      blockedMask,
      layers: [],
      bounds: { x: ox, y: oy, width, height },
      terrainGrid,
      layerMasks: { road_layer: roadMask, ground: groundMask },
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    const algorithm = getPlacementAlgorithm('along_road')!;
    const slots: LayoutSlot[] = [createSlot('building', { min: 2, max: 2 })];
    const placementBounds = shape.bounds;
    const positioned = algorithm(
      createCtx(shape, slots, 42, variant, new Set<string>(), [], placementBounds)
    );

    expect(positioned.length).toBe(2);
    // All positioned tiles should be in world coords (offset by ox, oy)
    for (const pos of positioned) {
      expect(pos.x).toBeGreaterThanOrEqual(ox);
      expect(pos.y).toBeGreaterThanOrEqual(oy);
      // Should NOT be on a road tile (in world coords)
      const localY = pos.y - oy;
      const isRoad = localY >= roadStartY && localY <= roadEndY;
      expect(isRoad).toBe(false);
    }
  });

  it('along_road with visualClearanceAbove avoids placing sprites that visually overlap road', () => {
    const algorithm = getPlacementAlgorithm('along_road')!;
    const width = 30;
    const height = 30;

    const blockedMask: boolean[][] = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(false)
    );
    const roadMask: boolean[][] = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(false)
    );
    const groundMask: boolean[][] = Array.from({ length: height }, () =>
      new Array<boolean>(width).fill(true)
    );
    const terrainGrid: string[][] = Array.from({ length: height }, () =>
      new Array<string>(width).fill('ground')
    );

    const roadStartY = Math.floor(height / 2) - 1;
    const roadEndY = roadStartY + 1;
    for (let y = roadStartY; y <= roadEndY; y++) {
      for (let x = 0; x < width; x++) {
        roadMask[y][x] = true;
        groundMask[y][x] = false;
        terrainGrid[y][x] = 'road_layer';
      }
    }

    const variant: LayoutVariant = {
      id: 'clearance_test',
      scale: 'feet',
      environment: ENVIRONMENT_PRESETS.exterior(),
      width: { min: width, max: width },
      height: { min: height, max: height },
      terrainLayers: [
        {
          id: 'ground',
          tilesetId: 'grass',
          type: 'fill',
          blocking: 'unblocks',
          terrain: 'land',
          renderOrder: 0,
          fill: [0],
          procedural: false,
        },
        {
          id: 'road_layer',
          tilesetId: 'cobblestone',
          type: 'road',
          blocking: 'unblocks',
          terrain: 'road',
          renderOrder: 10,
          fill: [0],
          procedural: false,
          roadWidth: 2,
          branchCount: 0,
          curvature: 0,
          autotilePreset: 'canonical',
          autotileAgainst: ['road_layer'],
          altCenterCount: 0,
        } as TerrainLayerConfig,
      ],
      slots: [],
      description: 'clearance test variant',
      weight: 1,
      defaultBlocked: false,
    };

    const shape: GeneratedShape = {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width, height },
      terrainGrid,
      layerMasks: { road_layer: roadMask, ground: groundMask },
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    // Slot with visualClearanceAbove = 3 (sprite extends 3 tiles above anchor)
    const slot: LayoutSlot = {
      ...createSlot('tall_building', { min: 1, max: 1 }),
      slotSize: { width: 2, height: 2 },
      visualClearanceAbove: 3,
    };

    const positioned = algorithm(createCtx(shape, [slot], 42, variant, new Set<string>()));

    expect(positioned.length).toBe(1);
    const pos = positioned[0];

    // The visual area above the anchor (pos.y - 1 through pos.y - 3) must not overlap road
    for (let dy = 1; dy <= 3; dy++) {
      const checkY = pos.y - dy;
      if (checkY >= 0) {
        const isRoad = checkY >= roadStartY && checkY <= roadEndY;
        expect(isRoad).toBe(false);
      }
    }
  });
});

// ============================================================================
// Pier-End Placement Algorithm Tests
// ============================================================================

/**
 * Create a harbor-like shape with land, water, and a pier strip extending north.
 * Pier tiles span columns [cx, cx+pierWidth) from y=pierStartY up to y=waterLine-1.
 */
function createPierShape(
  width: number,
  height: number,
  pierWidth = 4,
  pierLength = 6
): {
  shape: GeneratedShape;
  variant: LayoutVariant;
  pierStartY: number;
  pierCenterX: number;
} {
  const terrainGrid: string[][] = [];
  const blockedMask: boolean[][] = [];

  const waterLine = Math.floor(height / 2);
  const cx = Math.floor((width - pierWidth) / 2);
  const pierStartY = waterLine - pierLength;

  for (let y = 0; y < height; y++) {
    terrainGrid[y] = [];
    blockedMask[y] = [];
    for (let x = 0; x < width; x++) {
      const isLand = y >= waterLine;
      const isPier = x >= cx && x < cx + pierWidth && y >= pierStartY && y < waterLine;
      if (isPier) {
        terrainGrid[y][x] = 'pier';
        blockedMask[y][x] = false;
      } else if (isLand) {
        terrainGrid[y][x] = 'land';
        blockedMask[y][x] = false;
      } else {
        terrainGrid[y][x] = 'ocean';
        blockedMask[y][x] = true;
      }
    }
  }

  const variant: LayoutVariant = {
    id: 'pier-test',
    scale: 'feet',
    environment: ENVIRONMENT_PRESETS.exterior(),
    width: { min: width, max: width },
    height: { min: height, max: height },
    terrainLayers: [
      {
        id: 'land',
        tilesetId: 'terrain-grass',
        type: 'fill',
        blocking: 'unblocks',
        terrain: 'land',
        renderOrder: 0,
        fill: [0],
        procedural: false,
        inheritable: false,
      },
      {
        id: 'ocean',
        tilesetId: 'terrain-ocean',
        type: 'fill',
        blocking: 'blocks',
        terrain: 'water',
        renderOrder: 1,
        fill: [0],
        procedural: false,
        inheritable: false,
      },
      {
        id: 'pier',
        tilesetId: 'terrain-wood',
        type: 'fill',
        blocking: 'unblocks',
        terrain: 'road',
        renderOrder: 2,
        fill: [0],
        procedural: false,
        inheritable: false,
      },
    ],
    slots: [],
    description: 'test pier variant',
    weight: 1,
    defaultBlocked: false,
  };

  return {
    shape: {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width, height },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    },
    variant,
    pierStartY,
    pierCenterX: cx,
  };
}

describe('pier_end algorithm', () => {
  it('is registered', () => {
    expect(getPlacementAlgorithm('pier_end')).toBeDefined();
  });

  it('places gangplank at northernmost pier tile row', () => {
    const algorithm = getPlacementAlgorithm('pier_end');
    expect(algorithm).toBeDefined();

    const { shape, variant, pierStartY } = createPierShape(40, 30);
    const slots: LayoutSlot[] = [createSlot('gangplank', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));

    expect(positioned.length).toBe(1);
    expect(positioned[0].y).toBe(pierStartY);
    expect(shape.terrainGrid![positioned[0].y][positioned[0].x]).toBe('pier');
  });

  it('falls back to random_valid when no pier layer in variant', () => {
    const algorithm = getPlacementAlgorithm('pier_end');
    expect(algorithm).toBeDefined();

    const { shape, variant } = createPierShape(20, 20);
    const variantNoPier: LayoutVariant = {
      ...variant,
      terrainLayers: variant.terrainLayers.filter((l) => l.id !== 'pier'),
    };
    const slots: LayoutSlot[] = [createSlot('gangplank', { min: 1, max: 1 })];

    const positioned = algorithm!(createCtx(shape, slots, 42, variantNoPier, new Set<string>()));
    expect(positioned.length).toBe(1);
  });

  it('falls back to random_valid when terrainGrid is null', () => {
    const algorithm = getPlacementAlgorithm('pier_end');
    const { variant } = createPierShape(20, 20);

    const shape = createTestShape(20, 20);
    const slots: LayoutSlot[] = [createSlot('gangplank', { min: 1, max: 1 })];

    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));
    expect(positioned.length).toBe(1);
  });

  it('falls back to random_valid when pier layer is present but no pier tiles in grid', () => {
    const algorithm = getPlacementAlgorithm('pier_end');
    const { variant } = createPierShape(20, 20);

    const terrainGrid: string[][] = Array.from(
      { length: 10 },
      () => Array(10).fill('land') as string[]
    );
    const blockedMask: boolean[][] = Array.from({ length: 10 }, () =>
      Array(10).fill(false) as boolean[]
    );
    const shape: GeneratedShape = {
      blockedMask,
      layers: [],
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      terrainGrid,
      layerMasks: {},
      roadGraph: null,
      caveGraph: null,
      districts: null,
    };

    const slots: LayoutSlot[] = [createSlot('gangplank', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, variant, new Set<string>()));
    expect(positioned.length).toBe(1);
  });

  it('moves to next northernmost pier tile when first row is fully occupied', () => {
    const algorithm = getPlacementAlgorithm('pier_end');
    const { shape, variant, pierStartY } = createPierShape(40, 30, 4, 6);

    const occupiedTiles = new Set<string>();
    for (let x = 0; x < 40; x++) {
      occupiedTiles.add(`${x},${pierStartY}`);
    }

    const slots: LayoutSlot[] = [createSlot('gangplank', { min: 1, max: 1 })];
    const positioned = algorithm!(createCtx(shape, slots, 42, variant, occupiedTiles));

    expect(positioned.length).toBe(1);
    expect(positioned[0].y).toBe(pierStartY + 1);
  });

  it('generates consistent results with same seed', () => {
    const algorithm = getPlacementAlgorithm('pier_end');
    const { shape, variant } = createPierShape(40, 30);
    const slots: LayoutSlot[] = [createSlot('gangplank', { min: 1, max: 1 })];

    const result1 = algorithm!(createCtx(shape, slots, 99, variant, new Set<string>()));
    const result2 = algorithm!(createCtx(shape, slots, 99, variant, new Set<string>()));

    expect(result1.length).toBe(result2.length);
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i].x).toBe(result2[i].x);
      expect(result1[i].y).toBe(result2[i].y);
    }
  });
});

// ============================================================================
// Cave-Based Placement Algorithms (FEAT-483)
// ============================================================================

/**
 * Create a test shape simulating a cave: all blocked except a horizontal
 * corridor at y=tunnelY and a vertical branch at x=branchX.
 * Tunnel tiles (blockedMask=false) are surrounded by blocked rock.
 */
function createCaveShape(width: number, height: number): GeneratedShape {
  const tunnelY = Math.floor(height / 2);
  const branchX = Math.floor(width / 2);

  const blockedMask: boolean[][] = Array.from({ length: height }, () =>
    new Array<boolean>(width).fill(true)
  );

  // Horizontal corridor
  for (let x = 2; x < width - 2; x++) {
    blockedMask[tunnelY][x] = false;
  }
  // Vertical branch (upper half only)
  for (let y = 2; y < tunnelY; y++) {
    blockedMask[y][branchX] = false;
  }

  return {
    blockedMask,
    layers: [],
    bounds: { x: 0, y: 0, width, height },
    terrainGrid: null,
    layerMasks: {},
    roadGraph: null,
    caveGraph: {
      nodes: [
        { x: 2, y: tunnelY, type: 'endpoint' },
        { x: width - 3, y: tunnelY, type: 'endpoint' },
        { x: branchX, y: tunnelY, type: 'junction' },
        { x: branchX, y: 2, type: 'endpoint' },
      ],
      edges: [
        { from: 0, to: 2 },
        { from: 2, to: 1 },
        { from: 2, to: 3 },
      ],
    },
    districts: null,
  };
}

describe('Cave-Based Placement Algorithms (FEAT-483)', () => {
  describe('along_cave algorithm', () => {
    it('is registered', () => {
      expect(getPlacementAlgorithm('along_cave')).toBeDefined();
    });

    it('places slots on passable tiles adjacent to cave walls', () => {
      const algorithm = getPlacementAlgorithm('along_cave')!;
      const shape = createCaveShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('torch', { min: 3, max: 3 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned.length).toBe(3);

      for (const pos of positioned) {
        // Placed tile must be passable
        const lx = pos.x - shape.bounds.x;
        const ly = pos.y - shape.bounds.y;
        expect(shape.blockedMask[ly]?.[lx]).toBe(false);

        // Must be adjacent to at least one blocked tile
        const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const hasBlockedNeighbor = dirs.some(([dx, dy]) => {
          const nlx = lx + dx;
          const nly = ly + dy;
          if (nlx < 0 || nlx >= shape.bounds.width || nly < 0 || nly >= shape.bounds.height)
            return true; // out-of-bounds = wall
          return shape.blockedMask[nly]?.[nlx] === true;
        });
        expect(hasBlockedNeighbor).toBe(true);
      }
    });

    it('sets facing toward the nearest cave wall', () => {
      const algorithm = getPlacementAlgorithm('along_cave')!;
      const shape = createCaveShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('torch', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned.length).toBe(1);
      // Facing must be a valid cardinal direction
      expect(['north', 'south', 'east', 'west']).toContain(positioned[0].facing);
    });

    it('returns empty when there are no passable tiles', () => {
      const algorithm = getPlacementAlgorithm('along_cave')!;
      // All-blocked shape — no passable tiles at all
      const allBlockedShape: GeneratedShape = {
        blockedMask: Array.from({ length: 10 }, () => new Array<boolean>(10).fill(true)),
        layers: [],
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        terrainGrid: null,
        layerMasks: {},
        roadGraph: null,
        caveGraph: null,
        districts: null,
      };
      const slots: LayoutSlot[] = [createSlot('torch', { min: 1, max: 1 })];
      const positioned = algorithm(
        createCtx(allBlockedShape, slots, 42, DUMMY_VARIANT, new Set<string>())
      );

      expect(positioned).toEqual([]);
    });

    it('respects occupiedTiles and does not overlap', () => {
      const algorithm = getPlacementAlgorithm('along_cave')!;
      const shape = createCaveShape(20, 20);

      // Pre-occupy all tiles in the horizontal corridor
      const tunnelY = Math.floor(20 / 2);
      const occupiedTiles = new Set<string>();
      for (let x = 2; x < 18; x++) {
        occupiedTiles.add(`${x},${tunnelY}`);
      }
      const preOccupied = new Set(occupiedTiles);

      const slots: LayoutSlot[] = [createSlot('torch', { min: 1, max: 1 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, occupiedTiles));

      for (const pos of positioned) {
        expect(preOccupied.has(`${pos.x},${pos.y}`)).toBe(false);
      }
    });

    it('places slots at layer: default', () => {
      const algorithm = getPlacementAlgorithm('along_cave')!;
      const shape = createCaveShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('torch', { min: 2, max: 2 })];
      const positioned = algorithm(createCtx(shape, slots, 42, DUMMY_VARIANT, new Set<string>()));

      expect(positioned.length).toBe(2);
      for (const pos of positioned) {
        expect(pos.layer).toBe('default');
      }
    });

    it('generates consistent results with same seed', () => {
      const algorithm = getPlacementAlgorithm('along_cave')!;
      const shape = createCaveShape(20, 20);
      const slots: LayoutSlot[] = [createSlot('torch', { min: 2, max: 2 })];

      const result1 = algorithm(createCtx(shape, slots, 99, DUMMY_VARIANT, new Set<string>()));
      const result2 = algorithm(createCtx(shape, slots, 99, DUMMY_VARIANT, new Set<string>()));

      expect(result1.length).toBe(result2.length);
      for (let i = 0; i < result1.length; i++) {
        expect(result1[i].x).toBe(result2[i].x);
        expect(result1[i].y).toBe(result2[i].y);
      }
    });
  });
});
