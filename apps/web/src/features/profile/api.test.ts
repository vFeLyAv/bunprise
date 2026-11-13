import { createClient, type Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../lib/database.types'
import type { Consent, Me } from '../../lib/api/types'
import type { LegalVersionMap } from '../../lib/legal'

const clientAccess = vi.hoisted(() => ({ getSupabase: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ getSupabase: clientAccess.getSupabase }))

import { getMe, getMyProfile, updateMyProfile } from '../../lib/api/profile'
import { acceptConsents, getMyConsents } from '../../lib/api/consents'

const API_URL = 'http://profile-api.localhost'
const ACCOUNT_A = '00000000-0000-4000-8000-000000000001'
const ACCOUNT_B = '00000000-0000-4000-8000-000000000002'
// Deliberately different from bundled versions: transport must send exactly what
// its caller checked, never silently fall back to compile-time version constants.
const versions: LegalVersionMap = {
  terms: 'terms-server-current', privacy_notice: 'privacy-server-current', age_18plus: 'age-server-current',
}

function session(userId: string): Session {
  return {
    access_token: `fixture-token-${userId}`, refresh_token: 'fixture-refresh-token',
    expires_in: 3600, token_type: 'bearer',
    user: { id: userId, aud: 'authenticated', created_at: '2026-10-19T12:00:00Z', app_metadata: {}, user_metadata: {} },
  }
}

function me(userId = ACCOUNT_A): Me {
  return {
    profile: { id: userId, display_name: 'Mila', locale: 'de', onboarding_done_at: null },
    consents_ok: true,
    legal_versions: { terms: versions.terms, privacy: versions.privacy_notice, age: versions.age_18plus },
  }
}

interface CapturedRequest {
  method: string
  url: URL
  authorization: string | null
  prefer: string | null
  body: unknown
}

let activeSession = session(ACCOUNT_A)
let serverMe = me()
let serverJournal: Consent[] = []
let requests: CapturedRequest[] = []

async function capture(request: Request): Promise<void> {
  requests.push({
    method: request.method, url: new URL(request.url),
    authorization: request.headers.get('Authorization'), prefer: request.headers.get('Prefer'),
    body: request.method === 'GET' ? null : await request.clone().json(),
  })
}

const server = setupServer(
  http.post(`${API_URL}/rest/v1/rpc/get_me`, async ({ request }) => {
    await capture(request)
    return HttpResponse.json(serverMe)
  }),
  http.patch(`${API_URL}/rest/v1/profiles`, async ({ request }) => {
    await capture(request)
    // Match the production column grants: own private fields are available via
    // get_me, never through an UPDATE RETURNING of the full profile.
    if (new URL(request.url).searchParams.has('select') || request.headers.get('Prefer')?.includes('return=representation')) {
      return HttpResponse.json({ code: '42501', message: 'private profile columns', details: '' }, { status: 403 })
    }
    const patch = await request.json() as Partial<Me['profile']>
    serverMe = { ...serverMe, profile: { ...serverMe.profile, ...patch } }
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(`${API_URL}/rest/v1/consents`, async ({ request }) => {
    await capture(request)
    return HttpResponse.json(serverJournal)
  }),
  http.post(`${API_URL}/rest/v1/consents`, async ({ request }) => {
    await capture(request)
    return new HttpResponse(null, { status: 201 })
  }),
)

const testClient = createClient<Database>(API_URL, 'fixture-publishable-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const getSession = vi.spyOn(testClient.auth, 'getSession')

beforeAll(() => { server.listen({ onUnhandledRequest: 'error' }) })
beforeEach(() => {
  activeSession = session(ACCOUNT_A)
  serverMe = me()
  serverJournal = []
  requests = []
  getSession.mockImplementation(async () => ({ data: { session: activeSession }, error: null }))
  clientAccess.getSupabase.mockResolvedValue(testClient)
})
afterEach(() => { server.resetHandlers() })
afterAll(() => { server.close(); getSession.mockRestore() })

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}

describe('profile HTTP boundary', () => {
  it('updates only the captured own row without inaccessible RETURNING, then reads private values through get_me', async () => {
    await expect(updateMyProfile({ display_name: '  Nora  ', locale: 'en' }, ACCOUNT_A)).resolves.toMatchObject({
      id: ACCOUNT_A, display_name: 'Nora', locale: 'en', onboarding_done_at: null,
    })
    const update = requests.find((request) => request.method === 'PATCH')
    expect(update?.url.pathname).toBe('/rest/v1/profiles')
    expect(update?.url.searchParams.get('id')).toBe(`eq.${ACCOUNT_A}`)
    expect(update?.url.searchParams.has('select')).toBe(false)
    expect(update?.prefer ?? '').not.toContain('return=representation')
    expect(update?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
    expect(update?.body).toEqual({ display_name: 'Nora', locale: 'en' })
    expect(requests.map((request) => [request.method, request.url.pathname])).toEqual([
      ['PATCH', '/rest/v1/profiles'], ['POST', '/rest/v1/rpc/get_me'],
    ])
  })

  it('reads the own profile through the RPC rather than selecting forbidden REST columns', async () => {
    await expect(getMyProfile(ACCOUNT_A)).resolves.toEqual(serverMe.profile)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url.pathname).toBe('/rest/v1/rpc/get_me')
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
  })

  it('rejects a replacement profile in a response even if the active session has not changed', async () => {
    serverMe = me(ACCOUNT_B)
    await expect(getMe(ACCOUNT_A)).rejects.toMatchObject({ code: 'session_expired' })
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
  })

  it('pins a deferred get_me request to A and discards it when B becomes active', async () => {
    const received = deferred<void>()
    const release = deferred<void>()
    server.use(http.post(`${API_URL}/rest/v1/rpc/get_me`, async ({ request }) => {
      await capture(request)
      received.resolve()
      await release.promise
      return HttpResponse.json(me(ACCOUNT_A))
    }))
    const pending = getMe(ACCOUNT_A)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
    await received.promise
    activeSession = session(ACCOUNT_B)
    release.resolve()
    await rejected
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
  })

  it('does not start reads or writes for A when B is already active', async () => {
    activeSession = session(ACCOUNT_B)
    await expect(getMe(ACCOUNT_A)).rejects.toMatchObject({ code: 'session_expired' })
    await expect(updateMyProfile({ display_name: 'Nora' }, ACCOUNT_A)).rejects.toMatchObject({ code: 'session_expired' })
    await expect(acceptConsents('en', versions, ACCOUNT_A)).rejects.toMatchObject({ code: 'session_expired' })
    expect(requests).toEqual([])
  })

  it.each(['N'.repeat(41), `${' '.repeat(41)}Nora`, 'Nora\nOther', '\tNora', '   '])(
    'rejects invalid raw name %j without truncating it or issuing a profile write', async (display_name) => {
      await expect(updateMyProfile({ display_name }, ACCOUNT_A)).rejects.toMatchObject({ code: 'invalid_input' })
      expect(requests).toEqual([])
    },
  )
})

describe('consent HTTP boundary', () => {
  it('posts only the requested records with the exact supplied versions, own identity and language', async () => {
    await acceptConsents('en', versions, ACCOUNT_A, ['terms', 'privacy_notice'])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url.pathname).toBe('/rest/v1/consents')
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
    expect(requests[0]?.prefer).toContain('resolution=ignore-duplicates')
    expect(requests[0]?.body).toEqual([
      { profile_id: ACCOUNT_A, kind: 'terms', version: versions.terms, locale: 'en' },
      { profile_id: ACCOUNT_A, kind: 'privacy_notice', version: versions.privacy_notice, locale: 'en' },
    ])
  })

  it('filters journal reads by the captured own identity and refuses another profile in the payload', async () => {
    await expect(getMyConsents(ACCOUNT_A)).resolves.toEqual([])
    expect(requests[0]?.url.searchParams.get('profile_id')).toBe(`eq.${ACCOUNT_A}`)
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
    serverJournal = [{ profile_id: ACCOUNT_B, kind: 'terms', version: versions.terms, locale: 'de', accepted_at: '2026-10-19T12:00:00Z' }]
    await expect(getMyConsents(ACCOUNT_A)).rejects.toMatchObject({ code: 'session_expired' })
  })

  it('keeps a deferred consent write pinned to A and reports replacement before confirming success', async () => {
    const received = deferred<void>()
    const release = deferred<void>()
    server.use(http.post(`${API_URL}/rest/v1/consents`, async ({ request }) => {
      await capture(request)
      received.resolve()
      await release.promise
      return new HttpResponse(null, { status: 201 })
    }))
    const pending = acceptConsents('de', versions, ACCOUNT_A, ['age_18plus'])
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
    await received.promise
    activeSession = session(ACCOUNT_B)
    release.resolve()
    await rejected
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
    expect(requests[0]?.body).toEqual([{ profile_id: ACCOUNT_A, kind: 'age_18plus', version: versions.age_18plus, locale: 'de' }])
  })
})
