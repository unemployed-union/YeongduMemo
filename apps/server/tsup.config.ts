import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  splitting: false,
  clean: true,
  noExternal: ['@yeongdu/shared'],
  target: 'node24',
  sourcemap: true,
});
