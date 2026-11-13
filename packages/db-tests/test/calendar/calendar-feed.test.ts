/**
 * Kalender-Abo + birthday suggestion (supabase/migrations/20261027170000_calendar_feed.sql,
 * docs/handoffs/2026-10-27-calendar.md): the secret feed token (shown once, only its sha256 stored, rotation,
 * revocation, account deletion), what public.calendar_feed(token) returns to anon (the Worker's publishable key) and
 * what it never returns, its per-token limit and the read-only refusal, the privileges (anon executes exactly this
 * one function) — and 🔒 the secrecy of reservations: the feed is byte-identical with 0 and 5 reservations.
 * Then get_anniversary_suggestions(). All names invented.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, execAs, expectRpcError, rpc, seedPilot } from '../pilot/seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface FeedOccasion { id: string; title: string; starts_at: string; ends_at: string | null; tz: string; all_day: boolean; place_text: string | null; updated_at: string }
interface Feed { lang: string; occasions: FeedOccasion[] }

const create = (uid: string, lang = 'de') => rpc<{ token: string; created_at: string }>(t, uid, 'create_calendar_feed', [lang])
/** What the Worker gets: the RPC as anon (PostgREST POST = a read-write transaction). */
const feed = (token: string | null) => t.asAnon((tx) => scalar<Feed | { rate_limited: true } | null>(tx, 'select public.calendar_feed($1) as v', [token]))
const feedText = (token: string) => t.asAnon((tx) => scalar<string | null>(tx, 'select public.calendar_feed($1)::text as v', [token]))
const feedRow = (uid: string) => t.asService((tx) => rows<{ token_hash: Uint8Array; lang: string; window_count: number; last_fetched_at: string | null }>(
  tx, 'select token_hash, lang, window_count, last_fetched_at from public.calendar_feeds where profile_id = $1', [uid]))
const resetWindow = (uid: string) => t.asService((tx) => tx.query('update public.calendar_feeds set window_start = null, window_count = 0 where profile_id = $1', [uid]))

async function occasion(host: string, title: string, startsSql: string, extra: { allDay?: boolean; cover?: string | null } = {}): Promise<string> {
  return t.asUser(host, (tx) => scalar<string>(tx,
    `insert into occasions (host_id, title, starts_at, tz, all_day, cover_theme) values ($1, $2, ${startsSql}, 'Europe/Berlin', $3, $4) returning id`,
    [host, title, extra.allDay ?? true, extra.cover ?? null]))
}

async function join(host: string, occasionId: string, guest: string): Promise<void> {
  const { token } = await rpc<{ token: string }>(t, host, 'create_invite', [occasionId])
  await rpc(t, guest, 'accept_invite', [token])
}

describe('the token', () => {
  it('is 43 characters base64url, shown once; only its sha256 is stored; the status never carries it', async () => {
    const anna = await createMember(t, 'Anna')
    const { token, created_at } = await create(anna, 'ru')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(created_at).toBeTruthy()
    const [row] = await feedRow(anna)
    expect(row?.lang).toBe('ru')
    const hash = await scalar<string>(t.db, `select encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [token])
    expect(Buffer.from(row?.token_hash ?? []).toString('hex')).toBe(hash)
    // no column holds the token itself
    const text = await scalar<string>(t.db, `select row_to_json(f)::text from public.calendar_feeds f where profile_id = $1`, [anna])
    expect(text).not.toContain(token)
    const status = await rpc<Record<string, unknown>>(t, anna, 'get_calendar_feed')
    expect(status).toMatchObject({ active: true, lang: 'ru', last_fetched_at: null })
    expect(JSON.stringify(status)).not.toContain(token)
    // two tokens differ
    expect((await create(anna)).token).not.toBe(token)
  })

  it('needs consents and a known language', async () => {
    const nobody = await createMember(t, 'Ohne', { consents: false })
    await expectRpcError(create(nobody), 'consent_required')
    const ben = await createMember(t, 'Ben')
    for (const lang of ['fr', '', 'DE']) await expectRpcError(create(ben, lang), 'validation')
    expect(await rpc(t, ben, 'get_calendar_feed')).toEqual({ active: false, created_at: null, last_fetched_at: null, lang: null })
  })

  it('rotation: the old address stops at once, the new one works; "Abo beenden" stops it; a second person is separate', async () => {
    const s = await seedPilot(t)
    const first = (await create(s.a)).token
    expect(await feed(first)).toMatchObject({ lang: 'de' })
    const second = (await create(s.a)).token
    expect(await feed(first)).toBeNull()
    expect(await feed(second)).toMatchObject({ lang: 'de' })
    expect(await rpc(t, s.a, 'revoke_calendar_feed')).toEqual({ ok: true })
    expect(await feed(second)).toBeNull()
    expect((await rpc<{ active: boolean }>(t, s.a, 'get_calendar_feed')).active).toBe(false)
    // revoking twice is fine; another person's feed is untouched
    const bens = (await create(s.b)).token
    expect(await rpc(t, s.a, 'revoke_calendar_feed')).toEqual({ ok: true })
    expect(await feed(bens)).not.toBeNull()
  })

  it('unknown, malformed, empty and null tokens: one answer (null), nothing written', async () => {
    const s = await seedPilot(t)
    const real = (await create(s.a)).token
    const flipped = (real[0] === 'A' ? 'B' : 'A') + real.slice(1)
    for (const token of [flipped, real.slice(0, 42), `${real}x`, '', null, `${real.slice(0, 42)}=`, "' or 1=1 --"]) {
      expect(await feed(token), String(token)).toBeNull()
    }
    expect((await feedRow(s.a))[0]?.window_count).toBe(0)
  })

  it('account deletion takes the feed with it', async () => {
    const s = await seedPilot(t)
    const token = (await create(s.c)).token
    expect(await rpc(t, s.c, 'delete_my_account')).toEqual({ ok: true })
    expect(await feed(token)).toBeNull()
    expect(await scalar<number>(t.db, 'select count(*)::int from public.calendar_feeds where profile_id = $1', [s.c])).toBe(0)
  })

  it('export: created_at, last_fetched_at, lang — never the hash; null without a feed', async () => {
    const s = await seedPilot(t)
    expect(await rpc(t, s.b, 'export_my_calendar_feed')).toBeNull()
    const token = (await create(s.b, 'uk')).token
    await feed(token)
    const exported = await rpc<Record<string, unknown>>(t, s.b, 'export_my_calendar_feed')
    expect(Object.keys(exported).sort()).toEqual(['created_at', 'lang', 'last_fetched_at'])
    expect(exported.lang).toBe('uk')
    expect(exported.last_fetched_at).toBeTruthy()
  })
})

describe('what the feed contains', () => {
  it('host and guests get the occasion with minimal fields only — no description, guests, wishes or anything else', async () => {
    const s = await seedPilot(t)
    await execAs(t, s.a, `update occasions set description = 'Geheime Notiz' where id = $1`, [s.occasionId])
    for (const uid of [s.a, s.b]) {
      const answer = await feed((await create(uid)).token) as Feed
      const row = answer.occasions.find((o) => o.id === s.occasionId)
      expect(row, uid).toBeDefined()
      expect(Object.keys(row ?? {}).sort()).toEqual(['all_day', 'ends_at', 'id', 'place_text', 'starts_at', 'title', 'tz', 'updated_at'])
      expect(row).toMatchObject({ title: 'Geburtstag Anna', place_text: 'Bei Anna', tz: 'Europe/Berlin' })
      const text = JSON.stringify(answer)
      for (const word of ['Geheime Notiz', 'Kopfhörer', 'Buch', 'Socken', 'reserv', 'wish', 'Ben', 'Cem']) expect(text, word).not.toContain(word)
    }
    // an outsider's feed does not have it
    const outsider = await feed((await create(s.d)).token) as Feed
    expect(outsider.occasions.map((o) => o.id)).not.toContain(s.occasionId)
  })

  it('🔒 owner sees nothing: the feed text is identical with 0 and 5 reservations (host and guest alike)', async () => {
    const s = await seedPilot(t)
    const extra1 = await t.asUser(s.a, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, 'Tasse') returning id`, [s.wishlistId]))
    const extra2 = await t.asUser(s.a, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, 'Kerze') returning id`, [s.wishlistId]))
    const hostToken = (await create(s.a)).token
    const guestToken = (await create(s.b)).token
    const before = [await feedText(hostToken), await feedText(guestToken)]
    let reserved = 0
    for (const [uid, wish] of [[s.b, s.w1], [s.b, s.w2], [s.c, s.w3], [s.c, extra1], [s.b, extra2]] as const) {
      await rpc(t, uid, 'reserve_wish', [wish])
      reserved++
    }
    expect(reserved).toBe(5)
    expect(await scalar<number>(t.db, `select count(*)::int from reservations r join wishlists wl on wl.id = r.wishlist_id where wl.occasion_id = $1 and r.status = 'active'`, [s.occasionId])).toBe(5)
    await resetWindow(s.a)
    await resetWindow(s.b)
    expect([await feedText(hostToken), await feedText(guestToken)]).toEqual(before)
  })

  it('leaves out: a declined guest, a guest who left, cancelled occasions, a block with the host, the far past and far future', async () => {
    const s = await seedPilot(t)
    const tokenB = (await create(s.b)).token
    const tokenC = (await create(s.c)).token
    const tokenA = (await create(s.a)).token
    const ids = async (token: string) => ((await feed(token)) as Feed).occasions.map((o) => o.id)
    expect(await ids(tokenB)).toContain(s.occasionId)

    await t.asUser(s.b, (tx) => tx.query(`update occasion_members set rsvp = 'declined' where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.b]))
    expect(await ids(tokenB)).not.toContain(s.occasionId)
    await t.asUser(s.b, (tx) => tx.query(`update occasion_members set rsvp = 'maybe' where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.b]))
    expect(await ids(tokenB)).toContain(s.occasionId)

    await rpc(t, s.c, 'leave_occasion', [s.occasionId])
    expect(await ids(tokenC)).not.toContain(s.occasionId)

    await rpc(t, s.b, 'block_user', [s.a])
    expect(await ids(tokenB)).not.toContain(s.occasionId)
    expect(await ids(tokenA)).toContain(s.occasionId)   // the host still has their own occasion

    const old = await occasion(s.a, 'Längst vorbei', `now() - interval '40 days'`)
    const recent = await occasion(s.a, 'Letzte Woche', `now() - interval '7 days'`)
    const far = await occasion(s.a, 'In drei Jahren', `now() + interval '3 years'`)
    const listA = await ids(tokenA)
    expect(listA).toContain(recent)
    expect(listA).not.toContain(old)
    expect(listA).not.toContain(far)

    await execAs(t, s.a, 'update occasions set cancelled_at = now() where id = $1', [s.occasionId])
    expect(await ids(tokenA)).not.toContain(s.occasionId)
  })

  it('timed occasions keep their end and zone; ordered by start', async () => {
    const anna = await createMember(t, 'Anna')
    const late = await occasion(anna, 'Später', `now() + interval '20 days'`)
    const early = await t.asUser(anna, (tx) => scalar<string>(tx,
      `insert into occasions (host_id, title, starts_at, ends_at, tz, all_day, place_text)
       values ($1, 'Abendessen', now() + interval '10 days', now() + interval '10 days 3 hours', 'America/New_York', false, 'Diner; 5th Ave, NYC')
       returning id`, [anna]))
    const answer = await feed((await create(anna, 'en')).token) as Feed
    expect(answer.lang).toBe('en')
    expect(answer.occasions.map((o) => o.id)).toEqual([early, late])
    expect(answer.occasions[0]).toMatchObject({ all_day: false, tz: 'America/New_York', place_text: 'Diner; 5th Ave, NYC' })
    expect(answer.occasions[0]?.ends_at).toBeTruthy()
    expect(answer.occasions[1]?.ends_at).toBeNull()
  })
})

describe('limits and access', () => {
  it('30 answers per token and hour, then { rate_limited } — committed, and a new hour starts again', async () => {
    const anna = await createMember(t, 'Anna')
    const token = (await create(anna)).token
    for (let i = 0; i < 30; i++) expect(await feed(token)).toMatchObject({ lang: 'de' })
    expect(await feed(token)).toEqual({ rate_limited: true })
    expect(await feed(token)).toEqual({ rate_limited: true })
    expect((await feedRow(anna))[0]?.window_count).toBe(32)
    expect((await feedRow(anna))[0]?.last_fetched_at).toBeTruthy()
    await t.asService((tx) => tx.query(`update public.calendar_feeds set window_start = now() - interval '61 minutes' where profile_id = $1`, [anna]))
    expect(await feed(token)).toMatchObject({ lang: 'de' })
    expect((await feedRow(anna))[0]?.window_count).toBe(1)
  })

  it('a read-only transaction (PostgREST GET) is refused: the limit cannot be skipped', async () => {
    const anna = await createMember(t, 'Anna')
    const token = (await create(anna)).token
    for (const input of [token, 'x'.repeat(43)]) {
      const err = await expectDbError(t.asAnon(async (tx) => {
        await tx.exec('set transaction read only')
        return scalar(tx, 'select public.calendar_feed($1) as v', [input])
      }), 'P0001')
      expect(err.message).toBe('not_allowed')
    }
    expect((await feedRow(anna))[0]?.window_count).toBe(0)
  })

  it('anon executes calendar_feed and nothing else of it; authenticated cannot call calendar_feed; the table has no privilege', async () => {
    const can = (role: string, fn: string) => scalar<boolean>(t.db, `select has_function_privilege($1, $2, 'execute')`, [role, fn])
    expect(await can('anon', 'public.calendar_feed(text)')).toBe(true)
    expect(await can('authenticated', 'public.calendar_feed(text)')).toBe(false)
    expect(await can('public', 'public.calendar_feed(text)')).toBe(false)
    for (const fn of ['public.create_calendar_feed(text)', 'public.get_calendar_feed()', 'public.revoke_calendar_feed()',
      'public.export_my_calendar_feed()', 'public.get_anniversary_suggestions()']) {
      expect(await can('anon', fn), fn).toBe(false)
      expect(await can('authenticated', fn), fn).toBe(true)
    }
    for (const fn of ['private.next_anniversary(date,date)', 'private.new_calendar_token()']) {
      expect(await can('anon', fn), fn).toBe(false)
      expect(await can('authenticated', fn), fn).toBe(false)
    }
    for (const role of ['anon', 'authenticated']) {
      expect(await scalar<boolean>(t.db, `select has_table_privilege($1, 'public.calendar_feeds', 'select')`, [role])).toBe(false)
    }
    await expectDbError(t.asAnon((tx) => tx.query('select * from public.calendar_feeds')), '42501')
    await expectDbError(t.asAnon((tx) => tx.query(`select public.create_calendar_feed('de')`)), '42501')
  })

  it('🔒 no wish, wishlist or reservation table is named in the new functions', async () => {
    const bodies = await rows<{ proname: string; prosrc: string }>(t.db,
      `select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proname in ('calendar_feed', 'create_calendar_feed', 'get_calendar_feed',
          'revoke_calendar_feed', 'export_my_calendar_feed', 'get_anniversary_suggestions', 'next_anniversary', 'new_calendar_token')`)
    expect(bodies).toHaveLength(8)
    for (const { proname, prosrc } of bodies) expect(prosrc, proname).not.toMatch(/wish|reserv/i)
  })
})

describe('next_anniversary', () => {
  it('this year or next; 29 February becomes 28 February in a common year', async () => {
    const next = (day: string, today: string) => scalar<string>(t.db, 'select private.next_anniversary($1::date, $2::date)::text', [day, today])
    expect(await next('2025-11-15', '2026-10-27')).toBe('2026-11-15')
    expect(await next('2025-10-27', '2026-10-27')).toBe('2026-10-27')
    expect(await next('2025-01-10', '2026-10-27')).toBe('2027-01-10')
    expect(await next('2024-02-29', '2026-01-01')).toBe('2026-02-28')
    expect(await next('2024-02-29', '2027-03-01')).toBe('2028-02-29')
  })
})

describe('get_anniversary_suggestions', () => {
  type Suggestion = { occasion_id: string; title: string; role: string; host_id: string; host_name: string; anniversary: string; days_ahead: number; cover_theme: string | null }
  const suggestions = (uid: string) => rpc<Suggestion[]>(t, uid, 'get_anniversary_suggestions')
  /** "about a year ago, so that its anniversary is in N days" in Berlin */
  const yearAgoPlus = (days: number) => `((now() at time zone 'Europe/Berlin')::date - interval '1 year' + interval '${days} days' + interval '12 hours') at time zone 'Europe/Berlin'`

  it('a past occasion whose anniversary is 14–28 days ahead — host and guest; only title, day and host', async () => {
    const anna = await createMember(t, 'Anna')
    const ben = await createMember(t, 'Ben')
    const birthday = await occasion(anna, 'Annas Geburtstag', yearAgoPlus(20))
    await join(anna, birthday, ben)
    const [mine] = await suggestions(anna)
    expect(mine).toMatchObject({ occasion_id: birthday, title: 'Annas Geburtstag', role: 'host', host_id: anna, host_name: 'Anna', days_ahead: 20 })
    expect(Object.keys(mine ?? {}).sort()).toEqual(['all_day', 'anniversary', 'cover_theme', 'days_ahead', 'host_id', 'host_name', 'occasion_id', 'role', 'starts_at', 'title', 'tz'])
    expect((await suggestions(ben))[0]).toMatchObject({ occasion_id: birthday, role: 'member', host_name: 'Anna' })
    // an outsider gets nothing
    expect(await suggestions(await createMember(t, 'Dana'))).toEqual([])
  })

  it('the window: 13 and 29 days ahead are out, 14 and 28 in; younger than 300 days is out', async () => {
    const anna = await createMember(t, 'Anna')
    const ins = [await occasion(anna, 'Geburtstag A', yearAgoPlus(14)), await occasion(anna, 'Geburtstag B', yearAgoPlus(28))]
    await occasion(anna, 'Geburtstag C', yearAgoPlus(13))
    await occasion(anna, 'Geburtstag D', yearAgoPlus(29))
    await occasion(anna, 'Geburtstag E', `now() - interval '200 days'`)
    // distinct per host and day: A and B are different days
    expect((await suggestions(anna)).map((x) => x.occasion_id)).toEqual(ins)
  })

  it('one per host and day (the newest); a motif other than birthday / none is out; cancelled, declined and blocked are out', async () => {
    const anna = await createMember(t, 'Anna')
    const ben = await createMember(t, 'Ben')
    const older = await t.asUser(anna, (tx) => scalar<string>(tx,
      `insert into occasions (host_id, title, starts_at, tz) values ($1, 'Annas Geburtstag', (${yearAgoPlus(20)}) - interval '1 year', 'Europe/Berlin') returning id`, [anna]))
    const newer = await occasion(anna, 'Annas Geburtstag', yearAgoPlus(20), { cover: 'birthday' })
    await occasion(anna, 'Grillen', yearAgoPlus(21), { cover: 'bbq' })
    const none = await occasion(anna, 'Feier', yearAgoPlus(22), { cover: 'none' })
    expect((await suggestions(anna)).map((x) => x.occasion_id)).toEqual([newer, none])
    expect(older).not.toBe(newer)

    await join(anna, newer, ben)
    expect((await suggestions(ben)).map((x) => x.occasion_id)).toEqual([newer])
    await t.asUser(ben, (tx) => tx.query(`update occasion_members set rsvp = 'declined' where occasion_id = $1 and profile_id = $2`, [newer, ben]))
    expect(await suggestions(ben)).toEqual([])
    await t.asUser(ben, (tx) => tx.query(`update occasion_members set rsvp = 'going' where occasion_id = $1 and profile_id = $2`, [newer, ben]))
    await rpc(t, ben, 'block_user', [anna])
    expect(await suggestions(ben)).toEqual([])
    await execAs(t, anna, 'update occasions set cancelled_at = now() where id = $1', [none])
    expect((await suggestions(anna)).map((x) => x.occasion_id)).toEqual([newer])
  })

  it('at most 5', async () => {
    const anna = await createMember(t, 'Anna')
    for (let i = 0; i < 7; i++) await occasion(anna, `Geburtstag ${i}`, yearAgoPlus(15 + i))
    expect(await suggestions(anna)).toHaveLength(5)
  })
})
