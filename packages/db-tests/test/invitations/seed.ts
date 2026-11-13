/**
 * Shared fixture for the in-app invitation tests (supabase/migrations/20261027120000_occasion_invitations.sql,
 * docs/spec/in-app-invites-design.md §9). Not a test file. All names invented, e-mails @example.test.
 *
 * seedInvites():
 *   Hanna   the host of occasion O ("Grillabend", in 20 days, 18:00 Berlin, place + description, two wishes).
 *   Gina    an active guest of O (joined through the link).
 *   Felix   a friend (mutual accepted follows) of Hanna AND of Gina.
 *   Frida   a friend of Gina only.
 *   Fabian  a friend of Hanna only.
 *   Olga    follows Hanna (accepted) — one way only: NOT a friend.
 *   Xaver   an outsider: consents + name, no relation.
 * Every call makes fresh people, so a file can seed as often as it needs inside its one PGlite.
 * Follows are written directly (superuser) — the follow RPCs have their own tests; here only "friends or not" matters.
 */
import { expect } from 'vitest'
import { one, rows, scalar, type TestDb } from '../../src/harness'
import { backdateWish } from '../follows/seed'
import { createMember, execAs, rpc } from '../pilot/seed'

export interface InviteWorld {
  host: string
  guest: string
  felix: string
  frida: string
  fabian: string
  olga: string
  xaver: string
  occasionId: string
  listId: string
  wish1: string
  wish2: string
  token: string
}

export const OCCASION_TITLE = 'Grillabend'

/**
 * The release step (supabase/emergency/occasion_invitations_on.sql): 20261027120000 creates the feature switched OFF,
 * 20261027130000_occasion_invitations_on.sql switches it on with the 4th release (Felix 26.10). Tests of the released
 * feature still switch it on themselves (createTestDb({ extraSql: [SWITCH_ON] })), so they do not depend on that
 * release migration; switch-off.test.ts covers both states.
 */
export const SWITCH_ON = 'update private.features set occasion_invitations = true'

export interface SeedOptions {
  /** days until the start (default 20) */
  startsInDays?: number
  /** an all-day occasion (default false: 18:00 Europe/Berlin) */
  allDay?: boolean
  /** "Gäste dürfen Freunde einladen" (default false, like the product) */
  guestsCanInvite?: boolean
}

/** Two accepted follows (friends). */
export async function friends(t: TestDb, a: string, b: string): Promise<void> {
  await t.db.query(
    `insert into public.follows (follower_id, followee_id, status, requested_at, accepted_at)
     values ($1, $2, 'accepted', now(), now()), ($2, $1, 'accepted', now(), now())
     on conflict (follower_id, followee_id) do update set status = 'accepted', accepted_at = now(), expires_at = null`,
    [a, b],
  )
}

/** One accepted follow a -> b. */
export async function follows(t: TestDb, a: string, b: string): Promise<void> {
  await t.db.query(
    `insert into public.follows (follower_id, followee_id, status, requested_at, accepted_at) values ($1, $2, 'accepted', now(), now())
     on conflict (follower_id, followee_id) do nothing`,
    [a, b],
  )
}

/** An occasion through REST (the trigger adds the host membership and the list), with two wishes; returns ids. */
export async function createOccasion(
  t: TestDb,
  host: string,
  opts: SeedOptions & { title?: string } = {},
): Promise<{ occasionId: string; listId: string; wish1: string; wish2: string }> {
  const days = opts.startsInDays ?? 20
  const occasionId = await t.asUser(host, (tx) =>
    scalar<string>(
      tx,
      `insert into occasions (host_id, title, starts_at, tz, all_day, place_text, description, guests_can_invite)
       values ($1, $2,
               case when $4 then date_trunc('day', now() at time zone 'Europe/Berlin' + make_interval(days => $3::int)) at time zone 'Europe/Berlin'
                    else (date_trunc('day', now() at time zone 'Europe/Berlin' + make_interval(days => $3::int)) + interval '18 hours') at time zone 'Europe/Berlin' end,
               'Europe/Berlin', $4, 'Bei Hanna, Gartenweg 1', 'Bring gute Laune mit', $5)
       returning id`,
      [host, opts.title ?? OCCASION_TITLE, days, opts.allDay ?? false, opts.guestsCanInvite ?? false],
    ),
  )
  const listId = await scalar<string>(t.db, 'select id from wishlists where occasion_id = $1', [occasionId])
  // created_at is not insertable through REST (20261027200000): the host inserts, the seed back-dates it
  const wish = async (title: string, minutesAgo: number) => {
    const id = await t.asUser(host, (tx) => scalar<string>(tx, `insert into wishes (wishlist_id, title) values ($1, $2) returning id`, [listId, title]))
    await backdateWish(t, id, minutesAgo)
    return id
  }
  return { occasionId, listId, wish1: await wish('Grillzange', 2), wish2: await wish('Lampions', 1) }
}

export async function seedInvites(t: TestDb, opts: SeedOptions = {}): Promise<InviteWorld> {
  const host = await createMember(t, 'Hanna')
  const guest = await createMember(t, 'Gina')
  const felix = await createMember(t, 'Felix')
  const frida = await createMember(t, 'Frida')
  const fabian = await createMember(t, 'Fabian')
  const olga = await createMember(t, 'Olga')
  const xaver = await createMember(t, 'Xaver')
  const o = await createOccasion(t, host, opts)
  const { token } = await rpc<{ token: string }>(t, host, 'create_invite', [o.occasionId])
  await rpc(t, guest, 'accept_invite', [token])
  await friends(t, host, felix)
  await friends(t, guest, felix)
  await friends(t, guest, frida)
  await friends(t, host, fabian)
  await follows(t, olga, host)
  return { host, guest, felix, frida, fabian, olga, xaver, token, ...o }
}

// ---------------------------------------------------------------------------------------------------------------
// RPC wrappers (as the user) and superuser readers
// ---------------------------------------------------------------------------------------------------------------

export interface Card {
  id: string
  display_name: string | null
  banner: string | null
  photo: unknown
  banner_photo: unknown
}
export interface Candidate {
  profile: Card
  state: 'none' | 'invited' | 'withdrawn'
  expires_at: string | null
}
export interface SentAnswer {
  profile_id: string
  state: string
  expires_at: string
}
export interface MyInvitation {
  id: string
  occasion: { id: string; title: string; starts_at: string; tz: string; all_day: boolean }
  host_name: string | null
  inviter: Card
  expires_at: string
  created_at: string
}

export const candidates = (t: TestDb, uid: string, occasionId: string) => rpc<Candidate[]>(t, uid, 'get_invite_candidates', [occasionId])
export const send = (t: TestDb, uid: string, occasionId: string, ids: readonly string[]) =>
  rpc<SentAnswer[]>(t, uid, 'send_occasion_invites', [occasionId, ids])
export const withdraw = (t: TestDb, uid: string, occasionId: string, profileId: string) =>
  rpc<{ ok: true }>(t, uid, 'withdraw_occasion_invite', [occasionId, profileId])
export const sentList = (t: TestDb, uid: string, occasionId: string) =>
  rpc<{ profile_id: string; display_name: string | null; state: string; expires_at: string }[]>(t, uid, 'get_sent_invitations', [occasionId])
export const inbox = (t: TestDb, uid: string) => rpc<MyInvitation[]>(t, uid, 'get_my_invitations')
export const respond = (t: TestDb, uid: string, invitationId: string, accept: boolean) =>
  rpc<Record<string, unknown>>(t, uid, 'respond_occasion_invite', [invitationId, accept])
export const inviteInfo = (t: TestDb, uid: string, occasionId: string) =>
  rpc<{ guests_can_invite: boolean; can_invite: boolean; invited_by: { profile_id: string; inviter: { id: string; display_name: string } }[] }>(
    t,
    uid,
    'get_occasion_invite_info',
    [occasionId],
  )
export const dot = async (t: TestDb, uid: string) => (await rpc<{ inbox: { occasion_invites: number } }>(t, uid, 'get_me')).inbox.occasion_invites

/** The RPC's answer as raw text (byte-identity checks). */
export function rpcText(t: TestDb, uid: string, fn: string, args: readonly unknown[] = []): Promise<string> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
  return t.asUser(uid, (tx) => scalar<string>(tx, `select public.${fn}(${placeholders})::text as v`, args))
}

/** The RPC's outcome as text: the answer, or "ERR <message>" (for a world snapshot that includes refusals). */
export async function outcomeText(t: TestDb, uid: string, fn: string, args: readonly unknown[] = []): Promise<string> {
  try {
    return await rpcText(t, uid, fn, args)
  } catch (err) {
    return `ERR ${(err as { message?: string }).message ?? String(err)}`
  }
}

export function allowGuests(t: TestDb, w: InviteWorld, on: boolean): Promise<number> {
  return execAs(t, w.host, 'update occasions set guests_can_invite = $2 where id = $1', [w.occasionId, on])
}

/** Forget the sender's quota ledger (a test that sends more than 5 in a minute is not about quotas). */
export async function resetQuota(t: TestDb, uid: string): Promise<void> {
  await t.db.query('delete from public.invitation_attempts where sender_id = $1', [uid])
}

export interface InvitationRow {
  id: string
  occasion_id: string
  inviter_id: string
  invitee_id: string
  delivered: boolean
  outcome: string
  live: boolean
  expires_at: string
  withdrawn_at: string | null
}

/** The newest row of (occasion, inviter, invitee), superuser. */
export function rowOf(t: TestDb, occasionId: string, inviter: string, invitee: string): Promise<InvitationRow | null> {
  return one<InvitationRow & Record<string, unknown>>(
    t.db,
    `select id, occasion_id, inviter_id, invitee_id, delivered, outcome, live, expires_at::text, withdrawn_at::text
       from public.occasion_invitations where occasion_id = $1 and inviter_id = $2 and invitee_id = $3
      order by created_at desc, id desc limit 1`,
    [occasionId, inviter, invitee],
  )
}

/** The invitee's invitation id from their inbox (expects exactly one from this inviter into this occasion). */
export async function inboxId(t: TestDb, invitee: string, occasionId: string): Promise<string> {
  const list = (await inbox(t, invitee)).filter((x) => x.occasion.id === occasionId)
  expect(list).toHaveLength(1)
  return list[0]!.id
}

/** Pretends time has passed for the rows of an occasion (superuser): their expires_at lies in the past. */
export async function expireRows(t: TestDb, occasionId: string): Promise<void> {
  await t.db.query(`update public.occasion_invitations set expires_at = now() - interval '1 minute' where occasion_id = $1`, [occasionId])
}

export function countRows(t: TestDb, table: string, where = 'true', params: readonly unknown[] = []): Promise<number> {
  return scalar<number>(t.db, `select count(*)::int from public.${table} where ${where}`, params)
}

export function rowsOf<T extends Record<string, unknown>>(t: TestDb, sql: string, params: readonly unknown[] = []): Promise<T[]> {
  return rows<T>(t.db, sql, params)
}
