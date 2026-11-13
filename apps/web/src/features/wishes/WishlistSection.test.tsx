import type { ReactNode, Ref } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccasionScreen, OccasionScreenWish, OccasionScreenWishlist } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'
import { getToasts, toast } from '../../lib/toast'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'

const api = vi.hoisted(() => ({
  reserve: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  cancel: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  deleteWish: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  mascot: [] as string[],
  /** the carry of the "wish added" moment (mascot-ui/carry.ts): records the request, resolves when the test says */
  carry: vi.fn<(request: { from: unknown; to: Element; item?: string }) => Promise<void>>(),
}))

vi.mock('../../lib/api/reservations', () => ({
  reserveWish: api.reserve,
  cancelReservation: api.cancel,
  getMyReservations: vi.fn(),
}))
vi.mock('../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishes')>()),
  deleteWish: api.deleteWish,
}))
vi.mock('@tanstack/react-router', () => {
  const mocked = {
    Link: ({ to, params, children, className, ...rest }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
      const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
      return <a href={href} className={className} aria-label={(rest as { 'aria-label'?: string })['aria-label']}>{children}</a>
    },
  }
  // PressLink / MotionLink (a router link with the spring press) render the mocked Link here
  return { ...mocked, createLink: () => mocked.Link }
})
// The real wrapper loads the SVG package lazily; here a stub records which scenes are asked for.
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => api.carry }))
vi.mock('../mascot-ui/Mascot', async () => {
  const { useEffect, useId, useImperativeHandle } = await import('react')
  const played = new Set<string>()
  function Mascot({ kind, scene, size, ref, onSceneEnd }: { kind: string; scene?: string; size?: string | number; ref?: Ref<unknown>; onSceneEnd?: (scene: string) => void }) {
    const instance = useId()
    useImperativeHandle(
      ref,
      () => ({
        play: (next: string) => {
          api.mascot.push(`${kind}:play:${next}`)
          return Promise.resolve()
        },
        tap: () => undefined,
      }),
      [kind],
    )
    // like the real wrapper: the scene plays once, after the puppet exists, then reports its end
    useEffect(() => {
      if (!scene || played.has(instance)) return
      played.add(instance)
      api.mascot.push(`${kind}:${scene}`)
      onSceneEnd?.(scene)
    }, [instance, kind, scene, onSceneEnd])
    return <div data-testid="mascot" data-kind={kind} data-scene={scene ?? ''} data-size={size === undefined ? '' : String(size)} />
  }
  return { Mascot, preloadMascot: () => undefined }
})

import { WishlistSection, type WishlistSectionProps } from './WishlistSection'
import { resetPendingWishDeletes } from './pendingDeletes'
import { WISH_ADDED_KEY, markWishAdded, resetWishMomentThrottle } from './wishAdded'
import { resetMotionLevelForTests, setMotionPrefs } from '../../motion/level'

const OCCASION_ID = '0b9f6a58-1d8e-4a51-9f39-3a7cb21f4a10'
const WISHLIST_ID = '5f0c0e7a-8a7b-4b8e-9f60-1c2d3e4f5a6b'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'
/** the account this tab shows (the session watcher reports it in the app) */
const VIEWER_ACCOUNT = 'viewer-profile'

function wish(id: string, overrides: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id,
    title: `Wunsch ${id.slice(-1).toUpperCase()}`,
    url: null,
    price_cents: null,
    currency: 'EUR',
    note: null,
    priority: 2,
    created_at: '2026-10-01T10:00:00.000000+00:00',
    reserved: null,
    reserved_by_me: null,
    ...overrides,
  }
}

function list(wishes: OccasionScreenWish[]): OccasionScreenWishlist {
  return { id: WISHLIST_ID, owner_id: 'host-profile', title: 'Geburtstag', wishes }
}

function screenOf(wishlist: OccasionScreenWishlist, role: 'host' | 'member'): OccasionScreen {
  return {
    occasion: {
      id: OCCASION_ID,
      title: 'Milas Geburtstag',
      starts_at: '2026-11-02T00:00:00+00:00',
      tz: 'Europe/Berlin',
      all_day: true,
      place_text: null,
      description: null,
      created_at: '2026-10-01T09:00:00+00:00',
      host: { id: 'host-profile', display_name: 'Mila' },
    },
    viewer: { role, rsvp: role === 'host' ? 'going' : 'none' },
    members: [],
    invite: null,
    wishlist,
  }
}

function renderSection(props: WishlistSectionProps, seedScreen = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seedScreen) client.setQueryData(qk.occasion(props.occasionId), screenOf(props.wishlist, props.viewer === 'owner' ? 'host' : 'member'))
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        <WishlistSection {...props} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { ...view, client, invalidate }
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)
  if (!el) throw new Error(`row ${id} not rendered`)
  return el
}

function rowIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-wish-id]')).map((el) => el.dataset.wishId ?? '')
}

function openRow(id: string) {
  const button = row(id).querySelector('button')
  if (!button) throw new Error('row button missing')
  fireEvent.click(button)
}

/** useId() values differ between renders; everything else must be byte-identical. */
function normalize(html: string): string {
  return html.replace(/ (id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, ' $1=""')
}

const RESERVATION_TEXT = /reserv|Von dir|Ich schenke|Meine Reservierungen|schenkt schon/i

beforeEach(() => {
  api.reserve.mockReset()
  api.cancel.mockReset()
  api.deleteWish.mockReset()
  api.mascot.length = 0
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.sessionStorage.clear()
  resetWishMomentThrottle()
  api.carry.mockReset()
  api.carry.mockResolvedValue(undefined)
  resetPendingWishDeletes()
  toast.clear()
  setRenderedAccount(VIEWER_ACCOUNT)
})
afterEach(() => {
  vi.restoreAllMocks()
  resetPendingWishDeletes()
  toast.clear()
  resetAccountBoundaryForTests()
})


/**
 * The quiet brand stamp at the very bottom of the wish sheet (Felix 22.10: a screenshot shows it is from
 * Bunprise): the app icon + the name, the last thing in the dialog (under the actions, in the pinned footer),
 * hidden from screen readers.
 */
function expectBrandStamp(dialog: HTMLElement) {
  const stamp = dialog.querySelector<HTMLElement>('[data-brand-stamp]')
  expect(stamp).not.toBeNull()
  expect(stamp!.getAttribute('aria-hidden')).toBe('true')
  expect(stamp!.textContent).toBe('Bunprise')
  expect(stamp!.querySelector('img')?.getAttribute('src')).toBe('/icons/icon.svg')
  expect(stamp!.querySelector('img')?.getAttribute('alt')).toBe('')
  // nothing comes after it in the dialog, and it is outside the scrolling content
  const all = [...dialog.querySelectorAll('*')]
  expect(all.slice(all.indexOf(stamp!) + 1).every((el) => stamp!.contains(el))).toBe(true)
  expect(stamp!.closest('.overflow-y-auto')).toBeNull()
}
describe('WishlistSection — owner view (secrecy)', () => {
  it('teaches a new online giver once; never teaches the owner and never shows it offline', async () => {
    window.localStorage.clear()
    const wishlist = list([wish(A, { reserved: false, reserved_by_me: false })])
    const guest = renderSection({ occasionId: OCCASION_ID, wishlist, viewer: 'guest' })
    expect(await screen.findByText('Tipp auf einen Wunsch, um ihn heimlich zu reservieren')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
    expect(document.querySelector('[data-reserve-hint]')).toBeNull()
    guest.unmount()
    const again = renderSection({ occasionId: OCCASION_ID, wishlist, viewer: 'guest' })
    expect(document.querySelector('[data-reserve-hint]')).toBeNull()
    again.unmount()
    window.localStorage.clear()
    const owner = renderSection({ occasionId: OCCASION_ID, wishlist, viewer: 'owner' })
    expect(document.querySelector('[data-reserve-hint]')).toBeNull()
    owner.unmount()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderSection({ occasionId: OCCASION_ID, wishlist, viewer: 'guest' })
    expect(document.querySelector('[data-reserve-hint]')).toBeNull()
  })
  it('renders byte-identically with and without reservation data and never shows reservation state', () => {
    const plain = [
      wish(A, { priority: 3, price_cents: 2500 }),
      wish(B, { url: 'https://www.amazon.de/dp/123', created_at: '2026-10-02T10:00:00+00:00' }),
      wish(C, { note: 'Größe M', priority: 1 }),
    ]
    // simulate a leak: the owner view must not care what these fields say
    const leaked = plain.map((w, i) => ({ ...w, reserved: true, reserved_by_me: i === 0 }))

    const withFlags = renderSection({ occasionId: OCCASION_ID, wishlist: list(leaked), viewer: 'owner' })
    const htmlWithFlags = normalize(withFlags.container.innerHTML)
    expect(withFlags.container.textContent).not.toMatch(RESERVATION_TEXT)
    openRow(A)
    expect(screen.getByRole('dialog').textContent).not.toMatch(RESERVATION_TEXT)
    const sheetWithFlags = normalize(screen.getByRole('dialog').innerHTML)
    withFlags.unmount()

    const withoutFlags = renderSection({ occasionId: OCCASION_ID, wishlist: list(plain), viewer: 'owner' })
    expect(normalize(withoutFlags.container.innerHTML)).toBe(htmlWithFlags)
    openRow(A)
    expect(normalize(screen.getByRole('dialog').innerHTML)).toBe(sheetWithFlags)
    expect(document.body.textContent).not.toMatch(RESERVATION_TEXT)
    expect(screen.queryByTestId('mascot')).toBeNull()
  })

  it('the tile shows title, approximate price and priority; the shop link (new tab, no referrer) lives in the sheet, with edit and delete', () => {
    renderSection({
      occasionId: OCCASION_ID,
      wishlist: list([wish(A, { title: 'Kopfhörer', price_cents: 1250, url: 'https://www.amazon.de/dp/123', priority: 3 })]),
      viewer: 'owner',
    })
    const kopfhoerer = row(A)
    expect(kopfhoerer.textContent).toContain('Kopfhörer')
    expect(kopfhoerer.textContent?.replace(/\s/g, ' ')).toContain('≈ 12,50 €')
    expect(kopfhoerer.textContent).toContain('Unbedingt')
    // the square tile is one button that opens the sheet (Felix 22.10) — no shop link on the tile itself
    expect(within(kopfhoerer).queryByRole('link')).toBeNull()
    expect(screen.getByText(/Deine Gäste sehen die Liste/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Wunsch hinzufügen' }).getAttribute('href')).toBe(`/occasions/${OCCASION_ID}/wishes/new`)

    openRow(A)
    const dialog = screen.getByRole('dialog')
    // Felix 23.10: the name sits under the photo, next to the price — not as the sheet's title on top
    expect(screen.getByRole('dialog', { name: 'Kopfhörer' })).toBe(dialog)
    const name = within(dialog).getByRole('heading', { level: 2, name: 'Kopfhörer' })
    expect(name.hasAttribute('data-wish-title')).toBe(true)
    const photo = dialog.querySelector('[data-wish-photo]')
    if (photo) expect(photo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const link = within(dialog).getByRole('link', { name: /^Zum Shop: .*amazon\.de.* \(neuer Tab\)$/ })
    expect(link.getAttribute('href')).toBe('https://www.amazon.de/dp/123')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')?.split(' ').sort()).toEqual(['noopener', 'noreferrer'])
    // Felix 23.10: no edit / delete / ⋯ in the sheet — they live in the tile's ⋯
    expect(within(dialog).queryByRole('link', { name: 'Bearbeiten' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Wunsch löschen' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /^Mehr zu/ })).toBeNull()
    expectBrandStamp(dialog)
  })

  it('edit and delete live in the tile’s ⋯ (not in the sheet)', async () => {
    renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(A, { title: 'Kopfhörer' })]), viewer: 'owner' })
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Kopfhörer“' }))
    const menu = await screen.findByRole('dialog')
    expect(within(menu).getByRole('link', { name: 'Bearbeiten' }).getAttribute('href')).toBe(`/wishes/${A}/edit`)
    expect(within(menu).getByRole('button', { name: 'Wunsch löschen' })).toBeTruthy()
  })

  it('empty list: sleeping hamster, text and the add button', () => {
    renderSection({ occasionId: OCCASION_ID, wishlist: list([]), viewer: 'owner' })
    expect(screen.getByTestId('mascot').dataset.scene).toBe('sleep')
    expect(screen.getByText('Füg deinen ersten Wunsch hinzu – dann wissen deine Gäste, was dich freut')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Wunsch hinzufügen' }).getAttribute('href')).toBe(`/occasions/${OCCASION_ID}/wishes/new`)
  })

  it('a just-added wish is carried in once by Pompon: the row waits invisible until the gift lies there (flag consumed, at most every 10 s)', async () => {
    let landed: (() => void) | undefined
    api.carry.mockImplementation(() => new Promise<void>((resolve) => { landed = resolve }))
    markWishAdded(OCCASION_ID, A)
    const first = renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(A, { title: 'Kopfhörer' }), wish(B)]), viewer: 'owner' })
    expect(window.sessionStorage.getItem(WISH_ADDED_KEY)).toBeNull()
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1))
    const request = api.carry.mock.calls[0]?.[0]
    expect(request?.item).toBe('gift')
    expect(request?.to).toBe(row(A).querySelector('[data-wish-tile]')) // the gift lands where the tile pops up
    // the new row keeps its place but waits; the other rows are there; screen readers hear what happened
    expect(row(A).querySelector('[data-concealed]')).not.toBeNull()
    expect(row(B).querySelector('[data-concealed]')).toBeNull()
    expect(screen.getByText('„Kopfhörer“ ist jetzt auf deiner Liste')).toBeTruthy()
    await act(async () => { landed?.() })
    expect(row(A).querySelector('[data-concealed]')).toBeNull()
    expect(screen.queryByTestId('mascot')).toBeNull() // no hamster any more: one mascot, the bunny
    first.unmount()

    // flag consumed: opening the screen again carries nothing
    const again = renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(A)]), viewer: 'owner' })
    expect(row(A).querySelector('[data-concealed]')).toBeNull()
    again.unmount()

    // another wish within 10 s: no second carry, the row is simply there, but the flag is still consumed
    markWishAdded(OCCASION_ID, B)
    renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(A), wish(B)]), viewer: 'owner' })
    expect(row(B).querySelector('[data-concealed]')).toBeNull()
    expect(window.sessionStorage.getItem(WISH_ADDED_KEY)).toBeNull()
    expect(api.carry).toHaveBeenCalledTimes(1)
  })

  it('reduced or no motion: no gift is carried — the new row is simply there (it fades in), the status line still says it', () => {
    for (const level of ['reduced', 'off'] as const) {
      resetWishMomentThrottle()
      setMotionPrefs({ level })
      markWishAdded(OCCASION_ID, A)
      const view = renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(A, { title: 'Kopfhörer' }), wish(B)]), viewer: 'owner' })
      expect(window.sessionStorage.getItem(WISH_ADDED_KEY)).toBeNull()
      expect(row(A).querySelector('[data-concealed]')).toBeNull()
      expect(screen.getByText('„Kopfhörer“ ist jetzt auf deiner Liste')).toBeTruthy()
      view.unmount()
    }
    expect(api.carry).not.toHaveBeenCalled()
    resetMotionLevelForTests()
    window.localStorage.clear()
  })

  it('rows show the shop as a letter tile (never a picture from the shop) and a wish without a link as a gift', () => {
    const { container } = renderSection({
      occasionId: OCCASION_ID,
      wishlist: list([wish(A, { url: 'https://www.shop.example/kopfhoerer', priority: 3 }), wish(B)]),
      viewer: 'owner',
    })
    expect(row(A).querySelector('[data-shop-tile]')?.textContent).toBe('S')
    expect(row(B).querySelector('[data-shop-tile]')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    // how much: hearts (decorative) and the word
    expect(row(A).querySelector('.wish-prio-heart[data-level="3"]')?.textContent).toBe('Unbedingt')
  })

  it('delete hides the wish at once and "Rückgängig" brings it back without a request', async () => {
    renderSection({ occasionId: OCCASION_ID, wishlist: list([wish(A, { title: 'Kopfhörer' }), wish(B)]), viewer: 'owner' })
    // through the tile's ⋯ (the sheet has no delete since 23.10)
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Kopfhörer“' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Wunsch löschen' }))
    await waitFor(() => expect(document.querySelector(`[data-wish-id="${A}"]`)).toBeNull())
    const undoToast = getToasts().find((item) => item.actionLabel === 'Rückgängig')
    expect(undoToast?.text).toBe('„Kopfhörer“ gelöscht')
    expect(undoToast?.duration).toBe(5000)
    act(() => undoToast?.onAction?.())
    await waitFor(() => expect(rowIds()).toEqual([A, B]))
    expect(api.deleteWish).not.toHaveBeenCalled()
  })
})

describe('WishlistSection — guest view', () => {
  const guestWishes = () => [
    wish(A, { reserved: false, reserved_by_me: false }),
    wish(B, { reserved: true, reserved_by_me: false, created_at: '2026-10-02T10:00:00+00:00' }),
    wish(C, { reserved: true, reserved_by_me: true, created_at: '2026-10-03T10:00:00+00:00' }),
  ]

  it('shows "Reserviert" (no name) and "Von dir reserviert", plus the own count', () => {
    const { container } = renderSection({ occasionId: OCCASION_ID, wishlist: list(guestWishes()), viewer: 'guest' })
    expect(screen.getByRole('heading', { name: 'Wünsche von Mila' })).toBeTruthy()
    expect(row(A).textContent).not.toMatch(/Reserviert|Von dir/)
    expect(within(row(B)).getByText('Reserviert')).toBeTruthy()
    expect(within(row(C)).getByText('Von dir reserviert')).toBeTruthy()
    expect(screen.getByText('1 von dir reserviert')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Reserviert von|host-profile/)
  })

  it('no own reservation: no count at all; the first one brings it in as "1 von dir reserviert"', async () => {
    api.reserve.mockResolvedValue(undefined)
    const othersOnly = [wish(A, { reserved: false, reserved_by_me: false }), wish(B, { reserved: true, reserved_by_me: false })]
    renderSection({ occasionId: OCCASION_ID, wishlist: list(othersOnly), viewer: 'guest' })
    expect(within(row(B)).getByText('Reserviert')).toBeTruthy()
    expect(screen.queryByText(/\d+ von dir reserviert/)).toBeNull()

    openRow(A)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    })
    expect(await screen.findByText('1 von dir reserviert')).toBeTruthy()
  })

  it('sorts exactly like the owner view (priority desc, created_at asc)', () => {
    const unsorted = [
      wish(A, { priority: 1, created_at: '2026-10-01T10:00:00+00:00' }),
      wish(B, { priority: 3, created_at: '2026-10-05T10:00:00+00:00' }),
      wish(C, { priority: 3, created_at: '2026-10-02T10:00:00+00:00' }),
      wish(D, { priority: 2, created_at: '2026-10-09T10:00:00+00:00' }),
    ]
    const owner = renderSection({ occasionId: OCCASION_ID, wishlist: list(unsorted), viewer: 'owner' })
    expect(rowIds()).toEqual([C, B, D, A])
    owner.unmount()
    const guestFlags = unsorted.map((w, i) => ({ ...w, reserved: i % 2 === 0, reserved_by_me: false }))
    renderSection({ occasionId: OCCASION_ID, wishlist: list(guestFlags), viewer: 'guest' })
    expect(rowIds()).toEqual([C, B, D, A])
  })

  it('reserves only after the server answered, then the hamster jumps, eats and goes «Psst» and the screen refreshes', async () => {
    let answer: (() => void) | undefined
    api.reserve.mockImplementation(() => new Promise<void>((resolve) => { answer = resolve }))
    const { invalidate } = renderSection({ occasionId: OCCASION_ID, wishlist: list(guestWishes()), viewer: 'guest' })

    openRow(A)
    expect(screen.getByText('Die Person mit dem Wunsch sieht das nicht')).toBeTruthy()
    const give = screen.getByRole('button', { name: 'Ich schenke das' })
    fireEvent.click(give)
    fireEvent.click(give)
    expect(api.reserve).toHaveBeenCalledTimes(1)
    expect(api.reserve).toHaveBeenCalledWith(A, VIEWER_ACCOUNT) // pinned to the account of the screen

    // NOT optimistic: loading button, list and count unchanged until the answer
    expect(give.getAttribute('aria-busy')).toBe('true')
    expect(row(A).textContent).not.toContain('Von dir reserviert')
    expect(screen.getByText('1 von dir reserviert')).toBeTruthy()
    expect(api.mascot).toEqual([])

    await act(async () => { answer?.() })

    expect(within(row(A)).getByText('Von dir reserviert')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('2 von dir reserviert')).toBeTruthy())
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Reservierung aufheben' })).toBeTruthy()
    // the open sheet is the confirmation (no toast on top of its button): hamster + its line
    expect(within(dialog).getByRole('status').textContent).toBe('Versteckt! Mila erfährt nichts.')
    // the reward moment (blocker 15): the hamster at size m is its main figure, his line a headline, and
    // the "Von dir reserviert" chip is not repeated in the sheet meanwhile (it is on the row)
    expect(within(dialog).getByTestId('mascot').dataset.size).toBe('m')
    expect(within(dialog).getByRole('status').className).toContain('t-headline')
    expect(within(dialog).queryByText('Von dir reserviert')).toBeNull()
    expect(getToasts()).toHaveLength(0)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.occasion(OCCASION_ID) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.myReservations() })
    // 27.10 (Felix 26.10 «Psst … оставляем»): one scene — jump → eat → «Psst» (the package's 'secret'), no follow-up
    expect(api.mascot[0]).toBe('hamster:secret')
    expect(api.mascot).not.toContain('hamster:play:eat')
  })

  it('sheet closed while waiting: the toast confirms instead', async () => {
    let answer: (() => void) | undefined
    api.reserve.mockImplementation(() => new Promise<void>((resolve) => { answer = resolve }))
    renderSection({ occasionId: OCCASION_ID, wishlist: list(guestWishes()), viewer: 'guest' })
    openRow(A)
    fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    await act(async () => { answer?.() })
    expect(getToasts().some((item) => item.kind === 'success' && item.text === 'Versteckt! Mila erfährt nichts.')).toBe(true)
    expect(within(row(A)).getByText('Von dir reserviert')).toBeTruthy()
    expect(api.mascot).toEqual([])
  })

  it('already_reserved: conflict toast, the wish shows as taken, refetch — no celebration', async () => {
    api.reserve.mockRejectedValue(new AppError('already_reserved'))
    const { invalidate } = renderSection({ occasionId: OCCASION_ID, wishlist: list(guestWishes()), viewer: 'guest' })
    openRow(A)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ich schenke das' }))
    })
    expect(getToasts().some((item) => item.kind === 'error' && item.text === 'Jemand war schneller – such dir einen anderen Wunsch aus')).toBe(true)
    expect(within(row(A)).getByText('Reserviert')).toBeTruthy()
    expect(screen.getByText('Das schenkt schon jemand anderes.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ich schenke das' })).toBeNull()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.occasion(OCCASION_ID) })
    expect(screen.getByText('1 von dir reserviert')).toBeTruthy()
    expect(api.mascot).toEqual([])
  })

  it('cancels the own reservation after the server confirmed it', async () => {
    api.cancel.mockResolvedValue(undefined)
    renderSection({ occasionId: OCCASION_ID, wishlist: list(guestWishes()), viewer: 'guest' })
    openRow(C)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reservierung aufheben' }))
    })
    expect(api.cancel).toHaveBeenCalledWith(C, VIEWER_ACCOUNT)
    expect(row(C).textContent).not.toContain('Von dir reserviert')
    // the last own reservation is gone: the count leaves with it (no "0 von dir reserviert")
    await waitFor(() => expect(screen.queryByText(/\d+ von dir reserviert/)).toBeNull())
    expect(getToasts().some((item) => item.text === 'Okay, der Wunsch ist wieder frei.')).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.mascot).toEqual([])
  })

  it('reserved by someone else: information only, no button', () => {
    renderSection({ occasionId: OCCASION_ID, wishlist: list(guestWishes()), viewer: 'guest' })
    openRow(B)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Das schenkt schon jemand anderes.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Ich schenke das|Reservierung aufheben/ })).toBeNull()
    expectBrandStamp(dialog)
  })

  it('offline: reservation state hidden and no reserve action', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderSection({ occasionId: OCCASION_ID, wishlist: list(guestWishes()), viewer: 'guest' })
    expect(screen.queryByText('Von dir reserviert')).toBeNull()
    expect(screen.queryByText(/\d+ von dir reserviert/)).toBeNull()
    expect(screen.getAllByText('Reservieren geht nur online').length).toBeGreaterThan(0)
    openRow(A)
    expect(screen.queryByRole('button', { name: 'Ich schenke das' })).toBeNull()
    expect(api.reserve).not.toHaveBeenCalled()
  })

  it('empty guest list: sleeping hamster and the host-specific text', () => {
    renderSection({ occasionId: OCCASION_ID, wishlist: list([]), viewer: 'guest' })
    expect(screen.getByTestId('mascot').dataset.scene).toBe('sleep')
    expect(screen.getByText('Mila hat noch nichts eingetragen. Schau später nochmal rein.')).toBeTruthy()
  })

  it('falls back to neutral texts when the host name is not in memory', () => {
    renderSection({ occasionId: OCCASION_ID, wishlist: list([]), viewer: 'guest' }, false)
    expect(screen.getByRole('heading', { name: 'Wunschliste' })).toBeTruthy()
    expect(screen.getByText('Hier steht noch nichts. Schau später nochmal rein.')).toBeTruthy()
  })
})
