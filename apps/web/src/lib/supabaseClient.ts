import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { APP_VERSION, AUTH_STORAGE_KEY } from './app'

// The real Supabase client (framework-decision 9.5, performance-plan 6.1). Do NOT import this file
// directly — use getSupabase() from ./supabase so the ~60 KB gz of supabase-js stay out of the
// initial bundle (the invite landing / start screen never need it before sign-in).
// Session lives in localStorage (offline re-open without re-login); no cookies, no @supabase/ssr.

function requireEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = import.meta.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy apps/web/.env.example to apps/web/.env.local and fill it in ` +
        `(docs/setup.md), or start without a backend: npm run dev:demo`,
    )
  }
  return value
}

const supabaseUrl = requireEnv('VITE_SUPABASE_URL')
try {
  new URL(supabaseUrl)
} catch {
  throw new Error(`VITE_SUPABASE_URL is not a valid URL: "${supabaseUrl}"`)
}

export const supabase = createClient<Database>(supabaseUrl, requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY'), {
  auth: {
    flowType: 'pkce', // Google OAuth via PKCE (auth-js default is 'implicit')
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // /auth/callback?code=… is exchanged automatically
    storageKey: AUTH_STORAGE_KEY,
  },
  global: {
    headers: { 'x-client-info': `bunprise-web/${APP_VERSION}` },
  },
})
