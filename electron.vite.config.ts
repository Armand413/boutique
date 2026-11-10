import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { PRODUCTION_CSP } from './src/main/security/csp';

/** Ajoute la CSP en balise <meta> dans le build de production (en plus de l'en-tête HTTP). */
function cspMetaPlugin(): Plugin {
  return {
    name: 'boutique-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: PRODUCTION_CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/main',
      externalizeDeps: true,
      rolldownOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/preload',
      // Le preload tourne dans le bac à sable : un seul fichier CommonJS, sans dépendance externe.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve(__dirname, 'src/renderer') },
    },
    plugins: [react(), tailwindcss(), cspMetaPlugin()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rolldownOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
