import type { ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListScreen, ListsOverview, OwnerListCard as OwnerListCardData } from '../../lib/api/lists.types'
import type { ListPhotoMeta, OccasionScreenWish } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { PhotoLimitError } from '../../lib/api/photos'
import { FeatureUnavailableError } from '../../lib/api/unavailable'
import { AppError } from '../../lib/errors'
import { getToasts, toast } from '../../lib/toast'

// Lists wave 2 (Felix 22.10) in jsdom: "Listen" without occasion lists, the little wish picture of a card
// (CountStack), the cards of "Freunde", the ⋯ of a card (ListMenu: share, edit, visibility, cover photo, delete) and
// the cover hero of a list's screen. The API and the photo pipeline are mocked; fictional data only.

const api = vi.hoisted(() => ({
  getListsOverview: vi.fn<(expectedUserId?: string) => Promise<ListsOverview>>(),
  getListScreen: vi.fn<(listId: string, expectedUserId?: string) => Promise<ListScreen>>(),
  deleteList: vi.fn<(listId: string, expectedUserId?: string) => Promise<void>>(),
  uploadListPhoto: vi.fn<(listId: string, photo: unknown, expectedUserId?: string) => Promise<{ updated_at: string }>>(),
  deleteListPhoto: vi.fn<(listId: string, expectedUserId?: string) => Promise<void>>(),
  getListPhoto: vi.fn<(listId: string, expectedUserId?: string) => Promise<unknown>>(),
  preparePhoto: vi.fn<(file: Blob) => Promise<unknown>>(),
  navigate: vi.fn(),
}))

vi.mock('../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/lists')>()),
  getListsOverview: api.getListsOverview,
  getListScreen: api.getListScreen,
  deleteList: api.deleteList,
  createList: vi.fn(),
  updateList: vi.fn(),
  setListVisibility: vi.fn(),
  setMyBanner: vi.fn(),
  requestFollow: vi.fn(),
  unfollow: vi.fn(),
}))
vi.mock('../../lib/api/listPhotos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/listPhotos')>()),
  uploadListPhoto: api.uploadListPhoto,
  deleteListPhoto: api.deleteListPhoto,
  getListPhoto: api.getListPhoto,
}))
// the menu loads the pipeline lazily; here it hands back a prepared photo (no canvas in jsdom)
vi.mock('../occasions/photo/pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../occasions/photo/pipeline')>()),
  preparePhoto: api.preparePhoto,
}))
// the follower screen's GuestWishlist: never called here
vi.mock('../../lib/api/reservations', () => ({ reserveWish: vi.fn(), cancelReservation: vi.fn(), getMyReservations: vi.fn() }))
vi.mock('@tanstack/react-router', () => {
  // a router link as a plain anchor: keeps the data-* / aria-* attributes the cards carry (no motion props)
  const Link = ({ to, params, children, className, ...rest }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    const attrs = Object.fromEntries(Object.entries(rest).filter(([key]) => key.startsWith('data-') || key.startsWith('aria-')))
    return <a href={href} className={className} {...attrs}>{children}</a>
  }
  return {
    Link,
    createLink: () => Link,
    useNavigate: () => api.navigate,
    useRouter: () => ({ history: { back: vi.fn() } }),
    useCanGoBack: () => false,
  }
})
vi.mock('../mascot-ui/carry', () => ({ useCarry: () => () => Promise.resolve() }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => <div data-testid="bunny" /> }))
vi.mock('../mascot-ui/Mascot', () => ({ Mascot: ({ kind }: { kind: string }) => <div data-testid="mascot" data-kind={kind} />, preloadMascot: () => undefined }))

import { buildListUrl } from '../../lib/api/lists'
import type { PreparedPhoto } from '../occasions/photo/pipeline'
import { PhotoPrepareError } from '../occasions/photo/pipeline'
import { resetWishPhotoQueueForTests } from '../wishes/wishPhotos'
import { CountStack } from './CountStack'
import FollowerListScreen from './FollowerListScreen'
import { FriendsSection } from './FriendsSection'
import { listPhotoKey, resetCoverChangesForTests } from './listCovers'
import { ListsPage } from './ListsPage'
import { MyListsGrid } from './MyListsGrid'
import { OwnerListScreen } from './OwnerListScreen'
import { resetPendingListDeletes } from './pendingListDeletes'
import type { PreviewWish } from './previews'
import { listsKeys } from './queries'

const ME = '00000000-0000-4000-8000-0000000000aa'
const PAULA = '77777777-7777-4777-8777-777777777777'
const LIST = '11111111-1111-4111-8111-111111111111'
const BOOKS = '11111111-1111-4111-8111-111111111112'
const PARTY = '11111111-1111-4111-8111-111111111113'
const PAULA_LIST = '88888888-8888-4888-8888-888888888888'
const W1 = '22222222-2222-4222-8222-222222222221'
const W2 = '22222222-2222-4222-8222-222222222222'
const W3 = '22222222-2222-4222-8222-222222222223'
const COVER: ListPhotoMeta = { width: 960, height: 540, updated_at: '2026-10-22T10:00:00+00:00' }
const UNAVAILABLE = 'Das geht bald – noch nicht freigeschaltet.'
const noop = () => undefined

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
}

function renderWith(ui: ReactNode, queryClient: QueryClient = client()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </QueryClientProvider>
  )
  return { queryClient, ...render(<>{ui}</>, { wrapper }) }
}

function card(id: string = LIST, patch: Partial<OwnerListCardData> = {}): OwnerListCardData {
  return {
    id, title: 'Meine Wünsche', kind: 'standalone', visibility: 'private', cover_tone: 2, cover_icon: 'star', due_on: null,
    wish_count: 4, occasion: null, created_at: '2026-10-19T10:00:00Z', photo: null, ...patch,
  }
}

/** my hosted occasion's list (the server sends it in my_lists; "Listen" never shows it) */
const occasionCard = card(PARTY, {
  title: 'Sommerfest',
  kind: 'occasion',
  visibility: 'occasion',
  wish_count: 7,
  occasion: { id: '99999999-9999-4999-8999-999999999999', title: 'Sommerfest', starts_at: '2026-12-01T16:00:00Z', tz: 'Europe/Berlin', all_day: false },
})

function overview(patch: Partial<ListsOverview> = {}): ListsOverview {
  return {
    me: { id: ME, display_name: 'Mila Sommer', banner: null, live_links: 0 },
    stats: { my_wishes: 11, my_lists: 2, friends_lists: 0, followers: 3, following: 0, requests: 0 },
    my_lists: [card()],
    following: [],
    upcoming: [],
    suggestions: [],
    ...patch,
  }
}

function wish(id: string, patch: Partial<OccasionScreenWish> = {}): OccasionScreenWish {
  return {
    id, title: 'Kopfhörer', url: null, price_cents: 4990, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-19T11:00:00Z', reserved: null, reserved_by_me: null, photo: null, received_at: null, ...patch,
  }
}

function ownerScreen(photo: ListPhotoMeta | null, flags: { reserved: boolean | null; mine: boolean | null } = { reserved: null, mine: null }): ListScreen {
  return {
    list: {
      id: LIST, title: 'Meine Wünsche', kind: 'standalone', visibility: 'followers', cover_tone: 2, cover_icon: 'star', due_on: null,
      created_at: '2026-10-19T10:00:00Z', owner: { id: ME, display_name: 'Mila Sommer', banner: 'meadow' }, photo,
    },
    viewer: { role: 'owner' },
    wishes: [wish(W1, { reserved: flags.reserved, reserved_by_me: flags.mine }), wish(W2, { title: 'Buch', priority: 1, reserved: flags.reserved, reserved_by_me: flags.mine })],
    received: [wish(W3, { title: 'Teekanne', received_at: '2026-10-21T09:00:00Z', reserved: flags.reserved, reserved_by_me: flags.mine })],
  }
}

function followerScreen(photo: ListPhotoMeta | null): ListScreen {
  return {
    list: {
      id: PAULA_LIST, title: 'Weihnachten', kind: 'standalone', visibility: 'followers', cover_tone: 1, cover_icon: 'tree', due_on: null,
      created_at: '2026-10-19T10:00:00Z', owner: { id: PAULA, display_name: 'Paula Brandt', banner: 'meadow' }, photo,
    },
    viewer: { role: 'follower' },
    wishes: [wish(W1, { reserved: false, reserved_by_me: false })],
    received: [],
  }
}

function preparedPhoto(): PreparedPhoto {
  return { mime: 'image/webp', bytes: new Uint8Array([82, 73, 70, 70]), width: 960, height: 540, blob: new Blob(['cover'], { type: 'image/webp' }) }
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

/** What a screen reader reads: the text without the aria-hidden parts. */
function spokenText(el: Element): string {
  const copy = el.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return copy.textContent ?? ''
}

function cardOf(listId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-list-card="${listId}"]`)
  if (!el) throw new Error(`card ${listId} not rendered`)
  return el
}

/** The ⋯ on a card (its own button next to the card's link) → the list's settings sheet. */
async function openCardMenu(title = 'Meine Wünsche'): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: `Einstellungen für „${title}“` }))
  return screen.findByRole('dialog', { name: title })
}

function menuRows(dialog: HTMLElement): string[] {
  const list = dialog.querySelector('[data-list-menu]')
  if (!list) throw new Error('menu list missing')
  return within(list as HTMLElement).getAllByRole('button').map((row) => row.querySelector('.t-headline')?.textContent ?? '')
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input.lc-file')
  if (!input) throw new Error('file input missing')
  return input
}

const toastTexts = () => getToasts().map((item) => item.text)

let originalCreate: typeof URL.createObjectURL
let originalRevoke: typeof URL.revokeObjectURL

beforeEach(() => {
  setRenderedAccount(ME)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  originalCreate = URL.createObjectURL
  originalRevoke = URL.revokeObjectURL
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/cover-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
  toast.clear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  resetPendingListDeletes()
  resetCoverChangesForTests()
  resetWishPhotoQueueForTests()
  resetAccountBoundaryForTests()
  toast.clear()
})

describe('"Listen" shows wishlists only (Felix 22.10: no occasions)', () => {
  it('"Meine" renders no card for my occasion list', () => {
    renderWith(<MyListsGrid lists={[card(), occasionCard]} userId={ME} onCreate={noop} onTemplate={noop} />)
    expect(cardOf(LIST)).toBeTruthy()
    expect(document.querySelector(`[data-list-card="${PARTY}"]`)).toBeNull()
    expect(screen.queryByText('Sommerfest')).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Einstellungen für/ })).toHaveLength(1)
  })

  it('only an occasion list: the empty "Meine" with its templates', () => {
    renderWith(<MyListsGrid lists={[occasionCard]} userId={ME} onCreate={noop} onTemplate={noop} />)
    expect(screen.getByRole('heading', { name: 'Leg deine erste Wunschliste an' })).toBeTruthy()
    expect(document.querySelector('[data-list-card]')).toBeNull()
  })

  it('the tab: no occasion card, and the counter counts the shown lists only (not the server’s 11)', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    api.getListsOverview.mockResolvedValue(overview({ my_lists: [card(), occasionCard] }))
    renderWith(<ListsPage userId={ME} />)
    await screen.findByRole('button', { name: '4 Wünsche – zu deinen Listen' })
    expect(cardOf(LIST)).toBeTruthy()
    expect(document.querySelector(`[data-list-card="${PARTY}"]`)).toBeNull()
    expect(screen.queryByText('Sommerfest')).toBeNull()
  })
})

describe('CountStack: how many wishes, as a little picture', () => {
  it('0 wishes: a dashed empty slot; the number is said as text ("0 Wünsche")', () => {
    const { container } = renderWith(<CountStack count={0} preview={[]} seed={LIST} />)
    const stack = container.querySelector<HTMLElement>('.lc-stack')
    expect(stack?.hasAttribute('data-empty')).toBe(true)
    expect(stack?.querySelector('.lc-stack-empty')?.getAttribute('aria-hidden')).toBe('true')
    expect(stack?.querySelector('.lc-stack-dots')).toBeNull()
    expect(screen.getByText('0 Wünsche').className).toBe('sr-only')
    expect(spokenText(stack as HTMLElement)).toBe('0 Wünsche')
  })

  it('5 wishes, 2 known: three dots (the third a soft placeholder) and "+2"; the picture is hidden, "5 Wünsche" is said', () => {
    const preview: PreviewWish[] = [
      { id: W1, photo: null, shop: 'Zalando' },
      { id: W2, photo: { width: 480, height: 480, updated_at: 'v1' }, shop: null },
    ]
    const { container } = renderWith(<CountStack count={5} preview={preview} seed={LIST} />)
    const stack = container.querySelector<HTMLElement>('.lc-stack') as HTMLElement
    const picture = stack.querySelector<HTMLElement>('.lc-stack-dots') as HTMLElement
    expect(picture.getAttribute('aria-hidden')).toBe('true')
    expect(picture.querySelectorAll('.lc-stack-dot')).toHaveLength(3)
    expect([...picture.querySelectorAll('[data-wish-dot]')].map((dot) => dot.getAttribute('data-wish-dot'))).toEqual([W1, W2])
    expect(picture.querySelectorAll('[data-placeholder]')).toHaveLength(1)
    // a known wish: its shop's letter, or its photo thumbnail (over the gift) when it has one
    expect(picture.querySelector(`[data-wish-dot="${W1}"]`)?.textContent).toBe('Z')
    expect(picture.querySelector(`[data-wish-dot="${W2}"] [data-wish-thumb]`)).not.toBeNull()
    expect(picture.querySelector('.lc-stack-more')?.textContent).toBe('+2')
    expect(stack.dataset['count']).toBe('5')
    expect(spokenText(stack)).toBe('5 Wünsche')
    expect(stack.hasAttribute('data-on-photo')).toBe(false)
  })

  it('preview still unknown (null): soft placeholder dots only — no spinner, at most three, the rest as "+n"', () => {
    const { container, rerender } = renderWith(<CountStack count={1} preview={null} seed={LIST} />)
    const dots = () => container.querySelector('.lc-stack-dots') as HTMLElement
    expect(dots().querySelectorAll('[data-placeholder]')).toHaveLength(1)
    expect(dots().querySelector('[data-wish-dot]')).toBeNull()
    expect(dots().querySelector('.lc-stack-more')).toBeNull()
    expect(screen.getByText('1 Wunsch')).toBeTruthy()
    rerender(<CountStack count={4} preview={null} seed={LIST} />)
    expect(dots().querySelectorAll('[data-placeholder]')).toHaveLength(3)
    expect(dots().querySelector('.lc-stack-more')?.textContent).toBe('+1')
    expect(container.querySelector('[role="progressbar"], [aria-busy="true"]')).toBeNull()
  })

  it('on a cover photo: data-on-photo (white rings, glass bubble) — empty or not', () => {
    const { container, rerender } = renderWith(<CountStack count={0} preview={[]} seed={LIST} onPhoto />)
    expect(container.querySelector('.lc-stack')?.hasAttribute('data-on-photo')).toBe(true)
    rerender(<CountStack count={2} preview={null} seed={LIST} onPhoto />)
    expect(container.querySelector('.lc-stack')?.hasAttribute('data-on-photo')).toBe(true)
  })

  it('a card with a cover photo puts its CountStack on the photo', () => {
    renderWith(<MyListsGrid lists={[card(LIST, { photo: COVER })]} userId={ME} onCreate={noop} onTemplate={noop} />)
    expect(cardOf(LIST).hasAttribute('data-photo')).toBe(true)
    expect(cardOf(LIST).querySelector('.lc-stack')?.hasAttribute('data-on-photo')).toBe(true)
  })
})

describe('"Freunde": the card of a list someone shares with me (FriendListCard)', () => {
  const paula = (photo: ListPhotoMeta | null) => ({
    profile: { id: PAULA, display_name: 'Paula Brandt', banner: null },
    mutual: true,
    accepted_at: '2026-10-01T10:00:00Z',
    lists: [{ id: PAULA_LIST, title: 'Weihnachten', cover_tone: 1 as const, cover_icon: 'tree' as const, due_on: null, wish_count: 5, new_wish_count: 3, photo }],
  })
  const friendCard = () => {
    const el = document.querySelector<HTMLElement>(`a[href="/lists/${PAULA_LIST}"]`)
    if (!el) throw new Error('friend card not rendered')
    return el
  }

  it('with a cover: the photo fills the card and the wish picture sits on it; "3 neu"; no ⋯ (not my list)', () => {
    renderWith(<FriendsSection userId={ME} overview={overview({ following: [paula(COVER)] })} onShare={noop} />)
    expect(friendCard().hasAttribute('data-photo')).toBe(true)
    expect(friendCard().querySelector('.lc-photo')?.getAttribute('aria-hidden')).toBe('true')
    expect(friendCard().querySelector('.lc-stack')?.hasAttribute('data-on-photo')).toBe(true)
    expect(friendCard().querySelector('.lf-new-count')?.textContent).toBe('3 neu')
    expect(spokenText(friendCard().querySelector('.lc-stack') as HTMLElement)).toBe('5 Wünsche')
    expect(screen.queryByRole('button', { name: /^Einstellungen für/ })).toBeNull()
    expect(friendCard().textContent).not.toMatch(/reserv/i)
  })

  it('a cover that cannot be read (removed meanwhile / no access): the card falls back to its tone and symbol', async () => {
    api.getListPhoto.mockRejectedValue(new AppError('not_found'))
    // no IntersectionObserver → the card counts as on screen at once (useInView) and asks for its cover
    vi.stubGlobal('IntersectionObserver', undefined)
    try {
      renderWith(<FriendsSection userId={ME} overview={overview({ following: [paula(COVER)] })} onShare={noop} />)
      await waitFor(() => expect(api.getListPhoto).toHaveBeenCalledWith(PAULA_LIST, ME))
      await waitFor(() => expect(friendCard().hasAttribute('data-photo')).toBe(false))
      expect(friendCard().querySelector('.lc-photo')).toBeNull()
      expect(friendCard().querySelector('.lf-soon-top')).not.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('without a cover: the list’s tone and symbol on top, the wish picture without the photo ring', () => {
    renderWith(<FriendsSection userId={ME} overview={overview({ following: [paula(null)] })} onShare={noop} />)
    expect(friendCard().hasAttribute('data-photo')).toBe(false)
    expect(friendCard().querySelector('.lc-photo')).toBeNull()
    expect(friendCard().querySelector('.lf-soon-top')).not.toBeNull()
    expect(friendCard().querySelector('.lc-stack')?.hasAttribute('data-on-photo')).toBe(false)
  })
})

describe('the ⋯ of a list card (ListMenu)', () => {
  it('is its own button next to the card’s link (never inside it) and opens the list’s settings', async () => {
    renderWith(<MyListsGrid lists={[card()]} userId={ME} onCreate={noop} onTemplate={noop} />)
    const more = screen.getByRole('button', { name: 'Einstellungen für „Meine Wünsche“' })
    expect(more.closest('a')).toBeNull()
    expect(more.getAttribute('aria-haspopup')).toBe('dialog')
    expect(cardOf(LIST).contains(more)).toBe(false)
    expect(await openCardMenu()).toBeTruthy()
  })

  it('without a photo: Teilen · Bearbeiten · Sichtbarkeit · Titelbild wählen · Liste löschen', async () => {
    renderWith(<MyListsGrid lists={[card()]} userId={ME} onCreate={noop} onTemplate={noop} />)
    const dialog = await openCardMenu()
    expect(menuRows(dialog)).toEqual(['Teilen', 'Bearbeiten', 'Sichtbarkeit', 'Titelbild wählen', 'Liste löschen'])
    expect(within(dialog).getByText('Ein Foto statt des Symbols')).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/reserv/i)
  })

  it('with a photo: "Titelbild ändern" and "Titelbild entfernen" instead of "wählen"', async () => {
    renderWith(<MyListsGrid lists={[card(LIST, { photo: COVER })]} userId={ME} onCreate={noop} onTemplate={noop} />)
    const dialog = await openCardMenu()
    expect(menuRows(dialog)).toEqual(['Teilen', 'Bearbeiten', 'Sichtbarkeit', 'Titelbild ändern', 'Titelbild entfernen', 'Liste löschen'])
    expect(within(dialog).queryByText('Ein Foto statt des Symbols')).toBeNull()
    // the card's cover bytes are asked for only once the card is near the screen
    expect(api.getListPhoto).not.toHaveBeenCalled()
  })

  it('"Teilen" of a follower list: the list’s own link to copy, and the follow link for new people', async () => {
    renderWith(<MyListsGrid lists={[card(LIST, { visibility: 'followers' })]} userId={ME} onCreate={noop} onTemplate={noop} />)
    fireEvent.click(within(await openCardMenu()).getByRole('button', { name: 'Teilen' }))
    const share = await screen.findByRole('dialog', { name: '„Meine Wünsche“ teilen' })
    expect((within(share).getByLabelText('Link zur Liste') as HTMLInputElement).value).toBe(buildListUrl(LIST))
    expect(within(share).getByRole('button', { name: 'Link kopieren' })).toBeTruthy()
    expect(within(share).getByRole('button', { name: 'Folgen-Link teilen' })).toBeTruthy()
  })

  it('"Teilen" of a "Nur ich" list: nothing to send yet — it leads to "Mit Followern teilen"', async () => {
    renderWith(<MyListsGrid lists={[card()]} userId={ME} onCreate={noop} onTemplate={noop} />)
    fireEvent.click(within(await openCardMenu()).getByRole('button', { name: 'Teilen' }))
    const share = await screen.findByRole('dialog', { name: '„Meine Wünsche“ teilen' })
    expect(within(share).getByRole('note').textContent).toContain('Nur du siehst diese Liste.')
    expect(within(share).queryByLabelText('Link zur Liste')).toBeNull()
    expect(within(share).getByRole('button', { name: 'Mit Followern teilen' })).toBeTruthy()
  })

  it('"Titelbild wählen": the system picker → preparePhoto → uploadListPhoto; the new picture shows on the card at once', async () => {
    const prepared = preparedPhoto()
    api.preparePhoto.mockResolvedValue(prepared)
    const upload = deferred<{ updated_at: string }>()
    api.uploadListPhoto.mockReturnValue(upload.promise)
    const queryClient = client()
    queryClient.setQueryData(listsKeys.overview(), overview())
    renderWith(<MyListsGrid lists={[card()]} userId={ME} onCreate={noop} onTemplate={noop} />, queryClient)
    const dialog = await openCardMenu()
    const picker = vi.spyOn(fileInput(), 'click').mockImplementation(noop)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Titelbild wählen/ }))
    expect(picker).toHaveBeenCalledTimes(1)

    const file = new File(['raw'], 'party.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await waitFor(() => expect(api.uploadListPhoto).toHaveBeenCalledWith(LIST, prepared, ME))
    expect(api.preparePhoto).toHaveBeenCalledWith(file)
    // optimistic: the prepared picture fills the card (an object URL of OUR Blob) with the busy mark
    await waitFor(() => expect(cardOf(LIST).querySelector('.lc-photo img')?.getAttribute('src')).toMatch(/^blob:/))
    expect(cardOf(LIST).querySelector('.lc-photo-busy')).not.toBeNull()

    await act(async () => {
      upload.resolve({ updated_at: 'v2' })
    })
    await waitFor(() => expect(toastTexts()).toEqual(['Titelbild gespeichert']))
    // the card in the tab's cache knows the new version; its bytes are seeded (nothing is downloaded again)
    expect(queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.my_lists[0]?.photo).toEqual({ width: 960, height: 540, updated_at: 'v2' })
    expect(queryClient.getQueryData<{ blob: Blob }>(listPhotoKey(LIST, 'v2'))?.blob).toBe(prepared.blob)
    expect(api.getListPhoto).not.toHaveBeenCalled()
  })

  it('a picture that cannot be prepared: a calm error toast, nothing is uploaded', async () => {
    api.preparePhoto.mockRejectedValue(new PhotoPrepareError('too_large'))
    renderWith(<MyListsGrid lists={[card()]} userId={ME} onCreate={noop} onTemplate={noop} />)
    const dialog = await openCardMenu()
    vi.spyOn(fileInput(), 'click').mockImplementation(noop)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Titelbild wählen/ }))
    fireEvent.change(fileInput(), { target: { files: [new File(['raw'], 'huge.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(toastTexts()).toEqual(['Das Foto ist zu groß (mehr als 20 MB).']))
    expect(api.uploadListPhoto).not.toHaveBeenCalled()
    await waitFor(() => expect(cardOf(LIST).querySelector('.lc-photo-busy')).toBeNull())
  })

  it('the 31st cover: the limit sentence, the card keeps its symbol', async () => {
    api.preparePhoto.mockResolvedValue(preparedPhoto())
    api.uploadListPhoto.mockRejectedValue(new PhotoLimitError())
    renderWith(<MyListsGrid lists={[card()]} userId={ME} onCreate={noop} onTemplate={noop} />)
    const dialog = await openCardMenu()
    vi.spyOn(fileInput(), 'click').mockImplementation(noop)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Titelbild wählen/ }))
    fireEvent.change(fileInput(), { target: { files: [new File(['raw'], 'party.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(toastTexts()).toEqual(['Du hast schon 30 Listen mit Titelbild – entfern zuerst eins.']))
    expect(cardOf(LIST).querySelector('.lc-photo')).toBeNull()
  })

  it('an upload on a server without the migration: "Das geht bald", the card keeps its symbol, no crash', async () => {
    api.preparePhoto.mockResolvedValue(preparedPhoto())
    api.uploadListPhoto.mockRejectedValue(new FeatureUnavailableError('list_photos'))
    renderWith(<MyListsGrid lists={[card()]} userId={ME} onCreate={noop} onTemplate={noop} />)
    const dialog = await openCardMenu()
    vi.spyOn(fileInput(), 'click').mockImplementation(noop)
    fireEvent.click(within(dialog).getByRole('button', { name: /^Titelbild wählen/ }))
    fireEvent.change(fileInput(), { target: { files: [new File(['raw'], 'party.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(getToasts()).toHaveLength(1))
    expect(getToasts()[0]).toMatchObject({ kind: 'info', text: UNAVAILABLE })
    expect(cardOf(LIST).querySelector('.lc-photo')).toBeNull()
    expect(cardOf(LIST).querySelector('.lc-photo-busy')).toBeNull()
    expect(screen.getByRole('button', { name: 'Einstellungen für „Meine Wünsche“' })).toBeTruthy()
  })

  it('"Titelbild entfernen" calls deleteListPhoto; the card shows its symbol at once', async () => {
    const removal = deferred<undefined>()
    api.deleteListPhoto.mockReturnValue(removal.promise as Promise<void>)
    const queryClient = client()
    queryClient.setQueryData(listsKeys.overview(), overview({ my_lists: [card(LIST, { photo: COVER })] }))
    renderWith(<MyListsGrid lists={[card(LIST, { photo: COVER })]} userId={ME} onCreate={noop} onTemplate={noop} />, queryClient)
    expect(cardOf(LIST).querySelector('.lc-photo')).not.toBeNull()
    const dialog = await openCardMenu()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Titelbild entfernen' }))
    expect(api.deleteListPhoto).toHaveBeenCalledWith(LIST, ME)
    // at once: the photo is gone, the symbol tile is back, the busy mark says it travels
    expect(cardOf(LIST).querySelector('.lc-photo')).toBeNull()
    expect(cardOf(LIST).querySelector('.lc-cover')).not.toBeNull()
    expect(cardOf(LIST).querySelector('.lc-photo-busy')).not.toBeNull()

    await act(async () => {
      removal.resolve(undefined)
    })
    await waitFor(() => expect(toastTexts()).toEqual(['Titelbild entfernt']))
    expect(queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.my_lists[0]?.photo).toBeNull()
  })

  it('a removal on a server without the migration: "Das geht bald", the stored cover comes back, the menu still works', async () => {
    api.deleteListPhoto.mockRejectedValue(new FeatureUnavailableError('list_photos'))
    renderWith(<MyListsGrid lists={[card(LIST, { photo: COVER })]} userId={ME} onCreate={noop} onTemplate={noop} />)
    fireEvent.click(within(await openCardMenu()).getByRole('button', { name: 'Titelbild entfernen' }))
    await waitFor(() => expect(getToasts()).toHaveLength(1))
    expect(getToasts()[0]).toMatchObject({ kind: 'info', text: UNAVAILABLE })
    expect(cardOf(LIST).querySelector('.lc-photo')).not.toBeNull()
    expect(cardOf(LIST).querySelector('.lc-photo-busy')).toBeNull()
    const again = await openCardMenu()
    expect(within(again).getByRole('button', { name: 'Titelbild entfernen' })).toBeTruthy()
  })

  it('"Liste löschen": the confirm sheet first, then the card leaves at once with the 5 s "Rückgängig"', async () => {
    renderWith(<MyListsGrid lists={[card(), card(BOOKS, { title: 'Bücher' })]} userId={ME} onCreate={noop} onTemplate={noop} />)
    fireEvent.click(within(await openCardMenu()).getByRole('button', { name: 'Liste löschen' }))
    const confirm = await screen.findByRole('dialog', { name: 'Liste „Meine Wünsche“ löschen?' })
    expect(within(confirm).getByText('Die Wünsche darin werden mitgelöscht.')).toBeTruthy()
    expect(cardOf(LIST)).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Löschen' }))

    expect(document.querySelector(`[data-list-card="${LIST}"]`)).toBeNull()
    expect(cardOf(BOOKS)).toBeTruthy()
    const undo = getToasts().find((item) => item.actionLabel === 'Rückgängig')
    expect(undo).toMatchObject({ kind: 'info', text: '„Meine Wünsche“ gelöscht', duration: 5000 })
    act(() => undo?.onAction?.())
    expect(cardOf(LIST)).toBeTruthy()
    expect(api.deleteList).not.toHaveBeenCalled()
  })
})

describe('the cover hero of a list screen', () => {
  const photoBytes = () => ({ mime: 'image/webp', blob: new Blob(['cover'], { type: 'image/webp' }), width: 960, height: 540, updated_at: COVER.updated_at })

  it('owner, with a photo: the full-bleed hero with OUR bytes instead of the symbol tile', async () => {
    api.getListPhoto.mockResolvedValue(photoBytes())
    const { container } = renderWith(<OwnerListScreen screen={ownerScreen(COVER)} userId={ME} />)
    const hero = container.querySelector<HTMLElement>('.ls-cover')
    expect(hero?.hasAttribute('data-list-hero')).toBe(true)
    expect(hero?.getAttribute('aria-hidden')).toBe('true')
    await waitFor(() => expect(hero?.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/))
    expect(api.getListPhoto).toHaveBeenCalledWith(LIST, ME)
    expect(container.querySelector('.ls-cover-tile')).toBeNull()
    expect(container.querySelector('.ls-title-block')?.hasAttribute('data-photo')).toBe(true)
  })

  it('owner, without a photo: no hero, the old header with the symbol tile, no photo request', () => {
    const { container } = renderWith(<OwnerListScreen screen={ownerScreen(null)} userId={ME} />)
    expect(container.querySelector('.ls-cover, [data-list-hero]')).toBeNull()
    expect(container.querySelector('.ls-cover-tile')).not.toBeNull()
    expect(container.querySelector('.ls-title-block')?.hasAttribute('data-photo')).toBe(false)
    expect(api.getListPhoto).not.toHaveBeenCalled()
  })

  it('owner, with a photo and received wishes: byte-identical whatever the reservation fields say', () => {
    api.getListPhoto.mockReturnValue(new Promise(noop))
    const html = (flags: { reserved: boolean | null; mine: boolean | null }) => {
      const { container, unmount } = renderWith(<OwnerListScreen screen={ownerScreen(COVER, flags)} userId={ME} />)
      fireEvent.click(screen.getByRole('button', { name: 'Erhalten: 1 Wunsch' }))
      const out = container.innerHTML.replace(/ (id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, ' $1=""')
      unmount()
      return out
    }
    const clean = html({ reserved: null, mine: null })
    expect(html({ reserved: true, mine: false })).toBe(clean)
    expect(html({ reserved: true, mine: true })).toBe(clean)
    expect(clean).toContain('data-list-hero')
    expect(clean).toContain('Teekanne')
    expect(clean).not.toMatch(/reserv/i)
  })

  it('follower, with a photo: the hero and the owner as a small chip (no banner)', async () => {
    api.getListPhoto.mockResolvedValue(photoBytes())
    const { container } = renderWith(<FollowerListScreen screen={followerScreen(COVER)} userId={ME} />)
    const hero = container.querySelector<HTMLElement>('.ls-cover[data-list-hero]')
    expect(hero).not.toBeNull()
    await waitFor(() => expect(hero?.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/))
    expect(api.getListPhoto).toHaveBeenCalledWith(PAULA_LIST, ME)
    expect(container.querySelector('.ls-owner')).toBeNull()
    expect(container.querySelector('.ls-owner-chip')?.textContent).toContain('Paula Brandt')
  })

  it('follower, without a photo: no hero, the owner’s banner with avatar and name', () => {
    const { container } = renderWith(<FollowerListScreen screen={followerScreen(null)} userId={ME} />)
    expect(container.querySelector('.ls-cover, [data-list-hero]')).toBeNull()
    expect(container.querySelector('.ls-owner .ls-owner-name')?.textContent).toBe('Paula Brandt')
    expect(container.querySelector('.ls-owner-chip')).toBeNull()
    expect(api.getListPhoto).not.toHaveBeenCalled()
  })
})
