import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { endAccountEpoch, resetAccountBoundaryForTests, setRenderedAccount } from '../../lib/accountBoundary'
import type { FreeWishes as FreeResult } from '../../lib/api/lists.types'
import { lastMode, lastPerson, resetGiftSessionForTests } from '../gifts/session'
import { takeOpenWish } from '../wishes/openWish'
import FreeWishes from './FreeWishes'
import { useFindGiftFor } from './findGift'

const api = vi.hoisted(() => ({ getFreeWishes: vi.fn(), navigate: vi.fn() }))
vi.mock('../../lib/api/lists', () => ({ getFreeWishes: api.getFreeWishes }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }))
const data: FreeResult = { person: { id: 'anna', display_name: 'Anna', banner: null }, ideas: Array.from({ length: 7 }, (_, index) => ({
  wish_id: `wish-${index}`, title: `Wunsch ${index}`, url: null, price_cents: 1000, currency: 'EUR', priority: 2, created_at: '2026-10-20',
  list: { id: 'list', title: 'Bücher', kind: 'standalone', date: null, occasion_id: null },
  lists: [{ id: 'list', title: 'Bücher', kind: 'standalone', date: null, occasion_id: null }],
})) }
beforeEach(() => { vi.stubEnv('VITE_LISTS', '1'); setRenderedAccount('me'); api.getFreeWishes.mockResolvedValue(data) })
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); resetGiftSessionForTests(); resetAccountBoundaryForTests() })
function show(profileId = 'anna') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><LazyMotion features={domMax} strict><FreeWishes userId="me" profileId={profileId} name="Anna" maxCents={2500} /></LazyMotion></QueryClientProvider>)
}
it('shows at most five in server order and opens the chosen wish through memory, without a secret URL', async () => {
  show()
  await screen.findByRole('button', { name: 'Wunsch 0' })
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Wunsch 0›', 'Wunsch 1›', 'Wunsch 2›', 'Wunsch 3›', 'Wunsch 4›'])
  expect(api.getFreeWishes).toHaveBeenCalledWith('anna', 2500, 'me')
  fireEvent.click(screen.getByRole('button', { name: 'Wunsch 2' }))
  expect(api.navigate).toHaveBeenCalledWith({ to: '/lists/$listId', params: { listId: 'list' } })
  expect(takeOpenWish('list')).toBe('wish-2')
})
it('never asks for oneself or when the list flag is off', () => {
  const own = show('me')
  expect(api.getFreeWishes).not.toHaveBeenCalled()
  own.unmount()
  vi.stubEnv('VITE_LISTS', '')
  show()
  expect(api.getFreeWishes).not.toHaveBeenCalled()
})
it('a stale giver screen cannot leave an opening intent after the account changes', async () => {
  show()
  await screen.findByRole('button', { name: 'Wunsch 0' })
  act(() => { endAccountEpoch(); setRenderedAccount('anna') })
  fireEvent.click(screen.getByRole('button', { name: 'Wunsch 0' }))
  expect(api.navigate).not.toHaveBeenCalled()
  expect(takeOpenWish('list')).toBeNull()
})
it('preselects another person in tab memory, oneself selects For me, account end clears it', async () => {
  function Launch() { const find = useFindGiftFor(); return <><button onClick={() => find('anna')}>Anna</button><button onClick={() => find('me')}>Me</button></> }
  render(<Launch />)
  fireEvent.click(screen.getByText('Anna'))
  expect(lastPerson()).toBe('profile:anna')
  expect(lastMode()).toBe('for_someone')
  fireEvent.click(screen.getByText('Me'))
  expect(lastMode()).toBe('for_me')
  act(() => endAccountEpoch())
  await waitFor(() => expect(lastPerson()).toBeNull())
  expect(lastMode()).toBeNull()
})
it('the free-wishes display is mounted only in the giver mode; the existing gifts guard remains unchanged', () => {
  const sources = import.meta.glob<string>('../gifts/IdeasSection.tsx', { eager: true, query: '?raw', import: 'default' })
  expect(Object.values(sources)[0]).toMatch(/mode === 'for_someone' && profileId && profileId !== userId[\s\S]*?<FreeWishes/)
})
