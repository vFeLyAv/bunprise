/**
 * "Anzahl" (quantity) and "Passt zusammen" (linked wishes) — 20261030120000_wish_quantity_together.sql, Felix 30.10.
 * The world: test/lists/shared-seed.ts (Paula owner; L1 followers list: Finn, Greta; L2 "Nur ich"; O1 with OL: guests
 * Moritz and Greta). Here additionally W5 "Geheim" lives only in L2 ("Nur ich") — nobody but Paula reads it.
 * Links used below: W4 (OL) <-> W3 (L1) and W4 <-> W5 (L2).
 *   Paula (owner)   sees both partners of W4.
 *   Greta           reads W3 (follower) and W4 (guest): together of W4 = [W3]; W5 is never named.
 *   Moritz          reads W4 only (guest): together of W4 = [] — not a hint that more exists.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { expectRpcError, rpc } from '../pilot/seed'
import { rpcText } from '../follows/seed'
import { seedShared, type SharedSeed } from './shared-seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface Together { id: string; title: string; reserved?: boolean; reserved_by_me?: boolean }
interface Wish { id: string; title: string; quantity: number; together: Together[] | null; reserved: boolean | null; reserved_by_me: boolean | null }
interface Occ { wishlist: { wishes: Wish[]; received: Wish[] } }
interface ListScreen { wishes: Wish[]; received: Wish[] }

async function setSwitches(on: { quantity?: boolean; together?: boolean }): Promise<void> {
  if (on.quantity !== undefined) await t.db.query('update private.features set wish_quantity = $1', [on.quantity])
  if (on.together !== undefined) await t.db.query('update private.features set wish_together = $1', [on.together])
}

interface World extends SharedSeed { w5: string }

async function world(): Promise<World> {
  const s = await seedShared(t)
  const w5 = await scalar<string>(t.db, `insert into public.wishes (wishlist_id, title) values ($1, 'Geheim') returning id`, [s.l2])
  await setSwitches({ quantity: true, together: true })
  expect(await rpc(t, s.paula, 'set_wish_links', [s.w4, [s.w3, w5]])).toEqual({ ok: true, linked: 2 })
  return { ...s, w5 }
}

const occWish = async (uid: string, s: SharedSeed, wish: string) =>
  (await rpc<Occ>(t, uid, 'get_occasion_screen', [s.o1])).wishlist.wishes.find((w) => w.id === wish)
const listWish = async (uid: string, list: string, wish: string) =>
  (await rpc<ListScreen>(t, uid, 'get_list_screen', [list])).wishes.find((w) => w.id === wish)

describe('catalog', () => {
  it('wish_links lives in private: RLS forced, no policy, no privilege for any API role', async () => {
    expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'private.wish_links'::regclass`)).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true },
    ])
    expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'private' and tablename = 'wish_links'`)).toEqual([])
    for (const who of ['anon', 'authenticated', 'public']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege($1, 'private.wish_links', $2)`, [who, priv]), `${who} ${priv}`).toBe(false)
      }
    }
  })

  it('both switches ship OFF', async () => {
    // a fresh database (this file flips them per test world; read the column defaults)
    expect(await rows(t.db, `select column_name, column_default from information_schema.columns
      where table_schema = 'private' and table_name = 'features' and column_name in ('wish_quantity', 'wish_together') order by 1`)).toEqual([
      { column_name: 'wish_quantity', column_default: 'false' },
      { column_name: 'wish_together', column_default: 'false' },
    ])
  })

  it('no function of the owner side names the reservation table', async () => {
    for (const fn of ['set_wish_links']) {
      expect((await scalar<string>(t.db, `select prosrc from pg_proc where proname = $1`, [fn])).replace(/--[^\n]*/g, ''), fn).not.toMatch(/reservation/i)
    }
    for (const fn of ['wish_links_for_owner', 'linked_wish_ids', 'wish_quantity_guard', 'wish_detail_fields', 'my_wishlists_export']) {
      expect((await scalar<string>(t.db, `select prosrc from pg_proc where proname = $1`, [fn])).replace(/--[^\n]*/g, ''), fn).not.toMatch(/reservations/i)
    }
    // reserve_together only ever reaches reservations through reserve_wish
    const body = (await scalar<string>(t.db, `select prosrc from pg_proc where proname = 'reserve_together'`)).replace(/--[^\n]*/g, '')
    expect(body).not.toMatch(/public\.reservations/)
    expect(body).toContain('public.reserve_wish(')
  })
})

describe('A) quantity', () => {
  let s: World
  beforeAll(async () => {
    s = await world()
  })

  it('default 1; the owner sets 4 through REST; every reader sees it; 0 and 11 are refused by the CHECK', async () => {
    const fresh = await t.asUser(s.paula, (tx) => scalar<number>(tx, `insert into wishes (wishlist_id, title) values ($1, 'AirTag') returning quantity`, [s.l1]))
    expect(fresh).toBe(1)
    expect(await t.asUser(s.paula, (tx) => scalar<number>(tx, `update wishes set quantity = 4 where id = $1 returning quantity`, [s.w4]))).toBe(4)
    expect((await occWish(s.paula, s, s.w4))?.quantity).toBe(4)
    expect((await occWish(s.moritz, s, s.w4))?.quantity).toBe(4)
    for (const bad of [0, 11]) {
      await expectDbError(t.asUser(s.paula, (tx) => tx.query(`update wishes set quantity = $2 where id = $1`, [s.w4, bad])), '23514')
    }
    // a guest cannot write it (RLS: wishes_update is owner-only — no row changes)
    expect(await t.asUser(s.moritz, (tx) => tx.query(`update wishes set quantity = 9 where id = $1`, [s.w4]).then((r) => r.affectedRows))).toBe(0)
    // insert with a quantity
    expect(await t.asUser(s.paula, (tx) => scalar<number>(tx, `insert into wishes (wishlist_id, title, quantity) values ($1, 'Socken', 3) returning quantity`, [s.l1]))).toBe(3)
  })

  it('the switch off: a new value other than 1 is refused (insert and update); 1 and other columns still work; stored values stay', async () => {
    await setSwitches({ quantity: false })
    try {
      await expectRpcError(t.asUser(s.paula, (tx) => tx.query(`update wishes set quantity = 5 where id = $1`, [s.w4])), 'not_allowed')
      await expectRpcError(t.asUser(s.paula, (tx) => tx.query(`insert into wishes (wishlist_id, title, quantity) values ($1, 'X', 2)`, [s.l1])), 'not_allowed')
      expect(await t.asUser(s.paula, (tx) => tx.query(`insert into wishes (wishlist_id, title, quantity) values ($1, 'Y', 1)`, [s.l1]).then((r) => r.affectedRows))).toBe(1)
      expect(await t.asUser(s.paula, (tx) => tx.query(`update wishes set title = 'Gartenstuhl blau', quantity = 4 where id = $1`, [s.w4]).then((r) => r.affectedRows))).toBe(1)
      expect((await occWish(s.moritz, s, s.w4))?.quantity).toBe(4)
    } finally {
      await setSwitches({ quantity: true })
    }
  })

  it('the quantity rides along in "Ideen" (get_free_wishes) and in the owner\'s export', async () => {
    const ideas = await rpc<{ ideas: { wish_id: string; quantity: number }[] }>(t, s.moritz, 'get_free_wishes', [s.paula, null])
    expect(ideas.ideas.find((i) => i.wish_id === s.w4)?.quantity).toBe(4)
    const exported = await rpc<{ wishlists: { wishes: { id: string; quantity: number; together: string[] }[] }[] }>(t, s.paula, 'export_my_data')
    const all = exported.wishlists.flatMap((l) => l.wishes)
    expect(all.find((w) => w.id === s.w4)?.quantity).toBe(4)
    expect(all.find((w) => w.id === s.w4)?.together).toEqual([s.w3, s.w5].sort())
    expect(all.find((w) => w.id === s.w5)?.together).toEqual([s.w4])
  })
})

describe('B) set_wish_links (the owner)', () => {
  let s: World
  beforeAll(async () => {
    s = await world()
  })

  it('links are undirected: W3 shows W4, W5 shows W4; replacing the partners of W4 drops the old ones', async () => {
    expect((await listWish(s.paula, s.l1, s.w3))?.together).toEqual([{ id: s.w4, title: 'Gartenstuhl' }])
    expect((await listWish(s.paula, s.l2, s.w5))?.together).toEqual([{ id: s.w4, title: 'Gartenstuhl' }])
    expect(await rpc(t, s.paula, 'set_wish_links', [s.w4, [s.w5]])).toEqual({ ok: true, linked: 1 })
    expect((await listWish(s.paula, s.l1, s.w3))?.together).toEqual([])
    expect(await rpc(t, s.paula, 'set_wish_links', [s.w4, []])).toEqual({ ok: true, linked: 0 })
    expect((await listWish(s.paula, s.l2, s.w5))?.together).toEqual([])
    expect(await rpc(t, s.paula, 'set_wish_links', [s.w4, [s.w3, s.w5, s.w3]])).toEqual({ ok: true, linked: 2 })
  })

  it('refusals: validation (null, itself, more than 10), not_found (not hers / gone), not_allowed (switch off)', async () => {
    await expectRpcError(rpc(t, s.paula, 'set_wish_links', [s.w4, null]), 'validation')
    await expectRpcError(rpc(t, s.paula, 'set_wish_links', [s.w4, [null]]), 'validation')
    await expectRpcError(rpc(t, s.paula, 'set_wish_links', [s.w4, [s.w4]]), 'validation')
    await expectRpcError(rpc(t, s.paula, 'set_wish_links', [s.w4, Array.from({ length: 11 }, () => s.w3)]), 'validation')
    // a foreign wish: Moritz's own list wish O2 is not Paula's
    const foreign = await scalar<string>(t.db, `insert into public.wishes (wishlist_id, title) values ($1, 'Fremd') returning id`, [s.o2List])
    await expectRpcError(rpc(t, s.paula, 'set_wish_links', [s.w4, [foreign]]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'set_wish_links', [foreign, [s.w4]]), 'not_found')
    // a guest cannot link the host's wishes (one answer: not_found)
    await expectRpcError(rpc(t, s.moritz, 'set_wish_links', [s.w4, [s.w1]]), 'not_found')
    await setSwitches({ together: false })
    try {
      await expectRpcError(rpc(t, s.paula, 'set_wish_links', [s.w4, [s.w3]]), 'not_allowed')
    } finally {
      await setSwitches({ together: true })
    }
  })

  it('at most 10 partners per wish (also on the partner\'s side): limit_reached, nothing changes', async () => {
    const extra: string[] = []
    for (let i = 0; i < 10; i++) {
      extra.push(await t.asUser(s.paula, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, $2) returning id`, [s.l1, `Teil ${i}`])))
    }
    // replacing W3's partners drops W3 <-> W4: W3 has exactly 10 now
    expect(await rpc(t, s.paula, 'set_wish_links', [s.w3, extra])).toEqual({ ok: true, linked: 10 })
    expect((await listWish(s.paula, s.l1, s.w3))?.together?.length).toBe(10)
    // linking W4 to W3 again would give W3 an 11th partner: refused, and W4 keeps its old partner (rolled back)
    await expectRpcError(rpc(t, s.paula, 'set_wish_links', [s.w4, [s.w3]]), 'limit_reached')
    expect((await listWish(s.paula, s.l1, s.w3))?.together?.length).toBe(10)
    expect((await occWish(s.paula, s, s.w4))?.together).toEqual([{ id: s.w5, title: 'Geheim' }])
  })

  it('deleting a wish removes its links (cascade)', async () => {
    const a = await t.asUser(s.paula, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, 'A') returning id`, [s.l1]))
    const b = await t.asUser(s.paula, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, 'B') returning id`, [s.l1]))
    expect(await rpc(t, s.paula, 'set_wish_links', [a, [b]])).toEqual({ ok: true, linked: 1 })
    await t.asUser(s.paula, (tx) => tx.query('delete from wishes where id = $1', [b]))
    expect(await scalar<number>(t.db, `select count(*)::int from private.wish_links where wish_a = $1 or wish_b = $1`, [a])).toBe(0)
  })
})

describe('B) what each viewer sees of the links', () => {
  let s: World
  beforeAll(async () => {
    s = await world()
  })

  it('owner: every partner by name; Greta: only the partner she reads; Moritz: none — never the hidden one, not even a count', async () => {
    expect((await occWish(s.paula, s, s.w4))?.together).toEqual([
      { id: s.w3, title: 'Teekanne' },
      { id: s.w5, title: 'Geheim' },
    ]) // order: created_at (W3 before W5)
    expect((await occWish(s.greta, s, s.w4))?.together).toEqual([{ id: s.w3, title: 'Teekanne', reserved: false, reserved_by_me: false }])
    expect((await occWish(s.moritz, s, s.w4))?.together).toEqual([])
    // the hidden wish's id and title appear nowhere in the guests' answers
    for (const who of [s.greta, s.moritz]) {
      const text = await rpcText(t, who, 'get_occasion_screen', [s.o1])
      expect(text, who).not.toContain(s.w5)
      expect(text, who).not.toContain('Geheim')
    }
    // a follower (Finn) on L1: W3's partner W4 lives in OL, which Finn cannot read -> []
    expect((await listWish(s.finn, s.l1, s.w3))?.together).toEqual([])
    // Greta on L1 reads W4 through O1 -> named
    expect((await listWish(s.greta, s.l1, s.w3))?.together).toEqual([{ id: s.w4, title: 'Gartenstuhl', reserved: false, reserved_by_me: false }])
  })

  it('a partner reserved by somebody else / by me shows as such; a received partner is left out', async () => {
    expect(await rpc(t, s.finn, 'reserve_wish', [s.w3])).toEqual({ ok: true })
    expect((await occWish(s.greta, s, s.w4))?.together).toEqual([{ id: s.w3, title: 'Teekanne', reserved: true, reserved_by_me: false }])
    expect(await rpc(t, s.finn, 'cancel_reservation', [s.w3])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'reserve_wish', [s.w3])).toEqual({ ok: true })
    expect((await occWish(s.greta, s, s.w4))?.together).toEqual([{ id: s.w3, title: 'Teekanne', reserved: true, reserved_by_me: true }])
    expect(await rpc(t, s.greta, 'cancel_reservation', [s.w3])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'set_wish_received', [s.w3, true])).toMatchObject({ ok: true })
    expect((await occWish(s.greta, s, s.w4))?.together).toEqual([])
    expect(await rpc(t, s.paula, 'set_wish_received', [s.w3, false])).toMatchObject({ ok: true })
  })

  it('the switch off: `together` is null for everybody; the links stay', async () => {
    await setSwitches({ together: false })
    try {
      expect((await occWish(s.paula, s, s.w4))?.together).toBeNull()
      expect((await occWish(s.greta, s, s.w4))?.together).toBeNull()
    } finally {
      await setSwitches({ together: true })
    }
    expect((await occWish(s.greta, s, s.w4))?.together).toHaveLength(1)
  })
})

describe('B) reserve_together (a giver)', () => {
  let s: World
  beforeEach(async () => {
    s = await world()
  })

  const active = (wish: string) =>
    scalar<string[]>(t.db, `select coalesce(array_agg(reserver_id::text), '{}') from public.reservations where wish_id = $1 and status = 'active'`, [wish])

  it('both at once: Greta reserves W4 + W3 in one call', async () => {
    expect(await rpc(t, s.greta, 'reserve_together', [s.w4, [s.w3]])).toEqual({ ok: true, reserved: 2 })
    expect(await active(s.w4)).toEqual([s.greta])
    expect(await active(s.w3)).toEqual([s.greta])
    // again: idempotent like reserve_wish
    expect(await rpc(t, s.greta, 'reserve_together', [s.w4, [s.w3]])).toEqual({ ok: true, reserved: 2 })
    // each wish stays reservable alone (cancel one, reserve it alone)
    expect(await rpc(t, s.greta, 'cancel_reservation', [s.w3])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'reserve_wish', [s.w3])).toEqual({ ok: true })
  })

  it('all or nothing: a partner already reserved by somebody else -> already_reserved and NOTHING is reserved', async () => {
    expect(await rpc(t, s.finn, 'reserve_wish', [s.w3])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, [s.w3]]), 'already_reserved')
    expect(await active(s.w4)).toEqual([])
    expect(await active(s.w3)).toEqual([s.finn])
  })

  it('all or nothing: a received partner -> not_allowed, nothing reserved', async () => {
    expect(await rpc(t, s.paula, 'set_wish_received', [s.w3, true])).toMatchObject({ ok: true })
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, [s.w3]]), 'not_allowed')
    expect(await active(s.w4)).toEqual([])
  })

  it('the owner: not_allowed before anything else (also with a hidden partner, also with bad partners)', async () => {
    await expectRpcError(rpc(t, s.paula, 'reserve_together', [s.w4, [s.w3]]), 'not_allowed')
    await expectRpcError(rpc(t, s.paula, 'reserve_together', [s.w4, [s.w5]]), 'not_allowed')
    await expectRpcError(rpc(t, s.paula, 'reserve_together', [s.w4, [s.w1]]), 'not_allowed')
    expect(await active(s.w4)).toEqual([])
  })

  it('a partner the giver cannot read: not_found — the same as an unknown id; not linked: validation', async () => {
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, [s.w5]]), 'not_found')
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, ['00000000-0000-4000-8000-000000000000']]), 'not_found')
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, [s.w1]]), 'validation') // readable, not linked
    // Moritz cannot read W3 (follower list): one answer
    await expectRpcError(rpc(t, s.moritz, 'reserve_together', [s.w4, [s.w3]]), 'not_found')
    // the wish itself unreadable (Xaver, a stranger): reserve_wish's code, before its partners
    await expectRpcError(rpc(t, s.xaver, 'reserve_together', [s.w4, [s.w3]]), 'not_allowed')
    await expectRpcError(rpc(t, s.xaver, 'reserve_together', [s.w4, [s.w5]]), 'not_allowed')
    expect(await active(s.w4)).toEqual([])
  })

  it('input: validation (null, nothing besides the wish, more than 10 = the most links a wish can have); the switch off: not_allowed', async () => {
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, null]), 'validation')
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, []]), 'validation')
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, [s.w4]]), 'validation')
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, [null]]), 'validation')
    await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, Array.from({ length: 11 }, () => s.w3)]), 'validation')
    await setSwitches({ together: false })
    try {
      await expectRpcError(rpc(t, s.greta, 'reserve_together', [s.w4, [s.w3]]), 'not_allowed')
    } finally {
      await setSwitches({ together: true })
    }
  })

  it('the cap of 5 for lists without an occasion applies per wish; a refusal rolls the whole call back', async () => {
    // Finn (follower only) holds 4 counted reservations on L1; W3 + another L1 wish would be the 5th and 6th
    const extra: string[] = []
    for (let i = 0; i < 5; i++) {
      extra.push(await t.asUser(s.paula, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, $2) returning id`, [s.l1, `Cap ${i}`])))
    }
    for (const w of extra.slice(0, 4)) expect(await rpc(t, s.finn, 'reserve_wish', [w])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'set_wish_links', [s.w3, [extra[4]!]])).toEqual({ ok: true, linked: 1 })
    await expectRpcError(rpc(t, s.finn, 'reserve_together', [s.w3, [extra[4]!]]), 'limit_reached')
    expect(await active(s.w3)).toEqual([])
    expect(await active(extra[4]!)).toEqual([])
  })
})

