import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** Test de charge (phase 9) : long, lancé à part par `npm run test:load`. */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer'),
    },
  },
  test: {
    include: ['tests/load/**/*.load.ts'],
    environment: 'node',
    testTimeout: 3 * 60 * 60 * 1000,
    hookTimeout: 3 * 60 * 60 * 1000,
    fileParallelism: false,
  },
});
