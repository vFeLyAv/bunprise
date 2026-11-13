/**
 * In-app invitations under concurrency on real PostgreSQL 17 (docs/decisions/0002-concurrency-tests-real-postgres.md,
 * supabase/migrations/20261027120000_occasion_invitations.sql "LOCKS", docs/spec/in-app-invites-design.md §4.3, §9).
 * Each pair in both orders (one holds its locks in an open transaction, the other must wait — on a row of the named
 * table or on an advisory lock), then unsynchronised races. Always: a contract code or success, never a deadlock /
 * timeout / raw constraint error; the final state of one serial order; and no "zombie" — a pending delivered
 * invitation that nobody sees (it could come back later: void must be terminal, Codex B #6).
 *
 * World (./world.ts): host Anna, guests Ben (b) and Cem (c), outsiders Dana (d) and Emil (e).
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type RealPg, type Session } from '../../src/realpg'
import { CONTRACT_CODES, OK, holdThenRun, race, restOp, rpcError, rpcOp, seedFor, type Ctx, type Op, type Pair } from './pairs'
import { accountExists, memberStatus, occasionExists, seedWorld, type World } from './world'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ROUNDS = 8

// ---------------------------------------------------------------------------------------------------------------
// preparation helpers (superuser + RPCs)
// ---------------------------------------------------------------------------------------------------------------

async function friends(db: RealPg, a: string, b: string): Promise<void> {
  await db.admin.query(
    `insert into public.follows (follower_id, followee_id, status, requested_at, accepted_at)
     values ($1, $2, 'accepted', now(), now()), ($2, $1, 'accepted', now(), now()) on conflict do nothing`,
    [a, b],
  )
}

async function allowGuests(db: RealPg, w: World): Promise<void> {
  await db.admin.query('update public.occasions set guests_can_invite = true where id = $1', [w.occasionId])
}

const send = (db: RealPg, uid: string, occasionId: string, ids: string[]) =>
  db.asUser(uid, (s) => s.rpc<{ profile_id: string; state: string }[]>('send_occasion_invites', [occasionId, ids]))

/** The invitation the op works on, per world (keyed by the world's occasion). */
const INV = new Map<string, string>()
/** A second occasion per world (keyed by the world's occasion). */
const SECOND = new Map<string, string>()
const invOf = (w: World) => {
  const id = INV.get(w.occasionId)
  if (!id) throw new Error('no invitation prepared for this world')
  return id
}
const secondOf = (w: World) => {
  const id = SECOND.get(w.occasionId)
  if (!id) throw new Error('no second occasion prepared for this world')
  return id
}

async function newOccasion(db: RealPg, host: string, title: string): Promise<string> {
  return db.asUser(host, (s) =>
    s.value<string>(
      `insert into public.occasions (host_id, title, starts_at, tz) values ($1, $2, now() + interval '20 days', 'Europe/Berlin') returning id`,
      [host, title],
    ),
  )
}

/** inviter invites Dana into the occasion; remembers the delivered invitation's id for the ops. */
async function inviteDana(db: RealPg, w: World, inviter: string, occasionId = w.occasionId): Promise<void> {
  await friends(db, inviter, w.d)
  await send(db, inviter, occasionId, [w.d])
  const id = await db.admin.value<string>(
    `select id from public.occasion_invitations where occasion_id = $1 and inviter_id = $2 and invitee_id = $3 and delivered`,
    [occasionId, inviter, w.d],
  )
  INV.set(w.occasionId, id)
}

/** 19 other hosts, each with an occasion and a delivered invitation to Dana (her inbox: 19 of 20). */
let fill = 0
async function fillInbox(db: RealPg, w: World, n: number): Promise<void> {
  const run = ++fill
  await db.admin.query(
    `with hosts as (
       insert into auth.users (email, raw_user_meta_data)
       select 'fill-' || $3 || '-' || g || '@example.test', jsonb_build_object('name', 'Gastgeber ' || g) from generate_series(1, $2::int) g
       returning id),
     occ as (
       insert into public.occasions (host_id, title, starts_at, tz)
       select h.id, 'Fest', now() + interval '20 days', 'Europe/Berlin' from hosts h returning id, host_id),
     f1 as (insert into public.follows (follower_id, followee_id, status, accepted_at) select o.host_id, $1, 'accepted', now() from occ o),
     f2 as (insert into public.follows (follower_id, followee_id, status, accepted_at) select $1, o.host_id, 'accepted', now() from occ o)
     insert into public.occasion_invitations (occasion_id, inviter_id, invitee_id, expires_at, delivered)
     select o.id, o.host_id, $1, now() + interval '7 days', true from occ o`,
    [w.d, n, run],
  )
}

// ---------------------------------------------------------------------------------------------------------------
// final-state readers and invariants
// ---------------------------------------------------------------------------------------------------------------

/** Pending delivered invitations that nobody sees although they have not expired (must always be 0). */
function zombies(db: RealPg): Promise<number> {
  return db.admin.value<number>(
    `select count(*)::int from public.occasion_invitations i
      where i.outcome = 'pending' and i.delivered and i.expires_at > now() and not private.invitation_visible(i.id)`,
  )
}

/** Visible invitations of a person (the dot). */
function visibleTo(db: RealPg, uid: string): Promise<number> {
  return db.admin.value<number>('select count(*)::int from private.visible_invitation_ids($1)', [uid])
}

function rowsBetween(db: RealPg, occasionId: string, invitee: string): Promise<{ inviter_id: string; delivered: boolean; outcome: string }[]> {
  return db.admin.rows(
    'select inviter_id, delivered, outcome from public.occasion_invitations where occasion_id = $1 and invitee_id = $2 order by created_at',
    [occasionId, invitee],
  )
}

const INVITED = (w: World, who: (w: World) => string = (x) => x.d) => ({
  ok: true,
  value: [{ profile_id: who(w), state: 'invited', expires_at: expect.any(String) }],
})
const joined = (occasionId: string) => ({ ok: true, value: { occasion_id: occasionId } })

// ---------------------------------------------------------------------------------------------------------------
// operations
// ---------------------------------------------------------------------------------------------------------------

const accept = (label = 'respond accept (Dana)') => rpcOp(label, 'respond_occasion_invite', (w) => w.d, (w) => [invOf(w), true])
const decline = rpcOp('respond decline (Dana)', 'respond_occasion_invite', (w) => w.d, (w) => [invOf(w), false])
const sendAs = (label: string, who: (w: World) => string, to: (w: World) => string, occ: (w: World) => string = (w) => w.occasionId): Op =>
  rpcOp(label, 'send_occasion_invites', who, (w) => [occ(w), [to(w)]])

type Waits = string // a table name (a row lock), 'advisory', or 'xid' (a row wait shown only as the holder's transaction)

interface InvitationPair extends Omit<Pair, 'waitsOn'> {
  waitsOn: readonly [Waits, Waits]
}

const PAIRS: readonly InvitationPair[] = [
  {
    name: 'accept ↔ block_user (the host blocks the invitee)',
    x: accept(),
    y: rpcOp('block_user (Anna blocks Dana)', 'block_user', (w) => w.host, (w) => [w.d]),
    prepare: (db, w) => inviteDana(db, w, w.host),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Dana joins, then the block removes her',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(ctx.w.occasionId))
        expect(ctx.y).toEqual(OK)
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.d)).toBe('removed')
      },
    },
    yFirst: {
      says: 'the invitation is void, the acceptance answers invite_invalid',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.d)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'accept ↔ the host deletes the occasion (REST)',
    x: accept(),
    y: restOp('delete occasion (Anna, REST)', 'delete from public.occasions where id = $1', (w) => w.host, (w) => [w.occasionId]),
    prepare: (db, w) => inviteDana(db, w, w.host),
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Dana joins, then everything goes with the occasion',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(ctx.w.occasionId))
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await occasionExists(ctx.db, ctx.w)).toBe(false)
      },
    },
    yFirst: {
      says: 'the occasion is gone, the acceptance answers invite_invalid',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('invite_invalid'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'accept ↔ remove_member (the host removes the guest who invited)',
    x: accept(),
    y: rpcOp('remove_member (Anna removes Ben)', 'remove_member', (w) => w.host, (w) => [w.occasionId, w.b]),
    prepare: async (db, w) => {
      await allowGuests(db, w)
      await inviteDana(db, w, w.b)
    },
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Dana joins (invited by Ben), then Ben goes; "eingeladen von" is not shown any more',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(ctx.w.occasionId))
        expect(ctx.y).toEqual(OK)
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.d)).toBe('active')
        const info = await ctx.db.asUser(ctx.w.host, (s) => s.rpc<{ invited_by: unknown[] }>('get_occasion_invite_info', [ctx.w.occasionId]))
        expect(info.invited_by).toEqual([])
      },
    },
    yFirst: {
      says: 'Ben is removed, his invitation is void: invite_invalid',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.d)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'accept ↔ withdraw (the host)',
    x: accept(),
    y: rpcOp('withdraw (Anna, Dana)', 'withdraw_occasion_invite', (w) => w.host, (w) => [w.occasionId, w.d]),
    prepare: (db, w) => inviteDana(db, w, w.host),
    waitsOn: ['occasions', 'occasions'],
    xFirst: {
      says: 'Dana joins; withdrawing an accepted invitation answers not_found',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(ctx.w.occasionId))
        expect(ctx.y).toEqual(rpcError('not_found'))
      },
    },
    yFirst: {
      says: 'withdrawn first: invite_invalid',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.d)).toBeNull()
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'accept ↔ accept (Dana, two tabs)',
    x: accept('respond accept (Dana, tab 1)'),
    y: accept('respond accept (Dana, tab 2)'),
    prepare: (db, w) => inviteDana(db, w, w.host),
    waitsOn: ['profiles', 'profiles'],
    symmetric: true,
    xFirst: {
      says: 'one joins, the other answers invite_invalid',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(ctx.w.occasionId))
        expect(ctx.y).toEqual(rpcError('invite_invalid'))
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.d)).toBe('active')
      },
    },
    yFirst: {
      says: 'one joins, the other answers invite_invalid',
      async check(ctx) {
        expect(ctx.y).toEqual(joined(ctx.w.occasionId))
        expect(ctx.x).toEqual(rpcError('invite_invalid'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'send ↔ send (two guests invite the same person into one occasion)',
    x: sendAs('send (Ben → Dana)', (w) => w.b, (w) => w.d),
    y: sendAs('send (Cem → Dana)', (w) => w.c, (w) => w.d),
    prepare: async (db, w) => {
      await allowGuests(db, w)
      await friends(db, w.b, w.d)
      await friends(db, w.c, w.d)
    },
    waitsOn: ['advisory', 'advisory'],
    xFirst: {
      says: 'both answer "invited"; exactly one is delivered (Ben\'s)',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(INVITED(ctx.w))
        const r = await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d)
        expect(r.filter((x) => x.delivered).map((x) => x.inviter_id)).toEqual([ctx.w.b])
      },
    },
    yFirst: {
      says: 'both answer "invited"; exactly one is delivered (Cem\'s)',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(INVITED(ctx.w))
        const r = await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d)
        expect(r.filter((x) => x.delivered).map((x) => x.inviter_id)).toEqual([ctx.w.c])
      },
    },
    firstOf: async (ctx) => ((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d)).find((x) => x.delivered)?.inviter_id === ctx.w.b ? 'x' : 'y'),
  },
  {
    name: 'send ↔ send at 19 visible invitations (two hosts, the last free place)',
    x: sendAs('send (Anna → Dana)', (w) => w.host, (w) => w.d),
    y: sendAs('send (Ben → Dana, his own occasion)', (w) => w.b, (w) => w.d, secondOf),
    prepare: async (db, w) => {
      await friends(db, w.host, w.d)
      await friends(db, w.b, w.d)
      SECOND.set(w.occasionId, await newOccasion(db, w.b, 'Bens Feier'))
      await fillInbox(db, w, 19)
    },
    waitsOn: ['advisory', 'advisory'],
    xFirst: {
      says: 'Anna\'s is the 20th, Ben\'s is suppressed; both answer "invited"',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(INVITED(ctx.w))
        expect(await visibleTo(ctx.db, ctx.w.d)).toBe(20)
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]!.delivered).toBe(true)
      },
    },
    yFirst: {
      says: 'Ben\'s is the 20th, Anna\'s is suppressed; both answer "invited"',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(INVITED(ctx.w))
        expect(await visibleTo(ctx.db, ctx.w.d)).toBe(20)
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]!.delivered).toBe(false)
      },
    },
    firstOf: async (ctx) => ((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]?.delivered ? 'x' : 'y'),
  },
  {
    name: 'send ↔ decline (the same sender, another occasion: the 30-day silence)',
    x: sendAs('send (Anna → Dana, second occasion)', (w) => w.host, (w) => w.d, secondOf),
    y: decline,
    prepare: async (db, w) => {
      SECOND.set(w.occasionId, await newOccasion(db, w.host, 'Annas Brunch'))
      await inviteDana(db, w, w.host)
    },
    waitsOn: ['advisory', 'advisory'],
    xFirst: {
      says: 'the new invitation is delivered and stays after the decline of the other one',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(OK)
        expect((await rowsBetween(ctx.db, secondOf(ctx.w), ctx.w.d))[0]).toMatchObject({ delivered: true, outcome: 'pending' })
        expect(await visibleTo(ctx.db, ctx.w.d)).toBe(1)
      },
    },
    yFirst: {
      says: 'declined first: the new one is suppressed by the silence (the answer is the same)',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect((await rowsBetween(ctx.db, secondOf(ctx.w), ctx.w.d))[0]).toMatchObject({ delivered: false })
        expect(await visibleTo(ctx.db, ctx.w.d)).toBe(0)
      },
    },
    firstOf: async (ctx) => ((await rowsBetween(ctx.db, secondOf(ctx.w), ctx.w.d))[0]?.delivered ? 'x' : 'y'),
  },
  {
    name: 'quota from two tabs (4 attempts in the last minute, one place left)',
    x: sendAs('send (Anna → Dana, tab 1)', (w) => w.host, (w) => w.d),
    y: sendAs('send (Anna → Emil, tab 2)', (w) => w.host, (w) => w.e),
    prepare: async (db, w) => {
      await friends(db, w.host, w.d)
      await friends(db, w.host, w.e)
      await db.admin.query(`insert into public.invitation_attempts (sender_id) select $1 from generate_series(1, 4)`, [w.host])
    },
    waitsOn: ['advisory', 'advisory'],
    xFirst: {
      says: 'Dana gets the 5th place, Emil\'s call is limit_reached',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(rpcError('limit_reached'))
      },
    },
    yFirst: {
      says: 'Emil gets the 5th place, Dana\'s call is limit_reached',
      async check(ctx) {
        expect(ctx.y).toEqual(INVITED(ctx.w, (w) => w.e))
        expect(ctx.x).toEqual(rpcError('limit_reached'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'accept ↔ the host moves the date into the past (REST)',
    x: accept(),
    // the world's occasion is all-day: its cutoff is the end of the start's local day, so two days back
    y: restOp('date → past (Anna, REST)', `update public.occasions set starts_at = now() - interval '2 days' where id = $1`, (w) => w.host, (w) => [w.occasionId]),
    prepare: (db, w) => inviteDana(db, w, w.host),
    waitsOn: ['occasions', 'occasions'],
    xFirst: {
      says: 'Dana joins first; the date change does not undo it',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(ctx.w.occasionId))
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.d)).toBe('active')
      },
    },
    yFirst: {
      says: 'the invitation is void with the moved date: invite_invalid',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(rpcError('invite_invalid'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'accept ↔ delete_my_account (the guest who invited)',
    x: accept(),
    y: rpcOp('delete_my_account (Ben)', 'delete_my_account', (w) => w.b),
    prepare: async (db, w) => {
      await allowGuests(db, w)
      await inviteDana(db, w, w.b)
    },
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'Dana joins; Ben\'s account goes, and with it "eingeladen von"',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(ctx.w.occasionId))
        expect(ctx.y).toEqual(OK)
        expect(await accountExists(ctx.db, ctx.w.b)).toBe(false)
        expect(await ctx.db.admin.value<number>('select count(*)::int from public.member_invited_by where occasion_id = $1', [ctx.w.occasionId])).toBe(0)
      },
    },
    yFirst: {
      says: 'the invitation went with Ben\'s account: invite_invalid',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('invite_invalid'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'send ↔ delete_my_account (the recipient)',
    x: sendAs('send (Anna → Dana)', (w) => w.host, (w) => w.d),
    y: rpcOp('delete_my_account (Dana)', 'delete_my_account', (w) => w.d),
    prepare: (db, w) => friends(db, w.host, w.d),
    // the deletion of Dana's profile row waits for the send's FOR KEY SHARE on it; PostgreSQL shows that wait on
    // the holder's transaction id (no separate tuple lock entry)
    waitsOn: ['xid', 'profiles'],
    xFirst: {
      says: 'sent, then Dana\'s account takes every row with it',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(OK)
        expect(await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d)).toEqual([])
      },
    },
    yFirst: {
      says: 'Dana is gone: not a candidate any more, not_found',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'accept by a list owner ↔ a reservation on her own list (IS6: the answer does not depend on the order)',
    x: rpcOp('respond accept (Anna, into Dana\'s occasion)', 'respond_occasion_invite', (w) => w.host, (w) => [invOf(w), true]),
    y: rpcOp('reserve_wish (Ben, on Anna\'s list)', 'reserve_wish', (w) => w.b, (w) => [w.w1]),
    prepare: async (db, w) => {
      const theirs = await newOccasion(db, w.d, 'Danas Fest')
      SECOND.set(w.occasionId, theirs)
      await friends(db, w.d, w.host)
      await send(db, w.d, theirs, [w.host])
      INV.set(w.occasionId, await db.admin.value<string>('select id from public.occasion_invitations where occasion_id = $1', [theirs]))
    },
    waitsOn: ['profiles', 'profiles'],
    xFirst: {
      says: 'both succeed',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(secondOf(ctx.w)))
        expect(ctx.y).toEqual(OK)
      },
    },
    yFirst: {
      says: 'both succeed with the same answers',
      async check(ctx) {
        expect(ctx.x).toEqual(joined(secondOf(ctx.w)))
        expect(ctx.y).toEqual(OK)
      },
    },
    firstOf: () => 'x',
  },
  {
    name: 'send ↔ unfollow (the invitee ends the friendship): nothing pending survives',
    x: sendAs('send (Anna → Dana)', (w) => w.host, (w) => w.d),
    y: rpcOp('unfollow (Dana unfollows Anna)', 'unfollow', (w) => w.d, (w) => [w.host]),
    prepare: (db, w) => friends(db, w.host, w.d),
    waitsOn: ['follows', 'follows'],
    xFirst: {
      says: 'sent, then the unfollow voids it',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(OK)
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]).toMatchObject({ outcome: 'void' })
      },
    },
    yFirst: {
      says: 'not friends any more: not_found, no row',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
        expect(await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d)).toEqual([])
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'send by a guest ↔ the invitee blocks the host: nothing pending survives',
    x: sendAs('send (Ben → Dana)', (w) => w.b, (w) => w.d),
    y: rpcOp('block_user (Dana blocks Anna)', 'block_user', (w) => w.d, (w) => [w.host]),
    prepare: async (db, w) => {
      await allowGuests(db, w)
      await friends(db, w.b, w.d)
    },
    waitsOn: ['advisory', 'advisory'],
    xFirst: {
      says: 'delivered, then the block voids it',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(OK)
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]).toMatchObject({ delivered: true, outcome: 'void' })
      },
    },
    yFirst: {
      says: 'blocked first: suppressed (the same answer)',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]).toMatchObject({ delivered: false })
      },
    },
    firstOf: async (ctx) => ((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]?.delivered ? 'x' : 'y'),
  },
  {
    name: 'send by a guest ↔ the same guest leaves (second tab)',
    x: sendAs('send (Ben → Dana)', (w) => w.b, (w) => w.d),
    y: rpcOp('leave_occasion (Ben, tab 2)', 'leave_occasion', (w) => w.b, (w) => [w.occasionId]),
    prepare: async (db, w) => {
      await allowGuests(db, w)
      await friends(db, w.b, w.d)
    },
    waitsOn: ['occasion_members', 'occasion_members'],
    xFirst: {
      says: 'sent, then the leave voids it',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(OK)
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]).toMatchObject({ outcome: 'void' })
      },
    },
    yFirst: {
      says: 'left first: not_found',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    // Codex review 27.10 #2: before the fix, send's expiry cleanup also touched the guest's own expired invitation to
    // the host in ANOTHER occasion — which block_user's trigger had just locked while waiting for the guest's membership
    // row (held FOR SHARE by the send): a deadlock. Now the cleanup stays inside this occasion and the requested people.
    name: 'send by a guest ↔ the host blocks that guest (who has an old expired invitation to the host elsewhere)',
    x: sendAs('send (Ben → Dana)', (w) => w.b, (w) => w.d),
    y: rpcOp('block_user (Anna blocks Ben)', 'block_user', (w) => w.host, (w) => [w.b]),
    prepare: async (db, w) => {
      await allowGuests(db, w)
      await friends(db, w.b, w.d)
      await friends(db, w.b, w.host)
      const bens = await newOccasion(db, w.b, 'Bens Abend')
      SECOND.set(w.occasionId, bens)
      await send(db, w.b, bens, [w.host])
      await db.admin.query(`update public.occasion_invitations set expires_at = now() - interval '1 minute' where occasion_id = $1`, [bens])
    },
    waitsOn: ['occasion_members', 'occasion_members'],
    xFirst: {
      says: 'sent, then the block removes Ben and voids what he sent',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual(OK)
        expect(await memberStatus(ctx.db, ctx.w, ctx.w.b)).toBe('removed')
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]).toMatchObject({ outcome: 'void' })
      },
    },
    yFirst: {
      says: 'blocked first: Ben is out, not_found',
      async check(ctx) {
        expect(ctx.y).toEqual(OK)
        expect(ctx.x).toEqual(rpcError('not_found'))
      },
    },
    firstOf: ({ x }) => (x.ok ? 'x' : 'y'),
  },
  {
    name: 'send ↔ the invitee switches to "Niemand" (REST)',
    x: sendAs('send (Anna → Dana)', (w) => w.host, (w) => w.d),
    y: restOp('invitations_from = nobody (Dana, REST)', `update public.profiles set invitations_from = 'nobody' where id = $1`, (w) => w.d, (w) => [w.d]),
    prepare: (db, w) => friends(db, w.host, w.d),
    waitsOn: ['advisory', 'advisory'],
    xFirst: {
      says: 'delivered, then the switch voids it',
      async check(ctx) {
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]).toMatchObject({ delivered: true, outcome: 'void' })
      },
    },
    yFirst: {
      says: 'switched first: suppressed (the same answer)',
      async check(ctx) {
        expect(ctx.y).toEqual({ ok: true, value: 1 })
        expect(ctx.x).toEqual(INVITED(ctx.w))
        expect((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]).toMatchObject({ delivered: false })
      },
    },
    firstOf: async (ctx) => ((await rowsBetween(ctx.db, ctx.w.occasionId, ctx.w.d))[0]?.delivered ? 'x' : 'y'),
  },
]

function expectContract(label: string, out: Ctx['x']): void {
  if (out.ok) return
  const contract = out.code === 'P0001' && (CONTRACT_CODES as readonly string[]).includes(out.message)
  expect(contract, `${label}: database error outside the contract: ${out.code} ${out.message}`).toBe(true)
}

let db: RealPg
let s1: Session
let s2: Session

beforeAll(async () => {
  db = await startRealPg()
  // the feature ships switched off (20261027120000 header): these tests are about the released feature
  await db.admin.query('update private.features set occasion_invitations = true')
  s1 = await db.session('tx-1')
  s2 = await db.session('tx-2')
})
afterAll(async () => {
  await db?.close()
})

/** The deterministic order tests; `advisory` = the waiter queues on an advisory lock (pg_locks / wait event). */
for (const pair of PAIRS) {
  const asPair = pair as unknown as Pair
  const waitedOn = (block: { rowLockOn: string | null; waitEvent: string | null }) =>
    block.waitEvent === 'Lock:advisory' ? 'advisory' : block.rowLockOn ?? (block.waitEvent === 'Lock:transactionid' ? 'xid' : null)
  describe(pair.name, () => {
    it(`${pair.x.label} holds its locks → ${pair.y.label} waits (${pair.waitsOn[0]}) → ${pair.xFirst.says}`, async () => {
      const w = await seedFor(db, asPair)
      const r = await holdThenRun(db, s1, s2, w, pair.x, pair.y)
      expect(waitedOn(r.block), JSON.stringify(r.block)).toBe(pair.waitsOn[0])
      await pair.xFirst.check({ db, w, x: r.first, y: r.second, schedule: 'hold' })
      expect(await zombies(db)).toBe(0)
    })
    if (pair.symmetric) return
    it(`${pair.y.label} holds its locks → ${pair.x.label} waits (${pair.waitsOn[1]}) → ${pair.yFirst.says}`, async () => {
      const w = await seedFor(db, asPair)
      const r = await holdThenRun(db, s1, s2, w, pair.y, pair.x)
      expect(waitedOn(r.block), JSON.stringify(r.block)).toBe(pair.waitsOn[1])
      await pair.yFirst.check({ db, w, x: r.second, y: r.first, schedule: 'hold' })
      expect(await zombies(db)).toBe(0)
    })
  })
}

describe('send never waits on the sender\'s own rows in other occasions (Codex review 27.10 #2)', () => {
  it('another transaction holds Ben\'s old expired invitation elsewhere (as block_user\'s trigger would): Ben\'s send does not wait for it', async () => {
    const w = await seedWorld(db)
    await allowGuests(db, w)
    await friends(db, w.b, w.d)
    await friends(db, w.b, w.host)
    const bens = await newOccasion(db, w.b, 'Bens Abend')
    await send(db, w.b, bens, [w.host])
    await db.admin.query(`update public.occasion_invitations set expires_at = now() - interval '1 minute' where occasion_id = $1`, [bens])
    const holder = await db.session('holder')
    try {
      await holder.begin()
      await holder.query('select id from public.occasion_invitations where occasion_id = $1 for update', [bens])
      await s1.begin(w.b)
      // before the fix this waited for the held row (and with block_user's membership update: a deadlock)
      expect(await settle(s1.rpc('send_occasion_invites', [w.occasionId, [w.d]]))).toEqual(INVITED(w))
      await s1.commit()
    } finally {
      await holder.rollback().catch(() => undefined)
      await holder.end()
    }
  })
})

describe('the emergency switch (supabase/emergency/occasion_invitations_off.sql) and a running send (Codex review 27.10 #3)', () => {
  const template = () => readFile(join(packageRoot, '..', '..', 'supabase', 'emergency', 'occasion_invitations_off.sql'), 'utf8')
  const switchOn = () => db.admin.query('update private.features set occasion_invitations = true')
  const pendingDelivered = () => db.admin.value<number>(`select count(*)::int from public.occasion_invitations where outcome = 'pending' and delivered`)

  it('a send holds the switch row → the switch waits → then voids what the send inserted (nothing comes back later)', async () => {
    const w = await seedWorld(db)
    await friends(db, w.host, w.d)
    const admin2 = await db.session('switch')
    try {
      await s1.begin(w.host)
      const sent = await settle(s1.rpc('send_occasion_invites', [w.occasionId, [w.d]]))
      expect(sent).toEqual(INVITED(w))
      await admin2.begin()
      const switching = settle(admin2.query(await template()))
      await db.waitUntilBlocked(admin2, s1, switching)
      await s1.commit()
      expect((await switching).ok).toBe(true)
      await admin2.commit()
      expect(await pendingDelivered()).toBe(0)
      await switchOn()
      expect(await visibleTo(db, w.d)).toBe(0) // switched on again: nothing resurrected
    } finally {
      await switchOn()
      await admin2.end()
    }
  })

  it('the switch holds → a send waits → then answers not_found and writes nothing', async () => {
    const w = await seedWorld(db)
    await friends(db, w.host, w.d)
    const admin2 = await db.session('switch-2')
    try {
      await admin2.begin()
      await admin2.query(await template())
      await s1.begin(w.host)
      const sending = settle(s1.rpc('send_occasion_invites', [w.occasionId, [w.d]]))
      await db.waitUntilBlocked(s1, admin2, sending)
      await admin2.commit()
      expect(await sending).toEqual(rpcError('not_found'))
      await s1.rollback()
      expect(await rowsBetween(db, w.occasionId, w.d)).toEqual([])
    } finally {
      await switchOn()
      await admin2.end()
    }
  })
})

describe('invitation operations at the same moment', () => {
  for (const pair of PAIRS) {
    it(`${pair.name}: ${ROUNDS} rounds, no deadlock or timeout, each round equals one serial order, no zombie`, async () => {
      const seen = { x: 0, y: 0 }
      for (let round = 0; round < ROUNDS; round++) {
        const w = await seedFor(db, pair as unknown as Pair)
        const out = await race([s1, s2], w, pair.x, pair.y, round % 2 === 0, Math.floor(round / 2))
        expectContract(`${pair.x.label} (round ${round + 1})`, out.x)
        expectContract(`${pair.y.label} (round ${round + 1})`, out.y)
        const ctx: Ctx = { db, w, ...out, schedule: 'race' }
        const first = await pair.firstOf(ctx)
        seen[first] += 1
        await (first === 'x' ? pair.xFirst : pair.yFirst).check(ctx)
        expect(await zombies(db)).toBe(0)
      }
      console.info(`[races] ${pair.name}: ${pair.x.label} first ${seen.x}/${ROUNDS}, ${pair.y.label} first ${seen.y}/${ROUNDS}`)
    })
  }
})
