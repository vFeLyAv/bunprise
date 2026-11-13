/**
 * The bring-along list "Mitbringen" under concurrency on real PostgreSQL (docs/decisions/0002-concurrency-tests-real-postgres.md,
 * supabase/migrations/20261025150000_potluck.sql, docs/design/2026-10-25-bring-list.md §2.4 / §2.7). The pairs that can
 * meet on the same rows:
 *   claim ↔ claim (two guests, one entry)              — both queue on the host's profile row (lock_profile_pair)
 *   claim ↔ leave_occasion (the claimer, second tab)   — the profile pair; the leave trigger releases a fresh claim
 *   claim ↔ remove_member (the host removes the claimer)
 *   claim ↔ delete_potluck_item (the host)
 *   claim ↔ delete_my_account (the entry's author)     — the entry row (the cascade delete ↔ the UPDATE)
 *   claim ↔ delete_my_account (the claimer)            — the claimer's profile row
 *   add ↔ add at 49 entries (two guests)                — the host's profile row: the 50-entry limit cannot be raced
 *   add ↔ the host switches the list off (REST update) — the occasion row (add takes it FOR SHARE)
 *   add ↔ the host deletes the occasion (REST delete)  — the host's profile row (lock_owned_delete)
 * Each pair in both orders (hold and wait, pg_blocking_pids), then unsynchronised races: never a deadlock, a timeout
 * or a raw constraint error (e.g. 23503 from the entry's foreign key), always the state of one serial order.
 * The pair runners come from ./pairs.ts (no pair is added to its shared lists).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealPg, type RealPg, type Session } from '../../src/realpg'
import { CONTRACT_CODES, expectRefused, holdTests, OK, race, restOp, rpcError, rpcOp, seedFor, type Ctx, type Pair } from './pairs'
import { accountExists, memberStatus, occasionExists, type World } from './world'

const ROUNDS = 12

/** The entries prepared per world (keyed by occasion id): "Salat" by Anna, free; "Kuchen" by Cem, free. */
const ITEMS = new Map<string, { salat: string; kuchen: string }>()
const itemsOf = (w: World) => {
  const it = ITEMS.get(w.occasionId)
  if (!it) throw new Error('no entries prepared for this world')
  return it
}

async function prepareList(db: RealPg, w: World, opts: { fill?: number } = {}): Promise<void> {
  await db.admin.query(`update public.occasions set sections = 'both' where id = $1`, [w.occasionId])
  const salat = await db.asUser(w.host, (s) => s.rpc<{ id: string }>('add_potluck_item', [w.occasionId, 'Salat', false]))
  const kuchen = await db.asUser(w.c, (s) => s.rpc<{ id: string }>('add_potluck_item', [w.occasionId, 'Kuchen', false]))
  ITEMS.set(w.occasionId, { salat: salat.id, kuchen: kuchen.id })
  if (opts.fill) {
    await db.admin.query(
      `insert into public.potluck_items (occasion_id, title, created_by)
       select $1, 'Eintrag ' || g, $2 from generate_series(1, $3::int) g`,
      [w.occasionId, w.host, opts.fill],
    )
  }
}

/** The bringer of an entry (null = free), or 'gone' when the entry does not exist (superuser). */
async function bringerOf(db: RealPg, id: string): Promise<string | null | 'gone'> {
  const rows = await db.admin.rows<{ claimed_by: string | null }>('select claimed_by from public.potluck_items where id = $1', [id])
  return rows[0] ? rows[0].claimed_by : 'gone'
}

function entryCount(db: RealPg, w: World): Promise<number> {
  return db.admin.value<number>('select count(*)::int from public.potluck_items where occasion_id = $1', [w.occasionId])
}

/** Commitments by people who are no longer active members of that occasion (must always be 0). */
function claimsByInactive(db: RealPg): Promise<number> {
  return db.admin.value<number>(
    `select count(*)::int from public.potluck_items i where i.claimed_by is not null and not exists (
       select 1 from public.occasion_members m where m.occasion_id = i.occasion_id and m.profile_id = i.claimed_by and m.status = 'active')`,
  )
}

const claimAs = (who: 'b' | 'c', name: string, item: 'salat' | 'kuchen') =>
  rpcOp(`claim_potluck_item (${name}, ${item})`, 'claim_potluck_item', (w) => w[who], (w) => [itemsOf(w)[item]])
const benClaimsSalat = claimAs('b', 'Ben', 'salat')
const cemClaimsSalat = claimAs('c', 'Cem', 'salat')
const benClaimsKuchen = claimAs('b', 'Ben', 'kuchen')
const addAs = (who: 'b' | 'c', name: string, title: string) =>
  rpcOp(`add_potluck_item (${name}, ${title})`, 'add_potluck_item', (w) => w[who], (w) => [w.occasionId, title, false])
const ADDED = { ok: true, value: { id: expect.any(String) } }

const POTLUCK_PAIRS: readonly Pair[] = [
  {
    name: 'claim ↔ claim (two guests, one entry)',
    x: benClaimsSalat,
    y: cemClaimsSalat,
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Ben brings it, Cem gets already_claimed',
      async check(ctx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual(rpcError('already_claimed'))
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBe(ctx.w.b)
      },
    },
    yFirst: {
      says: 'Cem brings it, Ben gets already_claimed',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('already_claimed'))
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBe(ctx.w.c)
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'claim ↔ leave_occasion (the claimer, second tab)',
    x: benClaimsSalat,
    y: rpcOp('leave_occasion (Ben, second tab)', 'leave_occasion', (w) => w.b, (w) => [w.occasionId]),
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the claim lands, the leave releases it',
      async check(ctx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual(OK)
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.b)).toBe('left')
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBeNull()
        expect(await claimsByInactive(ctx.db)).toBe(0)
      },
    },
    yFirst: {
      says: 'the claim answers not_found, the entry stays free',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'claim ↔ remove_member (the host removes the claimer)',
    x: benClaimsSalat,
    y: rpcOp('remove_member (Anna removes Ben)', 'remove_member', (w) => w.host, (w) => [w.occasionId, w.b]),
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the claim lands, the removal releases it',
      async check(ctx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual(OK)
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.b)).toBe('removed')
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBeNull()
        expect(await claimsByInactive(ctx.db)).toBe(0)
      },
    },
    yFirst: {
      says: 'the claim answers not_found, the entry stays free',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'claim ↔ delete_potluck_item (the host)',
    x: benClaimsSalat,
    y: rpcOp('delete_potluck_item (Anna, Salat)', 'delete_potluck_item', (w) => w.host, (w) => [itemsOf(w).salat]),
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the claim lands, then the entry is deleted with it',
      async check(ctx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual(OK)
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBe('gone')
      },
    },
    yFirst: {
      says: 'the entry is gone, the claim answers not_found',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBe('gone')
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'claim ↔ delete_my_account (the entry\'s author)',
    x: benClaimsKuchen,
    y: rpcOp('delete_my_account (Cem)', 'delete_my_account', (w) => w.c),
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['potluck_items', 'potluck_items'],
    xFirst: {
      says: 'the claim lands, then the author\'s entry goes with the account',
      async check(ctx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual(OK)
        expect(await accountExists(ctx.db, ctx.w.c)).toBe(false)
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).kuchen)).toBe('gone')
      },
    },
    yFirst: {
      says: 'the entry went with the account, the claim answers not_found',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).kuchen)).toBe('gone')
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'claim ↔ delete_my_account (the claimer)',
    x: cemClaimsSalat,
    y: rpcOp('delete_my_account (Cem)', 'delete_my_account', (w) => w.c),
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the claim lands, the deletion frees the entry again',
      async check(ctx) {
        expect(ctx.x).toEqual(OK)
        expect(ctx.y).toEqual(OK)
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBeNull()
      },
    },
    yFirst: {
      says: 'the claim of the deleted account is refused, the entry stays free',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        // held: the claim read the live profile, then waited for its lock → not_allowed (like every RPC of a
        // deleted account); in a race an earlier statement may already see the account gone
        expectRefused(ctx, ctx.x, 'not_allowed', ['consent_required'])
        expect(await bringerOf(ctx.db, itemsOf(ctx.w).salat)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'add ↔ add at 49 entries (two guests, the last free place)',
    x: addAs('b', 'Ben', 'Bier'),
    y: addAs('c', 'Cem', 'Saft'),
    // 2 + 47 = 49 entries: one place left
    prepare: (db, w) => prepareList(db, w, { fill: 47 }),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Ben takes the 50th place, Cem gets limit_reached',
      async check(ctx) {
        expect(ctx.x).toEqual(ADDED)
        expect(ctx.y).toEqual(rpcError('limit_reached'))
        expect(await entryCount(ctx.db, ctx.w)).toBe(50)
      },
    },
    yFirst: {
      says: 'Cem takes the 50th place, Ben gets limit_reached',
      async check(ctx) {
        expect(ctx.y).toEqual(ADDED)
        expect(ctx.x).toEqual(rpcError('limit_reached'))
        expect(await entryCount(ctx.db, ctx.w)).toBe(50)
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'add ↔ the host switches the list off (REST)',
    x: addAs('b', 'Ben', 'Bier'),
    y: restOp('switch off (Anna, REST)', `update public.occasions set sections = 'wishes' where id = $1`, (w) => w.host, (w) => [w.occasionId]),
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['occasions', 'occasions'],
    xFirst: {
      says: 'the entry lands, then the switch-off deletes every entry',
      async check(ctx) {
        expect(ctx.x).toEqual(ADDED)
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await entryCount(ctx.db, ctx.w)).toBe(0)
      },
    },
    yFirst: {
      says: 'the add answers not_allowed, no entry is left',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('not_allowed'))
        expect(await entryCount(ctx.db, ctx.w)).toBe(0)
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'add ↔ the host deletes the occasion (REST)',
    x: addAs('b', 'Ben', 'Bier'),
    y: restOp('delete occasion (Anna, REST)', 'delete from public.occasions where id = $1', (w) => w.host, (w) => [w.occasionId]),
    prepare: (db, w) => prepareList(db, w),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'the entry lands, then the delete cascades it away',
      async check(ctx) {
        expect(ctx.x).toEqual(ADDED)
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await occasionExists(ctx.db, ctx.w)).toBe(false)
        expect(await entryCount(ctx.db, ctx.w)).toBe(0)
      },
    },
    yFirst: {
      says: 'the add answers not_found, no entry row',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await entryCount(ctx.db, ctx.w)).toBe(0)
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
]

/** The contract codes plus the one new code of the feature. */
const POTLUCK_CODES: readonly string[] = [...CONTRACT_CODES, 'already_claimed']

function expectPotluckContract(label: string, out: Ctx['x']): void {
  if (out.ok) return
  const contract = out.code === 'P0001' && POTLUCK_CODES.includes(out.message)
  expect(contract, `${label}: database error outside the contract: ${out.code} ${out.message}`).toBe(true)
}

let db: RealPg
let s1: Session
let s2: Session

beforeAll(async () => {
  db = await startRealPg()
  s1 = await db.session('tx-1')
  s2 = await db.session('tx-2')
})
afterAll(async () => {
  await db?.close()
})

holdTests(POTLUCK_PAIRS, () => ({ db, s1, s2 }))

describe('bring-along list operations at the same moment', () => {
  for (const pair of POTLUCK_PAIRS) {
    it(`${pair.name}: ${ROUNDS} rounds, no deadlock or timeout, each round equals one serial order`, async () => {
      const seen = { x: 0, y: 0 }
      for (let round = 0; round < ROUNDS; round++) {
        const w = await seedFor(db, pair)
        const out = await race([s1, s2], w, pair.x, pair.y, round % 2 === 0, Math.floor(round / 2))
        expectPotluckContract(`${pair.x.label} (round ${round + 1})`, out.x)
        expectPotluckContract(`${pair.y.label} (round ${round + 1})`, out.y)
        const ctx: Ctx = { db, w, ...out, schedule: 'race' }
        const first = await pair.firstOf(ctx)
        seen[first] += 1
        await (first === 'x' ? pair.xFirst : pair.yFirst).check(ctx)
        expect(await claimsByInactive(db)).toBe(0)
      }
      console.info(`[races] ${pair.name}: ${pair.x.label} first ${seen.x}/${ROUNDS}, ${pair.y.label} first ${seen.y}/${ROUNDS}`)
    })
  }
})
