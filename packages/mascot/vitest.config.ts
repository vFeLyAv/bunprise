import { defineConfig } from 'vitest/config';

// jsdom has no Web Animations API; test/setup.ts installs a minimal polyfill.
export default defineConfig({
  envDir: false,
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // 31.10: the whole-page gallery tests (binky, comic, story, Tapsi…) build hundreds of puppets in jsdom; with 35 files
    // running in parallel they took 5–7 s and hit the 5 s default although each passes alone in ~1–2 s
    testTimeout: 30000,
  },
});
