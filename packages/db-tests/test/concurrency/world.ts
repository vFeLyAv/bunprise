/**
 * One fresh "world" per run (not a test file). Every call creates new users (unique e-mails), so a test file
 * can seed as often as it needs inside its one cluster:
 *   host Anna: one occasion, its auto-created wishlist, wishes w1 (priority 3) and w2 (priority 1), one live link;
 *   members Ben (b) and Cem (c) joined through that link (use_count 2 of 50);
 *   outsiders Dana (d) and Emil (e): consents + name, not members.
 * extraMembers / extraOutsiders add people for the N-way races. All names are invented.
 */
import type { RealPg } from '../../src/realpg'

export const OCCASION_TITLE = 'Geburtstag Anna'
export const W1_TITLE = 'Kopfhörer'
export const W2_TITLE = 'Buch'

export interface World {
  host: string
  b: string
  c: string
  d: string
  e: string
  /** b, c, then the extra members */
  members: string[]
  /** d, e, then the extra outsiders */
  outsiders: string[]
  occasionId: string
  wishlistId: string
  w1: string
  w2: string
  /** the live invite link (64 hex) and its row */
  token: string
  inviteId: string
}

let run = 0

export async function seedWorld(db: RealPg, opts: { extraMembers?: number; extraOutsiders?: number } = {}): Promise<World> {
  const n = ++run
  const person = (name: string) => db.createUser(`${name.toLowerCase()}-${n}@example.test`, { name })
  const host = await person('Anna')
  const members = [await person('Ben'), await person('Cem')]
  for (let i = 1; i <= (opts.extraMembers ?? 0); i++) members.push(await person(`Mia${i}`))
  const outsiders = [await person('Dana'), await person('Emil')]
  for (let i = 1; i <= (opts.extraOutsiders ?? 0); i++) outsiders.push(await person(`Ola${i}`))
  const [b, c] = members as [string, string]
  const [d, e] = outsiders as [string, string]

  // The current legal records for everybody (the app inserts them as the user; for the races the path does
  // not matter, only that consents_ok holds).
  await db.admin.query(
    `insert into public.consents (profile_id, kind, version, locale)
     select u.id, lv.kind, lv.version, 'de' from unnest($1::uuid[]) as u(id) cross join public.legal_versions lv`,
    [[host, ...members, ...outsiders]],
  )

  // The host creates the occasion through RLS (the trigger adds the membership and THE wishlist) and the wishes.
  const occasionId = await db.asUser(host, (s) =>
    s.value<string>(
      `insert into public.occasions (host_id, title, starts_at, tz, place_text)
       values ($1, $2, now() + interval '30 days', 'Europe/Berlin', 'Bei Anna') returning id`,
      [host, OCCASION_TITLE],
    ),
  )
  const wishlistId = await db.admin.value<string>('select id from public.wishlists where occasion_id = $1', [occasionId])
  const [w1, w2] = await db.asUser(host, async (s): Promise<[string, string]> => [
    await s.value<string>(`insert into public.wishes (wishlist_id, title, priority) values ($1, $2, 3) returning id`, [wishlistId, W1_TITLE]),
    await s.value<string>(`insert into public.wishes (wishlist_id, title, priority) values ($1, $2, 1) returning id`, [wishlistId, W2_TITLE]),
  ])
  // created_at is not insertable through REST (20261027200000): back-date as the superuser (home place too)
  await backdate(db, [w1, w2], [2, 1])

  const { token } = await db.asUser(host, (s) => s.rpc<{ token: string }>('create_invite', [occasionId]))
  for (const member of members) await db.asUser(member, (s) => s.rpc('accept_invite', [token]))
  const inviteId = await db.admin.value<string>('select id from public.invites where occasion_id = $1 and revoked_at is null', [
    occasionId,
  ])

  return { host, b, c, d, e, members, outsiders, occasionId, wishlistId, w1, w2, token, inviteId }
}

// ---------------------------------------------------------------------------
// Final-state readers (superuser, no RLS) and contract checks (as the user, through the RPCs)
// ---------------------------------------------------------------------------

export type ReservationRow = {
  wish_id: string | null
  status: string
  end_reason: string | null
}

/** Membership status of uid in the world's occasion, null when there is no row. */
export async function memberStatus(db: RealPg, w: World, uid: string): Promise<string | null> {
  const rows = await db.admin.rows<{ status: string }>(
    'select status from public.occasion_members where occasion_id = $1 and profile_id = $2',
    [w.occasionId, uid],
  )
  return rows[0]?.status ?? null
}

/** Seed helper (superuser): back-dates wishes by minutes (created_at is not insertable through REST since 20261027200000). */
export async function backdate(db: RealPg, wishIds: readonly string[], minutesAgo: readonly number[]): Promise<void> {
  await db.admin.query(
    `update public.wishes w set created_at = now() - make_interval(mins => x.m)
       from unnest($1::uuid[], $2::int[]) as x(id, m) where w.id = x.id`,
    [wishIds, minutesAgo],
  )
  await db.admin.query(
    `update private.wish_placements p set added_at = w.created_at from public.wishes w
      where w.id = any($1::uuid[]) and p.wish_id = w.id and p.wishlist_id = w.wishlist_id`,
    [wishIds],
  )
}

/**
 * Since 20261027200000 (shared wishes, LAZY liveness) no owner action touches reservations: a reservation that lost
 * its access is dead at once and the cleanup job (pg_cron, every minute) ends it — 'access_ended', or 'wish_deleted'
 * with wish_id null when the wish is gone — and erases rows whose giver or recipient account is gone. The state
 * helpers below read the table AFTER a full cleanup pass, i.e. "a minute later" (one admin transaction per run,
 * exactly the cron command).
 */
export async function cleanupPass(db: RealPg): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const out = await db.admin.value<{ stale: { pass_complete: boolean }; orphans: { pass_complete: boolean } }>(
      'select private.reservations_cleanup_run()',
    )
    if (out.stale.pass_complete && out.orphans.pass_complete) return
  }
  throw new Error('cleanup pass did not complete')
}

/** Every reservation row the user made (any status), oldest first — after a cleanup pass. */
export async function reservationsBy(db: RealPg, uid: string): Promise<ReservationRow[]> {
  await cleanupPass(db)
  return db.admin.rows<ReservationRow>(
    'select wish_id, status, end_reason from public.reservations where reserver_id = $1 order by created_at, id',
    [uid],
  )
}

/** Reservers holding an ACTIVE reservation on the wish (the unique index allows at most one) — after a cleanup pass. */
export async function activeReserversOf(db: RealPg, wishId: string): Promise<string[]> {
  await cleanupPass(db)
  const rows = await db.admin.rows<{ reserver_id: string }>(
    `select reserver_id from public.reservations where wish_id = $1 and status = 'active' order by created_at`,
    [wishId],
  )
  return rows.map((r) => r.reserver_id)
}

/** Reservation rows on the wish in any status — after a cleanup pass. */
export async function reservationCountOn(db: RealPg, wishId: string): Promise<number> {
  await cleanupPass(db)
  return db.admin.value<number>('select count(*)::int from public.reservations where wish_id = $1', [wishId])
}

/** Non-revoked invite links of the world's occasion. */
export function liveLinks(db: RealPg, w: World): Promise<number> {
  return db.admin.value<number>('select count(*)::int from public.invites where occasion_id = $1 and revoked_at is null', [w.occasionId])
}

/** The seeded link's counters. */
export async function link(db: RealPg, w: World): Promise<{ use_count: number; max_uses: number; revoked: boolean }> {
  const rows = await db.admin.rows<{ use_count: number; max_uses: number; revoked: boolean }>(
    'select use_count, max_uses, revoked_at is not null as revoked from public.invites where id = $1',
    [w.inviteId],
  )
  const row = rows[0]
  if (!row) throw new Error('link(): the seeded invite row is gone')
  return row
}

/** Is this token's link the live (non-revoked) one? */
export function isLiveToken(db: RealPg, w: World, token: string): Promise<boolean> {
  return db.admin.value<boolean>(
    `select exists (select 1 from public.invites
                    where occasion_id = $1 and revoked_at is null and token_hash = sha256(convert_to($2, 'UTF8')))`,
    [w.occasionId, token],
  )
}

/** Is anything of the account left (auth.users row or profile)? false = completely gone. */
export function accountExists(db: RealPg, uid: string): Promise<boolean> {
  return db.admin.value<boolean>(
    'select exists (select 1 from auth.users where id = $1) or exists (select 1 from public.profiles where id = $1)',
    [uid],
  )
}

export function occasionExists(db: RealPg, w: World): Promise<boolean> {
  return db.admin.value<boolean>('select exists (select 1 from public.occasions where id = $1)', [w.occasionId])
}

export function isBlocked(db: RealPg, blocker: string, blocked: string): Promise<boolean> {
  return db.admin.value<boolean>('select exists (select 1 from public.blocks where blocker_id = $1 and blocked_id = $2)', [blocker, blocked])
}

/** Calls an RPC as the user in its own transaction and returns the result (throws on a database error). */
export function rpcAs<T = unknown>(db: RealPg, uid: string, fn: string, args: readonly unknown[] = []): Promise<T> {
  return db.asUser(uid, (s) => s.rpc<T>(fn, args))
}

export interface MyReservation {
  wish_id: string | null
  wish_title: string
  occasion_id: string | null
  occasion_title: string | null
  status: string
  end_reason: string | null
}

// ---------------------------------------------------------------------------
// The follow world (wave 2b, docs/spec/follows-design.md §7.1 / §7.3): seedFollowWorld(), its readers and the
// invariants INV-1, INV-5, INV-6 of §6.2 on the real server (the PGlite twins: test/follows/invariants.ts).
// ---------------------------------------------------------------------------

export const L1_TITLE = 'Meine Wünsche'
export const FOLLOW_O1_TITLE = 'Paulas Gartenfest'
/** L1's wishes: "Wunsch 1" … "Wunsch 7", oldest first, priorities 3 2 1 3 2 1 3 */
export const L1_WISH_COUNT = 7

export interface FollowWorld {
  /** the owner (= recipient) of L1, host of O1, owner of the follow link */
  paula: string
  /** accepted followers of Paula (through the link) */
  finn: string
  greta: string
  /** a pending request to Paula through the link (no shared occasion) */
  rosa: string
  /** an active guest of O1, no follow relation (the shared occasion of request_follow) */
  moritz: string
  /** outsiders: consents + name, nothing else (new people at the link) */
  xaver: string
  ida: string
  /** xaver, ida, then the extra outsiders (N-way races) */
  outsiders: string[]
  /** Paula's list without an occasion "Meine Wünsche", visibility 'followers' */
  l1: string
  /** L1's 7 wishes, oldest first */
  wishes: string[]
  /** Paula's occasion with Moritz as a guest */
  o1: string
  /** Paula's live follow link (64 hex) and its row; Finn, Greta and Rosa came through it (use_count 3) */
  token: string
  linkId: string
}

let followRun = 0

/**
 * One fresh follow world per call (new users, unique e-mails), built through the same REST writes and RPCs as the
 * app: L1 is inserted with visibility 'followers' (the owner's explicit choice), the follows come from the link.
 */
export async function seedFollowWorld(db: RealPg, opts: { extraOutsiders?: number } = {}): Promise<FollowWorld> {
  const n = ++followRun
  const person = (name: string) => db.createUser(`${name.toLowerCase()}-f${n}@example.test`, { name })
  const paula = await person('Paula')
  const finn = await person('Finn')
  const greta = await person('Greta')
  const rosa = await person('Rosa')
  const moritz = await person('Moritz')
  const xaver = await person('Xaver')
  const ida = await person('Ida')
  const outsiders = [xaver, ida]
  for (let i = 1; i <= (opts.extraOutsiders ?? 0); i++) outsiders.push(await person(`Ola${i}`))
  await db.admin.query(
    `insert into public.consents (profile_id, kind, version, locale)
     select u.id, lv.kind, lv.version, 'de' from unnest($1::uuid[]) as u(id) cross join public.legal_versions lv`,
    [[paula, finn, greta, rosa, moritz, ...outsiders]],
  )

  const { l1, wishes } = await db.asUser(paula, async (s) => {
    const list = await s.value<string>(
      `insert into public.wishlists (owner_id, recipient_id, title, visibility, cover_tone, cover_icon)
       values ($1, $1, $2, 'followers', 2, 'star') returning id`,
      [paula, L1_TITLE],
    )
    const rows = await s.rows<{ id: string; i: number }>(
      `insert into public.wishes (wishlist_id, title, priority)
       select $1, 'Wunsch ' || i, (array[3, 2, 1, 3, 2, 1, 3])[i]
         from generate_series(1, $2::int) as g(i)
       returning id, (substring(title from 8))::int as i`,
      [list, L1_WISH_COUNT],
    )
    return { l1: list, wishes: [...rows].sort((a, b) => a.i - b.i).map((r) => r.id) }
  })
  await backdate(db, wishes, wishes.map((_, index) => 30 - (index + 1)))

  const o1 = await db.asUser(paula, (s) =>
    s.value<string>(
      `insert into public.occasions (host_id, title, starts_at, tz, place_text)
       values ($1, $2, now() + interval '20 days', 'Europe/Berlin', 'Bei Paula') returning id`,
      [paula, FOLLOW_O1_TITLE],
    ),
  )
  const { token: invite } = await db.asUser(paula, (s) => s.rpc<{ token: string }>('create_invite', [o1]))
  await db.asUser(moritz, (s) => s.rpc('accept_invite', [invite]))

  const { token } = await db.asUser(paula, (s) => s.rpc<{ token: string }>('create_follow_link'))
  for (const who of [finn, greta, rosa]) await db.asUser(who, (s) => s.rpc('request_follow_via_link', [token]))
  for (const who of [finn, greta]) await db.asUser(paula, (s) => s.rpc('respond_follow', [who, true]))
  const linkId = await db.admin.value<string>(`select id from public.follow_links where token_hash = sha256(convert_to($1, 'UTF8'))`, [token])

  return { paula, finn, greta, rosa, moritz, xaver, ida, outsiders, l1, wishes, o1, token, linkId }
}

/** status of the follows row follower → followee ('pending' | 'accepted'), null without a row */
export async function followStatus(db: RealPg, follower: string, followee: string): Promise<string | null> {
  const rows = await db.admin.rows<{ status: string }>('select status from public.follows where follower_id = $1 and followee_id = $2', [
    follower,
    followee,
  ])
  return rows[0]?.status ?? null
}

/** follows rows between a and b in either direction, any status */
export function followRowsBetween(db: RealPg, a: string, b: string): Promise<number> {
  return db.admin.value<number>(
    `select count(*)::int from public.follows
      where (follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)`,
    [a, b],
  )
}

/** Does `followee` hide the requests of `follower` (a follow_cooldowns row, whatever its until)? */
export function hasCooldown(db: RealPg, followee: string, follower: string): Promise<boolean> {
  return db.admin.value<boolean>('select exists (select 1 from public.follow_cooldowns where followee_id = $1 and follower_id = $2)', [
    followee,
    follower,
  ])
}

/** LIVE reservations of `giver` for `recipient` that the cap of 5 counts (S19; 20261027200000: private.counts_for_cap) */
export function activeStandaloneReservations(db: RealPg, giver: string, recipient: string): Promise<number> {
  return db.admin.value<number>(
    `select count(*)::int from public.reservations r
      where r.reserver_id = $1 and r.recipient_id = $2 and r.status = 'active'
        and private.counts_for_cap(r.wish_id, r.reserver_id, r.recipient_id)`,
    [giver, recipient],
  )
}

export function visibilityOf(db: RealPg, listId: string): Promise<string | null> {
  return db.admin.value<string | null>('select (select visibility from public.wishlists where id = $1)', [listId])
}

/** the seeded follow link's counters */
export async function followLink(db: RealPg, w: FollowWorld): Promise<{ use_count: number; revoked: boolean }> {
  const rows = await db.admin.rows<{ use_count: number; revoked: boolean }>(
    'select use_count, revoked_at is not null as revoked from public.follow_links where id = $1',
    [w.linkId],
  )
  const row = rows[0]
  if (!row) throw new Error('followLink(): the seeded follow link row is gone')
  return row
}

/** live (not revoked, not expired) follow links of the owner */
export function liveFollowLinks(db: RealPg, owner: string): Promise<number> {
  return db.admin.value<number>(
    'select count(*)::int from public.follow_links where owner_id = $1 and revoked_at is null and expires_at > now()',
    [owner],
  )
}

export function isLiveFollowToken(db: RealPg, token: string): Promise<boolean> {
  return db.admin.value<boolean>(
    `select exists (select 1 from public.follow_links
                    where token_hash = sha256(convert_to($1, 'UTF8')) and revoked_at is null and expires_at > now())`,
    [token],
  )
}

/**
 * INV-1 (20261027200000, lazy liveness): after a full cleanup pass no ACTIVE reservation is dead (its wish gone, its
 * recipient changed, or its giver unable to read the wish through any effective place) — must be 0. Plus INV-8/9.
 */
export async function inv1Violations(db: RealPg): Promise<number> {
  await cleanupPass(db)
  return db.admin.value<number>(
    `select (select count(*) from public.reservations r
              where r.status = 'active' and not private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id))::int
          + (select count(*) from public.wishes w
              where not exists (select 1 from private.wish_placements p where p.wish_id = w.id and p.wishlist_id = w.wishlist_id))::int
          + (select count(*) from private.wish_placements p join public.wishes w on w.id = p.wish_id
               join public.wishlists h on h.id = w.wishlist_id join public.wishlists x on x.id = p.wishlist_id
              where x.owner_id <> h.owner_id)::int`,
  )
}

/** INV-5: follows rows (accepted or pending) inside a blocked pair — must be 0. */
export function inv5Violations(db: RealPg): Promise<number> {
  return db.admin.value<number>('select count(*)::int from public.follows f where private.is_blocked_pair(f.follower_id, f.followee_id)')
}

/** The pilot rules: more than one active reservation per wish, or one by the list's owner / recipient — must be 0. */
export function pilotRuleViolations(db: RealPg): Promise<number> {
  return db.admin.value<number>(
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
  /** `until` as fixed-width UTC text with microseconds */
  until: string
}

/** INV-6 snapshot: every follow_cooldowns row (superuser). */
export function cooldownRows(db: RealPg): Promise<CooldownRow[]> {
  return db.admin.rows<CooldownRow>(
    `select followee_id, follower_id, to_char(until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as until
       from public.follow_cooldowns order by 1, 2`,
  )
}

/**
 * INV-6: no silence got shorter or vanished — unless one of its two profiles is gone (the account cascade; the
 * daily purge never runs here). `until` text is fixed-width UTC, so comparing the strings compares the instants.
 */
export async function cooldownsShortened(db: RealPg, before: readonly CooldownRow[]): Promise<string[]> {
  const after = new Map((await cooldownRows(db)).map((r) => [`${r.followee_id}>${r.follower_id}`, r.until]))
  const problems: string[] = []
  for (const b of before) {
    const until = after.get(`${b.followee_id}>${b.follower_id}`)
    if (until !== undefined) {
      if (until < b.until) problems.push(`${b.followee_id} → ${b.follower_id}: until ${b.until} became ${until}`)
      continue
    }
    const cascaded = !(await accountExists(db, b.followee_id)) || !(await accountExists(db, b.follower_id))
    if (!cascaded) problems.push(`${b.followee_id} → ${b.follower_id}: the silence disappeared`)
  }
  return problems
}
