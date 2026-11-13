import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_URL } from '../app'
import { AppError } from '../errors'
import { timed, unwrap, unwrapVoid } from './base'
import { asAccount, bearer, type CapturedAccount } from './identity'
import {
  asListScreen,
  asFreeWishes,
  type FreeWishes,
  asListsOverview,
  LIST_TITLE_MAX,
  type BannerKey,
  type FollowRequestStatus,
  type ListPatch,
  type ListScreen,
  type ListsDatabase,
  type ListsOverview,
  type ListVisibility,
  type NewListInput,
} from './lists.types'

// Wishlists without an occasion, the profile banner and the two follow calls of the "Wunschlisten" tab
// (docs/spec/follows-design.md v1.2 §5.2, §5.3, §5.5; §4.4 for the REST columns). Like every account-bound
// wrapper (contract.md §5.2): pinned to ONE account through identity.ts asAccount — the expected account is
// always the LAST parameter, a late answer for a former account arrives as session_expired.
//
// Secrecy: get_lists_overview never mentions reservations (no key on any card); get_list_screen sends the
// owner literal nulls. The visibility of a list changes ONLY through set_list_visibility (REST has no grant
// for it, even for the owner). Nothing here is cached on disk (the query keys live in memory only).

/** The same client as the other wrappers, typed with the wave-2 contract (lists.types.ts ListsDatabase). */
function client(account: CapturedAccount): SupabaseClient<ListsDatabase> {
  return account.supabase as unknown as SupabaseClient<ListsDatabase>
}

/** Giver-only, memory-only display. Never used to derive the product-ideas request. */
export function getFreeWishes(profileId: string, maxCents: number | null, expectedUserId: string): Promise<FreeWishes> {
  return timed('get_free_wishes', () => asAccount(expectedUserId, async (account) => {
    if (profileId === account.userId) throw new AppError('not_found')
    const result = await client(account).rpc('get_free_wishes', { p_profile_id: profileId, p_max_cents: maxCents }).setHeader('Authorization', bearer(account))
    return asFreeWishes(unwrap(result))
  }))
}

/** Client-side id of a new list: the card is there (and can open) before the server answered. */
export function newListId(): string {
  return crypto.randomUUID()
}

/**
 * The address of a list: https://<app>/lists/<id>. Sharing a list = this link for people who already follow (or are
 * guests of the occasion) — it opens only for whoever may read the list (get_list_screen: one not_found for everybody
 * else, so the id is no secret and grants nothing). For NEW people the share sheet uses the follow link
 * (follows.ts createFollowLink + buildFollowUrl): they ask, the owner confirms, then they see the "Meine Follower" lists.
 */
export function buildListUrl(listId: string): string {
  return `${APP_URL}/lists/${encodeURIComponent(listId)}`
}

/** The title as the database takes it: 1…80 characters, not blank (the original text is validated, not cut). */
export function validListTitle(raw: string): string {
  const title = raw.trim()
  if (title === '' || [...title].length > LIST_TITLE_MAX || /[\n\r\t]/.test(title)) throw new AppError('invalid_input')
  return title
}

// ---- one RPC per screen -------------------------------------------------------------------------------

/** The "Wunschlisten" tab — get_lists_overview() → { me, stats, my_lists, following, upcoming, suggestions }. */
export function getListsOverview(expectedUserId?: string): Promise<ListsOverview> {
  return timed('get_lists_overview', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_lists_overview').setHeader('Authorization', bearer(account))
    return asListsOverview(unwrap(result))
  }))
}

/**
 * A list's own screen — get_list_screen(p_list_id) → { list, viewer {role}, wishes }. Unknown id, an
 * occasion's list, "Nur ich" of someone else, not (yet) followed, removed, blocked: one answer, not_found.
 */
export function getListScreen(listId: string, expectedUserId?: string): Promise<ListScreen> {
  return timed('get_list_screen', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('get_list_screen', { p_list_id: listId }).setHeader('Authorization', bearer(account))
    try {
      return asListScreen(unwrap(result))
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('not_found', { cause: err })
    }
  }))
}

// ---- the owner's lists (REST; RLS: the owner writes, the trigger counts at most 20) --------------------

/**
 * Creates a list without an occasion with the client's id (optimistic). `visibility` is whatever the
 * person chose — the create sheet starts on 'private' ("Nur ich", §00.4). The 21st list → limit_reached.
 */
export function createList(input: NewListInput, expectedUserId?: string): Promise<{ id: string; created_at: string }> {
  return asAccount(expectedUserId, async (account) => {
    const result = await client(account)
      .from('wishlists')
      .insert({
        id: input.id,
        occasion_id: null,
        owner_id: account.userId,
        recipient_id: account.userId,
        title: validListTitle(input.title),
        visibility: input.visibility,
        cover_tone: input.cover_tone,
        cover_icon: input.cover_icon,
        due_on: input.due_on,
      })
      .select('id, created_at')
      .single()
      .setHeader('Authorization', bearer(account))
    return unwrap(result)
  })
}

/** Title, cover and date (the column grant); never the visibility. 0 rows (not mine / gone) → not_found. */
export function updateList(listId: string, patch: ListPatch, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    const values: ListPatch = { ...patch }
    if (typeof values.title === 'string') values.title = validListTitle(values.title)
    const result = await client(account).from('wishlists').update(values).eq('id', listId).select('id').single()
      .setHeader('Authorization', bearer(account))
    unwrap(result)
  })
}

/** Deletes the list with its wishes (cascade); the database ends what is attached to them by itself. */
export function deleteList(listId: string, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await client(account).from('wishlists').delete().eq('id', listId).setHeader('Authorization', bearer(account)))
  })
}

/**
 * set_list_visibility(p_list_id, p_visibility) → { ok: true } — the ONLY way to change who sees a list.
 * Not optimistic: the screen waits for the answer (§2.7). The answer is the same whatever happened inside.
 */
export function setListVisibility(listId: string, visibility: ListVisibility, expectedUserId?: string): Promise<void> {
  return timed('set_list_visibility', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('set_list_visibility', { p_list_id: listId, p_visibility: visibility })
      .setHeader('Authorization', bearer(account))
    unwrap(result)
  }))
}

/** profiles.banner (own row, column grant `banner`; no SELECT back — the overview carries it). */
export function setMyBanner(bannerKey: BannerKey, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await client(account).from('profiles').update({ banner: bannerKey }).eq('id', account.userId)
      .setHeader('Authorization', bearer(account)))
  })
}

// ---- follow calls the lists tab needs (agent K2 owns the follow screens and may move these) -------------

/**
 * request_follow(p_profile_id) → { status: 'requested' | 'following' } — "Folgen anfragen" under
 * "Aus deinen Anlässen". Only with a shared active occasion or when they follow me; else not_found.
 */
export function requestFollow(profileId: string, expectedUserId?: string): Promise<FollowRequestStatus> {
  return timed('request_follow', () => asAccount(expectedUserId, async (account) => {
    const result = await client(account).rpc('request_follow', { p_profile_id: profileId }).setHeader('Authorization', bearer(account))
    const status = (unwrap(result) as { status?: unknown }).status
    return status === 'following' ? 'following' : 'requested'
  }))
}

/** unfollow(p_profile_id) → { ok: true } — idempotent ("Nicht mehr folgen" on a followed list). */
export function unfollow(profileId: string, expectedUserId?: string): Promise<void> {
  return timed('unfollow', () => asAccount(expectedUserId, async (account) => {
    unwrap(await client(account).rpc('unfollow', { p_profile_id: profileId }).setHeader('Authorization', bearer(account)))
  }))
}
