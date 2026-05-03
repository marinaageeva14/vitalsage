import { defineConfig } from 'tsup';

export default defineConfig({
  entry:      ['src/index.ts'],
  format:     ['esm'],
  outDir:     'dist',
  bundle:     true,
  // Bundle all workspace deps so the server ships as a single file.
  noExternal: ['vitalsage-analysis', 'vitalsage-simulator', '@vitalsage/types'],
  // Playwright must stay external — it has native bindings.
  external:   ['playwright', '@playwright/test'],
  dts:        false,
  clean:      true,
  sourcemap:  true,
  target:     'node18',
});
