import { render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routeTree } from '../../routeTree.gen'
import { getPendingInvite, setPendingInvite } from '../invite/pending'
import { getPendingFollow, setPendingFollow } from '../people/pendingFollow'
import { carriedLink } from './carryLink'

// Signing in for a link carries its code in the address's fragment (add-friends-design §1.2): Felix's bug was
// "Open in browser" from Telegram's in-app browser arriving as "Dieser Link funktioniert nicht" — and the sign-in
// screens are exactly where people leave for another browser (Google refuses in-app browsers).

const session = vi.hoisted(() => ({ value: null as null | { user: { id: string } } }))
vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/supabase')>()),
  getLocalSession: () => Promise.resolve(session.value),
}))

const FOLLOW = '7e'.repeat(32)
const INVITE = '9f'.repeat(32)

function open(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  sessionStorage.clear()
  session.value = null
  vi.stubEnv('VITE_LISTS', '1')
})
afterEach(() => vi.unstubAllEnvs())

describe('carriedLink', () => {
  it('only for a link destination; the tab\'s waiting code is what the address should show', () => {
    expect(carriedLink('/soon', `#${FOLLOW}`)).toBeNull()
    expect(carriedLink(undefined, '')).toBeNull()
    expect(carriedLink('/f', '')).toBeNull() // nothing waits
    setPendingFollow(FOLLOW)
    expect(carriedLink('/f', '')).toEqual({ path: '/f', code: FOLLOW })
    setPendingInvite(INVITE)
    expect(carriedLink('/i?x=1', '')).toEqual({ path: '/i', code: INVITE })
  })

  it('a code in the address that this tab does not know (another browser) becomes its waiting code', () => {
    expect(carriedLink('/f', `#${FOLLOW}`)).toEqual({ path: '/f', code: FOLLOW })
    expect(getPendingFollow()).toBe(FOLLOW)
    expect(carriedLink('/i', INVITE)).toEqual({ path: '/i', code: INVITE })
    expect(getPendingInvite()).toBe(INVITE)
  })

  it('garbage in the address never replaces or drops a waiting code', () => {
    setPendingFollow(FOLLOW)
    expect(carriedLink('/f', '#error=access_denied')).toEqual({ path: '/f', code: FOLLOW })
    sessionStorage.clear()
    expect(carriedLink('/f', '#error=access_denied')).toBeNull()
    expect(getPendingFollow()).toBeNull()
  })

  it('the flag off: a follow code is not carried', () => {
    vi.stubEnv('VITE_LISTS', '')
    expect(carriedLink('/f', `#${FOLLOW}`)).toBeNull()
    expect(getPendingFollow()).toBeNull()
  })
})

describe('the sign-in routes', () => {
  it('/login for a waiting link shows its code in the fragment — never in the query', async () => {
    setPendingFollow(FOLLOW)
    const router = open('/login?mode=signup&next=%2Ff')
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.href.endsWith(`#${FOLLOW}`)).toBe(true)
    expect(router.state.location.searchStr).not.toContain(FOLLOW)
  })

  it('"Open in browser" from /login: a new browser (empty tab) picks the code up from the address', async () => {
    const router = open(`/login?mode=signup&next=%2Ff#${FOLLOW}`)
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(getPendingFollow()).toBe(FOLLOW)
    expect(router.state.location.href.endsWith(`#${FOLLOW}`)).toBe(true)
  })

  it('from /login/code without an e-mail attempt in this browser: back to /login, the code goes along', async () => {
    const router = open(`/login/code?mode=signup&next=%2Fi#${INVITE}`)
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/login')
    expect(getPendingInvite()).toBe(INVITE)
    expect(router.state.location.href.endsWith(`#${INVITE}`)).toBe(true)
  })

  it('a browser that is signed in already goes straight to the link\'s screen, with its code', async () => {
    session.value = { user: { id: 'u1' } }
    const router = open(`/login?mode=signin&next=%2Fi#${INVITE}`)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/i'))
    expect(router.state.location.href).toBe(`/i#${INVITE}`)
    expect(getPendingInvite()).toBe(INVITE)
  })

  it('signed in, nothing waiting: the feed as before', async () => {
    session.value = { user: { id: 'u1' } }
    const router = open('/login?mode=signin&next=%2Ff')
    await vi.waitFor(() => expect(router.state.location.pathname).not.toBe('/login'))
    expect(router.state.location.pathname).not.toBe('/f')
  })
})
