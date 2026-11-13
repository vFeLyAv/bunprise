import { render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { routeTree } from '../routeTree.gen'
import { Route as RootRoute } from '../routes/__root'
import { legalFooterShown } from '../features/shell/LegalFooter'

// Legal links (pilot-decisions §00.2, Felix 2026-10-20): the footer Impressum · Datenschutz ·
// Nutzungsbedingungen + "Private Testversion · 18+" shows on every screen BEFORE sign-in (start, login,
// code, /auth/callback, the invite landing /i, the legal pages themselves) and on the sign-up step
// /welcome/profile — never on a signed-in screen (there it is the Profil tab's "Rechtliches" section,
// features/account/AccountPages.test.tsx). Name changes use a sheet inside /settings; /welcome/profile
// is only the sign-up step, even if an obsolete ?from=profile was bookmarked. Checked against the REAL route tree: a
// new signed-in route under _authed inherits "no footer" by itself.

const OCCASION = '0b7c8a1e-5555-4a5b-9c3d-000000000001'
const WISH = '0b7c8a1e-5555-4a5b-9c3d-000000000002'

function footerFor(path: string, search: Record<string, unknown> = {}): boolean {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() }, history: createMemoryHistory({ initialEntries: [path] }) })
  return legalFooterShown(router.matchRoutes(path, search))
}

describe('legal footer: before sign-in only', () => {
  it.each(['/', '/login', '/login/code', '/auth/callback', '/i', '/legal/impressum', '/legal/datenschutz', '/legal/nutzung', '/welcome/profile'])(
    'shows on %s',
    (path) => {
      expect(footerFor(path)).toBe(true)
    },
  )

  it.each([
    '/soon',
    '/calendar',
    '/lists',
    '/gifts',
    '/settings',
    '/settings/export',
    '/settings/delete',
    '/welcome',
    '/occasions/new',
    `/occasions/${OCCASION}`,
    `/occasions/${OCCASION}/edit`,
    `/occasions/${OCCASION}/wishes/new`,
    `/wishes/${WISH}/edit`,
  ])('is gone on the signed-in screen %s', (path) => {
    expect(footerFor(path)).toBe(false)
  })

  it('/welcome/profile stays the sign-up step; name changes belong to the footer-free profile sheet', () => {
    expect(footerFor('/welcome/profile', { next: '/soon' })).toBe(true)
    // a session that ran out on the profile and a new sign-up there: still the consent step
    expect(footerFor('/welcome/profile', { next: '/settings' })).toBe(true)
    expect(footerFor('/welcome/profile', { next: '/settings', from: 'profile' })).toBe(true)
    expect(footerFor('/welcome/profile', { from: 'profile' })).toBe(true)
    expect(footerFor('/settings')).toBe(false)
    // Unrecognized search is dropped by the route's validator: the footer stays.
    expect(footerFor('/welcome/profile', { from: 'somewhere' })).toBe(true)
  })

  it('the deepest route that says so decides; without a word the footer shows', () => {
    expect(legalFooterShown([])).toBe(true)
    expect(legalFooterShown([{ staticData: {} }, { staticData: { legalFooter: false } }])).toBe(false)
    expect(legalFooterShown([{ staticData: { legalFooter: false } }, { staticData: { legalFooter: true } }])).toBe(true)
    expect(legalFooterShown([{ staticData: { legalFooter: false } }, { staticData: {} }])).toBe(false)
    // a route may decide by its own search
    const bySearch = (search: Record<string, unknown>) => search.from !== 'profile'
    expect(legalFooterShown([{ staticData: { legalFooter: false } }, { staticData: { legalFooter: bySearch }, search: { from: 'profile' } }])).toBe(false)
    expect(legalFooterShown([{ staticData: { legalFooter: false } }, { staticData: { legalFooter: bySearch }, search: {} }])).toBe(true)
    expect(legalFooterShown([{ staticData: { legalFooter: bySearch } }])).toBe(true)
  })

  it('the real root shell renders it for a screen before sign-in and leaves it out for a signed-in one', async () => {
    const shell = RootRoute.options.component!
    const root = createRootRoute({ component: shell })
    const authed = createRoute({ getParentRoute: () => root, id: '_authed', staticData: { legalFooter: false }, component: () => <Outlet /> })
    const tree = root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/login', component: () => <main>Anmelden</main> }),
      authed.addChildren([createRoute({ getParentRoute: () => authed, path: '/soon', component: () => <main>Bald</main> })]),
    ])
    const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: ['/login'] }) })
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('Anmelden')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Impressum' }).getAttribute('href')).toBe('/legal/impressum')
    expect(screen.getByText('Private Testversion · nur für Erwachsene (18+)')).toBeTruthy()
    await router.navigate({ to: '/soon' })
    expect(await screen.findByText('Bald')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Impressum' })).toBeNull()
    expect(screen.queryByText('Private Testversion · nur für Erwachsene (18+)')).toBeNull()
    expect(document.querySelector('footer')).toBeNull()
  })
})
