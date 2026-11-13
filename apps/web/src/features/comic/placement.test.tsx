import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen, Me } from '../../lib/api/types'
import { markHintSeen, resetHintSession } from '../../lib/hints'
import { feedRow, me, USER } from '../nav/test-utils'
import { resetComicState } from './store'
vi.mock('../lists/firstWish', () => ({ useStartFirstWish: () => vi.fn() }))
vi.mock('../people/linkSheetHost', () => ({ FollowLinkSheetHost: () => null, openFollowLinkSheet: vi.fn() }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))
import FirstSteps from '../feed/FirstSteps'

// Where the comic card sits on Start (docs/design/2026-10-26-manga-episode-1.md): under the upcoming occasions — never
// above the nearest one — or under the empty state; never together with «Erste Schritte».

const TITLE = 'Wie haben sich Pompon und Tapsi kennengelernt?'

function mount(profile: Me, data: FeedScreen) {
  const client = new QueryClient()
  client.setQueryData(['me'], profile)
  // the birthday suggestion has decided (nothing to suggest): the comic card may follow
  client.setQueryData(['anniversaries', USER], [])
  const root = createRootRoute({ component: Outlet })
  const route = createRoute({ getParentRoute: () => root, path: '/soon', component: () => (
    <FirstSteps userId={USER} data={data}>{(visible) => <section aria-label="Heute"><h2>{visible ? 'sections + card' : 'sections'}</h2></section>}</FirstSteps>
  ) })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/soon'] }) })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
const daysBefore = (days: number) => new Date(performance.timeOrigin - days * 86400000).toISOString()

beforeEach(() => {
  localStorage.clear()
  resetHintSession()
  resetComicState()
  vi.stubEnv('VITE_LISTS', '1')
  vi.stubEnv('VITE_DEMO', '0')
})
afterEach(() => vi.unstubAllEnvs())

describe('the comic card in the Start list', () => {
  it('«Erste Schritte» over (its 14 days passed): the card comes under the occasions', async () => {
    const profile = me(USER, 'Mila')
    profile.profile.onboarding_done_at = daysBefore(20)
    mount(profile, { upcoming: [feedRow('o1', 'Fest', 'member', daysBefore(-2))], past: [] })
    const card = await screen.findByRole('heading', { name: TITLE })
    const sections = screen.getByRole('heading', { name: 'sections' })
    // the card follows the occasions in the document (never above the nearest one)
    expect(sections.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.closest('[data-comic-slot]')?.className).toBe('mt-8')
  })

  it('never together with «Erste Schritte»', async () => {
    const profile = me(USER, 'Mila')
    profile.profile.onboarding_done_at = daysBefore(2)
    mount(profile, { upcoming: [], past: [] })
    expect(await screen.findByRole('heading', { name: 'Erste Schritte' })).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
  })

  it('closed or opened before on this device: its chunk is not even loaded', async () => {
    markHintSeen('story-1')
    const profile = me(USER, 'Mila')
    profile.profile.onboarding_done_at = daysBefore(20)
    mount(profile, { upcoming: [], past: [] })
    await screen.findByRole('heading', { name: 'sections' })
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
    expect(document.querySelector('[data-comic-slot]')).toBeNull()
  })
})
