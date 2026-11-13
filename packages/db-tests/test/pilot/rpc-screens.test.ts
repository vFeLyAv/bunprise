/**
 * get_me / get_feed / get_occasion_screen: exact shapes from pilot-decisions §2–§3 and the secrecy rules
 * (owner keys always present + null, byte-identical owner JSON, same ordering for every role,
 * my_reservation_count null for the host).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, scalar, type TestDb } from '../../src/harness'
import {
  NAMES,
  OCCASION_TITLE,
  createMember,
  execAs,
  expectRpcError,
  rpc,
  screen,
  screenText,
  seedPilot,
  type Feed,
  type Seed,
} from './seed'

let t: TestDb
let s: Seed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedPilot(t)
})
afterAll(() => t.close())

// 20261022120000: + brand, color, description, gtin, photo, shop_name (the wish details; never about reservations)
// 20261022160000: + received_at (the owner's "Erhalten"; open wishes: null)
const BASE_WISH_KEYS = ['brand', 'color', 'created_at', 'currency', 'description', 'gtin', 'id', 'note', 'photo', 'price_cents', 'priority', 'quantity', 'received_at', 'reserved', 'reserved_by_me', 'shop_name', 'title', 'url']
// 20261027200000 (shared wishes): the owner + also_in, home, paused; a guest of the occasion + also_in (hints)
const WISH_KEYS = [...BASE_WISH_KEYS, 'also_in', 'home', 'paused', 'together'].sort() // + together: 20261030120000
const GUEST_WISH_KEYS = [...BASE_WISH_KEYS, 'also_in', 'together'].sort()
// 20261025130000: + photo (the cover's meta for Start, null without one; feed-photos.test.ts)
// 20261025150000: + sections (what the occasion offers; a column of the occasion, never about reservations)
// 20261026180000: + ends_at (the end of a timed occasion, null without one; occasions/end-time.test.ts)
// 20261027140000: + cover_theme (the cover motif, null by default; occasions/cover-theme.test.ts)
const FEED_KEYS = ['all_day', 'cover_theme', 'ends_at', 'host_id', 'host_name', 'id', 'member_count', 'my_reservation_count', 'photo', 'place_text', 'role', 'rsvp', 'sections', 'starts_at', 'title', 'tz', 'wish_count']

describe('get_me', () => {
  it('returns profile, consents_ok and the three legal versions', async () => {
    const me = await rpc<Record<string, unknown>>(t, s.a, 'get_me')
    expect(me).toEqual({
      // wave 2b: + profile.banner (M1), + inbox.follow_requests (M2), + profile.in_suggestions (M3, default off) — §5.3
      // 20261024120000: + profile.photo / profile.banner_photo (the own photo meta, null without one)
      // 20261027120000: + profile.invitations_from (default 'friends') and inbox.occasion_invites (the dot on Start)
      profile: { id: s.a, display_name: NAMES.a, locale: 'de', onboarding_done_at: null, banner: null, in_suggestions: false, photo: null, banner_photo: null, invitations_from: 'friends' },
      consents_ok: true,
      legal_versions: { terms: 'terms-2026-10-pilot-5', privacy: 'privacy-2026-10-pilot-6', age: 'age-18plus-2026-10-pilot-1' },
      inbox: { follow_requests: 0, occasion_invites: 0 },
    })
    await execAs(t, s.a, `update profiles set onboarding_done_at = '2026-10-19T10:00:00Z' where id = $1`, [s.a])
    const again = await rpc<{ profile: { onboarding_done_at: string | null } }>(t, s.a, 'get_me')
    expect(again.profile.onboarding_done_at).not.toBeNull()
  })

  it('consents_ok is false without the current consents', async () => {
    const fresh = await createMember(t, 'Hanna', { consents: false })
    const me = await rpc<{ consents_ok: boolean; profile: { display_name: string } }>(t, fresh, 'get_me')
    expect(me.consents_ok).toBe(false)
    expect(me.profile.display_name).toBe('Hanna')
  })
})

describe('get_feed', () => {
  it('host row: exact keys, counts, and my_reservation_count present but null', async () => {
    const feed = await rpc<Feed>(t, s.a, 'get_feed')
    expect(feed.past).toEqual([])
    expect(feed.upcoming).toHaveLength(1)
    const row = feed.upcoming[0]!
    expect(Object.keys(row).sort()).toEqual(FEED_KEYS)
    expect(row).toMatchObject({
      id: s.occasionId,
      title: OCCASION_TITLE,
      tz: 'Europe/Berlin',
      all_day: true,
      place_text: 'Bei Anna',
      role: 'host',
      rsvp: 'going',
      host_name: NAMES.a,
      host_id: s.a,
      member_count: 3,
      wish_count: 3,
      sections: 'wishes',
    })
    expect('my_reservation_count' in row).toBe(true)
    expect(row.my_reservation_count).toBeNull()
  })

  it('member row counts only the member\'s own active reservations; the host feed never changes', async () => {
    const hostBefore = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))
    const b0 = await rpc<Feed>(t, s.b, 'get_feed')
    expect(b0.upcoming[0]).toMatchObject({ role: 'member', rsvp: 'none', my_reservation_count: 0, host_name: NAMES.a, host_id: s.a })

    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.b, 'reserve_wish', [s.w2])
    await rpc(t, s.c, 'reserve_wish', [s.w3])
    expect((await rpc<Feed>(t, s.b, 'get_feed')).upcoming[0]!.my_reservation_count).toBe(2)
    expect((await rpc<Feed>(t, s.c, 'get_feed')).upcoming[0]!.my_reservation_count).toBe(1)

    await rpc(t, s.b, 'cancel_reservation', [s.w2])
    expect((await rpc<Feed>(t, s.b, 'get_feed')).upcoming[0]!.my_reservation_count).toBe(1)

    const hostAfter = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))
    expect(hostAfter).toBe(hostBefore)
    // the only "reserv" in the host's feed is the null-valued key
    expect(hostAfter.match(/reserv/g)).toHaveLength(1)
    expect(hostAfter).toContain('"my_reservation_count": null')

    // outsider: empty feed, same shape
    expect(await rpc<Feed>(t, s.d, 'get_feed')).toEqual({ upcoming: [], past: [] })
  })

  it('splits upcoming / past (ended ≤ 30 days ago) by the occasion end in its own time zone, sorted', async () => {
    const s2 = await seedPilot(t) // +30 days, all day
    const ins = (title: string, startsAt: string, extra = '') =>
      t.asUser(s2.a, (tx) =>
        scalar<string>(tx, `insert into occasions (host_id, title, starts_at ${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, $2, ${startsAt} ${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [s2.a, title]),
      )
    const today = await ins('today all day', `date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'`)
    // an end needs a timed occasion (20261026180000, occasions_ends_at_timed): all_day = false with it
    const timed = (title: string, startsAt: string, endsAt: string) =>
      t.asUser(s2.a, (tx) =>
        scalar<string>(tx, `insert into occasions (host_id, title, starts_at, ends_at, all_day) values ($1, $2, ${startsAt}, ${endsAt}, false) returning id`, [s2.a, title]),
      )
    const inOneHour = await timed('timed soon', `now() + interval '1 hour'`, `now() + interval '2 hours'`)
    const inTenDays = await ins('in ten days', `now() + interval '10 days'`)
    const twoDaysAgo = await timed('timed two days ago', `now() - interval '2 days'`, `now() - interval '2 days' + interval '1 hour'`)
    const fiveDaysAgo = await ins('five days ago', `now() - interval '5 days'`)
    await ins('forty days ago', `now() - interval '40 days'`)

    const feed = await rpc<Feed>(t, s2.a, 'get_feed')
    expect(feed.upcoming.map((o) => o.id)).toEqual([today, inOneHour, inTenDays, s2.occasionId])
    expect(feed.past.map((o) => o.id)).toEqual([twoDaysAgo, fiveDaysAgo])
    for (const row of [...feed.upcoming, ...feed.past]) expect(row.my_reservation_count).toBeNull()
  })
})

describe('get_occasion_screen', () => {
  it('host: exact shape; reserved / reserved_by_me present and null; invite without token', async () => {
    const sc = await screen(t, s.a, s.occasionId)
    expect(Object.keys(sc).sort()).toEqual(['invite', 'members', 'occasion', 'potluck', 'viewer', 'wishlist']) // potluck: 20261025150000
    // 'photo' (20261020160000): the cover's meta or null — details in occasion-photos.test.ts
    // sections: 20261025150000; ends_at: 20261026180000 (null without an end); cover_theme: 20261027140000 (null by default)
    // place_lat / place_lon: 20261027190000 (null without a point; occasions/place-point.test.ts)
    expect(Object.keys(sc.occasion).sort()).toEqual(['all_day', 'cover_theme', 'created_at', 'description', 'ends_at', 'host', 'id', 'photo', 'place_lat', 'place_lon', 'place_text', 'sections', 'starts_at', 'title', 'tz'])
    expect(sc.occasion).toMatchObject({ id: s.occasionId, title: OCCASION_TITLE, tz: 'Europe/Berlin', all_day: true, place_text: 'Bei Anna', description: null })
    expect(sc.occasion.host).toEqual({ id: s.a, display_name: NAMES.a, photo: null }) // 20261024120000: + the host's profile photo meta
    expect(sc.viewer).toEqual({ role: 'host', rsvp: 'going' })
    expect(sc.invite).toEqual({ active: true, expires_at: expect.any(String) })
    expect(JSON.stringify(sc.invite)).not.toContain(s.token)
    expect(sc.wishlist).toMatchObject({ id: s.wishlistId, owner_id: s.a, title: OCCASION_TITLE })
    expect(sc.wishlist!.wishes).toHaveLength(3)
    for (const w of sc.wishlist!.wishes) {
      expect(Object.keys(w).sort()).toEqual(WISH_KEYS)
      expect(w.reserved).toBeNull()
      expect(w.reserved_by_me).toBeNull()
      expect(w).not.toHaveProperty('reserved_by_name')
    }
    expect(sc.wishlist!.wishes[0]).toMatchObject({ id: s.w1, title: 'Kopfhörer', price_cents: 4990, currency: 'EUR', url: 'https://example.com/kopfhoerer', priority: 3 })
  })

  it('members: viewer/invite/members, and the reservation flags without identifying the reserver', async () => {
    const s3 = await seedPilot(t)
    const before = await screen(t, s3.b, s3.occasionId)
    expect(before.viewer).toEqual({ role: 'member', rsvp: 'none' })
    expect(before.invite).toBeNull()
    expect(before.members).toEqual([
      { profile_id: s3.a, display_name: NAMES.a, role: 'host', rsvp: 'going', photo: null },
      { profile_id: s3.b, display_name: NAMES.b, role: 'member', rsvp: 'none', photo: null },
      { profile_id: s3.c, display_name: NAMES.c, role: 'member', rsvp: 'none', photo: null },
    ])
    for (const w of before.wishlist!.wishes) {
      expect(Object.keys(w).sort()).toEqual(GUEST_WISH_KEYS)
      expect([w.reserved, w.reserved_by_me]).toEqual([false, false])
    }

    await rpc(t, s3.b, 'reserve_wish', [s3.w1])
    const asB = await screen(t, s3.b, s3.occasionId)
    const asC = await screen(t, s3.c, s3.occasionId)
    const flags = (sc: typeof asB, id: string) => {
      const w = sc.wishlist!.wishes.find((x) => x.id === id)!
      return [w.reserved, w.reserved_by_me]
    }
    expect(flags(asB, s3.w1)).toEqual([true, true])
    expect(flags(asC, s3.w1)).toEqual([true, false])
    expect(flags(asB, s3.w2)).toEqual([false, false])
    expect(flags(asC, s3.w3)).toEqual([false, false])

    await rpc(t, s3.b, 'cancel_reservation', [s3.w1])
    expect(flags(await screen(t, s3.c, s3.occasionId), s3.w1)).toEqual([false, false])

    // RSVP through REST shows up for everyone
    await execAs(t, s3.b, `update occasion_members set rsvp = 'going' where occasion_id = $1 and profile_id = $2`, [s3.occasionId, s3.b])
    expect((await screen(t, s3.b, s3.occasionId)).viewer.rsvp).toBe('going')
    expect((await screen(t, s3.a, s3.occasionId)).members.find((m) => m.profile_id === s3.b)!.rsvp).toBe('going')
  })

  it('the host\'s JSON is byte-identical whatever happens to reservations', async () => {
    const s4 = await seedPilot(t)
    const before = await screenText(t, s4.a, s4.occasionId)
    expect(before).toContain('"reserved": null')
    await rpc(t, s4.b, 'reserve_wish', [s4.w1])
    expect(await screenText(t, s4.a, s4.occasionId)).toBe(before)
    await rpc(t, s4.c, 'reserve_wish', [s4.w2])
    await rpc(t, s4.c, 'reserve_wish', [s4.w3])
    expect(await screenText(t, s4.a, s4.occasionId)).toBe(before)
    await rpc(t, s4.b, 'cancel_reservation', [s4.w1])
    await rpc(t, s4.c, 'reserve_wish', [s4.w1])
    expect(await screenText(t, s4.a, s4.occasionId)).toBe(before)
    // B and C appear exactly once each: as members (visible to everyone), never as reservers
    expect(before.split(s4.b).length - 1).toBe(1)
    expect(before.split(s4.c).length - 1).toBe(1)
    expect(before.match(/reserv/g)).toHaveLength(6) // 3 wishes × 3 null-valued keys
  })

  it('ordering is priority desc, created_at asc for every role, before and after reservations', async () => {
    const s5 = await seedPilot(t)
    const expected = [s5.w1, s5.w3, s5.w2] // priorities 3, 2, 1
    for (const uid of [s5.a, s5.b, s5.c]) {
      expect((await screen(t, uid, s5.occasionId)).wishlist!.wishes.map((w) => w.id), uid).toEqual(expected)
    }
    await rpc(t, s5.b, 'reserve_wish', [s5.w2])
    await rpc(t, s5.c, 'reserve_wish', [s5.w1])
    for (const uid of [s5.a, s5.b, s5.c]) {
      expect((await screen(t, uid, s5.occasionId)).wishlist!.wishes.map((w) => w.id), uid).toEqual(expected)
    }
    // same priority → created_at ascending
    const w4 = await t.asUser(s5.a, (tx) =>
      scalar<string>(tx, `insert into wishes (wishlist_id, title, priority) values ($1, 'Neu, Unbedingt', 3) returning id`, [s5.wishlistId]),
    )
    expect((await screen(t, s5.b, s5.occasionId)).wishlist!.wishes.map((w) => w.id)).toEqual([s5.w1, w4, s5.w3, s5.w2])
  })

  it('outsider, removed member, unknown id → not_found; anon → permission denied', async () => {
    const s6 = await seedPilot(t)
    await expectRpcError(screen(t, s6.d, s6.occasionId), 'not_found')
    await expectRpcError(screen(t, s6.a, '00000000-0000-4000-8000-000000000000'), 'not_found')
    await rpc(t, s6.a, 'remove_member', [s6.occasionId, s6.c])
    await expectRpcError(screen(t, s6.c, s6.occasionId), 'not_found')
    await rpc(t, s6.b, 'leave_occasion', [s6.occasionId])
    await expectRpcError(screen(t, s6.b, s6.occasionId), 'not_found')
    await expectDbError(t.asAnon((tx) => tx.query('select public.get_occasion_screen($1)', [s6.occasionId])), '42501')
    // the host still sees only the active members
    expect((await screen(t, s6.a, s6.occasionId)).members.map((m) => m.profile_id)).toEqual([s6.a])
  })

  it('a member without current consents can still read the screen (reading is never gated)', async () => {
    const s7 = await seedPilot(t)
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'terms'`, [s7.b]))
    expect((await screen(t, s7.b, s7.occasionId)).viewer.role).toBe('member')
    await expectRpcError(rpc(t, s7.b, 'reserve_wish', [s7.w1]), 'consent_required')
  })
})
