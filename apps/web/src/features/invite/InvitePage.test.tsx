import type { Ref } from 'react'
import type { Session } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from '@tanstack/react-router'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../lib/api/types'
import { AppError } from '../../lib/errors'
import { qk } from '../../lib/queryKeys'

const api = vi.hoisted(() => ({
  hasLocalSession: vi.fn<() => boolean>(),
  getLocalSession: vi.fn<() => Promise<Session | null>>(),
  getMe: vi.fn<() => Promise<Me>>(),
  acceptInvite: vi.fn<(token: string, expectedUserId?: string) => Promise<string>>(),
  play: vi.fn<(scene: string) => Promise<void>>(),
}))
vi.mock('../../lib/supabase', () => ({
  hasLocalSession: api.hasLocalSession,
  getLocalSession: api.getLocalSession,
  getSupabase: () => Promise.reject(new Error('the Supabase client is never loaded in these tests')),
  onClientReady: () => () => {},
}))
vi.mock('../../lib/api/profile', () => ({ getMe: api.getMe }))
vi.mock('../../lib/api/invites', () => ({ acceptInvite: api.acceptInvite }))
// The puppet and the welcome stage are tested in features/mascot-ui; here only which moment is requested.
vi.mock('../mascot-ui/WelcomeBunnies', () => ({
  default: (props: { choreography: string }) => <div data-testid="welcome-bunnies" data-choreography={props.choreography} />,
}))
vi.mock('../mascot-ui/Mascot', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    Mascot: (props: { kind: string; scene?: string; ref?: Ref<unknown> }) => {
      useImperativeHandle(props.ref, () => ({ play: api.play, tap: () => {}, instance: null }))
      return <div data-testid="mascot" data-kind={props.kind} data-scene={props.scene ?? ''} />
    },
  }
})

import { InvitePage } from './InvitePage'
import { getPendingInvite, setPendingInvite } from './pending'

// Invented fixtures only (no real people). The token has the shape create_invite() returns.
const TOKEN = '6a'.repeat(32)
const OCCASION_ID = 'c0ffee00-0000-4000-8000-000000000001'
const SESSION = { user: { id: 'f1c7e000-0000-4000-8000-0000000000aa' } } as Session

function me({ display_name = 'Mila Fixture', consents_ok = true }: { display_name?: string | null; consents_ok?: boolean } = {}): Me {
  return {
    profile: { id: SESSION.user.id, display_name, locale: 'de', onboarding_done_at: null },
    consents_ok,
    legal_versions: { terms: 'terms-v', privacy: 'privacy-v', age: 'age-v' },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function OccasionStub() {
  const params = useParams({ strict: false })
  return <p>occasion {params.occasionId}</p>
}

function renderInvite() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const page = (text: string) => () => <p>{text}</p>
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/i', component: InvitePage }),
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: page('start page') }),
    createRoute({ getParentRoute: () => rootRoute, path: '/login', component: page('login page') }),
    createRoute({ getParentRoute: () => rootRoute, path: '/welcome/profile', component: page('profile page') }),
    createRoute({ getParentRoute: () => rootRoute, path: '/soon', component: page('feed page') }),
    createRoute({ getParentRoute: () => rootRoute, path: '/occasions/$occasionId', component: OccasionStub }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/i'] }) })
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax} strict>
        <RouterProvider router={router} />
      </LazyMotion>
    </QueryClientProvider>,
  )
  return { router, queryClient, unmount }
}

/** Signed in, name and current legal records present: the explicit "Beitreten" screen. */
async function renderReady(profile = me()) {
  setPendingInvite(TOKEN)
  api.hasLocalSession.mockReturnValue(true)
  api.getLocalSession.mockResolvedValue(SESSION)
  api.getMe.mockResolvedValue(profile)
  const view = renderInvite()
  await screen.findByRole('heading', { level: 1, name: 'Möchtest du beitreten?' })
  return view
}

const joinButton = () => screen.getByRole('button', { name: 'Beitreten' })

async function invalidMessage(): Promise<string> {
  await screen.findByRole('heading', { level: 1, name: 'Dieser Link ist ungültig oder abgelaufen' })
  return screen.getByRole('alert').textContent ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  api.hasLocalSession.mockReturnValue(false)
  api.getLocalSession.mockResolvedValue(null)
  api.play.mockResolvedValue(undefined)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => vi.restoreAllMocks())

describe('invite /i — (a) no usable link', () => {
  it('shows one message and a way to the start page when the tab holds no link', async () => {
    renderInvite()
    expect(await invalidMessage()).toContain('Frag die Person, die dich eingeladen hat, nach einem neuen Link.')
    const start = screen.getByRole('link', { name: 'Zum Start' })
    expect(start.getAttribute('href')).toBe('/')
    expect(api.getLocalSession).not.toHaveBeenCalled()
    expect(api.acceptInvite).not.toHaveBeenCalled()
  })

  it('says exactly the same for a link the server rejects (unknown / expired / revoked / used up)', async () => {
    const first = renderInvite()
    const missing = await invalidMessage()
    first.unmount()

    await renderReady()
    api.acceptInvite.mockRejectedValueOnce(new AppError('invite_invalid'))
    fireEvent.click(joinButton())
    expect(await invalidMessage()).toBe(missing)
    expect(getPendingInvite()).toBeNull() // a dead link is not kept
    expect(screen.queryByText(/Mila Fixture/)).toBeNull()
  })
})

describe('invite /i — (b) link kept, nobody signed in', () => {
  it('is impersonal and offers explicit sign-up / sign-in that come back to /i', async () => {
    setPendingInvite(TOKEN)
    renderInvite()
    expect(await screen.findByRole('heading', { level: 1, name: 'Einladung' })).toBeTruthy()
    expect(screen.getByText('Du bist zu einem Anlass eingeladen')).toBeTruthy()
    // "Private Testversion · nur für Erwachsene (18+)" is the shell footer's line (router.test.tsx),
    // the landing does not repeat it
    expect(screen.queryByText('Private Testversion · nur für Erwachsene (18+)')).toBeNull()
    const target = (name: string) => {
      const url = new URL(screen.getByRole('link', { name }).getAttribute('href') ?? '', 'https://fixture.invalid')
      return { path: url.pathname, ...Object.fromEntries(url.searchParams) }
    }
    expect(target('Konto erstellen')).toEqual({ path: '/login', mode: 'signup', next: '/i' })
    expect(target('Anmelden')).toEqual({ path: '/login', mode: 'signin', next: '/i' })
    // the bunny peeks over the top edge of the invitation card (welcome stage 'peek-once', a lazy chunk)
    expect((await screen.findByTestId('welcome-bunnies')).dataset.choreography).toBe('peek-once')
    // nothing personal is loaded or shown before sign-in, and opening the link joined nothing
    expect(api.getLocalSession).not.toHaveBeenCalled()
    expect(api.getMe).not.toHaveBeenCalled()
    expect(api.acceptInvite).not.toHaveBeenCalled()
    expect(getPendingInvite()).toBe(TOKEN)
  })

  it('falls back to the landing when the stored session is no longer usable', async () => {
    setPendingInvite(TOKEN)
    api.hasLocalSession.mockReturnValue(true)
    api.getLocalSession.mockRejectedValueOnce(new AppError('session_expired'))
    renderInvite()
    expect(await screen.findByRole('link', { name: 'Konto erstellen' })).toBeTruthy()
    expect(api.getMe).not.toHaveBeenCalled()
    expect(getPendingInvite()).toBe(TOKEN)
  })
})

describe('invite /i — (c) signed in, profile or legal records incomplete', () => {
  it.each([
    ['current legal records missing', me({ consents_ok: false })],
    ['no display name', me({ display_name: null })],
    ['blank display name', me({ display_name: '  ' })],
  ])('%s → /welcome/profile?next=/i, the link stays', async (_case, profile) => {
    setPendingInvite(TOKEN)
    api.hasLocalSession.mockReturnValue(true)
    api.getLocalSession.mockResolvedValue(SESSION)
    api.getMe.mockResolvedValue(profile)
    const { router } = renderInvite()
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome/profile'))
    expect(router.state.location.search).toEqual({ next: '/i' })
    expect(getPendingInvite()).toBe(TOKEN)
    expect(api.acceptInvite).not.toHaveBeenCalled()
  })
})

describe('invite /i — (d) signed in and ready: explicit "Beitreten"', () => {
  it('explains what the members will see and joins only on the tap', async () => {
    await renderReady()
    expect(screen.getByText(/deinen Namen „Mila Fixture“, dein Profilbild, falls du eins hast, und deine Antwort, ob du kommst/)).toBeTruthy()
    expect(screen.getByText('Du kannst den Anlass jederzeit wieder verlassen.')).toBeTruthy()
    expect(api.getMe).toHaveBeenCalledTimes(1)
    expect(api.acceptInvite).not.toHaveBeenCalled()
    expect(getPendingInvite()).toBe(TOKEN)
  })

  it('waits for the server (not optimistic), then refreshes the feed, lets the bunny jump and opens the occasion', async () => {
    const { router, queryClient } = await renderReady()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const answer = deferred<string>()
    const jump = deferred<void>()
    api.acceptInvite.mockReturnValueOnce(answer.promise)
    api.play.mockReturnValueOnce(jump.promise)

    const button = joinButton()
    fireEvent.click(button)
    expect(api.acceptInvite).toHaveBeenCalledWith(TOKEN, SESSION.user.id) // for the account named on the screen
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(getPendingInvite()).toBeNull() // consumed right before accept_invite
    fireEvent.click(button)
    expect(api.acceptInvite).toHaveBeenCalledTimes(1) // no double join
    expect(screen.queryByText('Du bist dabei!')).toBeNull()
    expect(router.state.location.pathname).toBe('/i')

    answer.resolve(OCCASION_ID)
    expect(await screen.findByRole('button', { name: 'Du bist dabei!' })).toBeTruthy()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.feed() })
    expect(api.play).toHaveBeenCalledWith('jump')
    expect(router.state.location.pathname).toBe('/i') // the bunny jumps first

    jump.resolve()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/occasions/${OCCASION_ID}`))
    expect(screen.getByText(`occasion ${OCCASION_ID}`)).toBeTruthy()
    expect(getPendingInvite()).toBeNull()
  })

  it('someone already in the occasion (their own feed has it) hears "Du bist schon dabei!", not "Du bist dabei!"', async () => {
    const { queryClient } = await renderReady()
    queryClient.setQueryData(qk.feed(), { upcoming: [{ id: OCCASION_ID }], past: [] })
    api.acceptInvite.mockResolvedValueOnce(OCCASION_ID)
    api.play.mockReturnValueOnce(new Promise(() => {})) // the bunny keeps jumping: the screen stays
    fireEvent.click(joinButton())
    expect(await screen.findByRole('button', { name: 'Du bist schon dabei!' })).toBeTruthy()
    expect(screen.queryByText('Du bist dabei!')).toBeNull()
  })

  it('"Nicht jetzt" keeps the link and goes to the feed without joining', async () => {
    const { router } = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: 'Nicht jetzt' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/soon'))
    expect(getPendingInvite()).toBe(TOKEN)
    expect(api.acceptInvite).not.toHaveBeenCalled()
  })

  it.each(['consent_required', 'profile_incomplete'] as const)('%s on join → profile, the link is kept', async (code) => {
    const { router } = await renderReady()
    api.acceptInvite.mockRejectedValueOnce(new AppError(code))
    fireEvent.click(joinButton())
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome/profile'))
    expect(router.state.location.search).toEqual({ next: '/i' })
    expect(getPendingInvite()).toBe(TOKEN)
  })

  it('a lost session on join shows the landing again and keeps the link', async () => {
    await renderReady()
    api.acceptInvite.mockRejectedValueOnce(new AppError('session_expired'))
    fireEvent.click(joinButton())
    expect(await screen.findByRole('link', { name: 'Anmelden' })).toBeTruthy()
    expect(getPendingInvite()).toBe(TOKEN)
  })

  it('a network failure keeps the screen and the link for another try', async () => {
    const { router } = await renderReady()
    api.acceptInvite.mockRejectedValueOnce(new AppError('network'))
    const button = joinButton()
    fireEvent.click(button)
    expect((await screen.findByRole('alert')).textContent).toBe('Keine Verbindung')
    expect(getPendingInvite()).toBe(TOKEN)
    expect(button.getAttribute('aria-busy')).toBeNull()

    api.acceptInvite.mockResolvedValueOnce(OCCASION_ID)
    fireEvent.click(joinButton())
    await waitFor(() => expect(router.state.location.pathname).toBe(`/occasions/${OCCASION_ID}`))
    expect(api.acceptInvite).toHaveBeenNthCalledWith(2, TOKEN, SESSION.user.id)
  })

  it('offline: joining is disabled with a hint, the link stays', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await renderReady()
    expect(joinButton().hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Dafür brauchst du Netz')).toBeTruthy()
    fireEvent.click(joinButton())
    expect(api.acceptInvite).not.toHaveBeenCalled()
    expect(getPendingInvite()).toBe(TOKEN)
  })

  it('a failed profile check is calm and can be retried', async () => {
    setPendingInvite(TOKEN)
    api.hasLocalSession.mockReturnValue(true)
    api.getLocalSession.mockResolvedValue(SESSION)
    api.getMe.mockRejectedValueOnce(new AppError('network')).mockResolvedValueOnce(me())
    renderInvite()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Laden hat nicht geklappt')
    expect(alert.textContent).toContain('Keine Verbindung')
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Möchtest du beitreten?' })).toBeTruthy()
    expect(api.acceptInvite).not.toHaveBeenCalled()
  })
})
