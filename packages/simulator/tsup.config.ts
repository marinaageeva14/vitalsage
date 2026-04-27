import { defineConfig } from 'tsup';

export default defineConfig({
  entry:      ['src/index.ts'],
  format:     ['cjs', 'esm'],
  outDir:     'dist',
  bundle:     true,
  // Bundle @vitalsage/types so consumers don't need it as a peer dep
  noExternal: ['@vitalsage/types'],
  // Keep heavy runtime deps external — consumers must have playwright installed
  external:   ['playwright'],
  dts:        false,   // declarations handled by tsc --emitDeclarationOnly
  clean:      true,
  sourcemap:  true,
});
