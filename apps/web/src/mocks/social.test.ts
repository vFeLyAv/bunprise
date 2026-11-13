import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../lib/database.types'
import type { FeedScreen, MyReservation, OccasionScreen } from '../lib/api/types'
import { LEGAL_VERSIONS } from '../lib/legal'
import { dayKey, daysUntil, zonedWallTimeToIso } from '../lib/time'
import {
  createDemoHandlers,
  DEMO_CODE,
  DEMO_INVITE_TOKEN,
  DEMO_OCCASIONS,
  DEMO_PEOPLE,
  DEMO_RESERVED_WISH_ID,
  DEMO_SUPABASE_URL,
} from './handlers'
import { DEMO_COVER_SIZE } from './photos'

// The shared demo world through the real supabase-js client: several accounts at once (one client
// each, like separate phones), exactly the requests the app's API wrappers send.

const DAY = 86_400_000
// + photo (20261025130000: the cover's meta for Start, null without one)
// + sections (20261025150000: what the occasion offers — a column of the occasion, never about reservations)
// 20261026180000: + ends_at (null without an end)
const FEED_KEYS = ['all_day', 'cover_theme', 'ends_at', 'host_id', 'host_name', 'id', 'member_count', 'my_reservation_count', 'photo', 'place_text', 'role', 'rsvp', 'sections', 'starts_at', 'title', 'tz', 'wish_count']
// + the wish details (20261022120000): about the wish only, never about reservations
// + received_at (20261022160000: "Erhalten"; open wishes: null)
// 20261027200000: + also_in (a guest's hint where else the wish lives)
// + quantity and together (20261030120000)
const WISH_KEYS = ['also_in', 'brand', 'color', 'created_at', 'currency', 'description', 'gtin', 'id', 'note', 'photo', 'price_cents', 'priority', 'quantity', 'received_at', 'reserved', 'reserved_by_me', 'shop_name', 'title', 'together', 'url']
// wave 2b (follows-design §5.5, M3): + `list` — the list without an occasion while readable, else null
const MY_RESERVATION_KEYS = ['created_at', 'end_reason', 'list', 'occasion_id', 'occasion_title', 'received_at', 'starts_at', 'status', 'wish_id', 'wish_title']
/** "Kinogutschein" in "Annas Einweihung": free at the start */
const FREE_WISH = 'd1e0d000-0000-4000-8000-000000000103'

const server = setupServer()
let clientCount = 0

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => server.resetHandlers(...createDemoHandlers()))
afterAll(() => server.close())

type Rpc = keyof Database['public']['Functions']

interface Account {
  client: SupabaseClient<Database>
  id: string
  token: string
}

interface Hosted {
  occasionId: string
  wishlistId: string
  /** "Kopfhörer" (3), "Buch" (1), "Tasse" (2) in creation order */
  wishIds: string[]
}

async function consent(who: Account): Promise<void> {
  const rows = Object.entries(LEGAL_VERSIONS).map(([kind, version]) => ({ profile_id: who.id, kind, version, locale: 'de' }))
  expect((await who.client.from('consents').upsert(rows, { ignoreDuplicates: true })).error).toBeNull()
}

/** Sign-up with code + profile name + legal records, like /login → /login/code → /welcome/profile. */
async function account(email: string, name: string | null = 'Mila', { consents = true } = {}): Promise<Account> {
  const client = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `demo-world-${clientCount++}` },
  })
  expect((await client.auth.signInWithOtp({ email })).error).toBeNull()
  const verified = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  expect(verified.error).toBeNull()
  const session = verified.data.session!
  const who = { client, id: session.user.id, token: session.access_token }
  if (name !== null) expect((await client.from('profiles').update({ display_name: name }).eq('id', who.id)).error).toBeNull()
  if (consents) await consent(who)
  return who
}

async function rpc<T = unknown>(who: Account, fn: Rpc, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await who.client.rpc(fn, args as never)
  expect(error, `${fn}: ${JSON.stringify(error)}`).toBeNull()
  return data as T
}

/** The PostgREST error object of a failing RPC (what lib/errors.ts maps to errors.<code>). */
async function rpcError(who: Account, fn: Rpc, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await who.client.rpc(fn, args as never)
  expect(data).toBeNull()
  return error
}

const raised = (code: string) => expect.objectContaining({ code: 'P0001', message: code })
const screen = (who: Account, occasionId: string) => rpc<OccasionScreen>(who, 'get_occasion_screen', { p_occasion_id: occasionId })
const feed = (who: Account) => rpc<FeedScreen>(who, 'get_feed')
const reservations = (who: Account) => rpc<MyReservation[]>(who, 'my_reservations')

/** The raw response text (for byte-identity checks). */
async function raw(who: Account, fn: Rpc, args: Record<string, unknown> = {}): Promise<string> {
  const response = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args),
  })
  expect(response.status).toBe(200)
  return response.text()
}

async function rest(who: Account, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${DEMO_SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** The PostgREST error code of a REST call, or its status when it succeeded. */
async function restCode(who: Account, method: string, path: string, body?: unknown): Promise<string | number> {
  const response = await rest(who, method, path, body)
  return response.ok ? response.status : ((await response.json()) as { code: string }).code
}

/** The host's own occasion with three wishes — like S6 + S8. */
async function host(who: Account, title = 'Milas Geburtstag'): Promise<Hosted> {
  const occasionId = crypto.randomUUID()
  const created = await who.client.from('occasions')
    .insert({ id: occasionId, host_id: who.id, title, starts_at: new Date(Date.now() + 20 * DAY).toISOString(), tz: 'Europe/Berlin', all_day: true, place_text: 'Stadtpark' })
    .select('id')
    .single()
  expect(created.error).toBeNull()
  expect(created.data).toEqual({ id: occasionId })
  const wishlistId = (await screen(who, occasionId)).wishlist!.id
  const wishIds: string[] = []
  for (const [wishTitle, priority] of [['Kopfhörer', 3], ['Buch', 1], ['Tasse', 2]] as const) {
    const wish = await who.client.from('wishes').insert({ wishlist_id: wishlistId, title: wishTitle, priority }).select('id').single()
    expect(wish.error).toBeNull()
    wishIds.push(wish.data!.id)
  }
  return { occasionId, wishlistId, wishIds }
}

const invite = async (who: Account, occasionId: string): Promise<string> =>
  (await rpc<{ token: string }>(who, 'create_invite', { p_occasion_id: occasionId })).token
const join = async (who: Account, token: string): Promise<string> =>
  (await rpc<{ occasion_id: string }>(who, 'accept_invite', { p_token: token })).occasion_id

describe('demo feed', () => {
  it('stays empty until the profile is complete, then shows "Annas Einweihung" as a guest', async () => {
    const mila = await account('mila@example.test', null, { consents: false })
    expect(await feed(mila)).toEqual({ upcoming: [], past: [] })
    await consent(mila)
    expect(await feed(mila)).toEqual({ upcoming: [], past: [] }) // the name is still missing
    expect((await mila.client.from('profiles').update({ display_name: 'Mila' }).eq('id', mila.id)).error).toBeNull()
    const { upcoming, past } = await feed(mila)
    expect(past).toEqual([])
    expect(upcoming).toHaveLength(1)
    expect(Object.keys(upcoming[0]!).sort()).toEqual(FEED_KEYS)
    expect(upcoming[0]).toEqual({
      id: DEMO_OCCASIONS.housewarming, title: 'Annas Einweihung', starts_at: expect.any(String), ends_at: null, tz: 'Europe/Berlin', all_day: false,
      place_text: 'Café am Markt', role: 'member', rsvp: 'none', host_id: DEMO_PEOPLE.anna.id, host_name: 'Anna Beispiel', member_count: 4, wish_count: 8, my_reservation_count: 0, // 20261027200000: + 2 shared wishes (mocks/lists.ts)
      // "Annas Einweihung" starts with the demo cover (src/mocks/photos.ts): its meta, never the bytes
      photo: { ...DEMO_COVER_SIZE, updated_at: expect.any(String) },
      // the demo seed: wishes and the bring-along list (mocks/fixtures.ts)
      sections: 'both',
      // 20261027140000: no cover motif in the seed (it has a photo anyway)
      cover_theme: null,
    })
    expect(daysUntil(upcoming[0]!.starts_at, { timeZone: 'Europe/Berlin' })).toBe(3)
    // "Bens Grillabend" stays closed until an explicit Beitreten
    expect(await rpcError(mila, 'get_occasion_screen', { p_occasion_id: DEMO_OCCASIONS.barbecue })).toEqual(raised('not_found'))
  })

  it('splits upcoming / past by the end of the day in the occasion zone; host rows never carry a count', async () => {
    const mila = await account('mila@example.test')
    const add = async (title: string, startsAt: string, extra: { all_day?: boolean; ends_at?: string } = {}): Promise<string> => {
      const result = await mila.client.from('occasions')
        .insert({ host_id: mila.id, title, starts_at: startsAt, tz: 'Europe/Berlin', all_day: true, ...extra })
        .select('id')
        .single()
      expect(result.error).toBeNull()
      return result.data!.id
    }
    const today = await add('Heute', zonedWallTimeToIso(dayKey(new Date(), 'Europe/Berlin'), null, 'Europe/Berlin'))
    const inTenDays = await add('In zehn Tagen', new Date(Date.now() + 10 * DAY).toISOString())
    const twoDaysAgo = await add('Vor zwei Tagen', new Date(Date.now() - 2 * DAY).toISOString(),
      { all_day: false, ends_at: new Date(Date.now() - 2 * DAY + 3_600_000).toISOString() })
    const fiveDaysAgo = await add('Vor fünf Tagen', new Date(Date.now() - 5 * DAY).toISOString())
    await add('Vor vierzig Tagen', new Date(Date.now() - 40 * DAY).toISOString())
    const result = await feed(mila)
    expect(result.upcoming.map((row) => row.id)).toEqual([today, DEMO_OCCASIONS.housewarming, inTenDays])
    expect(result.past.map((row) => row.id)).toEqual([twoDaysAgo, fiveDaysAgo])
    for (const row of [...result.upcoming, ...result.past]) expect(row.my_reservation_count).toBe(row.role === 'host' ? null : 0)
  })
})

describe('demo occasion screen', () => {
  it('guest view of "Annas Einweihung": sorted by priority, one anonymous "Reserviert"', async () => {
    const mila = await account('mila@example.test')
    const text = await raw(mila, 'get_occasion_screen', { p_occasion_id: DEMO_OCCASIONS.housewarming })
    const view = JSON.parse(text) as OccasionScreen
    // + potluck (20261025150000): the demo's housewarming offers wishes AND the bring-along list
    expect(Object.keys(view).sort()).toEqual(['invite', 'members', 'occasion', 'potluck', 'viewer', 'wishlist'])
    expect(view.potluck?.items.map((item) => [item.title, item.claimed, item.claimed_by_me, item.bringer?.profile_id ?? null, item.can_edit, item.can_delete])).toEqual([
      ['Sekt zum Anstoßen', true, false, DEMO_PEOPLE.anna.id, false, false],
      ['Knabberzeug', false, false, null, false, false],
      ['Musikbox', true, false, DEMO_PEOPLE.clara.id, false, false],
    ])
    expect(view.occasion).toMatchObject({
      id: DEMO_OCCASIONS.housewarming, title: 'Annas Einweihung', place_text: 'Café am Markt', all_day: false, sections: 'both',
      host: { id: DEMO_PEOPLE.anna.id, display_name: 'Anna Beispiel' },
    })
    expect(view.viewer).toEqual({ role: 'member', rsvp: 'none' })
    expect(view.invite).toBeNull()
    // 20261024120000: + each member's profile photo meta (Anna has an invented demo photo, the others none)
    const annaPhoto = { width: 512, height: 512, updated_at: expect.any(String) }
    expect(view.occasion.host.photo).toEqual(annaPhoto)
    expect(view.members).toEqual([
      { profile_id: DEMO_PEOPLE.anna.id, display_name: 'Anna Beispiel', role: 'host', rsvp: 'going', photo: annaPhoto },
      { profile_id: DEMO_PEOPLE.ben.id, display_name: 'Ben Mustermann', role: 'member', rsvp: 'going', photo: null },
      { profile_id: DEMO_PEOPLE.clara.id, display_name: 'Clara Test', role: 'member', rsvp: 'maybe', photo: null },
      { profile_id: mila.id, display_name: 'Mila', role: 'member', rsvp: 'none', photo: null },
    ])
    const wishes = view.wishlist!.wishes
    // 20261027200000: + Anna's plant stand (2) and diary (1), which live in her other lists too (mocks/lists.ts)
    expect(wishes.map((wish) => wish.priority)).toEqual([3, 3, 2, 2, 2, 1, 1, 1])
    for (const wish of wishes) expect(Object.keys(wish).sort()).toEqual(WISH_KEYS)
    expect(wishes.filter((wish) => wish.reserved).map((wish) => [wish.id, wish.title, wish.reserved_by_me]))
      .toEqual([[DEMO_RESERVED_WISH_ID, 'Kaffeemühle mit Handkurbel', false]])
    // who reserved is nobody's business: Ben appears exactly once — as a member
    expect(text).not.toContain('reserved_by_name')
    expect(text.split(DEMO_PEOPLE.ben.id)).toHaveLength(2)
  })

  it('answers outsiders, unknown and malformed ids like the database', async () => {
    const mila = await account('mila@example.test')
    expect(await rpcError(mila, 'get_occasion_screen', { p_occasion_id: DEMO_OCCASIONS.barbecue })).toEqual(raised('not_found'))
    expect(await rpcError(mila, 'get_occasion_screen', { p_occasion_id: '00000000-0000-4000-8000-000000000000' })).toEqual(raised('not_found'))
    expect(await rpcError(mila, 'get_occasion_screen', { p_occasion_id: 'not-a-uuid' })).toMatchObject({ code: '22P02' })
    expect(await rpcError(mila, 'get_occasion_screen', {})).toMatchObject({ code: 'PGRST202' })
    const anonymous = await fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/get_occasion_screen`, {
      method: 'POST', body: JSON.stringify({ p_occasion_id: DEMO_OCCASIONS.housewarming }),
    })
    expect(anonymous.status).toBe(401)
  })

  it('host view: reservation keys present but null; the invite shows only its expiry, never the token', async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishIds } = await host(mila)
    const before = await screen(mila, occasionId)
    expect(before.viewer).toEqual({ role: 'host', rsvp: 'going' })
    expect(before.members).toEqual([{ profile_id: mila.id, display_name: 'Mila', role: 'host', rsvp: 'going', photo: null }])
    expect(before.invite).toBeNull()
    expect(before.wishlist).toMatchObject({ owner_id: mila.id, title: 'Milas Geburtstag' })
    expect(before.wishlist!.wishes.map((wish) => [wish.id, wish.reserved, wish.reserved_by_me]))
      .toEqual([[wishIds[0], null, null], [wishIds[2], null, null], [wishIds[1], null, null]])
    const token = await invite(mila, occasionId)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const after = await raw(mila, 'get_occasion_screen', { p_occasion_id: occasionId })
    expect((JSON.parse(after) as OccasionScreen).invite).toEqual({ active: true, expires_at: expect.any(String) })
    expect(after).not.toContain(token)
    const jonas = await account('jonas@example.test', 'Jonas')
    expect(await join(jonas, token)).toBe(occasionId)
    const guest = await screen(jonas, occasionId)
    expect(guest.invite).toBeNull()
    expect(guest.viewer).toEqual({ role: 'member', rsvp: 'none' })
    expect(guest.wishlist!.wishes.every((wish) => wish.reserved === false && wish.reserved_by_me === false)).toBe(true)
  })

  it("keeps the host's screen, feed and export byte-identical whatever guests reserve", async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishIds } = await host(mila)
    const token = await invite(mila, occasionId)
    const jonas = await account('jonas@example.test', 'Jonas')
    const lea = await account('lea@example.test', 'Lea')
    await join(jonas, token)
    await join(lea, token)
    const hostSide = async (): Promise<string[]> => {
      const exported = JSON.parse(await raw(mila, 'export_my_data')) as Record<string, unknown>
      return [await raw(mila, 'get_occasion_screen', { p_occasion_id: occasionId }), await raw(mila, 'get_feed'), JSON.stringify({ ...exported, exported_at: null })]
    }
    const before = await hostSide()
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[0] })
    await rpc(lea, 'reserve_wish', { p_wish_id: wishIds[1] })
    await rpc(lea, 'reserve_wish', { p_wish_id: wishIds[2] })
    expect(await hostSide()).toEqual(before)
    await rpc(jonas, 'cancel_reservation', { p_wish_id: wishIds[0] })
    await rpc(lea, 'reserve_wish', { p_wish_id: wishIds[0] })
    expect(await hostSide()).toEqual(before)
    const screenText = before[0]!
    expect(screenText.match(/reserv/g)).toHaveLength(6) // 3 wishes × 2 null-valued keys
    expect(screenText.split(jonas.id)).toHaveLength(2) // once, as a member — never as a reserver
  })
})

describe('demo reservations', () => {
  it('two guests racing for one wish: exactly one wins, the other hears already_reserved', async () => {
    const mila = await account('mila@example.test')
    const jonas = await account('jonas@example.test', 'Jonas')
    const results = await Promise.all([mila, jonas].map((who) => who.client.rpc('reserve_wish', { p_wish_id: FREE_WISH })))
    expect(results.filter((result) => result.error === null).map((result) => result.data)).toEqual([{ ok: true }])
    expect(results.filter((result) => result.error !== null).map((result) => result.error)).toEqual([raised('already_reserved')])
    const winner = results[0]!.error === null ? mila : jonas
    const loser = winner === mila ? jonas : mila
    const flags = async (who: Account) => (await screen(who, DEMO_OCCASIONS.housewarming)).wishlist!.wishes.find((wish) => wish.id === FREE_WISH)
    expect(await flags(winner)).toMatchObject({ reserved: true, reserved_by_me: true })
    expect(await flags(loser)).toMatchObject({ reserved: true, reserved_by_me: false })
    expect((await feed(winner)).upcoming[0]!.my_reservation_count).toBe(1)
    expect((await feed(loser)).upcoming[0]!.my_reservation_count).toBe(0)
    expect(await rpcError(loser, 'reserve_wish', { p_wish_id: FREE_WISH })).toEqual(raised('already_reserved'))
    expect(await rpc(winner, 'reserve_wish', { p_wish_id: FREE_WISH })).toEqual({ ok: true }) // the same person again
    expect((await reservations(winner)).filter((entry) => entry.wish_id === FREE_WISH)).toHaveLength(1)
    // Ben's seeded reservation counts just the same
    expect(await rpcError(loser, 'reserve_wish', { p_wish_id: DEMO_RESERVED_WISH_ID })).toEqual(raised('already_reserved'))
  })

  it('the list owner and an outsider get the same not_allowed, with and without a reservation', async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishIds } = await host(mila)
    const outsider = await account('ole@example.test', 'Ole')
    const jonas = await account('jonas@example.test', 'Jonas')
    await join(jonas, await invite(mila, occasionId))
    const target = { p_wish_id: wishIds[0] }
    const ownerFree = await rpcError(mila, 'reserve_wish', target)
    expect(ownerFree).toEqual(raised('not_allowed'))
    expect(await rpcError(outsider, 'reserve_wish', target)).toEqual(ownerFree)
    await rpc(jonas, 'reserve_wish', target)
    expect(await rpcError(mila, 'reserve_wish', target)).toEqual(ownerFree)
    expect(await rpcError(outsider, 'reserve_wish', target)).toEqual(ownerFree)
    expect(await rpcError(mila, 'cancel_reservation', target)).toEqual(ownerFree)
    expect(await rpcError(outsider, 'cancel_reservation', target)).toEqual(ownerFree)
    expect(await rpcError(jonas, 'reserve_wish', { p_wish_id: '00000000-0000-4000-8000-000000000000' })).toEqual(raised('not_found'))
    // another member without an own reservation: not_found, whatever others hold
    const lea = await account('lea@example.test', 'Lea')
    await join(lea, await invite(mila, occasionId))
    expect(await rpcError(lea, 'cancel_reservation', target)).toEqual(raised('not_found'))
    expect(await rpc(jonas, 'cancel_reservation', target)).toEqual({ ok: true })
    expect(await rpcError(jonas, 'cancel_reservation', target)).toEqual(raised('not_found'))
    expect(await rpc(lea, 'reserve_wish', target)).toEqual({ ok: true })
  })

  it('my_reservations lists only own ones; a deleted wish ends as wish_deleted under its old title', async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishIds } = await host(mila)
    const jonas = await account('jonas@example.test', 'Jonas')
    await join(jonas, await invite(mila, occasionId))
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[0] })
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[1] })
    const mine = await reservations(jonas)
    expect(mine).toHaveLength(2)
    for (const entry of mine) expect(Object.keys(entry).sort()).toEqual(MY_RESERVATION_KEYS)
    expect(mine.find((entry) => entry.wish_id === wishIds[0])).toMatchObject({
      wish_title: 'Kopfhörer', occasion_id: occasionId, occasion_title: 'Milas Geburtstag', status: 'active', end_reason: null,
    })
    expect(await reservations(mila)).toEqual([])
    // the host deletes a reserved and a free wish: the same answer, nothing to tell them apart
    expect([await restCode(mila, 'DELETE', `wishes?id=eq.${wishIds[0]}`), await restCode(mila, 'DELETE', `wishes?id=eq.${wishIds[2]}`)]).toEqual([204, 204])
    expect(await reservations(jonas)).toEqual([
      expect.objectContaining({ wish_id: wishIds[1], status: 'active' }),
      // 20261027200000 (Q1): a reservation that is not live has no context and one neutral reason
      expect.objectContaining({ wish_id: null, wish_title: 'Kopfhörer', occasion_title: null, status: 'ended', end_reason: 'unavailable' }),
    ])
    // own cancellations disappear from the list
    await rpc(jonas, 'cancel_reservation', { p_wish_id: wishIds[1] })
    expect((await reservations(jonas)).map((entry) => entry.end_reason)).toEqual(['unavailable'])
  })
})

describe('demo invites and Beitreten', () => {
  it('the fixed demo link joins "Bens Grillabend" only through accept_invite, after name and legal records', async () => {
    const mila = await account('mila@example.test', null, { consents: false })
    const accept = { p_token: DEMO_INVITE_TOKEN }
    expect(await rpcError(mila, 'accept_invite', accept)).toEqual(raised('consent_required'))
    await consent(mila)
    expect(await rpcError(mila, 'accept_invite', accept)).toEqual(raised('profile_incomplete'))
    await mila.client.from('profiles').update({ display_name: 'Mila' }).eq('id', mila.id)
    expect((await feed(mila)).upcoming.map((row) => row.id)).toEqual([DEMO_OCCASIONS.housewarming]) // no automatic join
    expect(await rpc(mila, 'accept_invite', accept)).toEqual({ occasion_id: DEMO_OCCASIONS.barbecue })
    expect(await rpc(mila, 'accept_invite', accept)).toEqual({ occasion_id: DEMO_OCCASIONS.barbecue }) // members: same answer
    const view = await screen(mila, DEMO_OCCASIONS.barbecue)
    expect(view.viewer).toEqual({ role: 'member', rsvp: 'none' })
    expect(view.occasion.host).toEqual({ id: DEMO_PEOPLE.ben.id, display_name: 'Ben Mustermann', photo: null })
    expect(view.members.map((member) => member.display_name)).toEqual(['Ben Mustermann', 'Anna Beispiel', 'Clara Test', 'Mila'])
    expect(view.wishlist!.wishes.map((wish) => [wish.priority, wish.reserved])).toEqual([[3, false], [2, false], [2, false], [1, false]])
    const upcoming = (await feed(mila)).upcoming
    expect(upcoming.map((row) => row.id)).toEqual([DEMO_OCCASIONS.housewarming, DEMO_OCCASIONS.barbecue])
    expect(daysUntil(upcoming[1]!.starts_at, { timeZone: 'Europe/Berlin' })).toBe(30)
    for (const token of ['nope', '0'.repeat(64), null]) {
      expect(await rpcError(mila, 'accept_invite', { p_token: token })).toEqual(raised('invite_invalid'))
    }
  })

  it('a new link revokes the older one; only the host creates links or reads their metadata', async () => {
    const mila = await account('mila@example.test')
    const { occasionId } = await host(mila)
    const first = await invite(mila, occasionId)
    const second = await invite(mila, occasionId)
    const jonas = await account('jonas@example.test', 'Jonas')
    expect(await rpcError(jonas, 'accept_invite', { p_token: first })).toEqual(raised('invite_invalid'))
    expect(await join(jonas, second)).toBe(occasionId)
    const links = await mila.client.from('invites')
      .select('id, occasion_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at')
      .eq('occasion_id', occasionId)
      .order('created_at', { ascending: false })
    expect(links.error).toBeNull()
    expect(links.data!.map((link) => [link.use_count, link.max_uses, link.revoked_at === null])).toEqual([[1, 50, true], [0, 50, false]])
    expect(JSON.stringify(links.data)).not.toContain(second)
    expect((await mila.client.from('invites').select('token_hash')).error?.code).toBe('42501')
    expect((await mila.client.from('invites').select('*')).error?.code).toBe('42501')
    expect(await restCode(mila, 'POST', 'invites', { occasion_id: occasionId, created_by: mila.id, expires_at: new Date().toISOString() })).toBe('42501')
    // members and outsiders: no links, not even metadata
    expect((await jonas.client.from('invites').select('id').eq('occasion_id', occasionId)).data).toEqual([])
    expect(await rpcError(jonas, 'create_invite', { p_occasion_id: occasionId })).toEqual(raised('not_found'))
    expect(await rpcError(jonas, 'create_invite', { p_occasion_id: DEMO_OCCASIONS.housewarming })).toEqual(raised('not_found'))
    // a manual revocation is final
    const activeId = links.data![0]!.id
    expect((await mila.client.from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', activeId)).error).toBeNull()
    expect((await screen(mila, occasionId)).invite).toBeNull()
    expect((await mila.client.from('invites').update({ revoked_at: null }).eq('id', activeId)).error).toEqual(raised('not_allowed'))
    const lea = await account('lea@example.test', 'Lea')
    expect(await rpcError(lea, 'accept_invite', { p_token: second })).toEqual(raised('invite_invalid'))
    expect((await screen(jonas, occasionId)).viewer.role).toBe('member') // members stay
  })

  it('"left" comes back with the same link; a removed guest only with a newer one', async () => {
    const mila = await account('mila@example.test')
    const { occasionId } = await host(mila)
    const link = await invite(mila, occasionId)
    const jonas = await account('jonas@example.test', 'Jonas')
    await join(jonas, link)
    await jonas.client.from('occasion_members').update({ rsvp: 'going' }).eq('occasion_id', occasionId).eq('profile_id', jonas.id)
    expect(await rpc(jonas, 'leave_occasion', { p_occasion_id: occasionId })).toEqual({ ok: true })
    expect(await rpcError(jonas, 'get_occasion_screen', { p_occasion_id: occasionId })).toEqual(raised('not_found'))
    expect(await rpcError(jonas, 'leave_occasion', { p_occasion_id: occasionId })).toEqual(raised('not_found'))
    expect(await join(jonas, link)).toBe(occasionId)
    expect((await screen(jonas, occasionId)).viewer).toEqual({ role: 'member', rsvp: 'none' })
    expect(await rpc(mila, 'remove_member', { p_occasion_id: occasionId, p_profile_id: jonas.id })).toEqual({ ok: true })
    expect(await rpcError(jonas, 'get_occasion_screen', { p_occasion_id: occasionId })).toEqual(raised('not_found'))
    expect(await rpcError(jonas, 'accept_invite', { p_token: link })).toEqual(raised('invite_invalid'))
    expect(await join(jonas, await invite(mila, occasionId))).toBe(occasionId)
    // the host deletes instead of leaving; only the host removes, and only members
    expect(await rpcError(mila, 'leave_occasion', { p_occasion_id: occasionId })).toEqual(raised('not_allowed'))
    expect(await rpcError(jonas, 'remove_member', { p_occasion_id: occasionId, p_profile_id: mila.id })).toEqual(raised('not_found'))
    expect(await rpcError(mila, 'remove_member', { p_occasion_id: occasionId, p_profile_id: mila.id })).toEqual(raised('not_found'))
  })

  it('a cancelled occasion: the old link answers like an unknown one (20261026190000)', async () => {
    const mila = await account('mila@example.test')
    const { occasionId } = await host(mila)
    const link = await invite(mila, occasionId)
    expect((await mila.client.from('occasions').update({ cancelled_at: new Date().toISOString() }).eq('id', occasionId)).error).toBeNull()
    const jonas = await account('jonas@example.test', 'Jonas')
    const cancelled = await rpcError(jonas, 'accept_invite', { p_token: link })
    expect(cancelled).toEqual(raised('invite_invalid'))
    expect(cancelled).toEqual(await rpcError(jonas, 'accept_invite', { p_token: '0'.repeat(64) }))
    expect(await rpcError(jonas, 'get_occasion_screen', { p_occasion_id: occasionId })).toEqual(raised('not_found'))
    // taken back: the link works again
    expect((await mila.client.from('occasions').update({ cancelled_at: null }).eq('id', occasionId)).error).toBeNull()
    expect(await join(jonas, link)).toBe(occasionId)
  })

  it("remove_member revokes every link and ends the removed guest's reservations silently", async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishIds } = await host(mila)
    const link = await invite(mila, occasionId)
    const jonas = await account('jonas@example.test', 'Jonas')
    const lea = await account('lea@example.test', 'Lea')
    await join(jonas, link)
    await join(lea, link)
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[0] })
    const hostBefore = await screen(mila, occasionId)
    await rpc(mila, 'remove_member', { p_occasion_id: occasionId, p_profile_id: jonas.id })
    const hostAfter = await screen(mila, occasionId)
    expect(hostAfter.members.map((member) => member.profile_id)).toEqual([mila.id, lea.id])
    expect(hostAfter.wishlist).toEqual(hostBefore.wishlist) // still only nulls, same order
    expect(hostAfter.invite).toBeNull()
    expect((await mila.client.from('invites').select('revoked_at').eq('occasion_id', occasionId)).data!.every((row) => row.revoked_at !== null)).toBe(true)
    const ole = await account('ole@example.test', 'Ole')
    expect(await rpcError(ole, 'accept_invite', { p_token: link })).toEqual(raised('invite_invalid'))
    expect((await reservations(jonas)).map((entry) => [entry.status, entry.end_reason, entry.occasion_title])).toEqual([['ended', 'unavailable', null]]) // Q1: one neutral reason
    expect(await rpc(lea, 'reserve_wish', { p_wish_id: wishIds[0] })).toEqual({ ok: true })
    // REST: the host sees the removed row, the other member does not, the removed guest only their own
    const memberRows = async (who: Account) => (await who.client.from('occasion_members').select('profile_id, status').eq('occasion_id', occasionId)).data
    expect(await memberRows(mila)).toHaveLength(3)
    expect(await memberRows(lea)).toHaveLength(2)
    expect(await memberRows(jonas)).toEqual([{ profile_id: jonas.id, status: 'removed' }])
  })
})

describe('demo REST mirrors grants and RLS', () => {
  it('reservations have no REST access at all — not even a count', async () => {
    const mila = await account('mila@example.test')
    for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']) {
      const response = await rest(mila, method, 'reservations?select=*', ['GET', 'HEAD'].includes(method) ? undefined : {})
      expect(response.status, method).toBe(403)
    }
    expect((await mila.client.from('reservations').select('id')).error?.code).toBe('42501')
    const counted = await mila.client.from('reservations').select('*', { count: 'exact', head: true })
    expect(counted.status).toBe(403)
    expect(counted.count).toBeNull()
  })

  it('wishes: members read, only the owner writes; the checks mirror the database', async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishlistId, wishIds } = await host(mila)
    const jonas = await account('jonas@example.test', 'Jonas')
    await join(jonas, await invite(mila, occasionId))
    const outsider = await account('ole@example.test', 'Ole')
    const listed = await jonas.client.from('wishes').select('id, wishlist_id, title, price_cents, currency, url, note, priority, created_at').eq('wishlist_id', wishlistId)
    expect(listed.data).toHaveLength(3)
    expect((await outsider.client.from('wishes').select('id').eq('wishlist_id', wishlistId)).data).toEqual([])
    // a member cannot write: the insert is refused, update/delete find no row of theirs
    expect((await jonas.client.from('wishes').insert({ wishlist_id: wishlistId, title: 'Untergeschoben' })).error?.code).toBe('42501')
    expect((await jonas.client.from('wishes').update({ title: 'Geändert' }).eq('id', wishIds[0]!).select('id').single()).error?.code).toBe('PGRST116')
    expect((await jonas.client.from('wishes').delete().eq('id', wishIds[0]!)).error).toBeNull()
    expect((await mila.client.from('wishes').select('title').eq('id', wishIds[0]!).single()).data).toEqual({ title: 'Kopfhörer' })
    // a reservation never touches the wish row; only the owner's edit bumps updated_at. Since wave 2b M1 updated_at
    // is not REST-readable (P9, like the server: 42501), so the stamp comes from the owner's export
    // (the database twin of this check: packages/db-tests/test/pilot/rpc-reservations.test.ts, as superuser)
    expect((await mila.client.from('wishes').select('updated_at').eq('id', wishIds[0]!).single()).error?.code).toBe('42501')
    const stamp = async () => {
      const exported = await rpc<{ wishlists: { wishes: { id: string; updated_at: string }[] }[] }>(mila, 'export_my_data')
      return exported.wishlists.flatMap((list) => list.wishes).find((wish) => wish.id === wishIds[0])!.updated_at
    }
    const before = await stamp()
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[0] })
    expect(await stamp()).toBe(before)
    const edited = await mila.client.from('wishes').update({ price_cents: 5990 }).eq('id', wishIds[0]!).select('id, price_cents').single()
    expect(edited.data).toMatchObject({ id: wishIds[0], price_cents: 5990 })
    expect(await stamp()).not.toBe(before)
    const cases: [Record<string, unknown>, string][] = [
      [{ currency: 'USD' }, '23514'], [{ url: 'javascript:alert(1)' }, '23514'], [{ title: '   ' }, '23514'], [{ title: 'x'.repeat(121) }, '23514'],
      [{ note: 'x'.repeat(501) }, '23514'], [{ priority: 5 }, '23514'], [{ price_cents: 1.5 }, '22P02'], [{ title: null }, '23502'],
      [{ wishlist_id: wishlistId }, '42501'], [{ shop: 'x' }, 'PGRST204'],
    ]
    for (const [patch, code] of cases) {
      expect(await restCode(mila, 'PATCH', `wishes?id=eq.${wishIds[1]}`, patch), JSON.stringify(patch)).toBe(code)
    }
    expect((await mila.client.from('wishes').select('title, priority').eq('id', wishIds[1]!).single()).data).toEqual({ title: 'Buch', priority: 1 })
  })

  it('wishes embed their list row (deep link into the edit form): readable like the wish, never on a write', async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishlistId, wishIds } = await host(mila)
    const jonas = await account('jonas@example.test', 'Jonas')
    await join(jonas, await invite(mila, occasionId))
    const outsider = await account('ole@example.test', 'Ole')
    const select = 'id, wishlist_id, title, wishlist:wishlists(id, occasion_id, owner_id)'
    const expected = { id: wishIds[0], wishlist_id: wishlistId, title: 'Kopfhörer', wishlist: { id: wishlistId, occasion_id: occasionId, owner_id: mila.id } }
    expect((await mila.client.from('wishes').select(select).eq('id', wishIds[0]!).single()).data).toEqual(expected)
    expect((await jonas.client.from('wishes').select(select).eq('id', wishIds[0]!).single()).data).toEqual(expected)
    expect((await outsider.client.from('wishes').select(select).eq('id', wishIds[0]!).single()).error?.code).toBe('PGRST116')
    // a write with an embed would come back without it in the demo: refused, nothing written
    const write = await mila.client.from('wishes').update({ note: 'Geändert' }).eq('id', wishIds[0]!).select('id, wishlist:wishlists(id)').single()
    expect(write.error?.code).toBe('demo_not_implemented')
    expect((await mila.client.from('wishes').select('note').eq('id', wishIds[0]!).single()).data).toEqual({ note: null })
  })

  it('occasions: creating needs a name and legal records; members can neither edit nor delete', async () => {
    const draft = { title: 'Feier', starts_at: new Date(Date.now() + 5 * DAY).toISOString(), tz: 'Europe/Berlin', all_day: true }
    const unfinished = await account('neu@example.test', null)
    expect((await unfinished.client.from('occasions').insert({ ...draft, host_id: unfinished.id })).error?.code).toBe('42501')
    const mila = await account('mila@example.test')
    const cases: [Record<string, unknown>, string][] = [
      [{ title: '' }, '23514'], [{ title: 'x'.repeat(81) }, '23514'], [{ place_text: 'x'.repeat(201) }, '23514'],
      [{ description: 'x'.repeat(501) }, '23514'], [{ tz: 'Mars/Olympus_Mons' }, 'P0001'], [{ host_id: DEMO_PEOPLE.anna.id }, '42501'],
      [{ starts_at: 'bald' }, '22007'], [{ all_day: 'ja' }, '22P02'],
    ]
    for (const [patch, code] of cases) {
      expect(await restCode(mila, 'POST', 'occasions', { ...draft, host_id: mila.id, ...patch }), JSON.stringify(patch)).toBe(code)
    }
    expect((await mila.client.from('occasions').select('id')).data).toEqual([{ id: DEMO_OCCASIONS.housewarming }]) // nothing half-created
    const { occasionId, wishIds } = await host(mila)
    expect(await restCode(mila, 'POST', 'occasions', { ...draft, id: occasionId, host_id: mila.id })).toBe('23505')
    // the trigger made the host a member and created THE list
    expect((await mila.client.from('occasion_members').select('role, rsvp, status').eq('occasion_id', occasionId)).data).toEqual([{ role: 'host', rsvp: 'going', status: 'active' }])
    expect((await mila.client.from('wishlists').select('owner_id, recipient_id, title').eq('occasion_id', occasionId)).data)
      .toEqual([{ owner_id: mila.id, recipient_id: mila.id, title: 'Milas Geburtstag' }])
    const jonas = await account('jonas@example.test', 'Jonas')
    await join(jonas, await invite(mila, occasionId))
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[0] })
    expect((await jonas.client.from('occasions').select('id, title').eq('id', occasionId).single()).data).toEqual({ id: occasionId, title: 'Milas Geburtstag' })
    expect((await jonas.client.from('occasions').update({ title: 'Übernommen' }).eq('id', occasionId).select('id').single()).error?.code).toBe('PGRST116')
    expect((await jonas.client.from('occasions').delete().eq('id', occasionId)).error).toBeNull()
    expect(await restCode(mila, 'PATCH', `occasions?id=eq.${occasionId}`, { host_id: jonas.id })).toBe('42501')
    const renamed = await mila.client.from('occasions').update({ title: 'Milas 30.', place_text: null }).eq('id', occasionId).select('id, title, place_text').single()
    expect(renamed.data).toEqual({ id: occasionId, title: 'Milas 30.', place_text: null })
    // the host deletes: everything cascades; the reserver keeps only the title snapshot
    expect((await mila.client.from('occasions').delete().eq('id', occasionId)).error).toBeNull()
    expect(await rpcError(jonas, 'get_occasion_screen', { p_occasion_id: occasionId })).toEqual(raised('not_found'))
    expect((await feed(jonas)).upcoming.map((row) => row.id)).toEqual([DEMO_OCCASIONS.housewarming])
    expect(await reservations(jonas)).toEqual([expect.objectContaining({
      wish_id: null, wish_title: 'Kopfhörer', occasion_id: null, occasion_title: null, starts_at: null, status: 'ended', end_reason: 'unavailable',
    })])
    expect((await mila.client.from('invites').select('id').eq('occasion_id', occasionId)).data).toEqual([])
  })

  it('occasion_members: the own RSVP is the only REST write', async () => {
    const mila = await account('mila@example.test')
    const own = `occasion_members?occasion_id=eq.${DEMO_OCCASIONS.housewarming}&profile_id=eq.${mila.id}`
    expect((await mila.client.from('occasion_members').update({ rsvp: 'going' }).eq('occasion_id', DEMO_OCCASIONS.housewarming).eq('profile_id', mila.id)).error).toBeNull()
    expect((await screen(mila, DEMO_OCCASIONS.housewarming)).viewer.rsvp).toBe('going')
    expect((await feed(mila)).upcoming[0]!.rsvp).toBe('going')
    expect(await restCode(mila, 'PATCH', own, { rsvp: 'vielleicht' })).toBe('23514')
    expect(await restCode(mila, 'PATCH', own, { role: 'host' })).toBe('42501')
    // someone else's row: nothing happens
    expect(await restCode(mila, 'PATCH', `occasion_members?occasion_id=eq.${DEMO_OCCASIONS.housewarming}&profile_id=eq.${DEMO_PEOPLE.clara.id}`, { rsvp: 'declined' })).toBe(204)
    expect((await screen(mila, DEMO_OCCASIONS.housewarming)).members.find((member) => member.profile_id === DEMO_PEOPLE.clara.id)?.rsvp).toBe('maybe')
    expect(await restCode(mila, 'POST', 'occasion_members', { occasion_id: DEMO_OCCASIONS.barbecue, profile_id: mila.id })).toBe('42501')
    expect(await restCode(mila, 'DELETE', own)).toBe('42501')
    expect(await rpcError(mila, 'get_occasion_screen', { p_occasion_id: DEMO_OCCASIONS.barbecue })).toEqual(raised('not_found'))
  })

  it('profiles: co-members are visible with id and display name only', async () => {
    const mila = await account('mila@example.test')
    const visible = await mila.client.from('profiles').select('id, display_name').order('display_name')
    expect(visible.data).toEqual([
      { id: DEMO_PEOPLE.anna.id, display_name: 'Anna Beispiel' },
      { id: DEMO_PEOPLE.ben.id, display_name: 'Ben Mustermann' },
      { id: DEMO_PEOPLE.clara.id, display_name: 'Clara Test' },
      { id: mila.id, display_name: 'Mila' },
    ])
    expect((await mila.client.from('profiles').select('locale').eq('id', DEMO_PEOPLE.anna.id)).error?.code).toBe('42501')
    const unfinished = await account('neu@example.test', null)
    expect((await unfinished.client.from('profiles').select('id, display_name')).data).toEqual([{ id: unfinished.id, display_name: null }])
  })
})

describe('demo export and account deletion', () => {
  it('exports own occasions, memberships, lists and reservations as reserver — never reservations on own wishes', async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishIds } = await host(mila)
    const token = await invite(mila, occasionId)
    const jonas = await account('jonas@example.test', 'Jonas')
    await join(jonas, token)
    const exported = (who: Account) => rpc<Record<string, unknown>>(who, 'export_my_data')
    const strip = (data: Record<string, unknown>) => JSON.stringify({ ...data, exported_at: null })
    const hostBefore = await exported(mila)
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[0] })
    await rpc(jonas, 'reserve_wish', { p_wish_id: FREE_WISH })
    const hostExport = await exported(mila)
    expect(strip(hostExport)).toBe(strip(hostBefore))
    expect(Object.keys(hostExport).sort()).toEqual(['blocks', 'consents', 'exported_at', 'format', 'memberships', 'occasions_hosted', 'profile', 'reports', 'reservations_made_by_me', 'wishlists'])
    expect(hostExport).toMatchObject({
      occasions_hosted: [expect.objectContaining({
        id: occasionId, title: 'Milas Geburtstag', place_text: 'Stadtpark',
        invites: [expect.objectContaining({ max_uses: 50, use_count: 1, revoked_at: null })],
        members: [
          expect.objectContaining({ display_name: 'Mila', role: 'host', status: 'active' }),
          expect.objectContaining({ display_name: 'Jonas', role: 'member', rsvp: 'none', status: 'active' }),
        ],
      })],
      memberships: [expect.objectContaining({ occasion_id: DEMO_OCCASIONS.housewarming, occasion_title: 'Annas Einweihung', role: 'member', status: 'active' })],
      wishlists: [expect.objectContaining({
        occasion_id: occasionId,
        wishes: [expect.objectContaining({ title: 'Kopfhörer' }), expect.objectContaining({ title: 'Tasse' }), expect.objectContaining({ title: 'Buch' })],
      })],
      reservations_made_by_me: [],
      blocks: [],
      reports: [],
    })
    const hostText = JSON.stringify(hostExport)
    expect(hostText.replace('reservations_made_by_me', '')).not.toMatch(/reserv/)
    expect(hostText).not.toContain(jonas.id)
    expect(hostText).not.toContain(token)
    expect(hostText).not.toMatch(/token_hash|last_seen_at|wish_title_snapshot/)

    const guestExport = await exported(jonas)
    expect(guestExport).toMatchObject({
      occasions_hosted: [],
      wishlists: [],
      memberships: [
        expect.objectContaining({ occasion_id: DEMO_OCCASIONS.housewarming, status: 'active' }),
        expect.objectContaining({ occasion_id: occasionId, occasion_title: 'Milas Geburtstag', status: 'active' }),
      ],
      reservations_made_by_me: [
        { wish_title: 'Kopfhörer', recipient_name: 'Mila', occasion_title: 'Milas Geburtstag', status: 'active', end_reason: null, created_at: expect.any(String), ended_at: null },
        { wish_title: 'Kinogutschein', recipient_name: 'Anna Beispiel', occasion_title: 'Annas Einweihung', status: 'active', end_reason: null, created_at: expect.any(String), ended_at: null },
      ],
    })
    expect(JSON.stringify(guestExport)).not.toContain(DEMO_PEOPLE.ben.id) // Ben's reservation is not Jonas' business
    // after leaving, only the snapshot remains: no live names or titles
    await rpc(jonas, 'leave_occasion', { p_occasion_id: occasionId })
    expect((await exported(jonas)).reservations_made_by_me).toEqual([
      expect.objectContaining({ wish_title: 'Kopfhörer', recipient_name: null, occasion_title: null, status: 'ended', end_reason: 'member_left' }),
      expect.objectContaining({ wish_title: 'Kinogutschein', status: 'active' }),
    ])
  })

  it('deleting an account cascades through the shared world', async () => {
    const mila = await account('mila@example.test')
    const { occasionId, wishIds } = await host(mila)
    const token = await invite(mila, occasionId)
    const jonas = await account('jonas@example.test', 'Jonas')
    const lea = await account('lea@example.test', 'Lea')
    await join(jonas, token)
    await join(lea, token)
    await rpc(jonas, 'reserve_wish', { p_wish_id: wishIds[0] })
    await rpc(jonas, 'reserve_wish', { p_wish_id: FREE_WISH })
    // a guest deletes the account: membership and reservations vanish, the wishes are free again
    expect(await rpc(jonas, 'delete_my_account')).toEqual({ ok: true })
    expect((await screen(mila, occasionId)).members.map((member) => member.profile_id)).toEqual([mila.id, lea.id])
    expect((await screen(lea, DEMO_OCCASIONS.housewarming)).members.map((member) => member.display_name)).not.toContain('Jonas')
    expect(await rpc(lea, 'reserve_wish', { p_wish_id: wishIds[0] })).toEqual({ ok: true })
    expect(await rpc(lea, 'reserve_wish', { p_wish_id: FREE_WISH })).toEqual({ ok: true })
    // the host deletes the account: the occasion disappears for everyone, reservations on it vanish silently
    expect(await rpc(mila, 'delete_my_account')).toEqual({ ok: true })
    expect((await feed(lea)).upcoming.map((row) => row.id)).toEqual([DEMO_OCCASIONS.housewarming])
    expect((await reservations(lea)).map((entry) => entry.wish_title)).toEqual(['Kinogutschein'])
    expect(await rpcError(lea, 'get_occasion_screen', { p_occasion_id: occasionId })).toEqual(raised('not_found'))
  })
})
