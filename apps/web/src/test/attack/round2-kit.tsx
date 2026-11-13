import type { ReactNode } from 'react'
import type { AuthChangeEvent, Session, Subscription, SupabaseClient } from '@supabase/supabase-js'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider, createMemoryHistory, createRoute, createRouter, useParams, useRouteContext } from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { vi } from 'vitest'
import { AUTH_STORAGE_KEY } from '../../lib/app'
import { SESSION_CHANNEL, isAccountSwitching } from '../../lib/accountBoundary'
import type { Database } from '../../lib/database.types'
import type { FeedOccasion, FeedScreen, Me, OccasionScreen, OccasionScreenWish } from '../../lib/api/types'
import { persistOptions, queryClient } from '../../lib/query'
import { ACCOUNT_RELOAD_KEY } from '../../lib/session'
import { Route as rootRoute } from '../../routes/__root'
import { Route as authedFileRoute } from '../../routes/_authed'
import { Route as loginFileRoute } from '../../routes/login'
import { ExportPage, SettingsPage } from '../../features/account/AccountPages'
import { FeedPage } from '../../features/feed/FeedPage'
import { InvitePage } from '../../features/invite/InvitePage'
import { EditOccasionPage } from '../../features/occasions/EditOccasionPage'
import { OccasionPage } from '../../features/occasions/OccasionPage'
import { EditWishPage } from '../../features/wishes/WishEditorPages'
import { FakeBroadcastChannel, deferred, fixtureSession, flush, json, pgError, storedSession, visibleMatches, type Deferred } from './round1-kit'

// Shared pieces of the adversarial round-2 tests (src/test/attack/round2-*.test.tsx).
// Invented fixture accounts and texts only; no real person, token or project.
// No vi.mock in here: every test file declares its own (they are hoisted per file, so they also apply to
// the app modules this kit imports). Files using buildAppRouter must mock lib/supabase, the app router
// (lib/session.ts navigates with it) and the mascot.
//
// The fixture world (what the fake PostgREST below answers, per bearer token):
//   OCC_B "Bens Grillabend" — host OWNER_B, guest GUEST_A. Its list belongs to B; A reserved "Schürze",
//         someone else reserved "Kohle". B (the owner) gets literal nulls for every reservation field.
//   OCC_A "Milas Gartenfest" — host GUEST_A, guest OWNER_B; its list belongs to A ("Fotoalbum").
// So A is a guest of B's list and a host of her own occasion; B is the owner of the list A reserved on.

export const API = 'http://attack-r2.localhost'

/** the guest who reserves on B's list (and host of her own occasion OCC_A) */
export const GUEST_A = '00000000-0000-4000-8000-0000000000a1'
/** the owner of the list (host of OCC_B, guest of OCC_A) */
export const OWNER_B = '00000000-0000-4000-8000-0000000000b2'
/** a third account, never signed in on this device */
export const OTHER = '00000000-0000-4000-8000-0000000000c3'
export const OCC_B = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
export const OCC_A = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
export const LIST_B = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'
export const LIST_A = '6a1d1f8b-9b8c-4c9f-8a71-2d3e4f5a6b7c'
export const FREE = '00000000-0000-4000-8000-00000000f001'
export const MINE = '00000000-0000-4000-8000-00000000f002'
export const TAKEN = '00000000-0000-4000-8000-00000000f003'
export const ALBUM = '00000000-0000-4000-8000-00000000f0a1'
export const INVITE_TOKEN = '7b'.repeat(32)

/** The title of A's occasion (B is a guest there and may see it). */
export const TITLE_A = 'Milas Gartenfest'

/** Every word of the guest's reservation UI (wishes.json "reserve.*", German test locale). */
export const RESERVATION_WORDS =
  /Reserviert|Von dir reserviert|Ich schenke das|Reservierung aufheben|Meine Reservierungen|schenkt schon|Versteckt|Jemand war schneller|Reserviere|Reservierungen? von dir/i

const NAMES: Record<string, string> = { [GUEST_A]: 'Mila Fixture', [OWNER_B]: 'Ben Fixture', [OTHER]: 'Jonas Fixture' }

export function me(id: string): Me {
  return {
    profile: { id, display_name: NAMES[id] ?? 'Unbekannt', locale: 'de', onboarding_done_at: '2026-10-01T10:00:00Z' },
    consents_ok: true,
    legal_versions: { terms: 'terms-v', privacy: 'privacy-v', age: 'age-v' },
  }
}

function wish(id: string, title: string, reserved: boolean | null, mine: boolean | null, note: string | null = null): OccasionScreenWish {
  return {
    id, title, url: null, price_cents: null, currency: 'EUR', note, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved, reserved_by_me: mine,
  }
}

/** get_occasion_screen as the server answers it for `viewer` (null = no access: not_found). */
export function screenOf(occasionId: string, viewer: string): OccasionScreen | null {
  if (occasionId === OCC_B && (viewer === GUEST_A || viewer === OWNER_B)) {
    const guest = viewer === GUEST_A
    return {
      occasion: {
        id: OCC_B, title: 'Bens Grillabend', starts_at: '2030-06-15T16:00:00.000Z', tz: 'Europe/Berlin', all_day: false,
        place_text: null, description: null, created_at: '2030-01-01T10:00:00.000Z', host: { id: OWNER_B, display_name: 'Ben Fixture' },
      },
      viewer: guest ? { role: 'member', rsvp: 'none' } : { role: 'host', rsvp: 'going' },
      members: [
        { profile_id: OWNER_B, display_name: 'Ben Fixture', role: 'host', rsvp: 'going' },
        { profile_id: GUEST_A, display_name: 'Mila Fixture', role: 'member', rsvp: 'none' },
      ],
      invite: null,
      wishlist: {
        id: LIST_B, owner_id: OWNER_B, title: 'Bens Grillabend',
        wishes: [
          wish(FREE, 'Grillzange', guest ? false : null, guest ? false : null),
          wish(MINE, 'Schürze', guest ? true : null, guest ? true : null),
          wish(TAKEN, 'Kohle', guest ? true : null, guest ? false : null),
        ],
      },
    }
  }
  if (occasionId === OCC_A && (viewer === GUEST_A || viewer === OWNER_B)) {
    const host = viewer === GUEST_A
    return {
      occasion: {
        id: OCC_A, title: TITLE_A, starts_at: '2030-07-01T18:00:00.000Z', tz: 'Europe/Berlin', all_day: false,
        place_text: null, description: null, created_at: '2030-01-02T10:00:00.000Z', host: { id: GUEST_A, display_name: 'Mila Fixture' },
      },
      viewer: host ? { role: 'host', rsvp: 'going' } : { role: 'member', rsvp: 'going' },
      members: [
        { profile_id: GUEST_A, display_name: 'Mila Fixture', role: 'host', rsvp: 'going' },
        { profile_id: OWNER_B, display_name: 'Ben Fixture', role: 'member', rsvp: 'going' },
      ],
      invite: null,
      wishlist: {
        id: LIST_A, owner_id: GUEST_A, title: TITLE_A,
        wishes: [wish(ALBUM, 'Fotoalbum', host ? null : true, host ? null : false, 'Geheim: Fotos von Ben sammeln')],
      },
    }
  }
  return null
}

function feedRow(occasionId: string, viewer: string): FeedOccasion | null {
  const screen = screenOf(occasionId, viewer)
  if (!screen) return null
  const host = screen.viewer.role === 'host'
  const wishes = screen.wishlist?.wishes ?? []
  return {
    id: occasionId, title: screen.occasion.title, starts_at: screen.occasion.starts_at, tz: 'Europe/Berlin', all_day: false,
    place_text: null, role: host ? 'host' : 'member', rsvp: screen.viewer.rsvp, host_name: screen.occasion.host.display_name,
    member_count: screen.members.length, wish_count: wishes.length,
    my_reservation_count: host ? null : wishes.filter((entry) => entry.reserved_by_me === true).length,
  }
}

export function feedOf(viewer: string): FeedScreen {
  return { upcoming: [OCC_B, OCC_A].flatMap((id) => feedRow(id, viewer) ?? []), past: [] }
}

// ---- the backend: real HTTP through supabase-js, answered by MSW -----------------------------------

export interface Seen { method: string; route: string; authorization: string | null; body: unknown }
export interface Held { arrived: Deferred<void>; answer: Deferred<Response> }

export function idFromBearer(authorization: string | null): string | null {
  return /^Bearer fixture-token-(.+)$/.exec(authorization ?? '')?.[1] ?? null
}

async function readBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text()
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

function occasionIdOf(body: unknown): string {
  return typeof body === 'object' && body !== null && 'p_occasion_id' in body && typeof body.p_occasion_id === 'string' ? body.p_occasion_id : ''
}

/** What the fixture server answers when nothing is held: the world above, keyed by the bearer token. */
function defaultAnswer(key: string, id: string | null, body: unknown, url: URL): Response {
  if (!id) return pgError('not_authenticated', 401)
  switch (key) {
    case 'POST rpc/get_me':
      return json(me(id))
    case 'POST rpc/get_feed':
      return json(feedOf(id))
    case 'POST rpc/get_occasion_screen': {
      const screen = screenOf(occasionIdOf(body), id)
      return screen ? json(screen) : pgError('not_found')
    }
    case 'POST rpc/my_reservations':
      return json([])
    case 'POST rpc/reserve_wish':
    case 'POST rpc/cancel_reservation':
    case 'POST rpc/remove_member':
    case 'POST rpc/leave_occasion':
      return json({ ok: true })
    case 'POST rpc/create_invite':
      return json({ token: INVITE_TOKEN })
    case 'POST rpc/accept_invite':
      return json({ occasion_id: OCC_B })
    case 'POST rpc/export_my_data':
      return json({ format: 'bunprise-export-v1', profile: { id }, reservations: [{ wish_title: 'Schürze' }] })
    case 'PATCH occasions': {
      const occasionId = url.searchParams.get('id')?.replace(/^eq\./, '') ?? ''
      const screen = screenOf(occasionId, id)
      if (!screen || screen.viewer.role !== 'host') return pgError('PGRST116', 406)
      return json({ ...screen.occasion, host_id: id, ends_at: null, cancelled_at: null, updated_at: '2030-01-03T10:00:00.000Z', ...(body as object) })
    }
    case 'PATCH occasion_members':
      return new Response(null, { status: 204 })
    default:
      return json({ code: 'XX000', message: 'unexpected request', details: null, hint: null }, 500)
  }
}

export function createBackend() {
  const seen: Seen[] = []
  const held = new Map<string, Held[]>()

  async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const route = url.pathname.replace(/^\/rest\/v1\//, '')
    const key = `${request.method} ${route}`
    const authorization = request.headers.get('Authorization')
    const body = request.method === 'GET' || request.method === 'DELETE' ? null : await readBody(request)
    seen.push({ method: request.method, route, authorization, body })
    const next = held.get(key)?.shift()
    if (next) {
      next.arrived.resolve()
      return next.answer.promise
    }
    return defaultAnswer(key, idFromBearer(authorization), body, url)
  }

  const server = setupServer(
    http.all(`${API}/rest/v1/*`, ({ request }) => answer(request)),
    http.get(`${API}/auth/v1/user`, ({ request }) => {
      const id = idFromBearer(request.headers.get('Authorization'))
      return id
        ? json({ id, aud: 'authenticated', role: 'authenticated', email: `${id.slice(-2)}.fixture@example.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-10-20T12:00:00Z' })
        : json({ code: 'session_not_found', msg: 'session gone' }, 401)
    }),
  )

  return {
    server,
    seen,
    /** The next request on `key` ('POST rpc/reserve_wish', 'PATCH occasions', …) waits for the test's answer. */
    hold(key: string): Held {
      const entry: Held = { arrived: deferred(), answer: deferred<Response>() }
      held.set(key, [...(held.get(key) ?? []), entry])
      return entry
    },
    /** Everything sent with `userId`'s token. */
    sentFor(userId: string): Seen[] {
      return seen.filter((request) => request.authorization === `Bearer fixture-token-${userId}`)
    },
    reset() {
      seen.length = 0
      held.clear()
    },
  }
}

// ---- providers --------------------------------------------------------------------------------------

/** The app's providers as main.tsx builds them (minus persistence and the router, which tests add). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </QueryClientProvider>
  )
}

/** Visible text of the toast viewport and its toasts (the fixed stack in <body>), hidden or not. */
export function toastTexts(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'))
    .filter((el) => el.closest('.pointer-events-none.fixed') !== null)
    .map((el) => el.textContent?.trim() ?? '')
}

/** The page is shown and usable (neither the reload path nor the in-app switch hides it). */
export function pageShown(): boolean {
  return document.documentElement.style.visibility !== 'hidden' && !document.body.hasAttribute('inert')
}

// ---- the app: the real root shell (routes/__root.tsx), the real _authed guard, real screens ----------

type GuardContext = Parameters<NonNullable<typeof authedFileRoute.options.beforeLoad>>[0]

/** The signed-in account of the _authed guard (route context), as the app's route files read it. */
function useSessionUserId(): string {
  const context = useRouteContext({ strict: false }) as { session?: Session }
  if (!context.session) throw new Error('no session in the route context')
  return context.session.user.id
}

function useRouteParam(name: 'occasionId' | 'wishId'): string {
  const params = useParams({ strict: false }) as Partial<Record<'occasionId' | 'wishId', string>>
  const value = params[name]
  if (!value) throw new Error(`no ${name} in the route`)
  return value
}
const realAuthedGuard = authedFileRoute.options.beforeLoad as unknown as (ctx: GuardContext) => Promise<{ session: Session }>
const realLoginGuard = loginFileRoute.options.beforeLoad as unknown as (ctx: unknown) => Promise<void>

/**
 * A router with the app's real root route (OfflineBanner · AccountSwitchGate around <Outlet/> ·
 * LegalFooter · lazy ToastHost), the real `_authed` guard (getLocalSession + fresh get_me) and the real
 * `/login` guard, rendering the real screens. `slowGuard()` may return a promise the next account's
 * guard waits for first (a slow network for get_me). `/login` shows a marker text unless a test asks
 * for a real screen there (`loginScreen`).
 */
export function buildAppRouter(
  initial: string,
  slowGuard: () => Promise<void> | null,
  options: { loginScreen?: () => ReactNode } = {},
) {
  const authed = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authed',
    beforeLoad: async (ctx) => {
      const wait = slowGuard()
      if (wait) await wait
      return realAuthedGuard(ctx as unknown as GuardContext)
    },
  })
  const soon = createRoute({ getParentRoute: () => authed, path: '/soon', component: FeedPage })
  const occasion = createRoute({
    getParentRoute: () => authed,
    path: '/occasions/$occasionId',
    component: function OccasionRoute() {
      const occasionId = useRouteParam('occasionId')
      return <OccasionPage key={occasionId} occasionId={occasionId} userId={useSessionUserId()} />
    },
  })
  const edit = createRoute({
    getParentRoute: () => authed,
    path: '/occasions/$occasionId/edit',
    component: function EditRoute() {
      const occasionId = useRouteParam('occasionId')
      return <EditOccasionPage key={occasionId} occasionId={occasionId} userId={useSessionUserId()} />
    },
  })
  const wishEdit = createRoute({
    getParentRoute: () => authed,
    path: '/wishes/$wishId/edit',
    component: function WishEditRoute() {
      return <EditWishPage wishId={useRouteParam('wishId')} userId={useSessionUserId()} />
    },
  })
  const settings = createRoute({
    getParentRoute: () => authed,
    path: '/settings',
    component: function SettingsRoute() {
      return <SettingsPage userId={useSessionUserId()} />
    },
  })
  const exportRoute = createRoute({
    getParentRoute: () => authed,
    path: '/settings/export',
    component: function ExportRoute() {
      return <ExportPage userId={useSessionUserId()} />
    },
  })
  const login = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    beforeLoad: (ctx) => realLoginGuard(ctx),
    component: () => (options.loginScreen ? options.loginScreen() : <p>Anmeldeseite</p>),
  })
  const invite = createRoute({ getParentRoute: () => rootRoute, path: '/i', component: InvitePage })
  const routeTree = rootRoute.addChildren([
    authed.addChildren([soon, occasion, edit, wishEdit, settings, exportRoute]),
    login,
    invite,
  ])
  // the app's pending options (src/router.tsx)
  return createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [initial] }),
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  })
}

export type AppRouter = ReturnType<typeof buildAppRouter>

/** Renders the router inside the providers of main.tsx (persisted query client, motion features). */
export async function mountAppRouter(router: AppRouter): Promise<void> {
  render(
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </PersistQueryClientProvider>,
  )
  await act(async () => {
    await router.load()
    await flush(30)
  })
}

export function wishRow(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)
  if (!el) throw new Error(`row ${id} not rendered`)
  return el
}

export function openWishRow(id: string): void {
  const button = wishRow(id).querySelector('button')
  if (!button) throw new Error('row button missing')
  fireEvent.click(button)
}

/** A control by its text, also while the page is hidden (no accessible name then). */
export function domButton(selector: string, text: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((el) => el.textContent?.includes(text))
  if (!found) throw new Error(`${selector} "${text}" not in the DOM`)
  return found
}

// ---- this tab's session source (a real supabase-js client whose session SOURCE is a fixture) -------

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void | Promise<void>

export type SwitchChannel = 'sdk' | 'storage' | 'channel'

/**
 * getSession() / onAuthStateChange() of `client` answer from `state.session`, everything else of the
 * client (REST, RPC, auth HTTP) is real.
 */
export function createSessionSource(client: SupabaseClient<Database>, state: { session: Session | null }) {
  const listeners = new Set<AuthListener>()

  function attach() {
    vi.spyOn(client.auth, 'getSession').mockImplementation(async () => ({ data: { session: state.session }, error: null }) as never)
    vi.spyOn(client.auth, 'onAuthStateChange').mockImplementation(((callback: AuthListener) => {
      listeners.add(callback)
      const subscription = { id: `fixture-${listeners.size}`, callback, unsubscribe: () => { listeners.delete(callback) } }
      return { data: { subscription: subscription as unknown as Subscription } }
    }) as never)
  }

  function emit(event: AuthChangeEvent) {
    for (const listener of Array.from(listeners)) void listener(event, state.session)
  }

  /** The page opens with `userId` signed in (the SDK's first event). */
  function openAs(userId: string) {
    state.session = fixtureSession(userId)
    window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(userId))
    emit('INITIAL_SESSION')
  }

  /**
   * The account of this tab changes to `next`: its own SDK reports it (sdk), another tab replaced or
   * removed the stored session (storage), or another tab signed A out and announced it on the app
   * channel, and B signed in there afterwards without this tab hearing of it yet (channel).
   */
  async function switchTo(channel: SwitchChannel, next: string | null) {
    const previous = state.session?.user.id ?? null
    await act(async () => {
      if (channel === 'channel') {
        state.session = null
        window.localStorage.removeItem(AUTH_STORAGE_KEY)
        if (previous) new FakeBroadcastChannel(SESSION_CHANNEL).postMessage({ type: 'account-cleared', userId: previous })
        await flush()
        state.session = next ? fixtureSession(next) : null
        if (next) window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
        await flush(10)
        return
      }
      state.session = next ? fixtureSession(next) : null
      if (next) window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
      else window.localStorage.removeItem(AUTH_STORAGE_KEY)
      if (channel === 'sdk') emit(next ? 'SIGNED_IN' : 'SIGNED_OUT')
      else {
        window.dispatchEvent(new StorageEvent('storage', {
          key: AUTH_STORAGE_KEY, newValue: next ? storedSession(next) : null, storageArea: window.localStorage,
        }))
      }
      await flush(10)
    })
  }

  return {
    attach, emit, openAs, switchTo,
    clear() {
      listeners.clear()
    },
  }
}

/** This tab reloaded `ago` ms ago because its account ended: the next change switches in-app. */
export function reloadedAgo(ago: number): void {
  window.sessionStorage.setItem(ACCOUNT_RELOAD_KEY, String(Date.now() - ago))
}

/** Wait until an in-app switch is over and the page is shown again (the next account's screen rendered). */
export async function untilShownAgain(): Promise<void> {
  await waitFor(() => {
    if (isAccountSwitching() || !pageShown()) throw new Error('the page is still switching accounts')
  }, { timeout: 3_000 })
}

/**
 * Records, at the very moment the page becomes visible again (a MutationObserver on <html style> and
 * <body inert>, i.e. right after showPage() — before any further animation frame), which texts matching
 * `pattern` a person could see. `seen` stays null until the page was hidden and shown again.
 */
export function captureAtShow(pattern: RegExp): { readonly seen: string[] | null; stop(): void } {
  let seen: string[] | null = null
  let wasHidden = !pageShown()
  const observer = new MutationObserver(() => {
    if (!pageShown()) {
      wasHidden = true
      return
    }
    if (wasHidden && seen === null) seen = visibleMatches(pattern)
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  observer.observe(document.body, { attributes: true, attributeFilter: ['inert'] })
  return {
    get seen() {
      return seen
    },
    stop: () => observer.disconnect(),
  }
}
