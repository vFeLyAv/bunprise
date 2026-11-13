import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_URL } from '../app'
import { AppError } from '../errors'
import { isFriendCode } from '../friendCode'
import { timed, unwrap, unwrapVoid } from './base'
import { asAccount, bearer, type CapturedAccount } from './identity'
import {
  asFollowPeek,
  asNewFollowLink,
  asNewFriendCode,
  asPeopleScreen,
  asPersonCard,
  asViaLinkRequest,
  FOLLOW_TOKEN_SHAPE,
  isInvalidAnswer,
  type FollowPeek,
  type FollowsDatabase,
  type NewFollowLink,
  type NewFriendCode,
  type PeopleScreen,
  type PersonCard,
  type ViaLinkRequest,
} from './follows.types'

// Follows (docs/spec/follows-design.md v1.2 §2.8–§2.11, §5.2–§5.4; section 00 wins): the person card, the
// people screen, the follow link and its gate, answers to requests, removing a follower, blocking — and the
// own switch "In Vorschlägen aus Anlässen erscheinen". Like every account-bound wrapper (contract.md §5.2):
// pinned to ONE account through identity.ts asAccount — the expected account is always the LAST parameter;
// a late answer (data or error) for a former account arrives as session_expired, nothing is sent for an
// expected account that is not current any more.
//
// The follow tables are RPC-only (no REST privilege, no policy): everything here is an RPC, except the own
// profile column in_suggestions (column grant UPDATE, no SELECT — the value comes back through get_me).
// "Narrowing" calls (unfollow, remove, decline, block, revoke links) never need current consents in the SQL.
// Nothing here is cached on disk: the query keys of the people screens live in memory only.

export { requestFollow, unfollow } from './lists'

/** The same client as the other wrappers, typed with the wave-2 follow contract (follows.types.ts). */
function client(account: CapturedAccount): SupabaseClient<FollowsDatabase> {
  return account.supabase as unknown as SupabaseClient<FollowsDatabase>
}

/** A malformed answer of a screen RPC is treated like a refusal: one page, never a crash. */
function orNotFound<T>(parse: () => T): T {
  try {
    return parse()
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError('not_found', { cause: err })
  }
}

/** 64 hex chars — the shape create_follow_link() returns. */
export function isFollowTokenShape(token: string): boolean {
  return FOLLOW_TOKEN_SHAPE.test(token)
}

/** Public URL of a follow link: https://<app>/f#<token> — the code travels in the FRAGMENT only (never logs, never Referer). */
export function buildFollowUrl(token: string): string {
  return `${APP_URL}/f#${token}`
}

/**
 * A friend code's answer: { invalid: true } (a dead, wrong or blocked code — the database recorded a miss) is the
 * same invite_invalid every link failure is; anything else is parsed.
 */
function fromCodeAnswer<T>(raw: unknown, parse: (raw: unknown) => T): T {
  if (isInvalidAnswer(raw)) throw new AppError('invite_invalid')
  return orNotFound(() => parse(raw))
}

// ---- screens (one RPC each) ---------------------------------------------------------------------------------

/**
 * get_profile_card(p_profile_id) — `/people/$profileId`. not_found unless I may see the person at all
 * (myself, a shared active occasion or a relation visible to me; never inside a blocked pair) — unknown,
 * foreign, blocked, malformed: ONE answer.
 */
export function getProfileCard(profileId: string, expectedUserId?: string): Promise<PersonCard> {
  return timed('get_profile_card', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_profile_card', { p_profile_id: profileId }).setHeader('Authorization', bearer(account))
    return orNotFound(() => asPersonCard(unwrap(result)))
  }))
}

/** get_people_screen() — `/people`: requests_in, requests_out, followers, following, blocked, links. */
export function getPeopleScreen(expectedUserId?: string): Promise<PeopleScreen> {
  return timed('get_people_screen', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_people_screen').setHeader('Authorization', bearer(account))
    return asPeopleScreen(unwrap(result))
  }))
}

/**
 * peek_follow_link(p_token) — the gate `/f`: who is behind a live link. Writes nothing, counts nothing.
 * Without current consents / a name the server says consent_required / profile_incomplete for ANY code;
 * every link failure (unknown, expired, revoked, full, own block) is invite_invalid.
 */
export function peekFollowLink(token: string, expectedUserId?: string): Promise<FollowPeek> {
  if (isFriendCode(token)) return peekFriendCode(token, expectedUserId)
  return timed('peek_follow_link', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('peek_follow_link', { p_token: token }).setHeader('Authorization', bearer(account))
    return orNotFound(() => asFollowPeek(unwrap(result)))
  }))
}

// ---- actions ------------------------------------------------------------------------------------------------

/**
 * request_follow_via_link(p_token) → { status, profile_id } — "Folgen anfragen" on the gate. Not optimistic;
 * `expectedUserId` = the account named on the gate (another current account → nothing is sent).
 */
export function requestFollowViaLink(token: string, expectedUserId?: string): Promise<ViaLinkRequest> {
  if (isFriendCode(token)) return requestFollowViaCode(token, expectedUserId)
  return timed('request_follow_via_link', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('request_follow_via_link', { p_token: token }).setHeader('Authorization', bearer(account))
    return orNotFound(() => asViaLinkRequest(unwrap(result)))
  }))
}

/**
 * respond_follow(p_profile_id, p_accept) → { ok } — only a request VISIBLE to me (else not_found). Declining
 * leaves the request row as it is (the asker keeps seeing "Angefragt") and silences that person for 30 days.
 */
export function respondFollow(profileId: string, accept: boolean, expectedUserId?: string): Promise<void> {
  return timed('respond_follow', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('respond_follow', { p_profile_id: profileId, p_accept: accept }).setHeader('Authorization', bearer(account)))
  }))
}

/** remove_follower(p_profile_id) → { ok } — the same answer whatever the person had planned; no follower → not_found. */
export function removeFollower(profileId: string, expectedUserId?: string): Promise<void> {
  return timed('remove_follower', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('remove_follower', { p_profile_id: profileId }).setHeader('Authorization', bearer(account)))
  }))
}

/** create_follow_link() → { token, expires_at } — shown ONCE; at most 5 live links (the 6th switches the oldest off). */
export function createFollowLink(expectedUserId?: string): Promise<NewFollowLink> {
  return timed('create_follow_link', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('create_follow_link').setHeader('Authorization', bearer(account))
    return orNotFound(() => asNewFollowLink(unwrap(result)))
  }))
}

// ---- friend codes (20261027160000, add-friends-design §2.2–§3) -------------------------------------------------
// The gate /f takes a friend code like a link's code: peekFollowLink / requestFollowViaLink pick these by its shape.
// Too many wrong codes → rate_limited ("warte bitte 60 Min."), for right and wrong codes alike.

/** peek_friend_code(p_code) — the follow-link gate's answer for a short code; a wrong one is a miss. */
export function peekFriendCode(code: string, expectedUserId?: string): Promise<FollowPeek> {
  return timed('peek_friend_code', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('peek_friend_code', { p_code: code }).setHeader('Authorization', bearer(account))
    return fromCodeAnswer(unwrap(result), asFollowPeek)
  }))
}

/** request_follow_via_code(p_code) → { status, profile_id } — "Folgen anfragen" after a code. */
export function requestFollowViaCode(code: string, expectedUserId?: string): Promise<ViaLinkRequest> {
  return timed('request_follow_via_code', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('request_follow_via_code', { p_code: code }).setHeader('Authorization', bearer(account))
    return fromCodeAnswer(unwrap(result), asViaLinkRequest)
  }))
}

/**
 * create_friend_code(p_replace) → { code, expires_at } — shown ONCE; at most 3 live codes. `replace` = "Neuer Code":
 * every live code of mine is switched off first.
 */
export function createFriendCode(replace: boolean, expectedUserId?: string): Promise<NewFriendCode> {
  return timed('create_friend_code', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('create_friend_code', { p_replace: replace }).setHeader('Authorization', bearer(account))
    return orNotFound(() => asNewFriendCode(unwrap(result)))
  }))
}

/** revoke_follow_links() → { ok } — switches off every live link of mine (and, since 20261027160000, every code). */
export function revokeFollowLinks(expectedUserId?: string): Promise<void> {
  return timed('revoke_follow_links', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('revoke_follow_links').setHeader('Authorization', bearer(account)))
  }))
}

/**
 * block_user(p_profile_id) → { ok } — follows end in both directions, memberships in each other's occasions
 * end, reservations between the two end; the silence of either side is NOT touched (INV-6).
 * Pinned (lib/api/account.ts blockUser is the pilot's unpinned groundwork and stays as it was).
 */
export function blockPerson(profileId: string, expectedUserId?: string): Promise<void> {
  return timed('block_user', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('block_user', { p_profile_id: profileId }).setHeader('Authorization', bearer(account)))
  }))
}

/** unblock_user(p_profile_id) → { ok } — gives nothing back (no follow, no membership, no reservation). */
export function unblockPerson(profileId: string, expectedUserId?: string): Promise<void> {
  return timed('unblock_user', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('unblock_user', { p_profile_id: profileId }).setHeader('Authorization', bearer(account)))
  }))
}

/**
 * "In Vorschlägen aus Anlässen erscheinen" (§2.11, M3): the own row's profiles.in_suggestions through REST
 * (column grant UPDATE; no SELECT grant — nothing is read back, get_me carries the value). Default false.
 */
export function setInSuggestions(value: boolean, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await client(account).from('profiles').update({ in_suggestions: value }).eq('id', account.userId)
      .setHeader('Authorization', bearer(account)))
  })
}
