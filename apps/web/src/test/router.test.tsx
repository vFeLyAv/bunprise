import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from '../routeTree.gen'
import { getPendingInvite } from '../features/invite/pending'

function makeRouter(path: string) {
  return createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

describe('router smoke', () => {
  it('renders email registration with required checkboxes and public legal links', async () => {
    render(<RouterProvider router={makeRouter('/login?mode=signup&method=email')} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Konto erstellen' })).toBeTruthy()
    expect(screen.getByLabelText('E-Mail')).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Code schicken' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('In Arbeit – dieser Bildschirm kommt bald.')).toBeNull()
    expect(screen.getByRole('link', { name: 'Impressum' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Datenschutz' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Nutzungsbedingungen' })).toBeTruthy()
  })

  it('lets an existing account request an email code without repeating signup declarations', async () => {
    render(<RouterProvider router={makeRouter('/login?mode=signin&method=email')} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Anmelden' })).toBeTruthy()
    expect(screen.getByLabelText('E-Mail')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Code schicken' })).toBeTruthy()
  })

  it('sends a visitor without a session from /soon to /login?next=/soon', async () => {
    const router = makeRouter('/soon')
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Anmelden' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toMatchObject({ next: '/soon' })
  })

  it('/i#<token> keeps the token in sessionStorage and in the address until it is used (add-friends-design §1)', async () => {
    const token = 'f'.repeat(64)
    const router = makeRouter(`/i#${token}`)
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Einladung' })).toBeTruthy()
    // the impersonal landing says "adults only" exactly once: in the legal footer of the shell
    expect(screen.getAllByText('Private Testversion · nur für Erwachsene (18+)')).toHaveLength(1)
    expect(getPendingInvite()).toBe(token)
    expect(router.state.location.pathname).toBe('/i')
    expect(router.state.location.href).toBe(`/i#${token}`)
  })
})
