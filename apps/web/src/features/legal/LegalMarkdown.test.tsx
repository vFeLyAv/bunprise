import '../../ui/test-shims-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { LegalMarkdown } from './LegalMarkdown'

afterEach(cleanup)

function renderWithRouter(text: string) {
  const root = createRootRoute({ component: () => <Outlet /> })
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => <LegalMarkdown text={text} /> })
  const privacy = createRoute({ getParentRoute: () => root, path: '/legal/datenschutz', component: () => <p>Privacy destination</p> })
  const router = createRouter({ routeTree: root.addChildren([index, privacy]), history: createMemoryHistory({ initialEntries: ['/'] }) })
  render(<RouterProvider router={router} />)
  return router
}

describe('legal text renderer', () => {
  it('renders placeholders and HTML-looking input as visible text without injecting elements', () => {
    const { container } = render(<LegalMarkdown text={'# Draft\n\n<VORNAME NACHNAME>\n<E-MAIL>\n<script>alert(1)</script>'} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Draft')
    expect(container.textContent).toContain('<VORNAME NACHNAME>')
    expect(container.textContent).toContain('<E-MAIL>')
    expect(container.querySelector('script')).toBeNull()
  })

  it('keeps legal links usable but never creates a link with an unsafe target', async () => {
    renderWithRouter('[Privacy](/legal/datenschutz?version=v1&lang=de)\n\n[DPA](https://supabase.com/legal/dpa)\n\n[Unsafe](javascript:alert)\n\n[Outside](//outside.example)')
    expect((await screen.findByRole('link', { name: 'Privacy' })).getAttribute('href')).toBe('/legal/datenschutz?version=v1&lang=de')
    expect(screen.getByRole('link', { name: 'DPA' }).getAttribute('href')).toBe('https://supabase.com/legal/dpa')
    expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Outside' })).toBeNull()
  })

  it('turns a contact address into a mail link that is never hyphenated, and leaves the sentence around it', () => {
    const { container } = render(<LegalMarkdown text={'Hinweise an hello@bunprise.de senden.\n\nE-Mail: <E-MAIL>'} />)
    const link = screen.getByRole('link', { name: 'hello@bunprise.de' })
    expect(link.getAttribute('href')).toBe('mailto:hello@bunprise.de')
    expect(link.className).toContain('hyphens-none')
    expect(link.querySelector('wbr')).not.toBeNull()
    expect(container.textContent).toContain('Hinweise an hello@bunprise.de senden.')
    expect(container.textContent).toContain('<E-MAIL>')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('navigates internal legal links in the SPA while preserving version parameters', async () => {
    const router = renderWithRouter('[Privacy](/legal/datenschutz?version=v1&lang=de)')
    fireEvent.click(await screen.findByRole('link', { name: 'Privacy' }))
    await screen.findByText('Privacy destination')
    expect(router.state.location.pathname).toBe('/legal/datenschutz')
    expect(router.state.location.search).toEqual({ version: 'v1', lang: 'de' })
  })

  it('leaves modified clicks to the browser instead of intercepting them', async () => {
    const router = renderWithRouter('[Privacy](/legal/datenschutz?version=v1&lang=de)')
    const link = await screen.findByRole('link', { name: 'Privacy' })
    let intercepted = true
    window.addEventListener('click', (event) => {
      intercepted = event.defaultPrevented
      event.preventDefault() // Suppress jsdom's native navigation after observing the router handler.
    }, { once: true })
    fireEvent.click(link, { ctrlKey: true })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(intercepted).toBe(false)
  })
})
