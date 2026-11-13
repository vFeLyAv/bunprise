/**
 * One wish in several lists (docs/spec/shared-wishes-design.md; supabase/migrations/20261027200000_shared_wishes.sql)
 * on PGlite: the catalog (SW01), the owner's writes and their codes (SW03–SW09), who sees what (§3.3, SW04 / SW19),
 * ONE reservation across places (SW05), losing a place (SW06), the REST guard of old apps (SW31), deleting a list
 * (SW09), the "hide the extra places" switch (SW30) and the free wishes (SW19). World: ./shared-seed.ts.
 * The secrecy counters (INV-7) live in shared-wishes-secrecy.test.ts, the jobs in shared-wishes-jobs.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { execAs, expectRpcError, queryAs, rpc } from '../pilot/seed'
import { L1_TITLE, O1_TITLE, addWish, createList, rpcOutcome } from '../follows/seed'
import { checkInvariants, ownerSnapshot, runCleanupPass } from '../follows/invariants'
import { W_TITLES, homeOf, placesOf, seedShared, setSharedSwitch, setSharedVisible, type SharedSeed } from './shared-seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

type Json = Record<string, unknown>
interface Place { id: string | null; title: string | null; kind: string; occasion_id?: string | null; home?: boolean; paused?: boolean }
interface Wish extends Json { id: string; reserved: boolean | null; reserved_by_me: boolean | null; also_in: Place[] | null; home?: boolean; paused?: boolean }
interface Occ { wishlist: { wishes: Wish[]; received: Wish[]; received_prompt?: boolean } }
interface ListScreen { wishes: Wish[]; received: Wish[] }

const occ = (uid: string, s: SharedSeed) => rpc<Occ>(t, uid, 'get_occasion_screen', [s.o1])
const list = (uid: string, id: string) => rpc<ListScreen>(t, uid, 'get_list_screen', [id])
const byId = (ws: readonly Wish[], id: string) => ws.find((w) => w.id === id)
const ids = (ws: readonly Wish[]) => ws.map((w) => w.id).sort()
const flags = (w: Wish | undefined) => (w ? [w.reserved, w.reserved_by_me] : undefined)
const HIDDEN: Place = { id: null, title: null, kind: 'hidden' }

describe('SW01 catalog', () => {
  it('the places live in private: RLS forced, no policy, no privilege for any API role; no FK on reservations', async () => {
    for (const table of ['wish_placements', 'occasion_prompts', 'maintenance_state']) {
      expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass`, [`private.${table}`]), table).toEqual([
        { relrowsecurity: true, relforcerowsecurity: true },
      ])
      expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'private' and tablename = $1`, [table])).toEqual([])
      for (const who of ['anon', 'authenticated', 'public']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          expect(await scalar<boolean>(t.db, `select has_table_privilege($1, $2, $3)`, [who, `private.${table}`, priv]), `${who} ${priv} ${table}`).toBe(false)
        }
      }
    }
    expect(await scalar<number>(t.db, `select count(*)::int from pg_constraint where conrelid = 'public.reservations'::regclass and contype = 'f'`)).toBe(0)
    expect(await scalar<number>(t.db, `select count(*)::int from pg_trigger where tgname = 'wish_before_delete'`)).toBe(0)
  })

  it('INSERT on wishes: no id, created_at, updated_at, received_at through REST (SW34)', async () => {
    for (const col of ['id', 'created_at', 'updated_at', 'received_at']) {
      expect(await scalar<boolean>(t.db, `select has_column_privilege('authenticated', 'public.wishes', $1, 'insert')`, [col]), col).toBe(false)
    }
    for (const col of ['wishlist_id', 'title', 'price_cents', 'url', 'note', 'priority', 'description', 'brand', 'color', 'gtin', 'shop_name']) {
      expect(await scalar<boolean>(t.db, `select has_column_privilege('authenticated', 'public.wishes', $1, 'insert')`, [col]), col).toBe(true)
    }
  })

  it('the REST delete guard fires only for the API roles (WHEN current_user in anon, authenticated)', async () => {
    const def = await scalar<string>(t.db, `select pg_get_triggerdef(oid) from pg_trigger where tgname = 'wish_aa_shared_delete_guard'`)
    expect(def).toMatch(/BEFORE DELETE ON public\.wishes FOR EACH ROW WHEN \(.*CURRENT_USER.*'anon'.*'authenticated'.*\)/i)
    expect(await scalar<boolean>(t.db, `select prosecdef from pg_proc where proname = 'wish_shared_delete_guard'`)).toBe(true)
  })

  it('only the place helpers and the writers name the table of places (design §3.1 meta-test)', async () => {
    const fns = await rows<{ fn: string }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosrc ~ 'wish_placements' order by 1`,
    )
    expect(fns.map((f) => f.fn)).toEqual([
      // writers
      'private.unlink_past_occasion_places_run', 'private.wish_after_insert', 'private.wish_shared_delete_guard', 'private.wishlist_before_delete',
      'public.add_wishes_to_list', 'public.move_wish', 'public.remove_wish_from_list',
      // readers: the helpers (stored = owner, effective = audience), the owner's export, the admin check
      'private.can_read_wish', 'private.effective_list_wishes', 'private.is_effective_placement', 'private.list_new_wish_count',
      'private.list_wish_count', 'private.my_wishlists_export', 'private.owner_list_wishes', 'private.reads_wish_via_occasion',
      'private.reservation_place', 'private.shared_wishes_health', 'private.wish_places_for_owner', 'private.wish_places_for_viewer',
    ].sort())
  })

  it('every function that reads reservations for a giver plans without sequential scans (INV-7 b)', async () => {
    for (const fn of ['public.reserve_wish', 'public.cancel_reservation', 'public.my_reservations', 'private.my_reservations_export',
      'public.get_free_wishes', 'public.get_feed', 'private.list_wish_objects', 'private.end_own_dead_reservations']) {
      const cfg = await scalar<string[]>(t.db, `select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = $1`, [fn])
      expect(cfg, fn).toContain('enable_seqscan=off')
    }
  })
})

describe('SW03 add_wishes_to_list: the owner, her own wishes, one occasion list', () => {
  let s: SharedSeed
  beforeAll(async () => {
    s = await seedShared(t)
  })

  it('the seed: W1 and W2 live in their home AND in OL; the answer is constant ("Schon drin" = added 0)', async () => {
    expect(await placesOf(t, s.w1)).toEqual([{ wishlist_id: s.l1, home: true }, { wishlist_id: s.o1List, home: false }])
    expect(await placesOf(t, s.w2)).toEqual([{ wishlist_id: s.l2, home: true }, { wishlist_id: s.o1List, home: false }])
    expect(await rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [s.w1, s.w2, s.w1]])).toEqual({ ok: true, added: 0 })
    expect(await rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [s.w4]])).toEqual({ ok: true, added: 0 }) // its home
    await checkInvariants(t)
  })

  it('validation first: empty, null inside, more than 50', async () => {
    for (const ids of [[], [null], Array.from({ length: 51 }, () => s.w3)]) {
      await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, ids]), 'validation')
    }
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, null]), 'validation')
  })

  it('not_found: somebody else\'s list, a list without an occasion, an unknown list, somebody else\'s wish', async () => {
    await expectRpcError(rpc(t, s.moritz, 'add_wishes_to_list', [s.o1List, [s.w3]]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.l2, [s.w3]]), 'not_found') // not an occasion list
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.o2List, [s.w3]]), 'not_found') // Moritz's occasion
    const moritzWish = await addWish(t, s.moritz, s.o2List, 'Brettspiel')
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [s.w3, moritzWish]]), 'not_found')
    expect(await placesOf(t, s.w3)).toEqual([{ wishlist_id: s.l1, home: true }]) // all or nothing
  })

  it('validation: a received wish (Q5), a wish whose home is an occasion (Q2/Q3)', async () => {
    const [o3, o3List] = await createOccasionFor(s.paula, 'Zweiter Anlass')
    expect(o3).toBeTruthy()
    await rpc(t, s.paula, 'set_wish_received', [s.w3, true])
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [s.w3]]), 'validation')
    await rpc(t, s.paula, 'set_wish_received', [s.w3, false])
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [o3List, [s.w4]]), 'validation') // W4's home is OL
  })

  it('at most 10 places per wish (Q10): the 11th is limit_reached', async () => {
    const extra = await addWish(t, s.paula, s.l1, 'Viele Orte')
    for (let i = 0; i < 9; i++) {
      const [, ol] = await createOccasionFor(s.paula, `Anlass ${i}`)
      expect(await rpc(t, s.paula, 'add_wishes_to_list', [ol, [extra]])).toEqual({ ok: true, added: 1 })
    }
    const [, last] = await createOccasionFor(s.paula, 'Anlass zu viel')
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [last, [extra]]), 'limit_reached')
    expect(await placesOf(t, extra)).toHaveLength(10)
  })

  it('the switch off: not_allowed (nothing is added); the current legal records are needed', async () => {
    await setSharedSwitch(t, false)
    try {
      await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [s.w3]]), 'not_allowed')
    } finally {
      await setSharedSwitch(t, true)
    }
    await t.db.query(`delete from consents where profile_id = $1`, [s.paula])
    try {
      await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [s.w3]]), 'consent_required')
    } finally {
      await t.db.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [s.paula])
    }
    expect(await placesOf(t, s.w3)).toEqual([{ wishlist_id: s.l1, home: true }])
  })
})

async function createOccasionFor(host: string, title: string): Promise<[string, string]> {
  const occasionId = await t.asUser(host, (tx) =>
    scalar<string>(tx, `insert into occasions (host_id, title, starts_at, tz) values ($1, $2, now() + interval '20 days', 'Europe/Berlin') returning id`, [host, title]),
  )
  return [occasionId, await scalar<string>(t.db, 'select id from wishlists where occasion_id = $1', [occasionId])]
}

describe('SW04 / §3.3 who sees what', () => {
  let s: SharedSeed
  beforeAll(async () => {
    s = await seedShared(t)
  })

  it('Paula on O1: W1, W2, W4 by her stored places; literal nulls; also_in, home, paused; never a reservation', async () => {
    const o = await occ(s.paula, s)
    expect(ids(o.wishlist.wishes)).toEqual([s.w1, s.w2, s.w4].sort())
    const w1 = byId(o.wishlist.wishes, s.w1)!
    expect(w1).toMatchObject({ reserved: null, reserved_by_me: null, home: false, paused: false })
    expect(w1.also_in).toEqual([{ id: s.l1, title: L1_TITLE, kind: 'standalone', occasion_id: null, home: true, paused: false }])
    expect(byId(o.wishlist.wishes, s.w2)!.also_in).toEqual([{ id: s.l2, title: 'Privat', kind: 'standalone', occasion_id: null, home: true, paused: false }])
    expect(byId(o.wishlist.wishes, s.w4)).toMatchObject({ home: true, also_in: [] })
    expect(o.wishlist.received_prompt).toBe(false)
    // and on L1: W1 says "auch in Paulas Gartenfest"
    const l1 = await list(s.paula, s.l1)
    expect(byId(l1.wishes, s.w1)!.also_in).toEqual([{ id: s.o1List, title: O1_TITLE, kind: 'occasion', occasion_id: s.o1, home: false, paused: false }])
  })

  it('Moritz (guest only): W1, W2, W4; the other lists only as ONE hidden entry; no received_prompt key', async () => {
    const o = await occ(s.moritz, s)
    expect(ids(o.wishlist.wishes)).toEqual([s.w1, s.w2, s.w4].sort())
    expect(byId(o.wishlist.wishes, s.w1)!.also_in).toEqual([HIDDEN])
    expect(byId(o.wishlist.wishes, s.w2)!.also_in).toEqual([HIDDEN])
    expect(byId(o.wishlist.wishes, s.w4)!.also_in).toEqual([])
    expect(o.wishlist).not.toHaveProperty('received_prompt')
    for (const w of o.wishlist.wishes) expect(w).not.toHaveProperty('home')
  })

  it('Greta (follower + guest): W1 names "Meine Wünsche", W2 stays hidden', async () => {
    const o = await occ(s.greta, s)
    expect(byId(o.wishlist.wishes, s.w1)!.also_in).toEqual([{ id: s.l1, title: L1_TITLE, kind: 'standalone' }])
    expect(byId(o.wishlist.wishes, s.w2)!.also_in).toEqual([HIDDEN])
  })

  it('Finn (follower only) on L1: W1, W3 — no hints for followers (also_in null); O1 is not_found for him', async () => {
    const l1 = await list(s.finn, s.l1)
    expect(ids(l1.wishes)).toEqual([s.w1, s.w3, s.l1Wishes[1]].sort())
    for (const w of l1.wishes) expect(w.also_in).toBeNull()
    expect(await rpcOutcome(t, s.finn, 'get_occasion_screen', [s.o1])).toBe('error:P0001:not_found')
  })

  it('REST: a wish is readable through any effective place (Moritz reads W1 and W2, not W3); outsiders nothing', async () => {
    const read = (uid: string) => queryAs<{ id: string }>(t, uid, 'select id from wishes where id = any($1::uuid[]) order by id', [[s.w1, s.w2, s.w3, s.w4]])
    expect((await read(s.moritz)).map((r) => r.id)).toEqual([s.w1, s.w2, s.w4].sort())
    expect((await read(s.finn)).map((r) => r.id)).toEqual([s.w1, s.w3].sort())
    expect(await read(s.xaver)).toEqual([])
    expect(await read(s.bea)).toEqual([])
    // the list rows stay behind their own rule: Moritz does not read L2 or L1
    expect(await queryAs(t, s.moritz, 'select id from wishlists where id = any($1::uuid[])', [[s.l1, s.l2]])).toEqual([])
    // and the photo of W2 follows the wish's readers
    await rpc(t, s.paula, 'set_wish_photo', [s.w2, 'image/webp', 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=', 1, 1]).catch(() => null)
    expect(await rpcOutcome(t, s.xaver, 'get_wish_photo', [s.w2])).toBe('error:P0001:not_found')
  })
})

describe('SW05 one reservation for every place', () => {
  it('Moritz reserves W1 on O1 → Finn sees it taken on L1, may not take it; Paula\'s world does not move', async () => {
    const s = await seedShared(t)
    const opts = { occasionIds: [s.o1, s.o2], listIds: [s.l1, s.l2], profileIds: [s.finn, s.moritz] }
    const before = await ownerSnapshot(t, s.paula, opts)
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect(flags(byId((await occ(s.moritz, s)).wishlist.wishes, s.w1))).toEqual([true, true])
    expect(flags(byId((await list(s.finn, s.l1)).wishes, s.w1))).toEqual([true, false])
    expect(flags(byId((await occ(s.greta, s)).wishlist.wishes, s.w1))).toEqual([true, false])
    await expectRpcError(rpc(t, s.finn, 'reserve_wish', [s.w1]), 'already_reserved')
    await expectRpcError(rpc(t, s.greta, 'reserve_wish', [s.w1]), 'already_reserved')
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true }) // idempotent
    expect(await ownerSnapshot(t, s.paula, opts)).toEqual(before) // 🔒 the owner sees nothing
    // Moritz's history shows the place he reads it in: the occasion
    expect((await rpc<Json[]>(t, s.moritz, 'my_reservations'))[0]).toMatchObject({ wish_id: s.w1, status: 'active', occasion_id: s.o1, list: null })
    // Greta reads W1 in both: her reservation shows the home first (L1)
    expect(await rpc(t, s.moritz, 'cancel_reservation', [s.w1])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect((await rpc<Json[]>(t, s.greta, 'my_reservations'))[0]).toMatchObject({ wish_id: s.w1, status: 'active', occasion_id: null, list: { id: s.l1, title: L1_TITLE } })
    expect(await ownerSnapshot(t, s.paula, opts)).toEqual(before)
    await checkInvariants(t)
  })

  it('the cap of 5 (Q8): a reservation the giver reaches through an occasion never counts; Finn (follower only) counts', async () => {
    const s = await seedShared(t)
    const more = [] as string[]
    for (let i = 0; i < 6; i++) more.push(await addWish(t, s.paula, s.l1, `Extra ${i}`))
    // Greta holds W1 (she also reads it in O1): not counted — she still gets 5 more on L1
    expect(await rpc(t, s.greta, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    for (const w of more.slice(0, 5)) expect(await rpc(t, s.greta, 'reserve_wish', [w])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.greta, 'reserve_wish', [more[5]!]), 'limit_reached')
    // ...and an occasion wish is never limited
    expect(await rpc(t, s.greta, 'reserve_wish', [s.w4])).toEqual({ ok: true })
  })

  it('leaving the occasion trims the cap (Codex 27.10 #2): of 6 shared reservations that now count, the oldest 5 stay', async () => {
    const s = await seedShared(t)
    const shared = [] as string[]
    for (let i = 0; i < 6; i++) shared.push(await addWish(t, s.paula, s.l1, `Geteilt ${i}`))
    expect(await rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, shared])).toEqual({ ok: true, added: 6 })
    // Greta (follower + guest) reaches all six through O1: none counts, so all six are hers
    for (const w of shared) expect(await rpc(t, s.greta, 'reserve_wish', [w])).toEqual({ ok: true })
    expect(await rpc(t, s.greta, 'leave_occasion', [s.o1])).toEqual({ ok: true })
    // through L1 they stay live and now count: the newest one ends as member_left
    const mine = await rpc<Json[]>(t, s.greta, 'my_reservations')
    const active = mine.filter((r) => r.status === 'active').map((r) => r.wish_id)
    expect(active.sort()).toEqual(shared.slice(0, 5).sort())
    expect(mine.find((r) => r.status === 'ended' && r.end_reason === 'member_left' && r.wish_title === 'Geteilt 5')).toBeDefined()
    await expectRpcError(rpc(t, s.greta, 'reserve_wish', [shared[5]!]), 'limit_reached')
    // the cleanup changes nothing more, and the owner's world does not move with it
    const before = await ownerSnapshot(t, s.paula)
    await runCleanupPass(t)
    expect(await ownerSnapshot(t, s.paula)).toEqual(before)
    expect((await rpc<Json[]>(t, s.greta, 'my_reservations')).filter((r) => r.status === 'active')).toHaveLength(5)
    await checkInvariants(t)
  })
})

describe('SW06 a place goes, the wish stays', () => {
  it('remove W1 from OL: Moritz\'s reservation is dead at once (unavailable), Greta\'s view in L1 unchanged', async () => {
    const s = await seedShared(t)
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'remove_wish_from_list', [s.w1, s.o1List])).toEqual({ ok: true })
    expect(await placesOf(t, s.w1)).toEqual([{ wishlist_id: s.l1, home: true }])
    expect(byId((await occ(s.moritz, s)).wishlist.wishes, s.w1)).toBeUndefined()
    expect((await rpc<Json[]>(t, s.moritz, 'my_reservations'))[0]).toMatchObject({ wish_id: null, status: 'ended', end_reason: 'unavailable', wish_title: W_TITLES.w1, occasion_id: null, list: null })
    expect(flags(byId((await list(s.finn, s.l1)).wishes, s.w1))).toEqual([false, false]) // free again for the followers
    expect(await rpc(t, s.finn, 'reserve_wish', [s.w1])).toEqual({ ok: true }) // the dead row is ended and replaced
    await checkInvariants(t)
    expect(await rows(t.db, 'select reserver_id, status, end_reason from reservations where wish_id = $1 order by created_at', [s.w1])).toEqual([
      { reserver_id: s.moritz, status: 'ended', end_reason: 'access_ended' },
      { reserver_id: s.finn, status: 'active', end_reason: null },
    ])
  })

  it('remove W1 from its home L1: the home moves to OL; followers lose it, guests keep it; the last place → validation', async () => {
    const s = await seedShared(t)
    expect(await rpc(t, s.paula, 'remove_wish_from_list', [s.w1, s.l1])).toEqual({ ok: true })
    expect(await homeOf(t, s.w1)).toBe(s.o1List)
    expect(await placesOf(t, s.w1)).toEqual([{ wishlist_id: s.o1List, home: true }])
    expect(byId((await list(s.finn, s.l1)).wishes, s.w1)).toBeUndefined()
    expect(byId((await occ(s.moritz, s)).wishlist.wishes, s.w1)).toMatchObject({ also_in: [] })
    await expectRpcError(rpc(t, s.paula, 'remove_wish_from_list', [s.w1, s.o1List]), 'validation')
    await expectRpcError(rpc(t, s.paula, 'remove_wish_from_list', [s.w1, s.l1]), 'not_found') // not there any more
    await expectRpcError(rpc(t, s.moritz, 'remove_wish_from_list', [s.w1, s.o1List]), 'not_found') // not hers
    await checkInvariants(t)
  })
})

describe('SW07 / SW31 deleting and moving a shared wish', () => {
  it('REST delete of a shared wish (an old app) → not_allowed; delete_wish_everywhere removes it from every list', async () => {
    const s = await seedShared(t)
    await expectDbError(t.asUser(s.paula, (tx) => tx.query('delete from wishes where id = $1', [s.w1])), 'P0001')
    expect(await execAs(t, s.paula, 'delete from wishes where id = $1', [s.w3])).toBe(1) // one place: as before
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect(await rpc(t, s.paula, 'delete_wish_everywhere', [s.w1])).toEqual({ ok: true })
    expect(await placesOf(t, s.w1)).toEqual([])
    await expectRpcError(rpc(t, s.paula, 'delete_wish_everywhere', [s.w1]), 'not_found')
    await expectRpcError(rpc(t, s.moritz, 'delete_wish_everywhere', [s.w2]), 'not_found')
    expect((await rpc<Json[]>(t, s.moritz, 'my_reservations'))[0]).toMatchObject({ status: 'ended', end_reason: 'unavailable', wish_title: W_TITLES.w1 })
    await checkInvariants(t)
  })

  it('move_wish of a shared wish → validation (Q15); an unshared wish still moves (its home place follows)', async () => {
    const s = await seedShared(t)
    await expectRpcError(rpc(t, s.paula, 'move_wish', [s.w1, s.l2]), 'validation')
    expect(await rpc(t, s.paula, 'move_wish', [s.w3, s.l2])).toEqual({ ok: true })
    expect(await placesOf(t, s.w3)).toEqual([{ wishlist_id: s.l2, home: true }])
    await checkInvariants(t)
  })
})

describe('SW09 deleting a list keeps the shared wishes', () => {
  it('REST delete of L1: W1 lives on in OL (its new home), W3 goes; the reservation through OL stays live', async () => {
    const s = await seedShared(t)
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect(await execAs(t, s.paula, 'delete from wishlists where id = $1', [s.l1])).toBe(1)
    expect(await homeOf(t, s.w1)).toBe(s.o1List)
    expect(await homeOf(t, s.w3)).toBeNull()
    expect(flags(byId((await occ(s.moritz, s)).wishlist.wishes, s.w1))).toEqual([true, true])
    await checkInvariants(t)
    expect(await scalar<string>(t.db, `select status from reservations where wish_id = $1`, [s.w1])).toBe('active')
  })

  it('deleting the occasion: W1 and W2 live on in their homes, W4 goes', async () => {
    const s = await seedShared(t)
    expect(await execAs(t, s.paula, 'delete from occasions where id = $1', [s.o1])).toBe(1)
    expect(await placesOf(t, s.w1)).toEqual([{ wishlist_id: s.l1, home: true }])
    expect(await placesOf(t, s.w2)).toEqual([{ wishlist_id: s.l2, home: true }])
    expect(await homeOf(t, s.w4)).toBeNull()
    await checkInvariants(t)
  })
})

describe('SW30 "hide the extra places" (emergency switch)', () => {
  it('guests see only homes, Paula sees her shared wishes paused; on again before the cleanup → alive (Q20/Q22)', async () => {
    const s = await seedShared(t)
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    await setSharedVisible(t, false)
    try {
      expect(ids((await occ(s.moritz, s)).wishlist.wishes)).toEqual([s.w4])
      const mine = await occ(s.paula, s)
      expect(ids(mine.wishlist.wishes)).toEqual([s.w1, s.w2, s.w4].sort())
      expect(byId(mine.wishlist.wishes, s.w1)).toMatchObject({ paused: true, home: false })
      expect(byId(mine.wishlist.wishes, s.w4)).toMatchObject({ paused: false, home: true })
      expect(byId((await list(s.paula, s.l1)).wishes, s.w1)!.also_in).toEqual([
        { id: s.o1List, title: O1_TITLE, kind: 'occasion', occasion_id: s.o1, home: false, paused: true },
      ])
      expect((await rpc<Json[]>(t, s.moritz, 'my_reservations'))[0]).toMatchObject({ status: 'ended', end_reason: 'unavailable' })
      // the owner's management works on what she sees: still "shared" for the guard, the move refusal, the picker
      await expectRpcError(rpc(t, s.paula, 'move_wish', [s.w1, s.l2]), 'validation')
      expect(await rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [s.w1]])).toEqual({ ok: true, added: 0 })
    } finally {
      await setSharedVisible(t, true)
    }
    // on again before the cleanup came by: the reservation is live again (it was never ended)
    expect(flags(byId((await occ(s.moritz, s)).wishlist.wishes, s.w1))).toEqual([true, true])
    // hidden again, the cleanup runs, shown again: the ended reservation stays ended
    await setSharedVisible(t, false)
    await runCleanupPass(t)
    await setSharedVisible(t, true)
    expect(flags(byId((await occ(s.moritz, s)).wishlist.wishes, s.w1))).toEqual([false, false])
    await checkInvariants(t)
  })
})

describe('SW19 free wishes ("Ideen" / "Noch frei"): one entry per wish, every readable place', () => {
  it('Greta: W1 once with lists [OL, L1] (by date: the occasion first); Moritz: W1 with OL only; a live reservation hides it, a dead one not', async () => {
    const s = await seedShared(t)
    type Idea = { wish_id: string; list: { id: string }; lists: { id: string; kind: string }[] }
    const ideas = async (uid: string) => (await rpc<{ ideas: Idea[] }>(t, uid, 'get_free_wishes', [s.paula, null])).ideas
    const g = (await ideas(s.greta)).filter((i) => i.wish_id === s.w1)
    expect(g).toHaveLength(1)
    expect(g[0]!.lists.map((l) => l.id)).toEqual([s.o1List, s.l1])
    expect(g[0]!.list.id).toBe(s.o1List)
    const m = (await ideas(s.moritz)).find((i) => i.wish_id === s.w1)!
    expect(m.lists.map((l) => l.id)).toEqual([s.o1List])
    expect((await ideas(s.moritz)).map((i) => i.wish_id).sort()).toEqual([s.w1, s.w2, s.w4].sort())
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect((await ideas(s.greta)).some((i) => i.wish_id === s.w1)).toBe(false)
    expect(await rpc(t, s.paula, 'remove_wish_from_list', [s.w1, s.o1List])).toEqual({ ok: true }) // Moritz's row is dead now
    expect((await ideas(s.greta)).find((i) => i.wish_id === s.w1)!.lists.map((l) => l.id)).toEqual([s.l1])
  })
})

describe('SW20 the owner\'s export: every stored place; nothing about reservations', () => {
  it('wishes[].places with home and added_at; Moritz\'s export carries his own row (all statuses, Art. 15)', async () => {
    const s = await seedShared(t)
    await rpc(t, s.moritz, 'reserve_wish', [s.w1])
    await rpc(t, s.moritz, 'reserve_wish', [s.w4])
    await rpc(t, s.moritz, 'cancel_reservation', [s.w4])
    const exp = JSON.parse(await t.asUser(s.paula, (tx) => scalar<string>(tx, `select (public.export_my_data() - 'exported_at')::text`))) as {
      wishlists: { id: string; wishes: { id: string; places: { wishlist_id: string; home: boolean; added_at: string }[] }[] }[]
      reservations_made_by_me: unknown[]
    }
    const w1 = exp.wishlists.find((l) => l.id === s.l1)!.wishes.find((w) => w.id === s.w1)!
    expect(w1.places.map((p) => [p.wishlist_id, p.home])).toEqual([[s.l1, true], [s.o1List, false]])
    expect(exp.reservations_made_by_me).toEqual([])
    expect(JSON.stringify(exp)).not.toContain(s.moritz)
    const moritz = JSON.parse(await t.asUser(s.moritz, (tx) => scalar<string>(tx, `select (public.export_my_data() - 'exported_at')::text`))) as {
      reservations_made_by_me: { wish_title: string; status: string; end_reason: string | null }[]
    }
    expect(moritz.reservations_made_by_me.map((r) => [r.wish_title, r.status, r.end_reason])).toEqual([
      [W_TITLES.w1, 'active', null],
      [W_TITLES.w4, 'ended', 'by_reserver'],
    ])
  })
})

describe('INV-8 one owner, one home', () => {
  it('the backfill gave every wish its home place; a new wish gets one; places never cross owners', async () => {
    const s = await seedShared(t)
    const fresh = await addWish(t, s.paula, s.l2, 'Neu')
    expect(await placesOf(t, fresh)).toEqual([{ wishlist_id: s.l2, home: true }])
    const moritzList = await createList(t, s.moritz, 'Moritz Liste')
    await expectRpcError(rpc(t, s.paula, 'add_wishes_to_list', [moritzList, [fresh]]), 'not_found')
    await checkInvariants(t)
  })
})
