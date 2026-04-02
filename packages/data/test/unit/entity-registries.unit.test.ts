import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entitiesDir = join(__dirname, '../../entities');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const actionsData = loadJson(join(entitiesDir, 'actions.json'));
const weaponsData = loadJson(join(entitiesDir, 'weapons.json'));
const itemsData = loadJson(join(entitiesDir, 'items.json'));
const purposesData = loadJson(join(entitiesDir, 'purposes.json'));
const activitiesData = loadJson(join(entitiesDir, 'npc-activities.json'));

describe('actions.json', () => {
  it('has a version field', () => {
    expect(typeof actionsData.version).toBe('string');
  });

  it('has a non-empty actions array', () => {
    expect(Array.isArray(actionsData.actions)).toBe(true);
    expect(actionsData.actions.length).toBeGreaterThan(0);
  });

  it('every action has required fields', () => {
    for (const action of actionsData.actions) {
      expect(typeof action.id, `${action.id}: id`).toBe('string');
      expect(typeof action.name, `${action.id}: name`).toBe('string');
      expect(typeof action.description, `${action.id}: description`).toBe('string');
      expect(['innate', 'weapon'], `${action.id}: source`).toContain(action.source);
      expect(['combat', 'exploration', 'both'], `${action.id}: context`).toContain(action.context);
    }
  });

  it('action IDs are unique', () => {
    const ids = actionsData.actions.map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('weapons.json', () => {
  it('has a version field', () => {
    expect(typeof weaponsData.version).toBe('string');
  });

  it('has a non-empty weapons array', () => {
    expect(Array.isArray(weaponsData.weapons)).toBe(true);
    expect(weaponsData.weapons.length).toBeGreaterThan(0);
  });

  it('every weapon has required fields', () => {
    for (const weapon of weaponsData.weapons) {
      expect(typeof weapon.id, `${weapon.id}: id`).toBe('string');
      expect(typeof weapon.name, `${weapon.id}: name`).toBe('string');
      expect(typeof weapon.weaponType, `${weapon.id}: weaponType`).toBe('string');
      expect(typeof weapon.baseDamage, `${weapon.id}: baseDamage`).toBe('number');
      expect(typeof weapon.range, `${weapon.id}: range`).toBe('number');
      expect(Array.isArray(weapon.grantedActions), `${weapon.id}: grantedActions`).toBe(true);
    }
  });

  it('weapon IDs are unique', () => {
    const ids = weaponsData.weapons.map((w: { id: string }) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('items.json', () => {
  it('has a version field', () => {
    expect(typeof itemsData.version).toBe('string');
  });

  it('has a non-empty items array', () => {
    expect(Array.isArray(itemsData.items)).toBe(true);
    expect(itemsData.items.length).toBeGreaterThan(0);
  });

  it('every item has required fields', () => {
    for (const item of itemsData.items) {
      expect(typeof item.id, `${item.id}: id`).toBe('string');
      expect(typeof item.name, `${item.id}: name`).toBe('string');
      expect(typeof item.type, `${item.id}: type`).toBe('string');
      expect(typeof item.stackable, `${item.id}: stackable`).toBe('boolean');
    }
  });

  it('item IDs are unique', () => {
    const ids = itemsData.items.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('purposes.json', () => {
  it('has a version field', () => {
    expect(typeof purposesData.version).toBe('string');
  });

  it('has a non-empty purposes array', () => {
    expect(Array.isArray(purposesData.purposes)).toBe(true);
    expect(purposesData.purposes.length).toBeGreaterThan(0);
  });

  it('every purpose has required fields', () => {
    for (const purpose of purposesData.purposes) {
      expect(typeof purpose.id, `${purpose.id}: id`).toBe('string');
      expect(typeof purpose.label, `${purpose.id}: label`).toBe('string');
      expect(typeof purpose.category, `${purpose.id}: category`).toBe('string');
    }
  });

  it('purpose IDs are unique', () => {
    const ids = purposesData.purposes.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('npc-activities.json', () => {
  it('has a version field', () => {
    expect(typeof activitiesData.version).toBe('string');
  });

  it('has a non-empty activities array', () => {
    expect(Array.isArray(activitiesData.activities)).toBe(true);
    expect(activitiesData.activities.length).toBeGreaterThan(0);
  });

  it('every activity has required fields and non-empty steps', () => {
    for (const activity of activitiesData.activities) {
      expect(typeof activity.id, `${activity.id}: id`).toBe('string');
      expect(typeof activity.name, `${activity.id}: name`).toBe('string');
      expect(Array.isArray(activity.steps), `${activity.id}: steps`).toBe(true);
      expect(activity.steps.length, `${activity.id}: steps non-empty`).toBeGreaterThan(0);
    }
  });

  it('every activity step has valid timing fields', () => {
    for (const activity of activitiesData.activities) {
      for (const step of activity.steps) {
        expect(typeof step.targetPurpose, `${activity.id} step: targetPurpose`).toBe('string');
        expect(typeof step.dwellMin, `${activity.id} step: dwellMin`).toBe('number');
        expect(typeof step.dwellMax, `${activity.id} step: dwellMax`).toBe('number');
        expect(step.dwellMin, `${activity.id}: dwellMin <= dwellMax`).toBeLessThanOrEqual(step.dwellMax);
        expect(typeof step.weight, `${activity.id} step: weight`).toBe('number');
      }
    }
  });

  it('activity IDs are unique', () => {
    const ids = activitiesData.activities.map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('entities/objects/ definitions', () => {
  const objectsDir = join(entitiesDir, 'objects');
  const objectFiles = readdirSync(objectsDir).filter((f) => f.endsWith('.json'));

  it('has at least one object definition file', () => {
    expect(objectFiles.length).toBeGreaterThan(0);
  });

  it('every object definition has required fields', () => {
    for (const file of objectFiles) {
      const obj = loadJson(join(objectsDir, file));
      expect(typeof obj.id, `${file}: id`).toBe('string');
      expect(typeof obj.name, `${file}: name`).toBe('string');
      expect(Array.isArray(obj.purposes), `${file}: purposes`).toBe(true);
      expect(typeof obj.solid, `${file}: solid`).toBe('boolean');
      expect(typeof obj.layer, `${file}: layer`).toBe('string');
    }
  });

  it('object definition IDs are unique', () => {
    const ids = objectFiles.map((file) => loadJson(join(objectsDir, file)).id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
