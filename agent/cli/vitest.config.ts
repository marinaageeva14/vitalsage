import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globals:     true,
  },
  resolve: {
    alias: {
      '@vitalsage/types':    resolve(__dirname, '../../sdk/types/src/index.ts'),
      'vitalsage-analysis':  resolve(__dirname, '../analysis/src/index.ts'),
      'vitalsage-simulator': resolve(__dirname, '../../sdk/simulator/src/index.ts'),
    },
  },
});
