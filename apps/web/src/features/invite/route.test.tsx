import { act, render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { routeTree } from '../../routeTree.gen'
import { getPendingInvite, setPendingInvite } from './pending'

// The real /i route (routes/i.tsx): the fragment token is taken into this tab's sessionStorage and STAYS in the
// address until the person joins (add-friends-design §1: "Open in browser" of Telegram's in-app browser takes the
// address); a malformed one leaves it at once. No session here.

function open(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

const VALID = '9f'.repeat(32)

beforeEach(() => sessionStorage.clear())

describe('/i route', () => {
  it('a malformed link token is not kept: the invalid-link message right away, clean URL', async () => {
    const router = open('/i#9f9f-cut-off-in-a-chat')
    expect(await screen.findByRole('heading', { level: 1, name: 'Dieser Link ist ungültig oder abgelaufen' })).toBeTruthy()
    expect(getPendingInvite()).toBeNull()
    expect(router.state.location.pathname).toBe('/i')
    expect(router.state.location.hash).toBe('')
    expect(screen.queryByRole('link', { name: 'Konto erstellen' })).toBeNull()
  })

  it('the newest opened link replaces an older one from the same tab', async () => {
    setPendingInvite('0a'.repeat(32))
    const router = open(`/i#${VALID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Einladung' })).toBeTruthy()
    expect(getPendingInvite()).toBe(VALID)
    expect(router.state.location.href).toBe(`/i#${VALID}`)
    // the sign-in link never carries the token in its query (a query reaches the server)
    expect(screen.getByRole('link', { name: 'Konto erstellen' }).getAttribute('href')).not.toContain(VALID)
  })

  it('a clean /i while a token waits in this tab (back from signing in) shows it in the address again', async () => {
    setPendingInvite(VALID)
    const router = open('/i')
    expect(await screen.findByRole('heading', { level: 1, name: 'Einladung' })).toBeTruthy()
    expect(router.state.location.href).toBe(`/i#${VALID}`)
  })

  it('another link opened while the landing is shown re-evaluates the view (same route, new entry)', async () => {
    const router = open(`/i#${VALID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Einladung' })).toBeTruthy()
    await act(() => router.navigate({ href: '/i#9f9f-cut-off-in-a-chat' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dieser Link ist ungültig oder abgelaufen' })).toBeTruthy()
    expect(getPendingInvite()).toBeNull()
    expect(router.state.location.href).toBe('/i')
  })
})
