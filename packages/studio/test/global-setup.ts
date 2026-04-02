/**
 * Vitest global setup - runs ONCE before all test files.
 *
 * Clears the shared test-universes temp directory so that leftover
 * directories from previous runs don't pollute listUniverses() and
 * other functions that scan UNIVERSES_DIR.
 */

import { rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TEST_UNIVERSES_DIR = path.join(tmpdir(), 'dmnpc-test-universes-studio');

export async function setup(): Promise<void> {
  // Wipe and recreate so every run starts with an empty directory.
  await rm(TEST_UNIVERSES_DIR, { recursive: true, force: true });
  await mkdir(TEST_UNIVERSES_DIR, { recursive: true });
}

export async function teardown(): Promise<void> {
  await rm(TEST_UNIVERSES_DIR, { recursive: true, force: true });
}
