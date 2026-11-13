import { createClient, type Session } from '@supabase/supabase-js'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../lib/database.types'

// The occasion / wish / reservation / invite wrappers act for ONE account (lib/api/identity.ts asAccount,
// Codex review 2 H1): real supabase-js over HTTP (MSW). A request started for A carries A's bearer token;
// an answer that arrives after B became current is discarded with session_expired; a request for an
// expected account that is no longer current is never sent. Invented fixture accounts and tokens only.

const clientAccess = vi.hoisted(() => ({ getSupabase: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabase: clientAccess.getSupabase }))

import { markPageLeaving, resetAccountBoundaryForTests } from '../lib/accountBoundary'
import { acceptInvite, createInvite } from '../lib/api/invites'
import { getFeed, updateOccasion } from '../lib/api/occasions'
import { reserveWish } from '../lib/api/reservations'
import { createWish } from '../lib/api/wishes'
import {
  blockPerson, createFollowLink, getPeopleScreen, getProfileCard, peekFollowLink, removeFollower, requestFollow, requestFollowViaLink,
  respondFollow, revokeFollowLinks, setInSuggestions, unblockPerson, unfollow,
} from '../lib/api/follows'
import { createList, setListVisibility } from '../lib/api/lists'

const API_URL = 'http://pinning-api.localhost'
const ACCOUNT_A = '00000000-0000-4000-8000-0000000000aa'
const ACCOUNT_B = '00000000-0000-4000-8000-0000000000bb'
const OCCASION_ID = 'c0ffee00-0000-4000-8000-000000000001'
const WISHLIST_ID = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'
const TOKEN = '6a'.repeat(32)

function session(userId: string): Session {
  return {
    access_token: `fixture-token-${userId}`, refresh_token: 'fixture-refresh-token', expires_in: 3600, token_type: 'bearer',
    user: { id: userId, aud: 'authenticated', created_at: '2026-10-20T12:00:00Z', app_metadata: {}, user_metadata: {} },
  }
}

interface Captured { method: string; path: string; authorization: string | null }
let requests: Captured[] = []
let activeSession: Session | null = session(ACCOUNT_A)

function capture(request: Request) {
  requests.push({ method: request.method, path: new URL(request.url).pathname, authorization: request.headers.get('Authorization') })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const server = setupServer(
  http.post(`${API_URL}/rest/v1/rpc/accept_invite`, ({ request }) => {
    capture(request)
    return HttpResponse.json({ occasion_id: OCCASION_ID })
  }),
  http.post(`${API_URL}/rest/v1/rpc/create_invite`, ({ request }) => {
    capture(request)
    return HttpResponse.json({ token: TOKEN })
  }),
  http.post(`${API_URL}/rest/v1/rpc/reserve_wish`, ({ request }) => {
    capture(request)
    return HttpResponse.json({ ok: true })
  }),
  http.post(`${API_URL}/rest/v1/rpc/get_feed`, ({ request }) => {
    capture(request)
    return HttpResponse.json({ upcoming: [], past: [] })
  }),
  http.patch(`${API_URL}/rest/v1/occasions`, ({ request }) => {
    capture(request)
    return HttpResponse.json({ id: OCCASION_ID, title: 'Neu' })
  }),
  http.post(`${API_URL}/rest/v1/wishes`, ({ request }) => {
    capture(request)
    return HttpResponse.json({ id: 'w-1', wishlist_id: WISHLIST_ID, title: 'Buch' })
  }),
)

const testClient = createClient<Database>(API_URL, 'fixture-publishable-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const getSession = vi.spyOn(testClient.auth, 'getSession')

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
beforeEach(() => {
  requests = []
  activeSession = session(ACCOUNT_A)
  getSession.mockImplementation(async () => ({ data: { session: activeSession }, error: null }) as never)
  clientAccess.getSupabase.mockResolvedValue(testClient)
})
afterEach(() => {
  server.resetHandlers()
  resetAccountBoundaryForTests()
})
afterAll(() => {
  server.close()
  vi.restoreAllMocks()
})

describe('acceptInvite is pinned to the account of the "Beitreten" screen (d)', () => {
  it('sends the captured bearer token of that account and returns the occasion', async () => {
    await expect(acceptInvite(TOKEN, ACCOUNT_A)).resolves.toBe(OCCASION_ID)
    expect(requests).toEqual([{ method: 'POST', path: '/rest/v1/rpc/accept_invite', authorization: `Bearer fixture-token-${ACCOUNT_A}` }])
  })

  it('a stale expected account (B is current now) throws session_expired without sending anything', async () => {
    activeSession = session(ACCOUNT_B)
    await expect(acceptInvite(TOKEN, ACCOUNT_A)).rejects.toMatchObject({ code: 'session_expired' })
    expect(requests).toEqual([]) // never joined with B's token
  })

  it('signed out meanwhile: not_authenticated, nothing sent', async () => {
    activeSession = null
    await expect(acceptInvite(TOKEN, ACCOUNT_A)).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(requests).toEqual([])
  })

  it('an answer that arrives after B became current is discarded (the request carried A\'s token)', async () => {
    const received = deferred()
    const release = deferred()
    server.use(http.post(`${API_URL}/rest/v1/rpc/accept_invite`, async ({ request }) => {
      capture(request)
      received.resolve()
      await release.promise
      return HttpResponse.json({ occasion_id: OCCASION_ID })
    }))
    const pending = acceptInvite(TOKEN, ACCOUNT_A)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
    await received.promise
    activeSession = session(ACCOUNT_B)
    release.resolve()
    await rejected
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
  })
})

describe('the other wrappers follow the same pattern', () => {
  it('reserve, invite, feed, occasion update and wish create carry the captured token', async () => {
    await reserveWish('w-1', ACCOUNT_A)
    await createInvite(OCCASION_ID, ACCOUNT_A)
    await getFeed()
    await updateOccasion(OCCASION_ID, { title: ' Neu ' }, ACCOUNT_A)
    await createWish(WISHLIST_ID, { title: 'Buch' }, ACCOUNT_A)
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['POST', '/rest/v1/rpc/reserve_wish'], ['POST', '/rest/v1/rpc/create_invite'], ['POST', '/rest/v1/rpc/get_feed'],
      ['PATCH', '/rest/v1/occasions'], ['POST', '/rest/v1/wishes'],
    ])
    expect(new Set(requests.map((request) => request.authorization))).toEqual(new Set([`Bearer fixture-token-${ACCOUNT_A}`]))
  })

  it('a late server error for A (already_reserved) reaches the caller as session_expired once B is current', async () => {
    const received = deferred()
    const release = deferred()
    server.use(http.post(`${API_URL}/rest/v1/rpc/reserve_wish`, async ({ request }) => {
      capture(request)
      received.resolve()
      await release.promise
      return HttpResponse.json({ code: 'P0001', message: 'already_reserved', details: null, hint: null }, { status: 400 })
    }))
    const pending = reserveWish('w-1', ACCOUNT_A)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
    await received.promise
    activeSession = session(ACCOUNT_B)
    release.resolve()
    await rejected // never "already_reserved": B learns nothing about A's reservation attempt
  })

  it('the same error while A is still current stays what the server said', async () => {
    server.use(http.post(`${API_URL}/rest/v1/rpc/reserve_wish`, ({ request }) => {
      capture(request)
      return HttpResponse.json({ code: 'P0001', message: 'already_reserved', details: null, hint: null }, { status: 400 })
    }))
    await expect(reserveWish('w-1', ACCOUNT_A)).rejects.toMatchObject({ code: 'already_reserved' })
  })

  it('wrappers without an expected account pin the account that is current when they start', async () => {
    const received = deferred()
    const release = deferred()
    server.use(http.patch(`${API_URL}/rest/v1/occasions`, async ({ request }) => {
      capture(request)
      received.resolve()
      await release.promise
      return HttpResponse.json({ id: OCCASION_ID, title: 'Neu' })
    }))
    const pending = updateOccasion(OCCASION_ID, { title: 'Neu' })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
    await received.promise
    activeSession = session(ACCOUNT_B)
    release.resolve()
    await rejected
    expect(requests[0]?.authorization).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
  })
})

describe('nothing is sent while the page is leaving (an account reset decided on a full reload, round 2)', () => {
  it("a screen of the ended account that is still mounted cannot fetch with the account that is current now", async () => {
    activeSession = session(ACCOUNT_B) // B signed in; A's hidden screen refetches its feed (no expected account)
    markPageLeaving()
    await expect(getFeed()).rejects.toMatchObject({ code: 'session_expired' })
    await expect(reserveWish('w-1', ACCOUNT_B)).rejects.toMatchObject({ code: 'session_expired' })
    expect(requests).toEqual([])
  })

  it('an answer that arrives after the page started leaving is discarded', async () => {
    const received = deferred()
    const release = deferred()
    server.use(http.post(`${API_URL}/rest/v1/rpc/get_feed`, async ({ request }) => {
      capture(request)
      received.resolve()
      await release.promise
      return HttpResponse.json({ upcoming: [], past: [] })
    }))
    const pending = getFeed(ACCOUNT_A)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
    await received.promise
    markPageLeaving()
    release.resolve()
    await rejected
    expect(requests).toHaveLength(1)
  })
})

describe('wave 2b: the follow wrappers are pinned the same way (lib/api/follows.ts, follows-design W06)', () => {
  const PERSON = 'd1e0a000-0000-4000-8000-000000000003'
  const card = { id: PERSON, display_name: 'Clara Test', banner: null }
  const answers: Record<string, JsonBodyType> = {
    get_people_screen: { requests_in: [], requests_out: [], followers: [], following: [], blocked: [], links: [] },
    get_profile_card: { profile: card, relation: { self: false, i_follow: 'none', follows_me: 'none', mutual: false }, can_request: true, can_find_gift: false, lists: [], shared_occasions: [] },
    peek_follow_link: { profile: card, relation: { self: false, i_follow: 'none' } },
    request_follow_via_link: { status: 'requested', profile_id: PERSON },
    respond_follow: { ok: true },
    remove_follower: { ok: true },
    create_follow_link: { token: TOKEN, expires_at: '2026-11-19T10:00:00Z' },
    revoke_follow_links: { ok: true },
    block_user: { ok: true },
    unblock_user: { ok: true },
  }

  beforeEach(() => {
    server.use(
      ...Object.entries(answers).map(([name, body]) => http.post(`${API_URL}/rest/v1/rpc/${name}`, ({ request }) => {
        capture(request)
        return HttpResponse.json(body)
      })),
      http.patch(`${API_URL}/rest/v1/profiles`, ({ request }) => {
        capture(request)
        return new HttpResponse(null, { status: 204 })
      }),
    )
  })

  const calls = () => [
    () => getPeopleScreen(ACCOUNT_A), () => getProfileCard(PERSON, ACCOUNT_A), () => peekFollowLink(TOKEN, ACCOUNT_A),
    () => requestFollowViaLink(TOKEN, ACCOUNT_A), () => respondFollow(PERSON, true, ACCOUNT_A), () => removeFollower(PERSON, ACCOUNT_A),
    () => createFollowLink(ACCOUNT_A), () => revokeFollowLinks(ACCOUNT_A), () => blockPerson(PERSON, ACCOUNT_A),
    () => unblockPerson(PERSON, ACCOUNT_A), () => setInSuggestions(true, ACCOUNT_A),
  ]

  it('every call carries the captured token of the expected account', async () => {
    for (const call of calls()) await call()
    expect(requests.map((request) => request.path)).toEqual([
      ...['get_people_screen', 'get_profile_card', 'peek_follow_link', 'request_follow_via_link', 'respond_follow', 'remove_follower',
        'create_follow_link', 'revoke_follow_links', 'block_user', 'unblock_user'].map((name) => `/rest/v1/rpc/${name}`),
      '/rest/v1/profiles',
    ])
    expect(new Set(requests.map((request) => request.authorization))).toEqual(new Set([`Bearer fixture-token-${ACCOUNT_A}`]))
  })

  it('an expected account that is not current any more: session_expired, nothing is sent', async () => {
    activeSession = session(ACCOUNT_B)
    for (const call of calls()) await expect(call()).rejects.toMatchObject({ code: 'session_expired' })
    expect(requests).toEqual([])
  })

  it('a late answer for A (accept, block, a new link) reaches the caller as session_expired once B is current', async () => {
    for (const name of ['respond_follow', 'block_user', 'create_follow_link']) {
      requests = []
      activeSession = session(ACCOUNT_A)
      const received = deferred()
      const release = deferred()
      server.use(http.post(`${API_URL}/rest/v1/rpc/${name}`, async ({ request }) => {
        capture(request)
        received.resolve()
        await release.promise
        return HttpResponse.json(answers[name] ?? null)
      }))
      const pending = name === 'respond_follow' ? respondFollow(PERSON, true, ACCOUNT_A) : name === 'block_user' ? blockPerson(PERSON, ACCOUNT_A) : createFollowLink(ACCOUNT_A)
      const rejected = expect(pending).rejects.toMatchObject({ code: 'session_expired' })
      await received.promise
      activeSession = session(ACCOUNT_B)
      release.resolve()
      await rejected
      expect(requests[0]?.authorization, name).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
    }
  })

  it('the list writes of the same wave (visibility, a new list, request / unfollow) follow the same rules', async () => {
    const LIST = 'b1e5a000-0000-4000-8000-0000000000c1'
    const lateFor: Record<string, ReturnType<typeof deferred> | undefined> = {}
    const answer = (path: string, body: JsonBodyType) => async ({ request }: { request: Request }) => {
      capture(request)
      const gate = lateFor[path]
      if (gate) await gate.promise
      return HttpResponse.json(body)
    }
    server.use(
      http.post(`${API_URL}/rest/v1/rpc/set_list_visibility`, answer('set_list_visibility', { ok: true })),
      http.post(`${API_URL}/rest/v1/rpc/request_follow`, answer('request_follow', { status: 'requested' })),
      http.post(`${API_URL}/rest/v1/rpc/unfollow`, answer('unfollow', { ok: true })),
      http.post(`${API_URL}/rest/v1/wishlists`, answer('wishlists', { id: LIST, created_at: '2026-10-20T12:00:00Z' })),
    )
    const newList = (account: string) => createList({ id: LIST, title: 'Bücher', visibility: 'private', cover_tone: null, cover_icon: null, due_on: null }, account)
    const writes = (account: string) => [
      () => setListVisibility(LIST, 'followers', account), () => newList(account),
      () => requestFollow(PERSON, account), () => unfollow(PERSON, account),
    ]

    for (const write of writes(ACCOUNT_A)) await write()
    expect(requests.map((request) => request.path)).toEqual(
      ['/rest/v1/rpc/set_list_visibility', '/rest/v1/wishlists', '/rest/v1/rpc/request_follow', '/rest/v1/rpc/unfollow'])
    expect(new Set(requests.map((request) => request.authorization))).toEqual(new Set([`Bearer fixture-token-${ACCOUNT_A}`]))

    requests = []
    activeSession = session(ACCOUNT_B)
    for (const write of writes(ACCOUNT_A)) await expect(write()).rejects.toMatchObject({ code: 'session_expired' })
    expect(requests).toEqual([])

    for (const [path, start] of [['set_list_visibility', () => setListVisibility(LIST, 'followers', ACCOUNT_A)], ['wishlists', () => newList(ACCOUNT_A)]] as const) {
      requests = []
      activeSession = session(ACCOUNT_A)
      const release = deferred()
      lateFor[path] = release
      const rejected = expect(start()).rejects.toMatchObject({ code: 'session_expired' })
      await vi.waitFor(() => expect(requests).toHaveLength(1))
      activeSession = session(ACCOUNT_B)
      release.resolve()
      await rejected
      lateFor[path] = undefined
      expect(requests[0]?.authorization, path).toBe(`Bearer fixture-token-${ACCOUNT_A}`)
    }
  })
})
