import { describe, it, expect } from 'vitest';
import { cleanGeneratedTemplate, validateLayerReferences, validateSlotDependencies, reorderSlots } from '../../../src/place/layout-template-generator.js';
import type { LayoutTemplate } from '@dmnpc/types/world';
import { LAYER_TYPE_META, LAYER_TYPES } from '@dmnpc/types/world';

function makeBaseVariant(terrainLayers: Record<string, unknown>[]): LayoutTemplate {
  return {
    name: 'Test',
    description: 'test',
    purposes: ['tavern'],
    spriteId: 'door_wooden',
    characterScale: 1,
    timeScale: 1,
    variants: [
      {
        id: 'default',
        scale: 'feet',
        environment: {
          type: 'interior',
          hasWeather: false,
          temperature: { enabled: true, base: 18, modifiersApply: false },
          maxDarkness: 0.5,
        },
        width: { min: 20, max: 40 },
        height: { min: 20, max: 40 },
        description: 'test variant',
        weight: 1,
        defaultBlocked: false,
        terrainLayers: terrainLayers as LayoutTemplate['variants'][0]['terrainLayers'],
        slots: [],
      },
    ],
  };
}

const ALL_LLM_FIELDS = {
  id: 'test',
  tilesetId: 'test-tileset',
  renderOrder: 0,
  blocking: null,
  terrain: 'land',
  fill: [0],
  procedural: false,
  inheritable: false,
  shapePreset: null,
  autotilePreset: null,
  autotileAgainst: null,
  withinTerrain: null,
  wallStyle: null,
  wallLayerId: null,
  roomLayerId: null,
};

describe('cleanGeneratedTemplate', () => {
  it('strips wallStyle from fill layers', () => {
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, type: 'fill' },
    ]);
    const cleaned = cleanGeneratedTemplate(template);
    const layer = cleaned.variants[0].terrainLayers[0];
    expect('wallStyle' in layer).toBe(false);
    expect('wallLayerId' in layer).toBe(false);
    expect('shapePreset' in layer).toBe(false);
  });

  it('preserves wallStyle on wall layers', () => {
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, type: 'wall', wallStyle: 'brick_brown' },
    ]);
    const cleaned = cleanGeneratedTemplate(template);
    const layer = cleaned.variants[0].terrainLayers[0] as Record<string, unknown>;
    expect(layer.wallStyle).toBe('brick_brown');
    expect('wallLayerId' in layer).toBe(false);
  });

  it('preserves wallStyle + wallLayerId + roomLayerId on wall_face layers', () => {
    const template = makeBaseVariant([
      {
        ...ALL_LLM_FIELDS,
        type: 'wall_face',
        wallStyle: 'brick_brown',
        wallLayerId: 'walls',
        roomLayerId: 'room',
      },
    ]);
    const cleaned = cleanGeneratedTemplate(template);
    const layer = cleaned.variants[0].terrainLayers[0] as Record<string, unknown>;
    expect(layer.wallStyle).toBe('brick_brown');
    expect(layer.wallLayerId).toBe('walls');
    expect(layer.roomLayerId).toBe('room');
  });

  it('preserves noise fields on noise_patch layers', () => {
    const template = makeBaseVariant([
      {
        ...ALL_LLM_FIELDS,
        type: 'noise_patch',
        shapePreset: 'continent',
        autotilePreset: 'canonical',
        autotileAgainst: ['base'],
        withinTerrain: null,
      },
    ]);
    const cleaned = cleanGeneratedTemplate(template);
    const layer = cleaned.variants[0].terrainLayers[0] as Record<string, unknown>;
    expect(layer.shapePreset).toBe('continent');
    expect(layer.autotilePreset).toBe('canonical');
    expect(layer.autotileAgainst).toEqual(['base']);
    expect(layer.withinTerrain).toBeNull();
    expect('wallStyle' in layer).toBe(false);
  });

  it('preserves minArmWidth on l_shape and t_shape layers', () => {
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, type: 'l_shape', minArmWidth: 6 },
      { ...ALL_LLM_FIELDS, type: 't_shape', minArmWidth: 4 },
    ]);
    const cleaned = cleanGeneratedTemplate(template);
    expect((cleaned.variants[0].terrainLayers[0] as Record<string, unknown>).minArmWidth).toBe(6);
    expect((cleaned.variants[0].terrainLayers[1] as Record<string, unknown>).minArmWidth).toBe(4);
  });

  it('preserves base fields on all layer types', () => {
    const baseFields = ['id', 'type', 'tilesetId', 'renderOrder', 'blocking', 'terrain', 'fill', 'procedural', 'inheritable'];
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, type: 'fill' },
    ]);
    const cleaned = cleanGeneratedTemplate(template);
    const layer = cleaned.variants[0].terrainLayers[0];
    for (const field of baseFields) {
      expect(field in layer).toBe(true);
    }
  });

  it('strips all inapplicable fields from every layer type', () => {
    const layers = LAYER_TYPES.map((type) => ({
      ...ALL_LLM_FIELDS,
      id: type,
      type,
    }));
    const template = makeBaseVariant(layers);
    const cleaned = cleanGeneratedTemplate(template);

    for (const layer of cleaned.variants[0].terrainLayers) {
      const meta = LAYER_TYPE_META[layer.type];
      const record = layer as Record<string, unknown>;
      const extraFieldsOnLayer = Object.keys(record).filter(
        (k) => !['id', 'type', 'tilesetId', 'renderOrder', 'blocking', 'terrain', 'fill', 'procedural', 'inheritable', 'altCenterCount'].includes(k)
      );
      for (const field of extraFieldsOnLayer) {
        expect(meta.extraFields).toContain(field);
      }
    }
  });
});

describe('validateLayerReferences', () => {
  it('nullifies withinTerrain when it references a terrain tag instead of a layer ID', () => {
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, id: 'ground', type: 'fill' },
      {
        ...ALL_LLM_FIELDS,
        id: 'paths',
        type: 'noise_patch',
        shapePreset: 'patches',
        autotilePreset: 'canonical',
        autotileAgainst: ['ground'],
        withinTerrain: 'land',
      },
    ]);
    const validated = validateLayerReferences(template);
    const noiseLayer = validated.variants[0].terrainLayers[1] as Record<string, unknown>;
    expect(noiseLayer.withinTerrain).toBeNull();
  });

  it('falls back autotileAgainst to first non-noise layer when it references a terrain tag', () => {
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, id: 'ground', type: 'fill' },
      {
        ...ALL_LLM_FIELDS,
        id: 'paths',
        type: 'noise_patch',
        shapePreset: 'patches',
        autotilePreset: 'canonical',
        autotileAgainst: ['land'],
        withinTerrain: null,
      },
    ]);
    const validated = validateLayerReferences(template);
    const noiseLayer = validated.variants[0].terrainLayers[1] as Record<string, unknown>;
    expect(noiseLayer.autotileAgainst).toEqual(['ground']);
  });

  it('preserves valid layer ID references', () => {
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, id: 'canopy', type: 'fill' },
      { ...ALL_LLM_FIELDS, id: 'continent', type: 'noise_patch', shapePreset: 'continent', autotilePreset: 'canonical', autotileAgainst: ['canopy'], withinTerrain: null },
      { ...ALL_LLM_FIELDS, id: 'clearing', type: 'noise_patch', shapePreset: 'clearing', autotilePreset: 'canonical', autotileAgainst: ['canopy'], withinTerrain: 'continent' },
    ]);
    const validated = validateLayerReferences(template);
    const continent = validated.variants[0].terrainLayers[1] as Record<string, unknown>;
    const clearing = validated.variants[0].terrainLayers[2] as Record<string, unknown>;
    expect(continent.autotileAgainst).toEqual(['canopy']);
    expect(continent.withinTerrain).toBeNull();
    expect(clearing.autotileAgainst).toEqual(['canopy']);
    expect(clearing.withinTerrain).toBe('continent');
  });

  it('does not modify non-noise_patch layers', () => {
    const template = makeBaseVariant([
      { ...ALL_LLM_FIELDS, id: 'room', type: 'rectangle' },
      { ...ALL_LLM_FIELDS, id: 'walls', type: 'wall', wallStyle: 'brick_brown' },
    ]);
    const validated = validateLayerReferences(template);
    expect(validated.variants[0].terrainLayers).toEqual(template.variants[0].terrainLayers);
  });

});

function makeSlotVariant(slots: LayoutTemplate['variants'][0]['slots']): LayoutTemplate {
  return {
    name: 'Test',
    description: 'test',
    purposes: ['tavern'],
    spriteId: 'door_wooden',
    characterScale: 1,
    timeScale: 1,
    variants: [
      {
        id: 'default',
        scale: 'feet',
        environment: {
          type: 'interior',
          hasWeather: false,
          temperature: { enabled: true, base: 18, modifiersApply: false },
          maxDarkness: 0.5,
        },
        width: { min: 20, max: 40 },
        height: { min: 20, max: 40 },
        description: 'test variant',
        weight: 1,
        defaultBlocked: false,
        terrainLayers: [],
        slots,
      },
    ],
  };
}

const BASE_SLOT = {
  positionAlgorithm: 'random_valid' as const,
  distribution: 'even' as const,
  min: 1,
  max: 1,
  nearPurpose: null,
  requiredTags: null,
  forbiddenTags: null,
  inheritableTags: null,
  slotSize: null,
};

describe('validateSlotDependencies', () => {
  it('auto-adds missing object slot for character slot with activity target', () => {
    // merchant's activity (shopkeeping) targets "workspace"
    const template = makeSlotVariant([
      { ...BASE_SLOT, purpose: 'merchant' },
    ]);
    const fixed = validateSlotDependencies(template);
    const purposes = fixed.variants[0].slots.map((s) => s.purpose);
    expect(purposes).toContain('merchant');
    expect(purposes).toContain('workspace');
  });

  it('does not duplicate existing object slot', () => {
    const template = makeSlotVariant([
      { ...BASE_SLOT, purpose: 'merchant' },
      { ...BASE_SLOT, purpose: 'workspace' },
    ]);
    const fixed = validateSlotDependencies(template);
    const workspaceCount = fixed.variants[0].slots.filter((s) => s.purpose === 'workspace').length;
    expect(workspaceCount).toBe(1);
  });

  it('does not modify templates without character slots', () => {
    const template = makeSlotVariant([
      { ...BASE_SLOT, purpose: 'exit' },
      { ...BASE_SLOT, purpose: 'table' },
    ]);
    const fixed = validateSlotDependencies(template);
    expect(fixed.variants[0].slots).toEqual(template.variants[0].slots);
  });
});

describe('reorderSlots', () => {
  it('moves near_slot anchor before its dependent', () => {
    const template = makeSlotVariant([
      { ...BASE_SLOT, purpose: 'exit', positionAlgorithm: 'in_wall' },
      { ...BASE_SLOT, purpose: 'merchant', positionAlgorithm: 'near_slot', nearPurpose: 'workspace' },
      { ...BASE_SLOT, purpose: 'workspace', positionAlgorithm: 'random_valid' },
    ]);
    const reordered = reorderSlots(template);
    const purposes = reordered.variants[0].slots.map((s) => s.purpose);
    expect(purposes.indexOf('workspace')).toBeLessThan(purposes.indexOf('merchant'));
    // in_wall slots still come first
    expect(purposes[0]).toBe('exit');
  });

  it('preserves order when anchors already come first', () => {
    const template = makeSlotVariant([
      { ...BASE_SLOT, purpose: 'exit', positionAlgorithm: 'in_wall' },
      { ...BASE_SLOT, purpose: 'workspace', positionAlgorithm: 'random_valid' },
      { ...BASE_SLOT, purpose: 'merchant', positionAlgorithm: 'near_slot', nearPurpose: 'workspace' },
    ]);
    const reordered = reorderSlots(template);
    const purposes = reordered.variants[0].slots.map((s) => s.purpose);
    expect(purposes).toEqual(['exit', 'workspace', 'merchant']);
  });
});
