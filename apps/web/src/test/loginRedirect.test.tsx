import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'

// /login with a live session (routes/login.tsx beforeLoad): walking back into the sign-up form from the
// first screen after signing up (e.g. "Zurück" on a just-joined occasion) shows the feed instead.

const auth = vi.hoisted(() => ({ session: null as unknown, broken: false }))
vi.mock('../lib/supabase', () => ({
  hasLocalSession: () => auth.session !== null || auth.broken,
  getLocalSession: () => (auth.broken ? Promise.reject(new Error('unreadable session')) : Promise.resolve(auth.session)),
  getSupabase: () => new Promise(() => {}), // no network in this test
  onClientReady: () => () => {},
}))
vi.mock('../lib/consentGate', () => ({ hasCurrentConsents: () => Promise.resolve(true) }))

import { routeTree } from '../routeTree.gen'

function open(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

describe('/login with a session', () => {
  it('a signed-in visitor goes to the feed, not back into the sign-up form', async () => {
    auth.session = { user: { id: 'account-a' } }
    auth.broken = false
    const router = open('/login?mode=signup&method=email&next=%2Fi')
    await waitFor(() => expect(router.state.location.pathname).toBe('/soon'))
    expect(screen.queryByRole('button', { name: 'Code schicken' })).toBeNull()
  })

  it('an unreadable stored session still gets the form', async () => {
    auth.session = null
    auth.broken = true
    const router = open('/login?mode=signup&method=email')
    expect(await screen.findByRole('heading', { level: 1, name: 'Konto erstellen' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/login')
  })
})
