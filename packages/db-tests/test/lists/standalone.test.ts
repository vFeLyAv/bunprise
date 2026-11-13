/**
 * F03 — wishlists WITHOUT an occasion (wave 2b M1, supabase/migrations/20261020200000_lists_standalone.sql;
 * follows-design §3.2, §5.2, §5.5, A11–A13, S17, P9):
 *   created through REST WITH `returning` (supabase-js .insert().select()); at most 20 per owner, a foreign owner_id
 *   is refused by the policy (never by the count); every CHECK; occasion_id immutable (no grant; guard on IS DISTINCT
 *   FROM); visibility never through REST; a new list is 'private' — 'followers' does not exist before M3;
 *   updated_at of lists and wishes not readable through REST (the owner gets it in the export);
 *   the owner-only screens get_list_screen / get_lists_overview, the banner.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, createMember, execAs, expectRpcError, queryAs, rpc } from '../pilot/seed'
import { addWish, createList, createOccasion, exportOf, m3Applied, rpcText, UNKNOWN_ID } from '../follows/seed'
import { checkInvariants } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

// 20261022160000: + photo (the list cover's meta)
const LIST_KEYS = ['cover_icon', 'cover_tone', 'created_at', 'due_on', 'id', 'kind', 'owner', 'photo', 'title', 'visibility']
// 20261022120000: + brand, color, description, gtin, photo, shop_name (the wish details; never about reservations)
// 20261027200000 (shared wishes): the owner + also_in, home, paused
const WISH_KEYS = ['also_in', 'brand', 'color', 'created_at', 'currency', 'description', 'gtin', 'home', 'id', 'note', 'paused', 'photo', 'price_cents', 'priority', 'quantity', 'received_at', 'reserved', 'reserved_by_me', 'shop_name', 'title', 'together', 'url']
const OVERVIEW_LIST_KEYS = ['cover_icon', 'cover_tone', 'created_at', 'due_on', 'id', 'kind', 'occasion', 'photo', 'title', 'visibility', 'wish_count']

interface ListScreen {
  list: Record<string, unknown> & { owner: { id: string; display_name: string | null; banner: string | null } }
  viewer: { role: string }
  wishes: (Record<string, unknown> & { id: string; reserved: boolean | null; reserved_by_me: boolean | null })[]
}

interface Overview {
  me: { id: string; display_name: string | null; banner: string | null; live_links: number }
  stats: Record<string, number>
  my_lists: (Record<string, unknown> & { id: string; kind: string; wish_count: number; occasion: Record<string, unknown> | null })[]
  following: unknown[]
  upcoming: unknown[]
  suggestions: unknown[]
}

/** A day relative to today in Europe/Berlin, as 'YYYY-MM-DD'. */
function berlinDay(t: TestDb, offsetDays: number): Promise<string> {
  return scalar<string>(t.db, `select ((now() at time zone 'Europe/Berlin')::date + $1::int)::text`, [offsetDays])
}

describe('creating a standalone list through REST', () => {
  it('insert … returning works for the owner (the short path of wishlists_select); the list is private', async () => {
    const paula = await createMember(t, 'Paula')
    const row = await t.asUser(paula, (tx) =>
      rows<Record<string, unknown>>(
        tx,
        `insert into wishlists (owner_id, recipient_id, title, visibility, cover_tone, cover_icon, due_on)
         values ($1, $1, 'Meine Wünsche', 'private', 3, 'star', null)
         returning id, occasion_id, owner_id, recipient_id, title, visibility, cover_tone, cover_icon, due_on, created_at`,
        [paula],
      ),
    )
    expect(row).toEqual([
      expect.objectContaining({ occasion_id: null, owner_id: paula, recipient_id: paula, title: 'Meine Wünsche', visibility: 'private', cover_tone: 3, cover_icon: 'star', due_on: null }),
    ])
    // a client-chosen id (optimistic UI) works too, and the owner reads it back
    const id = 'b0b0b0b0-0000-4000-8000-000000000001'
    expect(await createList(t, paula, 'Bücher', { id })).toBe(id)
    expect(await queryAs(t, paula, 'select id, visibility from wishlists where id = $1', [id])).toEqual([{ id, visibility: 'private' }])
    await checkInvariants(t)
  })

  it('at most 20 standalone lists: the 21st is limit_reached; occasion lists do not count', async () => {
    const owner = await createMember(t, 'Greta')
    await createOccasion(t, owner, 'Gretas Fest') // an occasion list of her own: not counted
    for (let i = 1; i <= 20; i++) await createList(t, owner, `Liste ${i}`)
    await expectRpcError(createList(t, owner, 'Liste 21'), 'limit_reached')
    expect(await countAll(t, 'wishlists', 'owner_id = $1 and occasion_id is null', [owner])).toBe(20)
    // deleting one frees a place
    const oldest = await scalar<string>(t.db, `select id from wishlists where owner_id = $1 and occasion_id is null order by created_at limit 1`, [owner])
    expect(await execAs(t, owner, 'delete from wishlists where id = $1', [oldest])).toBe(1)
    await createList(t, owner, 'Liste 21')
  })

  it('a foreign owner_id is refused by the policy (42501) — never by the count, so the limit is no oracle', async () => {
    const full = await createMember(t, 'Rosa')
    for (let i = 1; i <= 20; i++) await createList(t, full, `Rosas Liste ${i}`)
    const other = await createMember(t, 'Finn')
    const empty = await createMember(t, 'Xaver')
    // the same answer for "Rosa has 20 lists" and "Xaver has none"
    for (const victim of [full, empty]) {
      const err = await expectDbError(
        t.asUser(other, (tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, 'x', 'private')`, [victim])),
        '42501',
      )
      expect(err.message).toMatch(/row-level security/)
    }
    // also a list "for somebody else" (recipient = another person) is refused for the owner themself
    await expectDbError(
      t.asUser(other, (tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $2, 'x', 'private')`, [other, empty])),
      '42501',
    )
  })

  it('needs a display name and the current legal records (like occasions)', async () => {
    const noConsent = await createMember(t, 'Moritz', { consents: false })
    await expectDbError(createList(t, noConsent, 'x'), '42501')
    const noName = await t.createUser('noname-list@example.test', {})
    await t.asUser(noName, (tx) =>
      tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [noName]),
    )
    await expectDbError(createList(t, noName, 'x'), '42501')
  })

  it('no list starts as followers: without visibility it is refused (default occasion), followers does not exist before M3', async () => {
    const u = await createMember(t, 'Bea')
    // the column default is 'occasion' (for the trigger of occasions): without an occasion the policy refuses it
    await expectDbError(t.asUser(u, (tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title) values ($1, $1, 'x')`, [u])), '42501')
    await expectDbError(createList(t, u, 'x', { visibility: 'occasion' }), '42501')
    const kind = await expectDbError(t.asService((tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title) values ($1, $1, 'x')`, [u])), '23514')
    expect(kind.message).toContain('wishlists_kind_check')
    if (!(await m3Applied(t))) {
      // M1 / M2: 'followers' is impossible — the policy refuses it, and even the superuser hits the CHECK
      await expectDbError(createList(t, u, 'x', { visibility: 'followers' }), '42501')
      const vis = await expectDbError(
        t.asService((tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, 'x', 'followers')`, [u])),
        '23514',
      )
      expect(vis.message).toContain('wishlists_visibility_check')
    } else {
      // from M3 on: only as the explicit choice of the owner (follows-design §2.6, W09)
      expect(await createList(t, u, 'x', { visibility: 'followers' })).toEqual(expect.any(String))
    }
  })
})

describe('the CHECK constraints', () => {
  it('kind / recipient / title / cover / date (as the owner where the policy lets the row through, else as superuser)', async () => {
    const u = await createMember(t, 'Anna')
    const ben = await createMember(t, 'Ben')
    const [occasionId] = await createOccasion(t, u, 'Annas Feier')
    const asUser = (sql: string, params: unknown[]) => t.asUser(u, (tx) => tx.query(sql, params))
    const asSuper = (sql: string, params: unknown[]) => t.asService((tx) => tx.query(sql, params))
    const cases: [string, (sql: string, params: unknown[]) => Promise<unknown>, string, unknown[], string][] = [
      ['no title', asUser, `insert into wishlists (owner_id, recipient_id, visibility) values ($1, $1, 'private')`, [u], 'wishlists_standalone_title'],
      ['blank title', asUser, `insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, '   ', 'private')`, [u], 'wishlists_title_check'],
      ['title > 80', asUser, `insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, repeat('x', 81), 'private')`, [u], 'wishlists_title_check'],
      ['cover_tone 0', asUser, `insert into wishlists (owner_id, recipient_id, title, visibility, cover_tone) values ($1, $1, 'x', 'private', 0)`, [u], 'wishlists_cover_tone_check'],
      ['cover_tone 5', asUser, `insert into wishlists (owner_id, recipient_id, title, visibility, cover_tone) values ($1, $1, 'x', 'private', 5)`, [u], 'wishlists_cover_tone_check'],
      ['cover_icon unknown', asUser, `insert into wishlists (owner_id, recipient_id, title, visibility, cover_icon) values ($1, $1, 'x', 'private', 'rocket')`, [u], 'wishlists_cover_icon_check'],
      ['due_on before 2020', asUser, `insert into wishlists (owner_id, recipient_id, title, visibility, due_on) values ($1, $1, 'x', 'private', '2019-12-31')`, [u], 'wishlists_due_on_check'],
      ['due_on after 2100', asUser, `insert into wishlists (owner_id, recipient_id, title, visibility, due_on) values ($1, $1, 'x', 'private', '2101-01-01')`, [u], 'wishlists_due_on_check'],
      ['standalone for somebody else', asSuper, `insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $2, 'x', 'private')`, [u, ben], 'wishlists_standalone_self'],
      ['occasion list with private', asSuper, `insert into wishlists (occasion_id, owner_id, recipient_id, title, visibility) values ($2, $1, $1, 'x', 'private')`, [u, occasionId], 'wishlists_kind_check'],
    ]
    for (const [label, run, sql, params, constraint] of cases) {
      const err = await expectDbError(run(sql, params), '23514')
      expect(err.message, label).toContain(constraint)
    }
    // a date on an occasion list: refused (only standalone lists carry due_on)
    const occList = await scalar<string>(t.db, 'select id from wishlists where occasion_id = $1', [occasionId])
    const err = await expectDbError(t.asUser(u, (tx) => tx.query(`update wishlists set due_on = '2027-01-01' where id = $1`, [occList])), '23514')
    expect(err.message).toContain('wishlists_due_on_check')
    // the valid edges are fine
    for (const day of ['2020-01-01', '2100-12-31']) await createList(t, u, `Datum ${day}`, { due_on: day })
    for (const icon of ['gift', 'cake', 'tree', 'home', 'ring', 'star', 'book', 'game', 'plant', 'plane', 'music', 'heart']) {
      await createList(t, u, `Symbol ${icon}`, { cover_icon: icon, cover_tone: 4 })
    }
  })

  it('occasion_id cannot change: no column grant (42501); a superuser NULL → X or X → NULL hits the guard (not_allowed)', async () => {
    const u = await createMember(t, 'Ida')
    const list = await createList(t, u, 'Meine Wünsche')
    const [occasionId, occList] = await createOccasion(t, u, 'Idas Fest')
    await expectDbError(t.asUser(u, (tx) => tx.query('update wishlists set occasion_id = $2 where id = $1', [list, occasionId])), '42501')
    await expectDbError(t.asUser(u, (tx) => tx.query('update wishlists set occasion_id = null where id = $1', [occList])), '42501')
    await expectRpcError(t.asService((tx) => tx.query(`update wishlists set occasion_id = $2, visibility = 'occasion' where id = $1`, [list, occasionId])), 'not_allowed')
    await expectRpcError(t.asService((tx) => tx.query(`update wishlists set occasion_id = null, visibility = 'private' where id = $1`, [occList])), 'not_allowed')
    // owner / recipient: no grant either, and the guard behind it
    await expectDbError(t.asUser(u, (tx) => tx.query('update wishlists set recipient_id = $2 where id = $1', [list, u])), '42501')
    await expectRpcError(t.asService((tx) => tx.query('update wishlists set recipient_id = $2 where id = $1', [list, occList])), 'not_allowed')
  })

  it('visibility is never writable through REST (even by the owner); created_at / updated_at are not insertable', async () => {
    const u = await createMember(t, 'Jonas')
    const list = await createList(t, u, 'Meine Wünsche')
    await expectDbError(t.asUser(u, (tx) => tx.query(`update wishlists set visibility = 'private' where id = $1`, [list])), '42501')
    await expectDbError(t.asUser(u, (tx) => tx.query(`update wishlists set visibility = 'followers' where id = $1`, [list])), '42501')
    for (const col of ['created_at', 'updated_at']) {
      await expectDbError(
        t.asUser(u, (tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title, visibility, ${col}) values ($1, $1, 'x', 'private', now())`, [u])),
        '42501',
      )
    }
  })
})

describe('owner edits, other people see nothing', () => {
  it('title / cover / date: the owner edits (1 row), anybody else edits and deletes 0 rows and reads 0 rows', async () => {
    const owner = await createMember(t, 'Klara')
    const other = await createMember(t, 'Lena')
    const list = await createList(t, owner, 'Meine Wünsche')
    const wish = await addWish(t, owner, list, 'Fahrrad', 3)
    const day = await berlinDay(t, 40)
    expect(await execAs(t, owner, `update wishlists set title = 'Neu', cover_tone = 1, cover_icon = 'cake', due_on = $2 where id = $1`, [list, day])).toBe(1)
    expect(await queryAs(t, owner, 'select title, cover_tone, cover_icon, due_on::text as due_on from wishlists where id = $1', [list])).toEqual([
      { title: 'Neu', cover_tone: 1, cover_icon: 'cake', due_on: day },
    ])
    for (const sql of [`update wishlists set title = 'x' where id = $1`, `delete from wishlists where id = $1`]) {
      expect(await execAs(t, other, sql, [list]), sql).toBe(0)
    }
    expect(await queryAs(t, other, 'select id from wishlists where id = $1', [list])).toEqual([])
    expect(await queryAs(t, other, 'select id from wishes where wishlist_id = $1', [list])).toEqual([])
    expect(await execAs(t, other, `update wishes set title = 'x' where id = $1`, [wish])).toBe(0)
    expect(await execAs(t, other, `delete from wishes where id = $1`, [wish])).toBe(0)
    await expectDbError(t.asUser(other, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'x')`, [list])), '42501')
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [list])).toBe(1)
  })

  it('the owner writes wishes with returning (the client\'s WISH_COLUMNS without updated_at); updated_at is not REST-readable', async () => {
    const owner = await createMember(t, 'Mila')
    const list = await createList(t, owner, 'Meine Wünsche')
    const cols = 'id, wishlist_id, title, price_cents, currency, url, note, priority, created_at'
    const created = await t.asUser(owner, (tx) =>
      rows<Record<string, unknown>>(tx, `insert into wishes (wishlist_id, title, priority) values ($1, 'Kamera', 3) returning ${cols}`, [list]),
    )
    expect(created).toHaveLength(1)
    const wishId = created[0]!['id'] as string
    expect(await t.asUser(owner, (tx) => rows(tx, `update wishes set price_cents = 9900 where id = $1 returning ${cols}`, [wishId]))).toHaveLength(1)
    // the deep link of the edit form: the wish with its list row (occasion_id null for a standalone list)
    expect(
      await queryAs(t, owner, `select w.id, wl.id as list_id, wl.occasion_id, wl.owner_id from wishes w join wishlists wl on wl.id = w.wishlist_id where w.id = $1`, [wishId]),
    ).toEqual([{ id: wishId, list_id: list, occasion_id: null, owner_id: owner }])
    for (const [sql, param] of [
      [`select updated_at from wishes where id = $1`, wishId],
      [`insert into wishes (wishlist_id, title) values ($1, 'x') returning updated_at`, list],
      [`select updated_at from wishlists where id = $1`, list],
    ] as const) {
      await expectDbError(t.asUser(owner, (tx) => tx.query(sql, [param])), '42501')
    }
    // … but the owner's export carries it (definer helper private.my_wishlists_export)
    const exported = await exportOf(t, owner)
    const lists = exported['wishlists'] as { id: string; updated_at: string; occasion_id: string | null; visibility: string; wishes: { id: string; updated_at: string }[] }[]
    const mine = lists.find((l) => l.id === list)!
    expect(mine).toMatchObject({ occasion_id: null, visibility: 'private', updated_at: expect.any(String) })
    expect(mine.wishes.find((w) => w.id === wishId)).toMatchObject({ updated_at: expect.any(String) })
    expect(exported['format']).toBe('bunprise-export-v2')
  })

  it('reserve_wish / cancel_reservation on a standalone list: not_allowed for the owner and for everybody else (closed until M3)', async () => {
    const owner = await createMember(t, 'Nora')
    const other = await createMember(t, 'Ole')
    const list = await createList(t, owner, 'Meine Wünsche')
    const wish = await addWish(t, owner, list, 'Lampe')
    for (const uid of [owner, other]) {
      await expectRpcError(rpc(t, uid, 'reserve_wish', [wish]), 'not_allowed')
      await expectRpcError(rpc(t, uid, 'cancel_reservation', [wish]), 'not_allowed')
    }
    expect(await countAll(t, 'reservations', 'wish_id = $1', [wish])).toBe(0)
  })

  it('deleting the list (REST, owner) takes its wishes along; 1 row like any delete', async () => {
    const owner = await createMember(t, 'Pia')
    const list = await createList(t, owner, 'Weg damit')
    await addWish(t, owner, list, 'a')
    await addWish(t, owner, list, 'b')
    expect(await execAs(t, owner, 'delete from wishlists where id = $1', [list])).toBe(1)
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [list])).toBe(0)
  })
})

describe('get_list_screen (M1: the owner branch only)', () => {
  it('owner: exact keys, literal null reservation keys, priority desc / created_at asc order, the owner card with the banner', async () => {
    const owner = await createMember(t, 'Quirin')
    await execAs(t, owner, `update profiles set banner = 'meadow' where id = $1`, [owner])
    const list = await createList(t, owner, 'Meine Wünsche', { cover_tone: 2, cover_icon: 'book', due_on: await berlinDay(t, 12) })
    const a = await addWish(t, owner, list, 'A (Kann)', 1, 3)
    const b = await addWish(t, owner, list, 'B (Unbedingt)', 3, 2)
    const c = await addWish(t, owner, list, 'C (Gern)', 2, 1)
    const d = await addWish(t, owner, list, 'D (Unbedingt, später)', 3, 0)
    const screen = await rpc<ListScreen>(t, owner, 'get_list_screen', [list])
    expect(Object.keys(screen).sort()).toEqual(['list', 'received', 'viewer', 'wishes'])
    expect(Object.keys(screen.list).sort()).toEqual(LIST_KEYS)
    expect(screen.list).toMatchObject({ id: list, title: 'Meine Wünsche', kind: 'standalone', visibility: 'private', cover_tone: 2, cover_icon: 'book' })
    expect(screen.list.owner).toEqual({ id: owner, display_name: 'Quirin', banner: 'meadow', photo: null, banner_photo: null })
    expect(screen.viewer).toEqual({ role: 'owner' })
    expect(screen.wishes.map((w) => w.id)).toEqual([b, d, c, a])
    for (const w of screen.wishes) {
      expect(Object.keys(w).sort()).toEqual(WISH_KEYS)
      expect([w.reserved, w.reserved_by_me]).toEqual([null, null])
    }
    const text = await rpcText(t, owner, 'get_list_screen', [list])
    expect(text.match(/reserv/g)).toHaveLength(8) // 4 wishes × 2 null keys
  })

  it('everybody else, an unknown id, null and an occasion list: one answer, not_found', async () => {
    const owner = await createMember(t, 'Rudi')
    const other = await createMember(t, 'Sara')
    const list = await createList(t, owner, 'Meine Wünsche')
    const [, occList] = await createOccasion(t, owner, 'Rudis Fest')
    const answers = new Set<string>()
    for (const [uid, id] of [[other, list], [owner, UNKNOWN_ID], [owner, null], [owner, occList], [other, occList]] as const) {
      answers.add((await expectRpcError(rpc(t, uid, 'get_list_screen', [id]), 'not_found')).message)
    }
    expect([...answers]).toEqual(['not_found'])
    await expectDbError(rpc(t, owner, 'get_list_screen', ['not-a-uuid']), '22P02')
    await expectDbError(t.asAnon((tx) => tx.query('select public.get_list_screen($1)', [list])), '42501')
  })
})

describe('get_lists_overview (M1/M2: me, stats, my_lists)', () => {
  it('exact shape; until M3 following / upcoming / suggestions are [] and friends_lists is 0', async () => {
    const u = await createMember(t, 'Tara')
    const ov = await rpc<Overview>(t, u, 'get_lists_overview')
    expect(Object.keys(ov).sort()).toEqual(['following', 'me', 'my_lists', 'stats', 'suggestions', 'upcoming'])
    expect(ov.me).toEqual({ id: u, display_name: 'Tara', banner: null, photo: null, banner_photo: null, live_links: 0 })
    expect(ov.stats).toEqual({ my_wishes: 0, my_lists: 0, friends_lists: 0, followers: 0, following: 0, requests: 0 })
    expect([ov.my_lists, ov.following, ov.upcoming, ov.suggestions]).toEqual([[], [], [], []])
  })

  it('my_lists: future dates first (by date, occasions and lists mixed), then undated (newest first), then past occasions (≤ 30 days)', async () => {
    const u = await createMember(t, 'Uwe')
    const [occSoon, occSoonList] = await createOccasion(t, u, 'Bald', 5)
    const [occLater, occLaterList] = await createOccasion(t, u, 'Später', 50)
    const [occPast, occPastList] = await createOccasion(t, u, 'Vorbei', 1)
    const [occOld] = await createOccasion(t, u, 'Lange vorbei', 1)
    await t.asService(async (tx) => {
      await tx.query(`update occasions set starts_at = now() - interval '10 days' where id = $1`, [occPast])
      await tx.query(`update occasions set starts_at = now() - interval '40 days' where id = $1`, [occOld])
    })
    const dated = await createList(t, u, 'Weihnachten', { due_on: await berlinDay(t, 20) })
    const datedToday = await createList(t, u, 'Heute', { due_on: await berlinDay(t, 0) })
    const pastDated = await createList(t, u, 'Altes Datum', { due_on: await berlinDay(t, -3) })
    const undatedOld = await createList(t, u, 'Meine Wünsche')
    await t.asService((tx) => tx.query(`update wishlists set created_at = now() - interval '1 hour' where id = $1`, [undatedOld]))
    const undatedNew = await createList(t, u, 'Bücher')
    await addWish(t, u, undatedNew, 'x')
    await addWish(t, u, undatedNew, 'y')
    await addWish(t, u, occSoonList, 'z')
    // somebody else's lists never appear, nor occasions the user is only a guest of
    const other = await createMember(t, 'Vera')
    await createList(t, other, 'Fremd')

    const ov = await rpc<Overview>(t, u, 'get_lists_overview')
    expect(ov.my_lists.map((l) => l.id)).toEqual([
      datedToday, // today
      occSoonList, // in 5 days
      dated, // in 20 days
      occLaterList, // in 50 days
      undatedNew, // undated / past date: newest first
      pastDated,
      undatedOld,
      occPastList, // ended 10 days ago (the 40-day-old occasion is gone)
    ])
    for (const l of ov.my_lists) expect(Object.keys(l).sort()).toEqual(OVERVIEW_LIST_KEYS)
    const soon = ov.my_lists.find((l) => l.id === occSoonList)!
    expect(soon).toMatchObject({ kind: 'occasion', visibility: 'occasion', due_on: null, wish_count: 1 })
    expect(soon.occasion).toEqual({ id: occSoon, title: 'Bald', starts_at: expect.any(String), tz: 'Europe/Berlin', all_day: true })
    expect(ov.my_lists.find((l) => l.id === undatedNew)).toMatchObject({ kind: 'standalone', visibility: 'private', occasion: null, wish_count: 2 })
    expect(ov.stats).toMatchObject({ my_lists: 8, my_wishes: 3 })
    expect(ov.my_lists.some((l) => l.occasion !== null && (l.occasion as { id: string }).id === occLater)).toBe(true)
    // nothing about reservations, anywhere
    expect(JSON.stringify(ov)).not.toMatch(/reserv/i)
  })

  it('the counts never move with reservations (a guest reserves on the owner\'s occasion list)', async () => {
    const host = await createMember(t, 'Willi')
    const guest = await createMember(t, 'Yara')
    const [occasionId, listId] = await createOccasion(t, host, 'Willis Fest')
    const wish = await addWish(t, host, listId, 'Grill')
    const token = (await rpc<{ token: string }>(t, host, 'create_invite', [occasionId])).token
    await rpc(t, guest, 'accept_invite', [token])
    const before = await rpcText(t, host, 'get_lists_overview')
    await rpc(t, guest, 'reserve_wish', [wish])
    expect(await rpcText(t, host, 'get_lists_overview')).toBe(before)
    await rpc(t, guest, 'cancel_reservation', [wish])
    expect(await rpcText(t, host, 'get_lists_overview')).toBe(before)
    // the host's lists are never the guest's own lists (M3 shows them under "Bald", never in my_lists)
    const guestView = await rpc<Overview>(t, guest, 'get_lists_overview')
    expect(guestView.my_lists).toEqual([])
    if (!(await m3Applied(t))) expect(guestView.upcoming).toEqual([])
  })
})

describe('profiles.banner', () => {
  it('own banner through REST (one of 8 keys), shown by get_me; not readable through REST; nobody else can set it', async () => {
    const u = await createMember(t, 'Zoe')
    const other = await createMember(t, 'Anton')
    for (const key of ['sunrise', 'meadow', 'sky', 'berry', 'dusk', 'bunnies', 'carrots', 'confetti']) {
      expect(await execAs(t, u, 'update profiles set banner = $2 where id = $1', [u, key]), key).toBe(1)
    }
    expect(((await rpc<{ profile: { banner: string | null } }>(t, u, 'get_me')).profile.banner)).toBe('confetti')
    for (const bad of ['rainbow', 'https://example.com/x.png', '', 'Sunrise']) {
      const err = await expectDbError(t.asUser(u, (tx) => tx.query('update profiles set banner = $2 where id = $1', [u, bad])), '23514')
      expect(err.message).toContain('profiles_banner_check')
    }
    expect(await execAs(t, u, 'update profiles set banner = null where id = $1', [u])).toBe(1)
    expect(await execAs(t, other, `update profiles set banner = 'sky' where id = $1`, [u])).toBe(0)
    await expectDbError(t.asUser(u, (tx) => tx.query('select banner from profiles where id = $1', [u])), '42501')
    await expectDbError(t.asUser(u, (tx) => tx.query(`update profiles set banner = 'sky' where id = $1 returning banner`, [u])), '42501')
    expect(await scalar<string | null>(t.db, 'select banner from profiles where id = $1', [u])).toBeNull()
  })
})
