import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: false,
  test: {
    include: ['test/**/*.test.ts'],
    // Real-PostgreSQL concurrency tests have their own config and command (vitest.concurrency.config.ts, ADR-0002).
    exclude: [...configDefaults.exclude, 'test/concurrency/**'],
    // PGlite boots a WASM Postgres per test file (~1-2 s); be generous.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
