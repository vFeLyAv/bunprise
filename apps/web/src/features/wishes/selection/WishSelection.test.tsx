import type { ReactNode, Ref } from 'react'
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListsOverview, OwnerListCard } from '../../../lib/api/lists.types'
import type { OccasionScreenWish, OccasionScreenWishlist, OwnerWish } from '../../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../../lib/accountBoundary'
import { getToasts, toast } from '../../../lib/toast'
import guestWishlist from '../GuestWishlist.tsx?raw'
import selectionChrome from './SelectionChrome.tsx?raw'
import bulkSource from './bulk.ts?raw'
import useWishSelectionSource from './useWishSelection.ts?raw'
import useLongPressSource from './useLongPress.ts?raw'
import typesSource from './types.ts?raw'

// Selection mode on the owner's wish grid (Felix 30.10, request #4: long press → the tiles wobble, circles, a tick
// per choice; Verschieben · Zu anderer Liste hinzufügen · Als erhalten markieren · Löschen). The API is mocked;
// fictional data only.

const api = vi.hoisted(() => ({
  setWishReceived: vi.fn<(wishId: string, received: boolean, expectedUserId?: string) => Promise<{ received_at: string | null }>>(),
  moveWish: vi.fn<(wishId: string, targetListId: string, expectedUserId?: string) => Promise<void>>(),
  deleteWish: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  addWishesToList: vi.fn<(listId: string, wishIds: readonly string[], expectedUserId?: string) => Promise<{ added: number }>>(),
  deleteWishEverywhere: vi.fn<(wishId: string, expectedUserId?: string) => Promise<void>>(),
  getListsOverview: vi.fn<(expectedUserId?: string) => Promise<ListsOverview>>(),
  blocker: { current: null as null | { shouldBlockFn: (args: { action: string }) => boolean; disabled?: boolean } },
}))

vi.mock('../../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/wishes')>()),
  setWishReceived: api.setWishReceived,
  moveWish: api.moveWish,
  deleteWish: api.deleteWish,
}))
vi.mock('../../../lib/api/wishPlaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/wishPlaces')>()),
  addWishesToList: api.addWishesToList,
  deleteWishEverywhere: api.deleteWishEverywhere,
}))
vi.mock('../../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/lists')>()),
  getListsOverview: api.getListsOverview,
  getListScreen: vi.fn(),
  deleteList: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    return <a href={href} className={className}>{children}</a>
  }
  return {
    Link,
    createLink: () => Link,
    useRouter: () => ({ shouldViewTransition: undefined }),
    useBlocker: (opts: { shouldBlockFn: (args: { action: string }) => boolean; disabled?: boolean }) => {
      api.blocker.current = opts
    },
  }
})
vi.mock('../../mascot-ui/carry', () => ({ useCarry: () => () => Promise.resolve() }))
vi.mock('../../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  function Mascot({ ref }: { ref?: Ref<unknown> }) {
    useImperativeHandle(ref, () => ({ play: () => Promise.resolve(), tap: () => undefined }), [])
    return <div data-testid="mascot" />
  }
  return { Mascot, preloadMascot: () => undefined }
})

import { listsKeys } from '../../lists/queries'
import { OwnerWishlist } from '../OwnerWishlist'
import { resetPendingWishDeletes, scheduleWishDeletes } from '../pendingDeletes'
import { WishGrid, WishTile } from '../WishGrid'
import { LONG_PRESS_MS } from './useLongPress'

const ME = '00000000-0000-4000-8000-0000000000aa'
const LIST = '11111111-1111-4111-8111-111111111111'
const BOOKS = '11111111-1111-4111-8111-111111111112'
const PARTY = '11111111-1111-4111-8111-111111111113'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'

function wish(id: string, title: string, overrides: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id, title, url: null, price_cents: null, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', reserved: null, reserved_by_me: null, photo: null, received_at: null, ...overrides,
  }
}

const three = () => [wish(A, 'Kopfhörer', { priority: 3 }), wish(B, 'Buch'), wish(C, 'Tasse', { priority: 1 })]

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
    my_lists: [
      card(LIST, {}),
      card(BOOKS, { title: 'Bücher', wish_count: 3 }),
      card(PARTY, { title: 'Party', kind: 'occasion', occasion: { id: 'occ-1', title: 'Sommerfest', starts_at: '2099-07-01T16:00:00Z', tz: 'Europe/Berlin', all_day: false } }),
    ],
    following: [],
    upcoming: [],
    suggestions: [],
  }
}

function renderOwner(wishlist: OccasionScreenWishlist, occasion = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  queryClient.setQueryData(listsKeys.overview(), overview())
  api.getListsOverview.mockResolvedValue(overview())
  return render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        {occasion ? (
          <OwnerWishlist wishlist={wishlist} occasionId="occ-9" />
        ) : (
          <OwnerWishlist wishlist={wishlist} standalone={{ listId: LIST, hint: null, emptyText: 'Leer.' }} />
        )}
      </LazyMotion>
    </QueryClientProvider>,
  )
}

const vibrate = vi.fn<(pattern: number | number[]) => boolean>()
const tileEl = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-wish-id="${id}"]`)
  if (!el) throw new Error(`tile ${id} missing`)
  return el
}
const openButton = (id: string) => tileEl(id).querySelector<HTMLElement>('.wt-open') as HTMLElement
const openIds = () => [...document.querySelectorAll('[data-wish-id]')].filter((el) => !el.closest('[data-received-section]')).map((el) => el.getAttribute('data-wish-id'))
const toastTexts = () => getToasts().map((item) => item.text)
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

/** Finger down on the tile and resting there; optionally moved first. */
async function longPress(id: string, move: { x: number; y: number } | null = null) {
  const button = openButton(id)
  fireEvent.pointerDown(button, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 100, clientY: 100, button: 0 })
  if (move) fireEvent.pointerMove(button, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 100 + move.x, clientY: 100 + move.y })
  await wait(LONG_PRESS_MS + 60)
  fireEvent.pointerUp(button, { pointerId: 1, isPrimary: true, pointerType: 'touch' })
  fireEvent.click(button)
}

const findBar = () => screen.findByRole('toolbar', { name: 'Aktionen für die ausgewählten Wünsche' }, { timeout: 3000 })
const countText = () => document.querySelector('[data-wish-selection-count]')?.textContent

beforeAll(async () => {
  MotionGlobalConfig.instantAnimations = true
  await import('../../lists/MoveWishSheet')
  await import('./SelectionChrome')
})
afterAll(() => {
  MotionGlobalConfig.instantAnimations = false
})
beforeEach(() => {
  setRenderedAccount(ME)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true })
  vibrate.mockReset()
  api.blocker.current = null
  resetPendingWishDeletes()
  toast.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  document.documentElement.removeAttribute('data-motion')
  resetPendingWishDeletes()
  resetAccountBoundaryForTests()
  toast.clear()
})

describe('selection mode: entering, leaving, toggling', () => {
  it('a long press enters selection mode: that tile selected, all open tiles wobble with a circle, one tick', async () => {
    renderOwner(list(three()))
    await longPress(B)
    await findBar()
    expect(countText()).toBe('1 ausgewählt')
    for (const id of [A, B, C]) {
      expect(tileEl(id).getAttribute('data-select')).toBe('jiggle')
      expect(tileEl(id).querySelector('[data-wish-select]')).not.toBeNull()
    }
    expect(openButton(B).getAttribute('aria-pressed')).toBe('true')
    expect(openButton(A).getAttribute('aria-pressed')).toBe('false')
    // the ⋯ is gone while choosing; the sheet did not open on the release
    expect(screen.queryByRole('button', { name: 'Mehr zu „Buch“' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Buch' })).toBeNull()
    // the tick: haptic('select') = 6 ms (the touch itself: 'tap' = 10 ms)
    expect(vibrate).toHaveBeenCalledWith(6)
  })

  it('movement cancels the long press (a scroll or swipe stays a scroll or swipe)', async () => {
    renderOwner(list(three()))
    await longPress(A, { x: 0, y: 24 })
    // the release then counts as a normal tap: the wish's sheet, no selection mode
    expect(tileEl(A).hasAttribute('data-select')).toBe(false)
    expect(document.querySelector('[data-wish-selection-bar]')).toBeNull()
    expect(vibrate).not.toHaveBeenCalledWith(6)
  })

  it('a scroll anywhere cancels it as well; a short tap opens the sheet as before', async () => {
    renderOwner(list(three()))
    const button = openButton(A)
    fireEvent.pointerDown(button, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 10, clientY: 10, button: 0 })
    fireEvent.scroll(window)
    await wait(LONG_PRESS_MS + 60)
    expect(tileEl(A).hasAttribute('data-select')).toBe(false)
    fireEvent.pointerUp(button, { pointerId: 1 })
    fireEvent.click(button)
    expect(await screen.findByRole('dialog', { name: 'Kopfhörer' })).toBeTruthy()
  })

  it('tap toggles; "Alle" / "Keine"; every change ticks; "Fertig" leaves', async () => {
    renderOwner(list(three()))
    await longPress(A)
    await findBar()
    vibrate.mockClear()
    fireEvent.click(openButton(C))
    expect(countText()).toBe('2 ausgewählt')
    fireEvent.click(openButton(A))
    expect(countText()).toBe('1 ausgewählt')
    expect(openButton(A).getAttribute('aria-pressed')).toBe('false')
    expect(vibrate.mock.calls.filter(([pattern]) => pattern === 6)).toHaveLength(2)
    // tapping in selection mode never opens a sheet
    expect(screen.queryByRole('dialog', { name: 'Tasse' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Alle Wünsche auswählen' }))
    expect(countText()).toBe('3 ausgewählt')
    fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }))
    expect(countText()).toBe('Wünsche auswählen')
    expect((screen.getByRole('button', { name: 'In andere Liste verschieben' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Auswahl beenden' }))
    await waitFor(() => expect(tileEl(A).hasAttribute('data-select')).toBe(false))
    expect(screen.getByRole('button', { name: 'Mehr zu „Kopfhörer“' })).toBeTruthy()
  })

  it('Escape and back leave selection mode (back does not leave the screen)', async () => {
    renderOwner(list(three()))
    await longPress(A)
    await findBar()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(tileEl(A).hasAttribute('data-select')).toBe(false))

    await longPress(B)
    await findBar()
    const blocker = api.blocker.current
    expect(blocker?.disabled).toBe(false)
    let blocked = false
    act(() => {
      blocked = blocker?.shouldBlockFn({ action: 'BACK' }) ?? false
    })
    expect(blocked).toBe(true)
    await waitFor(() => expect(tileEl(B).hasAttribute('data-select')).toBe(false))
    // a push (e.g. "+ Wunsch") is never held back
    expect(api.blocker.current?.shouldBlockFn({ action: 'PUSH' })).toBe(false)
  })

  it('reduced motion: no wobble — a calm outline instead', async () => {
    document.documentElement.setAttribute('data-motion', 'reduce')
    renderOwner(list(three()))
    await longPress(A)
    await findBar()
    for (const id of [A, B, C]) expect(tileEl(id).getAttribute('data-select')).toBe('calm')
    expect(document.querySelector('[data-select="jiggle"]')).toBeNull()
  })

  it('the received wishes stay as they are (no circle, their tap still opens the sheet)', async () => {
    renderOwner(list(three(), [wish(D, 'Schal', { received_at: '2026-10-20T10:00:00Z' })]))
    await longPress(A)
    await findBar()
    fireEvent.click(screen.getByRole('button', { name: /^Erhalten:/ }))
    expect(tileEl(D).hasAttribute('data-select')).toBe(false)
    fireEvent.click(openButton(D))
    expect(await screen.findByRole('dialog', { name: 'Schal' })).toBeTruthy()
  })

  it('the ⋯ offers "Mehrere auswählen" (keyboard / screen reader way in)', async () => {
    renderOwner(list(three()))
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu „Buch“' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Buch' })).getByRole('button', { name: 'Mehrere auswählen' }))
    await findBar()
    expect(countText()).toBe('1 ausgewählt')
    expect(openButton(B).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('selection mode: the four actions call the existing API for every selected wish', () => {
  async function selectAll() {
    await longPress(A)
    await findBar()
    fireEvent.click(screen.getByRole('button', { name: 'Alle Wünsche auswählen' }))
    expect(countText()).toBe('3 ausgewählt')
  }

  it('Verschieben: move_wish per wish into the picked list; the tiles leave at once; one toast', async () => {
    api.moveWish.mockResolvedValue(undefined)
    renderOwner(list(three()))
    await selectAll()
    fireEvent.click(screen.getByRole('button', { name: 'In andere Liste verschieben' }))
    const picker = await screen.findByRole('dialog', { name: 'Wohin verschieben?' }, { timeout: 3000 })
    expect(within(picker).getByText('3 Wünsche verschieben nach …')).toBeTruthy()
    fireEvent.click(within(picker).getByRole('button', { name: /^Bücher/ }))
    await waitFor(() => expect(api.moveWish).toHaveBeenCalledTimes(3))
    for (const id of [A, B, C]) expect(api.moveWish).toHaveBeenCalledWith(id, BOOKS, ME)
    await waitFor(() => expect(openIds()).toEqual([]))
    await waitFor(() => expect(toastTexts()).toEqual(['3 Wünsche nach „Bücher“ verschoben']))
    expect(document.querySelector('[data-wish-selection-bar]')).toBeNull()
  })

  it('Verschieben: a refused wish comes back, the toast says how many worked; a wish in several lists stays', async () => {
    api.moveWish.mockImplementation((id) => (id === B ? Promise.reject(new Error('boom')) : Promise.resolve()))
    const shared = wish(C, 'Tasse', { also_in: [{ id: PARTY, title: 'Party', kind: 'occasion' } as never] })
    renderOwner(list([wish(A, 'Kopfhörer', { priority: 3 }), wish(B, 'Buch'), shared]))
    await selectAll()
    fireEvent.click(screen.getByRole('button', { name: 'In andere Liste verschieben' }))
    const picker = await screen.findByRole('dialog', { name: 'Wohin verschieben?' }, { timeout: 3000 })
    fireEvent.click(within(picker).getByRole('button', { name: /^Bücher/ }))
    await waitFor(() => expect(toastTexts()).toEqual(['1 von 2 geschafft – der Rest hat nicht geklappt.']))
    expect(api.moveWish).toHaveBeenCalledTimes(2)
    expect(api.moveWish).not.toHaveBeenCalledWith(C, BOOKS, ME)
    expect(openIds()).toEqual([B, C])
  })

  it('Als erhalten markieren: set_wish_received(true) per wish; the tiles go into "Erhalten" at once', async () => {
    api.setWishReceived.mockResolvedValue({ received_at: '2026-10-30T10:00:00Z' })
    renderOwner(list(three()))
    await selectAll()
    fireEvent.click(screen.getByRole('button', { name: 'Als erhalten markieren' }))
    await waitFor(() => expect(api.setWishReceived).toHaveBeenCalledTimes(3))
    for (const id of [A, B, C]) expect(api.setWishReceived).toHaveBeenCalledWith(id, true, ME)
    await waitFor(() => expect(openIds()).toEqual([]))
    expect(screen.getByRole('button', { name: 'Erhalten: 3 Wünsche' })).toBeTruthy()
    await waitFor(() => expect(toastTexts()).toEqual(['3 Wünsche als erhalten markiert']))
  })

  it('Zu anderer Liste hinzufügen (shared-wishes flag on): ONE add_wishes_to_list with all of them, only coming events offered', async () => {
    vi.stubEnv('VITE_SHARED_WISHES', '1')
    api.addWishesToList.mockResolvedValue({ added: 3 })
    renderOwner(list(three()))
    await selectAll()
    fireEvent.click(screen.getByRole('button', { name: 'Zu anderer Liste hinzufügen' }))
    const picker = await screen.findByRole('dialog', { name: 'Zu welcher Liste hinzufügen?' }, { timeout: 3000 })
    expect(within(picker).queryByRole('button', { name: /^Bücher/ })).toBeNull()
    fireEvent.click(within(picker).getByRole('button', { name: /^Sommerfest/ }))
    await waitFor(() => expect(api.addWishesToList).toHaveBeenCalledTimes(1))
    expect(api.addWishesToList).toHaveBeenCalledWith(PARTY, [A, B, C], ME)
    // the wishes stay here
    expect(openIds()).toEqual([A, B, C])
    await waitFor(() => expect(toastTexts()).toEqual(['3 Wünsche sind jetzt auch in „Sommerfest“']))
  })

  it('without the flag, and on an occasion’s list, there is no "Hinzufügen"', async () => {
    vi.stubEnv('VITE_SHARED_WISHES', '0')
    vi.stubEnv('VITE_DEMO', '0')
    const first = renderOwner(list(three()))
    await longPress(A)
    await findBar()
    expect(screen.queryByRole('button', { name: 'Zu anderer Liste hinzufügen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'In andere Liste verschieben' })).toBeTruthy()
    first.unmount()

    vi.stubEnv('VITE_SHARED_WISHES', '1')
    renderOwner(list(three()), true)
    await longPress(A)
    await findBar()
    expect(screen.queryByRole('button', { name: 'Zu anderer Liste hinzufügen' })).toBeNull()
  })

  it('Löschen: hidden at once, ONE "Rückgängig" toast; nothing is sent during the pause', async () => {
    api.deleteWish.mockResolvedValue(undefined)
    renderOwner(list(three()))
    await selectAll()
    fireEvent.click(screen.getByRole('button', { name: 'Ausgewählte Wünsche löschen' }))
    await waitFor(() => expect(openIds()).toEqual([]))
    expect(getToasts()).toMatchObject([{ text: '3 Wünsche gelöscht', actionLabel: 'Rückgängig' }])
    expect(api.deleteWish).not.toHaveBeenCalled()
    // "Rückgängig" brings all three back
    act(() => getToasts()[0]?.onAction?.())
    await waitFor(() => expect(openIds()).toEqual([A, B, C]))
    expect(api.deleteWish).not.toHaveBeenCalled()
  })

  it('Löschen with a wish that lives in other lists too: a confirmation first, then gone everywhere', async () => {
    api.deleteWish.mockResolvedValue(undefined)
    api.deleteWishEverywhere.mockResolvedValue(undefined)
    const shared = wish(C, 'Tasse', { also_in: [{ id: PARTY, title: 'Party', kind: 'occasion' } as never] })
    renderOwner(list([wish(A, 'Kopfhörer', { priority: 3 }), wish(B, 'Buch'), shared]))
    await selectAll()
    fireEvent.click(screen.getByRole('button', { name: 'Ausgewählte Wünsche löschen' }))
    const confirm = await screen.findByRole('dialog', { name: 'Ausgewählte Wünsche löschen?' })
    expect(api.deleteWish).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Löschen' }))
    await waitFor(() => expect(api.deleteWishEverywhere).toHaveBeenCalledWith(C, ME))
    expect(api.deleteWish).toHaveBeenCalledWith(A, ME)
    expect(api.deleteWish).toHaveBeenCalledWith(B, ME)
    await waitFor(() => expect(toastTexts()).toEqual(['3 Wünsche gelöscht']))
  })
})

describe('the grouped delete (pendingDeletes.scheduleWishDeletes)', () => {
  it('after the pause every wish is deleted, one after another; a failure is told once', async () => {
    api.deleteWish.mockImplementation((id) => (id === B ? Promise.reject(new Error('nope')) : Promise.resolve()))
    const onError = vi.fn()
    const queryClient = new QueryClient()
    scheduleWishDeletes({ wishIds: [A, B, C], occasionId: null, queryClient, text: { deleted: 'weg', undo: 'Rückgängig' }, onError, delayMs: 0 })
    expect(toastTexts()).toEqual(['weg'])
    await waitFor(() => expect(api.deleteWish).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0]?.[1]).toBe(1)
  })
})

describe('the friends’ view has no selection', () => {
  it('a WishTile without onLongPress: a long press is just a press (no circle, no wobble)', async () => {
    const onPress = vi.fn()
    const guestWish: OwnerWish = { id: A, title: 'Kopfhörer', url: null, price_cents: null, currency: 'EUR', note: null, priority: 2, created_at: '2026-10-01T10:00:00Z', photo: null, received_at: null }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LazyMotion features={domMax} strict>
          <WishGrid>
            <WishTile wish={guestWish} onPress={onPress} />
          </WishGrid>
        </LazyMotion>
      </QueryClientProvider>,
    )
    await longPress(A)
    expect(tileEl(A).hasAttribute('data-select')).toBe(false)
    expect(document.querySelector('[data-wish-select]')).toBeNull()
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('GuestWishlist never passes a long press or selection to its tiles', () => {
    expect(guestWishlist).not.toMatch(/onLongPress|selectable|selection\//)
  })
})

describe('secrecy: the selection modules are owner side', () => {
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  for (const [name, source] of Object.entries({ selectionChrome, bulkSource, useWishSelectionSource, useLongPressSource, typesSource })) {
    it(`${name}: no reservation API, query, strings or fields`, () => {
      const body = strip(source)
      expect(body).not.toMatch(/api\/reservations|lib\/queries|myReservations/)
      expect(body).not.toMatch(/reserv/i)
    })
  }
})
