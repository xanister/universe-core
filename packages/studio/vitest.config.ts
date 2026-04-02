import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';
import { tmpdir, cpus } from 'node:os';

const TEST_UNIVERSES_DIR = path.join(tmpdir(), 'dmnpc-test-universes-studio');
process.env.TEST_UNIVERSES_DIR = TEST_UNIVERSES_DIR;

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['test/**/*.unit.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    silent: true,
    pool: 'forks',
    poolOptions: {
      forks: { maxForks: Math.max(2, Math.floor(cpus().length / 3)) },
    },
    env: {
      TEST_UNIVERSES_DIR,
    },
    testTimeout: 5_000,
    hookTimeout: 5_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['dist/**', 'test/**'],
    },
  },
});
