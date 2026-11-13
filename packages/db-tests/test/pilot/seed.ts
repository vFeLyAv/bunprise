/**
 * Shared fixture + helpers for the pilot migration tests (not a test file itself).
 *
 * seedPilot(): host A (Anna), members B (Ben) and C (Cem) joined through accept_invite,
 * outsider D (Dana: consents + name, but not a member). One occasion with its auto-created
 * wishlist and three wishes with different priorities (w1 = 3 Unbedingt, w2 = 1 Kann, w3 = 2 Gern).
 * All names are invented. Every call creates fresh users (unique e-mails), so a test file can
 * seed as often as it needs inside one PGlite instance.
 */
import { expect } from 'vitest'
import { expectDbError, rows, scalar, type DbError, type Querier, type TestDb } from '../../src/harness'

export const NAMES = { a: 'Anna', b: 'Ben', c: 'Cem', d: 'Dana' } as const
export const OCCASION_TITLE = 'Geburtstag Anna'
export const WISH_TITLES = { w1: 'Kopfhörer', w2: 'Buch', w3: 'Socken' } as const

export interface Seed {
  a: string
  b: string
  c: string
  d: string
  occasionId: string
  wishlistId: string
  /** priority 3 */
  w1: string
  /** priority 1 */
  w2: string
  /** priority 2 (default) */
  w3: string
  token: string
}

let seq = 0

/** Creates an auth.users row (→ profile via trigger) and gives it the three current consents. */
export async function createMember(t: TestDb, name: string, opts: { consents?: boolean } = {}): Promise<string> {
  const id = await t.createUser(`${name.toLowerCase()}-${++seq}@example.test`, { name })
  if (opts.consents !== false) await giveConsents(t, id)
  return id
}

/** Inserts the three consent rows the way the app does: as the user, through the RLS policy. */
export function giveConsents(t: TestDb, uid: string): Promise<unknown> {
  return t.asUser(uid, (tx) =>
    tx.query(
      `insert into consents (profile_id, kind, version, locale)
       select $1, lv.kind, lv.version, 'de' from legal_versions lv`,
      [uid],
    ),
  )
}

/** Calls public.<fn>(args...) as the user and returns the (jsonb-parsed) result. */
export function rpc<T = unknown>(t: TestDb, uid: string, fn: string, args: readonly unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
  return t.asUser(uid, (tx) => scalar<T>(tx, `select public.${fn}(${placeholders}) as v`, args))
}

/** Expects a RAISE EXCEPTION from an RPC: SQLSTATE P0001 with exactly this code as message. */
export async function expectRpcError(promise: Promise<unknown>, code: string): Promise<DbError> {
  const err = await expectDbError(promise, 'P0001')
  expect(err.message).toBe(code)
  return err
}

/** Runs one statement as the user and returns the number of affected rows (0 = RLS filtered everything, no error). */
export function execAs(t: TestDb, uid: string, sql: string, params: readonly unknown[] = []): Promise<number> {
  return t.asUser(uid, async (tx) => (await tx.query(sql, [...params])).affectedRows ?? 0)
}

/** `count(*)` as the given user (RLS applied). */
export function countAs(t: TestDb, uid: string, table: string, where = 'true', params: readonly unknown[] = []): Promise<number> {
  return t.asUser(uid, (tx) => scalar<number>(tx, `select count(*)::int from ${table} where ${where}`, params))
}

/** `count(*)` as the superuser (no RLS). */
export function countAll(t: TestDb, table: string, where = 'true', params: readonly unknown[] = []): Promise<number> {
  return t.asService((tx) => scalar<number>(tx, `select count(*)::int from ${table} where ${where}`, params))
}

export async function seedPilot(t: TestDb, opts: { startsInDays?: number } = {}): Promise<Seed> {
  const days = opts.startsInDays ?? 30
  const a = await createMember(t, NAMES.a)
  const b = await createMember(t, NAMES.b)
  const c = await createMember(t, NAMES.c)
  const d = await createMember(t, NAMES.d)

  // The host creates the occasion through REST (policy path); the trigger adds membership + wishlist.
  const occasionId = await t.asUser(a, (tx) =>
    scalar<string>(
      tx,
      `insert into occasions (host_id, title, starts_at, tz, place_text)
       values ($1, $2, now() + make_interval(days => $3::int), 'Europe/Berlin', 'Bei Anna')
       returning id`,
      [a, OCCASION_TITLE, days],
    ),
  )
  const wishlistId = await t.asUser(a, (tx) => scalar<string>(tx, 'select id from wishlists where occasion_id = $1', [occasionId]))

  // Explicit created_at offsets so the secondary ordering (created_at asc) is deterministic.
  // (created_at is not insertable through REST since 20261027200000: the host inserts, the seed back-dates it as the
  // superuser — the home place's added_at too)
  const addWish = async (title: string, priority: number | null, minutesAgo: number, extra = '') => {
    const id = await t.asUser(a, (tx) =>
      scalar<string>(
        tx,
        priority === null
          ? `insert into wishes (wishlist_id, title) values ($1, $2) returning id`
          : `insert into wishes (wishlist_id, title, priority, price_cents, url)
             values ($1, $2, ${priority} ${extra}) returning id`,
        [wishlistId, title],
      ),
    )
    await t.db.query(`update public.wishes set created_at = now() - make_interval(mins => $2::int) where id = $1`, [id, minutesAgo])
    // (a database built from an older subset of the migrations has no places yet: pilot-regression)
    if (await scalar<boolean>(t.db, `select to_regclass('private.wish_placements') is not null`)) {
      await t.db.query(`update private.wish_placements p set added_at = w.created_at from public.wishes w
                         where w.id = $1 and p.wish_id = w.id and p.wishlist_id = w.wishlist_id`, [id])
    }
    return id
  }
  const w1 = await addWish(WISH_TITLES.w1, 3, 3, `, 4990, 'https://example.com/kopfhoerer'`)
  const w2 = await addWish(WISH_TITLES.w2, 1, 2, `, 1999, null`)
  const w3 = await addWish(WISH_TITLES.w3, null, 1)

  const { token } = await rpc<{ token: string }>(t, a, 'create_invite', [occasionId])
  await rpc(t, b, 'accept_invite', [token])
  await rpc(t, c, 'accept_invite', [token])

  return { a, b, c, d, occasionId, wishlistId, w1, w2, w3, token }
}

/** The full occasion screen as the user. */
export function screen(t: TestDb, uid: string, occasionId: string): Promise<OccasionScreen> {
  return rpc<OccasionScreen>(t, uid, 'get_occasion_screen', [occasionId])
}

/** The occasion screen as raw text (for byte-identity checks). */
export function screenText(t: TestDb, uid: string, occasionId: string): Promise<string> {
  return t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [occasionId]))
}

export interface ScreenWish {
  id: string
  title: string
  url: string | null
  price_cents: number | null
  currency: string
  note: string | null
  priority: number
  created_at: string
  reserved: boolean | null
  reserved_by_me: boolean | null
}

export interface OccasionScreen {
  occasion: {
    id: string
    title: string
    starts_at: string
    tz: string
    all_day: boolean
    place_text: string | null
    description: string | null
    created_at: string
    host: { id: string; display_name: string | null }
    /** the cover's meta (20261020160000), null without one */
    photo?: { width: number; height: number; updated_at: string } | null
  }
  viewer: { role: 'host' | 'member'; rsvp: string }
  members: { profile_id: string; display_name: string | null; role: string; rsvp: string }[]
  invite: { active: boolean; expires_at: string } | null
  wishlist: { id: string; owner_id: string; title: string | null; wishes: ScreenWish[] } | null
}

export interface FeedOccasion {
  id: string
  title: string
  starts_at: string
  tz: string
  all_day: boolean
  place_text: string | null
  role: 'host' | 'member'
  rsvp: string
  host_name: string | null
  member_count: number
  wish_count: number
  my_reservation_count: number | null
  /** 20261025130000: the cover's meta, null without one (the bytes: get_occasion_photo) */
  photo?: { width: number; height: number; updated_at: string } | null
}

export interface Feed {
  upcoming: FeedOccasion[]
  past: FeedOccasion[]
}

export interface MyReservation {
  wish_id: string | null
  wish_title: string
  occasion_id: string | null
  occasion_title: string | null
  starts_at: string | null
  status: 'active' | 'ended'
  end_reason: string | null
  created_at: string
}

export const ALL_TABLES = [
  'profiles',
  'legal_versions',
  'consents',
  'occasions',
  'occasion_addresses',
  'invites',
  'occasion_members',
  'wishlists',
  'wishes',
  'reservations',
  'blocks',
  'reports',
  // cover photos (20261020160000): like reservations, no grant for any API role — RPC only
  'occasion_photos',
  // wish photos (20261022120000): the same pattern — RPC only
  'wish_photos',
  // list covers (20261022160000): the same pattern — RPC only
  'list_photos',
  // profile + banner photos (20261024120000): the same pattern — RPC only
  'profile_photos',
  // follows (20261020200100, wave 2b M2): RPC only, no grant of any kind and no policy
  'follows',
  'follow_cooldowns',
  'follow_links',
  // the bring-along list "Mitbringen" (20261025150000): RPC only, no grant and no policy
  'potluck_items',
  // in-app invitations (20261027120000): RPC only, no grant and no policy
  'occasion_invitations',
  'invitation_attempts',
  'occasion_invite_refusals',
  'invitation_cooldowns',
  'member_invited_by',
  // Web Push (20261027150000): devices and preferences, RPC only, no grant and no policy
  'push_subscriptions',
  'push_preferences',
  // friend codes (20261027160000): RPC only, no grant and no policy
  'friend_codes',
  'friend_code_misses',
  // Kalender-Abo (20261027170000): RPC only, no grant and no policy
  'calendar_feeds',
  // invitation e-mail (20261028000000): the opt-in and the unsubscribe token hashes, RPC only, no grant and no policy
  'invite_email_prefs',
  'invite_email_tokens',
] as const

/** Tables without ANY privilege for anon / authenticated: reachable through security definer RPCs only. */
export const RPC_ONLY_TABLES: readonly (typeof ALL_TABLES)[number][] = [
  'reservations',
  'occasion_photos',
  'wish_photos',
  'list_photos',
  'profile_photos',
  'follows',
  'follow_cooldowns',
  'follow_links',
  'potluck_items',
  'occasion_invitations',
  'invitation_attempts',
  'occasion_invite_refusals',
  'invitation_cooldowns',
  'member_invited_by',
  'push_subscriptions',
  'push_preferences',
  'friend_codes',
  'friend_code_misses',
  'calendar_feeds',
  // invitation e-mail (20261028000000): the opt-in and the unsubscribe token hashes, RPC only, no grant and no policy
  'invite_email_prefs',
  'invite_email_tokens',
]

/** Helper to run several statements as one user in one transaction and return rows of the last query. */
export async function queryAs<T extends Record<string, unknown> = Record<string, unknown>>(
  t: TestDb,
  uid: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  return t.asUser(uid, (tx: Querier) => rows<T>(tx, sql, params))
}
