import { useState, type ReactNode } from 'react'
import { LazyMotion, domMax } from 'motion/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListsOverview, OwnerListCard } from '../../lib/api/lists.types'
import type { OwnerWish } from '../../lib/api/types'
import { resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import { toast } from '../../lib/toast'

// The ⋯ of one of my wishes (lists wave 2, Felix 22.10): its rows, the lazy "In andere Liste verschieben" picker
// (my OTHER lists without an occasion) and "Wie sehr wünschst du es dir?" (a radiogroup). The menu only asks; the
// actions themselves live in OwnerWishlist (OwnerWishlist.test.tsx). Fictional data only.

const api = vi.hoisted(() => ({
  getListsOverview: vi.fn<(expectedUserId?: string) => Promise<ListsOverview>>(),
}))

vi.mock('../../lib/api/lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/lists')>()),
  getListsOverview: api.getListsOverview,
  deleteList: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => {
  const Link = ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => {
    const href = Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
    return <a href={href} className={className}>{children}</a>
  }
  return { Link, createLink: () => Link }
})

import { listsKeys } from '../lists/queries'
import { resetPendingListDeletes, scheduleListDelete } from '../lists/pendingListDeletes'
import { WishMenu, type WishMenuProps, type WishMenuStage } from './WishMenu'

const ME = '00000000-0000-4000-8000-0000000000aa'
const CURRENT = '11111111-1111-4111-8111-111111111111'
const BOOKS = '11111111-1111-4111-8111-111111111112'
const XMAS = '11111111-1111-4111-8111-111111111113'
const PARTY = '11111111-1111-4111-8111-111111111114'
const OLD_PARTY = '11111111-1111-4111-8111-111111111115'
const SOON = '11111111-1111-4111-8111-111111111116'
const DAY_MS = 86_400_000
/** occasion start times relative to now, so the "upcoming" filter never ages out of the test */
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString()
const GRINDER = '00000000-0000-4000-8000-0000000000a1'

function wish(overrides: Partial<OwnerWish> = {}): OwnerWish {
  return {
    id: GRINDER, title: 'Kaffeemühle', url: null, price_cents: 4990, currency: 'EUR', note: null, priority: 2,
    created_at: '2026-10-01T10:00:00+00:00', received_at: null, ...overrides,
  }
}

function card(id: string, patch: Partial<OwnerListCard>): OwnerListCard {
  return {
    id, title: 'Meine Wünsche', kind: 'standalone', visibility: 'private', cover_tone: 2, cover_icon: 'star', due_on: null,
    wish_count: 4, occasion: null, created_at: '2026-10-19T10:00:00Z', photo: null, ...patch,
  }
}

function overview(myLists: OwnerListCard[]): ListsOverview {
  return {
    me: { id: ME, display_name: 'Mila Sommer', banner: null, live_links: 0 },
    stats: { my_wishes: 0, my_lists: myLists.length, friends_lists: 0, followers: 3, following: 0, requests: 0 },
    my_lists: myLists,
    following: [],
    upcoming: [],
    suggestions: [],
  }
}

const ALL_MY_LISTS = [
  card(CURRENT, { title: 'Meine Wünsche' }),
  card(BOOKS, { title: 'Bücher', visibility: 'followers', wish_count: 3 }),
  card(PARTY, {
    title: null, kind: 'occasion', visibility: 'occasion', wish_count: 7,
    occasion: { id: '99999999-9999-4999-8999-999999999999', title: 'Sommerfest', starts_at: inDays(40), tz: 'Europe/Berlin', all_day: false },
  }),
  // an occasion that is over: never offered
  card(OLD_PARTY, {
    title: null, kind: 'occasion', visibility: 'occasion', wish_count: 2,
    occasion: { id: '99999999-9999-4999-8999-999999999998', title: 'Grillabend', starts_at: inDays(-20), tz: 'Europe/Berlin', all_day: false },
  }),
  // sooner than the Sommerfest: first in "Ereignisse"
  card(SOON, {
    title: null, kind: 'occasion', visibility: 'occasion', wish_count: 0,
    occasion: { id: '99999999-9999-4999-8999-999999999997', title: 'Spieleabend', starts_at: inDays(5), tz: 'Europe/Berlin', all_day: false },
  }),
  card(XMAS, { title: 'Weihnachten', wish_count: 1 }),
]

type Handlers = Pick<WishMenuProps, 'onMove' | 'onReceived' | 'onPriority' | 'onDelete'>

/** The menu with its stage in state (like OwnerWishlist), the handlers recorded. */
function renderMenu(target: OwnerWish, initial: WishMenuStage = 'menu', myLists: OwnerListCard[] = ALL_MY_LISTS) {
  const handlers = { onMove: vi.fn(), onReceived: vi.fn(), onPriority: vi.fn(), onDelete: vi.fn() } satisfies Handlers
  const stages: WishMenuStage[] = []
  function Harness() {
    const [stage, setStage] = useState<WishMenuStage>(initial)
    return (
      <WishMenu
        wish={target}
        stage={stage}
        onStage={(next) => {
          stages.push(next)
          setStage(next)
        }}
        listId={CURRENT}
        {...handlers}
      />
    )
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  // the tab's overview is in memory (fresh): the picker asks for nothing
  queryClient.setQueryData(listsKeys.overview(), overview(myLists))
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <Harness />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { ...view, handlers, stages, queryClient }
}

function rowTitles(dialog: HTMLElement): string[] {
  const list = dialog.querySelector('[data-wish-menu]') as HTMLElement
  return [...list.querySelectorAll(':scope > li')].map((row) => row.querySelector('.t-headline')?.textContent ?? '')
}

const menuDialog = () => screen.getByRole('dialog', { name: 'Kaffeemühle' })
/** the move picker is a lazy chunk: it comes in after a suspense (generous timeout for a busy machine) */
const findPicker = () => screen.findByRole('dialog', { name: 'Wohin verschieben?' }, { timeout: 3000 })

beforeAll(async () => {
  // warm the lazy chunk's module graph once (the picker itself still suspends and comes in lazily)
  await import('../lists/MoveWishSheet')
})
beforeEach(() => {
  setRenderedAccount(ME)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  resetPendingListDeletes()
  resetAccountBoundaryForTests()
  toast.clear()
})

describe('WishMenu: the rows', () => {
  it('an open wish: move · received · edit · how much · delete (destructive last); nothing about reservations', () => {
    renderMenu(wish())
    const dialog = menuDialog()
    expect(rowTitles(dialog)).toEqual(['In andere Liste verschieben', 'Als erhalten markieren', 'Bearbeiten', 'Wie sehr wünschst du es dir?', 'Wunsch löschen'])
    expect(within(dialog).getByRole('link', { name: 'Bearbeiten' }).getAttribute('href')).toBe(`/wishes/${GRINDER}/edit`)
    // the current "how much" as the meter's ONE heart (Felix 25.10: not a count of hearts) + its word
    const row = within(dialog).getByRole('button', { name: /^Wie sehr wünschst du es dir\?/ })
    expect(row.querySelector('.wish-prio-heart[data-level="2"] .wish-heart')).not.toBeNull()
    expect(row.querySelector('.wish-prio-heart[data-level="2"]')?.textContent).toBe('Gern')
    expect(row.querySelectorAll('.wish-heart')).toHaveLength(1)
    expect(within(dialog).getByText('Wunsch löschen').className).toContain('text-danger')
    expect(dialog.textContent).not.toMatch(/reserv/i)
  })

  it('a received wish: "Doch nicht erhalten" and no "Wie sehr …" row', () => {
    renderMenu(wish({ received_at: '2026-10-21T09:00:00Z' }))
    expect(rowTitles(menuDialog())).toEqual(['In andere Liste verschieben', 'Doch nicht erhalten', 'Bearbeiten', 'Wunsch löschen'])
  })

  it('"Als erhalten markieren" closes the menu and asks for received = true', () => {
    const target = wish()
    const { handlers, stages } = renderMenu(target)
    fireEvent.click(within(menuDialog()).getByRole('button', { name: 'Als erhalten markieren' }))
    expect(handlers.onReceived).toHaveBeenCalledWith(target, true)
    expect(stages).toEqual([null])
  })

  it('"Doch nicht erhalten" asks for received = false', () => {
    const target = wish({ received_at: '2026-10-21T09:00:00Z' })
    const { handlers } = renderMenu(target)
    fireEvent.click(within(menuDialog()).getByRole('button', { name: 'Doch nicht erhalten' }))
    expect(handlers.onReceived).toHaveBeenCalledWith(target, false)
  })

  it('"Wunsch löschen" closes the menu and hands the wish to the delete', () => {
    const target = wish()
    const { handlers, stages } = renderMenu(target)
    fireEvent.click(within(menuDialog()).getByRole('button', { name: 'Wunsch löschen' }))
    expect(handlers.onDelete).toHaveBeenCalledWith(target)
    expect(stages).toEqual([null])
  })

  it('offline: move, received and how much are disabled; delete stays (its undo waits anyway)', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderMenu(wish())
    const dialog = menuDialog()
    expect((within(dialog).getByRole('button', { name: 'In andere Liste verschieben' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: 'Als erhalten markieren' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: /^Wie sehr wünschst du es dir\?/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: 'Wunsch löschen' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('WishMenu: "In andere Liste verschieben" (MoveWishSheet, a lazy chunk)', () => {
  async function openPicker(target = wish(), myLists: OwnerListCard[] = ALL_MY_LISTS) {
    const view = renderMenu(target, 'menu', myLists)
    fireEvent.click(within(menuDialog()).getByRole('button', { name: 'In andere Liste verschieben' }))
    const picker = await findPicker()
    return { ...view, picker }
  }

  const pickerRows = (picker: HTMLElement) =>
    within(picker).getAllByRole('button').filter((button) => button.closest('ul')).map((row) => row.querySelector('.t-headline')?.textContent ?? '')

  it('offers my upcoming events first (soonest first, past ones never), then my OTHER lists, each with who sees it', async () => {
    const { picker } = await openPicker()
    expect(within(picker).getByText('„Kaffeemühle“ verschieben nach …')).toBeTruthy()
    expect(pickerRows(picker)).toEqual(['Spieleabend', 'Sommerfest', 'Bücher', 'Weihnachten'])
    const events = picker.querySelector('[data-move-group="events"]') as HTMLElement
    const lists = picker.querySelector('[data-move-group="lists"]') as HTMLElement
    expect(within(events).getByRole('heading', { name: 'Ereignisse' })).toBeTruthy()
    expect(within(lists).getByRole('heading', { name: 'Listen' })).toBeTruthy()
    expect(within(events).getByText(/7 Wünsche · Gäste$/)).toBeTruthy()
    expect(within(lists).getByText('3 Wünsche · Follower')).toBeTruthy()
    expect(within(lists).getByText('1 Wunsch · Nur ich')).toBeTruthy()
    expect(within(picker).queryByText('Meine Wünsche')).toBeNull() // the wish's own list
    expect(within(picker).queryByText('Grillabend')).toBeNull() // over
    expect(api.getListsOverview).not.toHaveBeenCalled() // the tab's overview from memory
  })

  it('a wish on an event’s list: that event is left out, the other event and my lists are offered', async () => {
    const handlers = { onMove: vi.fn(), onReceived: vi.fn(), onPriority: vi.fn(), onDelete: vi.fn() }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    queryClient.setQueryData(listsKeys.overview(), overview(ALL_MY_LISTS))
    render(
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domMax} strict>
          <WishMenu wish={wish()} stage="move" onStage={() => undefined} listId={PARTY} {...handlers} />
        </LazyMotion>
      </QueryClientProvider>,
    )
    const picker = await findPicker()
    expect(pickerRows(picker)).toEqual(['Spieleabend', 'Meine Wünsche', 'Bücher', 'Weihnachten'])
    fireEvent.click(within(picker).getByRole('button', { name: /^Spieleabend/ }))
    expect(handlers.onMove).toHaveBeenCalledWith(wish(), { id: SOON, title: 'Spieleabend' })
  })

  it('a list waiting for its delete is not offered', async () => {
    const queryClient = new QueryClient()
    scheduleListDelete({ listId: XMAS, userId: ME, queryClient, text: { deleted: 'gelöscht', undo: 'Rückgängig' }, onError: () => undefined })
    const { picker } = await openPicker()
    expect(pickerRows(picker)).toEqual(['Spieleabend', 'Sommerfest', 'Bücher'])
  })

  it('picking a list closes the picker and calls onMove with its id and title', async () => {
    const target = wish()
    const { picker, handlers, stages } = await openPicker(target)
    fireEvent.click(within(picker).getByRole('button', { name: /^Bücher/ }))
    expect(handlers.onMove).toHaveBeenCalledWith(target, { id: BOOKS, title: 'Bücher' })
    expect(stages).toEqual(['move', null])
  })

  it('no other wishlist and no upcoming event: the picker says so (and offers nothing)', async () => {
    const { picker } = await openPicker(wish(), ALL_MY_LISTS.filter((entry) => entry.id === CURRENT || entry.id === OLD_PARTY))
    expect(within(picker).getByText('Du hast keine andere Wunschliste und kein kommendes Ereignis. Unter „Listen“ legst du eine neue Liste an.')).toBeTruthy()
    expect(pickerRows(picker)).toEqual([])
  })
})

describe('WishMenu: "Wie sehr wünschst du es dir?" (PrioritySheet)', () => {
  async function openPriority(target = wish()) {
    const view = renderMenu(target)
    fireEvent.click(within(menuDialog()).getByRole('button', { name: /^Wie sehr wünschst du es dir\?/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Wie sehr wünschst du es dir?' })
    return { ...view, sheet }
  }

  it("shows the form's wish-o-meter at the wish's level (Felix 26.10: the same scale as when creating)", async () => {
    const { sheet } = await openPriority()
    const slider = within(sheet).getByRole('slider', { name: 'Wie sehr?' }) as HTMLInputElement
    expect(slider.value).toBe('2')
    expect(within(sheet).queryAllByRole('radio')).toHaveLength(0)
  })

  it('a new level is kept with "Fertig": one call, then the sheet closes', async () => {
    const target = wish()
    const { sheet, handlers, stages } = await openPriority(target)
    fireEvent.keyDown(within(sheet).getByRole('slider', { name: 'Wie sehr?' }), { key: 'ArrowRight' })
    expect(handlers.onPriority).not.toHaveBeenCalled()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }))
    expect(handlers.onPriority).toHaveBeenCalledTimes(1)
    expect(handlers.onPriority).toHaveBeenCalledWith(target, 3)
    expect(stages).toEqual(['priority', null])
  })

  it('closing the sheet keeps the new level too; an unchanged level sends nothing', async () => {
    const target = wish()
    const first = await openPriority(target)
    fireEvent.keyDown(within(first.sheet).getByRole('slider', { name: 'Wie sehr?' }), { key: 'ArrowLeft' })
    fireEvent.click(within(first.sheet).getByRole('button', { name: 'Schließen' }))
    expect(first.handlers.onPriority).toHaveBeenCalledWith(target, 1)
    first.unmount()
    const second = await openPriority(target)
    fireEvent.click(within(second.sheet).getByRole('button', { name: 'Fertig' }))
    expect(second.handlers.onPriority).not.toHaveBeenCalled()
    expect(second.stages).toEqual(['priority', null])
  })
})

// Shared wishes (20261027200000, design §5.7): a wish that lives in another list too has no "Verschieben" (the database
// refuses it); instead "Aus „…“ entfernen" (this list only) and "Überall löschen" behind a confirmation that names
// every list. A wish that lives only here keeps the old rows.
describe('the ⋯ of a wish in several lists', () => {
  const shared = wish({
    also_in: [{ id: BOOKS, title: 'Bücher', kind: 'standalone', occasion_id: null, home: true, paused: false }],
  })

  function renderShared(target: OwnerWish, listTitle = 'Sommerfest') {
    const handlers = { onMove: vi.fn(), onReceived: vi.fn(), onPriority: vi.fn(), onDelete: vi.fn(), onRemoveHere: vi.fn(), onDeleteEverywhere: vi.fn() }
    function Harness() {
      const [stage, setStage] = useState<WishMenuStage>('menu')
      return <WishMenu wish={target} stage={stage} onStage={setStage} listId={PARTY} listTitle={listTitle} {...handlers} />
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domMax} strict>
          <Harness />
        </LazyMotion>
      </QueryClientProvider>,
    )
    return handlers
  }

  it('offers "Aus „Sommerfest“ entfernen" and "Überall löschen" instead of moving and deleting', () => {
    const handlers = renderShared(shared)
    const titles = rowTitles(menuDialog())
    expect(titles).toContain('Aus „Sommerfest“ entfernen')
    expect(titles).toContain('Überall löschen')
    expect(titles).not.toContain('In andere Liste verschieben')
    expect(titles).not.toContain('Wunsch löschen')
    fireEvent.click(within(menuDialog()).getByRole('button', { name: 'Aus „Sommerfest“ entfernen' }))
    expect(handlers.onRemoveHere).toHaveBeenCalledWith(shared)
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('"Überall löschen" asks first and names every list', () => {
    const handlers = renderShared(shared)
    fireEvent.click(within(menuDialog()).getByRole('button', { name: 'Überall löschen' }))
    const confirm = screen.getByRole('dialog', { name: 'Überall löschen?' })
    expect(confirm.textContent).toContain('„Sommerfest“, „Bücher“')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Überall löschen' }))
    expect(handlers.onDeleteEverywhere).toHaveBeenCalledWith(shared)
  })

  it('cancelling the confirmation deletes nothing', () => {
    const handlers = renderShared(shared)
    fireEvent.click(within(menuDialog()).getByRole('button', { name: 'Überall löschen' }))
    const confirm = screen.getByRole('dialog', { name: 'Überall löschen?' })
    const cancels = within(confirm).getAllByRole('button', { name: 'Abbrechen' })
    fireEvent.click(cancels[cancels.length - 1]!)
    expect(handlers.onDeleteEverywhere).not.toHaveBeenCalled()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('a wish that lives only here (or an older server: no also_in) keeps "Verschieben" and "Wunsch löschen"', () => {
    renderShared(wish({ also_in: [] }))
    const titles = rowTitles(menuDialog())
    expect(titles).toContain('In andere Liste verschieben')
    expect(titles).toContain('Wunsch löschen')
    expect(titles).not.toContain('Überall löschen')
  })
})
