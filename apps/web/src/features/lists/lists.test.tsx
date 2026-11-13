import type { ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListScreen, ListsOverview } from '../../lib/api/lists.types'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { getToasts, toast } from '../../lib/toast'

// The lists tab and a list's screens in jsdom (follows-design W01, W05, W06, W09): the flag, "Nur ich" first,
// the confirm step of "Nur für mich", the owner's screen identical whatever the server says about reservations,
// late answers after an account switch do nothing. The API is mocked; fictional data only.

const api = vi.hoisted(() => ({
  getListsOverview: vi.fn<(expectedUserId?: string) => Promise<ListsOverview>>(),
  getListScreen: vi.fn<(listId: string, expectedUserId?: string) => Promise<ListScreen>>(),
  createList: vi.fn<(input: Record<string, unknown>, expectedUserId?: string) => Promise<{ id: string; created_at: string }>>(),
  updateList: vi.fn<(listId: string, patch: Record<string, unknown>, expectedUserId?: string) => Promise<void>>(),
  setListVisibility: vi.fn<(listId: string, visibility: string, expectedUserId?: string) => Promise<void>>(),
  setMyBanner: vi.fn<(banner: string, expectedUserId?: string) => Promise<void>>(),
  navigate: vi.fn(),
}))

vi.mock('../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/lists')>()),
  getListsOverview: api.getListsOverview,
  getListScreen: api.getListScreen,
  createList: api.createList,
  updateList: api.updateList,
  setListVisibility: api.setListVisibility,
  setMyBanner: api.setMyBanner,
  requestFollow: vi.fn(),
  unfollow: vi.fn(),
  deleteList: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className, ...rest }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    const aria = rest as { 'aria-label'?: string; 'aria-hidden'?: 'true'; tabIndex?: number; 'data-list-card'?: string }
    return <a href={href} className={className} aria-label={aria['aria-label']} aria-hidden={aria['aria-hidden']} tabIndex={aria.tabIndex} data-list-card={aria['data-list-card']}>{children}</a>
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
// Pompon, the Lists buddy (ListsBuddy.tsx has its own tests): here only what the tab hands him
vi.mock('./ListsBuddy', () => ({ default: ({ count, hidden }: { count: number; hidden: boolean }) => <div data-testid="buddy" data-count={count} data-hidden={String(hidden)} /> }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => <div data-testid="bunny" /> }))
vi.mock('../mascot-ui/Mascot', () => ({
  Mascot: ({ kind, holding, scene, interactive, tapScene, label }: { kind: string; holding?: string; scene?: string; interactive?: boolean; tapScene?: string; label?: string }) => (
    <div data-testid="mascot" data-kind={kind} data-holding={holding} data-scene={scene} data-interactive={interactive ? 'true' : undefined} data-tap-scene={tapScene} aria-label={label} />
  ),
  preloadMascot: () => undefined,
}))
// «Ночью маскоты спят»: the sleeping Tapsi (mascot-ui/NightSleeper.tsx + night.test.ts have the rules)
vi.mock('../mascot-ui/NightSleeper', () => ({
  default: ({ kind, binoculars, live, label, awakeScene }: { kind: string; binoculars?: boolean; live?: boolean; label?: string; awakeScene?: string }) => (
    <div data-testid="night-tapsi" data-kind={kind} data-binoculars={String(!!binoculars)} data-live={String(!!live)} data-awake-scene={awakeScene} aria-label={label} />
  ),
}))

import { ListsPage, ListsSoon } from './ListsPage'
import { MyListsGrid } from './MyListsGrid'
import CreateListSheet from './CreateListSheet'
import BannerSheet from './BannerSheet'
import { VisibilitySheet } from './VisibilitySheet'
import { OwnerListScreen } from './OwnerListScreen'
import { FriendsSection, SubscribedSection } from './FriendsSection'
import { resetPendingListDeletes, scheduleListDelete, undoListDelete } from './pendingListDeletes'
import { listsKeys } from './queries'
import i18next from 'i18next'
import enLists from '../../locales/en/lists.json'

const ME = '00000000-0000-4000-8000-0000000000aa'
const LIST = '11111111-1111-4111-8111-111111111111'

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

function overview(patch: Partial<ListsOverview> = {}): ListsOverview {
  return {
    me: { id: ME, display_name: 'Mila Sommer', banner: null, live_links: 0 },
    stats: { my_wishes: 4, my_lists: 1, friends_lists: 2, followers: 3, following: 2, requests: 2 },
    my_lists: [{ id: LIST, title: 'Meine Wünsche', kind: 'standalone', visibility: 'private', cover_tone: 2, cover_icon: 'star', due_on: null, wish_count: 4, occasion: null, created_at: '2026-10-19T10:00:00Z' }],
    following: [],
    upcoming: [],
    suggestions: [],
    ...patch,
  }
}

function ownerScreen(flags: { reserved: boolean | null; mine: boolean | null }, visibility: 'private' | 'followers' = 'followers'): ListScreen {
  return {
    list: { id: LIST, title: 'Meine Wünsche', kind: 'standalone', visibility, cover_tone: 2, cover_icon: 'star', due_on: null, created_at: '2026-10-19T10:00:00Z', owner: { id: ME, display_name: 'Mila Sommer', banner: 'meadow' } },
    viewer: { role: 'owner' },
    wishes: [
      { id: '22222222-2222-4222-8222-222222222222', title: 'Kopfhörer', url: null, price_cents: 4990, currency: 'EUR', note: null, priority: 3, created_at: '2026-10-19T11:00:00Z', reserved: flags.reserved, reserved_by_me: flags.mine },
      { id: '33333333-3333-4333-8333-333333333333', title: 'Buch', url: null, price_cents: 1500, currency: 'EUR', note: null, priority: 1, created_at: '2026-10-19T12:00:00Z', reserved: flags.reserved, reserved_by_me: flags.mine },
    ],
  }
}

beforeEach(() => {
  setRenderedAccount(ME)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  resetAccountBoundaryForTests()
  document.documentElement.removeAttribute('data-motion')
  document.documentElement.removeAttribute('data-bunnies')
  for (const item of getToasts()) toast.dismiss(item.id)
})

describe('empty list illustration space follows mascot visibility', () => {
  it.each(['off', 'bunnies-off'])('removes the reserved empty-state stage in %s mode', (mode) => {
    if (mode === 'off') document.documentElement.dataset.motion = 'off'
    else document.documentElement.dataset.bunnies = 'off'
    const view = renderWith(<MyListsGrid lists={[]} onCreate={() => undefined} onTemplate={() => undefined} />)
    expect(screen.queryByTestId('bunny')).toBeNull()
    expect(view.container.querySelector('.h-28')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Leg deine erste Wunschliste an' })).toBeTruthy()
  })

  it('collapses the unavailable tab illustration space when mascots are switched off', async () => {
    const view = renderWith(<ListsSoon />)
    expect(view.container.querySelector('.h-36')).toBeTruthy()
    await act(async () => { document.documentElement.dataset.bunnies = 'off' })
    expect(view.container.querySelector('.h-36')).toBeNull()
    expect(screen.getByText('Bald verfügbar')).toBeTruthy()
  })
})

describe('the release flag (follows-design §00 p. 9)', () => {
  it('off: a calm "Bald verfügbar" and not a single request', () => {
    vi.stubEnv('VITE_DEMO', '')
    vi.stubEnv('VITE_LISTS', '')
    renderWith(<ListsPage userId={ME} />)
    expect(screen.getByText('Bald verfügbar')).toBeTruthy()
    expect(api.getListsOverview).not.toHaveBeenCalled()
  })

  it('on (VITE_LISTS=1): the tab asks get_lists_overview for this account and shows the owner header', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    api.getListsOverview.mockResolvedValue(overview())
    renderWith(<ListsPage userId={ME} />)
    await screen.findByText('Mila Sommer')
    expect(api.getListsOverview).toHaveBeenCalledWith(ME)
    expect(screen.getByText('3 Follower · Du folgst 2')).toBeTruthy()
    expect(screen.getByRole('button', { name: /2 Anfragen/ })).toBeTruthy()
    expect(screen.getByText('Meine Wünsche')).toBeTruthy()
  })

  it('the counters speak singular for one wish, one shared list and one follower (DE; EN plural forms)', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    const one = overview()
    // "Mit dir geteilt" counts exactly the cards of "Freunde" (tabView.ts): one followed person with one list
    const paula = {
      profile: { id: '77777777-7777-4777-8777-777777777777', display_name: 'Paula Brandt', banner: null },
      mutual: false,
      accepted_at: '2026-10-01T10:00:00Z',
      lists: [{ id: '88888888-8888-4888-8888-888888888888', title: 'Weihnachten', cover_tone: null, cover_icon: null, due_on: null, wish_count: 2, new_wish_count: 0, photo: null }],
    }
    api.getListsOverview.mockResolvedValue({
      ...one,
      stats: { my_wishes: 1, my_lists: 1, friends_lists: 1, followers: 1, following: 0, requests: 0 },
      my_lists: one.my_lists.map((card) => ({ ...card, wish_count: 1 })),
      following: [paula],
    })
    renderWith(<ListsPage userId={ME} />)
    const wishes = await screen.findByRole('button', { name: '1 Wunsch – zu deinen Listen' })
    expect(wishes.textContent).toBe('1Wunsch')
    expect(screen.getByRole('button', { name: '1 Liste mit dir geteilt – zu den Freunden' })).toBeTruthy()
    expect(screen.getByText('1 Follower · Du folgst 0')).toBeTruthy()
    i18next.addResourceBundle('en', 'lists', enLists, true, true)
    const en = i18next.getFixedT('en', 'lists')
    expect(en('lists.header.people', { count: 1, followers: 1, following: 0 })).toBe('1 follower · You follow 0')
    expect(en('lists.header.people', { count: 3, followers: 3, following: 0 })).toBe('3 followers · You follow 0')
    expect(en('lists.header.wishes_label', { count: 1 })).toBe('1 wish – to your lists')
    expect(en('lists.header.wishes', { count: 1 })).toBe('Wish')
  })

  it('a list waiting for its 5 s undo takes its wishes off the counter at once; "Rückgängig" brings them back', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    api.getListsOverview.mockResolvedValue(overview())
    const { queryClient } = renderWith(<ListsPage userId={ME} />)
    await screen.findByRole('button', { name: '4 Wünsche – zu deinen Listen' })
    try {
      act(() => {
        scheduleListDelete({ listId: LIST, userId: ME, queryClient, text: { deleted: 'gelöscht', undo: 'Rückgängig' }, onError: () => undefined })
      })
      // the grid shows the empty state and the counter agrees with it
      expect(screen.getByRole('heading', { name: 'Leg deine erste Wunschliste an' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '0 Wünsche – zu deinen Listen' })).toBeTruthy()
      act(() => {
        expect(undoListDelete(LIST)).toBe(true)
      })
      expect(screen.getByRole('button', { name: '4 Wünsche – zu deinen Listen' })).toBeTruthy()
      expect(queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.stats.my_wishes).toBe(4) // the cache itself never changed
    } finally {
      resetPendingListDeletes()
    }
  })

  it('the overview never goes to disk: the persist allow-list stays exactly ["feed"] (W05)', async () => {
    const { PERSISTED_ROOTS, shouldPersistQuery } = await import('../../lib/query')
    expect([...PERSISTED_ROOTS]).toEqual(['feed'])
    const fake = (queryKey: readonly unknown[]) => ({ queryKey, state: { status: 'success', data: {} } }) as never
    expect(shouldPersistQuery(fake(listsKeys.overview()))).toBe(false)
    expect(shouldPersistQuery(fake(listsKeys.list(LIST)))).toBe(false)
  })
})

describe('the create sheet (§2.6, W09)', () => {
  it('a stale screen cannot create for the next account or write optimistic cards into its cache', async () => {
    const { queryClient } = renderWith(<CreateListSheet open userId={ME} standaloneCount={1} onClose={() => undefined} />)
    queryClient.setQueryData(listsKeys.overview(), overview())
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Titel'), { target: { value: 'Old draft' } })
    setRenderedAccount('next-account')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    expect(api.createList).not.toHaveBeenCalled()
    expect(queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.my_lists).toHaveLength(1)
  })

  it('"Nur ich" is preselected; a template fills title and symbol only; the server gets exactly that', async () => {
    api.createList.mockResolvedValue({ id: 'x', created_at: '2026-10-20T10:00:00Z' })
    const { queryClient } = renderWith(<CreateListSheet open userId={ME} followers={3} standaloneCount={1} onClose={() => undefined} />)
    queryClient.setQueryData(listsKeys.overview(), overview())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Nur ich/ }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getByRole('radio', { name: /Meine Follower/ }).getAttribute('aria-checked')).toBe('false')
    expect(within(dialog).getByText('3 Personen')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Weihnachten/ }))
    expect((within(dialog).getByLabelText('Titel') as HTMLInputElement).value).toBe('Weihnachten')
    expect(within(dialog).getByRole('radio', { name: 'Tannenbaum' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    await waitFor(() => expect(api.createList).toHaveBeenCalledTimes(1))
    expect(api.createList.mock.calls[0]?.[0]).toMatchObject({ title: 'Weihnachten', visibility: 'private', cover_icon: 'tree', due_on: null })
    expect(api.createList.mock.calls[0]?.[1]).toBe(ME)
    // optimistic: the card is in "Meine" before the server answered
    expect((queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.my_lists ?? []).some((card) => card.title === 'Weihnachten')).toBe(true)
  })

  it('a picked day closes the month grid, like the occasion form', async () => {
    renderWith(<CreateListSheet open userId={ME} standaloneCount={0} onClose={() => undefined} />)
    const dialog = await screen.findByRole('dialog')
    const row = within(dialog).getByRole('button', { name: /Tag wählen/ })
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    const day = [...dialog.querySelectorAll<HTMLButtonElement>('[data-date]')].find((cell) => !cell.disabled && cell.getAttribute('aria-disabled') !== 'true')
    expect(day).toBeTruthy()
    fireEvent.click(day as HTMLButtonElement)
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(within(dialog).getByRole('button', { name: 'Ohne Datum' })).toBeTruthy()
  })

  it('"Meine Follower" only after its own tap', async () => {
    api.createList.mockResolvedValue({ id: 'x', created_at: '2026-10-20T10:00:00Z' })
    renderWith(<CreateListSheet open userId={ME} followers={0} standaloneCount={0} onClose={() => undefined} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Titel'), { target: { value: 'Bücher' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: /Meine Follower/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    await waitFor(() => expect(api.createList).toHaveBeenCalledTimes(1))
    expect(api.createList.mock.calls[0]?.[0]).toMatchObject({ title: 'Bücher', visibility: 'followers' })
  })

  it('the 21st list: the limit text, nothing is sent; a failed create rolls the card back', async () => {
    const { unmount } = renderWith(<CreateListSheet open userId={ME} standaloneCount={20} onClose={() => undefined} />)
    let dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Titel'), { target: { value: 'Noch eine' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('20 Wunschlisten')
    expect(api.createList).not.toHaveBeenCalled()
    unmount()

    const { AppError } = await import('../../lib/errors')
    api.createList.mockRejectedValue(new AppError('limit_reached'))
    const { queryClient } = renderWith(<CreateListSheet open userId={ME} standaloneCount={3} onClose={() => undefined} />)
    queryClient.setQueryData(listsKeys.overview(), overview())
    dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Titel'), { target: { value: 'Zu viel' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    await waitFor(() => expect(getToasts().some((item) => item.text.includes('20 Wunschlisten'))).toBe(true))
    expect(queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.my_lists.map((card) => card.title)).toEqual(['Meine Wünsche'])
  })

  it('a late answer for a former account changes nothing (W06)', async () => {
    let fail: (reason: unknown) => void = () => undefined
    api.createList.mockReturnValue(new Promise((_, reject) => { fail = reject }))
    const { queryClient } = renderWith(<CreateListSheet open userId={ME} standaloneCount={1} onClose={() => undefined} />)
    queryClient.setQueryData(listsKeys.overview(), overview())
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Titel'), { target: { value: 'Später' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    await waitFor(() => expect(api.createList).toHaveBeenCalled())
    for (const item of getToasts()) toast.dismiss(item.id)
    endAccountEpoch()
    const { AppError } = await import('../../lib/errors')
    await act(async () => {
      fail(new AppError('network'))
      await Promise.resolve()
    })
    expect(getToasts()).toEqual([])
  })
})

describe('the "+" menu entry (integration: requestCreateList)', () => {
  it('opens the create sheet of the tab — also when it was asked before the tab was on screen', async () => {
    vi.stubEnv('VITE_DEMO', '1')
    api.getListsOverview.mockResolvedValue(overview())
    const { requestCreateList } = await import('./createFlow')
    requestCreateList()
    renderWith(<ListsPage userId={ME} />)
    expect(await screen.findByRole('dialog', { name: 'Neue Wunschliste' })).toBeTruthy()
  })
})

describe('the visibility sheet (§2.7)', () => {
  it('a stale screen never changes visibility for a newly rendered account', async () => {
    renderWith(<VisibilitySheet open onClose={() => undefined} listId={LIST} visibility="private" followers={3} userId={ME} onChanged={() => undefined} />)
    const dialog = await screen.findByRole('dialog')
    setRenderedAccount('next-account')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Meine Follower/ }))
    expect(api.setListVisibility).not.toHaveBeenCalled()
  })

  it('"Meine Follower → Nur ich" needs its own confirm step with the static sentence; nothing is sent before', async () => {
    api.setListVisibility.mockResolvedValue()
    const onChanged = vi.fn()
    renderWith(<VisibilitySheet open onClose={() => undefined} listId={LIST} visibility="followers" followers={3} userId={ME} onChanged={onChanged} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Nur ich/ }))
    const warning = await within(dialog).findByRole('note')
    expect(warning.textContent).toBe('Wenn du die Liste nur für dich sichtbar machst, sehen deine Follower sie nicht mehr. Was deine Follower hier heimlich geplant haben, wird dabei aufgehoben – ob es so etwas gibt, erfährst du nie.')
    expect(warning.textContent).not.toMatch(/reserv/i)
    expect(api.setListVisibility).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nur für mich sichtbar machen' }))
    await waitFor(() => expect(api.setListVisibility).toHaveBeenCalledWith(LIST, 'private', ME))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('private'))
  })

  it('"Nur ich → Meine Follower" goes at once; a late answer after an account switch does nothing', async () => {
    let done: () => void = () => undefined
    api.setListVisibility.mockReturnValue(new Promise<void>((resolve) => { done = resolve }))
    const onChanged = vi.fn()
    renderWith(<VisibilitySheet open onClose={() => undefined} listId={LIST} visibility="private" followers={null} userId={ME} onChanged={onChanged} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Meine Follower/ }))
    expect(api.setListVisibility).toHaveBeenCalledWith(LIST, 'followers', ME)
    endAccountEpoch()
    await act(async () => {
      done()
      await Promise.resolve()
    })
    expect(onChanged).not.toHaveBeenCalled()
    expect(getToasts()).toEqual([])
  })
})

describe('banner account binding', () => {
  it('cannot apply the old screen\'s banner to the new account, even before a request starts', async () => {
    const { queryClient } = renderWith(<BannerSheet open onClose={() => undefined} userId={ME} name="Paula" current="sky" />)
    queryClient.setQueryData(listsKeys.overview(), overview())
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Wiese' }))
    setRenderedAccount('next-account')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }))
    expect(api.setMyBanner).not.toHaveBeenCalled()
    expect(queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.me.banner).toBeNull()
  })
})

describe("the owner's list screen (W01)", () => {
  it('is byte-identical whatever the server says about reservations', () => {
    const html = (flags: { reserved: boolean | null; mine: boolean | null }) => {
      const queryClient = client()
      const { container, unmount } = renderWith(<OwnerListScreen screen={ownerScreen(flags)} userId={ME} />, queryClient)
      const out = container.innerHTML.replace(/_r_[0-9a-z]+_/g, 'ID').replace(/:r[0-9a-z]+:/g, 'ID')
      unmount()
      return out
    }
    const clean = html({ reserved: null, mine: null })
    expect(html({ reserved: true, mine: false })).toBe(clean)
    expect(html({ reserved: true, mine: true })).toBe(clean)
    expect(clean).not.toMatch(/reserv/i)
    expect(clean).toContain('Deine Follower sehen die Liste und sprechen sich heimlich ab.')
    expect(clean).toContain('Kopfhörer')
    expect(clean).toContain('Buch')
  })

  it('a follower list while nobody follows: says so, offers the follow link, no word about followers coordinating', () => {
    const queryClient = client()
    const base = overview()
    queryClient.setQueryData(listsKeys.overview(), { ...base, stats: { ...base.stats, followers: 0 } })
    renderWith(<OwnerListScreen screen={{ ...ownerScreen({ reserved: null, mine: null }), wishes: [] }} userId={ME} />, queryClient)
    expect(screen.getByRole('note').textContent).toContain('Noch folgt dir niemand – deshalb sieht die Liste gerade keiner.')
    expect(screen.getByRole('button', { name: 'Folgen-Link teilen' })).toBeTruthy()
    expect(screen.queryByText(/sprechen sich heimlich ab/)).toBeNull()
    expect(screen.getByText('Füg deinen ersten Wunsch hinzu. Wer dir folgt, sieht ihn dann hier.')).toBeTruthy()
    expect(api.getListsOverview).not.toHaveBeenCalled() // the screen reads the tab's cache, no second request
  })

  it('with followers the secret line stays (the note depends on my follower count only)', () => {
    const queryClient = client()
    queryClient.setQueryData(listsKeys.overview(), overview())
    renderWith(<OwnerListScreen screen={ownerScreen({ reserved: true, mine: false })} userId={ME} />, queryClient)
    expect(screen.queryByText(/Noch folgt dir niemand/)).toBeNull()
    expect(screen.getByText(/sprechen sich heimlich ab/)).toBeTruthy()
  })

  it('a "Nur ich" list shows its banner instead of the secret line', () => {
    renderWith(<OwnerListScreen screen={ownerScreen({ reserved: null, mine: null }, 'private')} userId={ME} />)
    expect(screen.getByText('Nur du siehst diese Liste.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mit Followern teilen' })).toBeTruthy()
    expect(screen.queryByText(/sprechen sich heimlich ab/)).toBeNull()
  })
})

describe('"Freunde" for someone who follows nobody (§2.4)', () => {
  const soon = {
    list: { id: '44444444-4444-4444-8444-444444444444', title: 'Annas Einweihung', cover_tone: null, cover_icon: null, wish_count: 3, occasion_id: '55555555-5555-4555-8555-555555555555' },
    owner: { id: '66666666-6666-4666-8666-666666666666', display_name: 'Anna Beispiel' },
    date: '2026-12-24',
    kind: 'occasion' as const,
  }

  it('a newcomer who is only a guest of an occasion: no "Bald" here (occasions live on their own page), how following works and [Deinen Link teilen]', () => {
    const onShare = vi.fn()
    renderWith(<FriendsSection userId={ME} overview={overview({ upcoming: [soon] })} onShare={onShare} />)
    // Felix 22.10: "In Listen gibt es keine Anlässe – nur Wunschlisten" (tabView.ts)
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).not.toContain('Bald')
    expect(screen.queryByText('Annas Einweihung')).toBeNull()
    expect(headings).toContain('Folge Freunden, dann siehst du hier ihre Wünsche')
    expect(screen.getByRole('heading', { name: 'So geht’s' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Deinen Link teilen' }))
    expect(onShare).toHaveBeenCalledTimes(1)
    // the "no people search" line once (the empty card carries it)
    expect(screen.getAllByText(/kann man niemanden suchen/)).toHaveLength(1)
    // Tapsi looks out for friends: the hamster holds the binoculars in his own paws (no overlay drawn over him)
    const tapsi = screen.getByTestId('mascot')
    expect(tapsi.dataset['kind']).toBe('hamster')
    expect(tapsi.dataset['holding']).toBe('binoculars')
  })

  it('Tapsi answers ONLY a tap / Enter with «Пылинка» (Felix 26.10): never by himself; under Weniger he is no button', () => {
    const { unmount } = renderWith(<FriendsSection userId={ME} overview={overview({})} onShare={() => undefined} />)
    const tapsi = screen.getByTestId('mascot')
    expect(tapsi.dataset['interactive']).toBe('true')
    expect(tapsi.dataset['tapScene']).toBe('speck')
    expect(tapsi.getAttribute('aria-label')).toBe('Tapsi putzt sein Fernglas')
    expect(tapsi.dataset['scene']).toBeUndefined()
    unmount()
    document.documentElement.setAttribute('data-motion', 'reduce')
    try {
      renderWith(<FriendsSection userId={ME} overview={overview({})} onShare={() => undefined} />)
      const calm = screen.getByTestId('mascot')
      expect(calm.dataset['holding']).toBe('binoculars')
      expect(calm.dataset['interactive']).toBeUndefined()
      expect(calm.dataset['tapScene']).toBeUndefined()
    } finally {
      document.documentElement.removeAttribute('data-motion')
    }
  })

  it('23:00 – 07:00 Tapsi sleeps there (binoculars on his tummy): a tap wakes him, awake a tap is his speck again', async () => {
    globalThis.__bunpriseNightClock = () => new Date().setHours(23, 30, 0, 0)
    renderWith(<FriendsSection userId={ME} overview={overview({})} onShare={() => undefined} />)
    const sleeper = await screen.findByTestId('night-tapsi')
    expect(sleeper.dataset['kind']).toBe('hamster')
    expect(sleeper.dataset['binoculars']).toBe('true')
    // opened at night: he already sleeps (no falling-asleep moment)
    expect(sleeper.dataset['live']).toBe('false')
    expect(sleeper.dataset['awakeScene']).toBe('speck')
    expect(sleeper.getAttribute('aria-label')).toBe('Tapsi putzt sein Fernglas')
    expect(screen.queryByTestId('mascot')).toBeNull()
  })

  it('«Nachts schlafen» off: at night Tapsi looks out as by day', async () => {
    globalThis.__bunpriseNightClock = () => new Date().setHours(23, 30, 0, 0)
    localStorage.setItem('bunprise.nightSleep', '0')
    try {
      renderWith(<FriendsSection userId={ME} overview={overview({})} onShare={() => undefined} />)
      await act(async () => { await import('../mascot-ui/night') })
      expect(screen.getByTestId('mascot').dataset['holding']).toBe('binoculars')
      expect(screen.queryByTestId('night-tapsi')).toBeNull()
    } finally {
      localStorage.removeItem('bunprise.nightSleep')
    }
  })

  it('once I follow somebody the explanation goes away', () => {
    const person = { profile: { id: '77777777-7777-4777-8777-777777777777', display_name: 'Paula Brandt', banner: null }, mutual: true, accepted_at: '2026-10-01T10:00:00Z', lists: [] }
    renderWith(<FriendsSection userId={ME} overview={overview({ upcoming: [soon], following: [person] })} onShare={() => undefined} />)
    expect(screen.queryByRole('heading', { name: 'Folge Freunden, dann siehst du hier ihre Wünsche' })).toBeNull()
    expect(screen.getAllByText(/kann man niemanden suchen/)).toHaveLength(1)
  })

  it('a followed person: avatar and name open the profile; screen readers hear one link, the name (Felix 25.10)', () => {
    const person = { profile: { id: '77777777-7777-4777-8777-777777777777', display_name: 'Paula Brandt', banner: null }, mutual: true, accepted_at: '2026-10-01T10:00:00Z', lists: [] }
    const view = renderWith(<FriendsSection userId={ME} overview={overview({ following: [person] })} onShare={() => undefined} />)
    const name = screen.getByRole('link', { name: 'Paula Brandt' })
    expect(name.getAttribute('href')).toBe(`/people/${person.profile.id}`)
    expect(screen.getByRole('heading', { name: 'Paula Brandt' }).contains(name)).toBe(true)
    const avatar = view.container.querySelector('a.lf-person-avatar')
    expect(avatar?.getAttribute('href')).toBe(`/people/${person.profile.id}`)
    expect(avatar?.getAttribute('aria-hidden')).toBe('true')
    expect(avatar?.getAttribute('tabindex')).toBe('-1')
  })
})

describe('"Meine": my lists, then "Abonniert" (Felix 26.10)', () => {
  const list = (id: string, title: string) => ({ id, title, cover_tone: null, cover_icon: null, due_on: null, wish_count: 2, new_wish_count: 0, photo: null })
  const blogger = {
    profile: { id: '77777777-7777-4777-8777-777777777777', display_name: 'Paula Brandt', banner: null },
    mutual: false,
    accepted_at: '2026-10-01T10:00:00Z',
    lists: [list('88888888-8888-4888-8888-888888888888', 'Weihnachten')],
  }
  const friend = {
    profile: { id: '99999999-9999-4999-8999-999999999999', display_name: 'Jonas Weber', banner: null },
    mutual: true,
    accepted_at: '2026-10-01T10:00:00Z',
    lists: [list('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bücher')],
  }

  it('shows the people I follow who do not follow me back, with their lists — friends stay in "Freunde" only', () => {
    renderWith(<SubscribedSection userId={ME} overview={overview({ following: [blogger, friend] })} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Abonniert' })).toBeTruthy()
    // the person's name sits one level below the section heading
    expect(screen.getByRole('heading', { level: 3, name: 'Paula Brandt' })).toBeTruthy()
    expect(screen.getByText('Weihnachten')).toBeTruthy()
    expect(screen.queryByText('Jonas Weber')).toBeNull()
    expect(screen.queryByText('Bücher')).toBeNull()
  })

  it('nothing at all while every person I follow follows me back, or shares no list', () => {
    const quiet = { ...blogger, lists: [] }
    const view = renderWith(<SubscribedSection userId={ME} overview={overview({ following: [friend, quiet] })} />)
    expect(view.container.childElementCount).toBe(0)
  })

  it('the tab shows "Meine Listen" as a visible heading above my own lists, and "Abonniert" below them', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    api.getListsOverview.mockResolvedValue(overview({ following: [blogger] }))
    renderWith(<ListsPage userId={ME} />)
    const mine = await screen.findByRole('heading', { level: 2, name: 'Meine Listen' })
    expect(mine.className).not.toContain('sr-only')
    const subscribed = await screen.findByRole('heading', { level: 2, name: 'Abonniert' })
    expect(mine.compareDocumentPosition(subscribed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('Pompon, the Lists buddy, on the tab (Felix 25.10)', () => {
  it('lives on the tab with my own wish count; his home floor, the avatar and every list card are marked', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    api.getListsOverview.mockResolvedValue(overview())
    const view = renderWith(<ListsPage userId={ME} />)
    const buddy = await screen.findByTestId('buddy')
    expect(buddy.dataset.count).toBe('4')
    expect(buddy.dataset.hidden).toBe('false')
    const stats = view.container.querySelector('[data-buddy-floor="stats"]')
    expect(stats?.hasAttribute('data-buddy-room')).toBe(true)
    expect(view.container.querySelector('[data-buddy-avatar]')).not.toBeNull()
    expect(view.container.querySelector(`[data-buddy-floor="${LIST}"][data-buddy-card="0"]`)).not.toBeNull()
    // he lives inside the stage box, the header and sections are its children
    expect(view.container.querySelector('.lt-buddy-stage [data-buddy-floor="stats"]')).not.toBeNull()
    // the "Meine · Freunde" switch is his ceiling: he never stands right under it (it covered him, Felix 25.10)
    expect(view.container.querySelector('.lt-buddy-stage .lt-segment[data-buddy-ceiling]')).not.toBeNull()
  })

  it('steps aside for Tapsi with the binoculars (nobody followed) and for Pompon of the empty "Meine"', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    api.getListsOverview.mockResolvedValue(overview({ following: [] }))
    renderWith(<ListsPage userId={ME} />)
    expect((await screen.findByTestId('buddy')).dataset.hidden).toBe('false')
    fireEvent.click(screen.getByRole('radio', { name: 'Freunde' }))
    await waitFor(() => expect(screen.getByTestId('buddy').dataset.hidden).toBe('true'))
  })

  it('no buddy and no reserved row with mascots switched off', async () => {
    vi.stubEnv('VITE_LISTS', '1')
    document.documentElement.dataset.bunnies = 'off'
    api.getListsOverview.mockResolvedValue(overview())
    const view = renderWith(<ListsPage userId={ME} />)
    await screen.findByText('Mila Sommer')
    expect(screen.queryByTestId('buddy')).toBeNull()
    expect(view.container.querySelector('[data-buddy-room]')).toBeNull()
  })
})
