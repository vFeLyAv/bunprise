/**
 * Invariants of follows-design §6.2 as reusable checks (not a test file). Every test that changes follow / block /
 * list data calls checkInvariants() afterwards; the snapshot helpers are the building blocks of INV-2 / INV-3 / INV-3b.
 *
 *   INV-1 (access)        no ACTIVE reservation whose reserver cannot read that list any more. Holds since the pilot
 *                         (occasion lists); M3 (follower lists, set_list_visibility, the red button) makes it bite.
 *   INV-2 (owner bytes)   ownerSnapshot(): everything the owner can read — every SELECT-granted column of every API
 *                         table and every read RPC as text. Ready for M3 (F08 / F20 compare it around reserve/cancel).
 *   INV-3 (cloak)         relationSnapshot(requester, …) is the same for "waiting", "silently refused" and "asked again
 *                         in silence" (F05).
 *   INV-3b (real silence) relationSnapshot(hider, …) does not change by actions of the hidden person (F05).
 *   INV-4 (graph)         expectOnlyKnownProfiles(): no answer to U contains the id of a person U has no relation with.
 *   INV-5 (block)         no follows row at all — accepted or pending — inside a blocked pair.
 *   INV-6 (silence never shorter)  cooldownRows() before / after: a row only disappears through the purge after
 *                         `until` or the account cascade, and `until` only grows.
 *   + the pilot rules: at most one active reservation per wish; never by the list's owner or recipient.
 */
import { expect } from 'vitest'
import { rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES, RPC_ONLY_TABLES } from '../pilot/seed'

// ---------------------------------------------------------------------------
// INV-1, INV-5, pilot rules
// ---------------------------------------------------------------------------

/**
 * INV-1 since 20261027200000 (shared wishes, LAZY liveness — design §2.5): a reservation that lost its access is DEAD
 * at once (no answer shows or counts it — the screens / my_reservations compute liveness) and the background cleanup
 * ends it. The table-level check: run the cleanup to the end of a quiet pass (INV-1b), then no ACTIVE row may be dead.
 */
export async function inv1Violations(t: TestDb): Promise<number> {
  await runCleanupPass(t)
  return scalar<number>(
    t.db,
    `select count(*)::int from public.reservations r
      where r.status = 'active' and not private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)`,
  )
}

/** The cleanup job until both steps finished a pass (what pg_cron does every minute). */
export async function runCleanupPass(t: TestDb): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const out = await scalar<{ stale: { pass_complete: boolean }; orphans: { pass_complete: boolean } }>(
      t.db,
      'select private.reservations_cleanup_run(2000)',
    )
    if (out.stale.pass_complete && out.orphans.pass_complete) return
  }
  throw new Error('cleanup pass did not complete')
}

/** INV-8 / INV-9: every place of a wish is a list of the wish's owner, and its home is one of its places. */
export function placementViolations(t: TestDb): Promise<number> {
  return scalar<number>(
    t.db,
    `select (select count(*) from public.wishes w
              where not exists (select 1 from private.wish_placements p where p.wish_id = w.id and p.wishlist_id = w.wishlist_id))::int
          + (select count(*) from private.wish_placements p
               join public.wishes w on w.id = p.wish_id
               join public.wishlists h on h.id = w.wishlist_id
               join public.wishlists x on x.id = p.wishlist_id
              where x.owner_id <> h.owner_id or x.recipient_id <> h.recipient_id)::int`,
  )
}

/** INV-5: follows rows (any status) inside a blocked pair (must be 0). */
export function inv5Violations(t: TestDb): Promise<number> {
  return scalar<number>(
    t.db,
    `select count(*)::int from public.follows f
      where private.is_blocked_pair(f.follower_id, f.followee_id)`,
  )
}

/** Pilot rules: more than one active reservation per wish, or a reservation by the list's owner / recipient. */
export function pilotRuleViolations(t: TestDb): Promise<number> {
  return scalar<number>(
    t.db,
    `select (select count(*) from (select wish_id from public.reservations where status = 'active'
                                     group by wish_id having count(*) > 1) d)::int
          + (select count(*) from public.reservations r
               join public.wishes w on w.id = r.wish_id join public.wishlists wl on wl.id = w.wishlist_id
              where r.reserver_id in (wl.owner_id, wl.recipient_id))::int`,
  )
}

export interface CooldownRow {
  followee_id: string
  follower_id: string
  /** epoch milliseconds (exact comparisons) */
  until_ms: number
}

/** INV-6 snapshot of follow_cooldowns (superuser, no RLS). */
export async function cooldownRows(t: TestDb): Promise<CooldownRow[]> {
  const r = await rows<{ followee_id: string; follower_id: string; until_ms: string }>(
    t.db,
    `select followee_id, follower_id, (extract(epoch from until) * 1000)::bigint::text as until_ms
       from public.follow_cooldowns order by 1, 2`,
  )
  return r.map((x) => ({ followee_id: x.followee_id, follower_id: x.follower_id, until_ms: Number(x.until_ms) }))
}

/**
 * INV-6: every silence of `before` is still there with an `until` at least as late — unless it was removed the only
 * two allowed ways: the purge after `until` (expired rows, when `purged` is set) or the cascade of a deleted account.
 */
export async function expectCooldownsNotShorter(t: TestDb, before: readonly CooldownRow[], opts: { purged?: boolean } = {}): Promise<void> {
  const after = await cooldownRows(t)
  const now = Date.parse(await scalar<string>(t.db, `select now()::text`))
  const profiles = new Set((await rows<{ id: string }>(t.db, 'select id from public.profiles')).map((p) => p.id))
  for (const b of before) {
    const a = after.find((x) => x.followee_id === b.followee_id && x.follower_id === b.follower_id)
    if (a) {
      expect(a.until_ms, `INV-6: the silence ${b.followee_id} → ${b.follower_id} got shorter`).toBeGreaterThanOrEqual(b.until_ms)
      continue
    }
    const cascaded = !profiles.has(b.followee_id) || !profiles.has(b.follower_id)
    const purgedExpired = opts.purged === true && b.until_ms < now
    expect(cascaded || purgedExpired, `INV-6: the silence ${b.followee_id} → ${b.follower_id} disappeared`).toBe(true)
  }
}

/** INV-1, INV-5 and the pilot rules (all must be 0); INV-6 as well when a cooldown snapshot from before is given. */
export async function checkInvariants(t: TestDb, opts: { cooldownsBefore?: readonly CooldownRow[]; purged?: boolean } = {}): Promise<void> {
  expect(await inv1Violations(t), 'INV-1: an active reservation that is not live after a cleanup pass').toBe(0)
  expect(await placementViolations(t), 'INV-8/9: a place of another owner, or a home that is not a place').toBe(0)
  expect(await inv5Violations(t), 'INV-5: a follows row inside a blocked pair').toBe(0)
  expect(await pilotRuleViolations(t), 'pilot: one active reservation per wish, never by owner / recipient').toBe(0)
  if (opts.cooldownsBefore) await expectCooldownsNotShorter(t, opts.cooldownsBefore, { purged: opts.purged })
}

// ---------------------------------------------------------------------------
// INV-2: the owner's world as text
// ---------------------------------------------------------------------------

async function textOf(t: TestDb, uid: string, sql: string, params: readonly unknown[] = []): Promise<string> {
  try {
    return await t.asUser(uid, (tx) => scalar<string>(tx, sql, params))
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return `error:${e.code ?? '?'}:${e.message ?? String(err)}`
  }
}

/**
 * Everything `uid` can read: every SELECT-granted column of every API table (RLS applied) and every read RPC
 * as text (export without exported_at). occasionIds / listIds / profileIds add the per-object screens.
 */
export async function ownerSnapshot(
  t: TestDb,
  uid: string,
  opts: { occasionIds?: readonly string[]; listIds?: readonly string[]; profileIds?: readonly string[] } = {},
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const table of ALL_TABLES) {
    if (RPC_ONLY_TABLES.includes(table)) continue
    const columns = await rows<{ column_name: string }>(
      t.db,
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' and privilege_type = 'SELECT'
        order by column_name`,
      [table],
    )
    const projection = columns.map((c) => c.column_name).join(', ')
    out[`table:${table}`] = await textOf(
      t,
      uid,
      `select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)::text from (select to_jsonb(v) as j from (select ${projection} from public.${table}) v) x`,
    )
  }
  for (const fn of ['get_me', 'get_feed', 'get_lists_overview', 'get_people_screen', 'my_reservations']) {
    out[fn] = await textOf(t, uid, `select public.${fn}()::text`)
  }
  out['export'] = await textOf(t, uid, `select (public.export_my_data() - 'exported_at')::text`)
  for (const id of opts.occasionIds ?? []) out[`occasion:${id}`] = await textOf(t, uid, 'select public.get_occasion_screen($1)::text', [id])
  for (const id of opts.listIds ?? []) out[`list:${id}`] = await textOf(t, uid, 'select public.get_list_screen($1)::text', [id])
  for (const id of [uid, ...(opts.profileIds ?? [])]) out[`card:${id}`] = await textOf(t, uid, 'select public.get_profile_card($1)::text', [id])
  return out
}

// ---------------------------------------------------------------------------
// INV-3 / INV-3b: one side's view of a relation
// ---------------------------------------------------------------------------

export interface RelationSnapshotOptions {
  /** a follow link of `other`: peek + the answer of request_follow_via_link (idempotent for a live outgoing row) */
  token?: string
  /** also record the answer of request_follow(other) (idempotent for a live outgoing row) */
  askAgain?: boolean
  /** export keys to leave out (the deliberate exceptions of INV-3b) */
  omitExport?: (exported: Record<string, unknown>) => void
}

/** What `viewer` can learn about the relation with `other`: badge, overview, people screen, card, export, link answers. */
export async function relationSnapshot(t: TestDb, viewer: string, other: string, opts: RelationSnapshotOptions = {}): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  out['get_me'] = await textOf(t, viewer, 'select public.get_me()::text')
  out['overview'] = await textOf(t, viewer, 'select public.get_lists_overview()::text')
  out['people'] = await textOf(t, viewer, 'select public.get_people_screen()::text')
  out['card'] = await textOf(t, viewer, 'select public.get_profile_card($1)::text', [other])
  const exportText = await textOf(t, viewer, `select (public.export_my_data() - 'exported_at')::text`)
  if (opts.omitExport && !exportText.startsWith('error:')) {
    const parsed = JSON.parse(exportText) as Record<string, unknown>
    opts.omitExport(parsed)
    out['export'] = JSON.stringify(parsed)
  } else {
    out['export'] = exportText
  }
  if (opts.token !== undefined) {
    out['peek'] = await textOf(t, viewer, 'select public.peek_follow_link($1)::text', [opts.token])
    out['request_follow_via_link'] = await textOf(t, viewer, 'select public.request_follow_via_link($1)::text', [opts.token])
  }
  if (opts.askAgain) out['request_follow'] = await textOf(t, viewer, 'select public.request_follow($1)::text', [other])
  return out
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?/g

/**
 * Makes two people's snapshots comparable: their own id and name become placeholders, every timestamp becomes "T".
 * Used for INV-3 across two requesters (one silently refused, one not) who did exactly the same things.
 */
export function normalizeFor(snapshot: Record<string, string>, self: { id: string; name: string }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    out[key] = value
      .split(self.id)
      .join('<SELF>')
      .split(`"${self.name}"`)
      .join('"<SELF_NAME>"')
      .replace(TIMESTAMP_RE, 'T')
  }
  return out
}

// ---------------------------------------------------------------------------
// INV-4: the graph
// ---------------------------------------------------------------------------

/**
 * The profiles `uid` may meet in any answer: themself, everybody private.knows_profile() lets them see (shared active
 * occasion or a relation visible to them, never a blocked pair) and the people they blocked themselves (their own
 * block list on the people screen).
 */
export async function knownProfiles(t: TestDb, uid: string): Promise<Set<string>> {
  const r = await rows<{ id: string }>(
    t.db,
    `select p.id from public.profiles p
      where p.id = $1 or private.knows_profile($1, p.id)
         or exists (select 1 from public.blocks b where b.blocker_id = $1 and b.blocked_id = p.id)`,
    [uid],
  )
  return new Set(r.map((x) => x.id))
}

/** Every answer `uid` can get about people (screens, cards of everybody, export). */
export async function answersOf(t: TestDb, uid: string, extra: { occasionIds?: readonly string[]; tokens?: readonly string[] } = {}): Promise<string[]> {
  const everybody = (await rows<{ id: string }>(t.db, 'select id from public.profiles')).map((p) => p.id)
  const texts: string[] = []
  for (const fn of ['get_me', 'get_feed', 'get_lists_overview', 'get_people_screen', 'my_reservations']) {
    texts.push(await textOf(t, uid, `select public.${fn}()::text`))
  }
  texts.push(await textOf(t, uid, 'select public.export_my_data()::text'))
  for (const id of everybody) texts.push(await textOf(t, uid, 'select public.get_profile_card($1)::text', [id]))
  for (const id of extra.occasionIds ?? []) texts.push(await textOf(t, uid, 'select public.get_occasion_screen($1)::text', [id]))
  for (const token of extra.tokens ?? []) texts.push(await textOf(t, uid, 'select public.peek_follow_link($1)::text', [token]))
  return texts
}

/**
 * INV-4: every profile id that appears in `uid`'s answers belongs to a person `uid` may know — plus the owner of a
 * follow link `uid` holds (`tokens`): the owner shared it, and peek_follow_link shows their card on purpose (§4.3).
 */
export async function expectOnlyKnownProfiles(t: TestDb, uid: string, extra: { occasionIds?: readonly string[]; tokens?: readonly string[] } = {}): Promise<void> {
  const profiles = new Set((await rows<{ id: string }>(t.db, 'select id from public.profiles')).map((p) => p.id))
  const known = await knownProfiles(t, uid)
  for (const token of extra.tokens ?? []) {
    // never for a blocked pair (peek answers invite_invalid there) — so this rule cannot hide a leak to a blocked person
    const owners = await rows<{ owner_id: string }>(
      t.db,
      `select owner_id from public.follow_links where token_hash = sha256(convert_to($1::text, 'UTF8')) and not private.is_blocked_pair($2, owner_id)`,
      [token, uid],
    )
    for (const o of owners) known.add(o.owner_id)
  }
  for (const text of await answersOf(t, uid, extra)) {
    for (const id of text.match(UUID_RE) ?? []) {
      const lower = id.toLowerCase()
      if (!profiles.has(lower)) continue // occasion / list / wish ids
      expect(known.has(lower), `INV-4: ${uid} received the id of ${lower} without a relation: ${text.slice(0, 300)}`).toBe(true)
    }
  }
}
