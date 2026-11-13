import type { Json } from '../database.types'
import { asGuestLinks, asOwnerLinks, pickPlaceFields } from './types'
import type { ListPhotoMeta, OccasionScreenWish, OccasionScreenWishlist, ProfilePhotoMeta, WishDetails, WishPhotoMeta } from './types'

// Wave 2b — wishlists without an occasion, the profile banner and the "Wunschlisten" tab
// (docs/spec/follows-design.md v1.2: §2.2–§2.7, §3.2 M1, §3.4 M3, §5.2, §5.3, §5.5; its section 00 wins).
// The JSON shapes of the screen RPCs get_lists_overview() and get_list_screen(), the REST columns of
// §4.4, and the narrow unions the feature code uses. Every key below is one the spec names; where the
// spec leaves a shape open (`upcoming[].list`, `following[].profile`) the choice is written next to it
// and repeated in the wave report (the database chain implements the same contract in parallel).
//
// Secrecy (§2.3, §5.2, W02): nothing on an overview card says anything about reservations — not for the
// owner, not for anyone. `OwnerListCard` and `ListsStats` have no such fields, and asOwnerLists() /
// asListsOverview() copy only the known keys, so a stray server field never reaches a component.

// ---- keys of fixed choices (CHECK constraints of M1) -------------------------------------------------

/** A list without an occasion is seen by its owner only, or by the owner's accepted followers too (M3). */
export type ListVisibility = 'private' | 'followers'
/** Every list's audience: occasion lists keep the pilot rule (the occasion's guests). */
export type AnyListVisibility = ListVisibility | 'occasion'
export type ListKind = 'standalone' | 'occasion'

/** profiles.banner — one of eight presets (5 gradients + 3 patterns); no upload, no URL, no free text. */
export const BANNER_KEYS = ['sunrise', 'meadow', 'sky', 'berry', 'dusk', 'bunnies', 'carrots', 'confetti'] as const
export type BannerKey = (typeof BANNER_KEYS)[number]

/** wishlists.cover_icon — the list's symbol (null = 'gift'). */
export const COVER_ICONS = ['gift', 'cake', 'tree', 'home', 'ring', 'star', 'book', 'game', 'plant', 'plane', 'music', 'heart'] as const
export type CoverIcon = (typeof COVER_ICONS)[number]

/** wishlists.cover_tone — the four tile tones of the kit (ui/tile.ts); null = derived from the list id. */
export type CoverTone = 1 | 2 | 3 | 4

/** Field limits — client = database (M1: title 1…80 characters, not blank). */
export const LIST_TITLE_MAX = 80
/** M1 trigger private.wishlist_limit: the 21st list without an occasion → `limit_reached`. */
export const STANDALONE_LIST_LIMIT = 20
/** The optional date of a list: the day of a celebration, today … +24 months (§2.6, review #12). */
export const LIST_DATE_MONTHS = 24

export function isBannerKey(value: unknown): value is BannerKey {
  return typeof value === 'string' && (BANNER_KEYS as readonly string[]).includes(value)
}

export function isCoverIcon(value: unknown): value is CoverIcon {
  return typeof value === 'string' && (COVER_ICONS as readonly string[]).includes(value)
}

export function isCoverTone(value: unknown): value is CoverTone {
  return value === 1 || value === 2 || value === 3 || value === 4
}

// ---- get_lists_overview() — the "Wunschlisten" tab, ONE RPC (§5.2) -------------------------------------

/** `me` — the signed-in person (`live_links` = own live follow links, for the "Teilen" sheet of agent K2). */
export interface ListsOverviewMe {
  id: string
  display_name: string | null
  banner: BannerKey | null
  live_links: number
  /**
   * 20261024120000: the own profile photo / banner photo meta (null = none). Absent (undefined) from a server without
   * the migration — the sheets then say "Das geht bald" instead of offering a photo.
   */
  photo?: ProfilePhotoMeta | null
  banner_photo?: ProfilePhotoMeta | null
}

/**
 * The counters of the header — only about me, none of them counted from reservations (§2.2):
 * `my_wishes` (tile "Wünsche"), `friends_lists` (tile "Mit dir geteilt": the follower lists of the people I
 * follow + the lists of occasions I am a guest of), `followers` / `following` ("5 Follower · Du folgst 6"),
 * `requests` (the "2 Anfragen ›" pill).
 */
export interface ListsStats {
  my_wishes: number
  my_lists: number
  friends_lists: number
  followers: number
  following: number
  requests: number
}

/** The occasion of an occasion list in `my_lists` (my hosted occasions; tap → the occasion screen). */
export interface OverviewOccasion {
  id: string
  title: string
  starts_at: string
  tz: string
  all_day: boolean
}

/** One card of "Meine" (§2.3). Deliberately NO reservation field of any kind (W02). */
export interface OwnerListCard {
  id: string
  title: string | null
  kind: ListKind
  visibility: AnyListVisibility
  cover_tone: CoverTone | null
  cover_icon: CoverIcon | null
  /** optional date of a list without an occasion (YYYY-MM-DD); always null for occasion lists */
  due_on: string | null
  wish_count: number
  occasion: OverviewOccasion | null
  created_at: string
  /**
   * 20261022160000: the list cover's meta (the bytes: getListPhoto), null without one. Optional in the type (hand-built
   * fixtures, older servers); asOwnerLists() always fills it.
   */
  photo?: ListPhotoMeta | null
}

/** A follower list of someone I follow, as a card under that person in "Freunde" (§2.4). */
export interface FollowedListCard {
  id: string
  title: string
  cover_tone: CoverTone | null
  cover_icon: CoverIcon | null
  due_on: string | null
  wish_count: number
  /** wishes created within the last 7 days ("3 neu") */
  new_wish_count: number
  /** 20261022160000: the list cover's meta, null without one (the parsers always fill it) */
  photo?: ListPhotoMeta | null
}

/** private.profile_card(): id, name and banner key (the only way someone else's banner reaches me). */
export interface ProfileCard {
  id: string
  display_name: string | null
  banner: BannerKey | null
  /**
   * 20261024120000: the person's own profile photo / banner photo meta — set only for those who may see the card
   * (the database decides; null otherwise and without a photo). Optional in the type (hand-built fixtures, older
   * servers); asProfileCard() always fills both.
   */
  photo?: ProfilePhotoMeta | null
  banner_photo?: ProfilePhotoMeta | null
}

/**
 * Someone I follow (accepted). ASSUMPTION: `profile` is private.profile_card() — `{id, display_name,
 * banner}` (the spec names the key, not its fields). `mutual` = they follow me too ("Ihr folgt euch").
 */
export interface FollowedPerson {
  profile: ProfileCard
  mutual: boolean
  accepted_at: string
  lists: FollowedListCard[]
}

/**
 * One card of "Bald" (60 days): the occasion lists I am a guest of and the dated follower lists of the
 * people I follow. ASSUMPTION (the spec names only `list`): `list` = `{id, title, cover_tone, cover_icon,
 * wish_count, occasion_id}` — `occasion_id` set for kind 'occasion' (tap → the occasion screen), null for a
 * standalone list (tap → /lists/$id). `date` = the list's day (YYYY-MM-DD; for an occasion: its local start day).
 */
export interface UpcomingList {
  list: {
    id: string
    title: string | null
    cover_tone: CoverTone | null
    cover_icon: CoverIcon | null
    wish_count: number
    occasion_id: string | null
    /** 20261022160000: the list cover's meta, null without one (the parser always fills it) */
    photo?: ListPhotoMeta | null
  }
  owner: { id: string; display_name: string | null }
  date: string
  kind: ListKind
}

/** "Aus deinen Anlässen" — only people who switched it on themselves (in_suggestions, §2.4, review #7). */
export interface FollowSuggestion {
  /** `photo` (20261024120000): the person's profile photo meta, null without one (the parser always fills it) */
  profile: { id: string; display_name: string | null; photo?: ProfilePhotoMeta | null }
  shared_occasion_title: string
}

export interface ListsOverview {
  me: ListsOverviewMe
  stats: ListsStats
  /** order (server): future date ascending, then without a date newest first, then past occasions */
  my_lists: OwnerListCard[]
  /** order (server): display_name, id */
  following: FollowedPerson[]
  upcoming: UpcomingList[]
  suggestions: FollowSuggestion[]
}

// ---- get_list_screen(p_list_id) — /lists/$listId (§5.5) -------------------------------------------------

export interface ListScreenList {
  id: string
  title: string
  kind: 'standalone'
  visibility: ListVisibility
  cover_tone: CoverTone | null
  cover_icon: CoverIcon | null
  due_on: string | null
  created_at: string
  owner: ProfileCard
  /** 20261022160000: the cover's meta for the big header (the bytes: getListPhoto), null without one */
  photo?: ListPhotoMeta | null
}

/**
 * The owner branch sends `reserved` / `reserved_by_me` as literal nulls (the RPC never looks at
 * reservations for them); the follower branch sends booleans. Owner code goes through asOwnerWishes().
 */
export interface ListScreen {
  list: ListScreenList
  viewer: { role: 'owner' | 'follower' }
  /** the OPEN wishes (received_at null), priority desc, created_at asc */
  wishes: OccasionScreenWish[]
  /**
   * 20261022160000: the wishes the owner marked as received ("Erhalten"), newest first — same shape as `wishes`; a
   * follower who reserved one still sees reserved_by_me. asListScreen() always fills it ([] from an older server).
   */
  received?: OccasionScreenWish[]
}

/** The list screen as the wish components of features/wishes read a list (the occasion screen's shape). */
export function asWishlist(screen: ListScreen): OccasionScreenWishlist {
  return {
    id: screen.list.id, owner_id: screen.list.owner.id, title: screen.list.title, wishes: screen.wishes,
    received: screen.received ?? [], photo: screen.list.photo ?? null,
  }
}

// ---- inputs (REST, exactly the column grants of §4.4) --------------------------------------------------

/** INSERT (id, occasion_id, owner_id, recipient_id, title, visibility, cover_tone, cover_icon, due_on). */
export interface NewListInput {
  /** client-made uuid v4 (newListId()): the card is there before the server answered */
  id: string
  title: string
  visibility: ListVisibility
  cover_tone: CoverTone | null
  cover_icon: CoverIcon | null
  due_on: string | null
}

/** UPDATE (title, cover_tone, cover_icon, due_on) — the visibility never changes through REST. */
export interface ListPatch {
  title?: string
  cover_tone?: CoverTone | null
  cover_icon?: CoverIcon | null
  due_on?: string | null
}

/** request_follow(p_profile_id) → { status } (§5.3) */
export type FollowRequestStatus = 'requested' | 'following'

// ---- normalisers: copy the known keys only ------------------------------------------------------------

type Loose = Record<string, unknown>

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0)
const tone = (value: unknown): CoverTone | null => (isCoverTone(value) ? value : null)
const icon = (value: unknown): CoverIcon | null => (isCoverIcon(value) ? value : null)
const banner = (value: unknown): BannerKey | null => (isBannerKey(value) ? value : null)
const loose = (value: unknown): Loose => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

function asVisibility(value: unknown): AnyListVisibility {
  return value === 'followers' || value === 'occasion' ? value : 'private' // unknown → the closed default
}

function asOccasion(value: unknown): OverviewOccasion | null {
  const o = loose(value)
  const id = text(o.id)
  const startsAt = text(o.starts_at)
  if (!id || !startsAt) return null
  return { id, title: text(o.title) ?? '', starts_at: startsAt, tz: text(o.tz) ?? 'Europe/Berlin', all_day: o.all_day === true }
}

/**
 * The owner's cards with exactly the fields of OwnerListCard — anything else the server might send
 * (a count, a flag) is dropped here, before any component sees it (§2.3, W02).
 */
export function asOwnerLists(raw: unknown): OwnerListCard[] {
  return list(raw).flatMap((entry) => {
    const card = loose(entry)
    const id = text(card.id)
    if (!id) return []
    const occasion = asOccasion(card.occasion)
    const kind: ListKind = card.kind === 'occasion' || occasion ? 'occasion' : 'standalone'
    return [{
      id,
      title: text(card.title),
      kind,
      visibility: kind === 'occasion' ? 'occasion' : asVisibility(card.visibility),
      cover_tone: tone(card.cover_tone),
      cover_icon: icon(card.cover_icon),
      due_on: kind === 'occasion' ? null : text(card.due_on),
      wish_count: count(card.wish_count),
      occasion,
      created_at: text(card.created_at) ?? '',
      photo: asWishPhotoMeta(card.photo),
    }]
  })
}

/** private.profile_card() with its known keys (photo / banner_photo: null when absent or malformed). */
export function asProfileCard(value: unknown): ProfileCard | null {
  const p = loose(value)
  const id = text(p.id)
  return id
    ? { id, display_name: text(p.display_name), banner: banner(p.banner), photo: asWishPhotoMeta(p.photo), banner_photo: asWishPhotoMeta(p.banner_photo) }
    : null
}

/**
 * The own photo meta of `me` (get_lists_overview, get_me): a key the server did not send stays ABSENT (a server
 * without the migration — the UI says "Das geht bald" then), a sent key is the meta or null.
 */
export function ownPhotoFields(raw: Readonly<Record<string, unknown>>): { photo?: ProfilePhotoMeta | null; banner_photo?: ProfilePhotoMeta | null } {
  const out: { photo?: ProfilePhotoMeta | null; banner_photo?: ProfilePhotoMeta | null } = {}
  if ('photo' in raw) out.photo = asWishPhotoMeta(raw.photo)
  if ('banner_photo' in raw) out.banner_photo = asWishPhotoMeta(raw.banner_photo)
  return out
}

// ---- the wish details (20261022120000) in the list RPCs ------------------------------------------------

const isPhotoSide = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2048

/** A photo meta (wish photo or list cover) from an RPC answer (anything malformed counts as "no photo"). */
export function asPhotoMeta(value: unknown): WishPhotoMeta | ListPhotoMeta | null {
  return asWishPhotoMeta(value)
}

function asWishPhotoMeta(value: unknown): WishPhotoMeta | null {
  if (typeof value !== 'object' || value === null) return null
  const meta = value as Record<string, unknown>
  return isPhotoSide(meta.width) && isPhotoSide(meta.height) && typeof meta.updated_at === 'string'
    ? { width: meta.width, height: meta.height, updated_at: meta.updated_at }
    : null
}

/**
 * The detail keys of a raw wish object from an RPC (get_list_screen, get_free_wishes …), checked one by one:
 * a key the server did not send stays absent (older server), a wrong type becomes null.
 */
function parseWishDetails(raw: Readonly<Record<string, unknown>>): Partial<WishDetails> {
  const out: Partial<WishDetails> = {}
  const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
  if ('description' in raw) out.description = str(raw.description)
  if ('brand' in raw) out.brand = str(raw.brand)
  if ('color' in raw) out.color = str(raw.color)
  if ('gtin' in raw) out.gtin = typeof raw.gtin === 'string' && /^[0-9]{8,14}$/.test(raw.gtin) ? raw.gtin : null
  if ('shop_name' in raw) out.shop_name = str(raw.shop_name)
  if ('photo' in raw) out.photo = asWishPhotoMeta(raw.photo)
  if ('received_at' in raw) out.received_at = typeof raw.received_at === 'string' ? raw.received_at : null
  // 20261030120000 "Anzahl": a whole number 1..10, anything else = 1
  if ('quantity' in raw) out.quantity = typeof raw.quantity === 'number' && Number.isInteger(raw.quantity) && raw.quantity >= 1 && raw.quantity <= 10 ? raw.quantity : 1
  return out
}

/** A free wish of a person; the detail keys (20261022120000) are absent from an older server. */
export interface FreeWish extends Partial<WishDetails> {
  wish_id: string
  title: string
  url: string | null
  price_cents: number | null
  currency: string
  priority: 1 | 2 | 3
  created_at: string
  /** `photo` (20261022160000): the list cover's meta, null without one (the parser always fills it) */
  list: FreeWishList
  /**
   * 20261027200000 (shared wishes): EVERY list of the person the viewer reads this wish in (the first one = `list`),
   * each the shape of `list`. The parser always fills it (`[list]` from an older server). One wish, one entry.
   */
  lists: FreeWishList[]
}

/** A list a free wish is on (get_free_wishes). */
export interface FreeWishList { id: string; title: string; kind: ListKind; date: string | null; occasion_id: string | null; photo?: ListPhotoMeta | null }

function asFreeWishList(raw: unknown): FreeWishList | null {
  const l = loose(raw)
  const id = text(l.id)
  if (!id) return null
  return { id, title: text(l.title) ?? '', kind: l.kind === 'occasion' ? 'occasion' : 'standalone', date: text(l.date),
    occasion_id: text(l.occasion_id), photo: asWishPhotoMeta(l.photo) }
}

export interface FreeWishes { person: ProfileCard; ideas: FreeWish[] }

export function asFreeWishes(raw: unknown): FreeWishes {
  const data = loose(raw)
  const person = asProfileCard(data.person)
  if (!person) throw new TypeError('get_free_wishes: unexpected answer')
  const ideas = list(data.ideas).flatMap((entry): FreeWish[] => {
    const w = loose(entry)
    const id = text(w.wish_id)
    const first = asFreeWishList(w.list)
    if (!id || !first) return []
    // every list of the wish (shape-checked; malformed entries dropped); `list` always among them
    const lists = list(w.lists).flatMap((place) => {
      const parsed = asFreeWishList(place)
      return parsed ? [parsed] : []
    })
    if (!lists.some((place) => place.id === first.id)) lists.unshift(first)
    return [{ wish_id: id, title: text(w.title) ?? '', url: text(w.url), price_cents: typeof w.price_cents === 'number' ? w.price_cents : null,
      currency: text(w.currency) ?? 'EUR', priority: w.priority === 1 || w.priority === 3 ? w.priority : 2, created_at: text(w.created_at) ?? '',
      list: first, lists,
      ...parseWishDetails(w) }]
  })
  return { person, ideas }
}

function asFollowedLists(raw: unknown): FollowedListCard[] {
  return list(raw).flatMap((entry) => {
    const card = loose(entry)
    const id = text(card.id)
    if (!id) return []
    return [{
      id,
      title: text(card.title) ?? '',
      cover_tone: tone(card.cover_tone),
      cover_icon: icon(card.cover_icon),
      due_on: text(card.due_on),
      wish_count: count(card.wish_count),
      new_wish_count: count(card.new_wish_count),
      photo: asWishPhotoMeta(card.photo),
    }]
  })
}

/** The whole overview with known keys only (cards of other people never carry reservation keys either). */
export function asListsOverview(raw: unknown): ListsOverview {
  const data = loose(raw)
  const me = loose(data.me)
  const stats = loose(data.stats)
  return {
    me: { id: text(me.id) ?? '', display_name: text(me.display_name), banner: banner(me.banner), live_links: count(me.live_links), ...ownPhotoFields(me) },
    stats: {
      my_wishes: count(stats.my_wishes),
      my_lists: count(stats.my_lists),
      friends_lists: count(stats.friends_lists),
      followers: count(stats.followers),
      following: count(stats.following),
      requests: count(stats.requests),
    },
    my_lists: asOwnerLists(data.my_lists),
    following: list(data.following).flatMap((entry) => {
      const person = loose(entry)
      const profile = asProfileCard(person.profile)
      if (!profile) return []
      return [{ profile, mutual: person.mutual === true, accepted_at: text(person.accepted_at) ?? '', lists: asFollowedLists(person.lists) }]
    }),
    upcoming: list(data.upcoming).flatMap((entry) => {
      const item = loose(entry)
      const card = loose(item.list)
      const owner = loose(item.owner)
      const id = text(card.id)
      const ownerId = text(owner.id)
      const date = text(item.date)
      if (!id || !ownerId || !date) return []
      const occasionId = text(card.occasion_id)
      return [{
        list: {
          id,
          title: text(card.title),
          cover_tone: tone(card.cover_tone),
          cover_icon: icon(card.cover_icon),
          wish_count: count(card.wish_count),
          occasion_id: occasionId,
          photo: asWishPhotoMeta(card.photo),
        },
        owner: { id: ownerId, display_name: text(owner.display_name) },
        date,
        kind: item.kind === 'occasion' || occasionId ? 'occasion' : 'standalone',
      }]
    }),
    suggestions: list(data.suggestions).flatMap((entry) => {
      const item = loose(entry)
      const profile = loose(item.profile)
      const id = text(profile.id)
      if (!id) return []
      return [{ profile: { id, display_name: text(profile.display_name), photo: asWishPhotoMeta(profile.photo) }, shared_occasion_title: text(item.shared_occasion_title) ?? '' }]
    }),
  }
}

/** get_list_screen with known keys only; the wish rows keep their shape (owner code strips them further). */
export function asListScreen(raw: unknown): ListScreen {
  const data = loose(raw)
  const l = loose(data.list)
  const owner = asProfileCard(l.owner)
  const id = text(l.id)
  if (!id || !owner) throw new TypeError('get_list_screen: unexpected answer')
  const role = loose(data.viewer).role === 'follower' ? 'follower' : 'owner'
  const wishes = (raw: unknown): OccasionScreenWish[] => list(raw).flatMap((entry) => {
    const w = loose(entry)
    const wishId = text(w.id)
    if (!wishId) return []
    const priority = w.priority === 1 || w.priority === 3 ? w.priority : 2
    return [{
      id: wishId,
      title: text(w.title) ?? '',
      url: text(w.url),
      price_cents: typeof w.price_cents === 'number' ? w.price_cents : null,
      currency: text(w.currency) ?? 'EUR',
      note: text(w.note),
      priority,
      created_at: text(w.created_at) ?? '',
      // the owner branch's literal nulls stay null; only the follower branch carries booleans
      reserved: role === 'follower' ? w.reserved === true : null,
      reserved_by_me: role === 'follower' ? w.reserved_by_me === true : null,
      // the details (20261022120000, + received_at 20261022160000) describe the wish only; absent from an older server
      ...parseWishDetails(w),
      // 20261027200000: home / paused / also_in (owner: every other list; follower: null) — absent from an older server
      ...pickPlaceFields(w),
      // 20261030120000 "Passt zusammen": the owner keeps ids + titles only, a follower the flags of what he may see
      ...('together' in w ? { together: role === 'follower' ? asGuestLinks(w.together) : asOwnerLinks(w.together) } : {}),
    }]
  })
  return {
    list: {
      id,
      title: text(l.title) ?? '',
      kind: 'standalone',
      visibility: l.visibility === 'followers' ? 'followers' : 'private',
      cover_tone: tone(l.cover_tone),
      cover_icon: icon(l.cover_icon),
      due_on: text(l.due_on),
      created_at: text(l.created_at) ?? '',
      owner,
      photo: asWishPhotoMeta(l.photo),
    },
    viewer: { role },
    wishes: wishes(data.wishes),
    // 20261022160000: received wishes in their own part ([] from an older server, which has none)
    received: wishes(data.received),
  }
}

// ---- the wave-2 schema as supabase-js sees it -----------------------------------------------------------

/**
 * The tables, columns and RPCs these wrappers use, in the shape `supabase gen types` produces — the
 * contract of follows-design §4.4 / §5. lib/database.types.ts mirrors the migrations later (the database
 * chain); until it has these entries, lib/api/lists.ts talks to the same client through this type, so the
 * calls are typed against the contract instead of `any`.
 */
export type ListsDatabase = {
  __InternalSupabase: { PostgrestVersion: '13' }
  public: {
    Tables: {
      wishlists: {
        Row: {
          id: string
          occasion_id: string | null
          owner_id: string
          recipient_id: string
          title: string | null
          created_at: string
          visibility: string
          cover_tone: number | null
          cover_icon: string | null
          due_on: string | null
        }
        Insert: {
          id?: string
          occasion_id?: string | null
          owner_id: string
          recipient_id: string
          title?: string | null
          visibility?: string
          cover_tone?: number | null
          cover_icon?: string | null
          due_on?: string | null
        }
        Update: {
          title?: string | null
          cover_tone?: number | null
          cover_icon?: string | null
          due_on?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: { id: string; display_name: string | null }
        Insert: { id: string }
        Update: { banner?: string | null; in_suggestions?: boolean }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      get_lists_overview: { Args: Record<PropertyKey, never>; Returns: Json }
      get_list_screen: { Args: { p_list_id: string }; Returns: Json }
      get_free_wishes: { Args: { p_profile_id: string; p_max_cents: number | null }; Returns: Json }
      set_list_visibility: { Args: { p_list_id: string; p_visibility: string }; Returns: Json }
      request_follow: { Args: { p_profile_id: string }; Returns: Json }
      unfollow: { Args: { p_profile_id: string }; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
