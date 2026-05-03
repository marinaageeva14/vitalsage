import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Keep the project root here so index.html is served at /
  root: __dirname,
  server: {
    fs: {
      // Allow Vite to serve files from the monorepo root so that
      // the ../../packages/client/dist/vitalsage.js import resolves.
      allow: [resolve(__dirname, '../../..')],
    },
  },
});
