import type { ReactNode, Ref } from 'react'
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListsOverview, OwnerListCard } from '../../lib/api/lists.types'
import type { OccasionScreenWish, OccasionScreenWishlist, Wish } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { FeatureUnavailableError } from '../../lib/api/unavailable'
import { getToasts, toast } from '../../lib/toast'

// The owner's wish grid of lists wave 2 (Felix 22.10): the ⋯ actions are optimistic — "Erhalten" moves the tile
// into the collapsed "Erhalten" part at once, a move takes it away at once, "how much" changes the hearts at once —
// and come back when the server says no (a server without today's migration: the calm "Das geht bald"). The owner
// view is byte-identical whatever the reservation fields say. The API is mocked; fictional data only.

const api = vi.hoisted(() => ({
  setWishReceived: vi.fn<(wishId: string, received: boolean, expectedUserId?: string) => Promise<{ received_at: string | null }>>(),
  moveWish: vi.fn<(wishId: string, targetListId: string, expectedUserId?: string) => Promise<void>>(),
  updateWish: vi.fn<(wishId: string, patch: Record<string, unknown>, expectedUserId?: string) => Promise<Wish>>(),
  deleteWish: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  getListsOverview: vi.fn<(expectedUserId?: string) => Promise<ListsOverview>>(),
}))

vi.mock('../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishes')>()),
  setWishReceived: api.setWishReceived,
  moveWish: api.moveWish,
  updateWish: api.updateWish,
  deleteWish: api.deleteWish,
}))
vi.mock('../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/lists')>()),
  getListsOverview: api.getListsOverview,
  getListScreen: vi.fn(),
  deleteList: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className, ...rest }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    return <a href={href} className={className} aria-label={(rest as { 'aria-label'?: string })['aria-label']}>{children}</a>
  }
  return { Link, createLink: () => Link }
})
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => () => Promise.resolve() }))
vi.mock('../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  function Mascot({ ref, scene }: { ref?: Ref<unknown>; scene?: string }) {
    useImperativeHandle(ref, () => ({ play: () => Promise.resolve(), tap: () => undefined }), [])
    return <div data-testid="mascot" data-scene={scene ?? ''} />
  }
  return { Mascot, preloadMascot: () => undefined }
})
// the list Pompon (31.10) is its own lazy chunk; here only where he is given a place
vi.mock('./ListPompon', () => ({ default: () => <span data-testid="list-pompon" /> }))

import { useRef } from 'react'
import { listsKeys } from '../lists/queries'
import { OwnerWishlist } from './OwnerWishlist'
import { resetPendingWishDeletes } from './pendingDeletes'

const ME = '00000000-0000-4000-8000-0000000000aa'
const LIST = '11111111-1111-4111-8111-111111111111'
const BOOKS = '11111111-1111-4111-8111-111111111112'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const UNAVAILABLE = 'Das geht bald – noch nicht freigeschaltet.'
const RESERVATION_TEXT = /reserv|Von dir|Ich schenke|schenkt schon/i

function wish(id: string, overrides: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id, title: `Wunsch ${id.slice(-1).toUpperCase()}`, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved: null, reserved_by_me: null, photo: null, received_at: null, ...overrides,
  }
}

const headphones = (overrides: Partial<OccasionScreenWish> = {}) => wish(A, { title: 'Kopfhörer', priority: 3, url: 'https://www.shop.example/kopfhoerer', ...overrides })
const book = (overrides: Partial<OccasionScreenWish> = {}) => wish(B, { title: 'Buch', priority: 2, created_at: '2026-10-02T10:00:00+00:00', ...overrides })

function list(wishes: OccasionScreenWish[], received: OccasionScreenWish[] = []): OccasionScreenWishlist {
  return { id: LIST, owner_id: ME, title: 'Meine Wünsche', wishes, received, photo: null }
}

function card(id: string, patch: Partial<OwnerListCard>): OwnerListCard {
  return {
    id, title: 'Meine Wünsche', kind: 'standalone', visibility: 'followers', cover_tone: 2, cover_icon: 'star', due_on: null,
    wish_count: 2, occasion: null, created_at: '2026-10-19T10:00:00Z', photo: null, ...patch,
  }
}

function overview(): ListsOverview {
  return {
    me: { id: ME, display_name: 'Mila Sommer', banner: null, live_links: 0 },
    stats: { my_wishes: 5, my_lists: 2, friends_lists: 0, followers: 3, following: 0, requests: 0 },
    my_lists: [card(LIST, {}), card(BOOKS, { title: 'Bücher', wish_count: 3 })],
    following: [],
    upcoming: [],
    suggestions: [],
  }
}

function renderOwner(wishlist: OccasionScreenWishlist) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  // the tab's overview is in memory: the move picker reads it
  queryClient.setQueryData(listsKeys.overview(), overview())
  api.getListsOverview.mockResolvedValue(overview())
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <OwnerWishlist
          wishlist={wishlist}
          standalone={{ listId: LIST, hint: 'Deine Follower sehen die Liste und sprechen sich heimlich ab.', emptyText: 'Füg deinen ersten Wunsch hinzu.' }}
        />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ids = (els: Iterable<Element>) => [...els].map((el) => el.getAttribute('data-wish-id') ?? '')
/** the tiles of the open grid, in order (not the received part) */
const openIds = () => ids([...document.querySelectorAll('[data-wish-id]')].filter((el) => !el.closest('[data-received-section]')))
/** the tiles shown in the (expanded) received part */
const receivedIds = () => ids(document.querySelectorAll('[data-received-section] [data-wish-id]'))
const receivedToggle = () => screen.queryByRole('button', { name: /^Erhalten:/ })
/** the move picker is a lazy chunk: it comes in after a suspense (generous timeout for a busy machine) */
const findPicker = () => screen.findByRole('dialog', { name: 'Wohin verschieben?' }, { timeout: 3000 })
const toastTexts = () => getToasts().map((item) => item.text)

function tile(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)
  if (!el) throw new Error(`tile ${id} not rendered`)
  return el
}

/** The ⋯ on a tile → the wish's menu (its title is the sheet's name). */
function openMenuOf(title: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `Mehr zu „${title}“` }))
  return screen.getByRole('dialog', { name: title })
}

/** Ids, ARIA references and React's useId values differ between renders; everything else must be identical. */
function normalize(html: string): string {
  return html.replace(/ (id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, ' $1=""')
}

beforeAll(async () => {
  // a leaving tile is gone at once (no real-time exit animation to wait for), like the app's motion level 'off'
  MotionGlobalConfig.instantAnimations = true
  // warm the lazy picker's module graph once (it still suspends and comes in lazily)
  await import('../lists/MoveWishSheet')
})
afterAll(() => {
  MotionGlobalConfig.instantAnimations = false
})
beforeEach(() => {
  setRenderedAccount(ME)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.sessionStorage.clear()
  resetPendingWishDeletes()
  toast.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  resetPendingWishDeletes()
  resetAccountBoundaryForTests()
  toast.clear()
})

describe('OwnerWishlist: "Erhalten"', () => {
  it('marking received moves the tile at once into the collapsed "Erhalten" part (with its count); open: the tile with its mark', async () => {
    const answer = deferred<{ received_at: string | null }>()
    api.setWishReceived.mockReturnValue(answer.promise)
    renderOwner(list([headphones(), book()]))
    expect(receivedToggle()).toBeNull()

    fireEvent.click(within(openMenuOf('Kopfhörer')).getByRole('button', { name: 'Als erhalten markieren' }))
    expect(api.setWishReceived).toHaveBeenCalledWith(A, true, ME)
    // optimistic: before the server answered
    const toggle = receivedToggle() as HTMLElement
    expect(toggle.getAttribute('aria-label')).toBe('Erhalten: 1 Wunsch')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.querySelector('.wr-count')?.textContent).toBe('1')
    await waitFor(() => expect(openIds()).toEqual([B]))
    expect(receivedIds()).toEqual([]) // collapsed

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(receivedIds()).toEqual([A])
    expect(tile(A).hasAttribute('data-muted')).toBe(true)
    expect(tile(A).querySelector('.wt-badge')?.textContent).toBe('Erhalten')

    await act(async () => {
      answer.resolve({ received_at: '2026-10-23T10:00:00Z' })
    })
    await waitFor(() => expect(toastTexts()).toEqual(['„Kopfhörer“ ist erhalten – schön!']))
    expect(receivedIds()).toEqual([A])
    expect(openIds()).toEqual([B])
  })

  it('"Doch nicht erhalten" brings the tile back into the grid (and the part goes with its last wish)', async () => {
    api.setWishReceived.mockResolvedValue({ received_at: null })
    renderOwner(list([book()], [headphones({ received_at: '2026-10-21T09:00:00Z' })]))
    expect(openIds()).toEqual([B])
    fireEvent.click(receivedToggle() as HTMLElement)
    expect(receivedIds()).toEqual([A])

    fireEvent.click(within(openMenuOf('Kopfhörer')).getByRole('button', { name: 'Doch nicht erhalten' }))
    expect(api.setWishReceived).toHaveBeenCalledWith(A, false, ME)
    expect(openIds()).toEqual([A, B]) // in its place again: "Unbedingt" first
    expect(receivedToggle()).toBeNull()
    await waitFor(() => expect(toastTexts()).toEqual(['„Kopfhörer“ ist wieder offen']))
    expect(tile(A).hasAttribute('data-muted')).toBe(false)
  })

  it('everything received: a calm line instead of "Noch keine Wünsche"', () => {
    renderOwner(list([], [headphones({ received_at: '2026-10-21T09:00:00Z' })]))
    expect(screen.getByText('Alles erhalten – füg einfach neue Wünsche hinzu.')).toBeTruthy()
    expect(screen.queryByText('Noch keine Wünsche')).toBeNull()
    expect(receivedToggle()?.getAttribute('aria-label')).toBe('Erhalten: 1 Wunsch')
  })

  it('a server without the migration: the tile comes back from "Erhalten" and the calm toast says why', async () => {
    const answer = deferred<{ received_at: string | null }>()
    api.setWishReceived.mockReturnValue(answer.promise)
    renderOwner(list([headphones(), book()]))
    fireEvent.click(within(openMenuOf('Kopfhörer')).getByRole('button', { name: 'Als erhalten markieren' }))
    await waitFor(() => expect(openIds()).toEqual([B]))

    await act(async () => {
      answer.reject(new FeatureUnavailableError('wish_received'))
    })
    await waitFor(() => expect(openIds()).toEqual([A, B]))
    expect(receivedToggle()).toBeNull()
    expect(getToasts()).toMatchObject([{ kind: 'info', text: UNAVAILABLE }])
  })
})

describe('OwnerWishlist: "In andere Liste verschieben"', () => {
  it('the tile leaves at once; after the server’s yes: „In „Bücher“ verschoben“', async () => {
    const answer = deferred<undefined>()
    api.moveWish.mockReturnValue(answer.promise as Promise<void>)
    renderOwner(list([headphones(), book()]))
    fireEvent.click(within(openMenuOf('Kopfhörer')).getByRole('button', { name: 'In andere Liste verschieben' }))
    const picker = await findPicker()
    fireEvent.click(within(picker).getByRole('button', { name: /^Bücher/ }))
    expect(api.moveWish).toHaveBeenCalledWith(A, BOOKS, ME)
    await waitFor(() => expect(openIds()).toEqual([B]))
    expect(toastTexts()).toEqual([])

    await act(async () => {
      answer.resolve(undefined)
    })
    await waitFor(() => expect(toastTexts()).toEqual(['In „Bücher“ verschoben']))
    expect(openIds()).toEqual([B])
  })

  it('a server without the migration: the tile comes back and the calm toast says why', async () => {
    const answer = deferred<undefined>()
    api.moveWish.mockReturnValue(answer.promise as Promise<void>)
    renderOwner(list([headphones(), book()]))
    fireEvent.click(within(openMenuOf('Kopfhörer')).getByRole('button', { name: 'In andere Liste verschieben' }))
    fireEvent.click(within(await findPicker()).getByRole('button', { name: /^Bücher/ }))
    await waitFor(() => expect(openIds()).toEqual([B]))

    await act(async () => {
      answer.reject(new FeatureUnavailableError('move_wish'))
    })
    await waitFor(() => expect(openIds()).toEqual([A, B]))
    expect(getToasts()).toMatchObject([{ kind: 'info', text: UNAVAILABLE }])
  })
})

describe('OwnerWishlist: "Wie sehr wünschst du es dir?"', () => {
  async function pickPriority(word: string) {
    fireEvent.click(within(openMenuOf('Kopfhörer')).getByRole('button', { name: /^Wie sehr wünschst du es dir\?/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Wie sehr wünschst du es dir?' })
    // the sheet carries the form's wish-o-meter (Felix 26.10): set the level, then "Fertig"
    const level = { Kann: '1', Gern: '2', Unbedingt: '3' }[word] ?? '2'
    fireEvent.change(within(sheet).getByRole('slider', { name: 'Wie sehr?' }), { target: { value: level } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }))
  }

  const heartsOf = (id: string) => tile(id).querySelector<HTMLElement>('.wish-prio-heart')?.dataset['level']

  it('the hearts change at once (and the order with them); they stay after the server’s yes', async () => {
    const answer = deferred<Wish>()
    api.updateWish.mockReturnValue(answer.promise)
    renderOwner(list([headphones(), book()]))
    expect(openIds()).toEqual([A, B])
    await pickPriority('Kann')
    expect(api.updateWish).toHaveBeenCalledWith(A, { priority: 1 }, ME)
    expect(heartsOf(A)).toBe('1')
    expect(openIds()).toEqual([B, A])

    await act(async () => {
      answer.resolve({ id: A, wishlist_id: LIST, title: 'Kopfhörer', url: 'https://www.shop.example/kopfhoerer', price_cents: null, currency: 'EUR', note: null, priority: 1, created_at: '2026-10-01T10:00:00+00:00' })
    })
    expect(heartsOf(A)).toBe('1')
    expect(openIds()).toEqual([B, A])
    expect(toastTexts()).toEqual([])
  })

  it('a server without the migration: the hearts come back and the calm toast says why', async () => {
    const answer = deferred<Wish>()
    api.updateWish.mockReturnValue(answer.promise)
    renderOwner(list([headphones(), book()]))
    await pickPriority('Kann')
    expect(heartsOf(A)).toBe('1')

    await act(async () => {
      answer.reject(new FeatureUnavailableError('wish_received'))
    })
    await waitFor(() => expect(heartsOf(A)).toBe('3'))
    expect(openIds()).toEqual([A, B])
    expect(getToasts()).toMatchObject([{ kind: 'info', text: UNAVAILABLE }])
  })
})

describe('OwnerWishlist: secrecy of the new tiles and menus', () => {
  it('renders byte-identically with and without leaked reservation fields — grid, received part and ⋯ menu', () => {
    const plain = { open: [headphones({ price_cents: 2500 }), book({ note: 'Größe M' })], received: [wish(C, { title: 'Teekanne', received_at: '2026-10-21T09:00:00Z' })] }
    // simulate a leak: the owner view must not care what these fields say
    const leak = (wishes: OccasionScreenWish[]) => wishes.map((entry, index) => ({ ...entry, reserved: true, reserved_by_me: index === 0 }))

    const capture = (wishlist: OccasionScreenWishlist) => {
      const view = renderOwner(wishlist)
      fireEvent.click(receivedToggle() as HTMLElement)
      const grid = normalize(view.container.innerHTML)
      const menu = openMenuOf('Teekanne')
      const menuHtml = normalize(menu.innerHTML)
      expect(view.container.textContent).not.toMatch(RESERVATION_TEXT)
      expect(menu.textContent).not.toMatch(RESERVATION_TEXT)
      view.unmount()
      return { grid, menu: menuHtml }
    }

    const leaked = capture(list(leak(plain.open), leak(plain.received)))
    const clean = capture(list(plain.open, plain.received))
    expect(leaked.grid).toBe(clean.grid)
    expect(leaked.menu).toBe(clean.menu)
    expect(clean.grid).toContain('Kopfhörer')
    expect(clean.grid).toContain('Teekanne')
    expect(clean.grid).toContain('data-received-section')
  })

  it('the ⋯ of an open wish and its "how much" sheet say nothing about reservations', async () => {
    renderOwner(list([headphones({ reserved: true, reserved_by_me: false }), book()]))
    const menu = openMenuOf('Kopfhörer')
    expect(menu.textContent).not.toMatch(RESERVATION_TEXT)
    fireEvent.click(within(menu).getByRole('button', { name: /^Wie sehr wünschst du es dir\?/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Wie sehr wünschst du es dir?' })
    expect(sheet.textContent).not.toMatch(RESERVATION_TEXT)
  })
})

describe('OwnerWishlist: "Aus meinen Listen holen" (Felix 25.10)', () => {
  function renderOccasion(wishlist: OccasionScreenWishlist) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    queryClient.setQueryData(listsKeys.overview(), overview())
    api.getListsOverview.mockResolvedValue(overview())
    return render(
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domMax} strict>
          <OwnerWishlist wishlist={wishlist} occasionId="99999999-9999-4999-8999-999999999999" />
        </LazyMotion>
      </QueryClientProvider>,
    )
  }

  it('an occasion’s own list offers it and opens the picker of my lists (a lazy chunk)', async () => {
    renderOccasion(list([headphones()]))
    fireEvent.click(screen.getByRole('button', { name: 'Aus meinen Listen holen' }))
    const sheet = await screen.findByRole('dialog', { name: 'Aus meinen Listen holen' }, { timeout: 3000 })
    expect(within(sheet).getByText('Die Wünsche ziehen hierher um – so wird nichts doppelt geschenkt.')).toBeTruthy()
  })

  it('also when the occasion’s list is still empty', () => {
    renderOccasion(list([]))
    expect(screen.getByRole('button', { name: 'Aus meinen Listen holen' })).toBeTruthy()
  })

  it('a list without an occasion does not offer it', () => {
    renderOwner(list([headphones()]))
    expect(screen.queryByRole('button', { name: 'Aus meinen Listen holen' })).toBeNull()
  })
})

describe('OwnerWishlist: «Помпон в открытом списке» (31.10)', () => {
  function OwnScreen({ wishlist }: { wishlist: OccasionScreenWishlist }) {
    const layer = useRef<HTMLDivElement>(null)
    const seat = useRef<HTMLDivElement>(null)
    return (
      <div ref={layer}>
        <div ref={seat} />
        <OwnerWishlist wishlist={wishlist} pompon={{ layer, seatRow: seat }} standalone={{ listId: LIST, hint: null, emptyText: 'Noch leer.' }} />
      </div>
    )
  }
  const renderOwn = (wishlist: OccasionScreenWishlist) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LazyMotion features={domMax} strict>
          <OwnScreen wishlist={wishlist} />
        </LazyMotion>
      </QueryClientProvider>,
    )

  it('the owner’s own list screen: the empty list shows Pompon’s closed gift box instead of the sleeping hamster', async () => {
    renderOwn(list([]))
    expect(document.querySelector('[data-pompon-box]')).not.toBeNull()
    expect(screen.queryByTestId('mascot')).toBeNull()
    expect(await screen.findByTestId('list-pompon')).toBeTruthy()
    // the big "+" is still the link to the new-wish screen
    expect(screen.getByRole('link', { name: /Wunsch hinzufügen/ }).getAttribute('href')).toBe(`/lists/${LIST}/wishes/new`)
  })

  it('with wishes he lives in the header (the list Pompon is there); a short list has no end spot', async () => {
    renderOwn(list([headphones(), book()]))
    expect(await screen.findByTestId('list-pompon')).toBeTruthy()
    expect(document.querySelector('[data-pompon-end]')).toBeNull()
  })

  it('a long list (≥ 6 wishes): an empty, decorative spot under its end where he is found again', async () => {
    const many = ['1', '2', '3', '4', '5', '6'].map((n) => wish(`00000000-0000-4000-8000-00000000010${n}`))
    renderOwn(list(many))
    const end = document.querySelector('[data-pompon-end]')
    expect(end?.getAttribute('aria-hidden')).toBe('true')
    expect(end?.textContent).toBe('')
  })

  it('without a place (an occasion’s list, the guest’s view): the hamster sleeps as before, no list Pompon', () => {
    renderOwner(list([]))
    expect(screen.getByTestId('mascot')).toBeTruthy()
    expect(document.querySelector('[data-pompon-box]')).toBeNull()
    expect(screen.queryByTestId('list-pompon')).toBeNull()
  })

  it('«Kaninchen zeigen» off: no gift box, no Pompon — the empty list keeps its place calmly (the hamster’s box)', () => {
    document.documentElement.setAttribute('data-bunnies', 'off')
    try {
      renderOwn(list([]))
      expect(document.querySelector('[data-pompon-box]')).toBeNull()
      expect(screen.queryByTestId('list-pompon')).toBeNull()
    } finally {
      document.documentElement.removeAttribute('data-bunnies')
    }
  })
})
