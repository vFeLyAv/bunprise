import { defineConfig } from '@playwright/test'

// Minimal end-to-end config: runs against the demo mode (no Supabase project needed).
// Browsers are installed separately (`npx playwright install firefox`); Felix tests in Firefox.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'firefox-phone',
      use: { browserName: 'firefox', viewport: { width: 390, height: 844 }, locale: 'de-DE' },
    },
  ],
  webServer: {
    command: 'npm run dev:demo',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
