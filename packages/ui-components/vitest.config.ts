import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/__tests__/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    pool: 'threads',
    fileParallelism: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
