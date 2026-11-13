import type { ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen, OccasionScreenWish } from '../lib/api/types'

// Late answers of a previous account and the guest → owner switch, with the REAL screens and the REAL
// session watcher (Codex review 2: H1, H2, M4). The owner of a list must learn nothing — not from a
// toast, a cache write, a hamster, a rolled-back screen or a DOM node that survived the switch.
// Invented fixture accounts only; the API modules are controlled promises.

const sdk = vi.hoisted(() => ({ callback: null as ((event: AuthChangeEvent, session: Session | null) => void) | null }))
const api = vi.hoisted(() => ({
  reserve: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  cancel: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  updateOccasion: vi.fn(),
  getOccasionScreen: vi.fn(),
  mascot: [] as string[],
  back: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  hasLocalSession: () => false,
  getSupabase: () => Promise.reject(new Error('no Supabase client in this test')),
  onClientReady: (ready: (client: unknown) => void) => {
    ready({ auth: { onAuthStateChange: (callback: typeof sdk.callback) => {
      sdk.callback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    } } })
    return vi.fn()
  },
}))
vi.mock('../router', () => ({ router: { state: { location: { pathname: '/', href: '/' } }, navigate: vi.fn() } }))
vi.mock('../lib/api/reservations', () => ({ reserveWish: api.reserve, cancelReservation: api.cancel, getMyReservations: vi.fn() }))
vi.mock('../lib/api/occasions', () => ({
  getOccasionScreen: api.getOccasionScreen,
  getFeed: vi.fn(() => new Promise(() => {})),
  updateOccasion: api.updateOccasion,
  createOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  leaveOccasion: vi.fn(),
  removeMember: vi.fn(),
  setRsvp: vi.fn(),
  newOccasionId: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => {
  const mocked = {
    useRouter: () => ({ navigate: vi.fn(), history: { back: api.back }, state: { location: { pathname: '/' } }, subscribe: () => () => {} }),
    useNavigate: () => vi.fn(),
    useCanGoBack: () => true,
    Link: ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>,
  }
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
  return { ...mocked, createLink: () => mocked.Link }
})
vi.mock('../features/mascot-ui/Mascot', () => ({
  Mascot: ({ kind, scene }: { kind: string; scene?: string }) => {
    if (scene) api.mascot.push(`${kind}:${scene}`)
    return <div data-testid="mascot" data-kind={kind} data-scene={scene ?? ''} />
  },
  preloadMascot: () => undefined,
}))

import { resetAccountBoundaryForTests } from '../lib/accountBoundary'
import { AppError } from '../lib/errors'
import { clearPersistedCache, queryClient, setSdkSessionIdentity } from '../lib/query'
import { qk } from '../lib/queryKeys'
import { watchSessionIdentity } from '../lib/session'
import { getToasts, toast } from '../lib/toast'
import { EditOccasionPage } from '../features/occasions/EditOccasionPage'
import { peekDraft, resetSavingForTests } from '../features/occasions/saving'
import { WishlistSection } from '../features/wishes/WishlistSection'
import { resetPendingWishDeletes } from '../features/wishes/pendingDeletes'
import { AUTH_STORAGE_KEY } from '../lib/app'

const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
const GUEST_A = '00000000-0000-4000-8000-0000000000a1'
const OWNER_B = '00000000-0000-4000-8000-0000000000b2'
const FREE = '00000000-0000-4000-8000-00000000f001'
const MINE = '00000000-0000-4000-8000-00000000f002'
const TAKEN = '00000000-0000-4000-8000-00000000f003'
const RESERVATION_TEXT = /reserv|Von dir|Ich schenke|Meine Reservierungen|schenkt schon|Versteckt/i

const replace = vi.fn<(url: string) => void>()
let stop: (() => void) | null = null

function wish(id: string, title: string, reserved: boolean | null, mine: boolean | null): OccasionScreenWish {
  return {
    id, title, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved, reserved_by_me: mine,
  }
}

/** The same occasion as the guest A and as its owner B get it from get_occasion_screen. */
function screenFor(viewer: 'guest' | 'owner'): OccasionScreen {
  const guest = viewer === 'guest'
  return {
    occasion: {
      id: OCCASION_ID, title: 'Bens Grillabend', starts_at: '2030-06-15T16:00:00.000Z', tz: 'Europe/Berlin', all_day: false,
      place_text: null, description: null, created_at: '2030-01-01T10:00:00.000Z', host: { id: OWNER_B, display_name: 'Ben' },
    },
    viewer: guest ? { role: 'member', rsvp: 'going' } : { role: 'host', rsvp: 'going' },
    members: [],
    invite: null,
    wishlist: {
      id: '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b', owner_id: OWNER_B, title: 'Bens Grillabend',
      wishes: [
        wish(FREE, 'Grillzange', guest ? false : null, guest ? false : null),
        wish(MINE, 'Schürze', guest ? true : null, guest ? true : null),
        wish(TAKEN, 'Kohle', guest ? true : null, guest ? false : null),
      ],
    },
  }
}

function sdkEvent(event: AuthChangeEvent, userId: string | null) {
  if (userId) window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: { id: userId } }))
  else window.localStorage.removeItem(AUTH_STORAGE_KEY)
  sdk.callback?.(event, userId ? ({ user: { id: userId } } as Session) : null)
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>{children}</LazyMotion>
    </QueryClientProvider>
  )
}

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

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.stubGlobal('location', { ...window.location, replace })
  vi.stubGlobal('BroadcastChannel', undefined) // the channel is covered in accountBoundary.test.ts
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  replace.mockReset()
  api.reserve.mockReset()
  api.cancel.mockReset()
  api.updateOccasion.mockReset()
  api.getOccasionScreen.mockReset().mockReturnValue(new Promise(() => {}))
  api.back.mockReset()
  api.mascot.length = 0
  sdk.callback = null
  setSdkSessionIdentity(undefined)
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  resetSavingForTests()
  resetPendingWishDeletes()
  window.localStorage.clear()
  window.sessionStorage.clear()
})
afterEach(async () => {
  stop?.()
  stop = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetAccountBoundaryForTests()
  await clearPersistedCache()
  queryClient.clear()
  toast.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('late answers of a previous account (b)', () => {
  it('a reserve rejected with already_reserved after the switch: no toast, no cache write, no list change, no hamster', async () => {
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    const answer = deferred()
    api.reserve.mockReturnValue(answer.promise)
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={screenFor('guest').wishlist!} viewer="guest" />, { wrapper: Providers })
    openRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    expect(api.reserve).toHaveBeenCalledWith(FREE, GUEST_A) // sent for the account of the screen

    sdkEvent('SIGNED_IN', OWNER_B) // the owner signs in (e.g. in another tab) while the request travels
    expect(replace).toHaveBeenCalledWith('/soon')
    const writes = vi.spyOn(queryClient, 'setQueryData')
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => answer.reject(new AppError('already_reserved')))

    expect(getToasts()).toEqual([])
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(writes).not.toHaveBeenCalled()
    expect(invalidations).not.toHaveBeenCalled()
    expect(row(FREE).textContent).not.toMatch(/Reserviert/)
    expect(api.mascot.filter((scene) => scene.startsWith('hamster:jump'))).toEqual([])
  })

  it('a reserve confirmed after the switch: no celebration, no hint, no refetch', async () => {
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    const answer = deferred()
    api.reserve.mockReturnValue(answer.promise)
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={screenFor('guest').wishlist!} viewer="guest" />, { wrapper: Providers })
    openRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' })) // the success would be a toast now
    sdkEvent('SIGNED_OUT', null)
    expect(replace).toHaveBeenCalledWith('/login')
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => answer.resolve())

    expect(getToasts()).toEqual([])
    expect(invalidations).not.toHaveBeenCalled()
    expect(row(FREE).textContent).not.toMatch(/Von dir/)
  })

  it("a late occasion PATCH failure after the switch does not restore A's screen into the cache", async () => {
    const HOST_A = OWNER_B.replace('b2', 'a3')
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', HOST_A)
    const hosted = screenFor('owner')
    queryClient.setQueryData(qk.occasion(OCCASION_ID), { ...hosted, occasion: { ...hosted.occasion, host: { id: HOST_A, display_name: 'Mila' } } })
    const write = deferred()
    api.updateOccasion.mockReturnValue(write.promise)
    render(<EditOccasionPage occasionId={OCCASION_ID} userId={HOST_A} />, { wrapper: Providers })
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Geheimes Fest' } })
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
    await waitFor(() => expect(api.updateOccasion).toHaveBeenCalledWith(OCCASION_ID, expect.objectContaining({ title: 'Geheimes Fest' }), HOST_A))
    expect(queryClient.getQueryData<OccasionScreen>(qk.occasion(OCCASION_ID))?.occasion.title).toBe('Geheimes Fest')

    sdkEvent('SIGNED_IN', OWNER_B)
    expect(queryClient.getQueryData(qk.occasion(OCCASION_ID))).toBeUndefined()

    await act(async () => write.reject(new AppError('generic')))

    expect(queryClient.getQueryData(qk.occasion(OCCASION_ID))).toBeUndefined() // not rolled back into B's cache
    expect(getToasts()).toEqual([])
    expect(peekDraft(HOST_A, OCCASION_ID)).toBeUndefined()
  })
})

describe('guest → owner switch (e)', () => {
  it('the reset fires on the switch and no guest DOM, portal or toast survives the remount as owner', async () => {
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', GUEST_A)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('guest'))
    const guestView = render(<WishlistSection occasionId={OCCASION_ID} wishlist={screenFor('guest').wishlist!} viewer="guest" />, { wrapper: Providers })
    expect(within(row(MINE)).getByText('Von dir reserviert')).toBeTruthy() // the guest DOM shows reservation state
    openRow(MINE)
    expect(screen.getByRole('dialog').textContent).toMatch(/Reservierung aufheben/) // a portal in <body>
    toast.success('Versteckt! Ben erfährt nichts.')

    sdkEvent('SIGNED_IN', OWNER_B)

    expect(replace.mock.calls).toEqual([['/soon']]) // the reset fired: a full reload
    expect(getToasts()).toEqual([])
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(document.documentElement.style.visibility).toBe('hidden') // until the reload, nothing is visible …
    expect(document.body.hasAttribute('inert')).toBe(true) // … or usable

    // The reload: a new document, every module and screen built again for B.
    guestView.unmount()
    stop()
    resetAccountBoundaryForTests()
    document.body.innerHTML = ''
    expect(document.body.textContent).toBe('')
    stop = watchSessionIdentity()
    sdkEvent('INITIAL_SESSION', OWNER_B)
    queryClient.setQueryData(qk.occasion(OCCASION_ID), screenFor('owner'))
    render(<WishlistSection occasionId={OCCASION_ID} wishlist={screenFor('owner').wishlist!} viewer="owner" />, { wrapper: Providers })
    openRow(MINE)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(RESERVATION_TEXT)
    expect(getToasts()).toEqual([])
    expect(replace).toHaveBeenCalledTimes(1)
  })
})
