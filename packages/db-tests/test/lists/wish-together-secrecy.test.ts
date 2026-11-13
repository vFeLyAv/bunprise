/**
 * 🔒 "Owner sees nothing" for "Anzahl" and "Passt zusammen" (20261030120000_wish_quantity_together.sql), the rules of
 * test/lists/shared-wishes-secrecy.test.ts applied to every new path:
 *   (a) ZERO ACCESS — no action of the owner (her screens with `together`, set_wish_links, the quantity write, deleting a
 *       linked wish, reserve_together on her own wishes) does any work on public.reservations (every counter 0).
 *   (b) BOUNDED ACCESS — reserve_together and the guest screens with `together` read reservations only per wish of
 *       SOMEBODY ELSE: the same work in worlds with 0 / 200 reservations on the giver's own wishes, no sequential scan.
 *   (c) the owner's answers (her screens, set_wish_links, reserve_together, the export's wishes) are byte-identical in
 *       a world where every linked wish is reserved — together and alone — and in one where nothing is.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type Querier, type TestDb } from '../../src/harness'
import { rpc } from '../pilot/seed'
import { rpcText } from '../follows/seed'
import { RESERVATION_WORK_SQL, seedShared, type SharedSeed } from './shared-seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await t.db.query('update private.features set wish_quantity = true, wish_together = true')
})
afterAll(() => t.close())

type Work = Record<string, unknown> & { indexes: Record<string, [number, number, number]> }
class Rollback extends Error {}

function diff(after: Work, before: Work): Work {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(after)) if (k !== 'indexes') out[k] = (v as number) - (before[k] as number)
  const indexes: Record<string, [number, number, number]> = {}
  for (const [k, xs] of Object.entries(after.indexes)) {
    const b = before.indexes[k] ?? [0, 0, 0]
    indexes[k] = [xs[0] - b[0], xs[1] - b[1], xs[2] - b[2]]
  }
  return { ...out, indexes } as Work
}

/** The reservation work of `action` as `uid`, in one transaction that is rolled back (a refusal inside a savepoint). */
async function workOf(uid: string, action: (tx: Querier) => Promise<unknown>): Promise<Work> {
  let work: Work | null = null
  try {
    await t.asUser(uid, async (tx) => {
      const before = JSON.parse(await scalar<string>(tx, RESERVATION_WORK_SQL)) as Work
      await tx.query('savepoint measured')
      try {
        await action(tx)
      } catch (err) {
        if (!(typeof err === 'object' && err !== null && 'code' in err)) throw err
        await tx.query('rollback to savepoint measured')
      }
      const after = JSON.parse(await scalar<string>(tx, RESERVATION_WORK_SQL)) as Work
      work = diff(after, before)
      throw new Rollback()
    })
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  }
  if (!work) throw new Error('no counters')
  return work
}

function isZero(w: Work): boolean {
  const { indexes, ...table } = w
  return Object.values(table).every((v) => v === 0) && Object.values(indexes).every((xs) => xs.every((v) => v === 0))
}

const call = (fn: string, args: readonly unknown[] = []) => (tx: Querier) =>
  tx.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, [...args])

/** The shared world + W4 <-> W3 linked, W4 asks for 4 pieces. */
async function world(): Promise<SharedSeed> {
  const s = await seedShared(t)
  expect(await rpc(t, s.paula, 'set_wish_links', [s.w4, [s.w3]])).toEqual({ ok: true, linked: 1 })
  await t.asUser(s.paula, (tx) => tx.query('update wishes set quantity = 4 where id = $1', [s.w4]))
  return s
}

describe('(a) zero access for every action of the owner', () => {
  let s: SharedSeed
  beforeAll(async () => {
    s = await world()
    // Greta holds both linked wishes (one call), Moritz W1
    expect(await rpc(t, s.greta, 'reserve_together', [s.w4, [s.w3]])).toEqual({ ok: true, reserved: 2 })
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.w1])).toEqual({ ok: true })
  })

  const actions: [string, (s: SharedSeed) => (tx: Querier) => Promise<unknown>][] = [
    ['get_occasion_screen (host, with together)', (x) => call('get_occasion_screen', [x.o1])],
    ['get_list_screen L1 (with together)', (x) => call('get_list_screen', [x.l1])],
    ['set_wish_links (replace)', (x) => call('set_wish_links', [x.w4, [x.w3, x.w1]])],
    ['set_wish_links (remove all)', (x) => call('set_wish_links', [x.w4, []])],
    ['set_wish_links (refused: foreign)', (x) => call('set_wish_links', [x.w4, [x.o2List]])],
    ['reserve_together on her own wishes (refused)', (x) => call('reserve_together', [x.w4, [x.w3]])],
    ['REST update quantity', (x) => (tx) => tx.query('update wishes set quantity = 7 where id = $1', [x.w4])],
    ['REST insert with quantity', (x) => (tx) => tx.query(`insert into wishes (wishlist_id, title, quantity) values ($1, 'AirTag', 4)`, [x.l1])],
    ['REST delete a linked wish', (x) => (tx) => tx.query('delete from wishes where id = $1', [x.w3])],
    // the export's OWN-LISTS part (quantity + together); export_my_data as a whole also reads her own giver history
    // through reserver_id — that is rule (b), measured in shared-wishes-secrecy.test.ts
    ['my_wishlists_export', () => (tx) => tx.query('select private.my_wishlists_export()')],
  ]

  for (const [name, action] of actions) {
    it(`${name}: no work on reservations`, async () => {
      const w = await workOf(s.paula, action(s))
      expect(w, JSON.stringify(w)).toSatisfy(isZero)
    })
  }
})

describe('(b) a giver: bounded work, independent of the reservations on her OWN wishes', () => {
  /** Paula as a GIVER: a guest of O2 (Moritz's occasion) with two linked wishes there. */
  async function giverWorld(): Promise<{ s: SharedSeed; a: string; b: string }> {
    const s = await world()
    const ins = (title: string) => scalar<string>(t.db, `insert into public.wishes (wishlist_id, title) values ($1, $2) returning id`, [s.o2List, title])
    const a = await ins('Lenkrad')
    const b = await ins('Handbremse')
    expect(await rpc(t, s.moritz, 'set_wish_links', [a, [b]])).toEqual({ ok: true, linked: 1 })
    return { s, a, b }
  }

  /** n reservations of strangers on the giver's (Paula's) own wishes */
  async function othersOnHerWishes(s: SharedSeed, n: number): Promise<void> {
    await t.db.query(
      `with mine as (insert into public.wishes (wishlist_id, title) select $1, 'Extra ' || g from generate_series(1, $2::int) g returning id)
       insert into public.reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot)
       select m.id, $1, $3, gen_random_uuid(), 'x' from mine m`,
      [s.l1, n, s.paula],
    )
  }

  const bounded = (w: Work) => ({
    seq_scan: w['seq_scan'],
    seq_tup_read: w['seq_tup_read'],
    returned: Object.fromEntries(Object.entries(w.indexes).map(([k, xs]) => [k, xs[1]])),
  })

  it('reserve_together and the guest screen with `together`: the same work with 0 and 200 reservations on her wishes', async () => {
    const empty = await giverWorld()
    const busy = await giverWorld()
    await othersOnHerWishes(busy.s, 200)
    const steps: [string, (x: { s: SharedSeed; a: string; b: string }) => (tx: Querier) => Promise<unknown>][] = [
      ['reserve_together', ({ a, b }) => call('reserve_together', [a, [b]])],
      ['get_occasion_screen (guest of O2)', ({ s }) => call('get_occasion_screen', [s.o2])],
    ]
    for (const [name, step] of steps) {
      await t.db.exec('vacuum public.reservations')
      const x = bounded(await workOf(empty.s.paula, step(empty)))
      const y = bounded(await workOf(busy.s.paula, step(busy)))
      expect([x.seq_scan, x.seq_tup_read], name).toEqual([0, 0])
      expect(y, name).toEqual(x)
    }
  })

  it('wish_links_for_viewer plans without sequential or bitmap scans (INV-7 b)', async () => {
    const cfg = await scalar<string[]>(t.db, `select proconfig from pg_proc where proname = 'wish_links_for_viewer'`)
    expect(cfg).toContain('enable_seqscan=off')
    expect(cfg).toContain('enable_bitmapscan=off')
  })
})

describe('(c) the owner\'s answers are byte-identical with and without reservations on the linked wishes', () => {
  it('screens, set_wish_links, reserve_together, the export\'s lists', async () => {
    const a = await world()
    const b = await world()
    // world A: the pair reserved together, another wish alone; world B: nothing
    expect(await rpc(t, a.greta, 'reserve_together', [a.w4, [a.w3]])).toEqual({ ok: true, reserved: 2 })
    expect(await rpc(t, a.moritz, 'reserve_wish', [a.w1])).toEqual({ ok: true })

    /** ids differ between worlds: replace each world's ids by their names before comparing */
    const names = (s: SharedSeed) => new Map<string, string>([
      [s.paula, 'paula'], [s.greta, 'greta'], [s.moritz, 'moritz'], [s.finn, 'finn'], [s.o1, 'o1'], [s.o1List, 'ol'],
      [s.l1, 'l1'], [s.l2, 'l2'], [s.w1, 'w1'], [s.w2, 'w2'], [s.w3, 'w3'], [s.w4, 'w4'], [s.l1Wishes[1], 'w1b'],
    ])
    const normalise = (s: SharedSeed, text: string) => {
      let out = text
      for (const [id, name] of names(s)) out = out.split(id).join(name)
      // timestamps of the two worlds differ by the seeding moment
      return out.replace(/"\d{4}-\d{2}-\d{2}T[^"]+"/g, '"<t>"')
    }
    const answer = async (s: SharedSeed, fn: string, args: readonly unknown[]) => {
      try {
        return normalise(s, await rpcText(t, s.paula, fn, args))
      } catch (err) {
        return `error:${(err as { message?: string }).message ?? '?'}`
      }
    }
    const steps: [string, (s: SharedSeed) => readonly unknown[]][] = [
      ['get_occasion_screen', (s) => [s.o1]],
      ['get_list_screen', (s) => [s.l1]],
      ['reserve_together', (s) => [s.w4, [s.w3]]],
      ['set_wish_links', (s) => [s.w3, [s.w4, s.w1]]],
      ['get_list_screen', (s) => [s.l1]],
      ['set_wish_links', (s) => [s.w4, []]],
    ]
    for (const [fn, args] of steps) expect(await answer(a, fn, args(a)), fn).toBe(await answer(b, fn, args(b)))
    // the export's wish lists (her own data; the giver part differs only by the GIVERS, who are not her)
    const lists = async (s: SharedSeed) => normalise(s, JSON.stringify((await rpc<{ wishlists: unknown }>(t, s.paula, 'export_my_data')).wishlists))
    expect(await lists(a)).toBe(await lists(b))
  })
})
