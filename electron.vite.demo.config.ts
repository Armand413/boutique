import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

/**
 * Script de données de démonstration (`npm run seed`), construit à part dans `out-demo/` :
 * il ne fait jamais partie de l'application installée.
 */
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    build: {
      outDir: 'out-demo',
      externalizeDeps: true,
      rolldownOptions: { input: { 'seed-main': resolve(__dirname, 'tools/demo/seed-main.ts') } },
    },
  },
});
