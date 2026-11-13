/**
 * The world of the shared-wishes tests (docs/spec/shared-wishes-design.md §1.3; 20261027200000_shared_wishes.sql) —
 * not a test file. On top of seedFollows():
 *   Paula   owner. L1 "Meine Wünsche" (followers: Finn, Greta), L2 "Privat" ("Nur ich"), her occasion O1 with OL.
 *   W1      "Kopfhörer": home L1, ALSO in OL          W2 "Tagebuch": home L2 ("Nur ich"), ALSO in OL
 *   W3      "Teekanne": only L1                         W4 "Gartenstuhl": only OL
 *   Finn    follower only (also a guest of O2, Moritz's occasion)
 *   Moritz  guest of O1 only
 *   Greta   follower AND guest of O1
 *   Bea     blocked by Paula; Xaver a stranger; Rosa a pending request.
 * The switch "add to more lists" is turned on for the test database (it ships off, design §7).
 */
import { expect } from 'vitest'
import { scalar, type TestDb } from '../../src/harness'
import { rpc } from '../pilot/seed'
import { seedFollows, type FollowSeed } from '../follows/seed'

export interface SharedSeed extends FollowSeed {
  w1: string
  w2: string
  w3: string
  w4: string
}

export const W_TITLES = { w1: 'Kopfhörer', w2: 'Tagebuch', w3: 'Teekanne', w4: 'Gartenstuhl' } as const

export async function setSharedSwitch(t: TestDb, on: boolean): Promise<void> {
  await t.db.query('update private.features set shared_wishes = $1', [on])
}

export async function setSharedVisible(t: TestDb, visible: boolean): Promise<void> {
  await t.db.transaction(async (tx) => {
    await tx.query('lock table public.profiles in exclusive mode')
    await tx.query('update private.features set shared_wishes_visible = $1', [visible])
  })
}

export async function seedShared(t: TestDb): Promise<SharedSeed> {
  const s = await seedFollows(t)
  await setSharedSwitch(t, true)
  expect(await rpc(t, s.greta, 'accept_invite', [s.o1Invite])).toEqual({ occasion_id: s.o1 })
  const [w1, , w3] = s.l1Wishes
  const w2 = s.l2Wish
  const w4 = s.o1Wish
  expect(await rpc(t, s.paula, 'add_wishes_to_list', [s.o1List, [w1, w2]])).toEqual({ ok: true, added: 2 })
  return { ...s, w1, w2, w3, w4 }
}

/** The stored places of a wish (superuser): [list id, home?] in added order. */
export async function placesOf(t: TestDb, wish: string): Promise<{ wishlist_id: string; home: boolean }[]> {
  const rows = await t.db.query<{ wishlist_id: string; home: boolean }>(
    `select p.wishlist_id, p.wishlist_id = w.wishlist_id as home from private.wish_placements p
       join public.wishes w on w.id = p.wish_id where p.wish_id = $1 order by p.added_at, p.wishlist_id`,
    [wish],
  )
  return rows.rows
}

export function homeOf(t: TestDb, wish: string): Promise<string | null> {
  return scalar<string | null>(t.db, 'select (select wishlist_id from public.wishes where id = $1)', [wish])
}

/** Every reservation counter of the current transaction (table + every index of public.reservations). */
export const RESERVATION_WORK_SQL = `
  select jsonb_build_object(
    'seq_scan', coalesce(t.seq_scan, 0),
    'seq_tup_read', coalesce(t.seq_tup_read, 0),
    'idx_scan', coalesce(t.idx_scan, 0),
    'idx_tup_fetch', coalesce(t.idx_tup_fetch, 0),
    'n_tup_ins', coalesce(t.n_tup_ins, 0), 'n_tup_upd', coalesce(t.n_tup_upd, 0), 'n_tup_del', coalesce(t.n_tup_del, 0),
    'indexes', (select coalesce(jsonb_object_agg(i.relname, jsonb_build_array(
                  pg_stat_get_xact_numscans(i.oid), pg_stat_get_xact_tuples_returned(i.oid), pg_stat_get_xact_tuples_fetched(i.oid))
                  order by i.relname), '{}'::jsonb)
                  from pg_index x join pg_class i on i.oid = x.indexrelid where x.indrelid = c.oid))::text
    from pg_class c left join pg_stat_xact_user_tables t on t.relid = c.oid
   where c.oid = 'public.reservations'::regclass`
