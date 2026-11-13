import { defineConfig } from 'vite';

// The demo page lives in ./demo and imports the library from ../src.
// `vite build` writes to ./dist (ignored by the repo .gitignore); `vite preview` serves it.
export default defineConfig({
  root: 'demo',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
