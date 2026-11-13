import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { AUTH_STORAGE_KEY } from './app'

// Lazy access to the Supabase client. The client itself (supabaseClient.ts, ~55 KB gz with auth-js)
// is a separate chunk that loads on first use: when a session exists at boot, on sign-in, or on the
// first API call. Anonymous visitors of /i/<token>, / or /legal/* never download it
// (framework-decision 9.7: the invite landing must be the lightest route).

export type Supabase = SupabaseClient<Database>

type ReadyListener = (client: Supabase) => void

let clientPromise: Promise<Supabase> | null = null
const readyListeners = new Set<ReadyListener>()

/** Loads (once) and returns the client. */
export function getSupabase(): Promise<Supabase> {
  if (!clientPromise) {
    const pending = import('./supabaseClient').then((mod) => {
      for (const listener of readyListeners) listener(mod.supabase)
      return mod.supabase
    })
    clientPromise = pending
    // A failed lazy load must be retryable instead of poisoning every later route attempt.
    void pending.catch(() => { if (clientPromise === pending) clientPromise = null })
  }
  return clientPromise
}

/**
 * Runs `listener` as soon as the client exists (immediately if it already does).
 * Used by the session watcher so it never forces the client to load for anonymous visitors.
 */
export function onClientReady(listener: ReadyListener): () => void {
  readyListeners.add(listener)
  if (clientPromise) void clientPromise.then((client) => readyListeners.has(listener) && listener(client)).catch(() => {})
  return () => readyListeners.delete(listener)
}

/** True when supabase-js stored a session on this device (no client needed to know). */
export function hasLocalSession(): boolean {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/**
 * The stored session (localStorage, no network) or null. Used by route guards; returns null
 * without loading the client when nobody is signed in on this device.
 */
export async function getLocalSession(): Promise<Session | null> {
  if (!hasLocalSession()) return null
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}
