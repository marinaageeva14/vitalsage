import { defineConfig } from 'tsup';

export default defineConfig({
  entry:    ['src/index.ts'],
  format:   ['cjs'],
  outDir:   'dist',
  bundle:   true,
  // Bundle workspace packages into the CLI so it works standalone
  noExternal: ['@vitalsage/types', 'vitalsage-analysis', 'vitalsage-simulator'],
  // Keep true Node.js deps external (playwright, fast-xml-parser, etc.)
  external: ['playwright', 'fast-xml-parser'],
  dts:      false,
  clean:    true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
