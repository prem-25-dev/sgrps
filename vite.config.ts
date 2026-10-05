import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Emit \uXXXX escapes rather than raw UTF-8 for the arrows, ticks and
  // bullets the interface uses. The bundle is then pure ASCII and renders the
  // same however it is served or embedded, including inlined into a page that
  // carries no charset of its own.
  esbuild: { charset: 'ascii' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true, port: 5173 },
});
