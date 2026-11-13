import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit/component tests (jsdom + Testing Library). Routes are imported from the generated
// route tree, so no router plugin is needed here. SQL/RLS tests live in packages/db-tests.
export default defineConfig({
  envDir: false,
  plugins: [react(), {
    name: 'test-virtual-pwa',
    resolveId(id) {
      // Production gets this module from VitePWA; unit tests supply a vi.mock factory.
      if (id === 'virtual:pwa-register') return id
    },
  }],
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Half the cores: the dev machine also runs the preview servers and Felix's browser. With every core busy,
    // 1–9 random component tests (a different set each run) missed their 5 s / findBy limits; with half the
    // workers the whole suite is green and only ~10 s slower (measured 2026-10-23, 16 cores).
    maxWorkers: '50%',
    env: {
      // the supabase client validates its env at import time; no request is ever sent in tests
      VITE_SUPABASE_URL: 'http://demo.localhost',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test',
    },
  },
})
