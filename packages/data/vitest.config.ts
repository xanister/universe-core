import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.unit.test.ts'],
    silent: true,
    clearMocks: true,
    testTimeout: 5_000,
  },
});
