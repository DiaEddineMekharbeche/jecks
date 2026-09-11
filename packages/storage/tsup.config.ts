import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  // Not in watch mode. Cleaning wipes dist on every restart, and the declaration files
  // take seconds longer to rebuild than the JavaScript — during which the API's compiler
  // reads a dist with code and no types and reports every import as an implicit any.
  clean: !process.argv.includes('--watch'),
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
