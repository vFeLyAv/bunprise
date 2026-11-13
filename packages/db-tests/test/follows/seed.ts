/**
 * Shared fixture for the follows / standalone-list tests (wave 2b; follows-design §7.1). Not a test file.
 *
 * seedFollows(): (all names invented, e-mails @example.test)
 *   Paula   the owner. L1 "Meine Wünsche" (3 wishes, priorities 3 / 1 / 2), L2 "Privat" (1 wish), her occasion O1
 *           with its list (1 wish), one live follow link.
 *   Finn    accepted follower of Paula (via the link); also a guest of O2.
 *   Greta   accepted follower of Paula (via the link). Finn and Greta share nothing (P2: followers do not know each other).
 *   Rosa    a request to Paula via the link, still pending (no shared occasion with Paula).
 *   Moritz  a guest of O1 (Paula's occasion), not a follower; host of O2.
 *   Xaver   outsider: consents + name, nothing else.
 *   Bea     a guest of O2; Paula blocks Bea AFTER both joined O2 (a block inside somebody else's occasion).
 *   O2      Moritz's occasion: guests Paula, Bea, Finn.
 *
 * Visibility of L1: M1/M2 know only 'private' for a standalone list, so L1 is 'private' there.
 * From M3 on (20261020200200_follow_sharing.sql, agent J2) the seed finishes the spec's world (follows-design §7.1):
 * Paula switches L1 to 'followers' through set_list_visibility (the only way), and Greta + Moritz switch
 * in_suggestions on (REST, their own rows). seedFollows(t, { l1: 'private' }) keeps L1 "Nur ich" for a test that
 * needs it. Every follows test runs on the same world; the tests of M1/M2 do not depend on L1's visibility.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'vitest'
import { MIGRATIONS_DIR, isDbError, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, rpc } from '../pilot/seed'

export const NAMES = {
  paula: 'Paula',
  finn: 'Finn',
  greta: 'Greta',
  rosa: 'Rosa',
  moritz: 'Moritz',
  xaver: 'Xaver',
  bea: 'Bea',
} as const

export const L1_TITLE = 'Meine Wünsche'
export const L2_TITLE = 'Privat'
export const O1_TITLE = 'Paulas Gartenfest'
export const O2_TITLE = 'Moritz’ Spieleabend'
/** L1's wishes in creation order with their priorities: w1 = 3 (Unbedingt), w2 = 1 (Kann), w3 = 2 (Gern). */
export const L1_WISH_TITLES = { w1: 'Kopfhörer', w2: 'Buch', w3: 'Teekanne' } as const

export interface FollowSeed {
  paula: string
  finn: string
  greta: string
  rosa: string
  moritz: string
  xaver: string
  bea: string
  l1: string
  /** [priority 3, priority 1, priority 2] in creation order */
  l1Wishes: [string, string, string]
  l2: string
  l2Wish: string
  o1: string
  o1List: string
  o1Wish: string
  o2: string
  o2List: string
  /** Paula's live follow link (64 hex), used by Finn, Greta and Rosa (use_count 3) */
  token: string
  /** the invite token of O1 and O2 */
  o1Invite: string
  o2Invite: string
}

/** A standalone list through REST, exactly like the client (`insert … returning`). */
export function createList(
  t: TestDb,
  owner: string,
  title: string,
  extra: { id?: string; visibility?: string; cover_tone?: number | null; cover_icon?: string | null; due_on?: string | null } = {},
): Promise<string> {
  return t.asUser(owner, (tx) =>
    scalar<string>(
      tx,
      `insert into wishlists (id, owner_id, recipient_id, title, visibility, cover_tone, cover_icon, due_on)
       values (coalesce($1::uuid, gen_random_uuid()), $2, $2, $3, $4, $5, $6, $7::date) returning id`,
      [extra.id ?? null, owner, title, extra.visibility ?? 'private', extra.cover_tone ?? null, extra.cover_icon ?? null, extra.due_on ?? null],
    ),
  )
}

/** A wish through REST as the list owner; minutesAgo makes the created_at order deterministic. */
export async function addWish(t: TestDb, owner: string, listId: string, title: string, priority = 2, minutesAgo = 0): Promise<string> {
  // created_at is not insertable through REST (20261027200000, SW34): the owner inserts, the seed back-dates it
  const id = await t.asUser(owner, (tx) =>
    scalar<string>(tx, `insert into wishes (wishlist_id, title, priority) values ($1, $2, $3) returning id`, [listId, title, priority]),
  )
  if (minutesAgo !== 0) await backdateWish(t, id, minutesAgo)
  return id
}

/** Seed helper (superuser): moves a wish's created_at — and its home place's added_at — into the past. */
export async function backdateWish(t: TestDb, wishId: string, minutesAgo: number): Promise<void> {
  await t.db.query(`update public.wishes set created_at = now() - make_interval(mins => $2::int) where id = $1`, [wishId, minutesAgo])
  // (a database built from an older subset of the migrations has no places yet)
  if (await scalar<boolean>(t.db, `select to_regclass('private.wish_placements') is not null`)) {
    await t.db.query(
      `update private.wish_placements p set added_at = w.created_at from public.wishes w
        where w.id = $1 and p.wish_id = w.id and p.wishlist_id = w.wishlist_id`,
      [wishId],
    )
  }
}

/** An occasion through REST (the trigger adds the host membership and THE list); returns [occasion, list]. */
export async function createOccasion(t: TestDb, host: string, title: string, inDays = 30): Promise<[string, string]> {
  const occasionId = await t.asUser(host, (tx) =>
    scalar<string>(
      tx,
      `insert into occasions (host_id, title, starts_at, tz) values ($1, $2, now() + make_interval(days => $3::int), 'Europe/Berlin') returning id`,
      [host, title, inDays],
    ),
  )
  const listId = await scalar<string>(t.db, 'select id from wishlists where occasion_id = $1', [occasionId])
  return [occasionId, listId]
}

export async function invite(t: TestDb, host: string, occasionId: string): Promise<string> {
  return (await rpc<{ token: string }>(t, host, 'create_invite', [occasionId])).token
}

export async function followLink(t: TestDb, owner: string): Promise<string> {
  return (await rpc<{ token: string; expires_at: string }>(t, owner, 'create_follow_link')).token
}

export interface SeedFollowsOptions {
  /** M3 only: L1's audience at the end of the seed (default 'followers', the spec's world) */
  l1?: 'private' | 'followers'
}

export async function seedFollows(t: TestDb, opts: SeedFollowsOptions = {}): Promise<FollowSeed> {
  const paula = await createMember(t, NAMES.paula)
  const finn = await createMember(t, NAMES.finn)
  const greta = await createMember(t, NAMES.greta)
  const rosa = await createMember(t, NAMES.rosa)
  const moritz = await createMember(t, NAMES.moritz)
  const xaver = await createMember(t, NAMES.xaver)
  const bea = await createMember(t, NAMES.bea)

  // Paula's lists (REST, like the client) — L1 with three wishes of different priorities, L2 with one
  const l1 = await createList(t, paula, L1_TITLE, { cover_tone: 2, cover_icon: 'star' })
  const w1 = await addWish(t, paula, l1, L1_WISH_TITLES.w1, 3, 3)
  const w2 = await addWish(t, paula, l1, L1_WISH_TITLES.w2, 1, 2)
  const w3 = await addWish(t, paula, l1, L1_WISH_TITLES.w3, 2, 1)
  const l2 = await createList(t, paula, L2_TITLE)
  const l2Wish = await addWish(t, paula, l2, 'Tagebuch')

  // O1: Paula's occasion, Moritz is a guest
  const [o1, o1List] = await createOccasion(t, paula, O1_TITLE, 20)
  const o1Wish = await addWish(t, paula, o1List, 'Gartenstuhl')
  const o1Invite = await invite(t, paula, o1)
  await rpc(t, moritz, 'accept_invite', [o1Invite])

  // Paula's follow link: Finn and Greta follow (accepted), Rosa waits
  const token = await followLink(t, paula)
  for (const who of [finn, greta, rosa]) {
    expect(await rpc(t, who, 'request_follow_via_link', [token])).toEqual({ status: 'requested', profile_id: paula })
  }
  for (const who of [finn, greta]) expect(await rpc(t, paula, 'respond_follow', [who, true])).toEqual({ ok: true })

  // O2: Moritz's occasion with Paula, Bea and Finn as guests; then Paula blocks Bea (both stay guests of O2)
  const [o2, o2List] = await createOccasion(t, moritz, O2_TITLE, 10)
  const o2Invite = await invite(t, moritz, o2)
  for (const who of [paula, bea, finn]) await rpc(t, who, 'accept_invite', [o2Invite])
  expect(await rpc(t, paula, 'block_user', [bea])).toEqual({ ok: true })

  // M3: L1 is "Meine Follower" (Paula's explicit choice), Greta and Moritz appear in suggestions (their own choice)
  if (await m3Applied(t)) {
    if ((opts.l1 ?? 'followers') === 'followers') {
      expect(await rpc(t, paula, 'set_list_visibility', [l1, 'followers'])).toEqual({ ok: true })
    }
    for (const who of [greta, moritz]) {
      await t.asUser(who, (tx) => tx.query('update profiles set in_suggestions = true where id = $1', [who]))
    }
  }

  return { paula, finn, greta, rosa, moritz, xaver, bea, l1, l1Wishes: [w1, w2, w3], l2, l2Wish, o1, o1List, o1Wish, o2, o2List, token, o1Invite, o2Invite }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** An RPC as text (byte comparisons). */
export function rpcText(t: TestDb, uid: string, fn: string, args: readonly unknown[] = []): Promise<string> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
  return t.asUser(uid, (tx) => scalar<string>(tx, `select public.${fn}(${placeholders})::text as v`, args))
}

/** The RPC's text, or `error:<SQLSTATE>:<message>` — for snapshots that must also compare refusals. */
export async function rpcOutcome(t: TestDb, uid: string, fn: string, args: readonly unknown[] = []): Promise<string> {
  try {
    return await rpcText(t, uid, fn, args)
  } catch (err) {
    if (isDbError(err)) return `error:${err.code}:${err.message}`
    throw err
  }
}

/** export_my_data() without exported_at, parsed. */
export async function exportOf(t: TestDb, uid: string): Promise<Record<string, unknown>> {
  return JSON.parse(await t.asUser(uid, (tx) => scalar<string>(tx, `select (public.export_my_data() - 'exported_at')::text`))) as Record<string, unknown>
}

export type FollowRow = {
  follower_id: string
  followee_id: string
  status: string
}

export function followRows(t: TestDb, where = 'true', params: readonly unknown[] = []): Promise<FollowRow[]> {
  return rows<FollowRow>(t.db, `select follower_id, followee_id, status from public.follows where ${where} order by 1, 2`, params)
}

/**
 * Is M3 (20261020200200_follow_sharing.sql: visibility 'followers', set_list_visibility) applied? A few checks of the
 * M1 / M2 tests are stated "until M3" by the spec (no 'followers' anywhere, cards without lists); with M3 they turn
 * into the M3 rule instead of failing. Everything else is checked the same in every state.
 */
export function m3Applied(t: TestDb): Promise<boolean> {
  return scalar<boolean>(
    t.db,
    `select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'set_list_visibility')`,
  )
}

/** Every 64-hex shaped token is a valid argument shape; this one exists nowhere. */
export const UNKNOWN_TOKEN = 'f'.repeat(64)
export const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff'

// ---------------------------------------------------------------------------
// The database "red button" (M3, follows-design §9) — the emergency template, NOT a migration
// ---------------------------------------------------------------------------

/** supabase/emergency/follower_lists_off.sql (outside supabase/migrations/, so no harness applies it by itself). */
export const RED_BUTTON_FILE = join(MIGRATIONS_DIR, '..', 'emergency', 'follower_lists_off.sql')

/** Plays the emergency template exactly as written, as ONE transaction (like a migration file). */
export async function pressRedButton(t: TestDb): Promise<void> {
  const sql = await readFile(RED_BUTTON_FILE, 'utf8')
  await t.db.transaction((tx) => tx.exec(sql))
}

/** Switching back on (follows-design §9): a single statement; ended reservations never come back. */
export async function releaseRedButton(t: TestDb): Promise<void> {
  await t.db.transaction((tx) => tx.exec('update private.features set follower_lists = true'))
}
