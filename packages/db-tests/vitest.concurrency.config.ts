import { defineConfig } from 'vitest/config'

// npm run test:concurrency -w @bunprise/db-tests — real PostgreSQL 17 via embedded-postgres
// (docs/decisions/0002-concurrency-tests-real-postgres.md). One server per test file; files run in parallel.
export default defineConfig({
  envDir: false,
  test: {
    include: ['test/concurrency/**/*.test.ts'],
    // initdb + start take a few seconds per file; a hanging lock is cut by lock_timeout (5 s) long before these.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
