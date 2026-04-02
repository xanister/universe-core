import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  loadUniverseEntities,
  upsertUniverseEntity,
  loadUniverse,
  listUniverses,
} from '@dmnpc/core/universe/universe-store.js';
import {
  setupTestUniverse,
  cleanupTestUniverse,
  getTestUniverseDir,
  setupAndLoadTestUniverse,
} from '@dmnpc/core/test-helpers/index.js';

const TEST_UNIVERSE_ID = '__test_universe_content_store__';
const TEST_UNIVERSE_DIR = getTestUniverseDir(TEST_UNIVERSE_ID);

beforeAll(async () => {
  await setupTestUniverse(TEST_UNIVERSE_ID);
});

afterAll(async () => {
  await cleanupTestUniverse(TEST_UNIVERSE_ID);
});

describe('services/universe-store.ts', () => {
  describe('Entity I/O (loadUniverseEntities, upsertUniverseEntity)', () => {
    it('loadUniverseEntities returns [] when file is missing', async () => {
      const loaded = await loadUniverseEntities(TEST_UNIVERSE_ID, 'place');
      expect(loaded).toEqual([]);
    });

    it('upsertUniverseEntity inserts and then updates by id', async () => {
      // Insert
      await upsertUniverseEntity(TEST_UNIVERSE_ID, 'character', {
        id: 'CHAR_1',
        label: 'Alyx',
        description: 'A person.',
        entityType: 'character',
        tags: ['Character'],
        info: { placeId: 'PLACE_1' },
        relationships: [],
      } as any);

      // Update (same id, new label)
      await upsertUniverseEntity(TEST_UNIVERSE_ID, 'character', {
        id: 'CHAR_1',
        label: 'Alyx Renamed',
        description: 'A person.',
        entityType: 'character',
        tags: ['Character'],
        info: { placeId: 'PLACE_1' },
        relationships: [],
      } as any);

      const onDisk = JSON.parse(
        await readFile(
          path.join(TEST_UNIVERSE_DIR, 'entities', 'characters', 'CHAR_1.json'),
          'utf-8'
        )
      );
      expect(onDisk.label).toBe('Alyx Renamed');
    });

    it('upsertUniverseEntity normalizes entities with missing optional fields', async () => {
      const result = await upsertUniverseEntity(TEST_UNIVERSE_ID, 'character', {
        id: 'CHAR_bad',
        label: 'Bad',
        description: '',
        short_description: 'Person',
        tags: [],
        entityType: 'character',
        info: {},
        relationships: [],
      } as any);

      expect(result.id).toBe('CHAR_bad');
      expect(result.entityType).toBe('character');
      expect(result.info).toEqual({});
      expect(result.relationships).toEqual([]);
    });

    it('loadUniverseEntities reads per-file entities and normalizes relationships', async () => {
      const placesDir = path.join(TEST_UNIVERSE_DIR, 'entities', 'places');
      await mkdir(placesDir, { recursive: true });
      await writeFile(
        path.join(placesDir, 'PLACE_1.json'),
        JSON.stringify(
          {
            id: 'PLACE_1',
            label: 'Icehold',
            description: 'A city.',
            short_description: 'City',
            entityType: 'place',
            tags: ['City'],
            info: {},
            relationships: [],
          },
          null,
          2
        ) + '\n'
      );

      const loaded = await loadUniverseEntities(TEST_UNIVERSE_ID, 'place');
      expect(loaded.length).toBe(1);
      expect(Array.isArray((loaded[0] as any).relationships)).toBe(true);
    });
  });

  describe('Universe Management (loadUniverse, listUniverses, getCurrentUniverse)', () => {
    it(
      'listUniverses returns an array of universes with id/name/version',
      async () => {
        // Ensure a current universe exists so we can verify listUniverses doesn't disturb it.
        await loadUniverse(TEST_UNIVERSE_ID);

        const universes = await listUniverses();
        expect(Array.isArray(universes)).toBe(true);
        if (universes.length > 0) {
          expect(universes[0]).toHaveProperty('id');
          expect(universes[0]).toHaveProperty('name');
          expect(universes[0]).toHaveProperty('version');
        }
        // Test universe should exist
        expect(universes.some((u) => u.id === TEST_UNIVERSE_ID)).toBe(true);
      },
    );

    it(
      'listUniverses includes image field when present in index.json',
      async () => {
        // Create a test universe with an image
        const testUniverseWithImage = '__test_universe_with_image__';
        await setupTestUniverse(testUniverseWithImage, {
          name: 'Test Universe With Image',
          description: 'Test universe with image',
        });

        // Add image to index.json
        const indexPath = path.join(getTestUniverseDir(testUniverseWithImage), 'index.json');
        const indexData = JSON.parse(await readFile(indexPath, 'utf-8'));
        indexData.image = '/api/media/test/image/universe.png';
        await writeFile(indexPath, JSON.stringify(indexData, null, 2));

        const universes = await listUniverses();
        const testUniverse = universes.find((u) => u.id === testUniverseWithImage);

        expect(testUniverse).toBeDefined();
        expect(testUniverse?.image).toBe('/api/media/test/image/universe.png');

        // Cleanup
        await cleanupTestUniverse(testUniverseWithImage);
      },
    );

    it(
      'listUniverses returns undefined image when not present in index.json',
      async () => {
        await loadUniverse(TEST_UNIVERSE_ID);

        const universes = await listUniverses();
        const testUniverse = universes.find((u) => u.id === TEST_UNIVERSE_ID);

        expect(testUniverse).toBeDefined();
        // Image should be null if not set
        expect(testUniverse?.image).toBeNull();
      },
    );

    it(
      'listUniverses does not modify universe data',
      async () => {
        // Load universe before listing
        const beforeUniverse = await loadUniverse(TEST_UNIVERSE_ID);
        const beforeUniverseName = beforeUniverse.name;

        // List all universes
        await listUniverses();

        // Load again and verify data is unchanged
        const afterUniverse = await loadUniverse(TEST_UNIVERSE_ID);
        expect(afterUniverse.name).toBe(beforeUniverseName);
      },
    );

    it('loadUniverse loads characters and places from per-file entities', async () => {
      const TEST_LOAD_ID = '__test_load_universe__';

      await setupTestUniverse(TEST_LOAD_ID, {
        name: 'Load Test Universe',
        characters: [
          {
            id: 'CHAR_seed_1',
            label: 'Seed One',
            description: 'Test',
            entityType: 'character',
            tags: ['Test'],
            info: { placeId: 'PLACE_seed_1' },
            relationships: [],
          } as any,
          {
            id: 'CHAR_seed_2',
            label: 'Seed Two',
            description: 'Test',
            entityType: 'character',
            tags: ['Test'],
            info: { placeId: 'PLACE_seed_1' },
            relationships: [],
          } as any,
        ],
        places: [
          {
            id: 'PLACE_seed_1',
            label: 'Seed Place One',
            description: 'Test',
            entityType: 'place',
            tags: ['Test'],
            info: {},
            relationships: [],
          } as any,
        ],
      });
      const universe = await loadUniverse(TEST_LOAD_ID);

      expect(universe.characters).toHaveLength(2);
      expect(universe.characters!.map((e: any) => e.id)).toEqual(['CHAR_seed_1', 'CHAR_seed_2']);
      expect(universe.places).toHaveLength(1);
      expect(universe.places!.map((e: any) => e.id)).toEqual(['PLACE_seed_1']);

      // Cleanup
      await cleanupTestUniverse(TEST_LOAD_ID);
    });
  });
});
