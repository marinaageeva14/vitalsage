import typescript from '@rollup/plugin-typescript';
import resolve    from '@rollup/plugin-node-resolve';
import replace    from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg: { version: string } = _require('./package.json');

const replaceTokens = replace({
  '__VERSION__': pkg.version,
  '__DEV__':     'false',
  preventAssignment: true,
});

export default [
  // ESM — peers external (web-vitals imported by consumer)
  {
    input: 'src/index.ts',
    external: ['web-vitals', '@vitalsage/types'],
    output: {
      file:      'dist/vitalsage.js',
      format:    'esm',
      sourcemap: true,
    },
    plugins: [resolve(), replaceTokens, typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },

  // CJS — peers external
  {
    input: 'src/index.ts',
    external: ['web-vitals', '@vitalsage/types'],
    output: {
      file:      'dist/vitalsage.cjs',
      format:    'cjs',
      sourcemap: true,
    },
    plugins: [resolve(), replaceTokens, typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },

  // IIFE — bundles web-vitals, minified, no external deps
  {
    input: 'src/index.ts',
    output: {
      file:    'dist/vitalsage.iife.js',
      format:  'iife',
      name:    'VitalSage',
      plugins: [terser()],
    },
    plugins: [resolve({ browser: true }), replaceTokens, typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
];
