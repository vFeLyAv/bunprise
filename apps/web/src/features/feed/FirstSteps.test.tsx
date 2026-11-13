import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedScreen, Me } from '../../lib/api/types'
import { hasSeenHint } from '../../lib/hints'
import { feedRow, me, USER } from '../nav/test-utils'
const actions = vi.hoisted(() => ({ wish: vi.fn(), link: vi.fn() }))
vi.mock('../lists/firstWish', () => ({ useStartFirstWish: () => actions.wish }))
vi.mock('../people/linkSheetHost', () => ({ FollowLinkSheetHost: () => null, openFollowLinkSheet: actions.link }))
vi.mock('../mascot-ui/BunnyMoment', () => ({ BunnyMoment: () => null }))
import FirstSteps from './FirstSteps'

function mount(profile: Me = me(USER, 'Mila'), data: FeedScreen = { upcoming: [], past: [] }) {
  const client = new QueryClient()
  client.setQueryData(['me'], profile)
  const root = createRootRoute({ component: Outlet })
  const route = createRoute({ getParentRoute: () => root, path: '/soon', component: () => <>
    <FirstSteps userId={USER} data={data}>{(visible) => <p>{visible ? 'card-on' : 'card-off'}</p>}</FirstSteps>
    <h2>Danach</h2>
  </> })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/soon'] }) })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return client
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T08:00:00Z')); localStorage.clear(); vi.stubEnv('VITE_LISTS', '1'); vi.stubEnv('VITE_DEMO', '0'); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('first steps: cached onboarding and completed actions', () => {
  it('uses cached get_me, shows the empty hint and opens the existing actions', async () => {
    const client = mount()
    expect(await screen.findByRole('heading', { name: 'Womit fangen wir an?' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Eigenen Anlass anlegen' }).getAttribute('href')).toBe('/occasions/new')
    fireEvent.click(screen.getByRole('button', { name: 'Ersten Wunsch notieren' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deinen Folgen-Link teilen' }))
    expect(actions.wish).toHaveBeenCalledOnce(); expect(actions.link).toHaveBeenCalledOnce()
    expect(client.isFetching()).toBe(0)
  })
  it.each(['another account', 'older than fourteen days', 'future date'])('does not show for %s', async (kind) => {
    const profile = me(kind === 'another account' ? 'other' : USER, 'Mila')
    if (kind === 'older than fourteen days') profile.profile.onboarding_done_at = '2026-10-07T08:00:00Z'
    if (kind === 'future date') profile.profile.onboarding_done_at = '2026-10-22T08:00:00Z'
    mount(profile)
    expect(await screen.findByText('card-off')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Erste Schritte' })).toBeNull()
  })
  it('dismisses permanently on this device and moves focus to the next heading', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Erste Schritte ausblenden' }))
    expect(hasSeenHint('first-steps')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Danach' }))
    expect(screen.queryByRole('heading', { name: 'Erste Schritte' })).toBeNull()
  })
  it('hides completed steps when the same-account list cache changes, without requesting it', async () => {
    const host = feedRow('occasion', 'Fest', 'host', '2026-10-25T18:00:00Z')
    host.wish_count = 0
    const client = mount(me(USER, 'Mila'), { upcoming: [host], past: [] })
    await screen.findByRole('heading', { name: 'Erste Schritte' })
    expect(screen.queryByRole('link', { name: 'Eigenen Anlass anlegen' })).toBeNull()
    act(() => client.setQueryData(['lists'], { me: { id: USER, live_links: 1 }, stats: { my_wishes: 2 } }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Erste Schritte' })).toBeNull())
    expect(client.isFetching()).toBe(0)
  })
  it('keeps the peeking bunny\'s room free above the card (and over the feed cards); none under "Weniger"', async () => {
    mount()
    const card = (await screen.findByRole('heading', { name: 'Erste Schritte' })).closest('section')
    expect(card?.className).toMatch(/\bmt-24\b/)
    expect(card?.className).toMatch(/\bz-2\b/)
    act(() => { document.documentElement.dataset.motion = 'reduce' })
    await waitFor(() => expect(card?.className).toMatch(/\bmy-6\b/))
    expect(card?.hasAttribute('data-peek')).toBe(false)
    delete document.documentElement.dataset.motion
  })
  it('with lists off, exposes only an own occasion wish form and no follow action', async () => {
    vi.stubEnv('VITE_LISTS', '0')
    const host = feedRow('occasion', 'Fest', 'host', '2026-10-25T18:00:00Z'); host.wish_count = 0
    mount(me(USER, 'Mila'), { upcoming: [host], past: [] })
    expect((await screen.findByRole('link', { name: 'Ersten Wunsch notieren' })).getAttribute('href')).toBe('/occasions/occasion/wishes/new')
    expect(screen.queryByRole('button', { name: 'Deinen Folgen-Link teilen' })).toBeNull()
  })
})
