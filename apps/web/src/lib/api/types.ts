import type { Json, Tables } from '../database.types'

// App-level types: narrow unions and the JSON shapes returned by the screen RPCs
// (supabase/migrations/20261019120200_pilot_rpc.sql, docs/spec/pilot-decisions.md §2–§3).
// database.types.ts stays generator-shaped (text → string); this file is what feature code uses.

export type Locale = 'de' | 'en'
export type MemberRole = 'host' | 'member'
export type Rsvp = 'none' | 'going' | 'maybe' | 'declined'
export type MemberStatus = 'active' | 'left' | 'removed'
export type ConsentKind = 'terms' | 'privacy_notice' | 'age_18plus'
export type ReservationStatus = 'active' | 'ended'
export type ReservationEndReason =
  | 'by_reserver' | 'member_removed' | 'member_left' | 'blocked' | 'wish_deleted'
  // wave 2 (follows-design M2): the list is not readable for the giver any more / the giver unfollowed
  | 'access_ended' | 'unfollowed'
  // 20261022160000: the owner moved the wish to a list the giver cannot read (the giver keeps only the snapshot)
  | 'wish_moved'
  // 20261027200000 (shared wishes, lazy liveness): the ONE neutral reason for every reservation that is no longer on a
  // list the giver sees — access lost, wish gone, moved, blocked (design Q1)
  | 'unavailable'
export type ReportTargetKind = 'profile' | 'occasion' | 'wish'
/** 3 = "Unbedingt", 2 = "Gern" (default), 1 = "Kann" */
export type WishPriority = 1 | 2 | 3
/** display order of the priority chips */
export const WISH_PRIORITIES: readonly WishPriority[] = [3, 2, 1]

/** banner + in_suggestions are writable but never REST-readable (wave 2b M1/M3); get_me carries them. */
// invitations_from (20261027120000): served by get_me (Me.profile), not part of this row type
export type Profile = Omit<Tables<'profiles'>, 'locale' | 'banner' | 'in_suggestions' | 'invitations_from'> & { locale: Locale }
export type LegalVersion = Omit<Tables<'legal_versions'>, 'kind'> & { kind: ConsentKind }
export type Consent = Omit<Tables<'consents'>, 'kind' | 'locale'> & { kind: ConsentKind; locale: Locale }
/**
 * sections / cover_theme / place_lat / place_lon are not in OCCASION_COLUMNS: the screens read them from
 * get_occasion_screen / get_feed (20261025150000, 20261027140000, 20261027190000); guests_can_invite comes from
 * get_occasion_invite_info (lib/api/invitations.ts, 20261027120000).
 */
export type Occasion = Omit<Tables<'occasions'>, 'sections' | 'cover_theme' | 'place_lat' | 'place_lon' | 'guests_can_invite'>
/** The detail columns of wishes (20261022120000_wish_details.sql). */
export type WishDetailColumn = 'description' | 'brand' | 'color' | 'gtin' | 'shop_name'
/**
 * A wish as REST serves it — without updated_at (not REST-readable since wave 2b M1, P9; the export has it).
 * The details are optional in the type (hand-built fixtures, older servers); lib/api/wishes.ts always fills them.
 */
export type Wish = Omit<Tables<'wishes'>, 'priority' | 'updated_at' | WishDetailColumn | 'received_at' | 'quantity'> & { priority: WishPriority }
  & Partial<Pick<Tables<'wishes'>, WishDetailColumn | 'received_at' | 'quantity'>>
/** A list row as REST serves it: occasion_id is null for a list without an occasion (M1); no updated_at (P9). */
export type Wishlist = Omit<Tables<'wishlists'>, 'occasion_id' | 'updated_at'> & { occasion_id: string | null }
/** getWish(): the wish plus the readable columns of its list that the edit form needs (owner, occasion). */
export type WishWithList = Wish & { wishlist: Pick<Wishlist, 'id' | 'occasion_id' | 'owner_id'> }
/** The columns a host may read about an invite (token_hash is never readable). */
export type InviteMeta = Omit<Tables<'invites'>, 'token_hash'>

// ---- get_me() --------------------------------------------------------------------------------

export interface Me {
  profile: {
    id: string
    display_name: string | null
    locale: Locale
    onboarding_done_at: string | null
    /** wave 2b (M1): the banner key (follows-design §2.2); absent before the wave-2 migrations */
    banner?: string | null
    /** wave 2b (M3): "In Vorschlägen aus Anlässen erscheinen" — the own value (no REST SELECT grant) */
    in_suggestions?: boolean
    /**
     * 20261024120000: the own profile photo / banner photo meta (null = none). ABSENT (undefined) from a server
     * without the migration: the UI then offers no photo choice ("Das geht bald").
     */
    photo?: ProfilePhotoMeta | null
    banner_photo?: ProfilePhotoMeta | null
    /** 20261027120000: "Einladungen in Anlässe" (the own value, no REST SELECT); absent before that migration */
    invitations_from?: 'friends' | 'nobody'
  }
  /** Current terms/age declarations and privacy notice version are recorded. */
  consents_ok: boolean
  /** current versions from legal_versions (null only while the seed is missing) */
  legal_versions: { terms: string | null; privacy: string | null; age: string | null }
  /** wave 2b (M2): requests VISIBLE to me (the dot on the "Listen" tab); absent before the wave-2 migrations */
  inbox?: {
    follow_requests: number
    /** 20261027120000: in-app invitations to occasions VISIBLE to me (the dot on "Start"); absent before that migration */
    occasion_invites?: number
  }
}

// ---- inputs ------------------------------------------------------------------------------------

export interface OccasionInput {
  /** optional client-generated uuid v4 (newOccasionId()) for an instant transition to the screen */
  id?: string
  title: string
  /** UTC instant (ISO); build it with zonedWallTimeToIso() from the form's date/time + tz */
  starts_at: string
  /**
   * 20261026180000: the end of a timed occasion (lib/occasionTime.ts endsAtFor), null = none (always null when all-day).
   * Left out = not touched (an edit of an occasion whose screen came from a server without the key).
   */
  ends_at?: string | null
  /** IANA zone of the occasion, e.g. 'Europe/Berlin' */
  tz: string
  /** default true (pilot-decisions §7) */
  all_day: boolean
  place_text?: string | null
  /**
   * 20261027190000: where the picked place is (5 decimals), both or neither. Sent only when the place was picked WITH a
   * point (the place search sends points only while the Worker's map switch is on) or the screen already carried one;
   * left out, the database keeps the stored point while place_text stays the same and drops it when the text changes.
   */
  place_lat?: number | null
  place_lon?: number | null
  description?: string | null
  /** 20261025150000: sent only when the bring-along list is switched on (features/potluck/flag.ts) */
  sections?: OccasionSections
  /**
   * 20261027140000: the cover motif — a key of features/occasions/covers/themes.ts THEME_IDS, 'none' (switched off) or
   * null (automatic found nothing). Sent only behind VITE_COVERS (features/occasions/covers/flag.ts): an older
   * database has no such column.
   */
  cover_theme?: string | null
}

export interface WishInput {
  title: string
  price_cents?: number | null
  /** pilot: always 'EUR' */
  currency?: string
  url?: string | null
  note?: string | null
  /** default 2 */
  priority?: WishPriority
  // the wish details (20261022120000): usually from the link preview, editable by the owner; '' / blank → null
  /** ≤ 1000 characters */
  description?: string | null
  /** ≤ 80 characters */
  brand?: string | null
  /** colour / variant, ≤ 60 characters */
  color?: string | null
  /** GTIN / EAN, 8 … 14 digits (anything else is dropped to null by the wrapper) */
  gtin?: string | null
  /** the shop's display name, e.g. "Zalando" (≤ 80 characters) */
  shop_name?: string | null
  /**
   * 20261030120000 "Anzahl": how many pieces, 1..10 (default 1). Sent only behind VITE_WISH_QUANTITY
   * (lib/api/wishExtras.ts wishQuantityEnabled): an older database has no such column.
   */
  quantity?: number
}

// ---- wish details + photo (20261022120000_wish_details.sql) -------------------------------------------

/**
 * The photo's meta in every RPC that returns wishes: the bytes come lazily from get_wish_photo()
 * (lib/api/wishPhotos.ts); `updated_at` is the version (cache key of the bytes). Same shape as OccasionPhotoMeta.
 */
export interface WishPhotoMeta {
  width: number
  height: number
  updated_at: string
}

/** The detail keys every wish answer carries since 20261022120000 (missing from an older server). */
export interface WishDetails {
  description: string | null
  brand: string | null
  color: string | null
  /** readable by everybody who can read the wish: the client builds "compare in other shops" search links */
  gtin: string | null
  shop_name: string | null
  /** null without a photo */
  photo: WishPhotoMeta | null
  /**
   * 20261022160000: when the owner marked the wish as received ("Erhalten"), null = open. The screens list received
   * wishes in their own `received` array (never in `wishes`); set only by the owner (setWishReceived).
   */
  received_at: string | null
  /** 20261030120000: how many pieces (1..10); one reservation covers all of them. Missing from an older server (= 1). */
  quantity: number
}

const WISH_DETAIL_KEYS = ['description', 'brand', 'color', 'gtin', 'shop_name', 'photo', 'received_at', 'quantity'] as const

/** Copies the detail keys that are present (an older server sends none: the result is then {}). */
export function pickWishDetails(wish: Partial<WishDetails>): Partial<WishDetails> {
  return Object.fromEntries(WISH_DETAIL_KEYS.filter((key) => wish[key] !== undefined).map((key) => [key, wish[key]])) as Partial<WishDetails>
}

// ---- get_feed() --------------------------------------------------------------------------------

export interface FeedOccasion {
  id: string
  title: string
  starts_at: string
  /**
   * 20261026180000: the end of a timed occasion, null without one. Optional: an older server (and a feed persisted
   * before the migration) has no key — then no end is shown (lib/occasionTime.ts shownEnd).
   */
  ends_at?: string | null
  tz: string
  all_day: boolean
  place_text: string | null
  /** my role in this occasion */
  role: MemberRole
  rsvp: Rsvp
  host_name: string | null
  /** Additive feed identity; optional while hosted databases await the migration. */
  host_id?: string
  /** active members including the host */
  member_count: number
  wish_count: number
  /** my active reservations in this occasion; ALWAYS null for the host (key always present) */
  my_reservation_count: number | null
  /**
   * 20261025130000: the cover's meta (the bytes: get_occasion_photo, loaded lazily by the Start card), null without
   * one. Optional: an older server and the optimistic rows of a new occasion have none (= no cover).
   */
  photo?: OccasionPhotoMeta | null
  /**
   * 20261025150000: what the occasion offers (wishes | bring | both). Optional: an older server and the optimistic rows
   * of a new occasion have none (= wishes).
   */
  sections?: OccasionSections
  /**
   * 20261027140000: the cover motif shown without a photo — RAW: read it through features/occasions/covers/themes.ts
   * shownCover() (a known key, else nothing: null, 'none', an unknown key and a missing key from an older server).
   */
  cover_theme?: string | null
}

export interface FeedScreen {
  /** sorted ascending by start */
  upcoming: FeedOccasion[]
  /** ended within the last 30 days, sorted descending */
  past: FeedOccasion[]
}

// ---- get_occasion_screen(p_occasion_id) ----------------------------------------------------------

export interface OccasionScreenWish {
  id: string
  title: string
  url: string | null
  price_cents: number | null
  currency: string
  note: string | null
  priority: WishPriority
  created_at: string
  /** null for the list owner (the RPC never looks at reservations for them) */
  reserved: boolean | null
  /** null for the list owner */
  reserved_by_me: boolean | null
  // the details (20261022120000): optional, because an older server and hand-built fixtures have none
  description?: string | null
  brand?: string | null
  color?: string | null
  gtin?: string | null
  shop_name?: string | null
  /** the photo's meta, null without one (the bytes: getWishPhoto) */
  photo?: WishPhotoMeta | null
  /** 20261022160000: null = open; set = received (then the wish is in `received`, not in `wishes`) */
  received_at?: string | null
  /** 20261027200000 (shared wishes): OWNER only — this list is the wish's home. Missing from an older server / for guests. */
  home?: boolean
  /** OWNER only: an extra place while the database's emergency switch hides extra places ("Vorübergehend ausgeblendet") */
  paused?: boolean
  /**
   * 20261027200000: the wish's OTHER lists. Owner: every list (with home / paused); a guest of an occasion: the lists they
   * can read by name plus at most one `{ kind: 'hidden' }` ("auch in einer anderen Liste"); a follower: null. Never
   * about reservations. Missing from an older server.
   */
  also_in?: WishPlaceRef[] | null
  /** 20261030120000: how many pieces (1..10); missing from an older server (= 1) */
  quantity?: number
  /**
   * 20261030120000 "Passt zusammen": the wishes linked to this one. Owner: every linked wish ({ id, title }); audience:
   * ONLY the linked wishes this viewer can read and that are still open, each with its own reserved / reserved_by_me.
   * null while the database switch is off; missing from an older server.
   */
  together?: WishLinkRaw[] | null
}

/** One linked wish as the screens send it (the flags only in the audience's answer). */
export interface WishLinkRaw {
  id: string
  title: string
  reserved?: boolean
  reserved_by_me?: boolean
}
/** A linked wish as the OWNER keeps it: never a reservation field. */
export interface WishLinkRef {
  id: string
  title: string
}
/** A linked wish as a GUEST sees it. */
export interface GuestWishLink extends WishLinkRef {
  reserved: boolean
  reserved_by_me: boolean
}

function linkEntries(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw)) return null
  return (raw as unknown[]).filter((e): e is Record<string, unknown> =>
    typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).id === 'string' && typeof (e as Record<string, unknown>).title === 'string')
}

/** together for the owner: id + title only (whatever else came, it is dropped). */
export function asOwnerLinks(raw: unknown): WishLinkRef[] | null {
  return linkEntries(raw)?.map((e) => ({ id: e.id as string, title: e.title as string })) ?? null
}

/** together for a guest: id + title + the flags (missing flags = free). */
export function asGuestLinks(raw: unknown): GuestWishLink[] | null {
  return linkEntries(raw)?.map((e) => ({ id: e.id as string, title: e.title as string, reserved: e.reserved === true, reserved_by_me: e.reserved_by_me === true })) ?? null
}

/** One other list of a wish (also_in, 20261027200000). `kind: 'hidden'` = a list the viewer cannot read (no id, no title). */
export interface WishPlaceRef {
  id: string | null
  title: string | null
  kind: 'standalone' | 'occasion' | 'hidden'
  /** owner only */
  occasion_id?: string | null
  /** owner only: that list is the wish's home */
  home?: boolean
  /** owner only: hidden from the audience by the emergency switch */
  paused?: boolean
}

/** also_in from an RPC answer, checked entry by entry (malformed entries dropped; at most one 'hidden', always last). */
export function asWishPlaces(raw: unknown): WishPlaceRef[] | null {
  if (!Array.isArray(raw)) return null
  const out: WishPlaceRef[] = []
  let hidden = false
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (e.kind === 'hidden') {
      hidden = true
      continue
    }
    if (typeof e.id !== 'string' || (e.kind !== 'standalone' && e.kind !== 'occasion')) continue
    const place: WishPlaceRef = { id: e.id, title: typeof e.title === 'string' ? e.title : null, kind: e.kind }
    if ('occasion_id' in e) place.occasion_id = typeof e.occasion_id === 'string' ? e.occasion_id : null
    if (typeof e.home === 'boolean') place.home = e.home
    if (typeof e.paused === 'boolean') place.paused = e.paused
    out.push(place)
  }
  if (hidden) out.push({ id: null, title: null, kind: 'hidden' })
  return out
}

/** The place keys of a wish answer (20261027200000) that are present — an older server sends none. */
export function pickPlaceFields(wish: { home?: unknown; paused?: unknown; also_in?: unknown }): Pick<OccasionScreenWish, 'home' | 'paused' | 'also_in'> {
  const out: Pick<OccasionScreenWish, 'home' | 'paused' | 'also_in'> = {}
  if (typeof wish.home === 'boolean') out.home = wish.home
  if (typeof wish.paused === 'boolean') out.paused = wish.paused
  if (wish.also_in !== undefined) out.also_in = asWishPlaces(wish.also_in)
  return out
}

/**
 * A list cover's meta in every answer that carries a list (20261022160000): the bytes come lazily from
 * getListPhoto() (lib/api/listPhotos.ts); `updated_at` is the version (cache key of the bytes, memory only).
 */
export interface ListPhotoMeta {
  width: number
  height: number
  updated_at: string
}

export interface OccasionScreenWishlist {
  id: string
  owner_id: string
  title: string | null
  /** the OPEN wishes (received_at null), sorted priority desc, created_at asc — identical for every role */
  wishes: OccasionScreenWish[]
  /**
   * 20261022160000: the wishes the owner marked as received, newest first — the same object shape (a guest who
   * reserved one still sees reserved_by_me there). Missing (undefined) from a server before the migration.
   */
  received?: OccasionScreenWish[]
  /** 20261022160000: the list cover's meta, null without one; missing from an older server */
  photo?: ListPhotoMeta | null
  /**
   * 20261027200000: OWNER of an occasion list only — show "Was hast du bekommen?" (day 1..7 after the end, not
   * dismissed, open wishes left). Missing for guests and from an older server.
   */
  received_prompt?: boolean
}

/**
 * A person's own profile photo or banner photo (20261024120000): the meta in every answer that shows the person —
 * only to those who may see their card (the database's visibility rule, private.knows_profile); the bytes come
 * lazily from getProfilePhoto() (lib/api/profilePhotos.ts). `updated_at` is the version (cache key, memory only).
 */
export interface ProfilePhotoMeta {
  width: number
  height: number
  updated_at: string
}

export interface OccasionScreenMember {
  profile_id: string
  display_name: string | null
  role: MemberRole
  rsvp: Rsvp
  /** 20261024120000: the member's profile photo meta, null without one; missing from an older server */
  photo?: ProfilePhotoMeta | null
}

export interface OccasionScreenInvite {
  active: true
  expires_at: string
}

/**
 * The cover photo's meta in get_occasion_screen (20261020160000_occasion_photos.sql): the bytes come lazily
 * from get_occasion_photo() (lib/api/photos.ts); `updated_at` is the version (cache key of the bytes).
 */
export interface OccasionPhotoMeta {
  width: number
  height: number
  updated_at: string
}

/**
 * What an occasion offers (20261025150000_potluck.sql, occasions.sections): the wish list (default, every occasion
 * before the bring-along list existed), the bring-along list "Mitbringen" only, or both.
 */
export type OccasionSections = 'wishes' | 'bring' | 'both'

/**
 * One entry of the bring-along list "Mitbringen" — NOT secret: every active member (the host too) sees who brings
 * it. `bringer` is null while it is free, and also when the person bringing it and I have blocked each other
 * (`claimed` stays true: "Wird schon mitgebracht"). Who created the entry is never sent.
 */
export interface PotluckItem {
  id: string
  title: string
  created_at: string
  /** I created it: I may rename it */
  can_edit: boolean
  /** I created it, or I am the host */
  can_delete: boolean
  claimed: boolean
  claimed_by_me: boolean
  bringer: { profile_id: string; display_name: string | null; photo?: ProfilePhotoMeta | null } | null
}

export interface PotluckScreen {
  /** 50: the database refuses more (limit_reached) */
  max_items: number
  /** in creation order */
  items: PotluckItem[]
}

export interface OccasionScreen {
  occasion: {
    id: string
    title: string
    starts_at: string
    /**
     * 20261026180000: the end of a timed occasion, null without one (and for an all-day occasion). MISSING (undefined)
     * from a server before the migration: the edit form then offers no end and its save leaves the stored one alone.
     */
    ends_at?: string | null
    tz: string
    all_day: boolean
    place_text: string | null
    /**
     * 20261027190000: where the place is (both or neither; null without a point) — the screen's mini map. MISSING
     * (undefined) from a server before the migration.
     */
    place_lat?: number | null
    place_lon?: number | null
    description: string | null
    created_at: string
    /** `photo` (20261024120000): the host's profile photo meta, null without one; missing from an older server */
    host: { id: string; display_name: string | null; photo?: ProfilePhotoMeta | null }
    /** the cover photo's meta, null without one; missing (undefined) from a server before the photo migration */
    photo?: OccasionPhotoMeta | null
    /** 20261025150000; missing from a server before that migration (= 'wishes') */
    sections?: OccasionSections
    /**
     * 20261027140000: the cover motif — RAW (themes.ts shownCover() to show it, storedCover() for the edit form);
     * MISSING (undefined) from a server before the migration: the form then offers no motif and never writes it.
     */
    cover_theme?: string | null
  }
  viewer: { role: MemberRole; rsvp: Rsvp }
  members: OccasionScreenMember[]
  /** host only (the token itself is never returned); null for members and when no link is active */
  invite: OccasionScreenInvite | null
  /** the host's list (pilot: one per occasion); null only for a freshly created occasion without a list */
  wishlist: OccasionScreenWishlist | null
  /** 20261025150000: the bring-along list, null while the occasion offers wishes only; missing from an older server */
  potluck?: PotluckScreen | null
}

/** A wish as the OWNER sees it: the type has no reservation fields at all (design-system 3). */
export type OwnerWish = Omit<OccasionScreenWish, 'reserved' | 'reserved_by_me' | 'together'> & { together?: WishLinkRef[] | null }
/** A wish as a GUEST sees it: reservation flags are real booleans (also on its linked wishes). */
export type GuestWish = Omit<OwnerWish, 'together'> & { reserved: boolean; reserved_by_me: boolean; together?: GuestWishLink[] | null }

function ownWishFields(wish: OccasionScreenWish): OwnerWish {
  const { id, title, url, price_cents, currency, note, priority, created_at } = wish
  // the details and the places describe the wish only (never reservations); copied only when the server sent them
  const own: OwnerWish = { id, title, url, price_cents, currency, note, priority, created_at, ...pickWishDetails(wish), ...pickPlaceFields(wish) }
  // "Passt zusammen" (20261030120000): ids and titles only — no flag of a linked wish ever reaches an owner component
  if (wish.together !== undefined) own.together = asOwnerLinks(wish.together)
  return own
}

/** Strips the reservation fields so owner components cannot even read them by accident. */
export function asOwnerWishes(wishes: readonly OccasionScreenWish[]): OwnerWish[] {
  return wishes.map(ownWishFields)
}

/** Guest view: null flags (should not happen for guests) are treated as "free". */
export function asGuestWishes(wishes: readonly OccasionScreenWish[]): GuestWish[] {
  return wishes.map((w) => {
    const { together: _ownerLinks, ...rest } = ownWishFields(w)
    const guest: GuestWish = { ...rest, reserved: w.reserved === true, reserved_by_me: w.reserved_by_me === true }
    if (w.together !== undefined) guest.together = asGuestLinks(w.together)
    return guest
  })
}

// ---- my_reservations() (SECRET, guest-only) ----------------------------------------------------

export interface MyReservation {
  /** null once the wish was deleted (wish_title keeps the snapshot) */
  wish_id: string | null
  wish_title: string
  occasion_id: string | null
  occasion_title: string | null
  starts_at: string | null
  status: ReservationStatus
  /** set when ended by someone else; own cancellations are not listed */
  end_reason: ReservationEndReason | null
  created_at: string
  /**
   * Wave 2 (follows-design §5.5, M3): the list without an occasion it belongs to — only while the giver may
   * still read it, else null (the wish title is the snapshot then). Missing from a server before M3.
   */
  list?: { id: string; title: string | null; owner_name: string | null } | null
  /**
   * 20261022160000: the owner marked the wish as received ("Erhalten") — live like the title (null once the giver
   * cannot read the list any more, or the wish was moved away). Missing from an older server.
   */
  received_at?: string | null
}

// ---- export_my_data() ----------------------------------------------------------------------------

/** Opaque: saved as a file, never interpreted by the UI (the client adds `account.email`). */
export type ExportedData = Json
