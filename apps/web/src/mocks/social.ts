import { http, HttpResponse, type JsonBodyType } from 'msw'
import {
  applyFilters,
  applyQuery,
  DEMO_SUPABASE_URL,
  DemoDbError,
  embedder,
  guarded,
  invalidBody,
  invalidInput,
  notImplemented,
  parseQuery,
  permissionDenied,
  readJson,
  respondRows,
  sessionExpiredError,
  wantsObject,
  wantsRepresentation,
  wantsUpsert,
  type Row,
  type TableAccess,
} from './rest'
import { INVITES, OCCASION_MEMBERS, OCCASIONS, WISHES, WISHLISTS, type DemoWorld } from './world'

// HTTP side of the demo world: exactly the PostgREST requests that src/lib/api/{occasions,invites,
// wishes,reservations}.ts send through supabase-js, answered with the RPC envelopes and the RLS /
// column-grant behaviour of supabase/migrations. Anything else under /rest/v1 falls through to the
// explicit 501 of createDemoHandlers().

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Payload = Readonly<Record<string, unknown>>
type Args = Readonly<Record<string, string | null>>

export interface SocialHandlerOptions {
  world: DemoWorld
  /** profile id of the request's valid demo session, or null (signed out, expired, unknown token) */
  viewerOf: (request: Request) => string | null
}

function isPayload(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A `boolean` argument as PostgREST casts it (true / false; JSON booleans arrive as their text). */
function asBooleanArg(value: string | null): boolean | null {
  if (value === null) return null
  if (value === 'true') return true
  if (value === 'false') return false
  throw invalidInput('boolean')
}

export function createSocialHandlers({ world, viewerOf }: SocialHandlerOptions) {
  const rest = `${DEMO_SUPABASE_URL}/rest/v1`

  function viewer(request: Request): string {
    const id = viewerOf(request)
    if (id === null) throw sessionExpiredError()
    return id
  }

  /** POST /rest/v1/rpc/<name>; PostgREST finds a function by its exact argument names. */
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
        if (value === null || value === undefined) {
          args[key] = null
        } else if (type === 'uuid') {
          if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput('uuid')
          args[key] = value.toLowerCase()
        } else {
          args[key] = typeof value === 'string' ? value : JSON.stringify(value)
        }
      }
      // Nothing awaits from here on: session check, checks and writes run as one step.
      return HttpResponse.json(run(viewer(request), args))
    }))
  }

  const arg = (args: Args, key: string): string | null => args[key] ?? null

  /** Each table's rows under its SELECT policy — also what an embedded (many-to-one) row may come from. */
  const visibleRows: Readonly<Record<string, (me: string) => readonly Row[]>> = {
    occasions: world.occasionRows,
    occasion_members: world.memberRows,
    wishlists: world.wishlistRows,
    wishes: world.wishRows,
    invites: world.inviteRows,
  }

  function read<T extends Row>(request: Request, access: TableAccess, rows: (me: string) => readonly T[]): Promise<Response> {
    return guarded(() => {
      const query = parseQuery(request, access)
      const me = viewer(request)
      const embed = embedder(query, (table) => visibleRows[table]?.(me) ?? [])
      return respondRows(request, applyQuery(rows(me), query), query.columns, 200, embed)
    })
  }

  /** Writes answer without embedded rows here: refuse instead of silently leaving them out. */
  function writeQuery(request: Request, access: TableAccess) {
    const query = parseQuery(request, access, { projection: wantsRepresentation(request) })
    if (query.embeds.length > 0) throw notImplemented()
    return query
  }

  function insert<T extends Row>(
    request: Request, access: TableAccess,
    apply: (me: string, inputs: readonly Payload[], single: boolean) => readonly T[],
  ): Promise<Response> {
    return guarded(async () => {
      // the projection is checked before anything is written (RETURNING without grant fails the statement)
      const query = writeQuery(request, access)
      if (wantsUpsert(request)) throw notImplemented()
      const payload = await readJson(request)
      const inputs: unknown[] = Array.isArray(payload) ? payload : [payload]
      if (!inputs.every(isPayload)) throw invalidBody()
      const created = apply(viewer(request), inputs, wantsObject(request))
      return wantsRepresentation(request) ? respondRows(request, created, query.columns, 201) : new HttpResponse(null, { status: 201 })
    })
  }

  function update<T extends Row>(
    request: Request, access: TableAccess, rows: (me: string) => readonly T[],
    apply: (me: string, targets: readonly T[], patch: Payload, single: boolean) => readonly T[],
  ): Promise<Response> {
    return guarded(async () => {
      const query = writeQuery(request, access)
      const payload = await readJson(request)
      if (!isPayload(payload)) throw invalidBody()
      const me = viewer(request)
      // RLS: only rows the SELECT policy shows can be targeted; the UPDATE policy filters further.
      const changed = apply(me, applyFilters(rows(me), query), payload, wantsObject(request))
      return wantsRepresentation(request) ? respondRows(request, changed, query.columns) : new HttpResponse(null, { status: 204 })
    })
  }

  function remove<T extends Row>(
    request: Request, access: TableAccess, rows: (me: string) => readonly T[],
    apply: (me: string, targets: readonly T[], single: boolean) => readonly T[],
  ): Promise<Response> {
    return guarded(() => {
      const query = writeQuery(request, access)
      const me = viewer(request)
      const removed = apply(me, applyFilters(rows(me), query), wantsObject(request))
      return wantsRepresentation(request) ? respondRows(request, removed, query.columns) : new HttpResponse(null, { status: 204 })
    })
  }

  /** A table or command without a grant for `authenticated`: 42501 for every signed-in caller. */
  function denied(request: Request, table: string): Promise<Response> {
    return guarded(() => {
      viewer(request)
      throw permissionDenied(`table ${table}`)
    })
  }

  return [
    // ---- RPCs: one per screen + the guest/host actions (pilot-decisions §2) --------------------
    rpc('get_feed', {}, (me) => world.getFeed(me)),
    rpc('get_occasion_screen', { p_occasion_id: 'uuid' }, (me, args) => world.getOccasionScreen(me, arg(args, 'p_occasion_id'))),
    rpc('create_invite', { p_occasion_id: 'uuid' }, (me, args) => world.createInvite(me, arg(args, 'p_occasion_id'))),
    rpc('accept_invite', { p_token: 'text' }, (me, args) => world.acceptInvite(me, arg(args, 'p_token'))),
    rpc('reserve_wish', { p_wish_id: 'uuid' }, (me, args) => world.reserveWish(me, arg(args, 'p_wish_id'))),
    rpc('cancel_reservation', { p_wish_id: 'uuid' }, (me, args) => world.cancelReservation(me, arg(args, 'p_wish_id'))),
    rpc('my_reservations', {}, (me) => world.myReservations(me)),
    rpc('leave_occasion', { p_occasion_id: 'uuid' }, (me, args) => world.leaveOccasion(me, arg(args, 'p_occasion_id'))),
    rpc('remove_member', { p_occasion_id: 'uuid', p_profile_id: 'uuid' },
      (me, args) => world.removeMember(me, arg(args, 'p_occasion_id'), arg(args, 'p_profile_id'))),
    // 20261022160000: "Erhalten" and moving a wish (the list owner only; reservations are the database's business)
    rpc('set_wish_received', { p_wish_id: 'uuid', p_received: 'text' },
      (me, args) => world.setWishReceived(me, arg(args, 'p_wish_id'), asBooleanArg(arg(args, 'p_received')))),
    rpc('move_wish', { p_wish_id: 'uuid', p_target_list_id: 'uuid' },
      (me, args) => world.moveWish(me, arg(args, 'p_wish_id'), arg(args, 'p_target_list_id'))),
    // 20261027200000: one wish in several lists (owner only; p_wish_ids arrives as JSON text, parsed by the world)
    rpc('add_wishes_to_list', { p_list_id: 'uuid', p_wish_ids: 'text' },
      (me, args) => world.addWishesToList(me, arg(args, 'p_list_id'), arg(args, 'p_wish_ids'))),
    rpc('remove_wish_from_list', { p_wish_id: 'uuid', p_list_id: 'uuid' },
      (me, args) => world.removeWishFromList(me, arg(args, 'p_wish_id'), arg(args, 'p_list_id'))),
    rpc('delete_wish_everywhere', { p_wish_id: 'uuid' }, (me, args) => world.deleteWishEverywhere(me, arg(args, 'p_wish_id'))),
    rpc('dismiss_received_prompt', { p_occasion_id: 'uuid' }, (me, args) => world.dismissReceivedPrompt(me, arg(args, 'p_occasion_id'))),
    // 20261030120000 "Passt zusammen": the owner's links; a giver's joint reservation (all or nothing)
    rpc('set_wish_links', { p_wish_id: 'uuid', p_linked_ids: 'text' },
      (me, args) => world.setWishLinks(me, arg(args, 'p_wish_id'), arg(args, 'p_linked_ids'))),
    rpc('reserve_together', { p_wish_id: 'uuid', p_with_ids: 'text' },
      (me, args) => world.reserveTogether(me, arg(args, 'p_wish_id'), arg(args, 'p_with_ids'))),
    // 20261025150000: the bring-along list "Mitbringen" (RPC only; never through REST)
    rpc('add_potluck_item', { p_occasion_id: 'uuid', p_title: 'text', p_claim: 'text' },
      (me, args) => world.addPotluckItem(me, arg(args, 'p_occasion_id'), arg(args, 'p_title'), asBooleanArg(arg(args, 'p_claim')) === true)),
    rpc('rename_potluck_item', { p_item_id: 'uuid', p_title: 'text' },
      (me, args) => world.renamePotluckItem(me, arg(args, 'p_item_id'), arg(args, 'p_title'))),
    rpc('delete_potluck_item', { p_item_id: 'uuid' }, (me, args) => world.deletePotluckItem(me, arg(args, 'p_item_id'))),
    rpc('claim_potluck_item', { p_item_id: 'uuid' }, (me, args) => world.claimPotluckItem(me, arg(args, 'p_item_id'))),
    rpc('unclaim_potluck_item', { p_item_id: 'uuid' }, (me, args) => world.unclaimPotluckItem(me, arg(args, 'p_item_id'))),
    rpc('export_my_potluck', {}, (me) => world.exportMyPotluck(me) as JsonBodyType),

    // ---- occasions: members read; the host creates (client id allowed), edits, deletes ----------
    http.get(`${rest}/occasions`, ({ request }) => read(request, OCCASIONS, world.occasionRows)),
    http.post(`${rest}/occasions`, ({ request }) => insert(request, OCCASIONS, world.insertOccasions)),
    http.patch(`${rest}/occasions`, ({ request }) => update(request, OCCASIONS, world.occasionRows, world.updateOccasions)),
    http.delete(`${rest}/occasions`, ({ request }) => remove(request, OCCASIONS, world.occasionRows, world.deleteOccasions)),

    // ---- occasion_members: RSVP is the only REST write; joins/leaves go through the RPCs ----------
    http.get(`${rest}/occasion_members`, ({ request }) => read(request, OCCASION_MEMBERS, world.memberRows)),
    http.patch(`${rest}/occasion_members`, ({ request }) => update(request, OCCASION_MEMBERS, world.memberRows, world.updateMembers)),
    http.post(`${rest}/occasion_members`, ({ request }) => denied(request, 'occasion_members')),
    http.delete(`${rest}/occasion_members`, ({ request }) => denied(request, 'occasion_members')),

    // ---- wishlists: created by the occasion trigger; readable by active members ------------------
    http.get(`${rest}/wishlists`, ({ request }) => read(request, WISHLISTS, world.wishlistRows)),

    // ---- wishes: members read, the list owner writes (hard delete ends a reservation silently) -----
    http.get(`${rest}/wishes`, ({ request }) => read(request, WISHES, world.wishRows)),
    http.post(`${rest}/wishes`, ({ request }) => insert(request, WISHES, world.insertWishes)),
    http.patch(`${rest}/wishes`, ({ request }) => update(request, WISHES, world.wishRows, world.updateWishes)),
    http.delete(`${rest}/wishes`, ({ request }) => remove(request, WISHES, world.wishRows, world.deleteWishes)),

    // ---- invites: the host reads metadata (never a token) and revokes; links come from create_invite ---
    http.get(`${rest}/invites`, ({ request }) => read(request, INVITES, world.inviteRows)),
    http.patch(`${rest}/invites`, ({ request }) => update(request, INVITES, world.inviteRows, world.updateInvites)),
    http.delete(`${rest}/invites`, ({ request }) => remove(request, INVITES, world.inviteRows, world.deleteInvites)),
    http.post(`${rest}/invites`, ({ request }) => denied(request, 'invites')),

    // ---- THE SECRET: no REST access to reservations at all, not even HEAD / count (pilot-decisions §1) ---
    http.all(`${rest}/reservations`, ({ request }) => denied(request, 'reservations')),
  ]
}
