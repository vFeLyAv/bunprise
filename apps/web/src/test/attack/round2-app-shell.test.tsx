import type { Ref } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../lib/database.types'

// ADVERSARIAL ROUND 2 — the in-app account switch (lib/session.ts switchInApp: a second account change
// less than 5 s after an account reload) against the REAL app shell: routes/__root.tsx RootShell
// (OfflineBanner · AccountSwitchGate around <Outlet/> · LegalFooter · the lazy ToastHost), the REAL
// routes/_authed.tsx guard (getLocalSession + a fresh get_me through lib/consentGate), the real screens
// (FeedPage, OccasionPage with GuestWishlist / OwnerWishlist / RsvpSection / InviteSection, ExportPage),
// the real API wrappers over supabase-js + HTTP (MSW) and the real session watcher. Only the session
// SOURCE is a fixture (getSession / onAuthStateChange of a real client), plus jsdom stand-ins (mascot,
// share sheet, haptics, location.replace). Unlike the reload path, this path SHOWS the page again in
// the same JavaScript realm: whatever of A survives outside the routed screens (the toast viewport,
// module state) becomes visible / usable for B. Every assertion is the SECURE behaviour — a failing
// test is a finding. Invented fixture accounts only.

const hooks = vi.hoisted(() => ({
  client: null as unknown,
  session: null as Session | null,
  router: null as null | { navigate: (options: never) => Promise<void>; state: { location: { pathname: string; href: string } } },
  mascot: [] as string[],
  feedback: [] as string[],
  share: null as null | ((payload: unknown) => Promise<string>),
  shared: [] as unknown[],
  copied: [] as string[],
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
// lib/session.ts navigates with the app router: here it is the router of the running test
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
vi.mock('../../lib/share', () => ({
  canNativeShare: () => true,
  share: (payload: unknown) => {
    hooks.shared.push(payload)
    return hooks.share ? hooks.share(payload) : Promise.resolve('shared')
  },
  copyText: (text: string) => {
    hooks.copied.push(text)
    return Promise.resolve(true)
  },
}))
vi.mock('../../lib/haptics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/haptics')>()),
  feedback: (kind: string) => {
    hooks.feedback.push(kind)
  },
}))

import { OFFLINE_FEED_KEY, QUERY_CACHE_KEY } from '../../lib/app'
import { captureEpoch, resetAccountBoundaryForTests } from '../../lib/accountBoundary'
import type { OccasionScreen } from '../../lib/api/types'
import { clearPersistedCache, queryClient, setSdkSessionIdentity } from '../../lib/query'
import { qk } from '../../lib/queryKeys'
import { watchSessionIdentity } from '../../lib/session'
import { getToasts, toast } from '../../lib/toast'
import { resetFeedSession } from '../../features/feed/session'
import { forgetInviteLinksForTests } from '../../features/occasions/inviteLink'
import { getSaveState, resetSavingForTests } from '../../features/occasions/saving'
import { isWishDeletePending, resetPendingWishDeletes } from '../../features/wishes/pendingDeletes'
import { FakeBroadcastChannel, deferred, flush, json, pgError, visibleMatches } from './round1-kit'
import {
  ALBUM, API, FREE, GUEST_A, MINE, OCC_A, OCC_B, OWNER_B, RESERVATION_WORDS, buildAppRouter, captureAtShow, createBackend, createSessionSource, me,
  mountAppRouter, openWishRow, pageShown, reloadedAgo, untilShownAgain, type AppRouter,
} from './round2-kit'

// ---- the backend and this tab's session source ----------------------------------------------------

const backend = createBackend()
const testClient = createClient<Database>(API, 'fixture-publishable-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
hooks.client = testClient
const tab = createSessionSource(testClient, hooks)
const { openAs, switchTo } = tab

const slots = { guard: null as Promise<void> | null }

async function mountApp(initial: string): Promise<AppRouter> {
  const router = buildAppRouter(initial, () => slots.guard)
  hooks.router = router as unknown as NonNullable<typeof hooks.router>
  await mountAppRouter(router)
  return router
}

/** A's guest view of B's list (chips, rows that open the reservation sheet). */
async function mountGuestViewOfA(): Promise<AppRouter> {
  openAs(GUEST_A)
  const router = await mountApp(`/occasions/${OCC_B}`)
  await screen.findByText('Grillzange')
  expect(screen.getAllByText('Von dir reserviert').length).toBeGreaterThan(0)
  return router
}

/** A reserves "Grillzange" and closes the sheet while the server answers: the confirmation is a toast. */
async function reserveWithToast() {
  const reserve = backend.hold('POST rpc/reserve_wish')
  openWishRow(FREE)
  fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
  await act(() => reserve.arrived.promise)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Schließen' }))
  await act(async () => {
    reserve.answer.resolve(json({ ok: true }))
    await flush(40)
  })
  await waitFor(() => expect(visibleMatches(/Versteckt!/).length).toBeGreaterThan(0))
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
  hooks.shared.length = 0
  hooks.copied.length = 0
  hooks.share = null
  slots.guard = null
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
  slots.guard = null
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

/**
 * B's guard (a fresh get_me) answers within the same moment instead of after a network round trip —
 * a fast connection. The exposure below is a race between that round trip and the toast's 160 ms
 * fade-out; this keeps the test independent of how busy the test machine is.
 */
function answerGetMeWithoutNetwork() {
  const realRpc = testClient.rpc.bind(testClient)
  vi.spyOn(testClient, 'rpc').mockImplementation(((fn: string, args?: Record<string, unknown>) => {
    if (fn !== 'get_me') return realRpc(fn as never, args as never)
    const answer = Promise.resolve({ data: me(hooks.session?.user.id ?? ''), error: null, count: null, status: 200, statusText: 'OK' })
    return Object.assign(answer, { setHeader: () => answer })
  }) as never)
}

describe('in-app switch with the real root shell: the toast viewport lives OUTSIDE AccountSwitchGate', () => {
  it.each(['sdk', 'storage'] as const)(
    'via %s: A\'s reservation toast ("Versteckt! Ben … erfährt nichts.") is not on screen when the page shows owner B\'s screen',
    async (channel) => {
      reloadedAgo(1_000)
      await mountGuestViewOfA()
      await reserveWithToast()
      answerGetMeWithoutNetwork()
      const atShow = captureAtShow(/Versteckt!|Ben Fixture erfährt nichts/)

      await switchTo(channel, OWNER_B) // B (the owner of this very list) signs in
      await untilShownAgain()
      atShow.stop()

      // SECURE: the moment B's page is visible again, nothing of A's reservation is on it. toast.clear()
      // emptied the queue, but the viewport (outside the gate) keeps the old toast for its 160 ms fade-out
      expect(atShow.seen).toEqual([])
    },
  )

  it("A signed out in another tab (in-app switch to /login, no guard to wait for): the next person does not see A's reservation toast", async () => {
    reloadedAgo(1_000)
    await mountGuestViewOfA()
    await reserveWithToast()
    const atShow = captureAtShow(/Versteckt!/)

    await switchTo('storage', null)
    await untilShownAgain()
    atShow.stop()

    expect(screen.getByText('Anmeldeseite')).toBeTruthy()
    expect(atShow.seen).toEqual([])
  })

  it("A's undo toast of a pending wish delete (with its \"Rückgängig\" button) is not on B's page", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    await mountApp(`/occasions/${OCC_A}`)
    await screen.findByText('Fotoalbum')
    // delete lives in the tile's ⋯ since 23.10 (no longer in the wish sheet)
    fireEvent.click(await screen.findByRole('button', { name: 'Mehr zu „Fotoalbum“' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Wunsch löschen' }))
    await waitFor(() => expect(visibleMatches(/„Fotoalbum“ gelöscht/).length).toBeGreaterThan(0))
    answerGetMeWithoutNetwork()
    const atShow = captureAtShow(/gelöscht|Rückgängig/)

    await switchTo('sdk', OWNER_B)
    await untilShownAgain()
    atShow.stop()

    expect(atShow.seen).toEqual([])
  })
})

describe('in-app switch: module state of A must not shape B\'s screens', () => {
  it("an interrupted occasion edit of A: B (a guest of that occasion) gets a usable screen, not A's stale 'saving' state", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    const router = await mountApp(`/occasions/${OCC_A}/edit`)
    const title = await screen.findByLabelText('Titel')
    const patch = backend.hold('PATCH occasions')
    fireEvent.change(title, { target: { value: 'Neuer Titel' } })
    fireEvent.click(screen.getByRole('button', { name: /Speichern/ }))
    await act(() => patch.arrived.promise)
    expect(getSaveState(OCC_A)).toBe('saving')

    await switchTo('sdk', OWNER_B)
    await untilShownAgain()
    await act(async () => {
      patch.answer.resolve(json({ code: 'XX000', message: 'boom', details: null, hint: null }, 500))
      await flush(40)
    })
    // B opens the occasion he is a guest of
    await act(async () => {
      await router.navigate({ to: '/occasions/$occasionId', params: { occasionId: OCC_A } })
      await flush(40)
    })
    await screen.findByText('Fotoalbum')

    // B can open the "…" menu (leave, report) — A's ended save does not lock it
    expect((screen.getByRole('button', { name: 'Mehr' }) as HTMLButtonElement).disabled).toBe(false)
    expect(getSaveState(OCC_A)).toBeUndefined()
  })
})

describe.each(['sdk', 'storage', 'channel'] as const)("in-app switch via %s: late answers of A once B's page is shown", (channel) => {
  it('a late already_reserved of A is no toast, chip, haptic or hamster for owner B', async () => {
    reloadedAgo(1_000)
    await mountGuestViewOfA()
    const reserve = backend.hold('POST rpc/reserve_wish')
    openWishRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    await act(() => reserve.arrived.promise)

    await switchTo(channel, OWNER_B)
    await untilShownAgain()
    hooks.mascot.length = 0
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
    expect(hooks.mascot.filter((scene) => scene.startsWith('hamster:play'))).toEqual([])
    expect(backend.sentFor(OWNER_B).filter((request) => request.route.startsWith('rpc/reserve'))).toEqual([])
  })

  it("the export JSON of A that was still being built never becomes downloadable on B's page", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    await mountApp('/settings/export')
    const built = backend.hold('POST rpc/export_my_data')
    fireEvent.click(await screen.findByRole('button', { name: 'Datei erstellen' }))
    await act(() => built.arrived.promise)

    await switchTo(channel, OWNER_B)
    await untilShownAgain()
    await act(async () => {
      built.answer.resolve(json({ format: 'bunprise-export-v1', profile: { id: GUEST_A }, reservations: [{ wish_title: 'Schürze' }] }))
      await flush(60)
    })

    expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(visibleMatches(/Schürze/)).toEqual([])
  })
})

describe('A → B → A within the guard window (the API layer accepts A again; only the epoch can tell)', () => {
  it("a late reservation success of A's first visit is no celebration, toast or refetch in A's next screen", async () => {
    reloadedAgo(1_000)
    await mountGuestViewOfA()
    const reserve = backend.hold('POST rpc/reserve_wish')
    openWishRow(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    await act(() => reserve.arrived.promise)

    await switchTo('sdk', OWNER_B)
    await untilShownAgain()
    await switchTo('sdk', GUEST_A)
    await untilShownAgain()
    expect(replace).not.toHaveBeenCalled()
    hooks.mascot.length = 0
    const invalidations = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      reserve.answer.resolve(json({ ok: true }))
      await flush(60)
    })

    expect(getToasts()).toEqual([])
    expect(invalidations).not.toHaveBeenCalled()
    expect(hooks.mascot.filter((scene) => scene.startsWith('hamster'))).toEqual([])
  })

  it('a late RSVP failure of the first A neither rolls the cache back nor toasts in the second A', async () => {
    reloadedAgo(1_000)
    const router = await mountGuestViewOfA()
    const patch = backend.hold('PATCH occasion_members')
    fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
    await act(() => patch.arrived.promise)

    await switchTo('storage', OWNER_B)
    await untilShownAgain()
    await switchTo('storage', GUEST_A)
    await untilShownAgain()
    await act(async () => {
      await router.navigate({ to: '/occasions/$occasionId', params: { occasionId: OCC_B } })
      await flush(40)
    })
    await screen.findByText('Grillzange')
    const writes = vi.spyOn(queryClient, 'setQueryData')

    await act(async () => {
      patch.answer.resolve(json({ code: 'XX000', message: 'boom', details: null, hint: null }, 500))
      await flush(60)
    })

    expect(writes).not.toHaveBeenCalled()
    expect(getToasts()).toEqual([])
  })
})

describe('reload-loop attempt (rapid A → B → A → B) on the real shell', () => {
  it('never a reload within the guard window, never a former account\'s screen while the page is shown, the last screen is fresh', async () => {
    reloadedAgo(500)
    await mountGuestViewOfA()
    const guard = deferred()
    slots.guard = guard.promise // every next account's guard hangs until released
    const shownLeaks: string[][] = []
    const watch = () => {
      if (pageShown()) shownLeaks.push(visibleMatches(RESERVATION_WORDS))
    }
    await switchTo('sdk', OWNER_B)
    watch()
    await switchTo('storage', GUEST_A)
    watch()
    await switchTo('sdk', OWNER_B)
    watch()
    await act(async () => {
      guard.resolve()
      await flush(80)
    })
    await untilShownAgain()

    expect(replace).not.toHaveBeenCalled()
    expect(shownLeaks.flat()).toEqual([])
    expect(captureEpoch().userId).toBe(OWNER_B)
    // B's own feed, fetched for B: the owner's row never carries a reservation count
    await screen.findByText('Bens Grillabend')
    expect(visibleMatches(RESERVATION_WORDS)).toEqual([])
  })
})

describe('persisted feed and the in-app switch', () => {
  it("A's opted-in snapshot never reaches B's page, and B's feed never goes to disk without B's opt-in", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    window.localStorage.setItem(OFFLINE_FEED_KEY, GUEST_A) // A opted in earlier
    await mountApp('/soon')
    await screen.findByText('Bens Grillabend')
    await waitFor(() => expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toContain(OCC_A)) // A's own snapshot

    await switchTo('storage', OWNER_B)
    await untilShownAgain()
    await screen.findByText('Bens Grillabend')
    await act(() => flush(40))

    expect(window.localStorage.getItem(OFFLINE_FEED_KEY)).toBeNull()
    expect(window.localStorage.getItem(QUERY_CACHE_KEY)).toBeNull()
  })
})

describe('delete with undo across the in-app switch', () => {
  it('A deletes a wish of her own list, B signs in within the 5 s pause: nothing is sent and the pending delete is forgotten', async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    await mountApp(`/occasions/${OCC_A}`)
    await screen.findByText('Fotoalbum')
    // delete lives in the tile's ⋯ since 23.10 (no longer in the wish sheet)
    fireEvent.click(await screen.findByRole('button', { name: 'Mehr zu „Fotoalbum“' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Wunsch löschen' }))
    await waitFor(() => expect(isWishDeletePending(ALBUM)).toBe(true))

    await switchTo('sdk', OWNER_B)
    await untilShownAgain()
    await act(() => flush(5_200)) // the pause is over

    expect(backend.seen.filter((request) => request.method === 'DELETE')).toEqual([])
    expect(isWishDeletePending(ALBUM)).toBe(false)
  }, 12_000)
})

describe('the invite share sheet of host A still pending at the in-app switch', () => {
  it("its answer after B's page is shown: no toast, no bunny, no host screen of A in the cache", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    const sheet = deferred<string>()
    hooks.share = () => sheet.promise
    await mountApp(`/occasions/${OCC_A}`)
    // the link lives in "Wer kommt" › "Per Link einladen" (27.10)
    fireEvent.click(await screen.findByRole('button', { name: /^Per Link einladen/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Einladungslink erstellen/ }))
    await waitFor(() => expect(hooks.shared).toHaveLength(1)) // the native share sheet is open

    await switchTo('sdk', OWNER_B)
    await untilShownAgain()
    hooks.mascot.length = 0
    await act(async () => {
      sheet.resolve('copied')
      await flush(40)
    })

    expect(getToasts()).toEqual([])
    expect(hooks.mascot.filter((scene) => scene.includes('play'))).toEqual([])
    expect(queryClient.getQueryData<OccasionScreen>(qk.occasion(OCC_A))?.viewer.role).not.toBe('host')
  })
})

describe('portals of A at the in-app switch', () => {
  it("A's open guest sheet (portal in <body>) is gone at once and does not come back on B's page", async () => {
    reloadedAgo(1_000)
    await mountGuestViewOfA()
    openWishRow(MINE)
    expect(screen.getByRole('dialog').textContent).toMatch(/Reservierung aufheben/)

    await switchTo('sdk', OWNER_B)
    expect(document.querySelector('[role="dialog"]')).toBeNull() // unmounted, not only hidden
    await untilShownAgain()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(visibleMatches(RESERVATION_WORDS)).toEqual([])
  })
})

describe('more in-app variants: a queued RSVP tap and an open confirmation of A', () => {
  it("two quick RSVP taps of A (the second waits behind the first in its mutation scope), then the switch: nothing is sent with B's token, nothing rolls back", async () => {
    reloadedAgo(1_000)
    await mountGuestViewOfA()
    const first = backend.hold('PATCH occasion_members')
    fireEvent.click(screen.getByRole('radio', { name: 'Zusage' }))
    await act(() => first.arrived.promise)
    fireEvent.click(screen.getByRole('radio', { name: 'Absage' })) // queued: same scope rsvp:<occasion>

    await switchTo('sdk', OWNER_B)
    await untilShownAgain()
    const writes = vi.spyOn(queryClient, 'setQueryData')
    await act(async () => {
      first.answer.resolve(new Response(null, { status: 204 }))
      await flush(80)
    })

    expect(backend.sentFor(OWNER_B).filter((request) => request.route === 'occasion_members')).toEqual([])
    expect(writes).not.toHaveBeenCalled()
    expect(getToasts()).toEqual([])
  })

  it("host A's open \"Anlass löschen?\" confirmation (a portal naming her occasion) is gone at once and nothing is deleted", async () => {
    reloadedAgo(1_000)
    openAs(GUEST_A)
    await mountApp(`/occasions/${OCC_A}`)
    await screen.findByText('Fotoalbum')
    fireEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Anlass löschen' }))
    expect(await screen.findByText(/wird mit allen Wünschen gelöscht/)).toBeTruthy()

    await switchTo('storage', OWNER_B)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await untilShownAgain()

    expect(visibleMatches(/wird mit allen Wünschen gelöscht|Anlass löschen\?/)).toEqual([])
    expect(backend.seen.filter((request) => request.method === 'DELETE')).toEqual([])
  })
})

describe('the reload path: A\'s hidden screen until the page unloads', () => {
  it.each(['sdk', 'storage', 'channel'] as const)(
    "via %s: a network change while the reload is on its way never makes A's hidden feed fetch with B's token",
    async (channel) => {
      openAs(GUEST_A) // no account reload before: the normal reset (hidden page + location.replace)
      await mountApp('/soon')
      await screen.findByText('Bens Grillabend')

      await switchTo(channel, OWNER_B)
      expect(replace).toHaveBeenCalledTimes(1)
      // the phone changes networks while the new page loads (offline → online): FeedPage follows
      // onlineManager, re-renders, and its useQuery rebuilds the ['feed'] query that clear() removed
      await act(async () => {
        onlineManager.setOnline(false)
        onlineManager.setOnline(true)
        await flush(80)
      })

      expect(backend.sentFor(OWNER_B)).toEqual([])
      expect(queryClient.getQueryData(qk.feed())).toBeUndefined()
    },
  )

  it.each(['sdk', 'storage', 'channel'] as const)(
    "via %s: a refresh of A's occasion screen in flight at the switch never turns into a request with B's token",
    async (channel) => {
      openAs(GUEST_A) // no account reload before: the normal reset (hidden page + location.replace)
      await mountApp(`/occasions/${OCC_B}`)
      await screen.findByText('Grillzange')
      const refresh = backend.hold('POST rpc/get_occasion_screen')
      await act(async () => {
        void queryClient.invalidateQueries({ queryKey: qk.occasion(OCC_B) }) // e.g. after a reservation, a focus refetch
        await refresh.arrived.promise
      })

      await switchTo(channel, OWNER_B)
      expect(replace).toHaveBeenCalledTimes(1)
      await act(async () => {
        refresh.answer.resolve(json({ code: 'XX000', message: 'late', details: null, hint: null }, 500))
        await flush(80)
      })

      // SECURE: the screen of A that waits for its unload sends nothing for B (round 1 asserted the same and
      // is flaky exactly here: cancelQueries() reverts the fetch, the revert re-renders A's mounted screen,
      // and its useQuery builds the query that clear() removed — and fetches it with the current account)
      expect(backend.sentFor(OWNER_B)).toEqual([])
      expect(queryClient.getQueryData(qk.occasion(OCC_B))).toBeUndefined()
    },
  )
})
