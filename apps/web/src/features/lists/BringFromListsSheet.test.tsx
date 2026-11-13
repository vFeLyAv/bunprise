import type { ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListScreen, ListsOverview, OwnerListCard } from '../../lib/api/lists.types'
import type { OccasionScreenWish } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { AppError } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { SharedWishesOffError } from '../../lib/api/wishPlaces'

// "Aus meinen Listen holen" (Felix 25.10): from the occasion's own wishlist, pick one of my lists without an
// occasion, then some of its open wishes; each one MOVES (move_wish) into the occasion's list, one by one, online
// only. Fictional data only.

const api = vi.hoisted(() => ({
  getListsOverview: vi.fn<(expectedUserId?: string) => Promise<ListsOverview>>(),
  getListScreen: vi.fn<(listId: string, expectedUserId?: string) => Promise<ListScreen>>(),
  moveWish: vi.fn<(wishId: string, targetListId: string, expectedUserId?: string) => Promise<void>>(),
  addWishesToList: vi.fn<(listId: string, wishIds: readonly string[], expectedUserId?: string) => Promise<{ added: number }>>(),
  getWishPhoto: vi.fn<(wishId: string, expectedUserId?: string) => Promise<unknown>>(),
}))

// the wish's photo: only ever OUR bytes (getWishPhoto → object URL)
vi.mock('../../lib/api/wishPhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishPhotos')>()),
  getWishPhoto: api.getWishPhoto,
}))

vi.mock('../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/lists')>()),
  getListsOverview: api.getListsOverview,
  getListScreen: api.getListScreen,
}))
vi.mock('../../lib/api/wishes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishes')>()),
  moveWish: api.moveWish,
}))
// 20261027200000: shared mode (VITE_SHARED_WISHES / the demo) adds instead of moving
vi.mock('../../lib/api/wishPlaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/wishPlaces')>()),
  addWishesToList: api.addWishesToList,
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ children, className }: { children: ReactNode; className?: string }) => <a className={className}>{children}</a>
  return { Link, createLink: () => Link }
})

import { listsKeys } from './queries'
import BringFromListsSheet from './BringFromListsSheet'
import { resetWishPhotoQueueForTests } from '../wishes/wishPhotos'

/** An IntersectionObserver the test drives (as in WishGrid.test.tsx): nearScreen() reports every watched row as on screen. */
class FakeObserver {
  static all = new Set<FakeObserver>()
  readonly targets = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.add(this)
  }
  observe(el: Element) { this.targets.add(el) }
  unobserve(el: Element) { this.targets.delete(el) }
  disconnect() { this.targets.clear() }
  takeRecords() { return [] }
}
function nearScreen() {
  for (const io of FakeObserver.all) {
    const entries = [...io.targets].map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry)
    io.callback(entries, io as unknown as IntersectionObserver)
  }
}
const originalIO = globalThis.IntersectionObserver

const ME = '00000000-0000-4000-8000-0000000000aa'
const TARGET = '22222222-2222-4222-8222-222222222222' // my wishlist of the Sommerfest
const OCCASION = '99999999-9999-4999-8999-999999999999'
const BOOKS = '11111111-1111-4111-8111-111111111112'
const XMAS = '11111111-1111-4111-8111-111111111113'
const EMPTY = '11111111-1111-4111-8111-111111111114'
const NOVEL = '00000000-0000-4000-8000-0000000000b1'
const ATLAS = '00000000-0000-4000-8000-0000000000b2'
const POEMS = '00000000-0000-4000-8000-0000000000b3'

function card(id: string, patch: Partial<OwnerListCard>): OwnerListCard {
  return {
    id, title: 'Liste', kind: 'standalone', visibility: 'private', cover_tone: 2, cover_icon: 'star', due_on: null,
    wish_count: 2, occasion: null, created_at: '2026-10-19T10:00:00Z', photo: null, ...patch,
  }
}

function overview(myLists: OwnerListCard[]): ListsOverview {
  return {
    me: { id: ME, display_name: 'Mila Sommer', banner: null, live_links: 0 },
    stats: { my_wishes: 0, my_lists: myLists.length, friends_lists: 0, followers: 0, following: 0, requests: 0 },
    my_lists: myLists, following: [], upcoming: [], suggestions: [],
  }
}

const MY_LISTS = [
  card(BOOKS, { title: 'Bücher', visibility: 'followers', wish_count: 3 }),
  card(XMAS, { title: 'Weihnachten', wish_count: 1 }),
  card(EMPTY, { title: 'Leer', wish_count: 0 }),
  // the occasion's own list: never a source
  card(TARGET, {
    title: null, kind: 'occasion', visibility: 'occasion', wish_count: 4,
    occasion: { id: OCCASION, title: 'Sommerfest', starts_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), tz: 'Europe/Berlin', all_day: false },
  }),
]

function wishRow(id: string, title: string, price: number | null, extra: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id, title, url: null, price_cents: price, currency: 'EUR', note: null, priority: 2, created_at: '2026-10-01T10:00:00Z',
    reserved: null, reserved_by_me: null, photo: null, received_at: null, ...extra,
  }
}

function booksScreen(wishes: OccasionScreenWish[]): ListScreen {
  return {
    list: {
      id: BOOKS, title: 'Bücher', kind: 'standalone', visibility: 'followers', cover_tone: 2, cover_icon: 'star', due_on: null,
      created_at: '2026-10-19T10:00:00Z', owner: { id: ME, display_name: 'Mila Sommer' } as ListScreen['list']['owner'], photo: null,
    },
    viewer: { role: 'owner' },
    wishes,
    // received ones are never offered
    received: [wishRow(POEMS, 'Gedichtband', 1200, { received_at: '2026-10-20T10:00:00Z' })],
  }
}

function renderSheet(myLists: OwnerListCard[] = MY_LISTS) {
  const onClose = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  queryClient.setQueryData(listsKeys.overview(), overview(myLists))
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <BringFromListsSheet open onClose={onClose} targetListId={TARGET} occasionId={OCCASION} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { ...view, onClose, queryClient }
}

const sheet = () => screen.findByRole('dialog', { name: 'Aus meinen Listen holen' })

async function openBooks() {
  const view = renderSheet()
  fireEvent.click(within(await sheet()).getByRole('button', { name: /^Bücher/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Bücher' })
  await within(dialog).findByRole('checkbox', { name: /Roman/ })
  return { ...view, dialog }
}

beforeEach(() => {
  setRenderedAccount(ME)
  FakeObserver.all.clear()
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver
  resetWishPhotoQueueForTests()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  api.getListScreen.mockResolvedValue(booksScreen([wishRow(NOVEL, 'Roman', 2200), wishRow(ATLAS, 'Atlas', 3900)]))
})
afterEach(() => {
  vi.restoreAllMocks()
  api.getListsOverview.mockReset()
  api.getListScreen.mockReset()
  api.moveWish.mockReset()
  api.addWishesToList.mockReset()
  api.getWishPhoto.mockReset()
  globalThis.IntersectionObserver = originalIO
  resetWishPhotoQueueForTests()
  vi.unstubAllEnvs()
  resetAccountBoundaryForTests()
})

describe('BringFromListsSheet', () => {
  it('offers my lists without an occasion (never the occasion’s own), with who sees them; an empty one cannot be opened', async () => {
    renderSheet()
    const dialog = await sheet()
    expect(within(dialog).getByText('Die Wünsche ziehen hierher um – so wird nichts doppelt geschenkt.')).toBeTruthy()
    expect(within(dialog).getByText('3 Wünsche · Follower')).toBeTruthy()
    expect(within(dialog).getByText('1 Wunsch · Nur ich')).toBeTruthy()
    expect(within(dialog).queryByText('Sommerfest')).toBeNull()
    expect((within(dialog).getByRole('button', { name: /^Leer/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('picks wishes of a list (received ones are not offered) and moves them one by one into the occasion’s list', async () => {
    const success = vi.spyOn(toast, 'success')
    api.moveWish.mockResolvedValue(undefined)
    const { dialog, onClose } = await openBooks()
    expect(within(dialog).queryByText('Gedichtband')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Wünsche auswählen' })).toHaveProperty('disabled', true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Roman/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Atlas/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '2 Wünsche hierher holen' }))
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.moveWish.mock.calls).toEqual([[NOVEL, TARGET, ME], [ATLAS, TARGET, ME]])
    expect(success).toHaveBeenCalledWith('2 Wünsche sind jetzt hier')
  })

  it('a wish that could not move is reported, stays chosen, and the sheet stays open', async () => {
    api.moveWish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AppError('consent_required'))
    const { dialog, onClose } = await openBooks()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Roman/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Atlas/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '2 Wünsche hierher holen' }))
    })
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('1 von 2 Wünschen wurde nicht verschoben.')
    expect(alert.textContent).toContain('Bitte bestätige zuerst die Nutzungsbedingungen')
    expect(onClose).not.toHaveBeenCalled()
    expect((within(dialog).getByRole('checkbox', { name: /Atlas/ }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByRole('checkbox', { name: /Roman/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('offline: nothing can be moved, the sheet says why', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { dialog } = await openBooks()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Roman/ }))
    expect(within(dialog).getByText('Holen geht nur mit Netz.')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '1 Wunsch hierher holen' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.moveWish).not.toHaveBeenCalled()
  })

  it('empty states: no list without an occasion · a list without open wishes', async () => {
    const first = renderSheet([MY_LISTS[3]!])
    expect(within(await sheet()).getByText('Du hast noch keine Wunschliste ohne Ereignis. Unter „Listen“ legst du eine an.')).toBeTruthy()
    first.unmount()
    api.getListScreen.mockResolvedValue(booksScreen([]))
    renderSheet()
    fireEvent.click(within(await sheet()).getByRole('button', { name: /^Bücher/ }))
    expect(await screen.findByText('In dieser Liste sind keine offenen Wünsche.')).toBeTruthy()
  })

  it('a wish with a photo shows it OVER its letter tile (our bytes, an object URL); one without keeps the letter (Felix 27.10)', async () => {
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/novel-photo')
    URL.revokeObjectURL = vi.fn()
    try {
      api.getWishPhoto.mockImplementation(async (id) => ({ mime: 'image/webp', blob: new Blob([id], { type: 'image/webp' }), width: 480, height: 480, updated_at: 'v1' }))
      api.getListScreen.mockResolvedValue(booksScreen([
        wishRow(NOVEL, 'Roman', 2200, { photo: { width: 480, height: 480, updated_at: 'v1' } }),
        wishRow(ATLAS, 'Atlas', 3900),
      ]))
      const { dialog } = await openBooks()
      const novelRow = within(dialog).getByRole('checkbox', { name: /Roman/ }).closest('label')!
      const atlasRow = within(dialog).getByRole('checkbox', { name: /Atlas/ }).closest('label')!
      // jsdom has no layout: the shim IntersectionObserver never reports — the row is "seen" once it is near the screen
      await act(async () => {
        nearScreen()
      })
      const img = await waitFor(() => {
        const found = novelRow.querySelector('[data-wish-thumb] img')
        if (!found) throw new Error('no photo yet')
        return found
      })
      expect(img.getAttribute('src')).toBe('blob:http://localhost/novel-photo')
      // the overlay class (absolute, the tile's box) — without it the photo slid below the letter and was cut off
      expect(img.classList.contains('wish-thumb-img')).toBe(true)
      expect(novelRow.textContent).toContain('R') // the letter stays underneath (no jump while loading)
      expect(api.getWishPhoto).toHaveBeenCalledWith(NOVEL, ME)
      // no photo: the letter tile, no <img>, nothing asked
      expect(atlasRow.querySelector('img')).toBeNull()
      expect(atlasRow.querySelector('[data-wish-thumb]')).toBeNull()
      expect(atlasRow.textContent).toContain('A')
      expect(api.getWishPhoto).not.toHaveBeenCalledWith(ATLAS, expect.anything())
      // title and price stay
      expect(novelRow.textContent).toContain('Roman')
      expect(novelRow.textContent).toMatch(/22,00/)
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('the owner never sees anything about givers, even if the data carried it', async () => {
    api.getListScreen.mockResolvedValue(booksScreen([wishRow(NOVEL, 'Roman', 2200, { reserved: true, reserved_by_me: false })]))
    const { dialog } = await openBooks()
    expect(dialog.textContent ?? '').not.toMatch(/reserv|vergeben|schenkt schon/i)
  })
})

// Pick only (the new-occasion form, features/occasions/extras): the occasion does not exist yet — the chosen wishes
// are handed back, nothing is moved from here; it works offline (nothing is sent), and picked ones are not offered twice.
describe('BringFromListsSheet: picking for a new occasion', () => {
  function renderPicker(exclude: ReadonlySet<string> = new Set()) {
    const onClose = vi.fn()
    const onPick = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    queryClient.setQueryData(listsKeys.overview(), overview(MY_LISTS.filter((list) => list.kind === 'standalone')))
    render(
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domMax} strict>
          <BringFromListsSheet open onClose={onClose} onPick={onPick} exclude={exclude} />
        </LazyMotion>
      </QueryClientProvider>,
    )
    return { onClose, onPick }
  }

  it('hands the chosen wishes back with their list — no move, even offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { onClose, onPick } = renderPicker()
    fireEvent.click(within(await sheet()).getByRole('button', { name: /^Bücher/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Bücher' })
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Atlas/ }))
    expect(within(dialog).queryByText('Holen geht nur mit Netz.')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '1 Wunsch hierher holen' }))
    expect(onPick).toHaveBeenCalledWith({ wishes: [expect.objectContaining({ id: ATLAS, title: 'Atlas' })], listId: BOOKS, listTitle: 'Bücher' })
    expect(onClose).toHaveBeenCalled()
    expect(api.moveWish).not.toHaveBeenCalled()
  })

  it('a wish picked already is not offered again', async () => {
    renderPicker(new Set([NOVEL]))
    fireEvent.click(within(await sheet()).getByRole('button', { name: /^Bücher/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Bücher' })
    await within(dialog).findByRole('checkbox', { name: /Atlas/ })
    expect(within(dialog).queryByRole('checkbox', { name: /Roman/ })).toBeNull()
  })
})

// ONE WISH IN SEVERAL LISTS (20261027200000, VITE_SHARED_WISHES): the chosen wishes are ADDED in one call — they stay in
// their own list too; a wish already here is "Schon drin"; a server that cannot share yet says so and the next tap moves.
describe('BringFromListsSheet — shared wishes', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SHARED_WISHES', '1')
  })

  it('adds the chosen wishes in ONE call; a wish already in the occasion is "Schon drin" and not sent', async () => {
    const success = vi.spyOn(toast, 'success')
    api.addWishesToList.mockResolvedValue({ added: 1 })
    api.getListScreen.mockResolvedValue(booksScreen([
      wishRow(NOVEL, 'Roman', 2200, { also_in: [{ id: TARGET, title: 'Sommerfest', kind: 'occasion', occasion_id: OCCASION, home: false, paused: false }] }),
      wishRow(ATLAS, 'Atlas', 3900, { also_in: [] }),
    ]))
    const { dialog, onClose } = await openBooks()
    expect(within(dialog).getByText('Die Wünsche bleiben auch in ihrer Liste – derselbe Wunsch an beiden Orten, er wird nicht doppelt geschenkt.')).toBeTruthy()
    expect(within(dialog).getByText('Schon drin')).toBeTruthy()
    const novel = within(dialog).getByRole('checkbox', { name: /Roman/ }) as HTMLInputElement
    expect([novel.checked, novel.disabled]).toEqual([true, true])
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Atlas/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '1 Wunsch hinzufügen' }))
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.addWishesToList.mock.calls).toEqual([[TARGET, [ATLAS], ME]])
    expect(api.moveWish).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith('1 Wunsch ist jetzt auch hier')
  })

  it('the database cannot share yet: it says so, nothing moved; the next tap moves like before', async () => {
    const info = vi.spyOn(toast, 'info')
    api.addWishesToList.mockRejectedValue(new SharedWishesOffError())
    api.moveWish.mockResolvedValue(undefined)
    const { dialog, onClose } = await openBooks()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Roman/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '1 Wunsch hinzufügen' }))
    })
    await waitFor(() => expect(info).toHaveBeenCalledWith('Hinzufügen geht gerade noch nicht. Tippst du nochmal, ziehen die Wünsche hierher um.'))
    expect(api.moveWish).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '1 Wunsch hierher holen' }))
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.moveWish.mock.calls).toEqual([[NOVEL, TARGET, ME]])
  })

  it('Q4: wishes from a "Nur ich" list — the sheet warns that the guests will see them', async () => {
    api.getListScreen.mockResolvedValue({ ...booksScreen([wishRow(NOVEL, 'Roman', 2200)]), list: { ...booksScreen([]).list, id: XMAS, title: 'Weihnachten', visibility: 'private' } })
    renderSheet()
    fireEvent.click(within(await sheet()).getByRole('button', { name: /^Weihnachten/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Weihnachten' })
    expect(within(dialog).getByText('„Weihnachten“ siehst nur du – die Wünsche, die du hier hinzufügst, sehen dann auch die Gäste dieses Anlasses.')).toBeTruthy()
  })

  it('another refusal is reported and nothing moves', async () => {
    api.addWishesToList.mockRejectedValue(new AppError('limit_reached'))
    const { dialog, onClose } = await openBooks()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Roman/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '1 Wunsch hinzufügen' }))
    })
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(api.moveWish).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
