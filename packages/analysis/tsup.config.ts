import { defineConfig } from 'tsup';

export default defineConfig({
  entry:      ['src/index.ts'],
  format:     ['cjs', 'esm'],
  outDir:     'dist',
  bundle:     true,
  // Bundle the types package so consumers don't need it as a peer dep
  noExternal: ['@vitalsage/types'],
  external:   ['fast-xml-parser'],
  dts:        false,   // declarations handled by tsc --emitDeclarationOnly
  clean:      true,
  sourcemap:  true,
});
