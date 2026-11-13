import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { routeTree } from '../routeTree.gen'

// Impressum + Datenschutz are reachable from every screen (CLAUDE.md "Legal") — the route error view
// too. A route error (here: a malformed occasion id, e.g. a link cut short by a messenger) is caught by
// the ROOT route's error boundary, which replaces RootShell and with it the shell's footer; the error
// view therefore renders the legal footer itself (routes/__root.tsx RootError, integration 2026-10-20).
// Invented fixture account only.

const A = '00000000-0000-4000-8000-0000000000a1'

vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('no client in this test')),
  hasLocalSession: () => true,
  getLocalSession: () => Promise.resolve({ access_token: 'fixture-token', user: { id: A } } as Session),
  onClientReady: () => () => {},
}))
// the signed-in account has its legal records: the _authed guard lets the navigation through
vi.mock('../lib/consentGate', () => ({ hasCurrentConsents: () => Promise.resolve(true) }))

describe('route error view', () => {
  it('shows the error page together with the legal links', async () => {
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({ initialEntries: ['/occasions/not-a-uuid'] }),
    })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Da ist etwas schiefgelaufen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Nochmal versuchen' })).toBeTruthy()
    const legal = screen.getByRole('navigation', { name: 'Rechtliches' })
    expect(legal.closest('footer')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Impressum' }).getAttribute('href')).toBe('/legal/impressum')
    expect(screen.getByRole('link', { name: 'Datenschutz' }).getAttribute('href')).toBe('/legal/datenschutz')
    expect(screen.getByRole('link', { name: 'Nutzungsbedingungen' }).getAttribute('href')).toBe('/legal/nutzung')
  })
})
