/**
 * ATTACK ROUND 1 — lifecycle operations as oracles.
 * The host's own REST operations (delete wish / wishlist / occasion, re-insert a wish with the same id, edit) must
 * behave exactly the same whether a wish is free, reserved, or carries reservation history (ended rows that still
 * point at the wish). Any error or different row count only in the "with reservations" case = oracle.
 * Plus: the plain invite token exists nowhere in the database, and no reservation / reserver id leaks into any
 * text the host or a member receives.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES, WISH_TITLES, countAll, execAs, expectRpcError, rpc, screen, seedPilot, type MyReservation, type Seed } from '../pilot/seed'
import { runCleanupPass } from '../follows/invariants'

// Since 20261027200000 (shared wishes): no host operation touches reservations (no FK, no trigger). A reservation
// whose wish is gone is DEAD at once (the giver: "unavailable", no context) and the cleanup ends it ('wish_deleted').

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

/** w1: ended row (B, by_reserver, wish_id still set) + active row (C); w2: one ended row only; w3: free. */
async function withHistory(s: Seed): Promise<void> {
  await rpc(t, s.b, 'reserve_wish', [s.w1])
  await rpc(t, s.b, 'cancel_reservation', [s.w1])
  await rpc(t, s.c, 'reserve_wish', [s.w1])
  await rpc(t, s.b, 'reserve_wish', [s.w2])
  await rpc(t, s.b, 'cancel_reservation', [s.w2])
  expect(await rows(t.db, `select wish_id, status from reservations where wishlist_id = $1 order by wish_id, status`, [s.wishlistId])).toHaveLength(3)
}

describe('host operations with reservation history', () => {
  it('delete wish: 1 row for historic, taken and free wishes alike; ended rows keep their reason, the active one becomes wish_deleted', async () => {
    const s = await seedPilot(t)
    await withHistory(s)
    const results = []
    for (const w of [s.w1, s.w2, s.w3]) results.push(await execAs(t, s.a, 'delete from wishes where id = $1', [w]))
    expect(results).toEqual([1, 1, 1])
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(0)
    expect((await rpc<MyReservation[]>(t, s.c, 'my_reservations')).map((r) => [r.wish_title, r.status, r.end_reason])).toEqual([[WISH_TITLES.w1, 'ended', 'unavailable']])
    await runCleanupPass(t)
    expect(await rows(t.db, `select reserver_id, status, end_reason, wish_id, wish_title_snapshot from reservations where wishlist_id = $1 order by reserver_id, end_reason`, [s.wishlistId])).toEqual(
      expect.arrayContaining([
        // ended rows are never changed again (only the cleanup clears wish_id of rows it ends itself)
        { reserver_id: s.b, status: 'ended', end_reason: 'by_reserver', wish_id: s.w1, wish_title_snapshot: WISH_TITLES.w1 },
        { reserver_id: s.b, status: 'ended', end_reason: 'by_reserver', wish_id: s.w2, wish_title_snapshot: WISH_TITLES.w2 },
        { reserver_id: s.c, status: 'ended', end_reason: 'wish_deleted', wish_id: null, wish_title_snapshot: WISH_TITLES.w1 },
      ]),
    )
    expect((await rpc<MyReservation[]>(t, s.c, 'my_reservations')).map((r) => [r.wish_title, r.status, r.end_reason])).toEqual([[WISH_TITLES.w1, 'ended', 'unavailable']])
    expect(await rpc(t, s.b, 'my_reservations')).toEqual([]) // own cancellations are never listed
    expect(await rpc(t, s.a, 'my_reservations')).toEqual([])
    expect((await screen(t, s.a, s.occasionId)).wishlist!.wishes).toEqual([])
  })

  it('delete wishlist (REST): cascades through history without error; the host may create a fresh list afterwards', async () => {
    const s = await seedPilot(t)
    await withHistory(s)
    expect(await execAs(t, s.b, 'delete from wishlists where id = $1', [s.wishlistId])).toBe(0) // member: nothing
    expect(await execAs(t, s.a, 'delete from wishlists where id = $1', [s.wishlistId])).toBe(1)
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(0)
    await runCleanupPass(t)
    expect(await rows(t.db, `select status, wish_id from reservations where reserver_id in ($1, $2)`, [s.b, s.c])).toEqual(
      expect.arrayContaining([{ status: 'ended', wish_id: null }]),
    )
    expect(await countAll(t, 'reservations', `status = 'active' and reserver_id in ($1, $2)`, [s.b, s.c])).toBe(0)
    for (const uid of [s.a, s.b, s.c]) expect((await screen(t, uid, s.occasionId)).wishlist, uid).toBeNull()
    expect(await execAs(t, s.a, `insert into wishlists (occasion_id, owner_id, recipient_id, title) values ($1, $2, $2, 'Neu')`, [s.occasionId, s.a])).toBe(1)
    expect((await screen(t, s.c, s.occasionId)).wishlist).toMatchObject({ title: 'Neu', wishes: [] })
    expect((await rpc<MyReservation[]>(t, s.c, 'my_reservations')).map((r) => r.end_reason)).toEqual(['unavailable'])
  })

  it('delete occasion (REST) with history: 1 row, full cascade, members and reservers get consistent "gone" answers', async () => {
    const s = await seedPilot(t)
    await withHistory(s)
    await execAs(t, s.a, `insert into occasion_addresses (occasion_id, address) values ($1, 'Musterstraße 1')`, [s.occasionId])
    expect(await execAs(t, s.a, 'delete from occasions where id = $1', [s.occasionId])).toBe(1)
    for (const [table, col] of [
      ['occasion_members', 'occasion_id'],
      ['invites', 'occasion_id'],
      ['wishlists', 'occasion_id'],
      ['occasion_addresses', 'occasion_id'],
    ] as const) {
      expect(await countAll(t, table, `${col} = $1`, [s.occasionId]), table).toBe(0)
    }
    await expectRpcError(screen(t, s.b, s.occasionId), 'not_found')
    await expectRpcError(screen(t, s.a, s.occasionId), 'not_found')
    expect((await rpc<MyReservation[]>(t, s.c, 'my_reservations')).map((r) => [r.status, r.end_reason, r.occasion_id])).toEqual([['ended', 'unavailable', null]])
    await runCleanupPass(t)
    expect(await countAll(t, 'reservations', `status = 'active' and reserver_id in ($1, $2)`, [s.b, s.c])).toBe(0)
  })

  it('re-inserting a wish with the id of a deleted (reserved) wish does not resurrect the old reservation', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    expect(await execAs(t, s.a, 'delete from wishes where id = $1', [s.w1])).toBe(1)
    // 20261027200000 (SW34): a wish's id comes from the database only — the owner cannot choose it any more
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into wishes (id, wishlist_id, title, priority) values ($1, $2, 'Kopfhörer v2', 3)`, [s.w1, s.wishlistId])), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into wishes (wishlist_id, title, created_at) values ($1, 'x', now() - interval '1 year')`, [s.wishlistId])), '42501')
    // and once the cleanup has seen the dead row, not even a privileged re-insert with that id brings it back
    await runCleanupPass(t)
    await t.db.query(`insert into wishes (id, wishlist_id, title, priority) values ($1, $2, 'Kopfhörer v2', 3)`, [s.w1, s.wishlistId])
    const w1 = (await screen(t, s.c, s.occasionId)).wishlist!.wishes.find((w) => w.id === s.w1)!
    expect([w1.reserved, w1.reserved_by_me]).toEqual([false, false])
    expect((await rpc<MyReservation[]>(t, s.b, 'my_reservations')).map((r) => [r.wish_id, r.wish_title, r.status])).toEqual([[null, WISH_TITLES.w1, 'ended']])
    expect(await rpc(t, s.b, 'reserve_wish', [s.w1])).toEqual({ ok: true }) // a new reservation on the new wish
    expect(await countAll(t, 'reservations', 'reserver_id = $1', [s.b])).toBe(2)
    const host = (await screen(t, s.a, s.occasionId)).wishlist!.wishes.find((w) => w.id === s.w1)!
    expect([host.reserved, host.reserved_by_me]).toEqual([null, null])
  })

  it('every edit of a reserved wish behaves like the edit of a free one (row counts, no errors, same updated_at semantics)', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    const edits = [
      `update wishes set title = 'Neuer Titel' where id = $1`,
      `update wishes set price_cents = 1, currency = 'EUR', url = 'https://example.com/x', note = 'n', priority = 1 where id = $1`,
      `update wishes set priority = 3 where id = $1`,
    ]
    for (const sql of edits) {
      expect(await execAs(t, s.a, sql, [s.w1]), sql).toBe(1) // reserved
      expect(await execAs(t, s.a, sql, [s.w3]), sql).toBe(1) // free
    }
    // the reservation is untouched by the edits and the reserver still sees it with the live title
    expect(await scalar<string>(t.db, `select status from reservations where wish_id = $1`, [s.w1])).toBe('active')
    expect((await rpc<MyReservation[]>(t, s.b, 'my_reservations'))[0]!.wish_title).toBe('Neuer Titel')
  })

  it('a reserver deleting their account frees the wish without any trace in the host\'s screen or feed beyond the members list', async () => {
    const s = await seedPilot(t)
    const hostScreen = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [s.occasionId]))
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    expect(await rpc(t, s.c, 'delete_my_account')).toEqual({ ok: true })
    const after = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [s.occasionId]))
    // the only difference is C's disappearance from members (visible by design), the wishlist part is identical
    const strip = (txt: string) => JSON.stringify({ ...(JSON.parse(txt) as Record<string, unknown>), members: null })
    expect(strip(after)).toBe(strip(hostScreen))
    expect(await rpc(t, s.b, 'reserve_wish', [s.w2])).toEqual({ ok: true })
  })
})

describe('tokens and ids never leak', () => {
  it('the plain invite token is stored in no table at all (every row of every table scanned), only its sha256', async () => {
    const s = await seedPilot(t)
    const tables = [...ALL_TABLES.map((x) => `public.${x}`), 'auth.users']
    for (const table of tables) {
      const dump = await rows<{ j: string }>(t.db, `select to_jsonb(x)::text as j from ${table} x`)
      for (const r of dump) expect(r.j, table).not.toContain(s.token)
    }
    const hashHex = await scalar<string>(t.db, `select encode(sha256(convert_to($1::text, 'UTF8')), 'hex')`, [s.token])
    expect(await scalar<number>(t.db, `select count(*)::int from invites where encode(token_hash, 'hex') = $1`, [hashHex])).toBe(1)
    // the host's export / screen carry neither the token nor the hash
    const exp = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))
    const scr = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [s.occasionId]))
    for (const txt of [exp, scr]) {
      expect(txt).not.toContain(s.token)
      expect(txt).not.toContain(hashHex)
      expect(txt).not.toContain(hashHex.toUpperCase())
    }
  })

  it('reservation ids and reserver ids appear in nothing the host receives; a member gets no reservation id either', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    const ids = (await rows<{ id: string }>(t.db, 'select id from reservations where wishlist_id = $1', [s.wishlistId])).map((r) => r.id)
    expect(ids).toHaveLength(2)
    const hostTexts = await t.asUser(s.a, async (tx) => [
      await scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [s.occasionId]),
      await scalar<string>(tx, 'select public.get_feed()::text'),
      await scalar<string>(tx, 'select public.export_my_data()::text'),
      await scalar<string>(tx, 'select public.my_reservations()::text'),
      await scalar<string>(tx, 'select public.get_me()::text'),
    ])
    for (const txt of hostTexts) for (const id of ids) expect(txt).not.toContain(id)
    const memberText = await t.asUser(s.c, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [s.occasionId]))
    for (const id of ids) expect(memberText).not.toContain(id)
    const mine = await t.asUser(s.b, (tx) => scalar<string>(tx, 'select public.my_reservations()::text'))
    for (const id of ids) expect(mine).not.toContain(id)
    expect(mine).not.toContain(s.c)
    expect(mine).not.toContain(s.a)
  })

  it('the superuser-only columns of reservations are not reachable through any RPC text for any role', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    const [resId, snapshot] = await t.db
      .query<{ id: string; wish_title_snapshot: string }>('select id, wish_title_snapshot from reservations where wish_id = $1', [s.w1])
      .then((r) => [r.rows[0]!.id, r.rows[0]!.wish_title_snapshot] as const)
    expect(snapshot).toBe(WISH_TITLES.w1)
    for (const uid of [s.a, s.c, s.d]) {
      const texts = await t.asUser(uid, async (tx) => [
        await scalar<string>(tx, 'select public.get_feed()::text'),
        await scalar<string>(tx, 'select public.export_my_data()::text'),
        await scalar<string>(tx, 'select public.my_reservations()::text'),
      ])
      for (const txt of texts) {
        expect(txt, uid).not.toContain(resId)
        // (recipient_id is a legitimate column of the host's OWN wishlist row in the export, so it is not in this list)
        expect(txt, uid).not.toMatch(/reserver_id|wish_title_snapshot|ended_at|end_reason/)
      }
    }
    await expectDbError(t.asUser(s.a, (tx) => tx.query('select wish_title_snapshot from reservations')), '42501')
  })
})
