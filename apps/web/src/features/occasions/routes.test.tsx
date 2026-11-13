import { screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../lib/errors'
import { routeTree } from '../../routeTree.gen'
import { GUEST_ID, HOST_ID, guestScreen, hostScreen, makeQueryClient, OCCASION_ID, renderWithClient } from './test-utils'

// Route wiring of the occasion screens: guard → loader (one prefetch, namespaces) → page.

const session = vi.hoisted(() => ({ userId: '22222222-2222-4222-8222-222222222222' }))
const api = vi.hoisted(() => ({
  getOccasionScreen: vi.fn(),
  getFeed: vi.fn(),
  createOccasion: vi.fn(),
  updateOccasion: vi.fn(),
  deleteOccasion: vi.fn(),
  leaveOccasion: vi.fn(),
  removeMember: vi.fn(),
  setRsvp: vi.fn(),
  newOccasionId: vi.fn(),
  setOccasionAddress: vi.fn(),
  getOccasionAddress: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('no client in tests')),
  hasLocalSession: () => true,
  getLocalSession: () => Promise.resolve({ user: { id: session.userId } }),
  onClientReady: () => () => {},
}))
vi.mock('../../lib/consentGate', () => ({ hasCurrentConsents: () => Promise.resolve(true) }))
vi.mock('../../lib/api/occasions', () => api)
vi.mock('../mascot-ui/Mascot', () => ({ Mascot: () => null, preloadMascot: () => {}, loadMascotModule: () => Promise.resolve() }))
vi.mock('../wishes/WishlistSection', () => ({ WishlistSection: ({ viewer }: { viewer: string }) => <div data-testid="wishlist" data-viewer={viewer} /> }))

function renderAt(path: string) {
  const queryClient = makeQueryClient()
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: [path] }) })
  renderWithClient(<RouterProvider router={router} />, queryClient)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  session.userId = HOST_ID
})

describe('occasion routes', () => {
  it('/occasions/$id: the loader starts the one RPC and the page shows the host view', async () => {
    api.getOccasionScreen.mockResolvedValue(hostScreen())
    renderAt(`/occasions/${OCCASION_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Milas Gartenfest' })).toBeTruthy()
    // the wishlist follows the screen's top in a deferred render
    expect((await screen.findByTestId('wishlist')).getAttribute('data-viewer')).toBe('owner')
    // the host's ways to invite: on top of "Wer kommt" (27.10)
    expect(await screen.findByRole('group', { name: 'Einladen' })).toBeTruthy()
    // loader fetch + mount did not ask twice
    expect(api.getOccasionScreen).toHaveBeenCalledTimes(1)
    expect(api.getOccasionScreen).toHaveBeenCalledWith(OCCASION_ID)
  })

  it('/occasions/$id: a guest gets the guest view from the same route', async () => {
    session.userId = GUEST_ID
    api.getOccasionScreen.mockResolvedValue(guestScreen())
    renderAt(`/occasions/${OCCASION_ID}`)
    expect(await screen.findByRole('radiogroup', { name: 'Deine Antwort' })).toBeTruthy()
    expect((await screen.findByTestId('wishlist')).getAttribute('data-viewer')).toBe('guest')
  })

  it('/occasions/$id: "no access" lands on the friendly page, not on an error screen', async () => {
    api.getOccasionScreen.mockRejectedValue(new AppError('not_found'))
    renderAt(`/occasions/${OCCASION_ID}`)
    expect(await screen.findByRole('heading', { name: 'Anlass nicht gefunden oder kein Zugriff' })).toBeTruthy()
  })

  it('/occasions/new renders the form without loading any occasion', async () => {
    const router = renderAt('/occasions/new')
    expect(await screen.findByRole('heading', { level: 1, name: 'Neuer Anlass' })).toBeTruthy()
    expect(screen.getByLabelText('Titel')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/occasions/new')
    expect(api.getOccasionScreen).not.toHaveBeenCalled()
  })

  it('/occasions/$id/edit prefills the form for the host', async () => {
    api.getOccasionScreen.mockResolvedValue(hostScreen())
    renderAt(`/occasions/${OCCASION_ID}/edit`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Anlass bearbeiten' })).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Milas Gartenfest'))
    expect(api.getOccasionScreen).toHaveBeenCalledTimes(1)
  })
})
