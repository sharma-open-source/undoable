import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { undoable: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: { entry: { index: 'src/index.ts' } },
    clean: true,
    target: 'es2020',
  },
  {
    entry: { undoable: 'src/index.ts' },
    format: ['iife'],
    globalName: 'undoable',
    outExtension: () => ({ js: '.global.js' }),
    target: 'es2020',
  },
]);
