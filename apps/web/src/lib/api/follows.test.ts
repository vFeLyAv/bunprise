import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../database.types'

// The follow wrappers (lib/api/follows.ts) against the demo server (src/mocks): exactly the requests the people
// screens, the person card, the gate /f and Profil › Privatsphäre send — the RPC names and parameters of
// follows-design §5.2/§5.3, the one REST write (profiles.in_suggestions) — and every refusal as the AppError code
// the screens translate. Fictional accounts only.
const access = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(access.client),
  hasLocalSession: () => access.client !== null,
  getLocalSession: () => Promise.resolve(null),
  onClientReady: () => () => {},
}))

import { acceptConsents } from './consents'
import {
  blockPerson, buildFollowUrl, createFollowLink, getPeopleScreen, getProfileCard, isFollowTokenShape, peekFollowLink, removeFollower,
  requestFollow, requestFollowViaLink, respondFollow, revokeFollowLinks, setInSuggestions, unblockPerson, unfollow,
} from './follows'
import { asPeopleScreen, asPersonCard } from './follows.types'
import { getMe, updateMyProfile } from './profile'
import { createDemoHandlers, DEMO_CODE, DEMO_PEOPLE, DEMO_SUPABASE_URL, DEMO_USER_ID } from '../../mocks/handlers'
import { DEMO_FOLLOW_TOKENS } from '../../mocks/follows'
import { DEMO_LIST_PEOPLE } from '../../mocks/lists'

type Client = SupabaseClient<Database>

const server = setupServer()
let clientCount = 0
const { anna, ben, clara } = DEMO_PEOPLE
const { finn, greta, rosa, paula } = DEMO_LIST_PEOPLE

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
beforeEach(() => {
  server.resetHandlers(...createDemoHandlers())
  access.client = null
})
afterAll(() => {
  server.close()
  vi.restoreAllMocks()
})

async function becomes(email: string, name: string, consent = true): Promise<{ client: Client; id: string }> {
  const client = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `demo-follows-${clientCount++}` },
  })
  await client.auth.signInWithOtp({ email })
  const verified = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  expect(verified.error).toBeNull()
  access.client = client
  await updateMyProfile({ display_name: name, locale: 'de' })
  if (consent) await acceptConsents('de')
  return { client, id: verified.data.session!.user.id }
}

describe('lib/api/follows against the demo server', () => {
  it('the people screen and the person card of the first demo account: MY relations only', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    expect(me.id).toBe(DEMO_USER_ID)
    const screen = await getPeopleScreen(me.id)
    expect(screen.requests_in.map((row) => row.profile.id)).toEqual([greta.id, finn.id])
    expect(screen.followers.map((row) => [row.profile.display_name, row.i_follow])).toEqual([['Anna Beispiel', 'following'], ['Paula Brandt', 'following'], ['Rosa Klein', 'none']])
    expect(screen.following.map((row) => [row.profile.display_name, row.follows_me])).toEqual([['Anna Beispiel', 'following'], ['Ben Mustermann', 'none'], ['Paula Brandt', 'following']])
    expect(screen).toMatchObject({ requests_out: [], blocked: [], links: [] })
    expect((await getMe(me.id)).inbox).toEqual({ follow_requests: 2, occasion_invites: 1 }) // + Paula's in-app invitation (mocks/invitations.ts)

    const annaCard = await getProfileCard(anna.id, me.id)
    expect(annaCard).toMatchObject({ relation: { self: false, i_follow: 'following', follows_me: 'following', mutual: true }, can_find_gift: true })
    expect(annaCard.lists.map((list) => list.title)).toEqual(['Geburtstag', 'Annas Wünsche'])
    expect(await getProfileCard(me.id, me.id)).toMatchObject({ relation: { self: true }, can_request: false, lists: [] })
    await expect(getProfileCard('00000000-0000-4000-8000-00000000ffff', me.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('the gate: peek writes nothing, the link only ASKS; every bad code is invite_invalid', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    expect(await peekFollowLink(DEMO_FOLLOW_TOKENS.clara, me.id)).toEqual({
      profile: { id: clara.id, display_name: 'Clara Test', banner: 'sky', photo: null, banner_photo: null }, relation: { self: false, i_follow: 'none' },
    })
    expect(await peekFollowLink(DEMO_FOLLOW_TOKENS.anna, me.id)).toMatchObject({ relation: { i_follow: 'following' } })
    for (const bad of ['garbage', 'f'.repeat(64)]) await expect(peekFollowLink(bad, me.id)).rejects.toMatchObject({ code: 'invite_invalid', key: 'errors.invite_invalid' })
    expect(await requestFollowViaLink(DEMO_FOLLOW_TOKENS.clara, me.id)).toEqual({ status: 'requested', profile_id: clara.id })
    expect((await getPeopleScreen(me.id)).requests_out.map((row) => row.profile.id)).toEqual([clara.id])
    expect(await requestFollowViaLink(DEMO_FOLLOW_TOKENS.anna, me.id)).toEqual({ status: 'following', profile_id: anna.id })
  })

  it('an account without current consents learns nothing about any code', async () => {
    const me = await becomes('mila@example.test', 'Mila', false)
    for (const code of ['garbage', DEMO_FOLLOW_TOKENS.clara]) {
      await expect(peekFollowLink(code, me.id)).rejects.toMatchObject({ code: 'consent_required' })
      await expect(requestFollowViaLink(code, me.id)).rejects.toMatchObject({ code: 'consent_required' })
    }
    await expect(createFollowLink(me.id)).rejects.toMatchObject({ code: 'consent_required' })
  })

  it('answers to requests: accept, decline (silent), and the request that is gone is not_found', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    await respondFollow(finn.id, true, me.id)
    await respondFollow(greta.id, false, me.id)
    const screen = await getPeopleScreen(me.id)
    expect(screen.requests_in).toEqual([])
    expect(screen.followers.map((row) => row.profile.id)).toContain(finn.id)
    expect((await getMe(me.id)).inbox).toEqual({ follow_requests: 0, occasion_invites: 1 })
    await expect(respondFollow(greta.id, true, me.id)).rejects.toMatchObject({ code: 'not_found' }) // hidden by my silence
    // "Auch folgen": Finn follows me now, so I may ask him
    expect(await requestFollow(finn.id, me.id)).toBe('requested')
    await unfollow(finn.id, me.id) // withdraw
    expect((await getPeopleScreen(me.id)).requests_out).toEqual([])
  })

  it('remove a follower, block (follows end both ways), unblock (nothing comes back)', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    await removeFollower(rosa.id, me.id)
    await expect(removeFollower(rosa.id, me.id)).rejects.toMatchObject({ code: 'not_found' })
    await blockPerson(paula.id, me.id)
    const blocked = await getPeopleScreen(me.id)
    expect(blocked.blocked.map((row) => [row.profile_id, row.display_name])).toEqual([[paula.id, 'Paula Brandt']])
    expect(blocked.followers.map((row) => row.profile.id)).not.toContain(paula.id)
    expect(blocked.following.map((row) => row.profile.id)).not.toContain(paula.id)
    await expect(getProfileCard(paula.id, me.id)).rejects.toMatchObject({ code: 'not_found' })
    await unblockPerson(paula.id, me.id)
    expect((await getPeopleScreen(me.id)).following.map((row) => row.profile.id)).not.toContain(paula.id)
    await expect(blockPerson(me.id, me.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('my follow links: a code of 64 hex in the fragment, ≤ 5 live, all off at once', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const link = await createFollowLink(me.id)
    expect(isFollowTokenShape(link.token)).toBe(true)
    expect(buildFollowUrl(link.token)).toMatch(new RegExp(`/f#${link.token}$`))
    expect(Date.parse(link.expires_at) - Date.now()).toBeGreaterThan(29 * 86_400_000)
    for (let n = 0; n < 5; n += 1) await createFollowLink(me.id)
    expect((await getPeopleScreen(me.id)).links).toHaveLength(5)
    await expect(peekFollowLink(link.token, me.id)).rejects.toMatchObject({ code: 'invite_invalid' }) // the oldest went off
    await revokeFollowLinks(me.id)
    expect((await getPeopleScreen(me.id)).links).toEqual([])
  })

  it('"In Vorschlägen aus Anlässen erscheinen": the own REST write, read back only through get_me', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    expect((await getMe(me.id)).profile.in_suggestions).toBe(false)
    await setInSuggestions(true, me.id)
    expect((await getMe(me.id)).profile.in_suggestions).toBe(true)
    const raw = me.client as unknown as SupabaseClient
    expect((await raw.from('profiles').select('in_suggestions').eq('id', me.id)).error).not.toBeNull() // no SELECT grant
    // another account now sees Mila as a suggestion of their shared occasion ("Annas Einweihung")
    await setInSuggestions(false, me.id)
    expect((await getMe(me.id)).profile.in_suggestions).toBe(false)
    void ben
  })

  it('pins every call to the expected account: another one is never sent', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const other = '00000000-0000-4000-8000-0000000000bb'
    await expect(getPeopleScreen(other)).rejects.toMatchObject({ code: 'session_expired' })
    await expect(createFollowLink(other)).rejects.toMatchObject({ code: 'session_expired' })
    await expect(blockPerson(anna.id, other)).rejects.toMatchObject({ code: 'session_expired' })
    await expect(setInSuggestions(true, other)).rejects.toMatchObject({ code: 'session_expired' })
    expect((await getPeopleScreen(me.id)).blocked).toEqual([])
    expect((await getMe(me.id)).profile.in_suggestions).toBe(false)
  })
})

describe('follows normalisers: known keys only', () => {
  it('a person card drops lists unless I follow, and never carries a stray field', () => {
    const card = asPersonCard({
      profile: { id: 'p1', display_name: 'Ben', banner: 'neon', followers: 12 },
      relation: { self: false, i_follow: 'requested', follows_me: 'weird', mutual: true },
      can_request: true, can_find_gift: true, lists: [{ id: 'l1', title: 'Geheim' }], shared_occasions: [{ id: 'o1', title: 'Fest', starts_at: 'x' }],
      follower_count: 3, reserved: true,
    })
    expect(card).toEqual({
      profile: { id: 'p1', display_name: 'Ben', banner: null, photo: null, banner_photo: null },
      relation: { self: false, i_follow: 'requested', follows_me: 'none', mutual: false },
      can_request: true, can_find_gift: true, lists: [], shared_occasions: [{ id: 'o1', title: 'Fest', starts_at: 'x' }],
    })
    expect(() => asPersonCard({ relation: {} })).toThrow()
  })

  it('the people screen keeps exactly its six sections', () => {
    const screen = asPeopleScreen({ requests_in: [{ profile: { id: 'a' }, requested_at: 't', shared_occasions: [], i_follow: 'following', note: 'x' }], extra: [1] })
    expect(Object.keys(screen).sort()).toEqual(['blocked', 'followers', 'following', 'links', 'requests_in', 'requests_out'])
    expect(screen.requests_in).toEqual([{ profile: { id: 'a', display_name: null, banner: null, photo: null, banner_photo: null }, requested_at: 't', shared_occasions: [], i_follow: 'following' }])
  })
})
