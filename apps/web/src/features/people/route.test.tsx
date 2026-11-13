import { act, render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter, isRedirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routeTree } from '../../routeTree.gen'
import { legalFooterShown } from '../shell/LegalFooter'
import headers from '../../../public/_headers?raw'
import { getPendingFollow, setPendingFollow } from './pendingFollow'

// The real /f route (routes/f.tsx, W04): the fragment code is taken into this tab's sessionStorage before anything
// renders and STAYS in the address until it is used (add-friends-design §1: Telegram's "Open in browser" takes the
// address — a clean /f arrived there as "Dieser Link funktioniert nicht"); signed out the page is impersonal (no name, no RPC — the Supabase client
// is never even loaded); the flag off (§00 p. 9) → a calm "Bald verfügbar", the code is not kept; /people* → Start.

const supabase = vi.hoisted(() => ({ loaded: 0 }))
vi.mock('../../lib/supabaseClient', () => {
  supabase.loaded += 1
  return {}
})

function open(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

const VALID = '7e'.repeat(32)

beforeEach(() => {
  sessionStorage.clear()
  vi.stubEnv('VITE_LISTS', '1')
})
afterEach(() => vi.unstubAllEnvs())

describe('/f route', () => {
  it('signed out: the code goes to sessionStorage and stays in the address; the page names nobody and asks nobody', async () => {
    const router = open(`/f#${VALID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Jemand möchte Wunschlisten mit dir teilen.' })).toBeTruthy()
    expect(getPendingFollow()).toBe(VALID)
    // "Open in browser" takes this address: the code must be in it
    expect(router.state.location.href).toBe(`/f#${VALID}`)
    const signUp = screen.getByRole('link', { name: 'Konto erstellen' }).getAttribute('href') ?? ''
    expect(signUp).toContain('next=%2Ff')
    expect(signUp).not.toContain(VALID) // never in a query: that reaches the server
    expect(screen.getByRole('link', { name: 'Anmelden' })).toBeTruthy()
    expect(supabase.loaded).toBe(0) // no client, no anonymous RPC
    expect(legalFooterShown(router.state.matches)).toBe(true)
  })

  it('a malformed code is not kept: the invalid message (errors.invite_invalid) right away', async () => {
    setPendingFollow('0a'.repeat(32))
    const router = open('/f#7e7e-cut-off-in-a-chat')
    expect(await screen.findByRole('heading', { level: 1, name: 'Dieser Link funktioniert nicht' })).toBeTruthy()
    expect(screen.getByText('Dieser Link ist ungültig oder abgelaufen. Frag nach einem neuen.')).toBeTruthy()
    expect(getPendingFollow()).toBeNull()
    expect(router.state.location.href).toBe('/f')
  })

  it('a clean /f while a code waits in this tab (back from signing in) shows it in the address again', async () => {
    setPendingFollow(VALID)
    const router = open('/f')
    expect(await screen.findByRole('heading', { level: 1, name: 'Jemand möchte Wunschlisten mit dir teilen.' })).toBeTruthy()
    expect(router.state.location.href).toBe(`/f#${VALID}`)
  })

  it('a friend code (the QR of "Mein Code") is kept like a link code and stays in the address', async () => {
    const router = open('/f#K7M4QX2P')
    expect(await screen.findByRole('heading', { level: 1, name: 'Jemand möchte Wunschlisten mit dir teilen.' })).toBeTruthy()
    expect(getPendingFollow()).toBe('K7M4QX2P')
    expect(router.state.location.href).toBe('/f#K7M4QX2P')
  })

  it('the newest link wins; another link while the page is shown re-evaluates it', async () => {
    setPendingFollow('0a'.repeat(32))
    const router = open(`/f#${VALID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Jemand möchte Wunschlisten mit dir teilen.' })).toBeTruthy()
    expect(getPendingFollow()).toBe(VALID)
    await act(() => router.navigate({ href: '/f#bad' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dieser Link funktioniert nicht' })).toBeTruthy()
    expect(getPendingFollow()).toBeNull()
  })

  it('the flag off: "Bald verfügbar", the code is dropped, the URL is clean, no RPC', async () => {
    vi.stubEnv('VITE_LISTS', '')
    setPendingFollow('0a'.repeat(32))
    const router = open(`/f#${VALID}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Bald verfügbar' })).toBeTruthy()
    expect(getPendingFollow()).toBeNull()
    expect(router.state.location.href).toBe('/f')
    expect(supabase.loaded).toBe(0)
  })
})

describe('/people* without the flag: back to Start', () => {
  it('both routes redirect before any request', async () => {
    vi.stubEnv('VITE_LISTS', '')
    const people = (await import('../../routes/_authed/people')).Route
    const person = (await import('../../routes/_authed/people_.$profileId')).Route
    for (const route of [people, person]) {
      const beforeLoad = route.options.beforeLoad as unknown as () => void
      let thrown: unknown
      try {
        beforeLoad()
      } catch (error) {
        thrown = error
      }
      expect(isRedirect(thrown)).toBe(true)
      expect((thrown as { options: { to: string } }).options.to).toBe('/soon')
    }
    vi.stubEnv('VITE_LISTS', '1')
    expect(() => (people.options.beforeLoad as unknown as () => void)()).not.toThrow()
  })
})

describe('public/_headers: /f* like /i (W04)', () => {
  function block(path: string): string[] {
    const lines = headers.split(/\r?\n/)
    const start = lines.findIndex((line) => line.trim() === path && !line.startsWith(' '))
    if (start === -1) return []
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => line.trim() !== '' && !line.startsWith(' '))
    return (end === -1 ? rest : rest.slice(0, end)).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  }

  it('never indexed, never a Referer', () => {
    for (const path of ['/f', '/f/*']) expect(block(path)).toEqual(['X-Robots-Tag: noindex', 'Referrer-Policy: no-referrer'])
  })
})
