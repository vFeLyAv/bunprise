import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnerWish } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'

// The square wish tile of lists wave 2 (Felix 22.10: "eher quadratisch, mit dem Foto aus dem Shop, kurzer Titel,
// irgendwo dezent das Shop-Icon"): our photo or a tinted fallback, the shop's letter, title / price / hearts, ONE
// button for the whole tile and the owner's ⋯ as its own button next to it. Invented shops (reserved example hosts).

const api = vi.hoisted(() => ({
  getPhoto: vi.fn<(wishId: string, expectedUserId?: string) => Promise<unknown>>(),
}))

vi.mock('../../lib/api/wishPhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishPhotos')>()),
  getWishPhoto: api.getPhoto,
}))

import { ReceivedBadge, WishGrid, WishTile, WishTileMenuButton } from './WishGrid'
import { resetWishPhotoQueueForTests } from './wishPhotos'

const ME = 'viewer-profile'
const GRINDER = '00000000-0000-4000-8000-0000000000a1'
const SHOP_URL = 'https://www.kuechenkontor.example/kaffeemuehle-kegel'

function wish(overrides: Partial<OwnerWish> = {}): OwnerWish {
  return {
    id: GRINDER, title: 'Kaffeemühle mit Handkurbel', url: SHOP_URL, price_cents: 4990, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', shop_name: 'Küchenkontor', photo: { width: 480, height: 480, updated_at: 'v1' },
    ...overrides,
  }
}

function renderTile(props: Partial<Parameters<typeof WishTile>[0]> & { wish: OwnerWish }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onPress = props.onPress ?? vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        <WishGrid>
          <WishTile {...props} onPress={onPress} />
        </WishGrid>
      </LazyMotion>
    </QueryClientProvider>,
  )
  const tile = view.container.querySelector<HTMLElement>(`[data-wish-id="${props.wish.id}"]`)
  if (!tile) throw new Error('tile not rendered')
  return { ...view, tile, onPress }
}

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

beforeEach(() => {
  setRenderedAccount(ME)
  originalCreate = URL.createObjectURL
  originalRevoke = URL.revokeObjectURL
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/p-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
  originalIO = globalThis.IntersectionObserver
  FakeObserver.all.clear()
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver
  resetWishPhotoQueueForTests()
})
afterEach(() => {
  globalThis.IntersectionObserver = originalIO
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.clearAllMocks()
  resetWishPhotoQueueForTests()
  resetAccountBoundaryForTests()
})

describe('WishTile: the picture', () => {
  it('with a photo: the picture is OUR bytes (an object URL, never the shop’s address) and the shop’s letter sits in the corner', async () => {
    api.getPhoto.mockImplementation(async (id) => ({ mime: 'image/webp', blob: new Blob([id], { type: 'image/webp' }), width: 480, height: 480, updated_at: 'v1' }))
    const { tile } = renderTile({ wish: wish() })
    // not on screen yet: no request, the tinted letter tile is there
    expect(api.getPhoto).not.toHaveBeenCalled()
    act(() => FakeObserver.showAll())
    await waitFor(() => expect(tile.querySelector('.wt-media img')).not.toBeNull())
    expect(api.getPhoto).toHaveBeenCalledWith(GRINDER, ME)
    for (const img of tile.querySelectorAll('img')) {
      expect(img.getAttribute('src')).toMatch(/^blob:/)
      expect(img.getAttribute('src')).not.toContain('kuechenkontor')
      expect(img.getAttribute('alt')).toBe('')
    }
    const badge = tile.querySelector<HTMLElement>('.wt-shop')
    expect(badge?.textContent).toBe('K')
    expect(badge?.getAttribute('aria-hidden')).toBe('true')
  })

  it('without a photo: a soft tint with the shop’s letter (no corner badge, no request)', () => {
    const { tile } = renderTile({ wish: wish({ photo: null }) })
    act(() => FakeObserver.showAll())
    const fallback = tile.querySelector<HTMLElement>('.wt-fallback')
    expect(fallback?.hasAttribute('data-shop-tile')).toBe(true)
    expect(fallback?.querySelector('.wt-letter')?.textContent).toBe('K')
    expect(fallback?.hasAttribute('data-tile')).toBe(true)
    expect(tile.querySelector('.wt-shop')).toBeNull()
    expect(tile.querySelector('img')).toBeNull()
    expect(api.getPhoto).not.toHaveBeenCalled()
  })

  it('without a (safe http) link: the gift on the wish’s own tint, no letter', () => {
    for (const url of [null, 'javascript:alert(1)']) {
      const { tile, unmount } = renderTile({ wish: wish({ url, shop_name: null, photo: null }) })
      const fallback = tile.querySelector<HTMLElement>('.wt-fallback')
      expect(fallback?.hasAttribute('data-shop-tile')).toBe(false)
      expect(fallback?.querySelector('.wt-letter')).toBeNull()
      expect(fallback?.querySelector('svg')).not.toBeNull()
      expect(tile.querySelector('.wt-shop')).toBeNull()
      unmount()
    }
  })
})

describe('WishTile: text and controls', () => {
  it('shows the title, the approximate price and the meter’s heart in the picture’s corner (the word for screen readers)', () => {
    const { tile } = renderTile({ wish: wish({ photo: null }) })
    expect(tile.querySelector('.wt-title')?.textContent).toBe('Kaffeemühle mit Handkurbel')
    expect(tile.querySelector('.wt-price')?.textContent?.replace(/\s/g, ' ')).toBe('≈ 49,90 €')
    // Felix 23.10: one heart from the wish-o-meter on the picture, not three small hearts by the price
    const heart = tile.querySelector<HTMLElement>('.wt-media > .wish-prio-heart.wt-heart')
    expect(heart?.dataset['level']).toBe('2')
    expect(heart?.querySelectorAll('svg.wish-heart')).toHaveLength(1)
    expect(heart?.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(heart?.querySelector('.sr-only')?.textContent).toBe('Gern')
    expect(tile.querySelector('.wt-hearts')).toBeNull()
  })

  it('the heart’s face is the level: calm (Kann), happy (Gern), beaming with its tongue out (Unbedingt)', () => {
    for (const priority of [1, 2, 3] as const) {
      const { tile, unmount } = renderTile({ wish: wish({ photo: null, priority }) })
      const heart = tile.querySelector<HTMLElement>('.wish-prio-heart')
      expect(heart?.dataset['level']).toBe(String(priority))
      expect(heart?.querySelector('[data-part="blush"]') === null).toBe(priority === 1)
      expect(heart?.querySelector('[data-part="tongue"]') !== null).toBe(priority === 3)
      unmount()
    }
  })

  it('a wish without a price shows no price line', () => {
    const { tile } = renderTile({ wish: wish({ price_cents: null, photo: null }) })
    expect(tile.querySelector('.wt-price')).toBeNull()
  })

  it('the whole tile is ONE button that opens the wish; the ⋯ is its own button next to it, never nested', () => {
    const onMenu = vi.fn()
    const { tile, onPress } = renderTile({ wish: wish({ photo: null }), menu: <WishTileMenuButton title="Kaffeemühle mit Handkurbel" onPress={onMenu} /> })
    const buttons = within(tile).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    const open = tile.querySelector<HTMLButtonElement>('button.wt-open') as HTMLButtonElement
    const more = within(tile).getByRole('button', { name: 'Mehr zu „Kaffeemühle mit Handkurbel“' })
    expect(more.getAttribute('aria-haspopup')).toBe('dialog')
    // the picture and the text are inside the tile's button; the ⋯ is not
    expect(open.contains(tile.querySelector('.wt-media'))).toBe(true)
    expect(open.contains(tile.querySelector('.wt-title'))).toBe(true)
    expect(open.contains(more)).toBe(false)
    expect(tile.querySelector('button button')).toBeNull()

    fireEvent.click(open)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onMenu).not.toHaveBeenCalled()
    fireEvent.click(more)
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('without a menu (the guest view) there is exactly one button', () => {
    const { tile } = renderTile({ wish: wish({ photo: null }) })
    expect(within(tile).getAllByRole('button')).toHaveLength(1)
  })

  it('a received wish: muted, with the "Erhalten" mark on its picture', () => {
    const { tile } = renderTile({ wish: wish({ photo: null }), muted: true, badge: <ReceivedBadge /> })
    expect(tile.hasAttribute('data-muted')).toBe(true)
    expect(tile.querySelector('.wt-media .wt-badge')?.textContent).toBe('Erhalten')
  })
})
