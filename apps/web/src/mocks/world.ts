import type {
  FeedOccasion,
  FeedScreen,
  ListPhotoMeta,
  MemberRole,
  MemberStatus,
  MyReservation,
  OccasionPhotoMeta,
  OccasionScreen,
  OccasionScreenWish,
  OccasionSections,
  PotluckItem,
  PotluckScreen,
  ProfilePhotoMeta,
  ReservationEndReason,
  ReservationStatus,
  Rsvp,
  WishDetails,
  WishPhotoMeta,
  WishPriority,
} from '../lib/api/types'
import {
  checkViolation,
  invalidDatetime,
  invalidInput,
  notNullViolation,
  notSingle,
  permissionDenied,
  policyViolation,
  raise,
  uniqueViolation,
  unknownColumn,
  type TableAccess,
} from './rest'
import { endOfLocalDay, isValidTimeZone, localDayAt } from './time'
import { createFollowGraph } from './followGraph'
import { THEME_IDS } from '../features/occasions/covers/themes'

// The social world of the demo server: an in-memory copy of the pilot tables that re-implements
// the rules of supabase/migrations (v1.1 wins): RLS policies, column grants, triggers and RPCs.
// Every function is synchronous. A handler first awaits its request body and then calls exactly
// one function here, so checks and writes of two requests never interleave (the demo's
// equivalent of the row locks and the partial unique index of reserve_wish).
// Wave 2b (docs/spec/follows-design.md v1.2, M1–M3): lists without an occasion (visibility 'private' |
// 'followers', cover, date), the profile banner and the follow graph (mocks/followGraph.ts — blocks live
// there too, so private.is_blocked_pair() answers from it). The list RPCs of the tab and the list screen are
// in mocks/lists.ts, built on `internals` below. INV-1: every way of losing access to a list ends the
// reservations on it in the same step.

const DAY = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/
const RSVPS: readonly string[] = ['none', 'going', 'maybe', 'declined'] satisfies readonly Rsvp[]

export interface DemoPerson {
  readonly id: string
  /** profiles.display_name right now (null until the person chose one) */
  displayName(): string | null
  /** private.has_consents(): the current terms / privacy-notice / 18+ records exist */
  hasConsents(): boolean
}

export interface OccasionRow {
  id: string
  host_id: string
  title: string
  starts_at: string
  ends_at: string | null
  tz: string
  all_day: boolean
  place_text: string | null
  description: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  /** 20261025150000: what the occasion offers (the bring-along list "Mitbringen") */
  sections: OccasionSections
  /** 20261027120000: "Gäste dürfen Freunde einladen" (mocks/invitations.ts); a seed may leave it out (= false) */
  guests_can_invite?: boolean
  /** 20261027140000: the cover motif (a THEME_IDS key | 'none' | null); a seed may leave it out (= null) */
  cover_theme?: string | null
  /** 20261027190000: where the place is (5 decimals, both or neither); a seed may leave them out (= null) */
  place_lat?: number | null
  place_lon?: number | null
}

/** 20261025150000 potluck_items: the bring-along list — RPC only, no REST at all */
export interface PotluckRow {
  id: string
  occasion_id: string
  title: string
  created_by: string
  claimed_by: string | null
  created_at: string
}

export interface MemberRow {
  occasion_id: string
  profile_id: string
  role: MemberRole
  rsvp: Rsvp
  status: MemberStatus
  invited_via: string | null
  joined_at: string
  updated_at: string
}

/** M1/M3: who sees a list — 'occasion' exactly when it belongs to an occasion (wishlists_kind_check). */
export type WishlistVisibility = 'occasion' | 'private' | 'followers'

export interface WishlistRow {
  id: string
  /** null = a list without an occasion (M1, owner = recipient) */
  occasion_id: string | null
  owner_id: string
  recipient_id: string
  title: string | null
  created_at: string
  updated_at: string
  visibility: WishlistVisibility
  /** 1…4 = the kit's tile tones; null = derived from the id */
  cover_tone: number | null
  /** one of the fixed symbols (wishlists_cover_icon_check); null = 'gift' */
  cover_icon: string | null
  /** optional date of a list without an occasion (YYYY-MM-DD) */
  due_on: string | null
}

/** A seeded list may leave out the wave-2 columns: an occasion list gets 'occasion', a standalone one 'private'. */
export type SeedWishlistRow = Omit<WishlistRow, 'visibility' | 'cover_tone' | 'cover_icon' | 'due_on'>
  & Partial<Pick<WishlistRow, 'visibility' | 'cover_tone' | 'cover_icon' | 'due_on'>>

/** A person's own photos as one answer shows them (20261024120000): the meta or null. */
export interface ProfilePhotoFields {
  photo: ProfilePhotoMeta | null
  banner_photo: ProfilePhotoMeta | null
}
export const NO_PROFILE_PHOTOS: ProfilePhotoFields = { photo: null, banner_photo: null }
/** src/mocks/profilePhotos.ts: what a viewer may see of a person's photos, and a person's own. */
export interface ProfilePhotoSource {
  fieldsFor(viewer: string, profileId: string): ProfilePhotoFields
  ownFields(profileId: string): ProfilePhotoFields
}

/** profiles.banner (M1) and profiles.in_suggestions (M3) — writable by the person, never readable through REST. */
export interface ProfileSettings {
  banner: string | null
  in_suggestions: boolean
}

export interface WishRow {
  id: string
  wishlist_id: string
  title: string
  price_cents: number | null
  currency: string
  url: string | null
  note: string | null
  priority: WishPriority
  created_at: string
  updated_at: string
  // the details (20261022120000_wish_details.sql): optional on a seed, always set (null) once in the world
  description?: string | null
  brand?: string | null
  color?: string | null
  gtin?: string | null
  shop_name?: string | null
  /** 20261022160000: "Erhalten" — set only by set_wish_received (no REST UPDATE grant); null = open */
  received_at?: string | null
  /** 20261030120000 "Anzahl": 1..10, default 1 (a seed may leave it out) */
  quantity?: number
}

/** The detail columns of wishes (and received_at), all null (a seed row or an insert without them). */
const NO_WISH_DETAILS = { description: null, brand: null, color: null, gtin: null, shop_name: null, received_at: null } as const

/** The readable invite columns; the token itself never sits on a row (see inviteIdByToken). */
export interface InviteRow {
  id: string
  occasion_id: string
  created_by: string
  expires_at: string
  max_uses: number
  use_count: number
  revoked_at: string | null
  created_at: string
}

export interface ReservationRow {
  id: string
  wish_id: string | null
  wishlist_id: string | null
  recipient_id: string
  reserver_id: string
  status: ReservationStatus
  end_reason: ReservationEndReason | null
  wish_title_snapshot: string
  created_at: string
  ended_at: string | null
}

export interface DemoSeed {
  people: readonly DemoPerson[]
  /** `sections` may be left out: 'wishes', every occasion before the bring-along list */
  occasions: readonly (Omit<OccasionRow, 'sections'> & { sections?: OccasionSections })[]
  members: readonly MemberRow[]
  wishlists: readonly SeedWishlistRow[]
  wishes: readonly WishRow[]
  invites: readonly { row: InviteRow; token: string }[]
  reservations: readonly ReservationRow[]
  /** the bring-along list (20261025150000); optional */
  potluck?: readonly PotluckRow[]
}

/** The social part of export_my_data() (profile and consents come from the account itself). */
export interface DemoExportParts {
  occasions_hosted: Record<string, unknown>[]
  memberships: Record<string, unknown>[]
  wishlists: Record<string, unknown>[]
  reservations_made_by_me: Record<string, unknown>[]
}

// ---- tables as REST sees them: every column + the column-level SELECT grant (v1.1 migration) ----

export const OCCASIONS: TableAccess = {
  table: 'occasions',
  columns: ['id', 'host_id', 'title', 'starts_at', 'ends_at', 'tz', 'all_day', 'place_text', 'description', 'cancelled_at', 'created_at', 'updated_at', 'sections', 'guests_can_invite', 'cover_theme', 'place_lat', 'place_lon'],
  readable: ['id', 'host_id', 'title', 'starts_at', 'ends_at', 'tz', 'all_day', 'place_text', 'description', 'cancelled_at', 'created_at', 'updated_at', 'sections', 'guests_can_invite', 'cover_theme', 'place_lat', 'place_lon'],
}
export const OCCASION_MEMBERS: TableAccess = {
  table: 'occasion_members',
  columns: ['occasion_id', 'profile_id', 'role', 'rsvp', 'status', 'invited_via', 'joined_at', 'updated_at'],
  readable: ['occasion_id', 'profile_id', 'role', 'rsvp', 'status', 'invited_via', 'joined_at', 'updated_at'],
}
export const WISHLISTS: TableAccess = {
  table: 'wishlists',
  columns: ['id', 'occasion_id', 'owner_id', 'recipient_id', 'title', 'created_at', 'updated_at', 'visibility', 'cover_tone', 'cover_icon', 'due_on'],
  // M1 (P9): updated_at is not REST-readable any more (the owner gets it in the export)
  readable: ['id', 'occasion_id', 'owner_id', 'recipient_id', 'title', 'created_at', 'visibility', 'cover_tone', 'cover_icon', 'due_on'],
}
export const WISHES: TableAccess = {
  table: 'wishes',
  columns: ['id', 'wishlist_id', 'title', 'price_cents', 'currency', 'url', 'note', 'priority', 'created_at', 'updated_at',
    'description', 'brand', 'color', 'gtin', 'shop_name', 'received_at', 'quantity'],
  // M1 (P9): updated_at is not REST-readable any more (the owner gets it in the export); + the details (20261022120000)
  // + received_at (20261022160000: readable like the rest, never REST-updatable)
  readable: ['id', 'wishlist_id', 'title', 'price_cents', 'currency', 'url', 'note', 'priority', 'created_at',
    'description', 'brand', 'color', 'gtin', 'shop_name', 'received_at', 'quantity'],
  // FK wishes.wishlist_id → wishlists.id: getWish() embeds the list row (lib/api/wishes.ts)
  embeds: { wishlists: { foreignKey: 'wishlist_id', access: WISHLISTS } },
}
export const INVITES: TableAccess = {
  table: 'invites',
  columns: ['id', 'occasion_id', 'created_by', 'token_hash', 'expires_at', 'max_uses', 'use_count', 'revoked_at', 'created_at'],
  readable: ['id', 'occasion_id', 'created_by', 'expires_at', 'max_uses', 'use_count', 'revoked_at', 'created_at'],
}
/** Co-members read id + display_name only; locale / timestamps come from get_me() and the export. */
export const PROFILES: TableAccess = {
  table: 'profiles',
  columns: ['id', 'display_name', 'locale', 'onboarding_done_at', 'created_at', 'updated_at', 'banner', 'in_suggestions'],
  readable: ['id', 'display_name'],
}

// column-level UPDATE grants
const OCCASION_UPDATE = ['title', 'starts_at', 'ends_at', 'tz', 'all_day', 'place_text', 'description', 'cancelled_at', 'sections', 'guests_can_invite', 'cover_theme', 'place_lat', 'place_lon']
/** occasions_cover_theme_check (20261027140000): the app's motif keys + 'none' */
const COVER_THEMES: readonly string[] = [...THEME_IDS, 'none']
/** occasions_sections_check (20261025150000) */
const SECTIONS: readonly string[] = ['wishes', 'bring', 'both']
/** potluck: at most 50 entries per occasion; titles 1..80 characters, one line */
export const POTLUCK_LIMIT = 50
const MEMBER_UPDATE = ['rsvp']
// + quantity (20261030120000 "Anzahl"; guarded by its switch like the trigger wish_quantity_guard)
const WISH_UPDATE = ['title', 'price_cents', 'currency', 'url', 'note', 'priority', 'description', 'brand', 'color', 'gtin', 'shop_name', 'quantity']
const INVITE_UPDATE = ['revoked_at']
// wave 2 (follows-design §4.4): INSERT is column-level now (no created_at/updated_at from the client);
// UPDATE: title (pilot) + cover and date — the visibility NEVER through REST, only set_list_visibility()
const WISHLIST_INSERT = ['id', 'occasion_id', 'owner_id', 'recipient_id', 'title', 'visibility', 'cover_tone', 'cover_icon', 'due_on']
const WISHLIST_UPDATE = ['title', 'cover_tone', 'cover_icon', 'due_on']
/** wishlists_cover_icon_check */
export const COVER_ICON_KEYS: readonly string[] = ['gift', 'cake', 'tree', 'home', 'ring', 'star', 'book', 'game', 'plant', 'plane', 'music', 'heart']
/** profiles_banner_check */
export const BANNER_KEYS: readonly string[] = ['sunrise', 'meadow', 'sky', 'berry', 'dusk', 'bunnies', 'carrots', 'confetti']
/** M1 trigger private.wishlist_limit: at most 20 lists without an occasion per owner */
export const STANDALONE_LIST_LIMIT = 20
/** M3 reserve_wish: at most 5 active reservations of one giver for one recipient on lists without an occasion */
export const FOLLOWER_RESERVATION_LIMIT = 5

// ---- value checks (types → 22P02/22007, CHECK constraints → 23514) ------------------------------

type Input = Readonly<Record<string, unknown>>

const has = (input: Input, key: string): boolean => Object.prototype.hasOwnProperty.call(input, key)
/** Postgres length(): characters (code points), not UTF-16 units. */
const chars = (text: string): number => [...text].length
/** Postgres btrim(text): spaces only. */
const btrim = (text: string): string => text.replace(/^ +| +$/g, '')
const filled = (text: string, max: number): boolean => chars(text) >= 1 && chars(text) <= max && btrim(text) !== ''
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function asUuid(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput('uuid')
  return value.toLowerCase()
}

function asText(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw invalidInput('text')
  return value
}

function asTimestamp(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalidDatetime()
  return new Date(value).toISOString()
}

function asBoolean(value: unknown): boolean | null {
  if (value === null) return null
  if (typeof value !== 'boolean') throw invalidInput('boolean')
  return value
}

/** numeric(p, 5) (20261027190000 place_lat / place_lon): a number (or numeric text), rounded to 5 decimals. */
function asPoint5(value: unknown): number | null {
  if (value === null) return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (typeof value !== 'number' && typeof value !== 'string') throw invalidInput('numeric')
  if (typeof value === 'string' && Number.isNaN(number) && value.trim() !== 'NaN') throw invalidInput('numeric')
  return Number.isFinite(number) ? Math.round(number * 1e5) / 1e5 : number
}

function asInteger(type: 'integer' | 'smallint'): (value: unknown) => number | null {
  return (value) => {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isInteger(value)) throw invalidInput(type)
    return value
  }
}

/** Unknown column → PGRST204; a column outside the grant → 42501 (checked before any row is touched). */
function checkColumns(access: TableAccess, input: Input, granted: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!access.columns.includes(key)) throw unknownColumn(access.table, key)
    if (!granted.includes(key)) throw permissionDenied(`table ${access.table}`)
  }
}

function coerce(input: Input, coercers: Readonly<Record<string, (value: unknown) => unknown>>): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [column, convert] of Object.entries(coercers)) {
    if (has(input, column)) values[column] = convert(input[column])
  }
  return values
}

function requireColumns(values: Readonly<Record<string, unknown>>, columns: readonly string[]): void {
  for (const column of columns) if (values[column] === null || values[column] === undefined) throw notNullViolation(column)
}

function checkOccasion(row: OccasionRow): void {
  if (!filled(row.title, 80)) throw checkViolation('occasions_title_check')
  if (row.ends_at !== null && Date.parse(row.ends_at) <= Date.parse(row.starts_at)) throw checkViolation('occasions_check')
  // 20261026180000: an all-day occasion has no end; the end lies on the start's day or the next one (dates in tz)
  if (row.ends_at !== null && row.all_day) throw checkViolation('occasions_ends_at_timed')
  if (row.ends_at !== null && Date.parse(row.ends_at) >= localDayAt(Date.parse(row.starts_at), row.tz, 2, 0, 0)) {
    throw checkViolation('occasions_ends_at_next_day')
  }
  if (chars(row.tz) < 1 || chars(row.tz) > 64) throw checkViolation('occasions_tz_check')
  if (row.place_text !== null && chars(row.place_text) > 200) throw checkViolation('occasions_place_text_check')
  if (row.description !== null && chars(row.description) > 500) throw checkViolation('occasions_description_check')
  if (!SECTIONS.includes(row.sections)) throw checkViolation('occasions_sections_check')
  if (row.cover_theme != null && !COVER_THEMES.includes(row.cover_theme)) throw checkViolation('occasions_cover_theme_check')
  // 20261027190000 occasions_place_point_check: both or neither, only with a place text, in range (NaN/Infinity never)
  const lat = row.place_lat ?? null
  const lon = row.place_lon ?? null
  if (!((lat === null && lon === null) ||
    (lat !== null && lon !== null && row.place_text !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180))) {
    throw checkViolation('occasions_place_point_check')
  }
}

function checkWish(row: WishRow): void {
  if (!filled(row.title, 120)) throw checkViolation('wishes_title_check')
  if (row.price_cents !== null && (row.price_cents < 0 || row.price_cents > 100_000_000)) throw checkViolation('wishes_price_cents_check')
  if (row.currency !== 'EUR') throw checkViolation('wishes_currency_check')
  if (row.url !== null && (chars(row.url) > 2048 || !/^https?:\/\/[^\s]+$/i.test(row.url))) throw checkViolation('wishes_url_check')
  if (row.note !== null && chars(row.note) > 500) throw checkViolation('wishes_note_check')
  if (row.priority < 1 || row.priority > 3) throw checkViolation('wishes_priority_check')
  // 20261022120000: lengths of the raw string + btrim(...) <> '' (spaces only, like Postgres btrim)
  const detail = (value: string | null | undefined, max: number) => value === null || value === undefined || filled(value, max)
  if (!detail(row.description, 1000)) throw checkViolation('wishes_description_check')
  if (!detail(row.brand, 80)) throw checkViolation('wishes_brand_check')
  if (!detail(row.color, 60)) throw checkViolation('wishes_color_check')
  if (row.gtin !== null && row.gtin !== undefined && !/^[0-9]{8,14}$/.test(row.gtin)) throw checkViolation('wishes_gtin_check')
  if (!detail(row.shop_name, 80)) throw checkViolation('wishes_shop_name_check')
  // 20261030120000
  if (row.quantity !== undefined && (row.quantity < 1 || row.quantity > 10)) throw checkViolation('wishes_quantity_check')
}

/** The CHECK constraints of wishlists (pilot v1.1 title + M1/M3). */
function checkWishlist(row: WishlistRow): void {
  if (row.title !== null && !filled(row.title, 80)) throw checkViolation('wishlists_title_check')
  if (!['occasion', 'private', 'followers'].includes(row.visibility)) throw checkViolation('wishlists_visibility_check')
  if ((row.occasion_id !== null) !== (row.visibility === 'occasion')) throw checkViolation('wishlists_kind_check')
  if (row.occasion_id === null && row.recipient_id !== row.owner_id) throw checkViolation('wishlists_standalone_self')
  if (row.occasion_id === null && row.title === null) throw checkViolation('wishlists_standalone_title')
  if (row.cover_tone !== null && (row.cover_tone < 1 || row.cover_tone > 4)) throw checkViolation('wishlists_cover_tone_check')
  if (row.cover_icon !== null && !COVER_ICON_KEYS.includes(row.cover_icon)) throw checkViolation('wishlists_cover_icon_check')
  if (row.due_on !== null && (row.occasion_id !== null || row.due_on < '2020-01-01' || row.due_on > '2100-12-31')) {
    throw checkViolation('wishlists_due_on_check')
  }
}

/** A Postgres `date`: YYYY-MM-DD of a real day (22007 otherwise, like the cast). */
function asDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidDatetime()
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) throw invalidDatetime()
  return value
}

function wishOrder(a: WishRow, b: WishRow): number {
  // the one ordering every role gets: priority desc, created_at asc (never by reservation)
  return b.priority - a.priority || byText(a.created_at, b.created_at) || byText(a.id, b.id)
}

function removeWhere<T>(list: T[], predicate: (item: T) => boolean): void {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index]
    if (item !== undefined && predicate(item)) list.splice(index, 1)
  }
}

function newToken(): string {
  // 32 random bytes as 64 hex chars, like create_invite()
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** private.wish_detail_fields(): the details + received_at + the photo's meta — about the wish only, never reservations. */
export function wishDetailFields(wish: WishRow, photo: WishPhotoMeta | null): WishDetails {
  return {
    description: wish.description ?? null, brand: wish.brand ?? null, color: wish.color ?? null, gtin: wish.gtin ?? null,
    shop_name: wish.shop_name ?? null, received_at: wish.received_at ?? null, quantity: wish.quantity ?? 1, photo,
  }
}

/** The screens' split (20261022160000): open wishes in the one order, received ones newest first. */
function splitReceived(list: readonly WishRow[]): { open: WishRow[]; received: WishRow[] } {
  const open = list.filter((wish) => !wish.received_at).sort(wishOrder)
  const received = list.filter((wish) => !!wish.received_at)
    .sort((a, b) => byText(b.received_at ?? '', a.received_at ?? '') || byText(a.id, b.id))
  return { open, received }
}

function screenWish(wish: WishRow, reserved: boolean | null, reservedByMe: boolean | null, photo: WishPhotoMeta | null): OccasionScreenWish {
  return {
    id: wish.id, title: wish.title, url: wish.url, price_cents: wish.price_cents, currency: wish.currency,
    note: wish.note, priority: wish.priority, created_at: wish.created_at, reserved, reserved_by_me: reservedByMe,
    ...wishDetailFields(wish, photo),
  }
}

export type DemoWorld = ReturnType<typeof createDemoWorld>

export function createDemoWorld(clock: () => number = Date.now) {
  const people = new Map<string, DemoPerson>()
  const occasions = new Map<string, OccasionRow>()
  const members: MemberRow[] = []
  const wishlists = new Map<string, WishlistRow>()
  const wishes = new Map<string, WishRow>()
  const invites = new Map<string, InviteRow>()
  // The database keeps only sha256(token). This in-memory demo keeps the token in a private map
  // that no endpoint reads out: REST has no token column and create_invite() returns it once.
  const inviteIdByToken = new Map<string, string>()
  const reservations: ReservationRow[] = []
  // 20261025150000: the bring-along list (never visible through REST)
  const potluck: PotluckRow[] = []
  let lastStamp = 0
  // cover photos live in src/mocks/photos.ts; get_occasion_screen carries only their meta (wave 2)
  let photoMetaOf: (occasionId: string) => OccasionPhotoMeta | null = () => null
  // wish photos live in src/mocks/wishPhotos.ts; every wish answer carries only their meta (20261022120000)
  let wishPhotoMetaOf: (wishId: string) => WishPhotoMeta | null = () => null
  const wishDetails = (wish: WishRow): WishDetails => wishDetailFields(wish, wishPhotoMetaOf(wish.id))
  // list covers live in src/mocks/listPhotos.ts; every answer that carries a list has only their meta (20261022160000)
  let listPhotoMetaOf: (listId: string) => ListPhotoMeta | null = () => null
  const listPhotoMeta = (listId: string): ListPhotoMeta | null => listPhotoMetaOf(listId)
  // own profile / banner photos live in src/mocks/profilePhotos.ts; every answer that shows a person carries only their
  // meta (20261024120000): fieldsFor = what the VIEWER may see (the visibility rule), ownFields = a person's own answers
  let profilePhotoSource: ProfilePhotoSource = { fieldsFor: () => NO_PROFILE_PHOTOS, ownFields: () => NO_PROFILE_PHOTOS }
  const profilePhotoFields = (viewer: string, profileId: string): ProfilePhotoFields => profilePhotoSource.fieldsFor(viewer, profileId)
  const ownProfilePhotos = (profileId: string): ProfilePhotoFields => profilePhotoSource.ownFields(profileId)

  /** now(), strictly increasing: "link created after the removal" stays decidable within one millisecond. */
  function stamp(): string {
    lastStamp = Math.max(clock(), lastStamp + 1)
    return new Date(lastStamp).toISOString()
  }

  // wave 2b: who follows whom (mocks/followGraph.ts; blocks are there too), the "red button" of M3
  // (private.features.follower_lists: off = no follower may read or reserve, §3.4) and the profile settings
  const follows = createFollowGraph(clock, stamp)
  // 20261027200000: + the two switches of shared wishes (on in the demo: "add to more lists", "show the extra places")
  // + 20261030120000: "Anzahl" and "Passt zusammen" (on in the demo; the tests switch them like the database)
  const features = { followerLists: true, sharedWishes: true, sharedWishesVisible: true, wishQuantity: true, wishTogether: true }
  const profileSettings = new Map<string, ProfileSettings>()

  // ---- private.* helpers ----------------------------------------------------------------------

  const membership = (occasionId: string, profileId: string): MemberRow | undefined =>
    members.find((member) => member.occasion_id === occasionId && member.profile_id === profileId)
  const isActiveMember = (occasionId: string, profileId: string): boolean => membership(occasionId, profileId)?.status === 'active'
  const isHost = (occasionId: string, profileId: string): boolean => occasions.get(occasionId)?.host_id === profileId
  /**
   * private.can_read_wishlist (M3): the owner of any own list (the "short path" of wishlists_select); never
   * a blocked pair; an occasion's list → its active members; a list without an occasion → only when it is
   * 'followers', the red button is not pressed and the reader is an accepted follower of the owner.
   */
  const canReadWishlist = (wishlistId: string | null, profileId: string): boolean => {
    const list = wishlistId === null ? undefined : wishlists.get(wishlistId)
    if (!list) return false
    if (list.owner_id === profileId) return true
    if (follows.isBlockedPair(profileId, list.owner_id) || follows.isBlockedPair(profileId, list.recipient_id)) return false
    if (list.visibility === 'occasion') return list.occasion_id !== null && isActiveMember(list.occasion_id, profileId)
    return list.visibility === 'followers' && features.followerLists && follows.isAcceptedFollower(profileId, list.owner_id)
  }
  const isWishlistOwner = (wishlistId: string | null, profileId: string): boolean =>
    wishlistId !== null && wishlists.get(wishlistId)?.owner_id === profileId
  const sharesOccasion = (a: string, b: string): boolean =>
    members.some((member) => member.profile_id === a && member.status === 'active' && isActiveMember(member.occasion_id, b))
  const hasConsents = (profileId: string): boolean => people.get(profileId)?.hasConsents() === true
  const nameOf = (profileId: string): string | null => people.get(profileId)?.displayName() ?? null
  const profileComplete = (profileId: string): boolean => nameOf(profileId) !== null
  const activeMembers = (occasionId: string): MemberRow[] =>
    members.filter((member) => member.occasion_id === occasionId && member.status === 'active')
  const listsOf = (occasionId: string): WishlistRow[] => [...wishlists.values()].filter((list) => list.occasion_id === occasionId)
  const wishesOf = (wishlistId: string): WishRow[] => [...wishes.values()].filter((wish) => wish.wishlist_id === wishlistId)
  const activeReservation = (wishId: string): ReservationRow | undefined =>
    reservations.find((reservation) => reservation.wish_id === wishId && reservation.status === 'active')
  const occasionOfList = (wishlistId: string | null): string | undefined =>
    wishlistId === null ? undefined : (wishlists.get(wishlistId)?.occasion_id ?? undefined)

  // ---- 20261027200000: ONE WISH IN SEVERAL LISTS (private.wish_placements; docs/spec/shared-wishes-design.md) ----
  // The home is wish.wishlist_id (always a place); `extraPlaces` keeps the OTHER places per wish (oldest first).
  // Stored places = what the OWNER sees and manages; effective places = what the audience reads (the home always, the
  // others while features.sharedWishesVisible). A reservation counts only while it is LIVE (reservationIsLive): the
  // wish exists, its recipient is the reservation's, and the giver reads it through an effective place right now.
  const extraPlaces = new Map<string, { listId: string; addedAt: string }[]>()
  const extrasOf = (wishId: string): { listId: string; addedAt: string }[] => extraPlaces.get(wishId) ?? []
  /** every stored place of a wish, the home first */
  const storedListsOf = (wish: WishRow): string[] => [wish.wishlist_id, ...extrasOf(wish.id).map((place) => place.listId)]
  const effectiveListsOf = (wish: WishRow): string[] => (features.sharedWishesVisible ? storedListsOf(wish) : [wish.wishlist_id])
  /** private.owner_list_wishes (stored: true) / private.effective_list_wishes (stored: false) */
  const listWishes = (listId: string, stored: boolean): WishRow[] => [...wishes.values()].filter((wish) =>
    wish.wishlist_id === listId || ((stored || features.sharedWishesVisible) && extrasOf(wish.id).some((place) => place.listId === listId)))
  /** private.can_read_wish: who reads at least one effective place */
  const canReadWish = (wish: WishRow | undefined, profileId: string): boolean =>
    wish !== undefined && effectiveListsOf(wish).some((listId) => canReadWishlist(listId, profileId))
  /** private.reservation_is_live */
  const reservationIsLive = (reservation: ReservationRow): boolean => {
    if (reservation.status !== 'active' || reservation.wish_id === null) return false
    const wish = wishes.get(reservation.wish_id)
    const home = wish ? wishlists.get(wish.wishlist_id) : undefined
    return wish !== undefined && home !== undefined && home.recipient_id === reservation.recipient_id
      && home.owner_id !== reservation.reserver_id && canReadWish(wish, reservation.reserver_id)
  }
  /** the ONE active reservation of a wish, when it is live (the only kind any answer counts) */
  const liveReservation = (wishId: string): ReservationRow | undefined => {
    const held = activeReservation(wishId)
    return held && reservationIsLive(held) ? held : undefined
  }
  /** does the giver read the wish through an effective place of an OCCASION? (the cap of 5 does not apply then) */
  const readsWishViaOccasion = (wish: WishRow, profileId: string): boolean =>
    effectiveListsOf(wish).some((listId) => wishlists.get(listId)?.occasion_id != null && canReadWishlist(listId, profileId))
  /** the list a live reservation is shown in: the giver's readable effective places, the home first */
  const reservationPlace = (wish: WishRow, profileId: string): WishlistRow | undefined => {
    const id = effectiveListsOf(wish).find((listId) => canReadWishlist(listId, profileId))
    return id === undefined ? undefined : wishlists.get(id)
  }
  const listTitleOf = (list: WishlistRow): string | null => list.title ?? (list.occasion_id ? (occasions.get(list.occasion_id)?.title ?? null) : null)
  /** also_in for the OWNER: every other stored place */
  const placesForOwner = (wish: WishRow, exceptListId: string) => storedListsOf(wish).filter((id) => id !== exceptListId).flatMap((id) => {
    const list = wishlists.get(id)
    return list ? [{ id, title: listTitleOf(list), kind: list.occasion_id ? 'occasion' as const : 'standalone' as const,
      occasion_id: list.occasion_id, home: id === wish.wishlist_id, paused: id !== wish.wishlist_id && !features.sharedWishesVisible }] : []
  })
  /** also_in for a GUEST of an occasion (Q18): readable places by name, the rest as ONE hidden entry */
  const placesForViewer = (wish: WishRow, exceptListId: string, viewer: string) => {
    const others = effectiveListsOf(wish).filter((id) => id !== exceptListId)
    const readable = others.flatMap((id) => {
      const list = wishlists.get(id)
      return list && canReadWishlist(id, viewer) ? [{ id, title: listTitleOf(list), kind: list.occasion_id ? 'occasion' as const : 'standalone' as const }] : []
    })
    return readable.length < others.length ? [...readable, { id: null, title: null, kind: 'hidden' as const }] : readable
  }
  /** a deleted list: a wish that also lives elsewhere stays — its home moves to its oldest other place */
  function rehomeOutOf(listId: string): void {
    for (const wish of wishes.values()) {
      const extras = extrasOf(wish.id).filter((place) => place.listId !== listId && wishlists.has(place.listId))
      if (wish.wishlist_id === listId && extras.length > 0) {
        const [next, ...rest] = extras
        wish.wishlist_id = next!.listId
        extraPlaces.set(wish.id, rest)
      } else if (extras.length !== extrasOf(wish.id).length) {
        extraPlaces.set(wish.id, extras)
      }
    }
  }
  /** private.received_prompt_due: day 1..7 after the occasion's end, not dismissed, open wishes left */
  const dismissedPrompts = new Set<string>()

  /** v1.1 require_user(): the old token of a deleted account opens nothing. */
  function requireUser(profileId: string): void {
    if (!people.has(profileId)) throw raise('not_allowed')
  }

  function endReservation(reservation: ReservationRow, reason: ReservationEndReason): void {
    reservation.status = 'ended'
    reservation.end_reason = reason
    reservation.ended_at = stamp()
  }

  /** private.end_reservations_in_occasion() */
  function endReservationsIn(occasionId: string, reserverId: string, reason: ReservationEndReason): void {
    // 20261027200000: a wish of this occasion that the giver still reads elsewhere (a shared wish) keeps it
    for (const reservation of reservations) {
      if (reservation.reserver_id === reserverId && reservation.status === 'active' && !reservationIsLive(reservation)
        && (occasionOfList(reservation.wishlist_id) === occasionId || reservation.wishlist_id === null)) {
        endReservation(reservation, reason)
      }
    }
  }

  function revokeLinks(occasionId: string): void {
    const at = stamp()
    for (const invite of invites.values()) if (invite.occasion_id === occasionId && invite.revoked_at === null) invite.revoked_at = at
  }

  /** Trigger wish_before_delete (ends the active reservation as wish_deleted) + FK `on delete set null`. */
  function removeWish(wish: WishRow): void {
    for (const reservation of reservations) {
      if (reservation.wish_id !== wish.id) continue
      if (reservation.status === 'active') endReservation(reservation, 'wish_deleted')
      reservation.wish_id = null
    }
    wishes.delete(wish.id)
    extraPlaces.delete(wish.id)
  }

  function removeInvite(invite: InviteRow): void {
    invites.delete(invite.id)
    for (const [token, inviteId] of inviteIdByToken) if (inviteId === invite.id) inviteIdByToken.delete(token)
    for (const member of members) if (member.invited_via === invite.id) member.invited_via = null
  }

  /**
   * delete from occasions → cascade: lists, wishes (with their trigger), links, memberships.
   * (Deleting the visited entry while iterating a Map is safe in JS, so the loops iterate the maps directly.)
   */
  function removeOccasion(occasion: OccasionRow): void {
    for (const list of listsOf(occasion.id)) {
      rehomeOutOf(list.id)
      for (const wish of wishesOf(list.id)) removeWish(wish)
      for (const reservation of reservations) if (reservation.wishlist_id === list.id) reservation.wishlist_id = null
      wishlists.delete(list.id)
    }
    for (const invite of invites.values()) if (invite.occasion_id === occasion.id) removeInvite(invite)
    removeWhere(members, (member) => member.occasion_id === occasion.id)
    removeWhere(potluck, (item) => item.occasion_id === occasion.id) // potluck_items: on delete cascade
    occasions.delete(occasion.id)
  }

  /** Trigger occasion_members_potluck_release: a membership that stops being active releases its commitments. */
  function releasePotluck(occasionId: string, profileId: string): void {
    for (const item of potluck) if (item.occasion_id === occasionId && item.claimed_by === profileId) item.claimed_by = null
  }

  function occasionById(occasionId: string | null): OccasionRow | undefined {
    return occasionId === null ? undefined : occasions.get(occasionId)
  }

  // ---- RPCs (pilot-decisions §2–§3, migration v1.1) -----------------------------------------------

  function feedRow(viewer: string, occasion: OccasionRow, me: MemberRow): FeedOccasion {
    return {
      id: occasion.id, title: occasion.title, starts_at: occasion.starts_at, tz: occasion.tz, all_day: occasion.all_day,
      // 20261026180000: the end of a timed occasion, null without one
      ends_at: occasion.ends_at,
      place_text: occasion.place_text, role: me.role, rsvp: me.rsvp, host_name: nameOf(occasion.host_id), host_id: occasion.host_id,
      // 20261026180000 (P-I16): the people the occasion screen lists — not those hidden from the viewer by a block
      member_count: activeMembers(occasion.id).filter((member) => !follows.isBlockedPair(viewer, member.profile_id)).length,
      // 20261027200000: by places — the host counts every stored place, a guest the effective ones
      wish_count: listsOf(occasion.id).reduce((count, list) => count + listWishes(list.id, me.role === 'host').length, 0),
      // the host never gets a number here (key present, value null); a member counts only their own LIVE ones
      my_reservation_count: me.role === 'host'
        ? null
        : reservations.filter((r) => r.reserver_id === viewer && reservationIsLive(r) && r.wish_id !== null
          && listsOf(occasion.id).some((list) => listWishes(list.id, false).some((wish) => wish.id === r.wish_id))).length,
      // 20261025130000: the cover's meta for Start (bytes: get_occasion_photo, the same rule — null when blocked)
      photo: follows.isBlockedPair(viewer, occasion.host_id) ? null : photoMetaOf(occasion.id),
      // 20261025150000: what the occasion offers (the host's card: no "no wishes yet" for a bring-only occasion)
      sections: occasion.sections,
      // 20261027140000: the cover motif, the same for every viewer
      cover_theme: occasion.cover_theme ?? null,
    }
  }

  /** get_feed(): upcoming ascending; past = ended within 30 days, descending. */
  function getFeed(viewer: string): FeedScreen {
    requireUser(viewer)
    const now = clock()
    const rows = members.flatMap((me) => {
      const occasion = me.profile_id === viewer && me.status === 'active' ? occasions.get(me.occasion_id) : undefined
      if (!occasion) return []
      const startsMs = Date.parse(occasion.starts_at)
      const endsMs = occasion.ends_at !== null ? Date.parse(occasion.ends_at) : endOfLocalDay(startsMs, occasion.tz)
      return [{ startsMs, endsMs, row: feedRow(viewer, occasion, me) }]
    })
    type Entry = (typeof rows)[number]
    const ascending = (a: Entry, b: Entry): number => a.startsMs - b.startsMs || byText(a.row.id, b.row.id)
    const descending = (a: Entry, b: Entry): number => b.startsMs - a.startsMs || byText(a.row.id, b.row.id)
    return {
      upcoming: rows.filter((entry) => entry.endsMs >= now).sort(ascending).map((entry) => entry.row),
      past: rows.filter((entry) => entry.endsMs < now && entry.endsMs >= now - 30 * DAY).sort(descending).map((entry) => entry.row),
    }
  }

  /** get_occasion_screen(): for the list owner the reservation keys are literal nulls. */
  function getOccasionScreen(viewer: string, occasionId: string | null): OccasionScreen {
    requireUser(viewer)
    const occasion = occasionById(occasionId)
    if (!occasion) throw raise('not_found')
    const me = membership(occasion.id, viewer)
    if (!me || me.status !== 'active') throw raise('not_found') // outsider / left / removed: one answer
    // v1.1: a blocked pair with the host never sees the occasion (wave 2b: blocking is in the UI now)
    if (follows.isBlockedPair(viewer, occasion.host_id)) throw raise('not_found')

    let invite: OccasionScreen['invite'] = null
    if (me.role === 'host') {
      const now = clock()
      const latest = [...invites.values()]
        .filter((link) => link.occasion_id === occasion.id && link.revoked_at === null && Date.parse(link.expires_at) > now && link.use_count < link.max_uses)
        .sort((a, b) => byText(b.created_at, a.created_at))[0]
      if (latest) invite = { active: true, expires_at: latest.expires_at }
    }

    // the one list of the pilot: the host's
    const list = listsOf(occasion.id).filter((candidate) => candidate.owner_id === occasion.host_id).sort((a, b) => byText(a.created_at, b.created_at))[0]
    let wishlist: OccasionScreen['wishlist'] = null
    if (list) {
      const owner = viewer === list.owner_id || viewer === list.recipient_id
      // 20261027200000: the owner sees the STORED places of the list, guests the effective ones
      const { open, received } = splitReceived(listWishes(list.id, owner))
      const items = (rows: readonly WishRow[]) => owner
        // OWNER BRANCH: literal nulls; reservations are not even looked at (+ home, paused, also_in)
        ? rows.map((wish) => ({ ...screenWish(wish, null, null, wishPhotoMetaOf(wish.id)), ...ownerPlaceFields(wish, list.id), together: togetherForOwner(wish, viewer) }))
        // MEMBER BRANCH: availability and the own reservation — never who reserved; only a LIVE one counts
        : rows.map((wish) => {
          const held = liveReservation(wish.id)
          return { ...screenWish(wish, held !== undefined, held?.reserver_id === viewer, wishPhotoMetaOf(wish.id)), also_in: placesForViewer(wish, list.id, viewer), together: togetherForViewer(wish, viewer) }
        })
      // 20261022160000: + the list cover's meta and the received wishes in their own part
      wishlist = { id: list.id, owner_id: list.owner_id, title: list.title, photo: listPhotoMeta(list.id), wishes: items(open), received: items(received) }
      if (owner) wishlist.received_prompt = receivedPromptDue(occasion, list.id)
    }

    return {
      occasion: {
        id: occasion.id, title: occasion.title, starts_at: occasion.starts_at, tz: occasion.tz, all_day: occasion.all_day,
        // 20261026180000: the end of a timed occasion, null without one
        ends_at: occasion.ends_at,
        place_text: occasion.place_text, description: occasion.description, created_at: occasion.created_at,
        // + the host's profile photo meta (20261024120000, the visibility rule)
        host: { id: occasion.host_id, display_name: nameOf(occasion.host_id), photo: profilePhotoFields(viewer, occasion.host_id).photo },
        photo: photoMetaOf(occasion.id),
        sections: occasion.sections,
        // 20261027140000: the cover motif
        cover_theme: occasion.cover_theme ?? null,
        // 20261027190000: where the place is (the screen's mini map)
        place_lat: occasion.place_lat ?? null,
        place_lon: occasion.place_lon ?? null,
      },
      viewer: { role: me.role, rsvp: me.rsvp },
      members: activeMembers(occasion.id)
        // a blocked pair does not see each other in the guest list (v1.1 RPC; agent K2 brought blocks into the demo)
        .filter((member) => !follows.isBlockedPair(viewer, member.profile_id))
        .sort((a, b) => byText(a.joined_at, b.joined_at) || byText(a.profile_id, b.profile_id))
        .map((member) => ({ profile_id: member.profile_id, display_name: nameOf(member.profile_id), role: member.role, rsvp: member.rsvp,
          photo: profilePhotoFields(viewer, member.profile_id).photo })),
      invite,
      wishlist,
      // 20261025150000: the bring-along list; null while the occasion offers wishes only
      potluck: occasion.sections === 'wishes' ? null : potluckScreen(viewer, occasion),
    }
  }

  // ---- 20261025150000: the bring-along list "Mitbringen" (supabase/migrations/20261025150000_potluck.sql) ----
  // NOT secret: every active member sees who brings what; the bringer's name is hidden only between a blocked
  // pair; who created an entry is never sent.

  function potluckScreen(viewer: string, occasion: OccasionRow): PotluckScreen {
    const items: PotluckItem[] = potluck
      .filter((item) => item.occasion_id === occasion.id)
      .sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
      .map((item) => ({
        id: item.id, title: item.title, created_at: item.created_at,
        can_edit: item.created_by === viewer,
        can_delete: item.created_by === viewer || occasion.host_id === viewer,
        claimed: item.claimed_by !== null,
        claimed_by_me: item.claimed_by === viewer,
        bringer: item.claimed_by === null || follows.isBlockedPair(viewer, item.claimed_by) ? null
          : { profile_id: item.claimed_by, display_name: nameOf(item.claimed_by), photo: profilePhotoFields(viewer, item.claimed_by).photo },
      }))
    return { max_items: POTLUCK_LIMIT, items }
  }

  /** private.potluck_gate: an active member, not blocked with the host — otherwise not_found. */
  function potluckGate(viewer: string, occasion: OccasionRow | undefined): OccasionRow {
    if (!occasion || !isActiveMember(occasion.id, viewer) || follows.isBlockedPair(viewer, occasion.host_id)) throw raise('not_found')
    return occasion
  }

  function potluckTitle(value: string | null): string {
    const title = btrim(value ?? '')
    if (chars(title) < 1 || chars(title) > 80 || /[\n\r\t]/.test(title)) throw raise('validation')
    return title
  }

  function potluckItem(itemId: string | null): { item: PotluckRow; occasion: OccasionRow } {
    const item = itemId === null ? undefined : potluck.find((row) => row.id === itemId)
    const occasion = item ? occasions.get(item.occasion_id) : undefined
    if (!item || !occasion) throw raise('not_found')
    return { item, occasion }
  }

  function addPotluckItem(viewer: string, occasionId: string | null, title: string | null, claim: boolean): { id: string } {
    requireUser(viewer)
    if (!hasConsents(viewer)) throw raise('consent_required')
    const occasion = potluckGate(viewer, occasionById(occasionId))
    if (occasion.sections === 'wishes') throw raise('not_allowed')
    const clean = potluckTitle(title)
    if (potluck.filter((item) => item.occasion_id === occasion.id).length >= POTLUCK_LIMIT) throw raise('limit_reached')
    const row: PotluckRow = { id: crypto.randomUUID(), occasion_id: occasion.id, title: clean, created_by: viewer, claimed_by: claim ? viewer : null, created_at: stamp() }
    potluck.push(row)
    return { id: row.id }
  }

  function renamePotluckItem(viewer: string, itemId: string | null, title: string | null): { ok: true } {
    requireUser(viewer)
    if (!hasConsents(viewer)) throw raise('consent_required')
    const { item, occasion } = potluckItem(itemId)
    potluckGate(viewer, occasion)
    const clean = potluckTitle(title)
    if (item.created_by !== viewer) throw raise('not_allowed')
    item.title = clean
    return { ok: true }
  }

  function deletePotluckItem(viewer: string, itemId: string | null): { ok: true } {
    requireUser(viewer)
    const { item, occasion } = potluckItem(itemId)
    potluckGate(viewer, occasion)
    if (item.created_by !== viewer && occasion.host_id !== viewer) throw raise('not_allowed')
    removeWhere(potluck, (row) => row.id === item.id)
    return { ok: true }
  }

  function claimPotluckItem(viewer: string, itemId: string | null): { ok: true } {
    requireUser(viewer)
    if (!hasConsents(viewer)) throw raise('consent_required')
    const { item, occasion } = potluckItem(itemId)
    potluckGate(viewer, occasion)
    if (item.claimed_by === viewer) return { ok: true }
    if (item.claimed_by !== null) throw raise('already_claimed')
    item.claimed_by = viewer
    return { ok: true }
  }

  function unclaimPotluckItem(viewer: string, itemId: string | null): { ok: true } {
    requireUser(viewer)
    const { item, occasion } = potluckItem(itemId)
    potluckGate(viewer, occasion)
    if (item.claimed_by !== viewer) throw raise('not_found')
    item.claimed_by = null
    return { ok: true }
  }

  /** export_my_potluck(): the caller's own entries and commitments, no other person. */
  function exportMyPotluck(viewer: string): Record<string, unknown> {
    requireUser(viewer)
    const ids = [...new Set(potluck.filter((item) => item.created_by === viewer || item.claimed_by === viewer).map((item) => item.occasion_id))]
    const rows = ids.flatMap((id) => {
      const occasion = occasions.get(id)
      if (!occasion) return []
      const own = potluck.filter((item) => item.occasion_id === id).sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
      return [{
        occasion_id: id,
        occasion_title: isActiveMember(id, viewer) ? occasion.title : null,
        sections: occasion.host_id === viewer ? occasion.sections : null,
        items_created: own.filter((item) => item.created_by === viewer).map((item) => ({ title: item.title, created_at: item.created_at, claimed: item.claimed_by !== null })),
        my_claims: own.filter((item) => item.claimed_by === viewer).map((item) => ({ title: item.title })),
        starts_at: occasion.starts_at,
      }]
    }).sort((a, b) => byText(a.starts_at, b.starts_at) || byText(a.occasion_id, b.occasion_id))
      .map(({ starts_at: _startsAt, ...rest }) => rest)
    return { format: 'bunprise-potluck-v1', occasions: rows }
  }

  /** create_invite(): host only; revokes the older links; max(now + 14 d, starts_at + 7 d); 50 uses. */
  function createInvite(viewer: string, occasionId: string | null): { token: string } {
    requireUser(viewer)
    if (!hasConsents(viewer)) throw raise('consent_required')
    const occasion = occasionById(occasionId)
    if (!occasion || occasion.host_id !== viewer) throw raise('not_found') // foreign / unknown occasion: one answer
    revokeLinks(occasion.id)
    const token = newToken()
    const createdAt = stamp()
    const expires = Math.max(Date.parse(createdAt) + 14 * DAY, Date.parse(occasion.starts_at) + 7 * DAY)
    const row: InviteRow = {
      id: crypto.randomUUID(), occasion_id: occasion.id, created_by: viewer, expires_at: new Date(expires).toISOString(),
      max_uses: 50, use_count: 0, revoked_at: null, created_at: createdAt,
    }
    invites.set(row.id, row)
    inviteIdByToken.set(token, row.id)
    return { token }
  }

  /** accept_invite(): the explicit "Beitreten" — opening /i alone never calls it. */
  function acceptInvite(viewer: string, token: string | null): { occasion_id: string } {
    requireUser(viewer)
    if (token === null || !TOKEN.test(token)) throw raise('invite_invalid')
    const invite = invites.get(inviteIdByToken.get(token) ?? '')
    if (!invite) throw raise('invite_invalid')
    if (!hasConsents(viewer)) throw raise('consent_required')
    if (!profileComplete(viewer)) throw raise('profile_incomplete')
    // one code for unknown / expired / revoked / exhausted / cancelled occasion (20261026190000)
    if (invite.revoked_at !== null || Date.parse(invite.expires_at) <= clock() || invite.use_count >= invite.max_uses) throw raise('invite_invalid')
    if (occasionById(invite.occasion_id)?.cancelled_at) throw raise('invite_invalid')
    const existing = membership(invite.occasion_id, viewer)
    if (existing?.status === 'active') return { occasion_id: invite.occasion_id } // members and the host: no second use
    // removed guests come back only by a link created AFTER the removal (v1.1 §0.4); "left" may reuse the old one
    if (existing?.status === 'removed' && Date.parse(invite.created_at) <= Date.parse(existing.updated_at)) throw raise('invite_invalid')
    const at = stamp()
    if (existing) {
      existing.status = 'active'
      existing.invited_via = invite.id
      existing.rsvp = 'none'
      existing.joined_at = at
      existing.updated_at = at
    } else {
      members.push({ occasion_id: invite.occasion_id, profile_id: viewer, role: 'member', rsvp: 'none', status: 'active', invited_via: invite.id, joined_at: at, updated_at: at })
    }
    invite.use_count += 1
    return { occasion_id: invite.occasion_id }
  }

  /** Active reservations of one giver for one recipient on lists WITHOUT an occasion (the cap of 5, M3). */
  // 20261022160000: reservations of RECEIVED wishes no longer count
  // 20261027200000: only LIVE reservations of wishes the giver reaches through no occasion (private.counts_for_cap)
  const followerReservationCount = (reserverId: string, recipientId: string): number =>
    reservations.filter((r) => {
      if (r.reserver_id !== reserverId || r.recipient_id !== recipientId || !reservationIsLive(r) || r.wish_id === null) return false
      const wish = wishes.get(r.wish_id)
      return wish !== undefined && !wish.received_at && !readsWishViaOccasion(wish, reserverId)
    }).length

  /**
   * reserve_wish(): owner → not_allowed BEFORE reservations are looked at; outsider → the same code.
   * Occasion list: the pilot path. List without an occasion (M3, follows-design §5.5): the accepted follow
   * of the owner, then the visibility 'followers', the red button and no block — any miss = not_allowed;
   * the same giver again = ok; the 6th own active reservation for this recipient = limit_reached (before
   * already_reserved, like the SQL's step 3b before the insert).
   */
  function reserveWish(viewer: string, wishId: string | null): { ok: true } {
    requireUser(viewer)
    if (!hasConsents(viewer)) throw raise('consent_required')
    if (!profileComplete(viewer)) throw raise('profile_incomplete')
    const wish = wishId === null ? undefined : wishes.get(wishId)
    if (!wish) throw raise('not_found')
    const list = wishlists.get(wish.wishlist_id)
    if (!list || viewer === list.owner_id || viewer === list.recipient_id) throw raise('not_allowed')
    // 20261027200000: through ANY effective place of the wish the giver reads (an occasion or a follower list)
    if (!canReadWish(wish, viewer)) throw raise('not_allowed')
    const active = activeReservation(wish.id)
    if (active && reservationIsLive(active)) {
      if (active.reserver_id === viewer) return { ok: true } // the same person pressing again
      // (a received wish answers below before the conflict, like the SQL's order for a NEW reservation)
    } else if (active) {
      endReservation(active, 'access_ended') // a dead row is ended and replaced
    }
    const held = active && reservationIsLive(active) ? active : undefined
    // 20261022160000: a received wish is never NEWLY reserved (the code of every non-reservable wish)
    if (wish.received_at) throw raise('not_allowed')
    if (!readsWishViaOccasion(wish, viewer) && followerReservationCount(viewer, list.recipient_id) >= FOLLOWER_RESERVATION_LIMIT) {
      throw raise('limit_reached')
    }
    if (held) throw raise('already_reserved')
    reservations.push({
      id: crypto.randomUUID(), wish_id: wish.id, wishlist_id: list.id, recipient_id: list.recipient_id, reserver_id: viewer,
      status: 'active', end_reason: null, wish_title_snapshot: wish.title, created_at: stamp(), ended_at: null,
    })
    return { ok: true }
  }

  /**
   * cancel_reservation(): only the reserver's own active reservation; others → not_found. Owner / recipient →
   * not_allowed; an occasion list needs the active membership, a list without an occasion can_read_wishlist.
   */
  function cancelReservation(viewer: string, wishId: string | null): { ok: true } {
    requireUser(viewer)
    const wish = wishId === null ? undefined : wishes.get(wishId)
    if (!wish) throw raise('not_found')
    const list = wishlists.get(wish.wishlist_id)
    if (!list || viewer === list.owner_id || viewer === list.recipient_id) throw raise('not_allowed')
    if (!canReadWish(wish, viewer)) throw raise('not_allowed') // 20261027200000: any effective place
    const mine = reservations.find((r) => r.wish_id === wish.id && r.reserver_id === viewer && r.status === 'active')
    if (!mine) throw raise('not_found')
    endReservation(mine, 'by_reserver')
    return { ok: true }
  }

  /**
   * my_reservations(): own active ones + those ended by others within 90 days; live data only while the list
   * is readable (§0 p. 3 — now "access", not only "membership"). M3: + `list` {id, title, owner_name} for a
   * list without an occasion (null otherwise and without access: then only the title snapshot remains).
   */
  function myReservations(viewer: string): MyReservation[] {
    requireUser(viewer)
    const cutoff = clock() - 90 * DAY
    return reservations
      .filter((r) => r.reserver_id === viewer && (r.status === 'active' || (r.end_reason !== 'by_reserver' && r.ended_at !== null && Date.parse(r.ended_at) >= cutoff)))
      .sort((a, b) => byText(b.created_at, a.created_at) || byText(a.id, b.id))
      .map((r) => {
        // 20261027200000: context only for a LIVE reservation (its place: the giver's readable places, the home first);
        // every other row: the public reason (Q1) without context, the snapshot title
        const live = reservationIsLive(r)
        const wish = live && r.wish_id !== null ? wishes.get(r.wish_id) : undefined
        const list = wish ? reservationPlace(wish, viewer) : undefined
        const occasion = list?.occasion_id ? occasions.get(list.occasion_id) : undefined
        return {
          wish_id: wish ? r.wish_id : null, wish_title: wish?.title ?? r.wish_title_snapshot, occasion_id: occasion?.id ?? null,
          occasion_title: occasion?.title ?? null, starts_at: occasion?.starts_at ?? null, status: live ? 'active' : 'ended',
          end_reason: publicEndReason(r, live), created_at: r.created_at,
          list: list && list.occasion_id === null ? { id: list.id, title: list.title, owner_name: nameOf(list.owner_id) } : null,
          // 20261022160000: "Erhalten", live like the title (a wish moved away is not joined any more)
          received_at: wish?.received_at ?? null,
        }
      })
  }

  /** leave_occasion(): the host deletes instead; own reservations end as member_left. */
  function leaveOccasion(viewer: string, occasionId: string | null): { ok: true } {
    requireUser(viewer)
    const occasion = occasionById(occasionId)
    if (occasion && occasion.host_id === viewer) throw raise('not_allowed')
    const me = occasion ? membership(occasion.id, viewer) : undefined
    if (!occasion || !me || me.status !== 'active') throw raise('not_found')
    me.status = 'left'
    me.updated_at = stamp()
    endReservationsIn(occasion.id, viewer, 'member_left')
    releasePotluck(occasion.id, viewer)
    return { ok: true }
  }

  /** remove_member(): host only; ends the guest's reservations and REVOKES the occasion's links. */
  function removeMember(viewer: string, occasionId: string | null, profileId: string | null): { ok: true } {
    requireUser(viewer)
    const occasion = occasionById(occasionId)
    if (!occasion || occasion.host_id !== viewer) throw raise('not_found')
    const guest = profileId === null ? undefined : membership(occasion.id, profileId)
    if (!guest || guest.role !== 'member' || guest.status !== 'active') throw raise('not_found')
    guest.status = 'removed'
    guest.updated_at = stamp()
    endReservationsIn(occasion.id, guest.profile_id, 'member_removed')
    releasePotluck(occasion.id, guest.profile_id)
    // the link the removed guest still has must die with the membership (F-1)
    revokeLinks(occasion.id)
    return { ok: true }
  }

  // ---- 20261022160000: "Erhalten" and moving a wish (the list owner only) ---------------------------------

  /** The wish if the viewer owns its list; one answer (not_found) for unknown and foreign. */
  function ownWish(viewer: string, wishId: string | null): WishRow {
    const wish = wishId === null ? undefined : wishes.get(wishId)
    if (!wish || !isWishlistOwner(wish.wishlist_id, viewer)) throw raise('not_found')
    return wish
  }

  /**
   * set_wish_received(): marks (keeps the first moment) or un-marks. Never touches reservations: a giver keeps an
   * existing one and sees the wish as received; nobody can reserve it newly (reserveWish); un-marking restores it.
   */
  function setWishReceived(viewer: string, wishId: string | null, received: boolean | null): { ok: true; received_at: string | null } {
    requireUser(viewer)
    if (received === null) throw raise('validation')
    const wish = ownWish(viewer, wishId)
    wish.received_at = received ? (wish.received_at ?? stamp()) : null
    wish.updated_at = stamp()
    return { ok: true, received_at: wish.received_at }
  }

  /**
   * move_wish(): the owner of BOTH lists only (one not_found); the same list = nothing; widening needs consents.
   * The photo (keyed by the wish) and received_at go along. INV-1: a giver who can read the target keeps the
   * reservation (its list follows the wish), every other active one ends as 'wish_moved'. The answer is constant.
   */
  function moveWish(viewer: string, wishId: string | null, targetListId: string | null): { ok: true } {
    requireUser(viewer)
    const wish = ownWish(viewer, wishId)
    const source = wishlists.get(wish.wishlist_id)
    const target = targetListId === null ? undefined : wishlists.get(targetListId)
    if (!source || !target || target.owner_id !== viewer || target.recipient_id !== source.recipient_id) throw raise('not_found')
    if (target.id === source.id) return { ok: true }
    // 20261027200000: a wish in several lists does not move (remove it from a list instead)
    if (extrasOf(wish.id).length > 0) throw raise('validation')
    if (target.visibility !== 'private' && !hasConsents(viewer)) throw raise('consent_required')
    wish.wishlist_id = target.id
    wish.updated_at = stamp()
    for (const reservation of reservations) {
      if (reservation.wish_id !== wish.id || reservation.status !== 'active') continue
      if (canReadWishlist(target.id, reservation.reserver_id)) reservation.wishlist_id = target.id
      else endReservation(reservation, 'wish_moved')
    }
    return { ok: true }
  }

  // ---- REST: rows visible under each SELECT policy (live objects; the HTTP layer projects copies) ---

  const occasionRows = (viewer: string): OccasionRow[] =>
    [...occasions.values()].filter((occasion) => occasion.host_id === viewer || isActiveMember(occasion.id, viewer))
  // M2 occasion_members_select: an ACTIVE row of a blocked pair is hidden from each other (also in other people's
  // occasions); "left / removed" rows stay visible to the host as before (a block reads like leaving)
  const memberRows = (viewer: string): MemberRow[] =>
    members.filter((member) => member.profile_id === viewer
      || (isActiveMember(member.occasion_id, viewer)
        && ((member.status === 'active' && !follows.isBlockedPair(member.profile_id, viewer))
          || (member.status !== 'active' && isHost(member.occasion_id, viewer)))))
  const wishlistRows = (viewer: string): WishlistRow[] => [...wishlists.values()].filter((list) => canReadWishlist(list.id, viewer))
  // 20261027200000 wishes_select: the owner's short path, then any effective place
  const wishRows = (viewer: string): WishRow[] => [...wishes.values()].filter((wish) => isWishlistOwner(wish.wishlist_id, viewer) || canReadWish(wish, viewer))
  const inviteRows = (viewer: string): InviteRow[] => [...invites.values()].filter((invite) => isHost(invite.occasion_id, viewer))
  const profileRows = (viewer: string): { id: string; display_name: string | null }[] =>
    [...people.values()]
      // profiles_select (pilot): me + people of a shared active occasion, never a blocked pair
      .filter((person) => person.id === viewer || (sharesOccasion(person.id, viewer) && !follows.isBlockedPair(person.id, viewer)))
      .map((person) => ({ id: person.id, display_name: person.displayName() }))

  // ---- REST writes. Each validates every row first and only then commits (one SQL statement). ----

  function insertOccasions(viewer: string, inputs: readonly Input[], single: boolean): OccasionRow[] {
    if (single && inputs.length !== 1) throw notSingle()
    const staged: { row: OccasionRow; at: string }[] = []
    for (const input of inputs) {
      checkColumns(OCCASIONS, input, OCCASIONS.columns) // table-level INSERT grant
      const at = stamp()
      const values: Record<string, unknown> = {
        id: has(input, 'id') ? asUuid(input.id) : crypto.randomUUID(),
        host_id: has(input, 'host_id') ? asUuid(input.host_id) : null,
        title: has(input, 'title') ? asText(input.title) : null,
        starts_at: has(input, 'starts_at') ? asTimestamp(input.starts_at) : null,
        ends_at: has(input, 'ends_at') ? asTimestamp(input.ends_at) : null,
        tz: has(input, 'tz') ? asText(input.tz) : 'Europe/Berlin',
        all_day: has(input, 'all_day') ? asBoolean(input.all_day) : true,
        place_text: has(input, 'place_text') ? asText(input.place_text) : null,
        description: has(input, 'description') ? asText(input.description) : null,
        cancelled_at: has(input, 'cancelled_at') ? asTimestamp(input.cancelled_at) : null,
        created_at: has(input, 'created_at') ? asTimestamp(input.created_at) : at,
        updated_at: has(input, 'updated_at') ? asTimestamp(input.updated_at) : at,
        sections: has(input, 'sections') ? asText(input.sections) : 'wishes',
        // 20261027120000: "Gäste dürfen Freunde einladen" (default off)
        guests_can_invite: has(input, 'guests_can_invite') ? asBoolean(input.guests_can_invite) : false,
        // 20261027140000: the cover motif (default null: no motif)
        cover_theme: has(input, 'cover_theme') ? asText(input.cover_theme) : null,
        // 20261027190000: the point of the picked place (default none)
        place_lat: has(input, 'place_lat') ? asPoint5(input.place_lat) : null,
        place_lon: has(input, 'place_lon') ? asPoint5(input.place_lon) : null,
      }
      // BEFORE INSERT trigger occasion_guard: the zone must exist
      if (typeof values.tz === 'string' && !isValidTimeZone(values.tz)) throw raise('invalid_timezone')
      // RLS occasions_insert: host = me, display name set, current consents
      if (values.host_id !== viewer || !profileComplete(viewer) || !hasConsents(viewer)) throw policyViolation('occasions')
      requireColumns(values, ['id', 'host_id', 'title', 'starts_at', 'tz', 'all_day', 'created_at', 'updated_at'])
      const row = values as unknown as OccasionRow
      checkOccasion(row)
      if (occasions.has(row.id) || staged.some((other) => other.row.id === row.id)) throw uniqueViolation('occasions_pkey')
      staged.push({ row, at })
    }
    for (const { row, at } of staged) {
      occasions.set(row.id, row)
      // AFTER INSERT trigger occasion_after_insert: host membership (going) + THE wishlist (owner = recipient = host)
      members.push({ occasion_id: row.id, profile_id: row.host_id, role: 'host', rsvp: 'going', status: 'active', invited_via: null, joined_at: at, updated_at: at })
      const list: WishlistRow = {
        id: crypto.randomUUID(), occasion_id: row.id, owner_id: row.host_id, recipient_id: row.host_id, title: row.title, created_at: at, updated_at: at,
        visibility: 'occasion', cover_tone: null, cover_icon: null, due_on: null,
      }
      wishlists.set(list.id, list)
    }
    return staged.map(({ row }) => row)
  }

  function updateOccasions(viewer: string, targets: readonly OccasionRow[], patch: Input, single: boolean): OccasionRow[] {
    checkColumns(OCCASIONS, patch, OCCASION_UPDATE)
    const values = coerce(patch, {
      title: asText, starts_at: asTimestamp, ends_at: asTimestamp, tz: asText, all_day: asBoolean,
      place_text: asText, description: asText, cancelled_at: asTimestamp, sections: asText, guests_can_invite: asBoolean, cover_theme: asText,
      place_lat: asPoint5, place_lon: asPoint5,
    })
    const own = targets.filter((occasion) => occasion.host_id === viewer) // USING occasions_update
    if (single && own.length !== 1) throw notSingle()
    const next = own.map((occasion) => {
      const candidate: Record<string, unknown> = { ...occasion, ...values }
      // trigger occasion_place_point_reset (20261027190000): a new place text without a new point drops the old point
      if ((candidate.place_text ?? null) !== occasion.place_text &&
        (candidate.place_lat ?? null) === (occasion.place_lat ?? null) && (candidate.place_lon ?? null) === (occasion.place_lon ?? null)) {
        candidate.place_lat = null
        candidate.place_lon = null
      }
      requireColumns(candidate, ['title', 'starts_at', 'tz', 'all_day'])
      const row = candidate as unknown as OccasionRow
      if (!isValidTimeZone(row.tz)) throw raise('invalid_timezone') // occasion_guard
      checkOccasion(row)
      return row
    })
    const at = stamp()
    own.forEach((occasion, index) => {
      const before = occasion.sections
      Object.assign(occasion, next[index], { updated_at: at })
      // trigger occasions_potluck_off: switching the bring-along list off deletes its entries
      if (before !== 'wishes' && occasion.sections === 'wishes') removeWhere(potluck, (item) => item.occasion_id === occasion.id)
    })
    return own
  }

  function deleteOccasions(viewer: string, targets: readonly OccasionRow[], single: boolean): OccasionRow[] {
    const own = targets.filter((occasion) => occasion.host_id === viewer) // USING occasions_delete
    if (single && own.length !== 1) throw notSingle()
    for (const occasion of own) removeOccasion(occasion)
    return own
  }

  /** RSVP: the column grant is rsvp only; own active row only (occasion_members_update). */
  function updateMembers(viewer: string, targets: readonly MemberRow[], patch: Input, single: boolean): MemberRow[] {
    checkColumns(OCCASION_MEMBERS, patch, MEMBER_UPDATE)
    let rsvp: Rsvp | undefined
    if (has(patch, 'rsvp')) {
      const value = asText(patch.rsvp)
      if (value === null) throw notNullViolation('rsvp')
      if (!RSVPS.includes(value)) throw checkViolation('occasion_members_rsvp_check')
      rsvp = value as Rsvp
    }
    const own = targets.filter((member) => member.profile_id === viewer && member.status === 'active')
    if (single && own.length !== 1) throw notSingle()
    const at = stamp()
    for (const member of own) {
      if (rsvp !== undefined) member.rsvp = rsvp
      member.updated_at = at
    }
    return own
  }

  function insertWishes(viewer: string, inputs: readonly Input[], single: boolean): WishRow[] {
    if (single && inputs.length !== 1) throw notSingle()
    const staged: WishRow[] = []
    for (const input of inputs) {
      checkColumns(WISHES, input, WISHES.columns) // table-level INSERT grant
      const at = stamp()
      const values: Record<string, unknown> = {
        id: has(input, 'id') ? asUuid(input.id) : crypto.randomUUID(),
        wishlist_id: has(input, 'wishlist_id') ? asUuid(input.wishlist_id) : null,
        title: has(input, 'title') ? asText(input.title) : null,
        price_cents: has(input, 'price_cents') ? asInteger('integer')(input.price_cents) : null,
        currency: has(input, 'currency') ? asText(input.currency) : 'EUR',
        url: has(input, 'url') ? asText(input.url) : null,
        note: has(input, 'note') ? asText(input.note) : null,
        priority: has(input, 'priority') ? asInteger('smallint')(input.priority) : 2,
        created_at: has(input, 'created_at') ? asTimestamp(input.created_at) : at,
        updated_at: has(input, 'updated_at') ? asTimestamp(input.updated_at) : at,
        description: has(input, 'description') ? asText(input.description) : null,
        brand: has(input, 'brand') ? asText(input.brand) : null,
        color: has(input, 'color') ? asText(input.color) : null,
        gtin: has(input, 'gtin') ? asText(input.gtin) : null,
        shop_name: has(input, 'shop_name') ? asText(input.shop_name) : null,
        // the pilot's table-level INSERT grant covers it (a new wish may start as received; no reservation can exist)
        received_at: has(input, 'received_at') ? asTimestamp(input.received_at) : null,
        quantity: has(input, 'quantity') ? asInteger('smallint')(input.quantity) : 1,
      }
      // the trigger wish_quantity_guard: a value other than 1 only while the switch is on
      if (values.quantity !== 1 && !features.wishQuantity) throw raise('not_allowed')
      // RLS wishes_insert: only the list owner, with current consents
      const wishlistId = typeof values.wishlist_id === 'string' ? values.wishlist_id : null
      if (!isWishlistOwner(wishlistId, viewer) || !hasConsents(viewer)) throw policyViolation('wishes')
      requireColumns(values, ['id', 'wishlist_id', 'title', 'currency', 'priority', 'created_at', 'updated_at'])
      const row = values as unknown as WishRow
      checkWish(row)
      if (wishes.has(row.id) || staged.some((other) => other.id === row.id)) throw uniqueViolation('wishes_pkey')
      staged.push(row)
    }
    for (const row of staged) wishes.set(row.id, row)
    return staged
  }

  function updateWishes(viewer: string, targets: readonly WishRow[], patch: Input, single: boolean): WishRow[] {
    checkColumns(WISHES, patch, WISH_UPDATE)
    const values = coerce(patch, {
      title: asText, price_cents: asInteger('integer'), currency: asText, url: asText, note: asText, priority: asInteger('smallint'),
      description: asText, brand: asText, color: asText, gtin: asText, shop_name: asText, quantity: asInteger('smallint'),
    })
    const own = targets.filter((wish) => isWishlistOwner(wish.wishlist_id, viewer)) // USING wishes_update
    if (!features.wishQuantity && has(values, 'quantity') && own.some((wish) => values.quantity !== (wish.quantity ?? 1))) throw raise('not_allowed')
    if (single && own.length !== 1) throw notSingle()
    const next = own.map((wish) => {
      const candidate: Record<string, unknown> = { ...wish, ...values }
      requireColumns(candidate, ['title', 'currency', 'priority'])
      const row = candidate as unknown as WishRow
      checkWish(row)
      return row
    })
    // Only the owner's own edit bumps updated_at — reservations never touch a wish row.
    const at = stamp()
    own.forEach((wish, index) => Object.assign(wish, next[index], { updated_at: at }))
    return own
  }

  /** Hard delete (the "undo 5 s" lives in the client). Works the same with or without a reservation. */
  function deleteWishes(viewer: string, targets: readonly WishRow[], single: boolean): WishRow[] {
    const own = targets.filter((wish) => isWishlistOwner(wish.wishlist_id, viewer)) // USING wishes_delete
    if (single && own.length !== 1) throw notSingle()
    // 20261027200000 trigger wish_aa_shared_delete_guard: an older app cannot delete a wish that lives in several lists
    if (own.some((wish) => extrasOf(wish.id).length > 0)) throw raise('not_allowed')
    for (const wish of own) removeWish(wish)
    return own
  }

  function updateInvites(viewer: string, targets: readonly InviteRow[], patch: Input, single: boolean): InviteRow[] {
    checkColumns(INVITES, patch, INVITE_UPDATE)
    const revokedAt = has(patch, 'revoked_at') ? asTimestamp(patch.revoked_at) : undefined
    const own = targets.filter((invite) => isHost(invite.occasion_id, viewer)) // USING invites_update
    if (single && own.length !== 1) throw notSingle()
    if (revokedAt !== undefined) {
      // trigger invite_guard: a revocation is final
      if (own.some((invite) => invite.revoked_at !== null && invite.revoked_at !== revokedAt)) throw raise('not_allowed')
      for (const invite of own) invite.revoked_at = revokedAt
    }
    return own
  }

  function deleteInvites(viewer: string, targets: readonly InviteRow[], single: boolean): InviteRow[] {
    const own = targets.filter((invite) => isHost(invite.occasion_id, viewer)) // USING invites_delete
    if (single && own.length !== 1) throw notSingle()
    for (const invite of own) removeInvite(invite)
    return own
  }

  // ---- wave 2b: lists without an occasion through REST (M1/M3, follows-design §3.2, §4.4) -----------------

  /**
   * insert into wishlists: the column-level INSERT grant; the BEFORE INSERT trigger wishlist_limit (the 21st
   * own list without an occasion → limit_reached — counted only for the caller's OWN new list, so it is no
   * oracle about anyone else); RLS wishlists_insert (owner = recipient = me, name + consents; an occasion
   * list only by its host while it has none; a list without an occasion only 'private' | 'followers'); then
   * the CHECK constraints. The client sends its own id (optimistic card) and reads the row back (the owner's
   * short path in wishlists_select makes `insert … returning` work).
   */
  function insertWishlists(viewer: string, inputs: readonly Input[], single: boolean): WishlistRow[] {
    if (single && inputs.length !== 1) throw notSingle()
    const staged: WishlistRow[] = []
    for (const input of inputs) {
      checkColumns(WISHLISTS, input, WISHLIST_INSERT)
      const at = stamp()
      const values: Record<string, unknown> = {
        id: has(input, 'id') ? asUuid(input.id) : crypto.randomUUID(),
        occasion_id: has(input, 'occasion_id') ? asUuid(input.occasion_id) : null,
        owner_id: has(input, 'owner_id') ? asUuid(input.owner_id) : null,
        recipient_id: has(input, 'recipient_id') ? asUuid(input.recipient_id) : null,
        title: has(input, 'title') ? asText(input.title) : null,
        created_at: at,
        updated_at: at,
        // the column default of M1: a list without an occasion that leaves it out fails (no silent 'followers')
        visibility: has(input, 'visibility') ? asText(input.visibility) : 'occasion',
        cover_tone: has(input, 'cover_tone') ? asInteger('smallint')(input.cover_tone) : null,
        cover_icon: has(input, 'cover_icon') ? asText(input.cover_icon) : null,
        due_on: has(input, 'due_on') ? asDate(input.due_on) : null,
      }
      const occasionId = typeof values.occasion_id === 'string' ? values.occasion_id : null
      if (occasionId === null && values.owner_id === viewer) {
        const own = [...wishlists.values(), ...staged].filter((list) => list.owner_id === viewer && list.occasion_id === null).length
        if (own >= STANDALONE_LIST_LIMIT) throw raise('limit_reached')
      }
      const allowed = values.owner_id === viewer && values.recipient_id === viewer && profileComplete(viewer) && hasConsents(viewer)
        && ((occasionId !== null && values.visibility === 'occasion' && isHost(occasionId, viewer)
              && listsOf(occasionId).length === 0 && !staged.some((list) => list.occasion_id === occasionId))
            || (occasionId === null && (values.visibility === 'private' || values.visibility === 'followers')))
      if (!allowed) throw policyViolation('wishlists')
      requireColumns(values, ['id', 'owner_id', 'recipient_id', 'visibility'])
      const row = values as unknown as WishlistRow
      checkWishlist(row)
      if (wishlists.has(row.id) || staged.some((other) => other.id === row.id)) throw uniqueViolation('wishlists_pkey')
      staged.push(row)
    }
    for (const row of staged) wishlists.set(row.id, row)
    return staged
  }

  /** update wishlists: title, cover and date only (column grant); the owner's rows only (wishlists_update). */
  function updateWishlists(viewer: string, targets: readonly WishlistRow[], patch: Input, single: boolean): WishlistRow[] {
    checkColumns(WISHLISTS, patch, WISHLIST_UPDATE)
    const values = coerce(patch, { title: asText, cover_tone: asInteger('smallint'), cover_icon: asText, due_on: asDate })
    const own = targets.filter((list) => list.owner_id === viewer)
    if (single && own.length !== 1) throw notSingle()
    const next = own.map((list) => {
      const row = { ...list, ...values } as WishlistRow
      checkWishlist(row)
      return row
    })
    const at = stamp()
    own.forEach((list, index) => Object.assign(list, next[index], { updated_at: at }))
    return own
  }

  /**
   * delete from wishlists → cascade: its wishes (their trigger ends an active reservation as wish_deleted)
   * and `on delete set null` of reservations.wishlist_id — the same for the owner with or without them.
   */
  function removeList(list: WishlistRow): void {
    if (people.has(list.owner_id)) rehomeOutOf(list.id) // (an account deletion takes everything)
    for (const wish of wishesOf(list.id)) removeWish(wish)
    for (const reservation of reservations) if (reservation.wishlist_id === list.id) reservation.wishlist_id = null
    wishlists.delete(list.id)
  }

  function deleteWishlists(viewer: string, targets: readonly WishlistRow[], single: boolean): WishlistRow[] {
    const own = targets.filter((list) => list.owner_id === viewer) // USING wishlists_delete
    if (single && own.length !== 1) throw notSingle()
    for (const list of own) removeList(list)
    return own
  }

  /** private.end_follow_reservations: the follower's active reservations on the owner's lists without an occasion. */
  function endFollowReservations(followerId: string, ownerId: string, reason: ReservationEndReason): void {
    for (const reservation of reservations) {
      const list = reservation.wishlist_id === null ? undefined : wishlists.get(reservation.wishlist_id)
      if (reservation.reserver_id === followerId && reservation.status === 'active' && list?.owner_id === ownerId && list.occasion_id === null
        && !reservationIsLive(reservation)) {
        endReservation(reservation, reason)
      }
    }
  }

  /** private.end_list_reservations: every active reservation on one list. */
  function endListReservations(listId: string, reason: ReservationEndReason): void {
    for (const reservation of reservations) {
      if (reservation.wishlist_id === listId && reservation.status === 'active' && !reservationIsLive(reservation)) endReservation(reservation, reason)
    }
  }

  const profileSettingsOf = (profileId: string): ProfileSettings => profileSettings.get(profileId) ?? { banner: null, in_suggestions: false }

  /** The person's own REST write of profiles.banner / profiles.in_suggestions (validated by the caller). */
  function setProfileSettings(profileId: string, patch: Partial<ProfileSettings>): void {
    profileSettings.set(profileId, { ...profileSettingsOf(profileId), ...patch })
  }

  // ---- 20261027200000: shared wishes — the owner's RPCs (never a word about reservations) --------------------

  /** what a giver is told about a reservation (Q1): live -> null; their own reasons; everything else 'unavailable' */
  function publicEndReason(reservation: ReservationRow, live: boolean): ReservationEndReason | null {
    if (live) return null
    if (reservation.status === 'ended' && (reservation.end_reason === 'by_reserver' || reservation.end_reason === 'member_left' || reservation.end_reason === 'unfollowed')) {
      return reservation.end_reason
    }
    return 'unavailable'
  }

  /** the owner's place keys of a wish in a list (home, paused, also_in) */
  function ownerPlaceFields(wish: WishRow, listId: string) {
    return { home: wish.wishlist_id === listId, paused: wish.wishlist_id !== listId && !features.sharedWishesVisible, also_in: placesForOwner(wish, listId) }
  }

  function receivedPromptDue(occasion: OccasionRow, listId: string): boolean {
    const end = occasion.ends_at !== null ? Date.parse(occasion.ends_at) : endOfLocalDay(Date.parse(occasion.starts_at), occasion.tz)
    const now = clock()
    return now >= end + DAY && now < end + 7 * DAY && !dismissedPrompts.has(occasion.id)
      && listWishes(listId, true).some((wish) => !wish.received_at)
  }

  // ---- 20261030120000 "Passt zusammen": undirected links between two wishes of ONE owner (stored once) ----------
  const wishLinks = new Set<string>()
  const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  function linkedIdsOf(wishId: string): string[] {
    return [...wishLinks].flatMap((key) => {
      const [a, b] = key.split('|') as [string, string]
      return a === wishId ? [b] : b === wishId ? [a] : []
    })
  }
  const linkedRows = (wishId: string) => linkedIdsOf(wishId).flatMap((id) => {
    const row = wishes.get(id)
    return row ? [row] : []
  }).sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
  /** OWNER: every linked wish of hers ({ id, title }); null while the switch is off. Never a reservation. */
  function togetherForOwner(wish: WishRow, viewer: string): { id: string; title: string }[] | null {
    if (!features.wishTogether) return null
    return linkedRows(wish.id).filter((other) => isWishlistOwner(other.wishlist_id, viewer)).map((other) => ({ id: other.id, title: other.title }))
  }
  /** AUDIENCE: only linked wishes the viewer reads, still open; each with its own live flags. */
  function togetherForViewer(wish: WishRow, viewer: string): { id: string; title: string; reserved: boolean; reserved_by_me: boolean }[] | null {
    if (!features.wishTogether) return null
    return linkedRows(wish.id).filter((other) => !other.received_at && canReadWish(other, viewer)).map((other) => {
      const held = liveReservation(other.id)
      return { id: other.id, title: other.title, reserved: held !== undefined, reserved_by_me: held?.reserver_id === viewer }
    })
  }
  function parseIdArray(raw: string | null, max: number): string[] {
    let ids: unknown
    try {
      ids = raw === null ? null : JSON.parse(raw)
    } catch {
      throw raise('validation')
    }
    if (!Array.isArray(ids) || ids.length > max || !ids.every((id) => typeof id === 'string' && UUID.test(id))) throw raise('validation')
    return [...new Set((ids as string[]).map((id) => id.toLowerCase()))].sort()
  }
  /** set_wish_links(p_wish_id, p_linked_ids) -> { ok, linked } — the owner replaces the partners of one wish */
  function setWishLinks(viewer: string, wishId: string | null, rawIds: string | null): { ok: true; linked: number } {
    requireUser(viewer)
    const ids = parseIdArray(rawIds, 10)
    if (wishId === null || ids.includes(wishId)) throw raise('validation')
    if (!features.wishTogether) throw raise('not_allowed')
    const wish = wishes.get(wishId)
    const home = wish ? wishlists.get(wish.wishlist_id) : undefined
    if (!wish || !home || home.owner_id !== viewer) throw raise('not_found')
    for (const id of ids) {
      const other = wishes.get(id)
      const list = other ? wishlists.get(other.wishlist_id) : undefined
      if (!other || !list || list.owner_id !== viewer || list.recipient_id !== home.recipient_id) throw raise('not_found')
    }
    const before = new Set(wishLinks)
    for (const key of wishLinks) if (key.split('|').includes(wishId)) wishLinks.delete(key)
    for (const id of ids) wishLinks.add(linkKey(wishId, id))
    if (ids.some((id) => linkedIdsOf(id).length > 10)) {
      wishLinks.clear()
      for (const key of before) wishLinks.add(key)
      throw raise('limit_reached')
    }
    return { ok: true, linked: ids.length }
  }
  /**
   * reserve_together(p_wish_id, p_with_ids) -> { ok, reserved } — the giver reserves the wish and its linked wishes
   * through reserveWish itself; the first refusal undoes every change of this call (all or nothing, one transaction).
   */
  function reserveTogether(viewer: string, wishId: string | null, rawIds: string | null): { ok: true; reserved: number } {
    requireUser(viewer)
    if (!features.wishTogether) throw raise('not_allowed')
    const ids = parseIdArray(rawIds, 10).filter((id) => id !== wishId)
    if (wishId === null || ids.length === 0) throw raise('validation')
    const wish = wishes.get(wishId)
    if (!wish) throw raise('not_found')
    const list = wishlists.get(wish.wishlist_id)
    if (!list || viewer === list.owner_id || viewer === list.recipient_id) throw raise('not_allowed') // before anything else
    if (!canReadWish(wish, viewer)) throw raise('not_allowed')
    if (ids.some((id) => {
      const other = wishes.get(id)
      return !other || !canReadWish(other, viewer)
    })) throw raise('not_found')
    const partners = linkedIdsOf(wishId)
    if (ids.some((id) => !partners.includes(id))) throw raise('validation')
    const saved = reservations.map((row) => ({ ...row }))
    try {
      for (const id of [wishId, ...ids]) reserveWish(viewer, id)
    } catch (err) {
      reservations.splice(0, reservations.length, ...saved) // the rollback
      throw err
    }
    return { ok: true, reserved: ids.length + 1 }
  }
  /** seed: a link between two wishes (the demo's pairs) */
  function seedLink(a: string, b: string): void {
    wishLinks.add(linkKey(a, b))
  }

  /** add_wishes_to_list(p_list_id, p_wish_ids) -> { ok, added } */
  function addWishesToList(viewer: string, listId: string | null, rawIds: string | null): { ok: true; added: number } {
    requireUser(viewer)
    let ids: unknown
    try {
      ids = rawIds === null ? null : JSON.parse(rawIds)
    } catch {
      throw raise('validation')
    }
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) throw raise('validation')
    if (!features.sharedWishes) throw raise('not_allowed')
    const target = listId === null ? undefined : wishlists.get(listId)
    if (!target || target.owner_id !== viewer || target.occasion_id === null) throw raise('not_found')
    if (!hasConsents(viewer)) throw raise('consent_required')
    const unique = [...new Set((ids as string[]).map((id) => id.toLowerCase()))].sort()
    const rows = unique.map((id) => wishes.get(id))
    if (rows.some((wish) => !wish || !isWishlistOwner(wish.wishlist_id, viewer))) throw raise('not_found')
    // checks first, then the writes (one statement)
    const toAdd: WishRow[] = []
    for (const wish of rows as WishRow[]) {
      if (storedListsOf(wish).includes(target.id)) continue // "Schon drin"
      const home = wishlists.get(wish.wishlist_id)
      if (!home || home.occasion_id !== null || wish.received_at || home.recipient_id !== target.recipient_id) throw raise('validation')
      if (storedListsOf(wish).length >= 10) throw raise('limit_reached')
      toAdd.push(wish)
    }
    for (const wish of toAdd) extraPlaces.set(wish.id, [...extrasOf(wish.id), { listId: target.id, addedAt: stamp() }])
    return { ok: true, added: toAdd.length }
  }

  /** remove_wish_from_list(p_wish_id, p_list_id) -> { ok }: its only list -> validation */
  function removeWishFromList(viewer: string, wishId: string | null, listId: string | null): { ok: true } {
    requireUser(viewer)
    const wish = ownWish(viewer, wishId)
    if (listId === null || !storedListsOf(wish).includes(listId)) throw raise('not_found')
    const extras = extrasOf(wish.id)
    if (extras.length === 0) throw raise('validation')
    if (wish.wishlist_id === listId) {
      const [next, ...rest] = extras
      wish.wishlist_id = next!.listId
      extraPlaces.set(wish.id, rest)
    } else {
      extraPlaces.set(wish.id, extras.filter((place) => place.listId !== listId))
    }
    return { ok: true }
  }

  /** delete_wish_everywhere(p_wish_id) -> { ok } */
  function deleteWishEverywhere(viewer: string, wishId: string | null): { ok: true } {
    requireUser(viewer)
    removeWish(ownWish(viewer, wishId))
    return { ok: true }
  }

  /** dismiss_received_prompt(p_occasion_id) -> { ok } */
  function dismissReceivedPrompt(viewer: string, occasionId: string | null): { ok: true } {
    requireUser(viewer)
    if (occasionId === null || !listsOf(occasionId).some((list) => list.owner_id === viewer)) throw raise('not_found')
    dismissedPrompts.add(occasionId)
    return { ok: true }
  }

  /** seeding (service role): put a wish into another list of its owner as well */
  function seedPlacement(wishId: string, listId: string, addedAt: string): void {
    if (!wishes.has(wishId) || !wishlists.has(listId)) return
    extraPlaces.set(wishId, [...extrasOf(wishId), { listId, addedAt }])
  }

  // ---- account lifecycle, export, seeding (service role) ---------------------------------------

  function addPerson(person: DemoPerson): void {
    people.set(person.id, person)
  }

  /**
   * delete_my_account(): own reservations and those on own wishes vanish; hosted occasions and own lists
   * cascade; so do follows, silences, follow links and blocks (wave 2b) and the profile settings.
   */
  function deletePerson(profileId: string): void {
    removeWhere(reservations, (r) => r.reserver_id === profileId || r.recipient_id === profileId)
    for (const occasion of occasions.values()) if (occasion.host_id === profileId) removeOccasion(occasion)
    for (const list of wishlists.values()) if (list.owner_id === profileId) removeList(list)
    removeWhere(members, (member) => member.profile_id === profileId)
    // potluck_items: created_by on delete cascade, claimed_by on delete set null
    removeWhere(potluck, (item) => item.created_by === profileId)
    for (const item of potluck) if (item.claimed_by === profileId) item.claimed_by = null
    for (const invite of invites.values()) if (invite.created_by === profileId) removeInvite(invite)
    follows.removePerson(profileId)
    profileSettings.delete(profileId)
    people.delete(profileId)
  }

  /** Adds an active guest (like an earlier invitation). Never re-adds someone who left or was removed. */
  function addGuest(occasionId: string, profileId: string): boolean {
    if (!occasions.has(occasionId) || !people.has(profileId) || membership(occasionId, profileId)) return false
    const at = stamp()
    members.push({ occasion_id: occasionId, profile_id: profileId, role: 'member', rsvp: 'none', status: 'active', invited_via: null, joined_at: at, updated_at: at })
    return true
  }

  /** export_my_data() as SECURITY INVOKER sees it: own rows, RLS-visible names, never reservations on own wishes. */
  function exportFor(viewer: string): DemoExportParts {
    const occasionVisible = (occasionId: string): boolean => isHost(occasionId, viewer) || isActiveMember(occasionId, viewer)
    // the invoker export reads profiles under profiles_select: a blocked pair's name is not readable (null)
    const profileVisible = (profileId: string): boolean =>
      profileId === viewer || (sharesOccasion(profileId, viewer) && !follows.isBlockedPair(profileId, viewer))
    return {
      occasions_hosted: [...occasions.values()]
        .filter((occasion) => occasion.host_id === viewer)
        .sort((a, b) => byText(a.starts_at, b.starts_at) || byText(a.id, b.id))
        .map((occasion) => ({
          id: occasion.id, host_id: occasion.host_id, title: occasion.title, starts_at: occasion.starts_at, ends_at: occasion.ends_at,
          tz: occasion.tz, all_day: occasion.all_day, place_text: occasion.place_text, description: occasion.description,
          cancelled_at: occasion.cancelled_at, created_at: occasion.created_at, updated_at: occasion.updated_at,
          // never the token (the database has only its hash, and not even that is exported)
          invites: [...invites.values()]
            .filter((invite) => invite.occasion_id === occasion.id)
            .sort((a, b) => byText(a.created_at, b.created_at))
            .map((invite) => ({ id: invite.id, expires_at: invite.expires_at, max_uses: invite.max_uses, use_count: invite.use_count, revoked_at: invite.revoked_at, created_at: invite.created_at })),
          members: members
            .filter((member) => member.occasion_id === occasion.id)
            .sort((a, b) => byText(a.joined_at, b.joined_at))
            .map((member) => ({
              display_name: profileVisible(member.profile_id) ? nameOf(member.profile_id) : null,
              role: member.role, rsvp: member.rsvp, status: member.status, joined_at: member.joined_at,
            })),
        })),
      memberships: members
        .filter((member) => member.profile_id === viewer && member.role === 'member')
        .sort((a, b) => byText(a.joined_at, b.joined_at) || byText(a.occasion_id, b.occasion_id))
        .map((member) => {
          const occasion = occasionVisible(member.occasion_id) ? occasions.get(member.occasion_id) : undefined
          return {
            occasion_id: member.occasion_id, occasion_title: occasion?.title ?? null, starts_at: occasion?.starts_at ?? null,
            role: member.role, rsvp: member.rsvp, status: member.status, joined_at: member.joined_at,
          }
        }),
      wishlists: [...wishlists.values()]
        .filter((list) => list.owner_id === viewer && canReadWishlist(list.id, viewer))
        .sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
        .map((list) => ({
          id: list.id, occasion_id: list.occasion_id, owner_id: list.owner_id, recipient_id: list.recipient_id, title: list.title,
          created_at: list.created_at, updated_at: list.updated_at,
          // wave 2b (M1 export): who sees it, its cover and date; 20261022160000: the cover photo's meta
          visibility: list.visibility, cover_tone: list.cover_tone, cover_icon: list.cover_icon, due_on: list.due_on,
          photo: listPhotoMeta(list.id),
          wishes: wishesOf(list.id).sort(wishOrder).map((wish) => ({
            id: wish.id, wishlist_id: wish.wishlist_id, title: wish.title, price_cents: wish.price_cents, currency: wish.currency,
            url: wish.url, note: wish.note, priority: wish.priority, created_at: wish.created_at, updated_at: wish.updated_at,
            ...wishDetails(wish),
            // 20261027200000: every stored place with its time (the home: the wish's own time)
            places: storedListsOf(wish).map((id) => ({ wishlist_id: id, added_at: id === wish.wishlist_id ? wish.created_at : (extrasOf(wish.id).find((place) => place.listId === id)?.addedAt ?? null), home: id === wish.wishlist_id })),
            // 20261030120000: the ids of the linked wishes
            together: linkedIdsOf(wish.id).sort(),
          })),
        })),
      // only as the reserver; live titles/names only while still a member, otherwise the snapshot and null
      reservations_made_by_me: reservations
        .filter((r) => r.reserver_id === viewer)
        .sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
        .map((r) => {
          // 20261027200000: context only while LIVE; every other row with its public reason (Q1)
          const live = reservationIsLive(r)
          const wish = live && r.wish_id !== null ? wishes.get(r.wish_id) : undefined
          const list = wish ? reservationPlace(wish, viewer) : undefined
          const occasion = list?.occasion_id ? occasions.get(list.occasion_id) : undefined
          return {
            wish_title: wish?.title ?? r.wish_title_snapshot, recipient_name: list ? nameOf(r.recipient_id) : null,
            occasion_title: occasion?.title ?? null, status: live ? 'active' : 'ended', end_reason: publicEndReason(r, live), created_at: r.created_at, ended_at: r.ended_at,
            // M3: the list without an occasion, only while it is readable (else null and the snapshot)
            list: list && list.occasion_id === null ? { id: list.id, title: list.title, owner_name: nameOf(list.owner_id) } : null,
          }
        }),
    }
  }

  function seed(data: DemoSeed): void {
    for (const person of data.people) people.set(person.id, person)
    for (const row of data.occasions) occasions.set(row.id, { ...row, sections: row.sections ?? 'wishes', guests_can_invite: row.guests_can_invite ?? false, cover_theme: row.cover_theme ?? null, place_lat: row.place_lat ?? null, place_lon: row.place_lon ?? null })
    members.push(...data.members.map((row) => ({ ...row })))
    for (const row of data.wishlists) {
      wishlists.set(row.id, {
        ...row,
        visibility: row.visibility ?? (row.occasion_id === null ? 'private' : 'occasion'),
        cover_tone: row.cover_tone ?? null,
        cover_icon: row.cover_icon ?? null,
        due_on: row.due_on ?? null,
      })
    }
    for (const row of data.wishes) wishes.set(row.id, { ...NO_WISH_DETAILS, ...row })
    for (const { row, token } of data.invites) {
      invites.set(row.id, { ...row })
      inviteIdByToken.set(token, row.id)
    }
    reservations.push(...data.reservations.map((row) => ({ ...row })))
    potluck.push(...(data.potluck ?? []).map((row) => ({ ...row })))
  }

  return {
    // RPCs
    getFeed, getOccasionScreen, createInvite, acceptInvite, reserveWish, cancelReservation, myReservations, leaveOccasion, removeMember,
    // 20261025150000: the bring-along list
    addPotluckItem, renamePotluckItem, deletePotluckItem, claimPotluckItem, unclaimPotluckItem, exportMyPotluck,
    // REST
    occasionRows, memberRows, wishlistRows, wishRows, inviteRows, profileRows,
    insertOccasions, updateOccasions, deleteOccasions, updateMembers, insertWishes, updateWishes, deleteWishes, updateInvites, deleteInvites,
    // service role
    addPerson, deletePerson, addGuest, exportFor, seed,
    // the cover photos' meta for get_occasion_screen (src/mocks/photos.ts)
    setPhotoMetaSource(source: (occasionId: string) => OccasionPhotoMeta | null): void {
      photoMetaOf = source
    },
    // the wish photos' meta for every wish answer (src/mocks/wishPhotos.ts)
    setWishPhotoMetaSource(source: (wishId: string) => WishPhotoMeta | null): void {
      wishPhotoMetaOf = source
    },
    // the list covers' meta for every answer that carries a list (src/mocks/listPhotos.ts)
    setListPhotoMetaSource(source: (listId: string) => ListPhotoMeta | null): void {
      listPhotoMetaOf = source
    },
    // the own profile / banner photos' meta for every answer that shows a person (src/mocks/profilePhotos.ts)
    setProfilePhotoSource(source: ProfilePhotoSource): void {
      profilePhotoSource = source
    },
    // 20261022160000: "Erhalten" and moving a wish
    setWishReceived, moveWish, splitReceived,
    // 20261027200000: one wish in several lists
    addWishesToList, removeWishFromList, deleteWishEverywhere, dismissReceivedPrompt, seedPlacement,
    // 20261030120000: "Passt zusammen"
    setWishLinks, reserveTogether, seedLink,
    // wave 2b (follows-design M1–M3): REST of lists without an occasion, the follow graph, the red button,
    // the profile settings — and what mocks/lists.ts builds the list RPCs from (service role, live objects)
    insertWishlists, updateWishlists, deleteWishlists,
    follows, features, profileSettingsOf, setProfileSettings,
    internals: {
      people, occasions, members, wishlists, wishes, reservations,
      clock, stamp, requireUser, hasConsents, profileComplete, nameOf, isActiveMember, isHost, sharesOccasion, canReadWishlist,
      listsOf, wishesOf, activeMembers, activeReservation, wishOrder, endReservation, endFollowReservations, endListReservations,
      // 20261027200000: places and liveness, for mocks/lists.ts and mocks/follows.ts
      listWishes, canReadWish, reservationIsLive, liveReservation, ownerPlaceFields, readsWishViaOccasion, storedListsOf, effectiveListsOf, publicEndReason,
      isWishlistOwner, wishDetails, listPhotoMeta, profilePhotoFields, ownProfilePhotos,
      // 20261030120000: the screens' together (mocks/lists.ts)
      togetherForOwner, togetherForViewer,
      // the trigger occasion_members_potluck_release, for the block in mocks/follows.ts
      releasePotluck,
    },
  }
}
