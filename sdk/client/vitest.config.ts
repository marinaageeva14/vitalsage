import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      include:  ['src/**/*.ts'],
      exclude:  ['src/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@vitalsage/types': resolve(__dirname, '../types/src/index.ts'),
    },
  },
});
