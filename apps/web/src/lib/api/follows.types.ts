import type { Json } from '../database.types'
import { FRIEND_CODE_SHAPE } from '../friendCode'
import { asPhotoMeta, asProfileCard, isCoverIcon, isCoverTone, type FollowedListCard, type ProfileCard } from './lists.types'

// Wave 2b — follows (docs/spec/follows-design.md v1.2: §2.8–§2.11, §3.3 M2, §5.2–§5.4; its section 00 wins):
// the JSON shapes of the follow RPCs (supabase/migrations/20261020200100_follows.sql + the M3 additions of
// 20261020200200_follow_sharing.sql) and the narrow unions the people screens use.
//
// "The relation through the viewer's eyes" (INV-3, INV-3b): every state below is what the SIGNED-IN person
// is allowed to know — `i_follow` covers "waiting" and "silently declined" alike (the cloak), `follows_me`
// counts only an accepted follow or a request VISIBLE to me. Nothing here describes anybody else's
// followers, followings or their numbers (P2), and nothing describes reservations.
//
// The normalisers copy the known keys only: a stray field the server might send never reaches a component.

/** One direction of a relation, seen by the viewer (private.i_follow_state / private.follows_me_state). */
export type FollowState = 'following' | 'requested' | 'none'

/** The relation on a person's card (get_profile_card.relation). */
export interface ProfileRelation {
  /** my own card */
  self: boolean
  /** my outgoing row: 'requested' = waiting OR silently declined — I can never tell (INV-3) */
  i_follow: FollowState
  /** their accepted follow, or a request of theirs that is VISIBLE to me */
  follows_me: FollowState
  /** both 'following' ("Ihr folgt euch") */
  mutual: boolean
}

/** An occasion both people are active members of (private.shared_occasions: upcoming first, then past). */
export interface SharedOccasion {
  id: string
  title: string
  starts_at: string
}

/** get_profile_card(p_profile_id) — `/people/$profileId`. */
export interface PersonCard {
  profile: ProfileCard
  relation: ProfileRelation
  /** exactly the rule of request_follow for a NEW request (not me, no block, i_follow none, shared occasion or they follow me) */
  can_request: boolean
  /** at least one list of theirs is readable for me (private.can_find_gift = the not_found rule of get_free_wishes) */
  can_find_gift: boolean
  /** their follower lists — only while I follow them (accepted), else [] */
  lists: FollowedListCard[]
  shared_occasions: SharedOccasion[]
}

/** get_people_screen().requests_in[] — a request VISIBLE to me (expired / hidden by my silence / blocked: never here). */
export interface IncomingRequest {
  profile: ProfileCard
  requested_at: string
  shared_occasions: SharedOccasion[]
  /** for the context "Du folgst {{name}}" / "Du hast {{name}} angefragt" */
  i_follow: FollowState
}

/** requests_out[] — my not yet expired requests, the SAME for "waiting", "declined" and "hidden" (the cloak). */
export interface OutgoingRequest {
  profile: ProfileCard
  requested_at: string
  expires_at: string
}

export interface FollowerEntry {
  profile: ProfileCard
  accepted_at: string
  i_follow: FollowState
}

export interface FollowingEntry {
  profile: ProfileCard
  accepted_at: string
  follows_me: FollowState
}

/** blocked[] — the people I blocked (my own decision); no banner, no relation. */
export interface BlockedEntry {
  profile_id: string
  display_name: string | null
  blocked_at: string
}

/** links[] — my live follow links (never a code: the database keeps only its hash). */
export interface LiveFollowLink {
  created_at: string
  expires_at: string
}

/** get_people_screen() — `/people`: Anfragen · Follower · Du folgst · Blockiert (+ my outgoing requests and live links). */
export interface PeopleScreen {
  requests_in: IncomingRequest[]
  requests_out: OutgoingRequest[]
  followers: FollowerEntry[]
  following: FollowingEntry[]
  blocked: BlockedEntry[]
  links: LiveFollowLink[]
}

/** peek_follow_link(p_token) — who is behind a live link (it writes nothing, counts nothing). */
export interface FollowPeek {
  profile: ProfileCard
  relation: { self: boolean; i_follow: FollowState }
}

/** create_follow_link() — the code is shown ONCE (only its sha256 is stored). */
export interface NewFollowLink {
  token: string
  expires_at: string
}

/** request_follow_via_link(p_token) */
export interface ViaLinkRequest {
  status: 'requested' | 'following'
  profile_id: string
}

/** create_friend_code(p_replace) — the short code is shown ONCE (only its sha256 is stored). */
export interface NewFriendCode {
  /** canonical: 8 characters, no dash (lib/friendCode.ts) */
  code: string
  expires_at: string
}

// ---- limits (client = database) ----------------------------------------------------------------------------

/** create_follow_link keeps at most 5 live links: the 6th switches the oldest one off (§2.9). */
export const LIVE_LINK_LIMIT = 5
/** A follow link lives 30 days (follow_links.expires_at). */
export const FOLLOW_LINK_DAYS = 30
/** 64 hex — the shape create_follow_link() returns and the SQL checks first (`^[0-9a-f]{64}$`). */
export const FOLLOW_TOKEN_SHAPE = /^[0-9a-f]{64}$/
/** A friend code lives 24 hours (friend_codes.expires_at, 20261027160000). */
export const FRIEND_CODE_HOURS = 24

// ---- normalisers: copy the known keys only --------------------------------------------------------------------

type Loose = Record<string, unknown>

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0)
const loose = (value: unknown): Loose => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** Anything unknown is the closed answer 'none'. */
export function asFollowState(value: unknown): FollowState {
  return value === 'following' || value === 'requested' ? value : 'none'
}

/**
 * private.profile_card(): { id, display_name, banner, photo, banner_photo } — null without an id (one parser for every
 * screen: lists.types.ts asProfileCard; the photo meta is null when absent, 20261024120000).
 */
export function asProfile(value: unknown): ProfileCard | null {
  return asProfileCard(value)
}

function asSharedOccasions(raw: unknown): SharedOccasion[] {
  return list(raw).flatMap((entry) => {
    const o = loose(entry)
    const id = text(o.id)
    return id ? [{ id, title: text(o.title) ?? '', starts_at: text(o.starts_at) ?? '' }] : []
  })
}

function asCardLists(raw: unknown): FollowedListCard[] {
  return list(raw).flatMap((entry) => {
    const card = loose(entry)
    const id = text(card.id)
    if (!id) return []
    return [{
      id,
      title: text(card.title) ?? '',
      cover_tone: isCoverTone(card.cover_tone) ? card.cover_tone : null,
      cover_icon: isCoverIcon(card.cover_icon) ? card.cover_icon : null,
      due_on: text(card.due_on),
      wish_count: count(card.wish_count),
      new_wish_count: count(card.new_wish_count),
      photo: asPhotoMeta(card.photo), // 20261022160000: the list cover's meta (null without one)
    }]
  })
}

/** get_profile_card with known keys only; an answer without a profile is "not found" for the caller. */
export function asPersonCard(raw: unknown): PersonCard {
  const data = loose(raw)
  const profile = asProfile(data.profile)
  if (!profile) throw new TypeError('get_profile_card: unexpected answer')
  const relation = loose(data.relation)
  const self = relation.self === true
  const iFollow = self ? 'none' : asFollowState(relation.i_follow)
  const followsMe = self ? 'none' : asFollowState(relation.follows_me)
  return {
    profile,
    relation: { self, i_follow: iFollow, follows_me: followsMe, mutual: iFollow === 'following' && followsMe === 'following' },
    can_request: !self && data.can_request === true,
    can_find_gift: !self && data.can_find_gift === true,
    // the lists of a person reach me only while I follow them (§4.3) — a stray list for anyone else is dropped
    lists: iFollow === 'following' ? asCardLists(data.lists) : [],
    shared_occasions: self ? [] : asSharedOccasions(data.shared_occasions),
  }
}

/** get_people_screen with known keys only. */
export function asPeopleScreen(raw: unknown): PeopleScreen {
  const data = loose(raw)
  const withProfile = <T>(entries: unknown, build: (entry: Loose, profile: ProfileCard) => T): T[] =>
    list(entries).flatMap((entry) => {
      const row = loose(entry)
      const profile = asProfile(row.profile)
      return profile ? [build(row, profile)] : []
    })
  return {
    requests_in: withProfile(data.requests_in, (row, profile) => ({
      profile,
      requested_at: text(row.requested_at) ?? '',
      shared_occasions: asSharedOccasions(row.shared_occasions),
      i_follow: asFollowState(row.i_follow),
    })),
    requests_out: withProfile(data.requests_out, (row, profile) => ({
      profile,
      requested_at: text(row.requested_at) ?? '',
      expires_at: text(row.expires_at) ?? '',
    })),
    followers: withProfile(data.followers, (row, profile) => ({ profile, accepted_at: text(row.accepted_at) ?? '', i_follow: asFollowState(row.i_follow) })),
    following: withProfile(data.following, (row, profile) => ({ profile, accepted_at: text(row.accepted_at) ?? '', follows_me: asFollowState(row.follows_me) })),
    blocked: list(data.blocked).flatMap((entry) => {
      const row = loose(entry)
      const id = text(row.profile_id)
      return id ? [{ profile_id: id, display_name: text(row.display_name), blocked_at: text(row.blocked_at) ?? '' }] : []
    }),
    links: list(data.links).flatMap((entry) => {
      const row = loose(entry)
      const expires = text(row.expires_at)
      return expires ? [{ created_at: text(row.created_at) ?? '', expires_at: expires }] : []
    }),
  }
}

/** peek_follow_link with known keys only. */
export function asFollowPeek(raw: unknown): FollowPeek {
  const data = loose(raw)
  const profile = asProfile(data.profile)
  if (!profile) throw new TypeError('peek_follow_link: unexpected answer')
  const relation = loose(data.relation)
  const self = relation.self === true
  return { profile, relation: { self, i_follow: self ? 'none' : asFollowState(relation.i_follow) } }
}

export function asNewFollowLink(raw: unknown): NewFollowLink {
  const data = loose(raw)
  const token = text(data.token)
  const expires = text(data.expires_at)
  if (!token || !FOLLOW_TOKEN_SHAPE.test(token) || !expires) throw new TypeError('create_follow_link: unexpected answer')
  return { token, expires_at: expires }
}

export function asNewFriendCode(raw: unknown): NewFriendCode {
  const data = loose(raw)
  const code = text(data.code)
  const expires = text(data.expires_at)
  if (!code || !FRIEND_CODE_SHAPE.test(code) || !expires) throw new TypeError('create_friend_code: unexpected answer')
  return { code, expires_at: expires }
}

/** The friend-code lookups answer a dead / wrong / blocked code with the VALUE { invalid: true } (a miss is recorded). */
export function isInvalidAnswer(raw: unknown): boolean {
  return loose(raw).invalid === true
}

export function asViaLinkRequest(raw: unknown): ViaLinkRequest {
  const data = loose(raw)
  const profileId = text(data.profile_id)
  if (!profileId) throw new TypeError('request_follow_via_link: unexpected answer')
  return { status: data.status === 'following' ? 'following' : 'requested', profile_id: profileId }
}

// ---- the wave-2 follow contract as supabase-js sees it ----------------------------------------------------------

/**
 * The follow RPCs and the profile column this module writes, in the shape `supabase gen types` produces —
 * the contract of follows-design §4.4 / §5. lib/database.types.ts mirrors the migrations later (the database
 * chain); until then lib/api/follows.ts talks to the same client through this type (like lists.types.ts).
 */
export type FollowsDatabase = {
  __InternalSupabase: { PostgrestVersion: '13' }
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string | null }
        Insert: { id: string }
        Update: { in_suggestions?: boolean }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      get_profile_card: { Args: { p_profile_id: string }; Returns: Json }
      get_people_screen: { Args: Record<PropertyKey, never>; Returns: Json }
      peek_follow_link: { Args: { p_token: string }; Returns: Json }
      request_follow_via_link: { Args: { p_token: string }; Returns: Json }
      respond_follow: { Args: { p_profile_id: string; p_accept: boolean }; Returns: Json }
      remove_follower: { Args: { p_profile_id: string }; Returns: Json }
      create_follow_link: { Args: Record<PropertyKey, never>; Returns: Json }
      revoke_follow_links: { Args: Record<PropertyKey, never>; Returns: Json }
      // friend codes (20261027160000)
      create_friend_code: { Args: { p_replace: boolean }; Returns: Json }
      peek_friend_code: { Args: { p_code: string }; Returns: Json }
      request_follow_via_code: { Args: { p_code: string }; Returns: Json }
      revoke_friend_codes: { Args: Record<PropertyKey, never>; Returns: Json }
      block_user: { Args: { p_profile_id: string }; Returns: Json }
      unblock_user: { Args: { p_profile_id: string }; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
