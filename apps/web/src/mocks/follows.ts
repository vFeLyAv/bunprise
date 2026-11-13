import { http, HttpResponse, type JsonBodyType } from 'msw'
import { DEMO_PEOPLE } from './fixtures'
import { DEMO_LIST_PEOPLE } from './lists'
import { DEMO_SUPABASE_URL, DemoDbError, guarded, invalidBody, invalidInput, raise, readJson, sessionExpiredError } from './rest'
import { endOfLocalDay } from './time'
import { isFriendCode, normalizeFriendCode } from '../lib/friendCode'
import { CODE_USE_LIMIT, LINK_USE_LIMIT, type FollowLinkRow, type FollowRow } from './followGraph'
import type { DemoWorld, OccasionRow, WishlistRow, WishRow } from './world'

// Wave 2b of the demo server, the FOLLOW ACTIONS (docs/spec/follows-design.md v1.2 §5.2–§5.4; section 00 wins)
// re-implemented on the in-memory world like mocks/world.ts does for the pilot — an independent copy of the SQL
// of supabase/migrations/20261020200100_follows.sql (+ the M3 parts of 20261020200200_follow_sharing.sql):
//   get_profile_card(p_profile_id)          the person card — never anybody's followers / followings / numbers
//   get_people_screen()                     requests_in (VISIBLE only) · requests_out (the cloak) · followers · following · blocked · links
//   peek_follow_link(p_token)               writes nothing, counts nothing; consents → name → shape → live link → block
//   request_follow_via_link(p_token)        a NEW request takes one of the link's 20 places; every link failure = invite_invalid
//   respond_follow(p_profile_id, p_accept)  only a request VISIBLE to me; declining = a silence, the request row stays
//   remove_follower(p_profile_id)           their reservations on my lists end (access_ended), silence 30 days
//   create_follow_link() / revoke_follow_links()   ≤ 5 live links (the 6th switches the oldest off); revoking links
//                                                  switches the friend codes off too (20261027160000)
//   create_friend_code(p_replace) / peek_friend_code(p_code) / request_follow_via_code(p_code) / revoke_friend_codes()
//                                           short codes (20261027160000): ≤ 3 live, 24 h, 20 places; a wrong code is the
//                                           VALUE { invalid: true } and a miss; 10 misses / hour, 30 / day → rate_limited
//   block_user(p_profile_id) / unblock_user(p_profile_id)   follows end both ways (INV-5), the silence stays (INV-6)
// (request_follow / unfollow live in mocks/lists.ts — agent K1 — on the same graph.)
// Plus the demo SCRIPT (W10): Anna and Clara say yes to a request of a demo account after a moment, and Ben knocks
// through your own link a little while after you created it — fictional people only, nothing leaves the page.

const DAY = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/

type Args = Readonly<Record<string, string | boolean | null>>

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
/** Postgres `order by display_name` (nulls last), then the id. */
const byName = (a: { name: string | null; id: string }, b: { name: string | null; id: string }): number =>
  a.name === b.name ? byText(a.id, b.id) : a.name === null ? 1 : b.name === null ? -1 : byText(a.name, b.name) || byText(a.id, b.id)

/** `(now() at time zone 'Europe/Berlin')::date`. */
function berlinToday(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** A fresh friend code: 8 random characters of Crockford Base32 (create_friend_code). */
function newFriendCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => alphabet[byte & 31]).join('')
}

/** A friend code's lookups: 10 misses per hour, 30 per day (private.friend_code_gate). */
const MISSES_PER_HOUR = 10
const MISSES_PER_DAY = 30
const INVALID = { invalid: true } as const

/** A fresh code: 32 random bytes as 64 hex chars (create_follow_link). */
function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface FollowsApiHooks {
  /** create_follow_link handed out a code (the demo script's "Ben opens your link") */
  onLinkCreated?: (owner: string, token: string) => void
}

export type DemoFollowsApi = ReturnType<typeof createFollowsApi>

export function createFollowsApi(world: DemoWorld, hooks: FollowsApiHooks = {}) {
  const t = world.internals
  const graph = world.follows

  /** private.profile_card(): id, display name, banner key + the photo meta the VIEWER may see (20261024120000). */
  const profileCard = (id: string, viewer: string) => ({ id, display_name: t.nameOf(id), banner: world.profileSettingsOf(id).banner, ...t.profilePhotoFields(viewer, id) })
  const exists = (id: string | null): id is string => id !== null && t.people.has(id)

  const occasionEnd = (occasion: OccasionRow): number =>
    occasion.ends_at !== null ? Date.parse(occasion.ends_at) : endOfLocalDay(Date.parse(occasion.starts_at), occasion.tz)

  /** private.shared_occasions(viewer, other): both active; upcoming ones first (by start), then past (latest first), id. */
  function sharedOccasions(viewer: string, other: string) {
    const now = t.clock()
    return [...t.occasions.values()]
      .filter((occasion) => t.isActiveMember(occasion.id, viewer) && t.isActiveMember(occasion.id, other))
      .map((occasion) => ({ occasion, past: occasionEnd(occasion) < now, starts: Date.parse(occasion.starts_at) }))
      .sort((a, b) => (a.past !== b.past ? (a.past ? 1 : -1) : a.past ? b.starts - a.starts : a.starts - b.starts) || byText(a.occasion.id, b.occasion.id))
      .map(({ occasion }) => ({ id: occasion.id, title: occasion.title, starts_at: occasion.starts_at }))
  }

  /** private.follower_list_cards(owner, viewer): a future date first (Berlin), then newest first, then id. */
  function followerListCards(owner: string, viewer: string) {
    const now = t.clock()
    const today = berlinToday(now)
    const newSince = new Date(now - 7 * DAY).toISOString()
    const dated = (list: WishlistRow) => list.due_on !== null && list.due_on >= today
    return [...t.wishlists.values()]
      .filter((list) => list.owner_id === owner && list.visibility === 'followers' && list.occasion_id === null && t.canReadWishlist(list.id, viewer))
      .sort((a, b) => (dated(a) !== dated(b) ? (dated(a) ? -1 : 1) : 0)
        || (dated(a) ? byText(a.due_on ?? '', b.due_on ?? '') : 0) || byText(b.created_at, a.created_at) || byText(a.id, b.id))
      .map((list) => {
        const wishes: WishRow[] = t.listWishes(list.id, false) // 20261027200000: the effective places
        return {
          id: list.id, title: list.title, cover_tone: list.cover_tone, cover_icon: list.cover_icon, due_on: list.due_on,
          photo: t.listPhotoMeta(list.id), // 20261022160000: the list cover's meta
          wish_count: wishes.length, new_wish_count: wishes.filter((wish) => wish.created_at > newSince).length,
        }
      })
  }

  /** private.can_find_gift(viewer, person): not oneself, no block, at least one of their lists readable for me. */
  function canFindGift(viewer: string, person: string): boolean {
    return person !== viewer && !graph.isBlockedPair(viewer, person)
      && [...t.wishlists.values()].some((list) => list.owner_id === person && t.canReadWishlist(list.id, viewer))
  }

  // ---- get_profile_card(p_profile_id) ------------------------------------------------------------------------

  function getProfileCard(viewer: string, profileId: string | null): JsonBodyType {
    t.requireUser(viewer)
    // unknown, foreign, blocked, null: one answer
    if (!exists(profileId) || !graph.knowsProfile(viewer, profileId, t.sharesOccasion)) throw raise('not_found')
    const self = profileId === viewer
    const iFollow = self ? 'none' : graph.iFollowState(viewer, profileId)
    const followsMe = self ? 'none' : graph.followsMeState(viewer, profileId)
    return {
      profile: profileCard(profileId, viewer),
      relation: { self, i_follow: iFollow, follows_me: followsMe, mutual: iFollow === 'following' && followsMe === 'following' },
      can_request: !self && iFollow === 'none' && (t.sharesOccasion(viewer, profileId) || followsMe === 'following'),
      can_find_gift: canFindGift(viewer, profileId),
      lists: iFollow === 'following' ? followerListCards(profileId, viewer) : [],
      shared_occasions: self ? [] : sharedOccasions(viewer, profileId),
    }
  }

  // ---- get_people_screen() --------------------------------------------------------------------------------------

  function getPeopleScreen(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    const now = t.clock()
    const rows = graph.tables.follows
    const named = (row: FollowRow, other: string) => ({ row, name: t.nameOf(other), id: other })
    const newestRequest = (a: FollowRow, b: FollowRow, idA: string, idB: string) => byText(b.requested_at, a.requested_at) || byText(idA, idB)
    return {
      requests_in: rows
        .filter((row) => row.followee_id === viewer && exists(row.follower_id) && graph.visibleRequest(row.follower_id, viewer))
        .sort((a, b) => newestRequest(a, b, a.follower_id, b.follower_id))
        .map((row) => ({
          profile: profileCard(row.follower_id, viewer),
          requested_at: row.requested_at,
          shared_occasions: sharedOccasions(viewer, row.follower_id),
          i_follow: graph.iFollowState(viewer, row.follower_id),
        })),
      // my own not yet expired requests: the SAME whether they wait, were declined or are hidden (the cloak)
      requests_out: rows
        .filter((row) => row.follower_id === viewer && exists(row.followee_id) && row.status === 'pending'
          && row.expires_at !== null && Date.parse(row.expires_at) > now)
        .sort((a, b) => newestRequest(a, b, a.followee_id, b.followee_id))
        .map((row) => ({ profile: profileCard(row.followee_id, viewer), requested_at: row.requested_at, expires_at: row.expires_at })),
      followers: rows
        .filter((row) => row.followee_id === viewer && row.status === 'accepted' && exists(row.follower_id))
        .map((row) => named(row, row.follower_id))
        .sort(byName)
        .map(({ row }) => ({ profile: profileCard(row.follower_id, viewer), accepted_at: row.accepted_at, i_follow: graph.iFollowState(viewer, row.follower_id) })),
      following: rows
        .filter((row) => row.follower_id === viewer && row.status === 'accepted' && exists(row.followee_id))
        .map((row) => named(row, row.followee_id))
        .sort(byName)
        .map(({ row }) => ({ profile: profileCard(row.followee_id, viewer), accepted_at: row.accepted_at, follows_me: graph.followsMeState(viewer, row.followee_id) })),
      blocked: graph.blocksBy(viewer)
        .filter((row) => exists(row.blocked_id))
        .map((row) => ({ profile_id: row.blocked_id, display_name: t.nameOf(row.blocked_id), blocked_at: row.created_at })),
      links: graph.liveLinksOf(viewer).map((link) => ({ created_at: link.created_at, expires_at: link.expires_at })),
    }
  }

  // ---- links ----------------------------------------------------------------------------------------------------

  /** The gate's shared order: consents → name → the code's shape (no lookup before these, review #8). */
  function linkGate(viewer: string, token: string | null): string {
    t.requireUser(viewer)
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if (!t.profileComplete(viewer)) throw raise('profile_incomplete')
    if (token === null || !TOKEN.test(token)) throw raise('invite_invalid')
    return token
  }

  /** peek_follow_link(p_token): a full link only for somebody who already has a live relation with its owner. */
  function peekFollowLink(viewer: string, rawToken: string | null): JsonBodyType {
    const token = linkGate(viewer, rawToken)
    const link = graph.linkByToken(token)
    if (!link || !graph.isLiveLink(link) || !exists(link.owner_id)) throw raise('invite_invalid')
    const owner = link.owner_id
    const room = link.use_count < LINK_USE_LIMIT || owner === viewer || graph.iFollowState(viewer, owner) !== 'none'
    if (!room || graph.isBlockedPair(viewer, owner)) throw raise('invite_invalid')
    return { profile: profileCard(owner, viewer), relation: { self: owner === viewer, i_follow: graph.iFollowState(viewer, owner) } }
  }

  /** request_follow_via_link(p_token) → { status, profile_id }: unknown / expired / revoked / own / blocked / full = invite_invalid. */
  function requestFollowViaLink(viewer: string, rawToken: string | null): JsonBodyType {
    const token = linkGate(viewer, rawToken)
    const link: FollowLinkRow | undefined = graph.linkByToken(token)
    if (!link || !exists(link.owner_id)) throw raise('invite_invalid')
    const owner = link.owner_id
    if (!graph.isLiveLink(link) || owner === viewer || graph.isBlockedPair(viewer, owner)) throw raise('invite_invalid')
    const fresh = graph.iFollowState(viewer, owner) === 'none' // a new request takes a place; the same person again does not
    if (fresh && link.use_count >= LINK_USE_LIMIT) throw raise('invite_invalid') // the link is full
    // limit_reached (30 open requests) throws here — before the place is counted, like the SQL's rollback
    const state = graph.makeFollowRequest(viewer, owner, () => raise('limit_reached'))
    if (fresh) link.use_count += 1
    return { status: state === 'following' ? 'following' : 'requested', profile_id: owner }
  }

  function createFollowLink(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if (!t.profileComplete(viewer)) throw raise('profile_incomplete')
    const token = newToken()
    const row = graph.addLink(viewer, token)
    hooks.onLinkCreated?.(viewer, token)
    return { token, expires_at: row.expires_at }
  }

  function revokeFollowLinks(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    graph.revokeLinksOf(viewer)
    graph.revokeCodesOf(viewer) // 20261027160000: "Alle Links deaktivieren" switches the codes off too
    return { ok: true } // no consents needed: it narrows
  }

  // ---- friend codes (20261027160000) ------------------------------------------------------------------------------

  /** private.friend_code_gate: consents → name → the miss limit (checked BEFORE the lookup). */
  function codeGate(viewer: string): void {
    t.requireUser(viewer)
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if (!t.profileComplete(viewer)) throw raise('profile_incomplete')
    if (graph.missesSince(viewer, 3_600_000) >= MISSES_PER_HOUR || graph.missesSince(viewer, DAY) >= MISSES_PER_DAY) throw raise('rate_limited')
  }

  /** private.friend_code_owner: the owner of a live code the viewer may use, else null. */
  function codeOwner(viewer: string, raw: string | null): string | null {
    if (raw === null || raw.length > 32) return null
    const code = normalizeFriendCode(raw)
    const row = isFriendCode(code) ? graph.codeRowOf(code) : undefined
    if (!row || !graph.isLiveCode(row) || !exists(row.owner_id)) return null
    const owner = row.owner_id
    const room = row.use_count < CODE_USE_LIMIT || owner === viewer || graph.iFollowState(viewer, owner) !== 'none'
    return room && !graph.isBlockedPair(viewer, owner) ? owner : null
  }

  function createFriendCode(viewer: string, replace: boolean | null): JsonBodyType {
    t.requireUser(viewer)
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if (!t.profileComplete(viewer)) throw raise('profile_incomplete')
    const code = newFriendCode()
    const row = graph.addCode(viewer, code, replace === true)
    return { code, expires_at: row.expires_at }
  }

  function peekFriendCode(viewer: string, raw: string | null): JsonBodyType {
    codeGate(viewer)
    const owner = codeOwner(viewer, raw)
    if (owner === null) {
      graph.addMiss(viewer)
      return INVALID
    }
    return { profile: profileCard(owner, viewer), relation: { self: owner === viewer, i_follow: graph.iFollowState(viewer, owner) } }
  }

  function requestFollowViaCode(viewer: string, raw: string | null): JsonBodyType {
    codeGate(viewer)
    const owner = codeOwner(viewer, raw)
    if (owner === null) {
      graph.addMiss(viewer)
      return INVALID
    }
    const row = graph.codeRowOf(normalizeFriendCode(raw ?? ''))
    if (owner === viewer || !row) return INVALID // the own code: nothing to ask, and not a miss
    const fresh = graph.iFollowState(viewer, owner) === 'none'
    if (fresh && row.use_count >= CODE_USE_LIMIT) return INVALID
    const state = graph.makeFollowRequest(viewer, owner, () => raise('limit_reached'))
    if (fresh) row.use_count += 1
    return { status: state === 'following' ? 'following' : 'requested', profile_id: owner }
  }

  function revokeFriendCodes(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    graph.revokeCodesOf(viewer)
    return { ok: true }
  }

  // ---- answers to requests, removing a follower --------------------------------------------------------------------

  function respondFollow(viewer: string, profileId: string | null, accept: boolean | null): JsonBodyType {
    t.requireUser(viewer)
    if (accept === null) throw raise('validation')
    if (profileId === null) throw raise('not_found')
    // hidden by my silence, expired, withdrawn, blocked, missing: one answer
    if (!graph.visibleRequest(profileId, viewer)) throw raise('not_found')
    if (accept) {
      if (!t.hasConsents(viewer)) throw raise('consent_required')
      if (!t.profileComplete(viewer)) throw raise('profile_incomplete')
      graph.accept(profileId, viewer)
    } else {
      // a silence (until only grows, INV-6); the request row stays: the asker keeps seeing "Angefragt"
      graph.silence(viewer, profileId)
    }
    return { ok: true }
  }

  function removeFollower(viewer: string, profileId: string | null): JsonBodyType {
    t.requireUser(viewer)
    if (profileId === null || !graph.isAcceptedFollower(profileId, viewer)) throw raise('not_found')
    graph.removeFollow(profileId, viewer)
    t.endFollowReservations(profileId, viewer, 'access_ended') // INV-1, the same answer whatever there was
    graph.silence(viewer, profileId)
    return { ok: true }
  }

  // ---- blocks -------------------------------------------------------------------------------------------------------

  /**
   * block_user(p_profile_id): the v1.1 body (any existing profile; memberships in each other's occasions end —
   * the host side as 'removed', the guest side as 'left') + follows end both ways (INV-5, silence untouched,
   * INV-6) + the reservations between the two end: mine on their lists as 'blocked', theirs on mine as
   * 'access_ended' (a list without an occasion) or 'member_removed' (an occasion list).
   */
  function blockUser(viewer: string, profileId: string | null): JsonBodyType {
    t.requireUser(viewer)
    if (profileId === null || profileId === viewer || !exists(profileId)) throw raise('not_found')
    graph.block(viewer, profileId)
    const at = t.stamp()
    for (const member of t.members) {
      const occasion = t.occasions.get(member.occasion_id)
      if (!occasion || member.status !== 'active' || member.role !== 'member') continue
      if (occasion.host_id === viewer && member.profile_id === profileId) {
        member.status = 'removed'
        member.updated_at = at
        t.releasePotluck(member.occasion_id, member.profile_id)
      } else if (occasion.host_id === profileId && member.profile_id === viewer) {
        member.status = 'left'
        member.updated_at = at
        t.releasePotluck(member.occasion_id, member.profile_id)
      }
    }
    for (const reservation of t.reservations) {
      // 20261027200000: a block closes reading both ways — every such row is dead now (and only dead rows end)
      if (reservation.status !== 'active' || t.reservationIsLive(reservation)) continue
      if (reservation.reserver_id === viewer && reservation.recipient_id === profileId) t.endReservation(reservation, 'blocked')
      else if (reservation.reserver_id === profileId && reservation.recipient_id === viewer) {
        const list = reservation.wishlist_id === null ? undefined : t.wishlists.get(reservation.wishlist_id)
        t.endReservation(reservation, list && list.occasion_id === null ? 'access_ended' : 'member_removed')
      }
    }
    return { ok: true }
  }

  function unblockUser(viewer: string, profileId: string | null): JsonBodyType {
    t.requireUser(viewer)
    if (profileId !== null) graph.unblock(viewer, profileId) // memberships, follows and reservations are not restored
    return { ok: true }
  }

  return {
    getProfileCard, getPeopleScreen, peekFollowLink, requestFollowViaLink, createFollowLink, revokeFollowLinks,
    respondFollow, removeFollower, blockUser, unblockUser,
    createFriendCode, peekFriendCode, requestFollowViaCode, revokeFriendCodes,
  }
}

// ---- export_my_data: the follows block (private.my_follows_export) and my blocks ----------------------------------

/**
 * private.my_follows_export() + the export's `blocks` (M2): display names, never somebody's id; never a silence set
 * by somebody else; never token_hash. `hidden_requests_received` = live requests TO ME hidden by MY silence — my
 * own data (Art. 15); the requester's export keeps the cloak ("requested").
 */
export function followsExportFor(world: DemoWorld, viewer: string) {
  const t = world.internals
  const graph = world.follows
  const now = t.clock()
  const live = (iso: string | null) => iso !== null && Date.parse(iso) > now
  const rows = graph.tables.follows
  const known = (id: string) => t.people.has(id)
  const byRequested = (a: FollowRow, b: FollowRow, idA: string, idB: string) => byText(a.requested_at, b.requested_at) || byText(idA, idB)
  return {
    follows: {
      following: rows
        .filter((row) => row.follower_id === viewer && known(row.followee_id) && (row.status === 'accepted' || live(row.expires_at)))
        .sort((a, b) => byRequested(a, b, a.followee_id, b.followee_id))
        .map((row) => ({
          display_name: t.nameOf(row.followee_id), status: row.status === 'accepted' ? 'accepted' : 'requested',
          requested_at: row.requested_at, accepted_at: row.accepted_at, expires_at: row.expires_at,
        })),
      followers: rows
        .filter((row) => row.followee_id === viewer && row.status === 'accepted' && known(row.follower_id))
        .sort((a, b) => byText(a.accepted_at ?? '', b.accepted_at ?? '') || byText(a.follower_id, b.follower_id))
        .map((row) => ({ display_name: t.nameOf(row.follower_id), accepted_at: row.accepted_at })),
      requests_received: rows
        .filter((row) => row.followee_id === viewer && known(row.follower_id) && graph.visibleRequest(row.follower_id, viewer))
        .sort((a, b) => byRequested(a, b, a.follower_id, b.follower_id))
        .map((row) => ({ display_name: t.nameOf(row.follower_id), requested_at: row.requested_at })),
      hidden_requests_received: rows
        .filter((row) => row.followee_id === viewer && known(row.follower_id) && row.status === 'pending' && live(row.expires_at)
          && graph.hasFollowCooldown(viewer, row.follower_id) && !graph.isBlockedPair(viewer, row.follower_id))
        .sort((a, b) => byRequested(a, b, a.follower_id, b.follower_id))
        .map((row) => ({ display_name: t.nameOf(row.follower_id), requested_at: row.requested_at })),
      hidden_requesters: graph.tables.cooldowns
        .filter((row) => row.followee_id === viewer && known(row.follower_id))
        .sort((a, b) => byText(a.until, b.until) || byText(a.follower_id, b.follower_id))
        .map((row) => ({ display_name: t.nameOf(row.follower_id), until: row.until })),
      follow_links: graph.tables.links
        .filter((link) => link.owner_id === viewer)
        .sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
        .map((link) => ({ created_at: link.created_at, expires_at: link.expires_at, revoked_at: link.revoked_at, use_count: link.use_count })),
      // 20261027160000: my codes (never the code) and my misses (time only)
      friend_codes: graph.tables.codes
        .filter((row) => row.owner_id === viewer)
        .sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
        .map((row) => ({ created_at: row.created_at, expires_at: row.expires_at, revoked_at: row.revoked_at, use_count: row.use_count })),
      friend_code_misses: graph.tables.misses
        .filter((row) => row.profile_id === viewer)
        .sort((a, b) => byText(a.missed_at, b.missed_at))
        .map((row) => ({ missed_at: row.missed_at })),
    },
    blocks: graph.tables.blocks
      .filter((row) => row.blocker_id === viewer)
      .sort((a, b) => byText(a.created_at, b.created_at))
      .map((row) => ({ blocked_name: t.nameOf(row.blocked_id), created_at: row.created_at })),
  }
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------

export interface FollowsHandlerOptions {
  world: DemoWorld
  /** profile id of the request's valid demo session, or null */
  viewerOf: (request: Request) => string | null
  /** the scripted friends (W10); false = a quiet world (tests) */
  script?: boolean | FollowScriptOptions
}

type ParamType = 'uuid' | 'text' | 'boolean'

function isPayload(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** PostgREST's argument coercion: a JSON boolean, or the text a boolean cast takes; anything else 22P02. */
function asBooleanArg(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && /^(true|t|yes|on|1)$/i.test(value.trim())) return true
  if (typeof value === 'string' && /^(false|f|no|off|0)$/i.test(value.trim())) return false
  throw invalidInput('boolean')
}

export function createFollowsHandlers({ world, viewerOf, script = true }: FollowsHandlerOptions) {
  const rest = `${DEMO_SUPABASE_URL}/rest/v1`
  const scripted = script === false ? null : createFollowScript(world, script === true ? {} : script)
  const api = createFollowsApi(world, { onLinkCreated: scripted?.onLinkCreated })

  function viewer(request: Request): string {
    const id = viewerOf(request)
    if (id === null) throw sessionExpiredError()
    return id
  }

  /** POST /rest/v1/rpc/<name>; PostgREST finds a function by its exact argument names (like mocks/lists.ts). */
  function rpc(name: string, params: Readonly<Record<string, ParamType>>, run: (me: string, args: Args) => JsonBodyType) {
    return http.post(`${rest}/rpc/${name}`, ({ request }) => guarded(async () => {
      const input = (await readJson(request)) ?? {}
      if (!isPayload(input)) throw invalidBody()
      const given = Object.keys(input)
      const expected = Object.keys(params)
      if (given.length !== expected.length || given.some((key) => !expected.includes(key))) {
        throw new DemoDbError('PGRST202', `Could not find the function public.${name}(${given.join(', ')}) in the schema cache`, 404)
      }
      const args: Record<string, string | boolean | null> = {}
      for (const [key, type] of Object.entries(params)) {
        const value = input[key]
        if (value === null || value === undefined) args[key] = null
        else if (type === 'uuid') {
          if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput('uuid')
          args[key] = value.toLowerCase()
        } else if (type === 'boolean') args[key] = asBooleanArg(value)
        else args[key] = typeof value === 'string' ? value : JSON.stringify(value)
      }
      return HttpResponse.json(run(viewer(request), args))
    }))
  }

  const uuid = (args: Args, key: string): string | null => (typeof args[key] === 'string' ? (args[key] as string) : null)
  const flag = (args: Args, key: string): boolean | null => (typeof args[key] === 'boolean' ? (args[key] as boolean) : null)

  return [
    rpc('get_profile_card', { p_profile_id: 'uuid' }, (me, args) => api.getProfileCard(me, uuid(args, 'p_profile_id'))),
    rpc('get_people_screen', {}, (me) => api.getPeopleScreen(me)),
    rpc('peek_follow_link', { p_token: 'text' }, (me, args) => api.peekFollowLink(me, uuid(args, 'p_token'))),
    rpc('request_follow_via_link', { p_token: 'text' }, (me, args) => api.requestFollowViaLink(me, uuid(args, 'p_token'))),
    rpc('respond_follow', { p_profile_id: 'uuid', p_accept: 'boolean' },
      (me, args) => api.respondFollow(me, uuid(args, 'p_profile_id'), flag(args, 'p_accept'))),
    rpc('remove_follower', { p_profile_id: 'uuid' }, (me, args) => api.removeFollower(me, uuid(args, 'p_profile_id'))),
    rpc('create_follow_link', {}, (me) => api.createFollowLink(me)),
    rpc('revoke_follow_links', {}, (me) => api.revokeFollowLinks(me)),
    rpc('create_friend_code', { p_replace: 'boolean' }, (me, args) => api.createFriendCode(me, flag(args, 'p_replace'))),
    rpc('peek_friend_code', { p_code: 'text' }, (me, args) => api.peekFriendCode(me, uuid(args, 'p_code'))),
    rpc('request_follow_via_code', { p_code: 'text' }, (me, args) => api.requestFollowViaCode(me, uuid(args, 'p_code'))),
    rpc('revoke_friend_codes', {}, (me) => api.revokeFriendCodes(me)),
    rpc('block_user', { p_profile_id: 'uuid' }, (me, args) => api.blockUser(me, uuid(args, 'p_profile_id'))),
    rpc('unblock_user', { p_profile_id: 'uuid' }, (me, args) => api.unblockUser(me, uuid(args, 'p_profile_id'))),
  ]
}

// ---- the demo's fixed follow links and its scripted friends (W10, W11) ------------------------------------------

/**
 * Fixed follow links of the demo: http://localhost:5173/f#<code> (64 hex chars like create_follow_link(); they
 * spell "annas-folgen-link-fuer-die-demo!" / "claras-folgen-link-fuer-die-demo" in ASCII).
 */
export const DEMO_FOLLOW_TOKENS = {
  anna: '616e6e61732d666f6c67656e2d6c696e6b2d667565722d6469652d64656d6f21',
  clara: '636c617261732d666f6c67656e2d6c696e6b2d667565722d6469652d64656d6f',
} as const

/**
 * Fixed friend codes of the demo ("Code eingeben": ANNA-2026 / CARA-2026 / GRET-A026 — 8 Crockford characters like
 * create_friend_code(); live for a day after each reload). The first demo account follows Anna already (seedListsDemo),
 * not Clara or Greta.
 */
export const DEMO_FRIEND_CODES = {
  anna: 'ANNA2026',
  clara: 'CARA2026',
  greta: 'GRETA026',
} as const

/** Clara's list for her followers (visible only after she said yes). */
export const DEMO_CLARA_LIST = 'd1e0c000-0000-4000-8000-0000000000d1'

/** The fictional people of the demo — everybody else is a signed-up demo account. */
const FICTIONAL: ReadonlySet<string> = new Set([...Object.values(DEMO_PEOPLE), ...Object.values(DEMO_LIST_PEOPLE)].map((person) => person.id))

/**
 * The follow links of Anna and Clara (live, 30 days) and Clara's small list for followers. Additive to
 * seedListsDemo (mocks/lists.ts): nothing here is visible to an account before it asks and gets a yes.
 */
export function seedFollowsDemo(world: DemoWorld, nowMs: number = Date.now()): void {
  const at = (days: number) => new Date(nowMs + days * DAY).toISOString()
  const { anna, clara } = DEMO_PEOPLE
  world.follows.seedLink({ id: 'd1e0e000-0000-4000-8000-0000000000f1', owner_id: anna.id, created_at: at(-3), expires_at: at(27), revoked_at: null, use_count: 2 }, DEMO_FOLLOW_TOKENS.anna)
  world.follows.seedLink({ id: 'd1e0e000-0000-4000-8000-0000000000f2', owner_id: clara.id, created_at: at(-1), expires_at: at(29), revoked_at: null, use_count: 0 }, DEMO_FOLLOW_TOKENS.clara)
  world.follows.addCode(anna.id, DEMO_FRIEND_CODES.anna, false)
  world.follows.addCode(clara.id, DEMO_FRIEND_CODES.clara, false)
  world.follows.addCode(DEMO_LIST_PEOPLE.greta.id, DEMO_FRIEND_CODES.greta, false)
  const created = at(-9)
  const wish = (n: number, title: string, priority: WishRow['priority'], priceCents: number | null, daysAgo: number): WishRow => {
    const stamp = at(-daysAgo)
    return { id: `d1e0d000-0000-4000-8000-${String(400 + n).padStart(12, '0')}`, wishlist_id: DEMO_CLARA_LIST, title, price_cents: priceCents, currency: 'EUR', url: null, note: null, priority, created_at: stamp, updated_at: stamp }
  }
  world.seed({
    people: [], occasions: [], members: [], invites: [], reservations: [],
    wishlists: [{ id: DEMO_CLARA_LIST, occasion_id: null, owner_id: clara.id, recipient_id: clara.id, title: 'Claras Wunschzettel', created_at: created, updated_at: created, visibility: 'followers', cover_tone: 3, cover_icon: 'music', due_on: null }],
    wishes: [
      wish(1, 'Notenständer zum Zusammenklappen', 2, 2900, 8),
      wish(2, 'Konzertgutschein', 3, 4000, 4),
      wish(3, 'Saiten für die Ukulele', 1, 1200, 2),
    ],
  })
}

export interface FollowScriptOptions {
  /** who says yes to a demo account's request (default: Anna and Clara) */
  partners?: readonly string[]
  /** default 2.5 s */
  acceptDelayMs?: number
  /** who knocks through your fresh link (default: Ben) */
  knocker?: string
  /** default 4 s */
  knockDelayMs?: number
  /** the timer (tests pass their own) */
  schedule?: (run: () => void, ms: number) => void
}

/**
 * The demo's friends as a tiny script, so the follow flow can be tried alone (W10/W11):
 * - a demo account asks Anna or Clara (link, card, suggestion) → after a moment she says yes — only while the
 *   request is still VISIBLE to her (withdrawn, blocked or expired: nothing happens);
 * - a demo account creates a follow link → a little later Ben asks through exactly that link (the real
 *   request_follow_via_link rules: a full / revoked / blocked link stays silent; nothing if he already asked).
 * Ben does not answer requests himself: "Angefragt" stays, like a friend who has not looked yet.
 */
export function createFollowScript(world: DemoWorld, options: FollowScriptOptions = {}) {
  const graph = world.follows
  const partners = new Set(options.partners ?? [DEMO_PEOPLE.anna.id, DEMO_PEOPLE.clara.id])
  const knocker = options.knocker ?? DEMO_PEOPLE.ben.id
  const schedule = options.schedule ?? ((run: () => void, ms: number) => {
    setTimeout(run, ms)
  })
  const isAccount = (id: string) => !FICTIONAL.has(id) && world.internals.people.has(id)
  const knocked = new Set<string>()
  // the knock goes through the same RPC rules (no hooks: Ben creating links never knocks anybody)
  const asKnocker = createFollowsApi(world)

  graph.onRequested((follower, followee) => {
    if (!partners.has(followee) || !isAccount(follower)) return
    schedule(() => {
      if (graph.visibleRequest(follower, followee)) graph.accept(follower, followee)
    }, options.acceptDelayMs ?? 2_500)
  })

  return {
    onLinkCreated(owner: string, token: string): void {
      if (!isAccount(owner) || knocked.has(owner)) return
      knocked.add(owner)
      schedule(() => {
        try {
          asKnocker.requestFollowViaLink(knocker, token)
        } catch (error) {
          if (!(error instanceof DemoDbError)) throw error // a closed link / a block: Ben simply does not get through
        }
      }, options.knockDelayMs ?? 4_000)
    },
  }
}
