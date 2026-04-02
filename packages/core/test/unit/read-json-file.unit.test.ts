import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJsonFile, readJsonFileSync } from '@dmnpc/core/infra/read-json-file.js';

const TEST_DIR = join(tmpdir(), `read-json-file-test-${Date.now()}`);

interface TestData {
  name: string;
  count: number;
  nested: { ok: boolean };
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('readJsonFile', () => {
  it('parses valid JSON and returns typed result', async () => {
    const filePath = join(TEST_DIR, 'valid.json');
    await writeFile(filePath, JSON.stringify({ name: 'test', count: 42, nested: { ok: true } }));

    const result = await readJsonFile<TestData>(filePath);

    expect(result.name).toBe('test');
    expect(result.count).toBe(42);
    expect(result.nested.ok).toBe(true);
  });

  it('throws with file path on invalid JSON', async () => {
    const filePath = join(TEST_DIR, 'invalid.json');
    await writeFile(filePath, '{ broken json!!!');

    await expect(readJsonFile<TestData>(filePath)).rejects.toThrow(/Failed to parse JSON file/);
    await expect(readJsonFile<TestData>(filePath)).rejects.toThrow(filePath);
  });

  it('throws with file path on missing file', async () => {
    const filePath = join(TEST_DIR, 'missing.json');

    await expect(readJsonFile<TestData>(filePath)).rejects.toThrow(/Failed to read JSON file/);
    await expect(readJsonFile<TestData>(filePath)).rejects.toThrow(filePath);
  });
});

describe('readJsonFileSync', () => {
  it('parses valid JSON and returns typed result', async () => {
    const filePath = join(TEST_DIR, 'valid-sync.json');
    await writeFile(filePath, JSON.stringify({ name: 'sync', count: 7, nested: { ok: true } }));

    const result = readJsonFileSync<TestData>(filePath);

    expect(result.name).toBe('sync');
    expect(result.count).toBe(7);
    expect(result.nested.ok).toBe(true);
  });

  it('throws with file path on invalid JSON', async () => {
    const filePath = join(TEST_DIR, 'invalid-sync.json');
    await writeFile(filePath, '{ broken!!!');

    expect(() => readJsonFileSync<TestData>(filePath)).toThrow(/Failed to parse JSON file/);
    expect(() => readJsonFileSync<TestData>(filePath)).toThrow(filePath);
  });

  it('throws with file path on missing file', () => {
    const filePath = join(TEST_DIR, 'missing-sync.json');

    expect(() => readJsonFileSync<TestData>(filePath)).toThrow(/Failed to read JSON file/);
    expect(() => readJsonFileSync<TestData>(filePath)).toThrow(filePath);
  });
});
