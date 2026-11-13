import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionPhoto } from '../../lib/api/photos'
import type { FeedOccasion, FeedScreen, OccasionScreen } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { browserTimeZone } from '../../lib/time'

// The occasion cover on the Start card (Felix 25.10; FeedCover.tsx / FeedCoverImage.tsx / coverQueue.ts).
const api = vi.hoisted(() => ({ getOccasionPhoto: vi.fn() }))
vi.mock('../../lib/api/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/photos')>()),
  getOccasionPhoto: api.getOccasionPhoto,
}))

import { FeedCard } from './FeedCard'
import { coverMetaOf } from './FeedCover'
import { coverQueueState, inCoverQueue, MAX_PARALLEL_COVERS } from './coverQueue'

const ID = '0b7c8a1e-2222-4a5b-9c3d-000000000001'
const META = { width: 1200, height: 800, updated_at: '2026-10-25T10:00:00.000Z' }

// Invented fixture (no real data).
function row(overrides: Partial<FeedOccasion> = {}): FeedOccasion {
  return {
    id: ID, title: 'Annas Einweihung', starts_at: '2026-10-28T17:00:00.000Z', tz: browserTimeZone(), all_day: false,
    place_text: 'Café am Markt', role: 'member', rsvp: 'none', host_name: 'Anna', host_id: 'host-1',
    member_count: 4, wish_count: 6, my_reservation_count: 0,
    ...overrides,
  }
}

/** A controllable IntersectionObserver: `intersect()` reports every observed element as visible. */
class FakeObserver {
  static all: FakeObserver[] = []
  elements: Element[] = []
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(element: Element) { this.elements.push(element) }
  unobserve() {}
  disconnect() { this.elements = [] }
  takeRecords() { return [] }
  static intersect() {
    for (const observer of FakeObserver.all) {
      const entries = observer.elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry)
      if (entries.length) observer.callback(entries, observer as unknown as IntersectionObserver)
    }
  }
}

function renderCard(occasion: FeedOccasion, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/soon', component: () => <FeedCard occasion={occasion} /> }),
    createRoute({ getParentRoute: () => rootRoute, path: '/occasions/$occasionId', component: () => <p>occasion</p> }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/soon'] }) })
  render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { queryClient }
}

const photo = (): OccasionPhoto => ({ mime: 'image/webp', blob: new Blob(['x'], { type: 'image/webp' }), ...META })
const flushPaint = () => act(async () => { await new Promise((done) => setTimeout(done, 30)) })
/** The cover box (the eager placeholder first, then the lazy half's box in the same place). */
const coverBox = (): HTMLElement => {
  const box = document.querySelector<HTMLElement>('.feed-cover')
  if (!box) throw new Error('no cover box')
  return box
}
/** After the paint the lazy half takes over and starts watching the viewport. */
const lazyHalfWatching = () => waitFor(() => expect(FakeObserver.all.some((observer) => observer.elements.length > 0)).toBe(true))

beforeEach(() => {
  api.getOccasionPhoto.mockReset()
  FakeObserver.all = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  URL.createObjectURL = vi.fn(() => 'blob:cover')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Start card cover', () => {
  it('no photo (null) or an older server (no key): the card as before, no cover box, no request', async () => {
    for (const occasion of [row({ photo: null }), row()]) {
      renderCard(occasion)
      expect(await screen.findByRole('link', { name: 'Annas Einweihung' })).toBeTruthy()
      expect(document.querySelector('.feed-cover')).toBeNull()
      await flushPaint()
      act(() => FakeObserver.intersect())
      expect(api.getOccasionPhoto).not.toHaveBeenCalled()
      document.body.innerHTML = ''
    }
  })

  it('with a photo: the box is there from the first render (no jump), the bytes only after paint and once visible', async () => {
    let resolve!: (value: OccasionPhoto) => void
    api.getOccasionPhoto.mockReturnValue(new Promise<OccasionPhoto>((done) => { resolve = done }))
    renderCard(row({ photo: META }))
    const link = await screen.findByRole('link', { name: 'Annas Einweihung' })
    expect(link.contains(coverBox())).toBe(true)
    expect(coverBox().getAttribute('aria-hidden')).toBe('true')
    expect(coverBox().getAttribute('data-state') ?? 'loading').toBe('loading') // the eager placeholder: just the tinted box
    expect(link.hasAttribute('data-cover')).toBe(true)
    // after the paint the lazy half watches the viewport — not near it yet: nothing is requested
    await flushPaint()
    await lazyHalfWatching()
    expect(link.contains(coverBox())).toBe(true)
    expect(api.getOccasionPhoto).not.toHaveBeenCalled()
    act(() => FakeObserver.intersect())
    await waitFor(() => expect(api.getOccasionPhoto).toHaveBeenCalledWith(ID))
    await act(async () => { resolve(photo()) })
    const img = await waitFor(() => {
      const found = coverBox().querySelector('img')
      expect(found).not.toBeNull()
      return found!
    })
    expect(img.getAttribute('src')).toBe('blob:cover')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.hasAttribute('data-loaded')).toBe(false) // invisible until decoded
    act(() => { img.dispatchEvent(new Event('load')) })
    await waitFor(() => expect(coverBox().getAttribute('data-state')).toBe('ready'))
    expect(img.hasAttribute('data-loaded')).toBe(true)
  })

  it('a cover that cannot be loaded keeps the calm tint (no error, no retry storm)', async () => {
    api.getOccasionPhoto.mockRejectedValue(new AppError('not_found')) // no access / no photo: a final answer
    renderCard(row({ photo: META }))
    await waitFor(() => coverBox())
    await flushPaint()
    await lazyHalfWatching()
    act(() => FakeObserver.intersect())
    await waitFor(() => expect(coverBox().getAttribute('data-state')).toBe('unavailable'))
    expect(coverBox().querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: 'Annas Einweihung' })).toBeTruthy()
  })

  it('uses the bytes already cached for this version by the occasion screen: no second download', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['occasionPhoto', ID, META.updated_at], photo())
    renderCard(row({ photo: META }), queryClient)
    await waitFor(() => coverBox())
    await flushPaint()
    await lazyHalfWatching()
    act(() => FakeObserver.intersect())
    await waitFor(() => expect(coverBox().querySelector('img')).not.toBeNull())
    expect(api.getOccasionPhoto).not.toHaveBeenCalled()
  })
})

describe('coverMetaOf', () => {
  it('takes the occasion screen\'s cover when it is newer than the feed (the host just changed it), else the feed\'s', () => {
    const queryClient = new QueryClient()
    const feed: FeedScreen = { upcoming: [row({ photo: null })], past: [] }
    queryClient.setQueryData(qk.feed(), feed)
    expect(coverMetaOf(feed.upcoming[0]!, queryClient)).toBeNull()
    const newer = { ...META, updated_at: '2026-10-25T12:00:00.000Z' }
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 1000)
      queryClient.setQueryData<OccasionScreen>(qk.occasion(ID), { occasion: { id: ID, photo: newer } } as unknown as OccasionScreen)
      expect(coverMetaOf(feed.upcoming[0]!, queryClient)).toEqual(newer)
      vi.setSystemTime(Date.now() + 1000)
      const refreshed: FeedScreen = { upcoming: [row({ photo: META })], past: [] }
      queryClient.setQueryData(qk.feed(), refreshed)
      expect(coverMetaOf(refreshed.upcoming[0]!, queryClient)).toEqual(META)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the cover queue', () => {
  it(`never runs more than ${MAX_PARALLEL_COVERS} downloads at once and starts the next in order`, async () => {
    const releases: Array<() => void> = []
    const started: number[] = []
    const tasks = Array.from({ length: 5 }, (_, index) =>
      inCoverQueue(() => new Promise<number>((done) => {
        started.push(index)
        releases[index] = () => done(index)
      })))
    expect(started).toEqual([0, 1])
    expect(coverQueueState()).toEqual({ running: 2, waiting: 3 })
    releases[0]!()
    await tasks[0]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])
    for (const index of [1, 2, 3, 4]) {
      await waitFor(() => expect(releases[index]).toBeTypeOf('function'))
      releases[index]!()
      await tasks[index]
    }
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4])
    expect(coverQueueState()).toEqual({ running: 0, waiting: 0 })
  })

  it('a failing download frees its slot', async () => {
    await expect(inCoverQueue(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(inCoverQueue(() => { throw new Error('sync') })).rejects.toThrow('sync')
    expect(coverQueueState()).toEqual({ running: 0, waiting: 0 })
  })
})

describe('persistence', () => {
  it('only ["feed"] goes to disk: the feed carries the meta, the cover bytes stay in memory', async () => {
    const { PERSISTED_ROOTS, shouldPersistQuery } = await import('../../lib/query')
    expect([...PERSISTED_ROOTS]).toEqual(['feed'])
    const fake = (queryKey: readonly unknown[], data: unknown) => ({ queryKey, state: { status: 'success', data } }) as never
    expect(shouldPersistQuery(fake(['occasionPhoto', ID, META.updated_at], photo()))).toBe(false)
    // what the persisted feed snapshot would hold for a card with a cover: the meta, nothing of the picture
    const feed: FeedScreen = { upcoming: [row({ photo: META })], past: [] }
    expect(feed.upcoming[0]!.photo).toEqual(META)
    expect(JSON.stringify(feed)).not.toMatch(/"data"|base64|blob/i)
  })
})
