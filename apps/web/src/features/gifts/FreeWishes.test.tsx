import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import type { FreeWish, FreeWishes as FreeResult } from '../../lib/api/lists.types'
import { takeOpenWish } from '../wishes/openWish'
import { BUDGET_NO_LIMIT } from './budget'
import FreeWishes, { placeFor } from './FreeWishes'

// "Noch frei auf Annas Liste" (giver mode): only the chosen list, compact, and an empty text that says why.
// Invented fixtures only.

const api = vi.hoisted(() => ({ getFreeWishes: vi.fn(), navigate: vi.fn() }))
vi.mock('../../lib/api/lists', () => ({ getFreeWishes: api.getFreeWishes }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }))

const wish = (index: number, list: FreeWish['list'], price: number | null = 1000): FreeWish => ({
  wish_id: `wish-${list.id}-${index}`, title: `${list.title} ${index}`, url: null, price_cents: price, currency: 'EUR', priority: 2, created_at: '2026-10-20',
  list, lists: [list],
})
const PARTY = { id: 'list-party', title: 'Einweihung', kind: 'occasion' as const, date: '2026-10-25', occasion_id: 'occ-party' }
const BOOKS = { id: 'list-books', title: 'Bücher', kind: 'standalone' as const, date: null, occasion_id: null }
const data: FreeResult = {
  person: { id: 'anna', display_name: 'Anna', banner: null },
  ideas: [wish(0, PARTY, 3500), wish(1, PARTY, null), wish(2, PARTY), wish(3, PARTY), wish(0, BOOKS), wish(1, BOOKS)],
}

beforeEach(() => {
  vi.stubEnv('VITE_LISTS', '1')
  setRenderedAccount('me')
  api.getFreeWishes.mockResolvedValue(data)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  onlineManager.setOnline(true)
  resetAccountBoundaryForTests()
})

function show({ profileId = 'anna', listKey = 'occasion:occ-party', maxCents = 2500, onAnyBudget = vi.fn() } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <FreeWishes userId="me" profileId={profileId} name="Anna" listKey={listKey} maxCents={maxCents} onAnyBudget={onAnyBudget} />
      </LazyMotion>
    </QueryClientProvider>,
  )
}

it('shows only the chosen list, at most three with their price; "Alle n" opens the list itself', async () => {
  show()
  const region = await screen.findByRole('region', { name: 'Noch frei auf Annas Liste' })
  await within(region).findByRole('button', { name: /^Einweihung 0/ })
  const rows = within(region).getAllByRole('listitem').map((row) => row.textContent)
  expect(rows).toHaveLength(3)
  expect(rows.every((text) => text?.startsWith('Einweihung'))).toBe(true)
  expect(rows[0]).toMatch(/35,00/)
  expect(api.getFreeWishes).toHaveBeenCalledWith('anna', 2500, 'me')
  fireEvent.click(within(region).getByRole('button', { name: 'Alle 4' }))
  expect(api.navigate).toHaveBeenCalledWith({ to: '/occasions/$occasionId', params: { occasionId: 'occ-party' } })
  expect(takeOpenWish('list-party')).toBeNull()
})

it('another list chip shows that list (a list without an occasion opens its own screen, with the wish)', async () => {
  show({ listKey: 'list:list-books' })
  const region = await screen.findByRole('region', { name: 'Noch frei auf Annas Liste' })
  const first = await within(region).findByRole('button', { name: /^Bücher 0/ })
  expect(within(region).getAllByRole('listitem')).toHaveLength(2)
  expect(within(region).queryByRole('button', { name: /^Alle/ })).toBeNull()
  fireEvent.click(first)
  expect(api.navigate).toHaveBeenCalledWith({ to: '/lists/$listId', params: { listId: 'list-books' } })
  expect(takeOpenWish('list-books')).toBe('wish-list-books-0')
})

it('says when the budget is why nothing is free, and offers "Budget egal"', async () => {
  api.getFreeWishes.mockResolvedValue({ ...data, ideas: [] })
  const onAnyBudget = vi.fn()
  show({ maxCents: 500, onAnyBudget })
  expect(await screen.findByText('Bis 5 € ist auf Annas Liste nichts frei.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Budget egal' }))
  expect(onAnyBudget).toHaveBeenCalledTimes(1)
})

it('without a budget limit it says that nothing is free any more', async () => {
  api.getFreeWishes.mockResolvedValue({ ...data, ideas: [] })
  show({ maxCents: BUDGET_NO_LIMIT })
  expect(await screen.findByText('Auf Annas Liste ist gerade nichts mehr frei – schau dir die Ideen an.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Budget egal' })).toBeNull()
})

it('offline it says so instead of an endless skeleton', async () => {
  onlineManager.setOnline(false)
  show()
  expect(await screen.findByText('Du bist offline. Was noch frei ist, siehst du, sobald du wieder Netz hast.')).toBeTruthy()
  expect(api.getFreeWishes).not.toHaveBeenCalled()
  act(() => onlineManager.setOnline(true))
  expect(await screen.findByRole('button', { name: /^Einweihung 0/ })).toBeTruthy()
})

it('never asks for oneself or when the list flag is off', () => {
  const own = show({ profileId: 'me' })
  expect(api.getFreeWishes).not.toHaveBeenCalled()
  own.unmount()
  vi.stubEnv('VITE_LISTS', '')
  show()
  expect(api.getFreeWishes).not.toHaveBeenCalled()
})

it('a stale giver screen cannot leave an opening intent after the account changes', async () => {
  show()
  const first = await screen.findByRole('button', { name: /^Einweihung 0/ })
  act(() => {
    endAccountEpoch()
    setRenderedAccount('anna')
  })
  fireEvent.click(first)
  expect(api.navigate).not.toHaveBeenCalled()
  expect(takeOpenWish('list-party')).toBeNull()
})

// WS11 (shared wishes, design §5.6): ONE wish in two of Anna's lists — under each chip it opens THAT list
it('a wish in two lists: the chosen list decides the filter, the row and "Alle n"', async () => {
  const both: FreeWish = { ...wish(9, PARTY), wish_id: 'wish-shared', title: 'Geteilt', list: PARTY, lists: [PARTY, BOOKS] }
  api.getFreeWishes.mockResolvedValue({ ...data, ideas: [both] })
  const one = show({ listKey: 'list:list-books' })
  const row = await screen.findByRole('button', { name: /^Geteilt/ })
  fireEvent.click(row)
  expect(api.navigate).toHaveBeenCalledWith({ to: '/lists/$listId', params: { listId: 'list-books' } })
  expect(takeOpenWish('list-books')).toBe('wish-shared')
  one.unmount()
  api.navigate.mockClear()
  show({ listKey: 'occasion:occ-party' })
  fireEvent.click(await screen.findByRole('button', { name: /^Geteilt/ }))
  expect(api.navigate).toHaveBeenCalledWith({ to: '/occasions/$occasionId', params: { occasionId: 'occ-party' } })
  expect(takeOpenWish('list-party')).toBe('wish-shared')
})

it('placeFor falls back to list (an older server) and finds nothing for a foreign chip', () => {
  expect(placeFor({ list: BOOKS, lists: [] }, 'list:list-books')).toEqual(BOOKS)
  expect(placeFor({ list: BOOKS, lists: [BOOKS] }, 'occasion:occ-party')).toBeNull()
  expect(placeFor({ list: PARTY, lists: [PARTY, BOOKS] }, 'list:list-books')).toEqual(BOOKS)
})
