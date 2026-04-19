import { defineConfig } from 'vitest/config';

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
      '@vitalsage/types': '../types/src/index.ts',
    },
  },
});
