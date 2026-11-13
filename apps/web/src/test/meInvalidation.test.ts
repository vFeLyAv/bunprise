import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../lib/database.types'

// The guard's trusted get_me (lib/consentGate.ts, docs/decisions/2026-10-20-guard-me-cache.md) never
// outlives a write that can change it: every profile / legal-record write through the real wrappers
// marks it before the request and again when the request settled — success or failure — and the
// account boundary wipes it with the rest of the cache. Real supabase-js against the demo server (MSW).
// Invented fixture accounts only.

const access = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(access.client),
  hasLocalSession: () => access.client !== null,
  getLocalSession: () => Promise.resolve(null),
  onClientReady: () => () => {},
}))

import { resetAccountBoundaryForTests } from '../lib/accountBoundary'
import { acceptConsents } from '../lib/api/consents'
import { markOnboardingDone, setDisplayName, updateMyProfile } from '../lib/api/profile'
import { hasCurrentConsents, trustedMe } from '../lib/consentGate'
import { clearAccountDeviceState, queryClient, setSdkSessionIdentity } from '../lib/query'
import { createDemoHandlers, DEMO_CODE, DEMO_SUPABASE_URL } from '../mocks/handlers'

const server = setupServer()
let getMeCalls = 0
let clientCount = 0

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', ({ request }) => {
    if (new URL(request.url).pathname.endsWith('/rpc/get_me')) getMeCalls += 1
  })
  vi.spyOn(console, 'debug').mockImplementation(() => {}) // toAppError logs every mapped error in DEV
})
beforeEach(() => {
  server.resetHandlers(...createDemoHandlers())
  access.client = null
  queryClient.clear()
})
afterEach(() => {
  queryClient.clear()
  setSdkSessionIdentity(undefined)
  resetAccountBoundaryForTests()
  window.localStorage.clear()
})
afterAll(() => {
  server.close()
  vi.restoreAllMocks()
})

/** A finished demo account (name + current legal records) on its own client. */
async function signedIn(email: string): Promise<{ client: SupabaseClient<Database>; userId: string }> {
  const client = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `me-invalidation-${clientCount++}` },
  })
  await client.auth.signInWithOtp({ email })
  const verified = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  access.client = client
  const userId = verified.data.session!.user.id
  await setDisplayName('Mila', userId)
  await acceptConsents('de', undefined, userId)
  return { client, userId }
}

/** The guard check, counting the get_me requests it needed. */
async function guardCheck(userId: string): Promise<{ allowed: boolean; requests: number }> {
  const before = getMeCalls
  const allowed = await hasCurrentConsents(queryClient, userId)
  return { allowed, requests: getMeCalls - before }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("the guard's trusted get_me and the writes that change it", () => {
  it('every profile and legal-record write makes the next screen change ask the server again', async () => {
    const { userId } = await signedIn('mila@example.test')
    expect(await guardCheck(userId)).toEqual({ allowed: true, requests: 1 })
    expect(await guardCheck(userId)).toEqual({ allowed: true, requests: 0 }) // trusted: instant

    const writes: [string, () => Promise<unknown>][] = [
      ['display name', () => setDisplayName('Mila M.', userId)],
      ['language', () => updateMyProfile({ locale: 'en' }, userId)],
      ['onboarding done', () => markOnboardingDone(userId)],
      ['legal records', () => acceptConsents('de', undefined, userId)],
    ]
    for (const [name, write] of writes) {
      await write()
      expect(trustedMe(queryClient, userId), name).toBeNull()
      expect(await guardCheck(userId), name).toEqual({ allowed: true, requests: 1 })
      expect(await guardCheck(userId), name).toEqual({ allowed: true, requests: 0 })
    }
  })

  it('a failed write invalidates as well (the server may have committed it)', async () => {
    const { userId } = await signedIn('mila@example.test')
    await guardCheck(userId)
    // the server refuses the value (22007) after the request went out
    await expect(updateMyProfile({ onboarding_done_at: 'bald' }, userId)).rejects.toMatchObject({ key: expect.stringMatching(/^errors\./) })
    expect(trustedMe(queryClient, userId)).toBeNull()
  })

  it('while a write is on its way, the old answer is not trusted', async () => {
    const { userId } = await signedIn('mila@example.test')
    await guardCheck(userId)
    const gate = deferred()
    // holds the PATCH, then falls through to the demo handler (MSW continues when a resolver returns nothing)
    server.use(http.patch(`${DEMO_SUPABASE_URL}/rest/v1/profiles`, async () => {
      await gate.promise
    }))
    const write = updateMyProfile({ locale: 'en' }, userId)
    await vi.waitFor(() => expect(trustedMe(queryClient, userId)).toBeNull())
    gate.resolve()
    await write
    expect(trustedMe(queryClient, userId)).toBeNull()
  })

  it('the end of the account (sign-out, deletion) wipes it with the whole cache', async () => {
    const { userId } = await signedIn('mila@example.test')
    await guardCheck(userId)
    expect(trustedMe(queryClient, userId)).not.toBeNull()
    setSdkSessionIdentity(userId)
    expect(clearAccountDeviceState(userId, null)).toBe(true)
    expect(queryClient.getQueryState(['me'])).toBeUndefined()
    expect(trustedMe(queryClient, userId)).toBeNull()
  })
})
