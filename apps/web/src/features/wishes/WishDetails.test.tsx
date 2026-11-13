import type { ReactNode, Ref } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen, OccasionScreenWish, OccasionScreenWishlist } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'

// The wish sheet (owner AND guest) with the details of 2026-10-22, the list rows' photo thumbnails and the
// "Woanders finden" search links. Invented shops (reserved example hosts), invented GTINs (prefix 200–299).

const api = vi.hoisted(() => ({
  getPhoto: vi.fn<(wishId: string, expectedUserId?: string) => Promise<unknown>>(),
  reserve: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('../../lib/api/wishPhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishPhotos')>()),
  getWishPhoto: api.getPhoto,
}))
vi.mock('../../lib/api/reservations', () => ({ reserveWish: api.reserve, cancelReservation: api.cancel, getMyReservations: vi.fn() }))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a>
  return { Link, createLink: () => Link }
})
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => () => Promise.resolve() }))
vi.mock('../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  function Mascot({ ref }: { ref?: Ref<unknown> }) {
    useImperativeHandle(ref, () => ({ play: () => Promise.resolve(), tap: () => undefined }), [])
    return <div data-testid="mascot" />
  }
  return { Mascot, preloadMascot: () => undefined }
})

import { WishlistSection, type WishlistSectionProps } from './WishlistSection'
import { compareLinks, compareQuery } from './compareLinks'
import { MAX_PARALLEL, resetWishPhotoQueueForTests } from './wishPhotos'

const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
const WISHLIST_ID = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'
const GRINDER = '00000000-0000-4000-8000-0000000000a1'
const TOWELS = '00000000-0000-4000-8000-0000000000a2'
const SHOP_URL = 'https://www.kuechenkontor.example/kaffeemuehle-kegel'
const LONG_TEXT =
  'Handmühle mit Kegelmahlwerk aus Keramik, stufenlos einstellbar von fein (Espresso) bis grob (French Press). Gehäuse aus geöltem Buchenholz, Schublade für ca. 30 g Kaffee. Leise und ohne Strom.'

function wish(id: string, overrides: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id, title: 'Kaffeemühle mit Handkurbel', url: SHOP_URL, price_cents: 4990, currency: 'EUR', note: 'Gern aus Holz', priority: 3,
    created_at: '2026-10-01T10:00:00+00:00', reserved: null, reserved_by_me: null,
    description: LONG_TEXT, brand: 'Mahlwerk & Söhne', color: 'Buche natur', gtin: '2001234567893', shop_name: 'Küchenkontor',
    photo: { width: 480, height: 480, updated_at: '2026-10-22T10:00:00+00:00' },
    ...overrides,
  }
}

const list = (wishes: OccasionScreenWish[]): OccasionScreenWishlist => ({ id: WISHLIST_ID, owner_id: 'host-profile', title: null, wishes })

function screenOf(wishlist: OccasionScreenWishlist, role: 'host' | 'member'): OccasionScreen {
  return {
    occasion: {
      id: OCCASION_ID, title: 'Annas Einweihung', starts_at: '2026-11-02T00:00:00+00:00', tz: 'Europe/Berlin', all_day: true,
      place_text: null, description: null, created_at: '2026-10-01T09:00:00+00:00', host: { id: 'host-profile', display_name: 'Anna' },
    },
    viewer: { role, rsvp: 'going' },
    members: [],
    invite: null,
    wishlist,
  }
}

function renderSection(props: WishlistSectionProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(qk.occasion(props.occasionId), screenOf(props.wishlist, props.viewer === 'owner' ? 'host' : 'member'))
  return render(
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        <WishlistSection {...props} />
      </LazyMotion>
    </QueryClientProvider>,
  )
}

function openRow(id: string) {
  const button = document.querySelector(`[data-wish-id="${id}"] button`)
  if (!button) throw new Error(`row ${id} missing`)
  fireEvent.click(button)
}

const photoOf = (id: string) => ({ mime: 'image/webp', blob: new Blob([id], { type: 'image/webp' }), width: 480, height: 480, updated_at: 'v' })

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

const RESERVATION_TEXT = /reserv|Von dir|schenkt schon/i
let originalIO: typeof IntersectionObserver

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  setRenderedAccount('viewer-profile')
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/p-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
  originalIO = globalThis.IntersectionObserver
  FakeObserver.all.clear()
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver
  resetWishPhotoQueueForTests()
  window.localStorage.clear()
})
afterEach(() => {
  globalThis.IntersectionObserver = originalIO
  vi.restoreAllMocks()
  resetAccountBoundaryForTests()
  resetWishPhotoQueueForTests()
})

describe('the wish sheet: details, the shop, "Woanders finden"', () => {
  it('owner: photo, price, text (folded), colour, brand, note, „Zum Shop“ and four search links — no word about reservations', async () => {
    api.getPhoto.mockImplementation(async (id) => photoOf(id))
    // a leak test: whatever the reservation fields say, the owner's sheet never shows it
    renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(GRINDER, { reserved: true, reserved_by_me: false })]), viewer: 'owner' })
    openRow(GRINDER)
    const sheet = screen.getByRole('dialog')
    const s = within(sheet)

    // the big photo comes from OUR database (getWishPhoto → object URL), never from the shop
    await waitFor(() => expect(sheet.querySelector('[data-wish-photo] img')).not.toBeNull())
    expect(api.getPhoto).toHaveBeenCalledWith(GRINDER, 'viewer-profile')
    // every picture in the sheet is ours: the photo (object URL) and the brand stamp's app icon (our own file)
    for (const img of Array.from(sheet.querySelectorAll('img'))) {
      if (img.closest('[data-brand-stamp]')) expect(img.getAttribute('src')).toBe('/icons/icon.svg')
      else expect(img.getAttribute('src')).toMatch(/^blob:/)
    }

    expect(s.getByText('≈ 49,90 €')).toBeTruthy()
    expect(s.getByText('Unbedingt')).toBeTruthy()
    // a long product text starts folded and opens with "Mehr lesen"
    const more = s.getByRole('button', { name: 'Mehr lesen' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(s.getByText(LONG_TEXT).classList.contains('wish-clamp')).toBe(true)
    fireEvent.click(more)
    expect(s.getByRole('button', { name: 'Weniger anzeigen' }).getAttribute('aria-expanded')).toBe('true')
    expect(s.getByText(LONG_TEXT).classList.contains('wish-clamp')).toBe(false)
    // colour + brand as facts, the note
    const facts = sheet.querySelector('[data-wish-facts]') as HTMLElement
    expect(within(facts).getByText('Farbe').nextElementSibling?.textContent).toBe('Buche natur')
    expect(within(facts).getByText('Marke').nextElementSibling?.textContent).toBe('Mahlwerk & Söhne')
    expect(s.getByText('Gern aus Holz')).toBeTruthy()

    // "Aus dem Shop": the shop's name, its domain and a clear „Zum Shop“ (new tab, no referrer, no opener)
    const shop = sheet.querySelector('[data-wish-shop]') as HTMLElement
    expect(within(shop).getByText('Küchenkontor')).toBeTruthy()
    expect(within(shop).getByText('kuechenkontor.example')).toBeTruthy()
    const go = s.getByRole('link', { name: 'Zum Shop: Küchenkontor (neuer Tab)' })
    expect(go.textContent).toContain('Zum Shop')
    expect(go.getAttribute('href')).toBe(SHOP_URL)
    expect(go.getAttribute('target')).toBe('_blank')
    expect(go.getAttribute('rel')).toBe('noopener noreferrer')
    expect(go.getAttribute('referrerpolicy')).toBe('no-referrer')

    // "Woanders finden": four search links by the GTIN, honest line, no prices
    const compare = sheet.querySelector('[data-wish-compare]') as HTMLElement
    expect(within(compare).getByText('Woanders finden')).toBeTruthy()
    expect(within(compare).getByText(/Preise im Shop vergleichen/)).toBeTruthy()
    expect(compare.textContent).not.toMatch(/€/)
    const links = within(compare).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=2001234567893',
      'https://www.google.de/search?tbm=shop&q=2001234567893',
      'https://www.amazon.de/s?k=2001234567893',
      'https://www.ebay.de/sch/i.html?_nkw=2001234567893',
    ])
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Bei idealo suchen (neuer Tab)',
      'Bei Google Shopping suchen (neuer Tab)',
      'Bei Amazon suchen (neuer Tab)',
      'Bei eBay suchen (neuer Tab)',
    ])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
      expect(a.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(a.querySelector('svg')).not.toBeNull() // the external mark
    }

    // Felix 23.10: the shop's product text is the very last part; "how much" = the meter's heart + its word, no hint
    const compareSection = sheet.querySelector('[data-wish-compare]')
    const productText = sheet.querySelector('[data-wish-description]')
    expect(compareSection && productText ? compareSection.compareDocumentPosition(productText) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy()
    expect(productText?.nextElementSibling ?? null).toBeNull()
    expect(sheet.querySelector('[data-priority-line] .wish-prio-heart svg.wish-heart')).not.toBeNull()
    expect(sheet.textContent).not.toContain('Herzenswunsch')
    // Felix 23.10: no edit / delete / ⋯ in the sheet (they live in the tile's ⋯); nothing about reservations anywhere
    expect(s.queryByText('Bearbeiten')).toBeNull()
    expect(s.queryByRole('button', { name: 'Wunsch löschen' })).toBeNull()
    expect(sheet.textContent).not.toMatch(RESERVATION_TEXT)
  })

  it('guest: the same details and links; the reservation actions stay exactly as they were', async () => {
    api.getPhoto.mockImplementation(async (id) => photoOf(id))
    renderSection({
      occasionId: OCCASION_ID,
      wishlist: list([wish(TOWELS, { title: 'Leinen-Geschirrtücher', gtin: null, photo: null, description: 'Kurz.', reserved: false, reserved_by_me: false })]),
      viewer: 'guest',
    })
    openRow(TOWELS)
    const sheet = screen.getByRole('dialog')
    const s = within(sheet)
    expect(s.getByRole('button', { name: 'Ich schenke das' })).toBeTruthy()
    expect(s.getByText('Die Person mit dem Wunsch sieht das nicht')).toBeTruthy()
    // short text: whole, no "Mehr lesen"; no photo → no request at all
    expect(s.getByText('Kurz.')).toBeTruthy()
    expect(s.queryByRole('button', { name: 'Mehr lesen' })).toBeNull()
    expect(sheet.querySelector('[data-wish-photo]')).toBeNull()
    expect(api.getPhoto).not.toHaveBeenCalled()
    // no GTIN: the search goes by the title
    const hrefs = within(sheet.querySelector('[data-wish-compare]') as HTMLElement).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs[0]).toBe('https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=Leinen-Geschirrt%C3%BCcher')
    expect(hrefs[3]).toBe('https://www.ebay.de/sch/i.html?_nkw=Leinen-Geschirrt%C3%BCcher')
    expect(s.getByText(/wir suchen nach dem Namen/)).toBeTruthy()
  })

  it('a photo that cannot be read leaves no hole: the sheet shows the shop tile row instead', async () => {
    api.getPhoto.mockRejectedValue(new AppError('not_found'))
    renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(GRINDER)]), viewer: 'owner' })
    openRow(GRINDER)
    const sheet = screen.getByRole('dialog')
    await waitFor(() => expect(api.getPhoto).toHaveBeenCalled())
    await waitFor(() => expect(sheet.querySelector('[data-wish-photo]')).toBeNull())
    // no picture but the brand stamp's own app icon
    expect(Array.from(sheet.querySelectorAll('img')).filter((img) => !img.closest('[data-brand-stamp]'))).toEqual([])
  })
})

describe('list rows: photo thumbnails', () => {
  it('load only when the row is near the screen, through our database, and fall back to the tile', async () => {
    api.getPhoto.mockImplementation(async (id) => photoOf(id))
    renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(GRINDER), wish(TOWELS, { photo: null })]), viewer: 'owner' })
    // not on screen yet: no request, the letter tile is there
    expect(api.getPhoto).not.toHaveBeenCalled()
    expect(document.querySelector(`[data-wish-id="${GRINDER}"] [data-shop-tile]`)).not.toBeNull()
    act(() => FakeObserver.showAll())
    await waitFor(() => expect(document.querySelector(`[data-wish-id="${GRINDER}"] img`)).not.toBeNull())
    expect(api.getPhoto).toHaveBeenCalledTimes(1) // the wish without a photo asks nothing
    expect(document.querySelector(`[data-wish-id="${GRINDER}"] img`)?.getAttribute('src')).toMatch(/^blob:/)
    expect(document.querySelector(`[data-wish-id="${TOWELS}"] img`)).toBeNull()
  })

  it('at most MAX_PARALLEL photo requests at the same time; a failure keeps the tile', async () => {
    const waiting: Array<() => void> = []
    let inFlight = 0
    let peak = 0
    api.getPhoto.mockImplementation(
      (id) =>
        new Promise((resolve, reject) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          waiting.push(() => {
            inFlight -= 1
            if (id.endsWith('b6')) reject(new AppError('network'))
            else resolve(photoOf(id))
          })
        }),
    )
    const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((n) => `00000000-0000-4000-8000-0000000000${n}`)
    renderSection({ occasionId: OCCASION_ID, wishlist: list(ids.map((id) => wish(id))), viewer: 'owner' })
    act(() => FakeObserver.showAll())
    await waitFor(() => expect(api.getPhoto).toHaveBeenCalledTimes(MAX_PARALLEL))
    while (waiting.length > 0 || api.getPhoto.mock.calls.length < ids.length) {
      await act(async () => {
        waiting.shift()?.()
        await Promise.resolve()
      })
    }
    expect(peak).toBeLessThanOrEqual(MAX_PARALLEL)
    await waitFor(() => expect(document.querySelectorAll('[data-wish-id] img')).toHaveLength(5))
    expect(document.querySelector(`[data-wish-id="${ids[5]}"] [data-shop-tile]`)).not.toBeNull()
  })
})

describe('compareLinks', () => {
  it('GTIN first, else the title (trimmed, cut, encoded); nothing to search → no links', () => {
    expect(compareQuery({ title: 'X', gtin: '4006381333931' })).toBe('4006381333931')
    expect(compareQuery({ title: '  Große   Tasse & Co  ', gtin: '12-34' })).toBe('Große Tasse & Co')
    expect(compareQuery({ title: '   ' })).toBeNull()
    expect(compareLinks({ title: '   ' })).toEqual([])
    const [idealo] = compareLinks({ title: 'Tasse & Co' })
    expect(idealo?.url).toBe('https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=Tasse%20%26%20Co')
    expect([...(compareQuery({ title: 'x'.repeat(300) }) ?? '')]).toHaveLength(100)
  })
})
