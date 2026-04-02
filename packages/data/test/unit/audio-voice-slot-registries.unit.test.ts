import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const soundRegistry = loadJson(join(root, 'audio', 'sound-registry.json'));
const voiceRegistry = loadJson(join(root, 'entities', 'voice-registry.json'));
const slotRegistry = loadJson(join(root, 'sprites', 'slot-registry.json'));
const clothingData = loadJson(join(root, 'sprites', 'lpc', 'clothing-data.json'));

describe('audio/sound-registry.json', () => {
  it('has a version field', () => {
    expect(typeof soundRegistry.version).toBe('string');
  });

  it('has a non-empty sounds array', () => {
    expect(Array.isArray(soundRegistry.sounds)).toBe(true);
    expect(soundRegistry.sounds.length).toBeGreaterThan(0);
  });

  it('every sound has required fields', () => {
    for (const sound of soundRegistry.sounds) {
      expect(typeof sound.soundId, `${sound.soundId}: soundId`).toBe('string');
      expect(typeof sound.category, `${sound.soundId}: category`).toBe('string');
      expect(Array.isArray(sound.files), `${sound.soundId}: files`).toBe(true);
      expect(sound.files.length, `${sound.soundId}: files non-empty`).toBeGreaterThan(0);
    }
  });

  it('sound IDs are unique', () => {
    const ids = soundRegistry.sounds.map((s: { soundId: string }) => s.soundId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('entities/voice-registry.json', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(voiceRegistry)).toBe(true);
    expect(voiceRegistry.length).toBeGreaterThan(0);
  });

  it('every voice entry has required fields', () => {
    for (const voice of voiceRegistry) {
      expect(typeof voice.id, `${voice.id}: id`).toBe('string');
      expect(typeof voice.name, `${voice.id}: name`).toBe('string');
      expect(typeof voice.source, `${voice.id}: source`).toBe('string');
      expect(typeof voice.enabled, `${voice.id}: enabled`).toBe('boolean');
    }
  });

  it('voice IDs are unique', () => {
    const ids = voiceRegistry.map((v: { id: string }) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('sprites/slot-registry.json', () => {
  it('has a version field', () => {
    expect(slotRegistry.version).toBeDefined();
  });

  it('has a non-empty slots array', () => {
    expect(Array.isArray(slotRegistry.slots)).toBe(true);
    expect(slotRegistry.slots.length).toBeGreaterThan(0);
  });

  it('every slot has required fields', () => {
    for (const slot of slotRegistry.slots) {
      expect(typeof slot.id, `${slot.id}: id`).toBe('string');
      expect(typeof slot.region, `${slot.id}: region`).toBe('string');
      expect(typeof slot.subOrder, `${slot.id}: subOrder`).toBe('number');
    }
  });

  it('slot IDs are unique', () => {
    const ids = slotRegistry.slots.map((s: { id: string }) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('sprites/lpc/clothing-data.json', () => {
  it('has a clothing object', () => {
    expect(typeof clothingData.clothing).toBe('object');
    expect(clothingData.clothing).not.toBeNull();
  });

  it('has at least one clothing entry', () => {
    expect(Object.keys(clothingData.clothing).length).toBeGreaterThan(0);
  });

  it('every clothing entry has required fields', () => {
    for (const [itemId, entry] of Object.entries(clothingData.clothing) as [string, Record<string, unknown>][]) {
      expect(typeof entry.slot, `${itemId}: slot`).toBe('string');
      expect(typeof entry.pattern, `${itemId}: pattern`).toBe('string');
      expect(typeof entry.name, `${itemId}: name`).toBe('string');
    }
  });
});
