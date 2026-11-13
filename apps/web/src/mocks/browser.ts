import { setupWorker } from 'msw/browser'
import { AUTH_STORAGE_KEY, QUERY_CACHE_KEY } from '../lib/app'
import { createDemoHandlers, DEMO_SUPABASE_URL } from './handlers'

let startPromise: Promise<void> | undefined

/** main.tsx awaits this before rendering or creating the Supabase client. */
export async function startDemo(): Promise<void> {
  if (import.meta.env.VITE_DEMO !== '1') return
  // Fail closed: demo email addresses must never reach a configured real backend.
  if (import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') !== DEMO_SUPABASE_URL) {
    throw new Error('Demo mode requires VITE_SUPABASE_URL=http://demo.localhost')
  }
  if (!startPromise) {
    // The local server starts empty after a reload. Remove only its old session/cache.
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      window.localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`)
      window.localStorage.removeItem(QUERY_CACHE_KEY)
    } catch {
      // Storage may be unavailable in private browsing.
    }
    startPromise = setupWorker(...createDemoHandlers())
      .start({ quiet: true, onUnhandledRequest: 'bypass' })
      .then(() => undefined)
  }
  await startPromise
}
