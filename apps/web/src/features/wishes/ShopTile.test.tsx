import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnerWish } from '../../lib/api/types'

// The shop's real icon on its letter tile (Felix 23.10): the letter at once, the icon — bytes from OUR Worker
// (GET /api/shop-icon, here a stubbed fetch) as an object URL — only once the tile is near the screen, invisible until
// decoded, then faded in over the letter; too small icons and every failure keep the letter. Invented shops.

const account = vi.hoisted(() => ({ session: { user: { id: 'viewer' }, access_token: 'fixture-token' } }))
vi.mock('../../lib/supabase', () => ({
  getSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: account.session }, error: null }) } }),
}))

import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { resetShopIconQueueForTests } from '../../lib/api/shopIcon'
import { CountStack } from '../lists/CountStack'
import { resetInViewForTests } from './inView'
import { ShopTile } from './ShopTile'
import { WishGrid, WishTile } from './WishGrid'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const fetchMock = vi.fn<typeof fetch>()

/** An IntersectionObserver the test drives: `showAll()` reports every observed element as on screen. */
class FakeObserver {
  static all = new Set<FakeObserver>()
  readonly targets = new Set<Element>()
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.add(this)
  }
  observe(el: Element) { this.targets.add(el) }
  unobserve(el: Element) { this.targets.delete(el) }
  disconnect() { this.targets.clear() }
  takeRecords() { return [] }
  static showAll() {
    for (const io of FakeObserver.all) {
      const entries = [...io.targets].map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry)
      io.callback(entries, io as unknown as IntersectionObserver)
    }
  }
}

let originalIO: typeof IntersectionObserver
let originalCreate: typeof URL.createObjectURL
let originalRevoke: typeof URL.revokeObjectURL
let urlCounter = 0 // never reset: every Blob gets a URL no earlier test has decoded

function iconRequests(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/api/shop-icon'))
}

function wrap(node: ReactNode, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>{node}</LazyMotion>
    </QueryClientProvider>
  )
}

function renderWith(node: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(wrap(node, client))
  return { ...view, rerenderWith: (next: ReactNode) => view.rerender(wrap(next, client)) }
}

/** The <img> finished decoding with this natural width. */
function decoded(img: HTMLImageElement, naturalWidth: number) {
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true })
  fireEvent.load(img)
}

async function showAll() {
  await act(async () => { FakeObserver.showAll() })
}

beforeEach(() => {
  setRenderedAccount('viewer')
  originalIO = globalThis.IntersectionObserver
  originalCreate = URL.createObjectURL
  originalRevoke = URL.revokeObjectURL
  FakeObserver.all.clear()
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/icon-${++urlCounter}`)
  URL.revokeObjectURL = vi.fn()
  resetInViewForTests()
  resetShopIconQueueForTests()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const host = new URL(String(input)).searchParams.get('host')
    return host === 'leer.example'
      ? Response.json({ error: 'not_found' }, { status: 404 })
      : new Response(PNG.slice().buffer, { headers: { 'Content-Type': 'image/png' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  globalThis.IntersectionObserver = originalIO
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
})

describe('ShopTile with the shop’s real icon', () => {
  it('the letter at once; the icon is asked for only near the screen, then fades in over the letter once decoded', async () => {
    const { container } = renderWith(<ShopTile site="Küchenkontor" host="www.kuechenkontor.example" size="md" />)
    const tile = container.querySelector<HTMLElement>('[data-shop-tile]') as HTMLElement
    expect(tile.textContent).toBe('K')
    expect(iconRequests()).toEqual([])
    await showAll()
    const img = await vi.waitFor(() => tile.querySelector<HTMLImageElement>('img') ?? Promise.reject(new Error('no img yet')))
    expect(iconRequests()).toEqual([`${window.location.origin}/api/shop-icon?host=kuechenkontor.example`])
    // the bytes from our Worker, as an object URL — never the shop's address
    expect(img.getAttribute('src')).toMatch(/^blob:/)
    expect(img.getAttribute('src')).not.toContain('kuechenkontor')
    expect(img.getAttribute('alt')).toBe('')
    // not visible before it is decoded (no empty white box over the letter), the letter is still there
    expect(img.hasAttribute('data-loaded')).toBe(false)
    expect(tile.textContent).toBe('K')
    decoded(img, 180)
    expect(img.hasAttribute('data-loaded')).toBe(true)
    expect(img.hasAttribute('data-instant')).toBe(false) // the first time it fades in
  })

  it('without a host (a wish form, the gift offers) nothing is asked and there is no <img>', async () => {
    const { container } = renderWith(<ShopTile site="Lichthaus" size="lg" />)
    await showAll()
    expect(container.querySelector('img, [data-shop-icon]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no icon (404) → no <img>, the letter stays; nothing is thrown', async () => {
    const { container } = renderWith(<ShopTile site="Leerladen" host="leer.example" />)
    await showAll()
    await vi.waitFor(() => expect(iconRequests()).toHaveLength(1))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('L')
  })

  it('a favicon too small for the tile is not shown (16 px: yes on the little badge, no on a 44 px row tile)', async () => {
    const { container } = renderWith(
      <>
        <ShopTile site="Klein" host="klein.example" size="md" className="row" />
        <ShopTile site="Klein" host="klein.example" size="sm" className="badge" />
      </>,
    )
    await showAll()
    const [row, badge] = await vi.waitFor(() => {
      const images = [...container.querySelectorAll<HTMLImageElement>('img')]
      return images.length === 2 ? images : Promise.reject(new Error('waiting'))
    })
    decoded(row as HTMLImageElement, 16)
    decoded(badge as HTMLImageElement, 16)
    expect(row?.hasAttribute('data-loaded')).toBe(false)
    expect(badge?.hasAttribute('data-loaded')).toBe(true)
    // one shop, one request — however many tiles show it
    expect(iconRequests()).toHaveLength(1)
  })

  it('an icon already decoded once appears at once in the next tile of that shop (no second fade, no letter flash)', async () => {
    const view = renderWith(<ShopTile site="Haus & Faden" host="hausundfaden.example" />)
    await showAll()
    const first = await vi.waitFor(() => view.container.querySelector<HTMLImageElement>('img') ?? Promise.reject(new Error('waiting')))
    decoded(first, 128)
    // e.g. the wish sheet opens over the grid: a second tile of the same shop shares the Blob and its object URL
    view.rerenderWith(<><ShopTile site="Haus & Faden" host="hausundfaden.example" /><ShopTile site="Haus & Faden" host="www.hausundfaden.example" size="lg" /></>)
    const second = view.container.querySelectorAll<HTMLImageElement>('img')[1] as HTMLImageElement
    expect(second.getAttribute('src')).toBe(first.getAttribute('src'))
    expect(second.hasAttribute('data-loaded')).toBe(true)
    expect(second.hasAttribute('data-instant')).toBe(true)
    expect(iconRequests()).toHaveLength(1)
  })
})

describe('the big tile without photo and the list card dots', () => {
  const wish = (overrides: Partial<OwnerWish> = {}): OwnerWish => ({
    id: '00000000-0000-4000-8000-0000000000b1', title: 'Leinen-Geschirrtücher', url: 'https://www.hausundfaden.example/tuecher', price_cents: 1800,
    currency: 'EUR', note: null, priority: 2, created_at: '2026-10-01T10:00:00+00:00', shop_name: 'Haus & Faden', photo: null, ...overrides,
  })

  it('no photo: the shop’s icon becomes a chip over the letter — only from 48 px, else the big letter stays', async () => {
    const { container } = renderWith(<WishGrid><WishTile wish={wish()} onPress={() => {}} /></WishGrid>)
    const fallback = container.querySelector<HTMLElement>('.wt-fallback') as HTMLElement
    expect(fallback.querySelector('.wt-letter')?.textContent).toBe('H')
    expect(container.querySelector('.wt-shop')).toBeNull() // the corner badge is for photo tiles only
    await showAll()
    const img = await vi.waitFor(() => fallback.querySelector<HTMLImageElement>('[data-shop-icon] img') ?? Promise.reject(new Error('waiting')))
    expect(iconRequests()).toEqual([`${window.location.origin}/api/shop-icon?host=hausundfaden.example`])
    decoded(img, 32)
    expect(img.hasAttribute('data-loaded')).toBe(false)
  })

  it('no photo: a big enough icon is shown in the middle of the tint', async () => {
    const { container } = renderWith(<WishGrid><WishTile wish={wish({ url: 'https://grillhuette.example/schuerze', shop_name: 'Grillhütte' })} onPress={() => {}} /></WishGrid>)
    await showAll()
    const img = await vi.waitFor(() => container.querySelector<HTMLImageElement>('.wt-fallback [data-shop-icon] img') ?? Promise.reject(new Error('waiting')))
    decoded(img, 128)
    expect(img.hasAttribute('data-loaded')).toBe(true)
    expect(img.getAttribute('src')).toMatch(/^blob:/)
  })

  it('a list card’s round dot shows the shop’s icon inside (bytes from our Worker), the letter until then', async () => {
    const { container } = renderWith(
      <CountStack count={2} seed="list-1" preview={[
        { id: 'w1', photo: null, shop: 'Küchenkontor', host: 'kuechenkontor.example' },
        { id: 'w2', photo: null, shop: null },
      ]} />,
    )
    const dot = container.querySelector<HTMLElement>('[data-wish-dot="w1"] .lc-stack-dot') as HTMLElement
    expect(dot.textContent).toBe('K')
    await showAll()
    const img = await vi.waitFor(() => dot.querySelector<HTMLImageElement>('img') ?? Promise.reject(new Error('waiting')))
    decoded(img, 64)
    expect(img.hasAttribute('data-loaded')).toBe(true)
    expect(img.getAttribute('src')).toMatch(/^blob:/)
    // a wish without a link has no icon layer at all
    expect(container.querySelector('[data-wish-dot="w2"] [data-shop-icon]')).toBeNull()
    expect(iconRequests()).toEqual([`${window.location.origin}/api/shop-icon?host=kuechenkontor.example`])
  })
})
