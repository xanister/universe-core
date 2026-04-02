import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const plotsDir = join(root, 'plots', 'definitions');
const scenariosDir = join(root, 'scenarios', 'definitions');

const plotFiles = readdirSync(plotsDir).filter((f) => f.endsWith('.json'));
const scenarioFiles = readdirSync(scenariosDir).filter((f) => f.endsWith('.json'));

describe('plots/definitions/', () => {
  it('has at least one plot definition file', () => {
    expect(plotFiles.length).toBeGreaterThan(0);
  });

  it('every plot has required fields', () => {
    for (const file of plotFiles) {
      const plot = loadJson(join(plotsDir, file));
      expect(typeof plot.id, `${file}: id`).toBe('string');
      expect(typeof plot.label, `${file}: label`).toBe('string');
      expect(typeof plot.description, `${file}: description`).toBe('string');
      expect(Array.isArray(plot.characters), `${file}: characters`).toBe(true);
      expect(Array.isArray(plot.turningPoints), `${file}: turningPoints`).toBe(true);
    }
  });

  it('plot file name matches the id field', () => {
    for (const file of plotFiles) {
      const plot = loadJson(join(plotsDir, file));
      expect(file, `${file}: filename should be {id}.json`).toBe(`${plot.id}.json`);
    }
  });

  it('plot IDs are unique', () => {
    const ids = plotFiles.map((file) => loadJson(join(plotsDir, file)).id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('scenarios/definitions/', () => {
  it('has at least one scenario definition file', () => {
    expect(scenarioFiles.length).toBeGreaterThan(0);
  });

  it('every scenario has required base fields', () => {
    for (const file of scenarioFiles) {
      const scenario = loadJson(join(scenariosDir, file));
      expect(typeof scenario.id, `${file}: id`).toBe('string');
      expect(typeof scenario.label, `${file}: label`).toBe('string');
      expect(typeof scenario.description, `${file}: description`).toBe('string');
    }
  });

  it('fixed scenarios reference required entity fields', () => {
    // Fixed scenarios have characterId (as opposed to custom or narrative-start scenarios)
    for (const file of scenarioFiles) {
      const scenario = loadJson(join(scenariosDir, file));
      if (scenario.characterId !== undefined) {
        expect(typeof scenario.characterId, `${file}: characterId`).toBe('string');
        expect(typeof scenario.storytellerId, `${file}: storytellerId`).toBe('string');
        expect(typeof scenario.plotId, `${file}: plotId`).toBe('string');
        expect(typeof scenario.universeId, `${file}: universeId`).toBe('string');
      }
    }
  });

  it('scenario file name matches the id field', () => {
    for (const file of scenarioFiles) {
      const scenario = loadJson(join(scenariosDir, file));
      expect(file, `${file}: filename should be {id}.json`).toBe(`${scenario.id}.json`);
    }
  });

  it('scenario IDs are unique', () => {
    const ids = scenarioFiles.map((file) => loadJson(join(scenariosDir, file)).id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
