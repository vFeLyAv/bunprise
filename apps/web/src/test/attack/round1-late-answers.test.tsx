import type { ReactNode, Ref } from 'react'
import { createClient, type AuthChangeEvent, type Session, type Subscription } from '@supabase/supabase-js'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../lib/database.types'

// ADVERSARIAL ROUND 1 — Codex review 2, H1 (late operations of a previous account), literally:
// an operation starts for account A, the tab switches to B — through this tab's auth callback (sdk),
// another tab's storage write (storage) or another tab's sign-out announcement (channel) — and only
// then the old request is answered. Everything below is REAL: the API wrappers (lib/api/*), supabase-js
// over HTTP (MSW), the session watcher (lib/session.ts), the screens and the toast host. Only the
// Supabase *session source* is a fixture (getSession / onAuthStateChange), plus jsdom stand-ins
// (location.replace, BroadcastChannel, mascot, share). Every assertion is the SECURE behaviour:
// a failing test is a finding. Invented fixture accounts only.

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void | Promise<void>

const hooks = vi.hoisted(() => ({
  client: null as unknown,
  session: null as Session | null,
  mascot: [] as string[],
  feedback: [] as string[],
  share: null as null | ((payload: unknown) => Promise<string>),
  copy: null as null | ((text: string) => Promise<boolean>),
  shared: [] as unknown[],
  copied: [] as string[],
  navigate: vi.fn(),
  back: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => Promise.resolve(hooks.client),
  hasLocalSession: () => hooks.session !== null,
  getLocalSession: () => Promise.resolve(hooks.session),
  onClientReady: (ready: (client: unknown) => void) => {
    ready(hooks.client)
    return () => {}
  },
}))
vi.mock('../../router', () => ({
  router: { state: { location: { pathname: '/occasions/x', href: '/occasions/x' } }, navigate: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => {
  const mocked = {
    useRouter: () => ({
      navigate: hooks.navigate,
      history: { back: hooks.back },
      state: { location: { pathname: '/occasions/x' } },
      preloadRoute: () => Promise.resolve(),
    }),
    useNavigate: () => hooks.navigate,
    useCanGoBack: () => true,
    Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
  }
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
  return { ...mocked, createLink: () => mocked.Link }
})
vi.mock('../../features/mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    Mascot: (props: { kind: string; scene?: string; ref?: Ref<unknown> }) => {
      useImperativeHandle(props.ref, () => ({
        play: (scene: string) => {
          hooks.mascot.push(`${props.kind}:play:${scene}`)
          return Promise.resolve()
        },
        tap: () => {},
        instance: null,
      }))
      if (props.scene) hooks.mascot.push(`${props.kind}:${props.scene}`)
      return <div data-testid="mascot" data-kind={props.kind} />
    },
    preloadMascot: () => undefined,
  }
})
// The invitation's response now carries a letter. Keep the same late-animation oracle for it.
vi.mock('../../features/mascot-ui/carry', () => ({
  useCarry: () => async ({ item }: { item: string }) => { hooks.mascot.push(`bunny:play:${item}`) },
}))
vi.mock('../../lib/share', () => ({
  canNativeShare: () => false,
  share: (payload: unknown) => {
    hooks.shared.push(payload)
    return hooks.share ? hooks.share(payload) : Promise.resolve('copied')
  },
  copyText: (text: string) => {
    hooks.copied.push(text)
    return hooks.copy ? hooks.copy(text) : Promise.resolve(true)
  },
}))
vi.mock('../../lib/haptics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/haptics')>()),
  feedback: (kind: string) => {
    hooks.feedback.push(kind)
  },
}))

import { AUTH_STORAGE_KEY } from '../../lib/app'
import { SESSION_CHANNEL, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import type { Me, OccasionScreen } from '../../lib/api/types'
import { clearPersistedCache, queryClient, setSdkSessionIdentity } from '../../lib/query'
import { qk } from '../../lib/queryKeys'
import { watchSessionIdentity } from '../../lib/session'
import { getToasts, toast } from '../../lib/toast'
import { ExportPage } from '../../features/account/AccountPages'
import JoinGate from '../../features/invite/JoinGate'
import { getPendingInvite, setPendingInvite } from '../../features/invite/pending'
import { EditOccasionPage } from '../../features/occasions/EditOccasionPage'
import { InviteLinkPanel } from '../../features/occasions/InviteSection'
import { forgetInviteLinksForTests, rememberInviteLink } from '../../features/occasions/inviteLink'
import { MembersSection } from '../../features/occasions/MembersSection'
import { RsvpSection } from '../../features/occasions/RsvpSection'
import { peekDraft, resetSavingForTests } from '../../features/occasions/saving'
import { WishlistSection } from '../../features/wishes/WishlistSection'
import { isWishDeletePending, resetPendingWishDeletes, scheduleWishDelete } from '../../features/wishes/pendingDeletes'
import {
  AppProviders, FREE, FakeBroadcastChannel, GUEST_A, HOST_A, INVITE_TOKEN, MINE, OCCASION_ID, OWNER_B,
  deferred, fixtureSession, flush, json, pgError, screenFor, storedSession, visibleMatches, type Deferred,
} from './round1-kit'

// ---- the backend: real HTTP through supabase-js, answered by MSW ----------------------------------

const API = 'http://attack-late.localhost'

interface Seen { method: string; route: string; authorization: string | null }
interface Held { arrived: Deferred<void>; answer: Deferred<Response> }

const seen: Seen[] = []
const held = new Map<string, Held[]>()

/** The next request on `key` ('POST rpc/reserve_wish', 'PATCH occasions', …) waits for the test's answer. */
function hold(key: string): Held {
  const entry: Held = { arrived: deferred(), answer: deferred<Response>() }
  held.set(key, [...(held.get(key) ?? []), entry])
  return entry
}

function idFromBearer(authorization: string | null): string | null {
  return /^Bearer fixture-token-(.+)$/.exec(authorization ?? '')?.[1] ?? null
}

function me(id: string): Me {
  return {
    profile: { id, display_name: id === GUEST_A ? 'Mila Fixture' : 'Ben Fixture', locale: 'de', onboarding_done_at: null },
    consents_ok: true,
    legal_versions: { terms: 'terms-v', privacy: 'privacy-v', age: 'age-v' },
  }
}

const DEFAULT_FALLBACKS: Record<string, (id: string | null) => Response> = {
  'POST rpc/get_me': (id) => (id ? json(me(id)) : pgError('not_authenticated', 401)),
  'POST rpc/create_invite': () => json({ token: INVITE_TOKEN }),
  // the export file adds the own cover photos (wave 2, lib/api/photos.ts): none here
  'POST rpc/export_my_occasion_photos': () => json([]),
  // … and the own wish photos, list covers and profile / banner photos (20261022120000, 20261022160000, 20261024120000)
  'POST rpc/export_my_wish_photos': () => json([]),
  'POST rpc/export_my_list_photos': () => json([]),
  'POST rpc/export_my_profile_photos': () => json([]),
}
let fallbacks: Record<string, (id: string | null) => Response> = { ...DEFAULT_FALLBACKS }

async function answer(request: Request): Promise<Response> {
  const route = new URL(request.url).pathname.replace(/^\/rest\/v1\//, '')
  const key = `${request.method} ${route}`
  const authorization = request.headers.get('Authorization')
  seen.push({ method: request.method, route, authorization })
  const next = held.get(key)?.shift()
  if (next) {
    next.arrived.resolve()
    return next.answer.promise
  }
  const fallback = fallbacks[key]
  return fallback ? fallback(idFromBearer(authorization)) : json({ code: 'XX000', message: 'unexpected request', details: null, hint: null }, 500)
}

const server = setupServer(
  http.all(`${API}/rest/v1/*`, ({ request }) => answer(request)),
  http.get(`${API}/auth/v1/user`, ({ request }) => {
    const id = idFromBearer(request.headers.get('Authorization'))
    return id
      ? json({ id, aud: 'authenticated', role: 'authenticated', email: `${id.slice(-4)}@example.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-10-20T12:00:00Z' })
      : json({ code: 'session_not_found', msg: 'session gone' }, 401)
  }),
)

// ---- the session source of this tab ---------------------------------------------------------------

const testClient = createClient<Database>(API, 'fixture-publishable-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
hooks.client = testClient
const sdkListeners = new Set<AuthListener>()

/** The tab's session source: getSession() reads the current fixture session, listeners get its events. */
function attachSessionSource() {
  vi.spyOn(testClient.auth, 'getSession').mockImplementation(async () => ({ data: { session: hooks.session }, error: null }) as never)
  vi.spyOn(testClient.auth, 'onAuthStateChange').mockImplementation(((callback: AuthListener) => {
    sdkListeners.add(callback)
    const subscription = { id: `fixture-${sdkListeners.size}`, callback, unsubscribe: () => { sdkListeners.delete(callback) } }
    return { data: { subscription: subscription as unknown as Subscription } }
  }) as never)
}

function emit(event: AuthChangeEvent) {
  for (const listener of Array.from(sdkListeners)) void listener(event, hooks.session)
}

/** The page opens with `userId` signed in (the SDK's first event). */
function openAs(userId: string) {
  hooks.session = fixtureSession(userId)
  window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(userId))
  emit('INITIAL_SESSION')
}

type Channel = 'sdk' | 'storage' | 'channel'
const CHANNELS: Channel[] = ['sdk', 'storage', 'channel']

/**
 * The account of this tab changes to `next`:
 * - sdk: this tab's supabase-js reports it (same-tab sign-in, or auth-js's own cross-tab broadcast);
 * - storage: another tab wrote/removed the stored session (only the storage event arrives here);
 * - channel: another tab signed A out and announced it on the app channel; B signs in there afterwards
 *   (its storage event has not arrived yet when the old answer comes back).
 */
async function switchTo(channel: Channel, next: string | null) {
  const previous = hooks.session?.user.id ?? null
  await act(async () => {
    if (channel === 'channel') {
      hooks.session = null
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
      if (previous) new FakeBroadcastChannel(SESSION_CHANNEL).postMessage({ type: 'account-cleared', userId: previous })
      await flush()
      hooks.session = next ? fixtureSession(next) : null
      if (next) window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
      return
    }
    hooks.session = next ? fixtureSession(next) : null
    if (next) window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
    else window.localStorage.removeItem(AUTH_STORAGE_KEY)
    if (channel === 'sdk') emit(next ? 'SIGNED_IN' : 'SIGNED_OUT')
    else {
      window.dispatchEvent(new StorageEvent('storage', {
        key: AUTH_STORAGE_KEY, newValue: next ? storedSession(next) : null, storageArea: window.localStorage,
      }))
    }
    await flush()
  })
}

/**
 * Only the RESET signal reaches this tab; its supabase-js still reports A when the old answer comes
 * back (its in-memory/stored view has not caught up). Then the wrapper's account check passes the
 * server's original answer through — only the screen's captureEpoch() can keep it from B.
 */
async function signalOnly(channel: 'storage' | 'channel', next: string) {
  const shown = hooks.session?.user.id
  await act(async () => {
    if (channel === 'channel') {
      new FakeBroadcastChannel(SESSION_CHANNEL).postMessage({ type: 'account-cleared', userId: shown })
    } else {
      window.localStorage.setItem(AUTH_STORAGE_KEY, storedSession(next))
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: storedSession(next), storageArea: window.localStorage }))
    }
    await flush()
  })
}

/** Release a held answer and let fetch → supabase-js → wrapper → screen run to the end. */
async function release(entry: Held, response: Response) {
  await act(async () => {
    entry.answer.resolve(response)
    await flush(60)
  })
}

const sentFor = (userId: string) => seen.filter((request) => request.authorization === `Bearer fixture-token-${userId}`)

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)
  if (!el) throw new Error(`row ${id} not rendered`)
  return el
}

function openRow(id: string) {
  const button = row(id).querySelector('button')
  if (!button) throw new Error('row button missing')
  fireEvent.click(button)
}

/** A control by its text, also while the page is hidden (no accessible name then). */
function domButton(selector: string, text: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((el) => el.textContent?.includes(text))
  if (!found) throw new Error(`${selector} "${text}" not in the DOM`)
  return found
}

function guestList() {
  const list = screenFor('guest').wishlist
  if (!list) throw new Error('fixture without wishlist')
  return list
}

const replace = vi.fn<(url: string) => void>()
let stop: (() => void) | null = null
let createObjectURL: ReturnType<typeof vi.fn>

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})
afterAll(() => server.close())

beforeEach(async () => {
  attachSessionSource()
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  fallbacks = { ...DEFAULT_FALLBACKS }
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('location', { ...window.location, replace })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  createObjectURL = vi.fn(() => 'blob:fixture')
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  replace.mockReset()
  hooks.navigate.mockReset().mockResolvedValue(undefined)
  hooks.back.mockReset()
  hooks.mascot.length = 0
  hooks.feedback.length = 0
  hooks.shared.length = 0
  hooks.copied.length = 0
  hooks.share = null
  hooks.copy = null
  hooks.session = null
  seen.length = 0
  held.clear()
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  resetSavingForTests()
  resetPendingWishDeletes()
  forgetInviteLinksForTests()
  window.localStorage.clear()
  window.sessionStorage.clear()
  stop = watchSessionIdentity()
})

afterEach(async () => {
  stop?.()
  stop = null
  sdkListeners.clear()
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
  FakeBroadcastChannel.closeAll()
  vi.unstubAllGlobals()
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  resetPendingWishDeletes()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe.each(CHANNELS)('H1 — late answers of guest A after the switch to owner B (switch via %s)', (channel) => {
  it('reserve: a late already_reserved never becomes a toast, chip, cache write, haptic or hamster for B', async () => {
    openAs(GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={guestList()} viewer="guest" />, { wrapper: AppProviders })
    const reserve = hold('POST rpc/reserve_wish')
    openRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    await act(() => reserve.arrived.promise)
    expect(seen.at(-1)?.authorization).toBe(`Bearer fixture-token-${GUEST_A}`)

    await switchTo(channel, OWNER_B)
    expect(replace).toHaveBeenCalledTimes(1) // the reset fired
    hooks.feedback.length = 0
    hooks.mascot.length = 0
    const writes = vi.spyOn(queryClient, 'setQueryData')
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries')

    await release(reserve, pgError('already_reserved'))

    expect(getToasts()).toEqual([])
    expect(document.body.textContent).not.toMatch(/Jemand war schneller/)
    expect(writes).not.toHaveBeenCalled()
    expect(invalidations).not.toHaveBeenCalled()
    expect(within(row(FREE)).queryByText('Reserviert')).toBeNull()
    expect(hooks.feedback).toEqual([])
    expect(hooks.mascot).toEqual([])
    expect(sentFor(OWNER_B)).toEqual([]) // nothing at all was sent with B's token
  })

  it('reserve: a late success is no celebration, hint, refetch or chip for B', async () => {
    openAs(GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={guestList()} viewer="guest" />, { wrapper: AppProviders })
    const reserve = hold('POST rpc/reserve_wish')
    openRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    await act(() => reserve.arrived.promise)
    await switchTo(channel, OWNER_B)
    hooks.mascot.length = 0
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries')

    await release(reserve, json({ ok: true }))

    expect(getToasts()).toEqual([])
    expect(document.body.textContent).not.toMatch(/Versteckt/)
    expect(invalidations).not.toHaveBeenCalled()
    expect(hooks.mascot.filter((scene) => scene.startsWith('hamster'))).toEqual([])
    expect(within(row(FREE)).queryByText('Von dir reserviert')).toBeNull()
    expect(sentFor(OWNER_B)).toEqual([])
  })

  it('cancel: a late success says nothing to B', async () => {
    openAs(GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={guestList()} viewer="guest" />, { wrapper: AppProviders })
    const cancel = hold('POST rpc/cancel_reservation')
    openRow(MINE)
    fireEvent.click(screen.getByRole('button', { name: 'Reservierung aufheben' }))
    await act(() => cancel.arrived.promise)
    await switchTo(channel, OWNER_B)

    await release(cancel, json({ ok: true }))

    expect(getToasts()).toEqual([])
    // the cancel toast ("Okay, der Wunsch ist wieder frei." since the copy review; the old wording stays in the pattern)
    expect(document.body.textContent).not.toMatch(/zurück auf die Liste|wieder frei/)
    expect(sentFor(OWNER_B)).toEqual([])
  })

  it("occasion edit: a late PATCH failure never rolls A's screen back into the cache", async () => {
    openAs(HOST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('owner', HOST_A, 'Mila'))
    render(<EditOccasionPage occasionId={OCCASION_ID} userId={HOST_A} />, { wrapper: AppProviders })
    const patch = hold('PATCH occasions')
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Geheimes Fest' } })
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
    await act(() => patch.arrived.promise)
    expect(queryClient.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.title).toBe('Geheimes Fest')

    await switchTo(channel, OWNER_B)
    expect(queryClient.getQueryData(qk.occasion(OCCASION_ID))).toBeUndefined()

    await release(patch, json({ code: 'XX000', message: 'boom', details: null, hint: null }, 500))

    expect(queryClient.getQueryData(qk.occasion(OCCASION_ID))).toBeUndefined()
    expect(getToasts()).toEqual([])
    expect(peekDraft(HOST_A, OCCASION_ID)).toBeUndefined()
    expect(sentFor(OWNER_B)).toEqual([])
  })

  it('RSVP (optimistic): a late failure neither rolls back into the cache nor toasts; a tap after the switch sends nothing', async () => {
    openAs(GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    render(<RsvpSection screen={screenFor('guest')} userId={GUEST_A} />, { wrapper: AppProviders })
    const patch = hold('PATCH occasion_members')
    fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
    await act(() => patch.arrived.promise)
    expect(queryClient.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.viewer.rsvp).toBe('going')

    await switchTo(channel, OWNER_B)
    const writes = vi.spyOn(queryClient, 'setQueryData')
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries')
    await release(patch, json({ code: 'XX000', message: 'boom', details: null, hint: null }, 500))
    expect(writes).not.toHaveBeenCalled()
    expect(invalidations).not.toHaveBeenCalled()
    expect(getToasts()).toEqual([])

    // the control of A is still in the DOM until the reload: a tap on it is never sent for B
    const before = seen.length
    await act(async () => {
      // the page is hidden now: a click from code / assistive tech still must not send anything
      fireEvent.click(domButton('[role="radio"]', 'Absage'))
      await flush(40)
    })
    expect(seen.slice(before)).toEqual([])
    expect(writes).not.toHaveBeenCalled()
    expect(getToasts()).toEqual([])
  })

  it('invite: a link created for host A is never remembered, shown, shared or copied after the switch', async () => {
    openAs(HOST_A)
    render(<InviteLinkPanel screen={screenFor('owner', HOST_A, 'Mila')} userId={HOST_A} updatedAt={Date.now()} saveState={undefined} />, { wrapper: AppProviders })
    const create = hold('POST rpc/create_invite')
    fireEvent.click(screen.getByRole('button', { name: /Einladungslink erstellen/ }))
    await act(() => create.arrived.promise)
    await switchTo(channel, OWNER_B)

    await release(create, json({ token: INVITE_TOKEN }))

    expect(hooks.shared).toEqual([])
    expect(hooks.copied).toEqual([])
    expect(screen.queryByLabelText('Dein Einladungslink')).toBeNull()
    expect(document.body.innerHTML).not.toContain(INVITE_TOKEN)
    expect(getToasts()).toEqual([])
    expect(hooks.mascot.filter((scene) => scene.includes('play'))).toEqual([])
  })

  it('invite: the share sheet of A was still open — its answer after the switch is no toast and no bunny', async () => {
    openAs(HOST_A)
    const sheet = deferred<string>()
    hooks.share = () => sheet.promise
    render(<InviteLinkPanel screen={screenFor('owner', HOST_A, 'Mila')} userId={HOST_A} updatedAt={Date.now()} saveState={undefined} />, { wrapper: AppProviders })
    fireEvent.click(screen.getByRole('button', { name: /Einladungslink erstellen/ }))
    await waitFor(() => expect(hooks.shared).toHaveLength(1)) // the native share sheet is open now
    await switchTo(channel, OWNER_B)

    await act(async () => {
      sheet.resolve('copied')
      await flush(20)
    })

    expect(getToasts()).toEqual([])
    expect(hooks.mascot.filter((scene) => scene.includes('play'))).toEqual([])
  })

  it('invite: a clipboard copy of A still pending — no "copied" toast or bunny for B, and no new copy after the switch', async () => {
    openAs(HOST_A)
    rememberInviteLink(HOST_A, OCCASION_ID, `https://app.test/i#${INVITE_TOKEN}`)
    const clipboard = deferred<boolean>()
    hooks.copy = () => clipboard.promise
    render(<InviteLinkPanel screen={screenFor('owner', HOST_A, 'Mila')} userId={HOST_A} updatedAt={0} saveState={undefined} />, { wrapper: AppProviders })
    fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }))
    expect(hooks.copied).toHaveLength(1)
    await switchTo(channel, OWNER_B)

    await act(async () => {
      clipboard.resolve(true)
      await flush(20)
    })
    expect(getToasts()).toEqual([])
    expect(hooks.mascot.filter((scene) => scene.includes('play'))).toEqual([])

    fireEvent.click(domButton('button', 'Kopieren'))
    expect(hooks.copied).toHaveLength(1) // A's link is not copied again for B
  })

  it('remove member: a late success of host A is no toast and no cache write for B', async () => {
    openAs(HOST_A)
    const hosted = screenFor('owner', HOST_A, 'Mila')
    queryClient.setQueryData(qk.occasion(OCCASION_ID), hosted)
    render(<MembersSection screen={hosted} userId={HOST_A} />, { wrapper: AppProviders })
    fireEvent.click(screen.getByRole('button', { name: 'Jonas entfernen' }))
    const removal = hold('POST rpc/remove_member')
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }))
    await act(() => removal.arrived.promise)
    await switchTo(channel, OWNER_B)
    const writes = vi.spyOn(queryClient, 'setQueryData')

    await release(removal, json({ ok: true }))

    expect(getToasts()).toEqual([])
    expect(writes).not.toHaveBeenCalled()
    expect(seen.filter((request) => request.route === 'rpc/remove_member')).toHaveLength(1)
    expect(sentFor(OWNER_B)).toEqual([])
  })

  it('delete with undo: A deletes a wish, the account switches inside the 5-second window — nothing is sent, nothing is shown', async () => {
    openAs(HOST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('owner', HOST_A, 'Mila'))
    const errors: unknown[] = []
    scheduleWishDelete({
      wishId: FREE, occasionId: OCCASION_ID, queryClient, delayMs: 40,
      text: { deleted: '„Grillzange“ gelöscht', undo: 'Rückgängig' },
      onError: (error) => { errors.push(error) },
    })
    expect(getToasts()).toHaveLength(1)

    await switchTo(channel, OWNER_B)
    expect(getToasts()).toEqual([]) // the undo toast of A is gone with A
    await act(() => flush(120)) // the pause is over

    expect(seen.filter((request) => request.method === 'DELETE')).toEqual([])
    expect(errors).toEqual([])
    expect(getToasts()).toEqual([])
    expect(isWishDeletePending(FREE)).toBe(false)
  })

  it('export: A\'s JSON that was still being built never becomes downloadable for B', async () => {
    openAs(GUEST_A)
    render(<ExportPage userId={GUEST_A} />, { wrapper: AppProviders })
    const built = hold('POST rpc/export_my_data')
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    await act(() => built.arrived.promise)
    await switchTo(channel, OWNER_B)

    await release(built, json({ format: 'bunprise-export-v1', profile: { id: GUEST_A }, reservations: [{ wish_title: 'Schürze' }] }))

    expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('export: A\'s finished JSON is not downloadable by B after the switch', async () => {
    openAs(GUEST_A)
    // export_my_data answers at once
    fallbacks['POST rpc/export_my_data'] = (id) => json({ format: 'bunprise-export-v1', profile: { id }, reservations: [{ wish_title: 'Schürze' }] })
    render(<ExportPage userId={GUEST_A} />, { wrapper: AppProviders })
    fireEvent.click(screen.getByRole('button', { name: 'Datei erstellen' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Herunterladen' })).toBeTruthy())
    await switchTo(channel, OWNER_B)

    const button = screen.queryByRole('button', { name: 'Herunterladen' })
    if (button) {
      await act(async () => {
        fireEvent.click(button)
        await flush(40)
      })
    }
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('"Beitreten": the screen named A — after the switch nothing is sent for B, and a late answer for A does nothing', async () => {
    openAs(GUEST_A)
    setPendingInvite(INVITE_TOKEN)
    const onInvalid = vi.fn()
    const onSignedOut = vi.fn()
    render(<JoinGate onSignedOut={onSignedOut} onInvalid={onInvalid} />, { wrapper: AppProviders })
    await screen.findByRole('heading', { name: 'Möchtest du beitreten?' })
    expect(document.body.textContent).toContain('Mila Fixture')
    const accept = hold('POST rpc/accept_invite')
    fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }))
    await act(() => accept.arrived.promise)
    await switchTo(channel, OWNER_B)

    await release(accept, json({ occasion_id: OCCASION_ID }))

    expect(hooks.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/occasions/$occasionId' }))
    expect(getPendingInvite()).toBeNull() // the token went with A's drafts and is not put back
    expect(seen.filter((request) => request.route === 'rpc/accept_invite' && request.authorization !== `Bearer fixture-token-${GUEST_A}`)).toEqual([])

    // a second tap on A's screen after the switch joins nobody
    const before = seen.length
    await act(async () => {
      fireEvent.click(domButton('button', 'Beitreten'))
      await flush(40)
    })
    expect(seen.slice(before).filter((request) => request.route === 'rpc/accept_invite')).toEqual([])
    expect(visibleMatches(/Mila Fixture/)).toEqual([]) // A's name is not visible any more
  })
})

describe.each(['storage', 'channel'] as const)('the epoch layer alone (this tab\'s SDK still reports A; reset signalled via %s)', (channel) => {
  it('reserve: the server\'s original already_reserved reaches the screen and still produces nothing for B', async () => {
    openAs(GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={guestList()} viewer="guest" />, { wrapper: AppProviders })
    const reserve = hold('POST rpc/reserve_wish')
    openRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    await act(() => reserve.arrived.promise)
    await signalOnly(channel, OWNER_B)
    expect(replace).toHaveBeenCalledTimes(1)
    hooks.feedback.length = 0
    const writes = vi.spyOn(queryClient, 'setQueryData')

    await release(reserve, pgError('already_reserved'))

    expect(getToasts()).toEqual([])
    expect(writes).not.toHaveBeenCalled()
    expect(within(row(FREE)).queryByText('Reserviert')).toBeNull()
    expect(hooks.feedback).toEqual([])
  })

  it("occasion edit: the server's original failure does not roll A's screen back into the cleared cache", async () => {
    openAs(HOST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('owner', HOST_A, 'Mila'))
    render(<EditOccasionPage occasionId={OCCASION_ID} userId={HOST_A} />, { wrapper: AppProviders })
    const patch = hold('PATCH occasions')
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Geheimes Fest' } })
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
    await act(() => patch.arrived.promise)
    await signalOnly(channel, OWNER_B)
    expect(replace).toHaveBeenCalledTimes(1)

    await release(patch, json({ code: 'XX000', message: 'boom', details: null, hint: null }, 500))

    expect(queryClient.getQueryData(qk.occasion(OCCASION_ID))).toBeUndefined()
    expect(getToasts()).toEqual([])
    expect(peekDraft(HOST_A, OCCASION_ID)).toBeUndefined()
  })
})
