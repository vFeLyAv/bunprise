import type { Ref } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../lib/database.types'

// ADVERSARIAL ROUND 2 — every scenario of Codex review 2 (review-client.md, H1–H3) LITERALLY, with
// controlled promises: an operation starts as account A, the tab switches to B — through this tab's auth
// state callback (sdk), another tab's storage write (storage) or another tab's sign-out announcement on
// the app's BroadcastChannel (channel) — and only then the old promise is resolved or rejected.
// Both reset paths of lib/session.ts are run: the normal one (page hidden + location.replace) and the
// reload-loop guard (a second change < 5 s after an account reload: in-app switch, page shown again).
// Everything is the real app: the root shell (routes/__root.tsx), the _authed guard, the screens, the API
// wrappers over supabase-js + HTTP (MSW), the session watcher. For H3 the OTHER tab runs the real
// signOutEverywhere / deleteMyAccount in a second instance of the app modules (same storage, its own
// BroadcastChannel). SECURE behaviour is asserted; a failing test is a finding. Invented fixtures only.

const hooks = vi.hoisted(() => ({
  client: null as unknown,
  session: null as Session | null,
  router: null as null | { navigate: (options: never) => Promise<void>; state: { location: { pathname: string; href: string } } },
  mascot: [] as string[],
  feedback: [] as string[],
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
  router: {
    navigate: (options: never) => hooks.router?.navigate(options) ?? Promise.resolve(),
    get state() {
      return hooks.router?.state ?? { location: { pathname: '/', href: '/' } }
    },
  },
}))
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
vi.mock('../../lib/haptics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/haptics')>()),
  feedback: (kind: string) => {
    hooks.feedback.push(kind)
  },
}))

import { ACTIVE_STORAGE_PREFIX, AUTH_STORAGE_KEY } from '../../lib/app'
import { resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import type { OccasionScreen } from '../../lib/api/types'
import { clearPersistedCache, queryClient, setSdkSessionIdentity } from '../../lib/query'
import { qk } from '../../lib/queryKeys'
import { watchSessionIdentity } from '../../lib/session'
import { getToasts, toast } from '../../lib/toast'
import { readEmailAttempt, rememberEmailAttempt } from '../../features/auth/flow'
import { LoginForm } from '../../features/auth/LoginForm'
import { resetFeedSession } from '../../features/feed/session'
import { getPendingInvite, setPendingInvite } from '../../features/invite/pending'
import { forgetInviteLinksForTests } from '../../features/occasions/inviteLink'
import { peekDraft, resetSavingForTests } from '../../features/occasions/saving'
import { resetPendingWishDeletes } from '../../features/wishes/pendingDeletes'
import { FakeBroadcastChannel, flush, json, pgError, visibleMatches } from './round1-kit'
import {
  API, FREE, GUEST_A, INVITE_TOKEN, OCC_A, OCC_B, OWNER_B, RESERVATION_WORDS, buildAppRouter, captureAtShow, createBackend,
  createSessionSource, mountAppRouter, openWishRow, pageShown, reloadedAgo, untilShownAgain, type AppRouter,
  type SwitchChannel,
} from './round2-kit'

const backend = createBackend()
backend.server.use(
  http.post(`${API}/auth/v1/logout`, () => new Response(null, { status: 204 })),
  http.post(`${API}/rest/v1/rpc/delete_my_account`, () => json({ ok: true })),
)
const testClient = createClient<Database>(API, 'fixture-publishable-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
hooks.client = testClient
const tab = createSessionSource(testClient, hooks)
const { openAs, switchTo } = tab

type ResetPath = 'reload' | 'in-app'
const PATHS: ResetPath[] = ['reload', 'in-app']
const CHANNELS: SwitchChannel[] = ['sdk', 'storage', 'channel']
const MATRIX = PATHS.flatMap((resetPath) => CHANNELS.map((channel) => [resetPath, channel] as const))

async function mountApp(initial: string): Promise<AppRouter> {
  const router = buildAppRouter(initial, () => null)
  hooks.router = router as unknown as NonNullable<typeof hooks.router>
  await mountAppRouter(router)
  return router
}

/** Puts the tab on the given reset path before the switch (an account reload 1 s ago = loop guard). */
function prepare(resetPath: ResetPath) {
  if (resetPath === 'in-app') reloadedAgo(1_000)
}

/** After the switch: the reload path has replaced the page (hidden); the in-app path shows it again. */
async function afterSwitch(resetPath: ResetPath) {
  if (resetPath === 'reload') {
    expect(replace).toHaveBeenCalledTimes(1)
    expect(pageShown()).toBe(false)
  } else {
    expect(replace).not.toHaveBeenCalled()
    await untilShownAgain()
  }
}

const replace = vi.fn<(url: string) => void>()
let stop: (() => void) | null = null
let createObjectURL: ReturnType<typeof vi.fn>

beforeAll(() => backend.server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => backend.server.close())

beforeEach(async () => {
  tab.attach()
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  vi.stubGlobal('location', { ...window.location, replace })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  createObjectURL = vi.fn(() => 'blob:fixture')
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  replace.mockReset()
  hooks.session = null
  hooks.router = null
  hooks.mascot.length = 0
  hooks.feedback.length = 0
  backend.reset()
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  resetSavingForTests()
  resetPendingWishDeletes()
  forgetInviteLinksForTests()
  resetFeedSession()
  window.localStorage.clear()
  window.sessionStorage.clear()
  stop = watchSessionIdentity()
})

afterEach(async () => {
  stop?.()
  stop = null
  tab.clear()
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
  FakeBroadcastChannel.closeAll()
  vi.unstubAllGlobals()
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  resetSavingForTests()
  resetPendingWishDeletes()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe.each(MATRIX)('Codex H1 (%s path, switch via %s)', (resetPath, channel) => {
  it('«задержать reserve_wish гостя A, переключить сессию на владельца B, вернуть already_reserved»: B gets no reservation message', async () => {
    prepare(resetPath)
    openAs(GUEST_A)
    await mountApp(`/occasions/${OCC_B}`)
    await screen.findByText('Grillzange')
    const reserve = backend.hold('POST rpc/reserve_wish')
    openWishRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    await act(() => reserve.arrived.promise)

    await switchTo(channel, OWNER_B)
    await afterSwitch(resetPath)
    hooks.feedback.length = 0
    const writes = vi.spyOn(queryClient, 'setQueryData')

    await act(async () => {
      reserve.answer.resolve(pgError('already_reserved'))
      await flush(60)
    })

    expect(getToasts()).toEqual([])
    expect(visibleMatches(RESERVATION_WORDS)).toEqual([])
    expect(writes).not.toHaveBeenCalled()
    expect(hooks.feedback).toEqual([])
    expect(backend.sentFor(OWNER_B).filter((request) => request.route === 'rpc/reserve_wish')).toEqual([])
  })

  it("«задержать PATCH повода A, переключиться на B, вернуть ошибку»: the cache never holds A's occasion screen again", async () => {
    prepare(resetPath)
    openAs(GUEST_A)
    const router = await mountApp(`/occasions/${OCC_A}/edit`)
    const title = await screen.findByLabelText('Titel')
    const patch = backend.hold('PATCH occasions')
    fireEvent.change(title, { target: { value: 'Geheimes Fest' } })
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
    await act(() => patch.arrived.promise)

    await switchTo(channel, OWNER_B)
    await afterSwitch(resetPath)
    if (resetPath === 'in-app' && hooks.session) {
      // B opens the occasion he is a guest of: his own screen comes from the server
      await act(async () => {
        await router.navigate({ to: '/occasions/$occasionId', params: { occasionId: OCC_A } })
        await flush(40)
      })
    }

    await act(async () => {
      patch.answer.resolve(json({ code: 'XX000', message: 'boom', details: null, hint: null }, 500))
      await flush(60)
    })

    const cached = queryClient.getQueryData<OccasionScreen>(qk.occasion(OCC_A))
    expect(cached?.viewer.role).not.toBe('host') // A's own (host) screen never comes back for B
    expect(cached?.occasion.title).not.toBe('Geheimes Fest')
    expect(getToasts()).toEqual([])
    expect(peekDraft(GUEST_A, OCC_A)).toBeUndefined()
  })
})

describe.each(MATRIX)('Codex H2 (%s path, switch via %s)', (resetPath, channel) => {
  it("«открыть редактирование пожелания A … проверить первую вкладку без перезагрузки»: A's wish and typed note are not on B's screen", async () => {
    prepare(resetPath)
    openAs(GUEST_A)
    await mountApp(`/occasions/${OCC_A}`)
    await screen.findByText('Fotoalbum')
    // edit lives in the tile's ⋯ since 23.10 (no longer in the wish sheet)
    fireEvent.click(await screen.findByRole('button', { name: 'Mehr zu „Fotoalbum“' }))
    fireEvent.click(await screen.findByRole('link', { name: /Bearbeiten/ }))
    const note = await screen.findByLabelText('Notiz')
    fireEvent.change(note, { target: { value: 'Geheim: Überraschung für Ben, nicht verraten' } })

    await switchTo(channel, OWNER_B)
    await afterSwitch(resetPath)

    expect(visibleMatches(/Überraschung für Ben|Fotos von Ben sammeln/)).toEqual([])
    const before = backend.seen.length
    const save = Array.from(document.querySelectorAll<HTMLElement>('button[type="submit"]'))[0]
    if (save) {
      await act(async () => {
        fireEvent.click(save) // a click from code / assistive tech on A's hidden form
        await flush(40)
      })
    }
    expect(backend.seen.slice(before).filter((request) => request.method === 'PATCH')).toEqual([])
  })

  it("«оставить подтверждение с именем A, сменить аккаунт и проверить, за кого отправляется accept_invite»: nobody joins", async () => {
    prepare(resetPath)
    openAs(GUEST_A)
    setPendingInvite(INVITE_TOKEN)
    await mountApp('/i')
    await screen.findByRole('heading', { name: 'Möchtest du beitreten?' })
    // the join screen names A (B's own feed may legitimately say "Mila Fixture lädt ein": B is her guest)
    const namedA = /deinen Namen „Mila Fixture“/
    expect(visibleMatches(namedA).length).toBeGreaterThan(0)

    await switchTo(channel, OWNER_B)
    await afterSwitch(resetPath)

    expect(visibleMatches(namedA)).toEqual([])
    const join = Array.from(document.querySelectorAll<HTMLElement>('button')).find((button) => button.textContent?.includes('Beitreten'))
    if (join) {
      await act(async () => {
        fireEvent.click(join)
        await flush(40)
      })
    }
    expect(backend.seen.filter((request) => request.route === 'rpc/accept_invite')).toEqual([])
    expect(getPendingInvite()).toBeNull()
  })

  it('«pendingInvite, emailCode, loginDraft и остальные временные записи» of A are gone', async () => {
    prepare(resetPath)
    openAs(GUEST_A)
    await mountApp('/soon')
    await screen.findByText('Bens Grillabend')
    const drafts = ['emailCode', 'loginDraft', 'pendingConsent', 'pendingInvite', 'wishAdded', 'postLoginNext']
    for (const key of drafts) window.sessionStorage.setItem(`${ACTIVE_STORAGE_PREFIX}${key}`, `draft of A (${key})`)

    await switchTo(channel, OWNER_B)
    await afterSwitch(resetPath)

    expect(drafts.filter((key) => window.sessionStorage.getItem(`${ACTIVE_STORAGE_PREFIX}${key}`) !== null)).toEqual([])
  })

  it("export: A's JSON built across the switch is never downloadable", async () => {
    prepare(resetPath)
    openAs(GUEST_A)
    await mountApp('/settings/export')
    const built = backend.hold('POST rpc/export_my_data')
    fireEvent.click(await screen.findByRole('button', { name: 'Datei erstellen' }))
    await act(() => built.arrived.promise)

    await switchTo(channel, OWNER_B)
    await afterSwitch(resetPath)
    await act(async () => {
      built.answer.resolve(json({ format: 'bunprise-export-v1', profile: { id: GUEST_A }, reservations: [{ wish_title: 'Schürze' }] }))
      await flush(60)
    })
    const download = Array.from(document.querySelectorAll<HTMLElement>('button')).find((button) => button.textContent?.includes('Herunterladen'))
    if (download) {
      await act(async () => {
        fireEvent.click(download)
        await flush(40)
      })
    }

    expect(createObjectURL).not.toHaveBeenCalled()
  })
})

describe('Codex H2: the e-mail attempt of A (sessionStorage `emailCode` + its memory copy) after the in-app switch', () => {
  it("A had requested a code in this page; after the switch to signed out the next person sees no e-mail address of A on /login", async () => {
    reloadedAgo(1_000)
    // A asked for a code on /login (signed out), then signed in through another tab: this tab never
    // reached forgetEmailAttempt() (that runs only after its own code screen navigated on)
    rememberEmailAttempt('mila.fixture@example.test', Date.now(), 'signin')
    openAs(GUEST_A)
    const router = buildAppRouter('/soon', () => null, { loginScreen: () => <LoginForm mode="signin" method="email" /> })
    hooks.router = router as unknown as NonNullable<typeof hooks.router>
    await mountAppRouter(router)
    await screen.findByText('Bens Grillabend')

    await switchTo('storage', null) // A signed out in another tab
    await untilShownAgain()
    await act(() => flush(20))

    expect(window.sessionStorage.getItem(`${ACTIVE_STORAGE_PREFIX}emailCode`)).toBeNull() // the stored draft is gone …
    // … SECURE: and nothing else of it — the real /login form prefills its field from readEmailAttempt()
    // (memory copy) and at once writes it back into the session draft `loginDraft`
    expect(visibleMatches(/mila\.fixture@example\.test/)).toEqual([])
    expect(window.sessionStorage.getItem(`${ACTIVE_STORAGE_PREFIX}loginDraft`) ?? '').not.toContain('mila.fixture@example.test')
    expect(readEmailAttempt()).toBeNull()
  })
})

// ---- H3: the OTHER tab signs A out / deletes A with the real code -----------------------------------

type OtherTab = {
  query: typeof import('../../lib/query')
  account: typeof import('../../lib/api/account')
}

/** sessionStorage is per tab in a browser (jsdom has one): the other tab gets a Storage of its own. */
class TabStorage {
  [key: string]: unknown
  getItem(key: string): string | null {
    return Object.hasOwn(this, key) ? String(this[key]) : null
  }
  setItem(key: string, value: string): void {
    this[key] = String(value)
  }
  removeItem(key: string): void {
    delete this[key]
  }
  clear(): void {
    for (const key of Object.keys(this)) delete this[key]
  }
  key(index: number): string | null {
    return Object.keys(this)[index] ?? null
  }
  get length(): number {
    return Object.keys(this).length
  }
}

/** Announcements the other tab posts on its BroadcastChannel (delivered to this tab afterwards). */
const posted: Array<{ name: string; data: unknown }> = []
class RecordingChannel {
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(readonly name: string) {}
  postMessage(data: unknown): void {
    posted.push({ name: this.name, data })
  }
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

/**
 * Runs `work` as a SECOND tab of this device: every app module evaluated again, the same localStorage,
 * its own sessionStorage and BroadcastChannel. Afterwards the browser's cross-tab deliveries reach THIS
 * tab: what the other tab announced, and (optionally) the storage event of the removed auth key.
 */
async function inOtherTab(work: (other: OtherTab) => Promise<unknown> | unknown, options: { storageEvent: boolean }) {
  vi.resetModules()
  const other: OtherTab = { query: await import('../../lib/query'), account: await import('../../lib/api/account') }
  const stored = window.localStorage.getItem(AUTH_STORAGE_KEY)
  const ownSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { value: new TabStorage(), configurable: true, writable: true })
  vi.stubGlobal('BroadcastChannel', RecordingChannel)
  posted.length = 0
  try {
    await work(other)
  } finally {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    if (ownSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', ownSessionStorage)
  }
  hooks.session = null // what this tab's SDK reads from now on (the stored session is gone)
  await act(async () => {
    for (const message of posted) new FakeBroadcastChannel(message.name).postMessage(message.data)
    if (options.storageEvent) {
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_STORAGE_KEY, oldValue: stored, newValue: null, storageArea: window.localStorage }))
    }
    await flush(20)
  })
  return posted.slice()
}

describe.each(PATHS)('Codex H3 (%s path): «в первой выйти либо удалить аккаунт» — the other tab really signs out / deletes', (resetPath) => {
  async function guestViewOfAWithSheetAndToast() {
    prepare(resetPath)
    openAs(GUEST_A)
    await mountApp(`/occasions/${OCC_B}`)
    await screen.findByText('Grillzange')
    openWishRow(FREE)
    expect(screen.getByRole('dialog').textContent).toMatch(/Ich schenke das/)
    act(() => {
      toast.success('Versteckt! Ben Fixture erfährt nichts.')
    })
    // while a sheet is open the toast viewport is inert (Sheet), but on screen
    await waitFor(() => expect(document.body.textContent).toContain('Versteckt!'))
    expect(visibleMatches(RESERVATION_WORDS).length).toBeGreaterThan(0)
  }

  it.each([
    ['signOutEverywhere (online)', true],
    ['the offline sign-out of the settings screen', false],
  ])('%s in the other tab: the guest view, its sheet and toast are gone here', async (_name, online) => {
    await guestViewOfAWithSheetAndToast()
    const atShow = captureAtShow(RESERVATION_WORDS)
    const announced = await inOtherTab((other) => online
      ? other.query.signOutEverywhere({ expectedUserId: GUEST_A, redirectTo: null })
      : other.query.clearAccountDeviceState(GUEST_A, null), { storageEvent: true })
    expect(announced).toEqual([{ name: 'bunprise.session', data: { type: 'account-cleared', userId: GUEST_A } }])
    if (resetPath === 'reload') expect(replace.mock.calls).toEqual([['/login']])
    else await untilShownAgain()

    expect(document.querySelector('[role="dialog"]') === null || !pageShown()).toBe(true)
    expect(getToasts()).toEqual([])
    expect(queryClient.getQueryData(qk.occasion(OCC_B))).toBeUndefined()
    atShow.stop()
    // what a person sees: nothing (reload path: hidden until the unload); in-app: the moment it is shown again
    expect(resetPath === 'reload' ? visibleMatches(RESERVATION_WORDS) : atShow.seen).toEqual([])
  })

  it('deleteMyAccount in the other tab (its storage event may come later): the announcement alone resets this tab', async () => {
    await guestViewOfAWithSheetAndToast()
    const atShow = captureAtShow(RESERVATION_WORDS)
    const announced = await inOtherTab((other) => other.account.deleteMyAccount({ expectedUserId: GUEST_A, redirectTo: null }), { storageEvent: false })
    expect(announced).toEqual([{ name: 'bunprise.session', data: { type: 'account-cleared', userId: GUEST_A } }])
    if (resetPath === 'reload') expect(replace.mock.calls).toEqual([['/login']])
    else await untilShownAgain()

    expect(getToasts()).toEqual([])
    atShow.stop()
    expect(resetPath === 'reload' ? visibleMatches(RESERVATION_WORDS) : atShow.seen).toEqual([])
  })
})
