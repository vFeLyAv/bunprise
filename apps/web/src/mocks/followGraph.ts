// The demo's follow graph (docs/spec/follows-design.md v1.2 §3.3): who follows whom, the "silence" after a
// declined request or a removed follower (follow_cooldowns), blocks and the follow links — in memory, like
// the tables of M2 — plus the READ helpers of the SQL, one function each with the same name in camelCase:
//
//   private.is_accepted_follower(follower, followee)   isAcceptedFollower
//   private.has_follow_cooldown(followee, follower)     hasFollowCooldown
//   private.visible_request(follower, followee)         visibleRequest
//   private.i_follow_state(viewer, other)               iFollowState
//   private.follows_me_state(viewer, other)             followsMeState
//   private.visible_relation(viewer, other)             visibleRelation
//   private.knows_profile(viewer, target)               knowsProfile (shares_occasion comes from the world)
//   private.is_blocked_pair(a, b)                       isBlockedPair
//
// "Relations through the viewer's eyes" (P4, INV-3, INV-3b): my own outgoing rows always count ("waiting" =
// "silently declined" — that is the cloak); incoming ones only when accepted or VISIBLE to me. No answer to
// a person U ever reads a cooldown row whose followee is not U.
//
// Who extends what: the lists agent (K1) owns the data, the read helpers and the two low-level writes the
// lists tab needs (makeFollowRequest, removeFollow — used by request_follow / unfollow in mocks/lists.ts);
// the follows agent (K2) adds the follow ACTIONS (respond, remove follower, links, block, people screen)
// next to them. The world (mocks/world.ts) owns one graph and asks it for every follower-path decision.
// Synchronous like the world: one handler = one step (the demo's row locks).

const DAY = 86_400_000

export type FollowStatus = 'pending' | 'accepted'
export type FollowState = 'following' | 'requested' | 'none'

/** public.follows — one-way, approval-based; no source ("via link / via occasion") is stored. */
export interface FollowRow {
  follower_id: string
  followee_id: string
  status: FollowStatus
  requested_at: string
  /** pending only: requested_at + 30 days */
  expires_at: string | null
  /** accepted only */
  accepted_at: string | null
}

/** public.follow_cooldowns — the requests of follower_id are not shown to followee_id until `until`. */
export interface FollowCooldownRow {
  followee_id: string
  follower_id: string
  until: string
}

/** public.blocks (the pilot table; wave 2 brings "Blockieren" into the UI — agent K2). */
export interface BlockRow {
  blocker_id: string
  blocked_id: string
  created_at: string
}

/** public.follow_links without the code (the database keeps only sha256 of it; the demo keeps the token apart). */
export interface FollowLinkRow {
  id: string
  owner_id: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  use_count: number
}

/** public.friend_codes without the code (20261027160000; the demo keeps the code apart, like the link tokens). */
export interface FriendCodeRow {
  id: string
  owner_id: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  use_count: number
}

/** public.friend_code_misses: a failed lookup of the caller (time only, never the code). */
export interface FriendCodeMissRow {
  profile_id: string
  missed_at: string
}

/** create_friend_code: at most 3 live codes per owner (the 4th switches the oldest one off). */
export const LIVE_CODE_LIMIT = 3
/** request_follow_via_code: at most 20 NEW requests per code. */
export const CODE_USE_LIMIT = 20
/** A friend code lives 24 hours. */
export const CODE_HOURS = 24

/** The open (not yet expired) requests one person may have at a time (make_follow_request). */
export const OPEN_REQUEST_LIMIT = 30
/** create_follow_link: at most 5 live links per owner (the 6th switches the oldest one off). */
export const LIVE_LINK_LIMIT = 5
/** request_follow_via_link: at most 20 NEW requests per link (follow_links.use_count). */
export const LINK_USE_LIMIT = 20
/** A follow link lives 30 days. */
export const LINK_DAYS = 30

export interface FollowGraphSeed {
  follows?: readonly FollowRow[]
  cooldowns?: readonly FollowCooldownRow[]
  blocks?: readonly BlockRow[]
  links?: readonly FollowLinkRow[]
}

export type FollowGraph = ReturnType<typeof createFollowGraph>

/** `stamp` = the world's strictly increasing now() (ISO), `clock` = now in ms. */
export function createFollowGraph(clock: () => number, stamp: () => string = () => new Date(clock()).toISOString()) {
  const follows: FollowRow[] = []
  const cooldowns: FollowCooldownRow[] = []
  const blocks: BlockRow[] = []
  const links: FollowLinkRow[] = []
  // The database keeps only sha256(code). The demo keeps the code in a private map that no endpoint reads out
  // (create_follow_link returns it once), like the invite tokens of the world (agent K2).
  const linkIdByToken = new Map<string, string>()
  // friend codes (20261027160000): the same — only a private map knows the code behind a row
  const codes: FriendCodeRow[] = []
  const codeIdByCode = new Map<string, string>()
  const misses: FriendCodeMissRow[] = []
  // Told after make_follow_request wrote a NEW (or renewed) pending row — the demo's scripted friends listen
  // (mocks/follows.ts); never called for an answer that only reads the caller's own state.
  const requestListeners = new Set<(follower: string, followee: string) => void>()

  const rowOf = (follower: string, followee: string): FollowRow | undefined =>
    follows.find((row) => row.follower_id === follower && row.followee_id === followee)
  const alive = (iso: string | null): boolean => iso !== null && Date.parse(iso) > clock()

  // ---- READ helpers (private.* of M2) ------------------------------------------------------------------

  function isBlockedPair(a: string, b: string): boolean {
    return blocks.some((block) => (block.blocker_id === a && block.blocked_id === b) || (block.blocker_id === b && block.blocked_id === a))
  }

  function isAcceptedFollower(follower: string, followee: string): boolean {
    return rowOf(follower, followee)?.status === 'accepted'
  }

  function hasFollowCooldown(followee: string, follower: string): boolean {
    return cooldowns.some((row) => row.followee_id === followee && row.follower_id === follower && alive(row.until))
  }

  /** A request the followee SEES and may accept: expired, silenced or blocked = as if there were none. */
  function visibleRequest(follower: string, followee: string): boolean {
    const row = rowOf(follower, followee)
    return row?.status === 'pending' && alive(row.expires_at) && !hasFollowCooldown(followee, follower) && !isBlockedPair(follower, followee)
  }

  /** My own outgoing row: 'requested' covers "waiting" and "silently declined" alike (the cloak). */
  function iFollowState(viewer: string, other: string): FollowState {
    const row = rowOf(viewer, other)
    if (!row) return 'none'
    if (row.status === 'accepted') return 'following'
    return alive(row.expires_at) ? 'requested' : 'none'
  }

  /** Their accepted follow, or a request VISIBLE to me; a request hidden by my silence = 'none'. */
  function followsMeState(viewer: string, other: string): FollowState {
    if (isAcceptedFollower(other, viewer)) return 'following'
    if (visibleRequest(other, viewer)) return 'requested'
    return 'none'
  }

  function visibleRelation(viewer: string, other: string): boolean {
    return iFollowState(viewer, other) !== 'none' || followsMeState(viewer, other) !== 'none'
  }

  /** May the viewer see the target's card: self · a shared active occasion · a relation visible to the viewer; never when blocked. */
  function knowsProfile(viewer: string, target: string, sharesOccasion: (a: string, b: string) => boolean): boolean {
    return viewer === target || (!isBlockedPair(viewer, target) && (sharesOccasion(viewer, target) || visibleRelation(viewer, target)))
  }

  // ---- lists of rows (copies are made by the callers that answer) ----------------------------------------

  /** Accepted follows of `follower`, oldest first (the RPCs sort by name themselves). */
  function followingOf(follower: string): FollowRow[] {
    return follows.filter((row) => row.follower_id === follower && row.status === 'accepted')
  }

  /** Accepted followers of `followee`. */
  function followersOf(followee: string): FollowRow[] {
    return follows.filter((row) => row.followee_id === followee && row.status === 'accepted')
  }

  /** Incoming requests the followee sees (visible_request). */
  function visibleRequestsTo(followee: string): FollowRow[] {
    return follows.filter((row) => row.followee_id === followee && visibleRequest(row.follower_id, followee))
  }

  /** me.live_links: own links that are neither revoked nor expired. */
  function liveLinkCount(owner: string): number {
    return links.filter((link) => link.owner_id === owner && link.revoked_at === null && alive(link.expires_at)).length
  }

  // ---- low-level writes (the RPCs check access first; private.make_follow_request) -----------------------

  /**
   * private.make_follow_request — the SAME write whatever silence the followee keeps (the cloak lives in the
   * reads only). An existing accepted row → 'following', a live pending one → 'requested'; the 31st open
   * request → limit_reached (thrown by the caller with the demo's error type: `onLimit`).
   */
  function makeFollowRequest(follower: string, followee: string, onLimit: () => Error): FollowState {
    const existing = rowOf(follower, followee)
    if (existing?.status === 'accepted') return 'following'
    if (existing && alive(existing.expires_at)) return 'requested'
    const open = follows.filter((row) => row.follower_id === follower && row.status === 'pending' && alive(row.expires_at)).length
    if (open >= OPEN_REQUEST_LIMIT) throw onLimit()
    const at = stamp()
    const expires = new Date(Date.parse(at) + 30 * DAY).toISOString()
    if (existing) {
      // an expired row the daily clean-up has not removed yet
      existing.requested_at = at
      existing.expires_at = expires
    } else {
      follows.push({ follower_id: follower, followee_id: followee, status: 'pending', requested_at: at, expires_at: expires, accepted_at: null })
    }
    for (const listener of Array.from(requestListeners)) listener(follower, followee)
    return 'requested'
  }

  /** The demo script's hook (mocks/follows.ts): a new pending row was written. Returns the unsubscribe. */
  function onRequested(listener: (follower: string, followee: string) => void): () => void {
    requestListeners.add(listener)
    return () => {
      requestListeners.delete(listener)
    }
  }

  // ---- follow links (create_follow_link / revoke_follow_links / the link lookups of M2) ---------------------

  /** My live links (not revoked, not expired), newest first — like `order by created_at desc, id desc`. */
  function liveLinksOf(owner: string): FollowLinkRow[] {
    return links
      .filter((link) => link.owner_id === owner && link.revoked_at === null && alive(link.expires_at))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  }

  /**
   * create_follow_link's write: switch off every live link but the 4 newest, then add the new one (≤ 5 live).
   * `token` is the code the RPC hands out once; only the demo's private map keeps it.
   */
  function addLink(owner: string, token: string): FollowLinkRow {
    const at = stamp()
    for (const old of liveLinksOf(owner).slice(LIVE_LINK_LIMIT - 1)) old.revoked_at = at
    const row: FollowLinkRow = {
      id: crypto.randomUUID(), owner_id: owner, created_at: at,
      expires_at: new Date(Date.parse(at) + LINK_DAYS * DAY).toISOString(), revoked_at: null, use_count: 0,
    }
    links.push(row)
    linkIdByToken.set(token, row.id)
    return row
  }

  /** The link row of a code (any state — the RPCs decide what a revoked / expired / full link answers). */
  function linkByToken(token: string): FollowLinkRow | undefined {
    const id = linkIdByToken.get(token)
    return id === undefined ? undefined : links.find((link) => link.id === id)
  }

  /** revoke_follow_links: `revoked_at = now()` on every not yet revoked link of the owner. */
  function revokeLinksOf(owner: string): void {
    const at = stamp()
    for (const link of links) if (link.owner_id === owner && link.revoked_at === null) link.revoked_at = at
  }

  /** A live link is alive for its owner and every request through it (expires_at > now, not revoked). */
  function isLiveLink(link: FollowLinkRow): boolean {
    return link.revoked_at === null && alive(link.expires_at)
  }

  // ---- friend codes (create_friend_code / revoke_friend_codes / the code lookups, 20261027160000) ----------------

  /** My live codes, newest first. */
  function liveCodesOf(owner: string): FriendCodeRow[] {
    return codes
      .filter((row) => row.owner_id === owner && row.revoked_at === null && alive(row.expires_at))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1))
  }

  /**
   * create_friend_code's write: the owner's dead rows go; every live code but the 2 newest (all of them with
   * `replace`) is switched off; the new one joins (≤ 3 live). `code` is handed out once; only the private map keeps it.
   */
  function addCode(owner: string, code: string, replace: boolean): FriendCodeRow {
    const at = stamp()
    for (let index = codes.length - 1; index >= 0; index -= 1) {
      const row = codes[index]
      if (row && row.owner_id === owner && (row.revoked_at !== null || !alive(row.expires_at))) {
        codes.splice(index, 1)
        for (const [known, id] of codeIdByCode) if (id === row.id) codeIdByCode.delete(known)
      }
    }
    for (const old of liveCodesOf(owner).slice(replace ? 0 : LIVE_CODE_LIMIT - 1)) old.revoked_at = at
    const row: FriendCodeRow = {
      id: crypto.randomUUID(), owner_id: owner, created_at: at,
      expires_at: new Date(Date.parse(at) + CODE_HOURS * 3_600_000).toISOString(), revoked_at: null, use_count: 0,
    }
    codes.push(row)
    codeIdByCode.set(code, row.id)
    return row
  }

  /** The row of a canonical code (any state). */
  function codeRowOf(code: string): FriendCodeRow | undefined {
    const id = codeIdByCode.get(code)
    return id === undefined ? undefined : codes.find((row) => row.id === id)
  }

  function isLiveCode(row: FriendCodeRow): boolean {
    return row.revoked_at === null && alive(row.expires_at)
  }

  /** revoke_friend_codes (and revoke_follow_links since 20261027160000). */
  function revokeCodesOf(owner: string): void {
    const at = stamp()
    for (const row of codes) if (row.owner_id === owner && row.revoked_at === null) row.revoked_at = at
  }

  function addMiss(profileId: string): void {
    misses.push({ profile_id: profileId, missed_at: stamp() })
  }

  /** The caller's misses newer than `ms` ago. */
  function missesSince(profileId: string, ms: number): number {
    const from = clock() - ms
    return misses.filter((row) => row.profile_id === profileId && Date.parse(row.missed_at) > from).length
  }

  // ---- blocks (block_user / unblock_user of M2) ---------------------------------------------------------------

  /**
   * block_user's graph part: the block row (once), and the follows end in BOTH directions, accepted and pending
   * (INV-5). The silence of either side is NOT touched (INV-6) — it ends by itself after its 30 days.
   */
  function block(blocker: string, blocked: string): void {
    if (!blocks.some((row) => row.blocker_id === blocker && row.blocked_id === blocked)) {
      blocks.push({ blocker_id: blocker, blocked_id: blocked, created_at: stamp() })
    }
    removeFollow(blocker, blocked)
    removeFollow(blocked, blocker)
  }

  /** unblock_user: only the own block row goes; nothing comes back (no follow, no request). */
  function unblock(blocker: string, blocked: string): void {
    const index = blocks.findIndex((row) => row.blocker_id === blocker && row.blocked_id === blocked)
    if (index >= 0) blocks.splice(index, 1)
  }

  /** The people `blocker` blocked (newest first, like get_people_screen.blocked). */
  function blocksBy(blocker: string): BlockRow[] {
    return blocks
      .filter((row) => row.blocker_id === blocker)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.blocked_id < b.blocked_id ? -1 : 1))
  }

  /** Deletes the row follower → followee; returns its status before (null: there was none). */
  function removeFollow(follower: string, followee: string): FollowStatus | null {
    const index = follows.findIndex((row) => row.follower_id === follower && row.followee_id === followee)
    if (index < 0) return null
    const [row] = follows.splice(index, 1)
    return row?.status ?? null
  }

  /** delete_my_account(): the cascades of profiles → follows, follow_cooldowns, follow_links, blocks. */
  function removePerson(profileId: string): void {
    const drop = <T>(rows: T[], gone: (row: T) => boolean) => {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index]
        if (row !== undefined && gone(row)) rows.splice(index, 1)
      }
    }
    drop(follows, (row) => row.follower_id === profileId || row.followee_id === profileId)
    drop(cooldowns, (row) => row.follower_id === profileId || row.followee_id === profileId)
    drop(blocks, (row) => row.blocker_id === profileId || row.blocked_id === profileId)
    drop(links, (row) => row.owner_id === profileId)
    drop(codes, (row) => row.owner_id === profileId)
    drop(misses, (row) => row.profile_id === profileId)
    for (const [code, id] of codeIdByCode) if (!codes.some((row) => row.id === id)) codeIdByCode.delete(code)
    for (const [token, id] of linkIdByToken) if (!links.some((link) => link.id === id)) linkIdByToken.delete(token)
  }

  // ---- seeding and tests (service role) -------------------------------------------------------------------

  function seed(data: FollowGraphSeed): void {
    follows.push(...(data.follows ?? []).map((row) => ({ ...row })))
    cooldowns.push(...(data.cooldowns ?? []).map((row) => ({ ...row })))
    blocks.push(...(data.blocks ?? []).map((row) => ({ ...row })))
    links.push(...(data.links ?? []).map((row) => ({ ...row })))
  }

  /** A seeded link with a known code (the demo's fixed follow links, mocks/follows.ts). */
  function seedLink(row: FollowLinkRow, token: string): void {
    links.push({ ...row })
    linkIdByToken.set(token, row.id)
  }

  /** Accept a request or create an accepted follow at once (what respond_follow(true) leaves behind). */
  function accept(follower: string, followee: string): void {
    const at = stamp()
    const row = rowOf(follower, followee)
    if (row) {
      row.status = 'accepted'
      row.accepted_at = at
      row.expires_at = null
    } else {
      follows.push({ follower_id: follower, followee_id: followee, status: 'accepted', requested_at: at, expires_at: null, accepted_at: at })
    }
  }

  /** The silence of respond_follow(false) / remove_follower: `until` only grows (INV-6, greatest()). */
  function silence(followee: string, follower: string, days = 30): void {
    const until = new Date(clock() + days * DAY).toISOString()
    const row = cooldowns.find((c) => c.followee_id === followee && c.follower_id === follower)
    if (!row) cooldowns.push({ followee_id: followee, follower_id: follower, until })
    else if (Date.parse(until) > Date.parse(row.until)) row.until = until
  }

  return {
    // reads
    isBlockedPair, isAcceptedFollower, hasFollowCooldown, visibleRequest, iFollowState, followsMeState, visibleRelation, knowsProfile,
    followingOf, followersOf, visibleRequestsTo, liveLinkCount,
    // writes
    makeFollowRequest, removeFollow, removePerson, accept, silence, seed,
    // the follow actions' primitives (agent K2, mocks/follows.ts): links, blocks, the script hook
    liveLinksOf, addLink, linkByToken, revokeLinksOf, isLiveLink, block, unblock, blocksBy, seedLink, onRequested,
    // friend codes (20261027160000)
    liveCodesOf, addCode, codeRowOf, isLiveCode, revokeCodesOf, addMiss, missesSince,
    /** the live rows (service role: the follows agent's actions, tests) */
    tables: { follows, cooldowns, blocks, links, codes, misses },
  }
}
