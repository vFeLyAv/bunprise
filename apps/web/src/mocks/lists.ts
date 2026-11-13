import { http, HttpResponse, type JsonBodyType } from 'msw'
import {
  applyFilters,
  DEMO_SUPABASE_URL,
  DemoDbError,
  guarded,
  invalidBody,
  invalidInput,
  notImplemented,
  parseQuery,
  raise,
  readJson,
  respondRows,
  sessionExpiredError,
  wantsObject,
  wantsRepresentation,
  wantsUpsert,
  type Row,
} from './rest'
import { endOfLocalDay, zonedToMs } from './time'
import type { FollowRow } from './followGraph'
import { WISHLISTS, type DemoPerson, type DemoWorld, type ReservationRow, type WishlistRow, type WishRow } from './world'
import { DEMO_OCCASIONS, DEMO_PEOPLE } from './fixtures'

// Wave 2b of the demo server (docs/spec/follows-design.md v1.2; section 00 wins): the RPCs of the
// "Wunschlisten" tab and of a list's own screen, re-implemented on the in-memory world like mocks/world.ts
// does for the pilot — an independent copy of the SQL rules, so tests can compare the two:
//   get_lists_overview()            §5.2 — me, stats, my_lists, following, upcoming, suggestions (no reservation key anywhere)
//   get_list_screen(p_list_id)      §5.5 — owner branch: literal nulls; follower branch: reserved / reserved_by_me
//   set_list_visibility(p_list_id, p_visibility)  §5.5 — → 'private' ends the reservations on it (INV-1, access_ended)
//   request_follow(p_profile_id)    §5.4 — only with a shared active occasion or when they follow me; else not_found
//   unfollow(p_profile_id)          §5.4 — idempotent; an accepted follow ends the giver's reservations (unfollowed)
// plus REST insert / update / delete of wishlists (the world's insertWishlists …). The follows agent (K2)
// adds the other follow actions (respond, remove follower, links, block, people screen) and may move
// request_follow / unfollow next to them.
// The demo cast of wave 2 (seedListsDemo): fictional people only, invented lists and wishes, example.com links.

const DAY = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Payload = Readonly<Record<string, unknown>>
type Args = Readonly<Record<string, string | null>>

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** `(ts at time zone tz)::date` — the local calendar day of an instant (YYYY-MM-DD). */
function localDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The SQL's "today" — `(now() at time zone 'Europe/Berlin')::date` (v_today) — plus `days` calendar days. */
function berlinDay(ms: number, days = 0): string {
  const today = localDate(ms, 'Europe/Berlin')
  return days === 0 ? today : new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
}

/** `due_on::timestamp at time zone 'Europe/Berlin'` — the start of a list's day as an instant (dated_at). */
function berlinMidnight(day: string): number {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return zonedToMs(year, month, date, 0, 0, 'Europe/Berlin')
}

export type DemoListsApi = ReturnType<typeof createListsApi>

export function createListsApi(world: DemoWorld) {
  const t = world.internals
  const graph = world.follows

  /** private.profile_card() + the photo meta the VIEWER may see (20261024120000). */
  const profileCard = (id: string, viewer: string) => ({ id, display_name: t.nameOf(id), banner: world.profileSettingsOf(id).banner, ...t.profilePhotoFields(viewer, id) })
  // 20261027200000: by places — my own lists count every stored place, other people's the effective ones
  const wishCount = (listId: string): number => t.listWishes(listId, false).length
  const ownWishCount = (listId: string): number => t.listWishes(listId, true).length

  /** The end of an occasion (ends_at, else the next local midnight), like get_feed. */
  const occasionEnd = (occasion: { starts_at: string; ends_at: string | null; tz: string }): number =>
    occasion.ends_at !== null ? Date.parse(occasion.ends_at) : endOfLocalDay(Date.parse(occasion.starts_at), occasion.tz)

  /**
   * private.follower_list_cards' order: a future date first (ascending), then newest first, then id — never
   * anything about reservations.
   */
  function standaloneOrder(today: string) {
    return (a: WishlistRow, b: WishlistRow): number => {
      const aDated = a.due_on !== null && a.due_on >= today
      const bDated = b.due_on !== null && b.due_on >= today
      if (aDated !== bDated) return aDated ? -1 : 1
      return (aDated ? byText(a.due_on ?? '', b.due_on ?? '') : 0) || byText(b.created_at, a.created_at) || byText(a.id, b.id)
    }
  }

  /** private.shared_occasions' order: upcoming ones first (by start), then past ones (latest first), then id. */
  type SharedOccasion = { id: string; title: string; starts: number; past: boolean }
  const sharedOrder = (a: SharedOccasion, b: SharedOccasion): number =>
    (a.past !== b.past ? (a.past ? 1 : -1) : a.past ? b.starts - a.starts : a.starts - b.starts) || byText(a.id, b.id)

  // ---- get_lists_overview() -----------------------------------------------------------------------------

  /**
   * OWNER BRANCH (my lists) and VIEWER BRANCH (lists of others, driven from MY follows and MY active guest
   * memberships, filtered by can_read_wishlist) — the function never touches the reservations at all (F18).
   */
  function getListsOverview(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    const now = t.clock()
    const today = berlinDay(now)
    const soon = berlinDay(now, 60)

    // OWNER BRANCH: wishlists + wishes only
    const ownStandalone = [...t.wishlists.values()].filter((list) => list.owner_id === viewer && list.occasion_id === null)
    const hosted = [...t.wishlists.values()].flatMap((list) => {
      const occasion = list.occasion_id !== null && list.owner_id === viewer ? t.occasions.get(list.occasion_id) : undefined
      if (!occasion || occasionEnd(occasion) < now - 30 * DAY) return []
      return [{ list, occasion }]
    })
    // grp 0: a future date / a running occasion (by dated_at, an instant), 1: no future date (newest first),
    // 2: an occasion ended at most 30 days ago (latest start first) — each then by id
    type Entry = { group: number; at: number; created: string; card: Record<string, unknown> }
    const entries: Entry[] = [
      ...ownStandalone.map((list): Entry => {
        const dated = list.due_on !== null && list.due_on >= today
        return {
          group: dated ? 0 : 1,
          at: dated && list.due_on !== null ? berlinMidnight(list.due_on) : 0,
          created: list.created_at,
          card: {
            id: list.id, title: list.title, kind: 'standalone', visibility: list.visibility, cover_tone: list.cover_tone,
            cover_icon: list.cover_icon, due_on: list.due_on, photo: t.listPhotoMeta(list.id), wish_count: ownWishCount(list.id), occasion: null,
            created_at: list.created_at,
          },
        }
      }),
      ...hosted.map(({ list, occasion }): Entry => {
        const ended = occasionEnd(occasion) < now
        return {
          group: ended ? 2 : 0,
          at: Date.parse(occasion.starts_at),
          created: list.created_at,
          card: {
            // the list's own title like the SQL (the client falls back to the occasion's title)
            id: list.id, title: list.title, kind: 'occasion', visibility: 'occasion', cover_tone: null, cover_icon: null,
            due_on: null, photo: t.listPhotoMeta(list.id), wish_count: ownWishCount(list.id),
            occasion: { id: occasion.id, title: occasion.title, starts_at: occasion.starts_at, tz: occasion.tz, all_day: occasion.all_day },
            created_at: list.created_at,
          },
        }
      }),
    ]
    entries.sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group
      const byId = byText(String(a.card.id), String(b.card.id))
      if (a.group === 0) return a.at - b.at || byId
      if (a.group === 1) return byText(b.created, a.created) || byId
      return b.at - a.at || byId // past occasions: latest start first
    })
    const myLists = entries.map((entry) => entry.card)

    // VIEWER BRANCH: follower lists of the people I follow …
    const followed = graph.followingOf(viewer).filter((row) => t.people.has(row.followee_id))
    const readableOf = (ownerId: string): WishlistRow[] => [...t.wishlists.values()]
      .filter((list) => list.owner_id === ownerId && list.occasion_id === null && list.visibility === 'followers' && t.canReadWishlist(list.id, viewer))
      .sort(standaloneOrder(today))
    const newSince = new Date(now - 7 * DAY).toISOString()
    const following = followed
      .map((row: FollowRow) => {
        const lists = readableOf(row.followee_id).map((list) => ({
          id: list.id, title: list.title, cover_tone: list.cover_tone, cover_icon: list.cover_icon, due_on: list.due_on,
          photo: t.listPhotoMeta(list.id),
          wish_count: wishCount(list.id),
          new_wish_count: t.listWishes(list.id, false).filter((wish) => wish.created_at > newSince).length,
        }))
        return {
          profile: profileCard(row.followee_id, viewer),
          mutual: graph.isAcceptedFollower(row.followee_id, viewer),
          accepted_at: row.accepted_at,
          lists,
        }
      })
      .sort((a, b) => byText(a.profile.display_name ?? '', b.profile.display_name ?? '') || byText(a.profile.id, b.profile.id))

    // … and the occasion lists of the occasions I am an active guest of (upcoming or ended ≤ 30 days ago)
    const guestLists = t.members
      .filter((member) => member.profile_id === viewer && member.role === 'member' && member.status === 'active')
      .flatMap((member) => {
        const occasion = t.occasions.get(member.occasion_id)
        if (!occasion || occasionEnd(occasion) < now - 30 * DAY) return []
        return t.listsOf(occasion.id)
          .filter((list) => list.owner_id === occasion.host_id && list.owner_id !== viewer && t.canReadWishlist(list.id, viewer))
          .map((list) => ({ list, occasion }))
      })

    const upcoming = [
      ...guestLists
        .filter(({ occasion }) => occasionEnd(occasion) >= now)
        .map(({ list, occasion }) => ({
          date: localDate(Date.parse(occasion.starts_at), occasion.tz),
          entry: {
            list: { id: list.id, title: list.title ?? occasion.title, cover_tone: null, cover_icon: null, wish_count: wishCount(list.id), occasion_id: occasion.id,
              photo: t.listPhotoMeta(list.id) },
            owner: { id: occasion.host_id, display_name: t.nameOf(occasion.host_id) },
            kind: 'occasion',
          },
        })),
      ...followed.flatMap((row) => readableOf(row.followee_id)
        .filter((list) => list.due_on !== null && list.due_on >= today && list.due_on <= soon)
        .map((list) => ({
          date: list.due_on ?? today,
          entry: {
            list: { id: list.id, title: list.title, cover_tone: list.cover_tone, cover_icon: list.cover_icon, wish_count: wishCount(list.id), occasion_id: null,
              photo: t.listPhotoMeta(list.id) },
            owner: { id: list.owner_id, display_name: t.nameOf(list.owner_id) },
            kind: 'standalone',
          },
        }))),
    ]
      .filter(({ date }) => date >= today && date <= soon)
      .sort((a, b) => byText(a.date, b.date) || byText(a.entry.list.id, b.entry.list.id))
      .map(({ date, entry }) => ({ ...entry, date }))

    // suggestions: co-members of recent/upcoming occasions who switched it on themselves (in_suggestions),
    // with current consents; no block, no relation VISIBLE to me, not in MY silence (never their silence)
    // (the title is the FIRST shared occasion: upcoming ones by start, then past ones latest first — like the SQL)
    const shared = new Map<string, SharedOccasion>()
    for (const mine of t.members) {
      if (mine.profile_id !== viewer || mine.status !== 'active') continue
      const occasion = t.occasions.get(mine.occasion_id)
      if (!occasion || occasionEnd(occasion) < now - 30 * DAY) continue
      const candidate: SharedOccasion = { id: occasion.id, title: occasion.title, starts: Date.parse(occasion.starts_at), past: occasionEnd(occasion) < now }
      for (const other of t.activeMembers(occasion.id)) {
        if (other.profile_id === viewer) continue
        const seen = shared.get(other.profile_id)
        if (!seen || sharedOrder(candidate, seen) < 0) shared.set(other.profile_id, candidate)
      }
    }
    const suggestions = [...shared.entries()]
      .filter(([id]) => world.profileSettingsOf(id).in_suggestions && t.hasConsents(id) && t.nameOf(id) !== null
        && !graph.isBlockedPair(viewer, id) && !graph.visibleRelation(viewer, id) && !graph.hasFollowCooldown(viewer, id))
      .map(([id, occasion]) => ({ profile: { id, display_name: t.nameOf(id), ...t.profilePhotoFields(viewer, id) }, shared_occasion_title: occasion.title }))
      .sort((a, b) => byText(a.profile.display_name ?? '', b.profile.display_name ?? '') || byText(a.profile.id, b.profile.id))
      .slice(0, 10)

    const friendsLists = following.reduce((sum, person) => sum + person.lists.length, 0) + guestLists.length
    return {
      me: { id: viewer, display_name: t.nameOf(viewer), banner: world.profileSettingsOf(viewer).banner, ...t.ownProfilePhotos(viewer), live_links: graph.liveLinkCount(viewer) },
      stats: {
        my_wishes: myLists.reduce((sum, card) => sum + (typeof card.wish_count === 'number' ? card.wish_count : 0), 0),
        my_lists: myLists.length,
        friends_lists: friendsLists,
        followers: graph.followersOf(viewer).filter((row) => t.people.has(row.follower_id)).length,
        following: followed.length,
        requests: graph.visibleRequestsTo(viewer).filter((row) => t.people.has(row.follower_id)).length,
      },
      my_lists: myLists,
      following,
      upcoming,
      suggestions,
    }
  }

  // ---- get_list_screen(p_list_id) ---------------------------------------------------------------------------

  function getListScreen(viewer: string, listId: string | null): JsonBodyType {
    t.requireUser(viewer)
    const list = listId === null ? undefined : t.wishlists.get(listId)
    // unknown id, an occasion's list, "Nur ich" of someone else, not (yet) a follower, blocked: one answer
    if (!list || list.occasion_id !== null || !t.canReadWishlist(list.id, viewer)) throw raise('not_found')
    const owner = viewer === list.owner_id || viewer === list.recipient_id
    // 20261022160000: open / received; 20261027200000: the owner's STORED places, a follower's effective ones
    const { open, received } = world.splitReceived(t.listWishes(list.id, owner))
    const row = (wish: WishRow, reserved: boolean | null, mine: boolean | null) => ({
      id: wish.id, title: wish.title, url: wish.url, price_cents: wish.price_cents, currency: wish.currency, note: wish.note,
      priority: wish.priority, created_at: wish.created_at, reserved, reserved_by_me: mine,
      ...t.wishDetails(wish), // 20261022120000 (+ received_at 20261022160000): about the wish only
    })
    const rows = (wishes: readonly WishRow[]) => owner
      // OWNER BRANCH: literal nulls; reservations are not even looked at (+ home, paused, also_in)
      ? wishes.map((wish) => ({ ...row(wish, null, null), ...t.ownerPlaceFields(wish, list.id), together: t.togetherForOwner(wish, viewer) }))
      // FOLLOWER BRANCH: only "taken" and "taken by me" — never who; only a LIVE reservation; no hints (Q18)
      : wishes.map((wish) => {
        const held = t.liveReservation(wish.id)
        return { ...row(wish, held !== undefined, held?.reserver_id === viewer), also_in: null, together: t.togetherForViewer(wish, viewer) }
      })
    return {
      list: {
        id: list.id, title: list.title, kind: 'standalone', visibility: list.visibility, cover_tone: list.cover_tone,
        cover_icon: list.cover_icon, due_on: list.due_on, created_at: list.created_at, owner: profileCard(list.owner_id, viewer),
        photo: t.listPhotoMeta(list.id),
      },
      viewer: { role: owner ? 'owner' : 'follower' },
      wishes: rows(open),
      received: rows(received),
    }
  }

  // ---- set_list_visibility(p_list_id, p_visibility) ---------------------------------------------------------

  function setListVisibility(viewer: string, listId: string | null, visibility: string | null): JsonBodyType {
    t.requireUser(viewer)
    if (visibility !== 'private' && visibility !== 'followers') throw raise('validation')
    const list = listId === null ? undefined : t.wishlists.get(listId)
    if (!list || list.owner_id !== viewer || list.occasion_id !== null) throw raise('not_found') // foreign / unknown / an occasion's
    if (visibility === 'followers') { // widening; narrowing needs nothing
      if (!t.hasConsents(viewer)) throw raise('consent_required')
      if (!t.profileComplete(viewer)) throw raise('profile_incomplete')
    }
    list.visibility = visibility
    list.updated_at = t.stamp()
    // INV-1: no access, no reservation — the same answer whatever there was
    if (visibility === 'private') t.endListReservations(list.id, 'access_ended')
    return { ok: true }
  }

  // ---- request_follow / unfollow (the two follow calls the lists tab makes) -----------------------------------

  function requestFollow(viewer: string, profileId: string | null): JsonBodyType {
    t.requireUser(viewer)
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if (!t.profileComplete(viewer)) throw raise('profile_incomplete')
    if (profileId === null || profileId === viewer) throw raise('not_found')
    // a caller with a live outgoing row (pending or accepted) gets its state back — only their own row is read,
    // so a silently declined request answers exactly like a waiting one (INV-3)
    if (!t.people.has(profileId) || graph.isBlockedPair(viewer, profileId)
      || !(t.sharesOccasion(viewer, profileId) || graph.isAcceptedFollower(profileId, viewer) || graph.iFollowState(viewer, profileId) !== 'none')) {
      throw raise('not_found') // unknown, a stranger, blocked: one answer
    }
    const state = graph.makeFollowRequest(viewer, profileId, () => raise('limit_reached'))
    return { status: state === 'following' ? 'following' : 'requested' }
  }

  function unfollow(viewer: string, profileId: string | null): JsonBodyType {
    t.requireUser(viewer)
    if (profileId === null) return { ok: true }
    const before = graph.removeFollow(viewer, profileId)
    if (before === 'accepted') t.endFollowReservations(viewer, profileId, 'unfollowed') // INV-1
    return { ok: true } // also without consents: it narrows
  }

  function getFreeWishes(viewer: string, profileId: string | null, maxCents: number | null): JsonBodyType {
    t.requireUser(viewer)
    if (maxCents !== null && (!Number.isInteger(maxCents) || maxCents < 0 || maxCents > 100_000_000)) throw raise('validation')
    const readable = [...t.wishlists.values()].filter((list) => list.owner_id === profileId && t.canReadWishlist(list.id, viewer))
    if (!profileId || profileId === viewer || graph.isBlockedPair(viewer, profileId) || readable.length === 0) throw raise('not_found')
    // 20261027200000: ONE entry per wish (not per place): `list` = its first place (by date, the home first), `lists`
    // = every place the viewer reads it in; only a LIVE reservation takes it out
    type Place = { id: string; title: string; kind: 'occasion' | 'standalone'; date: string | null; occasion_id: string | null; photo: ReturnType<typeof t.listPhotoMeta>; home: boolean }
    const placesByWish = new Map<string, { wish: WishRow; places: Place[] }>()
    for (const list of readable) {
      const occasion = list.occasion_id ? t.occasions.get(list.occasion_id) : undefined
      if (list.recipient_id === viewer || (list.occasion_id !== null && (!occasion || occasionEnd(occasion) < t.clock()))) continue
      const date = list.due_on ?? (occasion ? localDate(Date.parse(occasion.starts_at), occasion.tz) : null)
      for (const wish of t.listWishes(list.id, false)) {
        const entry = placesByWish.get(wish.id) ?? { wish, places: [] }
        entry.places.push({ id: list.id, title: list.title ?? occasion?.title ?? '', kind: list.occasion_id ? 'occasion' : 'standalone', date,
          occasion_id: list.occasion_id, photo: t.listPhotoMeta(list.id), home: wish.wishlist_id === list.id })
        placesByWish.set(wish.id, entry)
      }
    }
    const placeOrder = (a: Place, b: Place) => byText(a.date ?? '9999', b.date ?? '9999') || Number(b.home) - Number(a.home) || byText(a.id, b.id)
    const ideas = [...placesByWish.values()]
      // 20261022160000: a received wish is no gift idea any more
      .filter(({ wish }) => !wish.received_at && !t.liveReservation(wish.id) && (maxCents === null || wish.price_cents === null || wish.price_cents <= maxCents))
      .map(({ wish, places }) => {
        const lists = [...places].sort(placeOrder).map(({ home: _home, ...place }) => place)
        return {
          wish_id: wish.id, title: wish.title, url: wish.url, price_cents: wish.price_cents, currency: wish.currency, priority: wish.priority, created_at: wish.created_at,
          list: lists[0]!, lists,
          ...t.wishDetails(wish),
        }
      }).sort((a, b) => byText(a.list.date ?? '9999', b.list.date ?? '9999') || b.priority - a.priority || (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity) || byText(a.created_at, b.created_at) || byText(a.wish_id, b.wish_id))
    return { person: profileCard(profileId, viewer), ideas }
  }

  return { getListsOverview, getListScreen, getFreeWishes, setListVisibility, requestFollow, unfollow }
}

// ---- HTTP ------------------------------------------------------------------------------------------------

export interface ListsHandlerOptions {
  world: DemoWorld
  /** profile id of the request's valid demo session, or null */
  viewerOf: (request: Request) => string | null
}

function isPayload(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createListsHandlers({ world, viewerOf }: ListsHandlerOptions) {
  const rest = `${DEMO_SUPABASE_URL}/rest/v1`
  const api = createListsApi(world)

  function viewer(request: Request): string {
    const id = viewerOf(request)
    if (id === null) throw sessionExpiredError()
    return id
  }

  /** POST /rest/v1/rpc/<name>; PostgREST finds a function by its exact argument names (like mocks/social.ts). */
  function rpc(name: string, params: Readonly<Record<string, 'uuid' | 'text'>>, run: (me: string, args: Args) => JsonBodyType) {
    return http.post(`${rest}/rpc/${name}`, ({ request }) => guarded(async () => {
      const input = (await readJson(request)) ?? {}
      if (!isPayload(input)) throw invalidBody()
      const given = Object.keys(input)
      const expected = Object.keys(params)
      if (given.length !== expected.length || given.some((key) => !expected.includes(key))) {
        throw new DemoDbError('PGRST202', `Could not find the function public.${name}(${given.join(', ')}) in the schema cache`, 404)
      }
      const args: Record<string, string | null> = {}
      for (const [key, type] of Object.entries(params)) {
        const value = input[key]
        if (value === null || value === undefined) args[key] = null
        else if (type === 'uuid') {
          if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput('uuid')
          args[key] = value.toLowerCase()
        } else args[key] = typeof value === 'string' ? value : JSON.stringify(value)
      }
      return HttpResponse.json(run(viewer(request), args))
    }))
  }

  const arg = (args: Args, key: string): string | null => args[key] ?? null
  const rows = (me: string): readonly WishlistRow[] => world.wishlistRows(me)

  function writeQuery(request: Request) {
    const query = parseQuery(request, WISHLISTS, { projection: wantsRepresentation(request) })
    if (query.embeds.length > 0) throw notImplemented()
    return query
  }

  return [
    http.post(`${rest}/rpc/get_free_wishes`, ({ request }) => guarded(async () => {
      const input = await readJson(request)
      if (!isPayload(input)) throw invalidBody()
      if (!('p_profile_id' in input) || Object.keys(input).some((key) => key !== 'p_profile_id' && key !== 'p_max_cents')) throw new DemoDbError('PGRST202', 'Unknown get_free_wishes arguments', 404)
      const id = input.p_profile_id
      if (id !== null && (typeof id !== 'string' || !UUID.test(id))) throw invalidInput('uuid')
      const max = input.p_max_cents ?? null
      if (max !== null && (typeof max !== 'number' || !Number.isInteger(max))) throw invalidInput('integer')
      return HttpResponse.json(api.getFreeWishes(viewer(request), id as string | null, max as number | null))
    })),
    rpc('get_lists_overview', {}, (me) => api.getListsOverview(me)),
    rpc('get_list_screen', { p_list_id: 'uuid' }, (me, args) => api.getListScreen(me, arg(args, 'p_list_id'))),
    rpc('set_list_visibility', { p_list_id: 'uuid', p_visibility: 'text' },
      (me, args) => api.setListVisibility(me, arg(args, 'p_list_id'), arg(args, 'p_visibility'))),
    rpc('request_follow', { p_profile_id: 'uuid' }, (me, args) => api.requestFollow(me, arg(args, 'p_profile_id'))),
    rpc('unfollow', { p_profile_id: 'uuid' }, (me, args) => api.unfollow(me, arg(args, 'p_profile_id'))),

    // ---- wishlists: the owner creates lists without an occasion, edits title/cover/date, deletes --------------
    http.post(`${rest}/wishlists`, ({ request }) => guarded(async () => {
      const query = writeQuery(request)
      if (wantsUpsert(request)) throw notImplemented()
      const payload = await readJson(request)
      const inputs: unknown[] = Array.isArray(payload) ? payload : [payload]
      if (!inputs.every(isPayload)) throw invalidBody()
      const created = world.insertWishlists(viewer(request), inputs, wantsObject(request))
      return wantsRepresentation(request) ? respondRows(request, created as readonly Row[], query.columns, 201) : new HttpResponse(null, { status: 201 })
    })),
    http.patch(`${rest}/wishlists`, ({ request }) => guarded(async () => {
      const query = writeQuery(request)
      const payload = await readJson(request)
      if (!isPayload(payload)) throw invalidBody()
      const me = viewer(request)
      const changed = world.updateWishlists(me, applyFilters(rows(me), query), payload, wantsObject(request))
      return wantsRepresentation(request) ? respondRows(request, changed as readonly Row[], query.columns) : new HttpResponse(null, { status: 204 })
    })),
    http.delete(`${rest}/wishlists`, ({ request }) => guarded(() => {
      const query = writeQuery(request)
      const me = viewer(request)
      const removed = world.deleteWishlists(me, applyFilters(rows(me), query), wantsObject(request))
      return wantsRepresentation(request) ? respondRows(request, removed as readonly Row[], query.columns) : new HttpResponse(null, { status: 204 })
    })),
  ]
}

// ---- the demo cast of wave 2 ----------------------------------------------------------------------------

/** Fictional people of the lists demo (ids fixed: a reload rebuilds the same world). */
export const DEMO_LIST_PEOPLE = {
  paula: { id: 'd1e0a000-0000-4000-8000-000000000004', name: 'Paula Brandt' },
  finn: { id: 'd1e0a000-0000-4000-8000-000000000005', name: 'Finn Weber' },
  greta: { id: 'd1e0a000-0000-4000-8000-000000000006', name: 'Greta Lindner' },
  rosa: { id: 'd1e0a000-0000-4000-8000-000000000007', name: 'Rosa Klein' },
} as const

export const DEMO_LISTS = {
  annaWishes: 'd1e0c000-0000-4000-8000-0000000000a1',
  annaBirthday: 'd1e0c000-0000-4000-8000-0000000000a2',
  annaPrivate: 'd1e0c000-0000-4000-8000-0000000000a3',
  paulaChristmas: 'd1e0c000-0000-4000-8000-0000000000b1',
  paulaBooks: 'd1e0c000-0000-4000-8000-0000000000b2',
  benIdeas: 'd1e0c000-0000-4000-8000-0000000000c1',
  benGames: 'd1e0c000-0000-4000-8000-0000000000c2',
} as const

/** The wish in "Annas Wünsche" that Paula reserved (the demo user sees "Reserviert", Anna sees nothing). */
export const DEMO_LIST_RESERVED_WISH = 'd1e0d000-0000-4000-8000-000000000302'
/** The wish in "Annas Wünsche" that Anna marked as received (20261022160000: in the list's "received" part). */
export const DEMO_LIST_RECEIVED_WISH = 'd1e0d000-0000-4000-8000-000000000306'

/**
 * Seeds the wave-2 world around the demo account `me` (the first account of a page load,
 * handlers.ts DEMO_USER_ID — it does not exist yet; the rows wait for it):
 * - me ↔ Anna and me ↔ Paula follow each other ("Ihr folgt euch"); I follow Ben, Ben does not follow me
 *   ("Folgt dir nicht"; his "Brettspiele" is for followers → "Meine · Abonniert", Felix 26.10); Rosa follows me; Finn and Greta asked;
 * - Anna: "Annas Wünsche" (6, 2 new) and "Geburtstag" (in 12 days → "Bald"), both for followers, and a
 *   "Nur ich" list nobody else sees; Paula: "Weihnachten" (24 Dec) and "Bücher"; Ben: "Brettspiele" and a "Nur ich" list;
 * - Clara switched "In Vorschlägen aus Anlässen erscheinen" on → "Aus deinen Anlässen" (Annas Einweihung);
 * - Paula reserved one of Anna's wishes (others see "Reserviert"; Anna never sees anything).
 * My own "Meine" stays empty: the account creates its first list itself (the empty state shows first).
 */
export function seedListsDemo(world: DemoWorld, me: string, nowMs: number = Date.now()): void {
  const ago = (days: number, hours = 0): string => new Date(nowMs - days * DAY - hours * 3_600_000).toISOString()
  const friend = ({ id, name }: { id: string; name: string }): DemoPerson => ({ id, displayName: () => name, hasConsents: () => true })
  const { anna, ben, clara } = DEMO_PEOPLE
  const { paula, finn, greta, rosa } = DEMO_LIST_PEOPLE
  for (const person of [paula, finn, greta, rosa]) world.addPerson(friend(person))

  const year = new Date(nowMs).getUTCFullYear()
  const christmas = berlinDay(nowMs) <= `${year}-12-24` ? `${year}-12-24` : `${year + 1}-12-24`
  const list = (id: string, owner: string, title: string, visibility: 'private' | 'followers', tone: number | null, icon: string | null, dueOn: string | null, created: string) => ({
    id, occasion_id: null, owner_id: owner, recipient_id: owner, title, created_at: created, updated_at: created,
    visibility, cover_tone: tone, cover_icon: icon, due_on: dueOn,
  })
  type WishSeed = [id: string, title: string, priority: WishRow['priority'], priceCents: number | null, url: string | null, note: string | null, daysAgo: number]
  const wishesFor = (wishlistId: string, seeds: readonly WishSeed[]): WishRow[] => seeds.map(([id, title, priority, priceCents, url, note, daysAgo]) => {
    const at = ago(daysAgo, 2)
    return { id, wishlist_id: wishlistId, title, price_cents: priceCents, currency: 'EUR', url, note, priority, created_at: at, updated_at: at }
  })
  const w = (n: number): string => `d1e0d000-0000-4000-8000-${String(300 + n).padStart(12, '0')}`

  const reservations: ReservationRow[] = [{
    id: 'd1e0f000-0000-4000-8000-000000000301', wish_id: DEMO_LIST_RESERVED_WISH, wishlist_id: DEMO_LISTS.annaWishes,
    recipient_id: anna.id, reserver_id: paula.id, status: 'active', end_reason: null,
    wish_title_snapshot: 'Wanderrucksack, 28 Liter', created_at: ago(6), ended_at: null,
  }]

  world.seed({
    people: [],
    occasions: [],
    members: [],
    wishlists: [
      list(DEMO_LISTS.annaWishes, anna.id, 'Annas Wünsche', 'followers', 2, 'star', null, ago(40)),
      list(DEMO_LISTS.annaBirthday, anna.id, 'Geburtstag', 'followers', 1, 'cake', berlinDay(nowMs, 12), ago(21)),
      list(DEMO_LISTS.annaPrivate, anna.id, 'Nur für mich', 'private', 4, 'heart', null, ago(15)),
      list(DEMO_LISTS.paulaChristmas, paula.id, 'Weihnachten', 'followers', 3, 'tree', christmas, ago(30)),
      list(DEMO_LISTS.paulaBooks, paula.id, 'Bücher', 'followers', 4, 'book', null, ago(50)),
      list(DEMO_LISTS.benIdeas, ben.id, 'Bens Ideen', 'private', null, 'game', null, ago(12)),
      list(DEMO_LISTS.benGames, ben.id, 'Brettspiele', 'followers', 5, 'game', null, ago(9)),
    ],
    wishes: [
      ...wishesFor(DEMO_LISTS.annaWishes, [
        [w(1), 'Kopfhörer mit Geräuschunterdrückung', 3, 12900, 'https://example.com/kopfhoerer', 'Gern in Dunkelblau', 20],
        [DEMO_LIST_RESERVED_WISH, 'Wanderrucksack, 28 Liter', 2, 8990, 'https://example.com/rucksack', null, 14],
        [w(3), 'Gutschein für einen Pasta-Kochkurs', 3, 6500, null, 'Am liebsten an einem Wochenende', 3],
        [w(4), 'Leinen-Bettwäsche', 1, 7900, 'https://example.com/bettwaesche', '135 × 200', 30],
        [w(5), 'Pflanzenständer aus Holz', 2, 3450, null, null, 2],
        [w(6), 'Sofortbildfilm, Doppelpack', 1, 1899, null, null, 9],
      ]),
      ...wishesFor(DEMO_LISTS.annaBirthday, [
        [w(11), 'Konzertkarten für zwei', 3, 9000, null, 'Irgendwas mit Jazz', 5],
        [w(12), 'Espressotassen-Set', 2, 3200, 'https://example.com/espressotassen', null, 10],
        [w(13), 'Picknickdecke', 1, 3990, null, null, 12],
        [w(14), 'Backbuch für Sauerteig', 2, 2400, null, null, 1],
      ]),
      ...wishesFor(DEMO_LISTS.annaPrivate, [
        [w(21), 'Neue Laufschuhe', 2, 11000, null, null, 4],
        [w(22), 'Tagebuch mit Leineneinband', 1, 1900, null, null, 8],
      ]),
      ...wishesFor(DEMO_LISTS.paulaChristmas, [
        [w(31), 'Wollschal in Senfgelb', 3, 4500, null, null, 25],
        [w(32), 'Puzzle mit 1000 Teilen', 2, 2200, null, 'Gern ein Landschaftsmotiv', 22],
        [w(33), 'Tee-Adventskalender', 2, 2990, 'https://example.com/tee', null, 18],
        [w(34), 'Handschuhe mit Touch-Fingern', 1, 1990, null, null, 16],
        [w(35), 'Kerzenhalter aus Messing', 1, 3600, null, null, 11],
      ]),
      ...wishesFor(DEMO_LISTS.paulaBooks, [
        [w(41), 'Ein Roman über das Meer', 2, 2400, null, 'Taschenbuch reicht', 45],
        [w(42), 'Bildband über Gärten', 3, 3900, null, null, 33],
        [w(43), 'Kochbuch für eine Pfanne', 1, 2200, null, null, 27],
        [w(44), 'Lesezeichen aus Leder', 1, 1200, null, null, 4],
      ]),
      ...wishesFor(DEMO_LISTS.benIdeas, [
        [w(51), 'Brettspiel für Zwei', 2, 3500, null, null, 6],
        [w(52), 'Grillthermometer', 1, 2500, null, null, 5],
      ]),
      ...wishesFor(DEMO_LISTS.benGames, [
        [w(61), 'Kooperatives Kartenspiel', 3, 1500, null, null, 7],
        [w(62), 'Würfelturm aus Holz', 1, 2900, null, 'Gern mit Deckel', 4],
        [w(63), 'Erweiterung für Siedlerspiel', 2, 2200, null, null, 2],
      ]),
    ],
    invites: [],
    reservations,
  })
  // 20261027200000 (one wish in several lists): Anna put two wishes into the list of her housewarming (fixtures.ts) as
  // well — the plant stand from "Annas Wünsche" (I follow her: "auch in „Annas Wünsche“") and the diary from her
  // "Nur für mich" list ("auch in einer anderen Liste"); one wish, one reservation in both places
  world.seedPlacement(w(5), DEMO_HOUSEWARMING_LIST, ago(1))
  world.seedPlacement(w(22), DEMO_HOUSEWARMING_LIST, ago(1))
  // "Erhalten" (20261022160000): Anna got the instant film already — followers see it in the received part
  const received = world.internals.wishes.get(DEMO_LIST_RECEIVED_WISH)
  if (received) received.received_at = ago(3)

  world.follows.seed({
    follows: [
      { follower_id: me, followee_id: anna.id, status: 'accepted', requested_at: ago(41), expires_at: null, accepted_at: ago(40) },
      { follower_id: anna.id, followee_id: me, status: 'accepted', requested_at: ago(40), expires_at: null, accepted_at: ago(39) },
      { follower_id: me, followee_id: ben.id, status: 'accepted', requested_at: ago(26), expires_at: null, accepted_at: ago(25) },
      { follower_id: me, followee_id: paula.id, status: 'accepted', requested_at: ago(21), expires_at: null, accepted_at: ago(20) },
      { follower_id: paula.id, followee_id: me, status: 'accepted', requested_at: ago(19), expires_at: null, accepted_at: ago(18) },
      { follower_id: rosa.id, followee_id: me, status: 'accepted', requested_at: ago(11), expires_at: null, accepted_at: ago(10) },
      { follower_id: finn.id, followee_id: me, status: 'pending', requested_at: ago(2), expires_at: ago(-28), accepted_at: null },
      { follower_id: greta.id, followee_id: me, status: 'pending', requested_at: ago(0, 6), expires_at: ago(-30, 6), accepted_at: null },
      // the circle around Anna (never shown to me: nobody sees anyone else's followers)
      { follower_id: paula.id, followee_id: anna.id, status: 'accepted', requested_at: ago(60), expires_at: null, accepted_at: ago(59) },
      { follower_id: anna.id, followee_id: paula.id, status: 'accepted', requested_at: ago(58), expires_at: null, accepted_at: ago(57) },
    ],
  })

  world.setProfileSettings(anna.id, { banner: 'meadow', in_suggestions: true })
  world.setProfileSettings(paula.id, { banner: 'confetti', in_suggestions: false })
  world.setProfileSettings(ben.id, { banner: null, in_suggestions: false })
  world.setProfileSettings(clara.id, { banner: 'sky', in_suggestions: true })
}

/** The list of "Annas Einweihung" (fixtures.ts LISTS.housewarming): two of Anna's wishes live there as well. */
export const DEMO_HOUSEWARMING_LIST = 'd1e0c000-0000-4000-8000-000000000001'
/** The shared wishes of the demo (20261027200000). */
export const DEMO_SHARED_WISHES = { plantStand: 'd1e0d000-0000-4000-8000-000000000305', diary: 'd1e0d000-0000-4000-8000-000000000322' } as const

/** The occasion the demo account shares with Clara (the suggestion's source, fixtures.ts). */
export const DEMO_SUGGESTION_OCCASION = DEMO_OCCASIONS.housewarming
